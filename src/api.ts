// Client for an OGraf Server API (https://ograf.ebu.io, v1). Only standard endpoints are needed; the `x-actions`
// group actions are an optional vendor extension that is used when the server offers it.

export type JsonObject = Record<string, unknown>

export interface Renderer {
	id: string
	name: string
	status: string
	message: string
	customActions: { id: string; name: string }[]
	targets: Target[]
}

export interface Target {
	key: string
	rendererId: string
	rendererName: string
	renderTarget: JsonObject
	name: string
	description: string
	instances: Instance[]
}

export interface Instance {
	graphicInstanceId: string
	graphicId: string
	graphicName: string
	// Not part of the specification; used when a server reports them (e.g. Grafonaut).
	playing?: boolean
	ended?: boolean
}

export interface Graphic {
	id: string
	name: string
}

export interface GraphicDetails {
	stepCount: number
	customActions: { id: string; name: string }[]
	defaults: JsonObject
}

export interface GroupAction {
	id: string
	name: string
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message)
	}
}

export const isObject = (value: unknown): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

// Render targets are shallow objects defined by the renderer (e.g. { "layer": 10 }); their canonical JSON (sorted
// keys) together with the renderer ID identifies a target in options and presets.
export function targetKey(rendererId: string, renderTarget: JsonObject): string {
	const sorted = Object.fromEntries(
		Object.keys(renderTarget)
			.sort()
			.map((key) => [key, renderTarget[key]]),
	)
	return JSON.stringify({ renderer: rendererId, target: sorted })
}

export function parseTargetKey(key: string): { rendererId: string; renderTarget: JsonObject } | null {
	try {
		const value: unknown = JSON.parse(key)
		if (isObject(value) && typeof value.renderer === 'string' && isObject(value.target)) {
			return { rendererId: value.renderer, renderTarget: value.target }
		}
	} catch {
		// invalid key
	}
	return null
}

// The base URL of the API, e.g. https://server.example.com/ograf/v1 (any path prefix is allowed by the spec).
export function parseBaseUrl(value: string | undefined): string | null {
	const text = String(value ?? '').trim()
	if (!text) return null
	try {
		const url = new URL(text)
		if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) return null
		return url.href.replace(/\/?$/, '/')
	} catch {
		return null
	}
}

// Default values of a GDD/JSON schema, as a graphic expects them for load() when no data is given.
export function schemaDefaults(schema: unknown): JsonObject {
	if (!isObject(schema)) return {}
	const result: JsonObject = isObject(schema.default) ? { ...schema.default } : {}
	if (!isObject(schema.properties)) return result
	for (const [key, property] of Object.entries(schema.properties)) {
		if (!isObject(property) || result[key] !== undefined) continue
		if (property.default !== undefined) result[key] = property.default
		else if (property.type === 'object') {
			const nested = schemaDefaults(property)
			if (Object.keys(nested).length) result[key] = nested
		}
	}
	return result
}

const text = (value: unknown, fallback: string): string => (typeof value === 'string' && value ? value : fallback)
const actionList = (value: unknown): { id: string; name: string }[] =>
	(Array.isArray(value) ? value : [])
		.filter(isObject)
		.filter((action) => typeof action.id === 'string' && action.id)
		.map((action) => ({ id: String(action.id), name: text(action.name, String(action.id)) }))

export class OgrafApi {
	constructor(
		private readonly baseUrl: string,
		private readonly timeoutMs = 10000,
	) {}

	async request(
		method: 'GET' | 'POST' | 'PUT',
		path: string,
		body?: unknown,
		timeoutMs = this.timeoutMs,
	): Promise<unknown> {
		const response = await fetch(new URL(path, this.baseUrl), {
			method,
			headers:
				body === undefined
					? { Accept: 'application/json' }
					: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		})
		const payload: unknown = await response.json().catch(() => ({}))
		if (!response.ok) {
			const problem = isObject(payload) ? payload : {}
			const errors = Array.isArray(problem.errors) ? ` ${problem.errors.join('; ')}` : ''
			const detail = text(problem.detail, text(problem.title, `HTTP ${response.status}`))
			throw new ApiError(`${detail}${errors}`, response.status)
		}
		return payload
	}

	async renderers(): Promise<Renderer[]> {
		const list = await this.request('GET', 'renderers')
		const items = isObject(list) && Array.isArray(list.renderers) ? list.renderers.filter(isObject) : []
		return Promise.all(
			items
				.filter((item) => typeof item.id === 'string')
				.map(async (item) => this.renderer(String(item.id), text(item.name, String(item.id)))),
		)
	}

