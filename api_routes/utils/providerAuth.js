export function resolveProviderAuthToken(token) {
	if (typeof token !== "string") {
		return null;
	}

	const trimmed = token.trim();
	return trimmed ? trimmed : null;
}

export function buildProviderHeaders(baseHeaders, token) {
	const headers = {
		...(baseHeaders || {})
	};

	const resolvedToken = resolveProviderAuthToken(token);
	if (resolvedToken) {
		headers.Authorization = `Bearer ${resolvedToken}`;
	}

	return headers;
}
