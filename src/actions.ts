import type { SomeCompanionActionInputField } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type ActionsSchema = {
	graphic_play: { options: { target: string; graphic: string; data: string; load: boolean } }
	graphic_toggle: { options: { target: string; graphic: string; data: string; clear: boolean } }
	graphic_stop: { options: { target: string; graphic: string; skipAnimation: boolean; clear: boolean } }
	graphic_load: { options: { target: string; graphic: string; data: string } }
	graphic_update: { options: { target: string; graphic: string; data: string } }
	graphic_custom: { options: { target: string; customAction: string; payload: string; load: boolean } }
	target_clear: { options: { target: string } }
	renderer_clear: { options: { renderer: string } }
	renderer_custom: { options: { rendererAction: string; payload: string } }
	group_run: { options: { groupId: string } }
}

const dataDescription =
	"JSON data for the graphic, variables allowed. Empty: the default values of the graphic's schema."

export function UpdateActions(self: ModuleInstance): void {
	const targets = self.targetChoices()
	const graphics = self.graphicChoices(false)
	const anyGraphic = self.graphicChoices(true)
	const customActions = self.customActionChoices()
	const rendererActions = self.rendererActionChoices()
	const renderers = self.rendererChoices()
	const groups = self.groups ?? []

	const target = {
		type: 'dropdown',
		id: 'target',
		label: 'Render target',
		choices: targets,
		default: targets[0]?.id ?? '',
		allowCustom: true,
	} as const satisfies SomeCompanionActionInputField
	const graphic = (withAny: boolean) =>
		({
			type: 'dropdown',
			id: 'graphic',
			label: 'Graphic',
			choices: withAny ? anyGraphic : graphics,
			default: withAny ? '' : (graphics[0]?.id ?? ''),
			allowCustom: true,
		}) as const satisfies SomeCompanionActionInputField
	const data = {
		type: 'textinput',
		id: 'data',
		label: 'Data (JSON)',
		description: dataDescription,
		default: '',
		useVariables: true,
		multiline: true,
	} as const
	const payload = {
		type: 'textinput',
		id: 'payload',
		label: 'Payload (JSON)',
		default: '{}',
		useVariables: true,
		multiline: true,
	} as const
	const clear = {
		type: 'checkbox',
		id: 'clear',
		label: 'Remove after stopping',
		tooltip: 'Clears the instance after stopAction, so the next play loads the graphic again with fresh data',
		default: true,
	} as const

	self.setActionDefinitions({
		graphic_play: {
			name: 'Graphic: Play',
			description:
				'Loads the graphic if it is not on the target (or has played through), then calls playAction; on air, advances to the next step',
			options: [
				target,
				graphic(false),
				data,
				{ type: 'checkbox', id: 'load', label: 'Load the graphic if needed', default: true },
			],
			callback: async ({ options }) =>
				self.run('Play', async (api) =>
					self.playGraphic(api, String(options.target), String(options.graphic), options.data, options.load !== false),
				),
		},
		graphic_toggle: {
			name: 'Graphic: Play/Stop',
			description: 'Stops the graphic when it is on air, plays it (loading it if needed) otherwise',
			options: [target, graphic(false), data, clear],
			callback: async ({ options }) =>
				self.run('Play/Stop', async (api) => {
					const targetKey = String(options.target)
					const graphicId = String(options.graphic)
					if (self.isOnAir(self.instance(self.target(targetKey), graphicId))) {
						await self.stopGraphic(api, targetKey, graphicId, false, options.clear !== false)
					} else await self.playGraphic(api, targetKey, graphicId, options.data, true)
				}),
		},
		graphic_stop: {
			name: 'Graphic: Stop',
			description: 'Calls stopAction on the graphic',
			options: [
				target,
				graphic(true),
				{ type: 'checkbox', id: 'skipAnimation', label: 'Skip the animation', default: false },
				clear,
			],
			callback: async ({ options }) =>
				self.run('Stop', async (api) =>
					self.stopGraphic(
						api,
						String(options.target),
						String(options.graphic),
						options.skipAnimation === true,
						options.clear !== false,
					),
				),
		},
		graphic_load: {
			name: 'Graphic: Load',
			description: 'Loads the graphic onto the target without playing it',
			options: [target, graphic(false), data],
			callback: async ({ options }) =>
				self.run('Load', async (api) => {
					const { rendererId, renderTarget } = self.resolveTarget(String(options.target))
					const graphicId = String(options.graphic)
					await api.load(rendererId, renderTarget, graphicId, self.parseData(options.data, graphicId))
				}),
		},
		graphic_update: {
			name: 'Graphic: Update',
			description: 'Calls updateAction with new data',
			options: [target, graphic(true), data],
			callback: async ({ options }) =>
				self.run('Update', async (api) => {
					const targetKey = String(options.target)
					const instance = self.instance(self.target(targetKey), String(options.graphic))
					if (!instance) throw new Error('The graphic is not loaded on this target')
					const { rendererId, renderTarget } = self.resolveTarget(targetKey)
					await api.update(
						rendererId,
						renderTarget,
						instance.graphicInstanceId,
						self.parseData(options.data, instance.graphicId),
					)
				}),
		},
		graphic_custom: {
			name: 'Graphic: Custom action',
			description: "Calls a custom action declared in the graphic's manifest",
			options: [
				target,
				{
					type: 'dropdown',
					id: 'customAction',
					label: 'Custom action',
					choices: customActions,
					default: customActions[0]?.id ?? '',
					allowCustom: true,
				},
				payload,
				{ type: 'checkbox', id: 'load', label: 'Load the graphic first if needed (with default data)', default: true },
			],
			callback: async ({ options }) =>
				self.run('Custom action', async (api) => {
					const [graphicId, ...rest] = String(options.customAction).split('/')
					const actionId = rest.join('/')
					const targetKey = String(options.target)
					const { rendererId, renderTarget } = self.resolveTarget(targetKey)
					const instanceId = await self.ensureInstance(
						api,
						targetKey,
						graphicId,
						self.parseData('', graphicId),
						options.load !== false,
					)
					await api.customAction(rendererId, renderTarget, instanceId, actionId, self.parsePayload(options.payload))
				}),
		},
		target_clear: {
			name: 'Target: Clear',
			description: 'Removes all graphics from the target at once, without animating out',
			options: [target],
			callback: async ({ options }) =>
				self.run('Clear target', async (api) => {
					const { rendererId, renderTarget } = self.resolveTarget(String(options.target))
					await api.clear(rendererId, [{ renderTarget }])
				}),
		},
		renderer_clear: {
			name: 'Renderer: Clear all',
			description: 'Removes every graphic from the renderer at once, without animating out',
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
			callback: async ({ options }) => self.run('Clear all', async (api) => api.clear(String(options.renderer), [{}])),
		},
		renderer_custom: rendererActions.length
			? {
					name: 'Renderer: Custom action',
					description: 'Calls a custom action of the renderer',
					options: [
						{
							type: 'dropdown',
							id: 'rendererAction',
							label: 'Custom action',
							choices: rendererActions,
							default: rendererActions[0]?.id ?? '',
							allowCustom: true,
						},
						payload,
					],
					callback: async ({ options }) =>
						self.run('Renderer custom action', async (api) => {
							const [rendererId, ...rest] = String(options.rendererAction).split('/')
							await api.rendererCustomAction(rendererId, rest.join('/'), self.parsePayload(options.payload))
						}),
				}
			: undefined,
		// Vendor extension (x-actions), offered only when the server supports it.
		group_run: self.groups
			? {
					name: 'Group action: Run (extension)',
					description: 'Runs a group action of the server (x-actions extension, e.g. Grafonaut)',
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
					callback: async ({ options }) => self.runGroup(String(options.groupId)),
				}
			: undefined,
	})
}
