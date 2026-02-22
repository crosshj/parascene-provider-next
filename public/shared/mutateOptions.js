/**
 * Shared logic for choosing server + method for image mutate (edit) flows.
 * Used by the creation edit page and the simple create page Image Edit tab so both call the same server/method.
 */

export function getMethodIntentList(method) {
	if (Array.isArray(method?.intents)) {
		return method.intents
			.filter(v => typeof v === 'string')
			.map(v => v.trim())
			.filter(Boolean);
	}
	if (typeof method?.intent === 'string') {
		const v = method.intent.trim();
		return v ? [v] : [];
	}
	return [];
}

function normalizeServerConfig(server) {
	if (!server) return null;
	if (server.server_config && typeof server.server_config === 'string') {
		try {
			server.server_config = JSON.parse(server.server_config);
		} catch {
			server.server_config = null;
		}
	}
	return server;
}

/**
 * Load servers available for mutate (same filter as creation edit: id 1 or is_owner or is_member, not suspended).
 * @returns {Promise<Array<{ id: number, name?: string, server_config?: object, ... }>>}
 */
export async function loadMutateServerOptions() {
	try {
		const res = await fetch('/api/servers', { credentials: 'include' });
		if (!res.ok) return [];
		const data = await res.json();
		const servers = Array.isArray(data?.servers) ? data.servers : [];
		return servers
			.filter(server => !server.suspended && (server.id === 1 || server.is_owner === true || server.is_member === true))
			.map(normalizeServerConfig)
			.filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * First server + method that has image_mutate intent (same selection as creation edit page).
 * @returns {Promise<{ serverId: number, methodKey: string } | null>}
 */
export async function loadFirstMutateOptions() {
	const allServers = await loadMutateServerOptions();
	for (const server of allServers) {
		const methods = server?.server_config?.methods;
		if (!methods || typeof methods !== 'object') continue;
		for (const methodKey of Object.keys(methods)) {
			const method = methods[methodKey];
			const intents = getMethodIntentList(method);
			if (intents.includes('image_mutate')) {
				return { serverId: Number(server.id), methodKey };
			}
		}
	}
	return null;
}
