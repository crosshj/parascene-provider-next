import { fetchJsonWithStatusDeduped } from '/shared/api.js';

function toQuery(params) {
	const qs = new URLSearchParams();
	Object.entries(params || {}).forEach(([k, v]) => {
		if (v === undefined || v === null || v === '') return;
		qs.set(k, String(v));
	});
	const s = qs.toString();
	return s ? `?${s}` : '';
}

export function buildCreatedImageActivityUrl(createdImageId, { order, limit, offset } = {}) {
	return `/api/created-images/${encodeURIComponent(String(createdImageId))}/activity${toQuery({ order, limit, offset })}`;
}

export async function fetchCreatedImageActivity(createdImageId, { order = 'asc', limit = 50, offset = 0 } = {}) {
	const url = buildCreatedImageActivityUrl(createdImageId, { order, limit, offset });
	return fetchJsonWithStatusDeduped(url, { credentials: 'include' }, { windowMs: 500 });
}

export function buildLatestCommentsUrl({ limit } = {}) {
	return `/api/comments/latest${toQuery({ limit })}`;
}

export async function fetchLatestComments({ limit = 10 } = {}) {
	const url = buildLatestCommentsUrl({ limit });
	return fetchJsonWithStatusDeduped(url, { credentials: 'include' }, { windowMs: 2000 });
}

async function readResponsePayload(response) {
	const contentType = response.headers?.get?.('content-type') || '';
	if (contentType.includes('application/json')) {
		try {
			return await response.json();
		} catch {
			return null;
		}
	}
	try {
		return await response.text();
	} catch {
		return null;
	}
}

export async function postCreatedImageComment(createdImageId, text) {
	const url = `/api/created-images/${encodeURIComponent(String(createdImageId))}/comments`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text }),
		credentials: 'include'
	});
	const data = await readResponsePayload(response);
	return { ok: response.ok, status: response.status, data };
}

