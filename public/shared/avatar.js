const AVATAR_COLORS = [
	'#7c3aed',
	'#05c76f',
	'#3b82f6',
	'#f59e0b',
	'#ef4444',
	'#ec4899',
	'#14b8a6',
	'#8b5cf6',
	'#f97316',
	'#06b6d4',
	'#84cc16',
	'#a855f7',
	'#10b981',
	'#6366f1',
	'#f43f5e',
	'#0ea5e9'
];

function hashString(input) {
	const str = String(input ?? '');
	let hash = 5381;
	for (let i = 0; i < str.length; i += 1) {
		hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
	}
	return hash >>> 0;
}

export function getAvatarColor(seed) {
	const str = String(seed ?? '').trim().toLowerCase();
	if (!str) return AVATAR_COLORS[0];
	const idx = hashString(str) % AVATAR_COLORS.length;
	return AVATAR_COLORS[idx];
}

