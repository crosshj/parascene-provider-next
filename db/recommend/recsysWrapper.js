import { recommend } from './recsys.js';

/**
 * Async orchestrator around sync recsys scoring.
 * Keeps recsys pure while timing input-loading and scoring fairly.
 */
export async function recommendWithDataSource({
	config = {},
	context = {},
	loadInputs,
	nowMs = () => Date.now()
}) {
	if (typeof loadInputs !== 'function') {
		throw new Error('loadInputs must be a function');
	}

	const totalStart = nowMs();
	const inputStart = nowMs();
	const inputs = await loadInputs(context);
	const inputEnd = nowMs();

	const anchor = inputs?.anchor;
	const pool = inputs?.pool;
	const transitions = inputs?.transitions;

	const scoreStart = nowMs();
	const items = recommend({
		config,
		anchor,
		pool,
		transitions,
		userId: context?.userId ?? null
	});
	const scoreEnd = nowMs();

	return {
		items,
		timings: {
			inputLoadMs: inputEnd - inputStart,
			scoreMs: scoreEnd - scoreStart,
			totalMs: scoreEnd - totalStart
		},
		sizes: {
			poolSize: Array.isArray(pool) ? pool.length : 0,
			transitionsSize: Array.isArray(transitions) ? transitions.length : 0
		}
	};
}
