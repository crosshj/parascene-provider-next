// Shared fetch helpers for the UI.
// Goals:
// - Deduplicate identical requests within a short time window (coalescing)
// - Return parsed payload once (avoid consuming Response multiple times)
// - Keep call sites simple and consistent

function normalizeHeaderValue(value) {
	if (value == null) return '';
	return String(value).trim();
}

function stableHeadersKey(headers) {
	if (!headers) return '';
	try {
		const entries = [];
		// Headers can be Headers, array tuples, or plain object
		if (headers instanceof Headers) {
			headers.forEach((v, k) => entries.push([k.toLowerCase(), normalizeHeaderValue(v)]));
		} else if (Array.isArray(headers)) {
			headers.forEach((pair) => {
				if (!Array.isArray(pair) || pair.length < 2) return;
				entries.push([String(pair[0]).toLowerCase(), normalizeHeaderValue(pair[1])]);
			});
		} else if (typeof headers === 'object') {
			Object.keys(headers).forEach((k) => {
				entries.push([String(k).toLowerCase(), normalizeHeaderValue(headers[k])]);
			});
		}
		entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
		return entries.map(([k, v]) => `${k}=${v}`).join('&');
	} catch {
		return '';
	}
}

function buildDedupeKey(url, options = {}) {
	const method = String(options.method || 'GET').toUpperCase();
	const credentials = options.credentials ? String(options.credentials) : '';
	const headersKey = stableHeadersKey(options.headers);

	// Only dedupe requests that are safe to repeat (GET/HEAD) and have no body.
	const body = options.body;
	const hasBody = body != null && body !== '';
	const safe = (method === 'GET' || method === 'HEAD') && !hasBody;
	if (!safe) return null;

	return `${method} ${url} cred=${credentials} hdr=${headersKey}`;
}

const inflight = new Map(); // key -> Promise<{ok,status,data}>
const settled = new Map(); // key -> { expiresAt, value: {ok,status,data} }

function pruneSettled() {
	const now = Date.now();
	for (const [key, entry] of settled.entries()) {
		if (!entry || entry.expiresAt <= now) {
			settled.delete(key);
		}
	}
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

/**
 * Fetch JSON (or text fallback) and return status info.
 * If the request is a GET/HEAD without body, this will:
 * - coalesce concurrent calls
 * - reuse the settled result for `windowMs` after it resolves
 */
export async function fetchJsonWithStatusDeduped(url, options = {}, { windowMs = 2000, dedupeKey } = {}) {
	pruneSettled();

	const key = dedupeKey || buildDedupeKey(url, options);
	if (key) {
		const cached = settled.get(key);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.value;
		}
		const pending = inflight.get(key);
		if (pending) return pending;
	}

	const work = (async () => {
		const response = await fetch(url, options);
		const data = await readResponsePayload(response);
		return { ok: response.ok, status: response.status, data };
	})();

	if (!key) {
		return work;
	}

	inflight.set(key, work);
	try {
		const value = await work;
		settled.set(key, { expiresAt: Date.now() + Math.max(0, Number(windowMs) || 0), value });
		return value;
	} finally {
		inflight.delete(key);
	}
}

// Tiny convenience for the common pattern: GET JSON with credentials included.
export function apiGetJsonDeduped(path, { windowMs = 2000 } = {}) {
	return fetchJsonWithStatusDeduped(path, { credentials: 'include' }, { windowMs });
}

