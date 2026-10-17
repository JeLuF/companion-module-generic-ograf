import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	pollInterval: number
}

// The base URL may carry an access token (some servers, e.g. Grafonaut, put it in the path), so it is a secret.
export type ModuleSecrets = {
	apiUrl: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'OGraf Server API',
			width: 12,
			value:
				"Base URL of the server's OGraf Server API, e.g. https://graphics.example.com/ograf/v1 (the path prefix depends on the server).",
		},
		{
			type: 'secret-text',
			id: 'apiUrl',
			label: 'API base URL',
			width: 12,
			regex: '/^https?:\\/\\/\\S+$/',
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Status update interval (ms)',
			tooltip: 'How often renderers, render targets and graphics are fetched',
			width: 6,
			min: 250,
			max: 60000,
			default: 1000,
		},
	]
}
