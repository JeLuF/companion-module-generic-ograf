import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'

const white = combineRgb(255, 255, 255)
const black = combineRgb(0, 0, 0)
const onAirStyle = { bgcolor: combineRgb(200, 0, 0), color: white }
// Without knowing which graphic belongs on which target, every combination is offered, up to this many.
const maxCombinations = 120

// Per render target: Play/Stop, Play and Stop for its graphics, their custom actions, and Clear. A target's graphics
// are those seen on it; for targets that never had one, all graphics (if the combinations stay manageable).
export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const targets = self.targets()
	const allGraphics = self.graphics.map((graphic) => graphic.id)
	const offerAll = targets.length * allGraphics.length <= maxCombinations
	const sections: CompanionPresetSection<ModuleSchema>[] = []

	const definitions = targets.map((target, index) => {
		const seen = [...(self.seenGraphics.get(target.key) ?? [])]
		const graphicIds = seen.length ? seen : offerAll ? allGraphics : []
		const ids: string[] = []
		const add = (suffix: string, preset: NonNullable<CompanionPresetDefinitions<ModuleSchema>[string]>) => {
			const id = `t${index}_${suffix}`
			presets[id] = preset
			ids.push(id)
		}
		for (const graphicId of graphicIds) {
			const name = self.graphicName(graphicId)
			const label = graphicIds.length > 1 || name !== target.name ? `${target.name}\n${name}` : target.name
			const options = { target: target.key, graphic: graphicId }
			add(`${graphicId}_toggle`, {
				type: 'simple',
				name: `${name}: Play/Stop`,
				style: { text: label, size: 'auto', color: white, bgcolor: black },
				steps: [{ down: [{ actionId: 'graphic_toggle', options: { ...options, data: '', clear: true } }], up: [] }],
				feedbacks: [{ feedbackId: 'graphic_on_air', options, style: onAirStyle }],
			})
			add(`${graphicId}_play`, {
				type: 'simple',
				name: `${name}: Play (next step)`,
				style: { text: `▶ ${label}`, size: 'auto', color: white, bgcolor: black },
				steps: [{ down: [{ actionId: 'graphic_play', options: { ...options, data: '', load: true } }], up: [] }],
				feedbacks: [{ feedbackId: 'graphic_on_air', options, style: onAirStyle }],
			})
			add(`${graphicId}_stop`, {
				type: 'simple',
				name: `${name}: Stop`,
				style: { text: `■ ${label}`, size: 'auto', color: white, bgcolor: black },
				steps: [
					{ down: [{ actionId: 'graphic_stop', options: { ...options, skipAnimation: false, clear: true } }], up: [] },
				],
				feedbacks: [],
			})
			for (const action of self.details.get(graphicId)?.customActions ?? []) {
				add(`${graphicId}_custom_${action.id}`, {
					type: 'simple',
					name: `${name}: ${action.name}`,
					style: {
						text: `${target.name}\n${action.name}`,
						size: 'auto',
						color: white,
						bgcolor: combineRgb(60, 40, 120),
					},
					steps: [
						{
							down: [
								{
									actionId: 'graphic_custom',
									options: { target: target.key, customAction: `${graphicId}/${action.id}`, payload: '{}', load: true },
								},
							],
							up: [],
						},
					],
					feedbacks: [],
				})
			}
		}
		add('clear', {
			type: 'simple',
			name: 'Clear',
			style: { text: `CLEAR\n${target.name}`, size: 'auto', color: white, bgcolor: combineRgb(90, 0, 0) },
			steps: [{ down: [{ actionId: 'target_clear', options: { target: target.key } }], up: [] }],
			feedbacks: [],
		})
		return {
			id: `target_${index}`,
			name: self.renderers.length > 1 ? `${target.rendererName}: ${target.name}` : target.name,
			description: target.description,
			type: 'simple' as const,
			presets: ids,
		}
	})
	sections.push({
		id: 'targets',
		name: 'Render targets',
		description: 'Play/Stop turns red while the graphic is on air',
		definitions,
	})

	const rendererPresets: string[] = []
	self.renderers.forEach((renderer, index) => {
		presets[`r${index}_status`] = {
			type: 'simple',
			name: `${renderer.name}: status`,
			style: { text: renderer.name, size: 'auto', color: white, bgcolor: combineRgb(90, 0, 0) },
			steps: [],
			feedbacks: [
				{
					feedbackId: 'renderer_ok',
					options: { renderer: renderer.id },
					style: { bgcolor: combineRgb(0, 140, 60), color: white },
				},
			],
		}
		presets[`r${index}_clear`] = {
			type: 'simple',
			name: `${renderer.name}: Clear all`,
			style: { text: `CLEAR ALL\n${renderer.name}`, size: 'auto', color: white, bgcolor: combineRgb(110, 0, 0) },
			steps: [{ down: [{ actionId: 'renderer_clear', options: { renderer: renderer.id } }], up: [] }],
			feedbacks: [],
		}
		rendererPresets.push(`r${index}_status`, `r${index}_clear`)
		renderer.customActions.forEach((action, actionIndex) => {
			presets[`r${index}_custom_${actionIndex}`] = {
				type: 'simple',
				name: `${renderer.name}: ${action.name}`,
				style: { text: action.name, size: 'auto', color: white, bgcolor: combineRgb(60, 40, 120) },
				steps: [
					{
						down: [
							{
								actionId: 'renderer_custom',
								options: { rendererAction: `${renderer.id}/${action.id}`, payload: '{}' },
							},
						],
						up: [],
					},
				],
				feedbacks: [],
			}
			rendererPresets.push(`r${index}_custom_${actionIndex}`)
		})
	})
	sections.push({ id: 'renderers', name: 'Renderers', definitions: rendererPresets })

	if (self.groups?.length) {
		for (const group of self.groups) {
			presets[`group_${group.id}`] = {
				type: 'simple',
				name: group.name,
				style: { text: group.name, size: 'auto', color: white, bgcolor: combineRgb(0, 60, 110) },
				steps: [{ down: [{ actionId: 'group_run', options: { groupId: group.id } }], up: [] }],
				feedbacks: [
					{
						feedbackId: 'group_running',
						options: { groupId: group.id },
						style: { bgcolor: combineRgb(0, 120, 200), color: white },
					},
				],
			}
		}
		sections.push({
			id: 'groups',
			name: 'Group actions (extension)',
			description: 'Group actions of servers with the x-actions extension',
			definitions: self.groups.map((group) => `group_${group.id}`),
		})
	}
	self.setPresetDefinitions(sections, presets)
}