	async renderer(id: string, fallbackName = id): Promise<Renderer> {
		const payload = await this.request('GET', `renderers/${encodeURIComponent(id)}`)
		const info = isObject(payload) && isObject(payload.renderer) ? payload.renderer : {}
		const status = isObject(info.status) ? info.status : {}
		const name = text(info.name, fallbackName)
		const targets = (Array.isArray(info.renderTargets) ? info.renderTargets : [])
			.filter(isObject)
			.flatMap((target): Target[] => {
				if (!isObject(target.renderTarget)) return []
				const renderTarget = target.renderTarget
				const instances = (Array.isArray(target.graphicInstances) ? target.graphicInstances : [])
					.filter(isObject)
					.filter((instance) => typeof instance.graphicInstanceId === 'string')
					.map((instance): Instance => {
						const graphic = isObject(instance.graphic) ? instance.graphic : {}
						return {
							graphicInstanceId: String(instance.graphicInstanceId),
							graphicId: text(graphic.id, ''),
							graphicName: text(graphic.name, text(graphic.id, '')),
							...(typeof instance.playing === 'boolean' ? { playing: instance.playing } : {}),
							...(typeof instance.ended === 'boolean' ? { ended: instance.ended } : {}),
						}
					})
				return [
					{
						key: targetKey(id, renderTarget),
						rendererId: id,
						rendererName: name,
						renderTarget,
						name: text(target.name, JSON.stringify(renderTarget)),
						description: text(target.description, ''),
						instances,
					},
				]
			})
		return {
			id,
			name,
			status: text(status.status, 'OK'),
			message: text(status.message, ''),
			customActions: actionList(info.customActions),
			targets,
		}
	}

	async graphics(): Promise<Graphic[]> {
		const payload = await this.request('GET', 'graphics')
		const items = isObject(payload) && Array.isArray(payload.graphics) ? payload.graphics.filter(isObject) : []
		return items
			.filter((item) => typeof item.id === 'string')
			.map((item) => ({ id: String(item.id), name: text(item.name, String(item.id)) }))
	}

	async graphicDetails(id: string): Promise<GraphicDetails> {
		const payload = await this.request('GET', `graphics/${encodeURIComponent(id)}`)
		const manifest = isObject(payload) && isObject(payload.graphic) ? payload.graphic : {}
		return {
			stepCount: typeof manifest.stepCount === 'number' ? manifest.stepCount : 1,
			customActions: actionList(manifest.customActions),
			defaults: schemaDefaults(manifest.schema),
		}
	}

	private instancePath(rendererId: string, action: string): string {
		return `renderers/${encodeURIComponent(rendererId)}/target/graphicInstance/${action}`
	}

	async load(rendererId: string, renderTarget: JsonObject, graphicId: string, data: unknown): Promise<string> {
		const payload = await this.request('POST', this.instancePath(rendererId, 'load'), {
			renderTarget,
			graphicId,
			params: { data },
		})
		if (!isObject(payload) || typeof payload.graphicInstanceId !== 'string')
			throw new Error('The server returned no graphicInstanceId')
		return payload.graphicInstanceId
	}

	async play(
		rendererId: string,
		renderTarget: JsonObject,
		graphicInstanceId: string,
		params: JsonObject,
	): Promise<{ currentStep: number | null }> {
		const payload = await this.request('POST', this.instancePath(rendererId, 'playAction'), {
			renderTarget,
			graphicInstanceId,
			params,
		})
		return { currentStep: isObject(payload) && typeof payload.currentStep === 'number' ? payload.currentStep : null }
	}

	async stop(
		rendererId: string,
		renderTarget: JsonObject,
		graphicInstanceId: string,
		skipAnimation: boolean,
	): Promise<void> {
		await this.request('POST', this.instancePath(rendererId, 'stopAction'), {
			renderTarget,
			graphicInstanceId,
			params: skipAnimation ? { skipAnimation } : {},
		})
	}

	async update(rendererId: string, renderTarget: JsonObject, graphicInstanceId: string, data: unknown): Promise<void> {
		await this.request('POST', this.instancePath(rendererId, 'updateAction'), {
			renderTarget,
			graphicInstanceId,
			params: { data },
		})
	}

	async customAction(
		rendererId: string,
		renderTarget: JsonObject,
		graphicInstanceId: string,
		actionId: string,
		payload: unknown,
	): Promise<void> {
		await this.request('POST', this.instancePath(rendererId, `customActions/${encodeURIComponent(actionId)}`), {
			renderTarget,
			graphicInstanceId,
			params: { payload },
		})
	}

	async rendererCustomAction(rendererId: string, actionId: string, payload: unknown): Promise<void> {
		await this.request(
			'POST',
			`renderers/${encodeURIComponent(rendererId)}/customActions/${encodeURIComponent(actionId)}`,
			{ payload },
		)
	}

	async clear(rendererId: string, filters: JsonObject[]): Promise<void> {
		await this.request('PUT', this.instancePath(rendererId, 'clear'), { filters })
	}

	// Vendor extension (Grafonaut): group actions. null when the server does not offer it.
	async groupActions(): Promise<GroupAction[] | null> {
		try {
			const payload = await this.request('GET', 'x-actions')
			if (!isObject(payload) || !Array.isArray(payload.actions)) return null
			return payload.actions
				.filter(isObject)
				.filter((action) => typeof action.id === 'string')
				.map((action) => ({ id: String(action.id), name: text(action.name, String(action.id)) }))
		} catch {
			return null
		}
	}

	async runGroupAction(id: string): Promise<{ failures: { step: number; message: string }[] }> {
		const payload = await this.request('POST', `x-actions/${encodeURIComponent(id)}`, undefined, 120000)
		const failures = isObject(payload) && Array.isArray(payload.failures) ? payload.failures.filter(isObject) : []
		return {
			failures: failures.map((failure) => ({
				step: typeof failure.step === 'number' ? failure.step : 0,
				message: text(failure.message, 'failed'),
			})),
		}
	}
}
