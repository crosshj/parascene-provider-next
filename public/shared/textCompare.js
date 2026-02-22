/**
 * Normalize string for comparison: trim and collapse all whitespace (spaces, newlines, tabs) to single space.
 */
export function normalizeForComparison(str) {
	if (typeof str !== 'string') return '';
	return str.trim().replace(/\s+/g, ' ');
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost
			);
		}
	}
	return dp[m][n];
}

/** Max character difference to still consider two texts "the same". */
const SAME_TOLERANCE_CHARS = 5;

/** Max ratio of length (0-1) for edit distance to still consider "the same". */
const SAME_TOLERANCE_RATIO = 0.02;

/**
 * Returns true if the two strings are considered the same within tolerance:
 * - After normalizing whitespace, they are equal, or
 * - Edit distance is small (≤ SAME_TOLERANCE_CHARS or ≤ SAME_TOLERANCE_RATIO of longer length).
 */
export function textsSameWithinTolerance(a, b) {
	const normA = normalizeForComparison(a);
	const normB = normalizeForComparison(b);
	if (normA === normB) return true;
	if (normA.length === 0 && normB.length === 0) return true;
	const dist = levenshtein(normA, normB);
	const maxLen = Math.max(normA.length, normB.length);
	if (dist <= SAME_TOLERANCE_CHARS) return true;
	if (maxLen > 0 && dist / maxLen <= SAME_TOLERANCE_RATIO) return true;
	return false;
}
