import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import {
	ApiError,
	OgrafApi,
	parseBaseUrl,
	parseTargetKey,
	type Graphic,
	type GraphicDetails,
	type GroupAction,
	type Instance,
	type JsonObject,
	type Renderer,
	type Target,
} from './api.js'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export type Choice = { id: string; label: string }

// What this module knows about a graphic instance beyond the specification: whether it was played and has not been
// stopped, and whether it has played through its steps (stepCount, currentStep).
type LocalInstanceState = { playing: boolean; ended: boolean }

// Controls the graphics of an OGraf Server API: renderers, their render targets and the graphics on them.
export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	api: OgrafApi | null = null
	renderers: Renderer[] = []
	graphics: Graphic[] = []
	readonly details = new Map<string, GraphicDetails>()
	groups: GroupAction[] | null = null
	readonly runningGroups = new Set<string>()
	// Graphics seen on each target: presets offer those combinations (for servers with one graphic per target).
	readonly seenGraphics = new Map<string, Set<string>>()
	private readonly local = new Map<string, LocalInstanceState>()
	private timer: NodeJS.Timeout | null = null
	private polling = false
	private structureKey = ''

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		await this.configUpdated(config, secrets)
	}

	async destroy(): Promise<void> {
		this.stopPolling()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.stopPolling()
		this.renderers = []
		this.graphics = []
		this.details.clear()
		this.groups = null
		this.seenGraphics.clear()
		this.local.clear()
		this.structureKey = ''
		const baseUrl = parseBaseUrl(secrets?.apiUrl)
		this.api = baseUrl ? new OgrafApi(baseUrl) : null
		this.updateDefinitions()
		if (!this.api) {
			this.updateStatus(InstanceStatus.BadConfig, 'Enter the base URL of the OGraf Server API')
			return
		}
		this.updateStatus(InstanceStatus.Connecting)
		await this.poll()
		this.timer = setInterval(() => void this.poll(), Math.max(250, Number(config.pollInterval) || 1000))
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	private stopPolling(): void {
		if (this.timer) clearInterval(this.timer)
		this.timer = null
	}

	// Fetches renderers (with their targets and graphic instances), graphics and, once per graphic, its manifest.
	// Actions, feedbacks, presets and variables are redefined when renderers, targets or graphics change.
	async poll(): Promise<void> {
		const api = this.api
		if (!api || this.polling) return
		this.polling = true
		try {
			const [renderers, graphics, groups] = await Promise.all([api.renderers(), api.graphics(), api.groupActions()])
			if (api !== this.api) return
			for (const graphic of graphics) {
				if (!this.details.has(graphic.id)) {
					this.details.set(
						graphic.id,
						await api.graphicDetails(graphic.id).catch(() => ({ stepCount: 1, customActions: [], defaults: {} })),
					)
				}
			}
			this.renderers = renderers
			this.graphics = graphics
			this.groups = groups
			const live = new Set<string>()
			for (const target of this.targets()) {
				for (const instance of target.instances) {
					live.add(instance.graphicInstanceId)
					if (instance.graphicId) {
						const seen = this.seenGraphics.get(target.key) ?? new Set<string>()
						if (!seen.has(instance.graphicId)) this.structureKey = ''
						this.seenGraphics.set(target.key, seen.add(instance.graphicId))
					}
				}
			}
			for (const id of [...this.local.keys()]) if (!live.has(id)) this.local.delete(id)
			const key = JSON.stringify([
				renderers.map((renderer) => [
					renderer.id,
					renderer.name,
					renderer.customActions,
					renderer.targets.map((target) => [target.key, target.name]),
				]),
				graphics,
				[...this.details.entries()].map(([id, details]) => [id, details.customActions]),
				groups,
			])
			if (key !== this.structureKey) {
				this.structureKey = key
				this.updateDefinitions()
			}
			UpdateVariableValues(this)
			this.checkAllFeedbacks()
			const problem = renderers.find((renderer) => renderer.status !== 'OK')
			if (!renderers.length) this.updateStatus(InstanceStatus.UnknownWarning, 'The server has no renderers')
			else if (problem)
				this.updateStatus(InstanceStatus.UnknownWarning, `${problem.name}: ${problem.message || problem.status}`)
			else this.updateStatus(InstanceStatus.Ok)
		} catch (error) {
			if (api !== this.api) return
			if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, error.message)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, error instanceof Error ? error.message : String(error))
			}
		} finally {
			this.polling = false
		}
	}

	private updateDefinitions(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
		UpdateVariableDefinitions(this)
		UpdateVariableValues(this)
	}

	// ---- State ----

	targets(): Target[] {
		return this.renderers.flatMap((renderer) => renderer.targets)
	}

	target(key: string): Target | undefined {
		return this.targets().find((target) => target.key === key)
	}

	// The newest instance on the target, of the given graphic (or any graphic when graphicId is empty).
	instance(target: Target | undefined, graphicId = ''): Instance | undefined {
		return target?.instances.filter((instance) => !graphicId || instance.graphicId === graphicId).at(-1)
	}

	// On air: played and not stopped or played through. Servers that report `playing`/`ended` are trusted; otherwise
	// the module's own actions are the source.
	isOnAir(instance: Instance | undefined): boolean {
		if (!instance) return false
		if (typeof instance.playing === 'boolean') return instance.playing && instance.ended !== true
		const local = this.local.get(instance.graphicInstanceId)
		return Boolean(local?.playing && !local.ended)
	}

	isEnded(instance: Instance | undefined): boolean {
		if (!instance) return false
		return instance.ended === true || this.local.get(instance.graphicInstanceId)?.ended === true
	}

	graphicName(graphicId: string): string {
		return this.graphics.find((graphic) => graphic.id === graphicId)?.name ?? graphicId
	}

	// ---- Choices for options ----

	targetChoices(): Choice[] {
		const several = this.renderers.length > 1
		return this.targets().map((target) => ({
			id: target.key,
			label: several ? `${target.rendererName}: ${target.name}` : target.name,
		}))
	}

	graphicChoices(withAny: boolean): Choice[] {
		return [
			...(withAny ? [{ id: '', label: 'Any graphic on the target' }] : []),
			...this.graphics.map((graphic) => ({ id: graphic.id, label: graphic.name })),
		]
	}

	customActionChoices(): Choice[] {
		return this.graphics.flatMap((graphic) =>
			(this.details.get(graphic.id)?.customActions ?? []).map((action) => ({
				id: `${graphic.id}/${action.id}`,
				label: `${graphic.name}: ${action.name}`,
			})),
		)
	}

	rendererActionChoices(): Choice[] {
		return this.renderers.flatMap((renderer) =>
			renderer.customActions.map((action) => ({
				id: `${renderer.id}/${action.id}`,
				label: `${renderer.name}: ${action.name}`,
			})),
		)
	}

	rendererChoices(): Choice[] {
		return this.renderers.map((renderer) => ({ id: renderer.id, label: renderer.name }))
	}

	// ---- Running actions ----

	// Runs an action, logs failures and refreshes the state right away.
	async run(label: string, work: (api: OgrafApi) => Promise<void>): Promise<void> {
		if (!this.api) {
			this.log('warn', `${label}: no API URL configured`)
			return
		}
		try {
			await work(this.api)
		} catch (error) {
			this.log('error', `${label}: ${error instanceof Error ? error.message : String(error)}`)
		}
		await this.poll()
	}

	resolveTarget(key: string): { rendererId: string; renderTarget: JsonObject } {
		const parsed = parseTargetKey(key)
		if (!parsed) throw new Error('Choose a render target')
		return parsed
	}

	// Data for load()/updateAction(): the JSON given in the action, or the graphic's schema defaults when it is empty.
	parseData(text: unknown, graphicId: string): unknown {
		const value = typeof text === 'string' ? text.trim() : ''
		if (!value) return this.details.get(graphicId)?.defaults ?? {}
		try {
			return JSON.parse(value)
		} catch {
			throw new Error('The data is not valid JSON')
		}
	}

	parsePayload(text: unknown): unknown {
		const value = typeof text === 'string' ? text.trim() : ''
		if (!value) return {}
		try {
			return JSON.parse(value)
		} catch {
			throw new Error('The payload is not valid JSON')
		}
	}

	// The graphic's instance on the target, loading it first when it is missing or has played through (if allowed).
	async ensureInstance(
		api: OgrafApi,
		targetKey: string,
		graphicId: string,
		data: unknown,
		load: boolean,
	): Promise<string> {
		const { rendererId, renderTarget } = this.resolveTarget(targetKey)
		const existing = this.instance(this.target(targetKey), graphicId)
		if (existing && !this.isEnded(existing)) return existing.graphicInstanceId
		if (!load) throw new Error('The graphic is not loaded on this target')
		if (!graphicId) throw new Error('Choose the graphic to load')
		if (existing) await api.clear(rendererId, [{ renderTarget, graphicInstanceId: existing.graphicInstanceId }])
		const graphicInstanceId = await api.load(rendererId, renderTarget, graphicId, data)
		this.local.set(graphicInstanceId, { playing: false, ended: false })
		return graphicInstanceId
	}

	// playAction: the first play shows the graphic, further plays advance a step. A graphic with stepCount 0 plays
	// once and goes out by itself; one played past its last step has ended as well.
	async playGraphic(
		api: OgrafApi,
		targetKey: string,
		graphicId: string,
		dataText: unknown,
		load: boolean,
	): Promise<void> {
		const { rendererId, renderTarget } = this.resolveTarget(targetKey)
		const loadedGraphic = graphicId || this.instance(this.target(targetKey))?.graphicId || ''
		const instanceId = await this.ensureInstance(
			api,
			targetKey,
			graphicId,
			load ? this.parseData(dataText, loadedGraphic) : undefined,
			load,
		)
		const { currentStep } = await api.play(rendererId, renderTarget, instanceId, {})
		const stepCount = this.details.get(loadedGraphic)?.stepCount ?? 1
		const ended = stepCount === 0 || (stepCount > 0 && currentStep !== null && currentStep >= stepCount)
		this.local.set(instanceId, { playing: !ended, ended })
	}

	async stopGraphic(
		api: OgrafApi,
		targetKey: string,
		graphicId: string,
		skipAnimation: boolean,
		clear: boolean,
	): Promise<void> {
		const { rendererId, renderTarget } = this.resolveTarget(targetKey)
		const instance = this.instance(this.target(targetKey), graphicId)
		if (!instance) return
		await api.stop(rendererId, renderTarget, instance.graphicInstanceId, skipAnimation)
		this.local.set(instance.graphicInstanceId, { playing: false, ended: true })
		if (clear) await api.clear(rendererId, [{ renderTarget, graphicInstanceId: instance.graphicInstanceId }])
	}

	async runGroup(groupId: string): Promise<void> {
		const name = this.groups?.find((group) => group.id === groupId)?.name ?? groupId
		this.runningGroups.add(groupId)
		this.checkFeedbacks('group_running')
		try {
			await this.run(`Group action ${name}`, async (api) => {
				const { failures } = await api.runGroupAction(groupId)
				for (const failure of failures)
					this.log('warn', `Group action ${name}, step ${failure.step}: ${failure.message}`)
			})
		} finally {
			this.runningGroups.delete(groupId)
			this.checkFeedbacks('group_running')
		}
	}
}
