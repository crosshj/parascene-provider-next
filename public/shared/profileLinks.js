function normalizeUserName(userName) {
	const value = typeof userName === 'string' ? userName.trim().toLowerCase() : '';
	if (!value) return null;
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(value)) return null;
	return value;
}

export function buildProfilePath({ userName, userId } = {}) {
	const normalizedUserName = normalizeUserName(userName);
	if (normalizedUserName) {
		return `/p/${encodeURIComponent(normalizedUserName)}`;
	}
	const id = Number.parseInt(String(userId ?? ''), 10);
	if (Number.isFinite(id) && id > 0) {
		return `/user/${id}`;
	}
	return null;
}
