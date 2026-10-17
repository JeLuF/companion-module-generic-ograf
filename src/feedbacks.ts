import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'

type TargetOptions = { target: string; graphic: string }

export type FeedbacksSchema = {
	graphic_on_air: { type: 'boolean'; options: TargetOptions }
	graphic_loaded: { type: 'boolean'; options: TargetOptions }
	renderer_ok: { type: 'boolean'; options: { renderer: string } }
	group_running: { type: 'boolean'; options: { groupId: string } }
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const targets = self.targetChoices()
	const graphics = self.graphicChoices(true)
	const renderers = self.rendererChoices()
	const groups = self.groups ?? []
	const targetOptions = [
		{
			type: 'dropdown' as const,
			id: 'target' as const,
			label: 'Render target',
			choices: targets,
			default: targets[0]?.id ?? '',
			allowCustom: true,
		},
		{
			type: 'dropdown' as const,
			id: 'graphic' as const,
			label: 'Graphic',
			choices: graphics,
			default: '',
			allowCustom: true,
		},
	]

	self.setFeedbackDefinitions({
		graphic_on_air: {
			type: 'boolean',
			name: 'Graphic: On air',
			description:
				'The graphic was played and not stopped. Servers that report it are asked; otherwise the actions of this module are the source.',
			defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) },
			options: targetOptions,
			callback: ({ options }) =>
				self.isOnAir(self.instance(self.target(String(options.target)), String(options.graphic))),
		},
		graphic_loaded: {
			type: 'boolean',
			name: 'Graphic: Loaded',
			description: 'A graphic instance is on the target (as reported by the server)',
			defaultStyle: { bgcolor: combineRgb(160, 110, 0), color: combineRgb(255, 255, 255) },
			options: targetOptions,
			callback: ({ options }) => Boolean(self.instance(self.target(String(options.target)), String(options.graphic))),
		},
		renderer_ok: {
			type: 'boolean',
			name: 'Renderer: Status OK',
			description: 'The renderer reports the status OK',
			defaultStyle: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
			options: [
				{
					type: 'dropdown',
					id: 'renderer',
					label: 'Renderer',
					choices: renderers,
					default: renderers[0]?.id ?? '',
					allowCustom: true,
				},
			],
			callback: ({ options }) =>
				self.renderers.find((renderer) => renderer.id === String(options.renderer))?.status === 'OK',
		},
		group_running: self.groups
			? {
					type: 'boolean',
					name: 'Group action: Running (extension)',
					description: 'The group action was started from this Companion and has not finished yet',
					defaultStyle: { bgcolor: combineRgb(0, 120, 200), color: combineRgb(255, 255, 255) },
					options: [
						{
							type: 'dropdown',
							id: 'groupId',
							label: 'Group action',
							choices: groups.map((group) => ({ id: group.id, label: group.name })),
							default: groups[0]?.id ?? '',
							allowCustom: true,
						},
					],
					callback: ({ options }) => self.runningGroups.has(String(options.groupId)),
				}
			: undefined,
	})
}
