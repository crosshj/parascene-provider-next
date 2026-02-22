import { recommendWithDataSource } from '../db/recommend/recsysWrapper.js';

function sampleInputs() {
	return {
		anchor: { id: 1, user_id: 10, family_id: 'F1', meta: { server_id: 'p1', method: 'm1' }, created_at: '2026-02-12T00:00:00Z', published: true },
		pool: [
			{ id: 1, user_id: 10, family_id: 'F1', meta: { server_id: 'p1', method: 'm1' }, created_at: '2026-02-12T00:00:00Z', published: true },
			{ id: 2, user_id: 10, family_id: 'F1', meta: { server_id: 'p1', method: 'm1', mutate_of_id: 1 }, created_at: '2026-02-12T01:00:00Z', published: true },
			{ id: 3, user_id: 11, family_id: 'F2', meta: { server_id: 'p2', method: 'm2' }, created_at: '2026-02-12T02:00:00Z', published: true }
		],
		transitions: [
			{ from_created_image_id: 1, to_created_image_id: 2, count: 3, last_updated: '2026-02-12T23:00:00Z' }
		]
	};
}

describe('recsys async wrapper', () => {
	it('loads inputs via async loader and returns recommendations', async () => {
		const out = await recommendWithDataSource({
			config: { batchSize: 2, now: () => +new Date('2026-02-13T00:00:00Z') },
			context: { seedId: 1 },
			loadInputs: async () => sampleInputs()
		});

		expect(Array.isArray(out.items)).toBe(true);
		expect(out.items.length).toBeGreaterThan(0);
		expect(out.timings.totalMs).toBeGreaterThanOrEqual(0);
		expect(out.sizes.poolSize).toBe(3);
		expect(out.sizes.transitionsSize).toBe(1);
	});

	it('passes context to loadInputs and exposes phase timings', async () => {
		const seen = [];
		const ticks = [0, 1, 5, 6, 9];
		let idx = 0;
		const nowMs = () => ticks[Math.min(idx++, ticks.length - 1)];
		const out = await recommendWithDataSource({
			config: { batchSize: 2, now: () => +new Date('2026-02-13T00:00:00Z') },
			context: { seedId: 123, viewerId: 77 },
			loadInputs: async (ctx) => {
				seen.push(ctx);
				return sampleInputs();
			},
			nowMs
		});

		expect(seen).toHaveLength(1);
		expect(seen[0].seedId).toBe(123);
		expect(out.timings.inputLoadMs).toBe(4);
		expect(out.timings.scoreMs).toBe(3);
		expect(out.timings.totalMs).toBe(9);
	});

	it('throws on invalid loader', async () => {
		await expect(recommendWithDataSource({
			config: {},
			context: {},
			loadInputs: null
		})).rejects.toThrow('loadInputs must be a function');
	});
});
