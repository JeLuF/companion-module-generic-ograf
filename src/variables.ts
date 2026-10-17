import type { Target } from './api.js'
import type ModuleInstance from './main.js'

// Fixed variables, plus per renderer `renderer_<id>_status` and per render target `target_<id>_name`,
// `target_<id>_graphic` and `target_<id>_state`.
export type VariablesSchema = {
	[variableId: string]: string | number
}

const clean = (value: string): string => value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'

// A readable, stable variable ID per target: renderer ID and the target's values, e.g. "main_1" or "main_1_14".
export function targetVariableIds(self: ModuleInstance): Map<string, string> {
	const ids = new Map<string, string>()
	const used = new Set<string>()
	const single = self.renderers.length === 1
	for (const target of self.targets()) {
		const values = Object.values(target.renderTarget).map((value) => String(value))
		let id = clean([...(single ? [] : [target.rendererId]), ...values].join('_'))
		for (let n = 2; used.has(id); n++) id = `${id}_${n}`
		used.add(id)
		ids.set(target.key, id)
	}
	return ids
}

function targetState(self: ModuleInstance, target: Target): string {
	const instance = self.instance(target)
	if (!instance) return 'empty'
	if (self.isOnAir(instance)) return 'on air'
	return self.isEnded(instance) ? 'played' : 'loaded'
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: Record<string, { name: string }> = {
		on_air_count: { name: 'Number of graphics on air' },
		on_air_names: { name: 'Names of the graphics on air' },
	}
	for (const renderer of self.renderers)
		definitions[`renderer_${clean(renderer.id)}_status`] = { name: `${renderer.name}: status` }
	const ids = targetVariableIds(self)
	for (const target of self.targets()) {
		const id = ids.get(target.key)
		definitions[`target_${id}_name`] = { name: `${target.name}: name` }
		definitions[`target_${id}_graphic`] = { name: `${target.name}: loaded graphic` }
		definitions[`target_${id}_state`] = { name: `${target.name}: state (on air, loaded, played, empty)` }
	}
	self.setVariableDefinitions(definitions)
}

export function UpdateVariableValues(self: ModuleInstance): void {
	const values: Record<string, string | number> = {}
	const onAir: string[] = []
	for (const renderer of self.renderers) {
		values[`renderer_${clean(renderer.id)}_status`] = renderer.message
			? `${renderer.status}: ${renderer.message}`
			: renderer.status
	}
	const ids = targetVariableIds(self)
	for (const target of self.targets()) {
		const id = ids.get(target.key)
		const instance = self.instance(target)
		values[`target_${id}_name`] = target.name
		values[`target_${id}_graphic`] = instance ? instance.graphicName || self.graphicName(instance.graphicId) : ''
		values[`target_${id}_state`] = targetState(self, target)
		for (const candidate of target.instances) if (self.isOnAir(candidate)) onAir.push(target.name)
	}
	values.on_air_count = onAir.length
	values.on_air_names = onAir.join(', ')
	self.setVariableValues(values)
}
