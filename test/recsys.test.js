import { recommend } from '../db/recommend/recsys.js';

function seededRng(seed = 42) {
	let s = seed >>> 0;
	return () => {
		// xorshift32
		s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
		return ((s >>> 0) % 1000000) / 1000000;
	};
}

function sampleData(now = '2026-02-13T00:00:00Z') {
	const pool = [
		{ id: 1, user_id: 10, family_id: 'F1', meta: { server_id: 'p1', method: 'm1' }, created_at: '2026-02-12T00:00:00Z', published: true },
		{ id: 2, user_id: 10, family_id: 'F1', meta: { server_id: 'p1', method: 'm1', mutate_of_id: 1 }, created_at: '2026-02-12T01:00:00Z', published: true }, // lineage + creator + server/method
		{ id: 3, user_id: 11, family_id: 'F1', meta: { server_id: 'p2', method: 'm2', mutate_of_id: 1 }, created_at: '2026-02-11T00:00:00Z', published: true }, // lineage only
		{ id: 4, user_id: 10, family_id: 'F2', meta: { server_id: 'p1', method: 'm1' }, created_at: '2026-02-12T02:00:00Z', published: true }, // creator + server/method
		{ id: 5, user_id: 22, family_id: 'F3', meta: { server_id: 'p9', method: 'm9' }, created_at: '2026-02-10T00:00:00Z', published: true }, // fallback-ish
		{ id: 6, user_id: 33, family_id: 'F4', meta: { server_id: 'p1', method: 'm1' }, created_at: '2026-01-01T00:00:00Z', published: true }, // old
		{ id: 7, user_id: 44, family_id: 'F5', meta: { server_id: 'p8', method: 'm8' }, created_at: '2026-02-12T03:00:00Z', published: true }
	];

	const transitions = [
		// from anchor 1 -> 4 has strongest click-next
		{ from_created_image_id: 1, to_created_image_id: 4, count: 5, last_updated: '2026-02-12T23:00:00Z' },
		{ from_created_image_id: 1, to_created_image_id: 2, count: 2, last_updated: '2026-02-12T23:00:00Z' },
		{ from_created_image_id: 1, to_created_image_id: 7, count: 1, last_updated: '2026-02-12T23:00:00Z' },
		{ from_created_image_id: 1, to_created_image_id: 6, count: 10, last_updated: '2025-12-01T00:00:00Z' } // very old; decays hard
	];

	return { pool, transitions, now };
}

describe('recsys recommender', () => {
	it('ranks with click-next + lineage + creator/server signals', () => {
		const { pool, transitions, now } = sampleData();
		const config = {
			now: () => +new Date(now),
			rng: seededRng(1),
			batchSize: 5
		};

		const out = recommend({
			config,
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		expect(out).toHaveLength(5);
		// With hard click preference enabled, strongest click-next candidate is first.
		expect(out[0].id).toBe(4);
		expect(out[0].reasons).toContain('clickNext');
		expect(out[0].reasons).not.toContain('lineage');
	});

	it('enforces lineage min slots', () => {
		const { pool, transitions, now } = sampleData();
		const config = {
			now: () => +new Date(now),
			rng: seededRng(2),
			batchSize: 4,
			hardPreference: false,
			lineageMinSlots: 2,
			// make click-next dominate to test promotion logic
			clickNextWeight: 500,
			lineageWeight: 10
		};

		const out = recommend({
			config,
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		const top4 = out.slice(0, 4);
		const lineageCount = top4.filter(x => [2, 3].includes(x.id)).length; // family F1 excluding anchor(1)
		expect(lineageCount).toBeGreaterThanOrEqual(2);
	});

	it('applies windowDays cutoff when half-life decay is disabled', () => {
		const { pool, transitions, now } = sampleData();
		const config = {
			now: () => +new Date(now),
			rng: seededRng(3),
			batchSize: 6,
			windowDays: 14,
			decayHalfLifeDays: 0
		};

		const out = recommend({
			config,
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		// With half-life disabled, windowDays acts as hard cutoff for click-next.
		const old = out.find(x => x.id === 6);
		expect(old).toBeDefined();
		expect(old.reasons).not.toContain('clickNext');
	});

	it('normalizes click-next effect so large counts do not dominate unboundedly', () => {
		const { pool, transitions, now } = sampleData();
		const config = {
			now: () => +new Date(now),
			rng: seededRng(7),
			batchSize: 6,
			// Keep non-click signals at 0 to isolate click normalization behavior.
			lineageWeight: 0,
			sameCreatorWeight: 0,
			sameServerMethodWeight: 0,
			fallbackWeight: 0,
			clickNextWeight: 100
		};

		const out = recommend({
			config,
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		const item4 = out.find(x => x.id === 4);
		const item2 = out.find(x => x.id === 2);
		expect(item4).toBeDefined();
		expect(item2).toBeDefined();
		// 4 has stronger transition count than 2, but normalized score stays bounded by clickNextWeight.
		expect(item4.score).toBeLessThanOrEqual(100);
		expect(item2.score).toBeLessThanOrEqual(100);
		expect(item4.score).toBeGreaterThan(item2.score);
	});

	it('random slots inject variability but remain score-sorted', () => {
		const { pool, transitions, now } = sampleData();
		const config = {
			now: () => +new Date(now),
			rng: seededRng(999),
			randomSlotsPerBatch: 2,
			batchSize: 5
		};

		const out = recommend({
			config,
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		expect(out).toHaveLength(5);
		const ids = out.map(x => x.id);
		expect(new Set(ids).size).toBe(ids.length);
		const clickRows = out.filter((x) => x.reasons.includes('clickNext'));
		for (let i = 1; i < clickRows.length; i++) {
			expect(clickRows[i - 1].click_score).toBeGreaterThanOrEqual(clickRows[i].click_score);
		}
	});

	it('uses canonical recsys shape only', () => {
		const { pool, transitions, now } = sampleData();
		const config = {
			now: () => +new Date(now),
			rng: seededRng(123),
			batchSize: 4
		};

		const out = recommend({
			config,
			anchor: pool.find(x => x.id === 1),
			pool,
			transitions
		});

		expect(out).toHaveLength(4);
		expect(out[0].id).toBe(4);
		expect(out[0].reasons).toContain('clickNext');
		expect(out.some(item => item.reasons.includes('clickNext'))).toBe(true);
	});

	it('uses explore mode in cold scenarios when confidence is low', () => {
		const now = '2026-02-13T00:00:00Z';
		const pool = [
			{ id: 1, user_id: 10, family_id: 'AX', meta: { server_id: 'a', method: 'm1' }, created_at: '2026-02-12T00:00:00Z', published: true },
			{ id: 2, user_id: 21, family_id: 'B', meta: { server_id: 'b', method: 'm2' }, created_at: '2026-02-12T01:00:00Z', published: true },
			{ id: 3, user_id: 22, family_id: 'C', meta: { server_id: 'c', method: 'm3' }, created_at: '2026-02-12T02:00:00Z', published: true },
			{ id: 4, user_id: 23, family_id: 'D', meta: { server_id: 'd', method: 'm4' }, created_at: '2026-02-12T03:00:00Z', published: true },
			{ id: 5, user_id: 24, family_id: 'E', meta: { server_id: 'e', method: 'm5' }, created_at: '2026-02-12T04:00:00Z', published: true }
		];
		const transitions = [];
		const out = recommend({
			config: {
				now: () => +new Date(now),
				rng: seededRng(7),
				batchSize: 4,
				coldMode: 'auto',
				coldConfidenceThreshold: 0.95,
				coldExploreFraction: 0.75,
				coldExploreMinGuessSlots: 1
			},
			anchor: pool[0],
			pool,
			transitions
		});

		expect(out).toHaveLength(4);
		expect(out.some((row) => row.reasons.includes('exploreRandom'))).toBe(true);
	});

	it('includes click-next candidates even without other matching signals', () => {
		const now = '2026-02-13T00:00:00Z';
		const pool = [
			{ id: 1, user_id: 10, family_id: 'A', meta: { server_id: 's1', method: 'm1' }, created_at: '2026-02-12T00:00:00Z', published: true },
			{ id: 2, user_id: 11, family_id: 'B', meta: { server_id: 's2', method: 'm2' }, created_at: '2026-02-12T01:00:00Z', published: true },
			{ id: 3, user_id: 12, family_id: 'C', meta: { server_id: 's1', method: 'm1' }, created_at: '2026-02-12T02:00:00Z', published: true }
		];
		const transitions = [
			{ from_created_image_id: 1, to_created_image_id: 2, count: 1, last_updated: '2026-02-12T23:00:00Z' }
		];
		const out = recommend({
			config: {
				now: () => +new Date(now),
				rng: seededRng(11),
				batchSize: 3,
				clickNextWeight: 100,
				fallbackWeight: 0,
				sameCreatorWeight: 0,
				sameServerMethodWeight: 0,
				lineageWeight: 0,
			},
			anchor: pool[0],
			pool,
			transitions
		});

		const clickOnly = out.find((x) => x.id === 2);
		expect(clickOnly).toBeDefined();
		expect(clickOnly.reasons).toContain('clickNext');
	});

	it('hard preference keeps click-next ahead of non-click candidates', () => {
		const now = '2026-02-13T00:00:00Z';
		const pool = [
			{ id: 1, user_id: 10, family_id: 'A', meta: { server_id: 's1', method: 'm1' }, created_at: '2026-02-12T00:00:00Z', published: true },
			{ id: 2, user_id: 11, family_id: 'B', meta: { server_id: 's2', method: 'm2' }, created_at: '2026-02-12T01:00:00Z', published: true }, // click only
			{ id: 3, user_id: 10, family_id: 'A', meta: { server_id: 's1', method: 'm1', mutate_of_id: 99 }, created_at: '2026-02-12T02:00:00Z', published: true }, // strong non-click
			{ id: 4, user_id: 10, family_id: 'A', meta: { server_id: 's1', method: 'm1' }, created_at: '2026-02-12T03:00:00Z', published: true }
		];
		const transitions = [
			{ from_created_image_id: 1, to_created_image_id: 2, count: 1, last_updated: '2026-02-12T23:00:00Z' }
		];

		const out = recommend({
			config: {
				now: () => +new Date(now),
				rng: seededRng(13),
				batchSize: 4,
				clickNextWeight: 1,
				lineageWeight: 100,
				sameCreatorWeight: 100,
				sameServerMethodWeight: 100,
				fallbackWeight: 10
			},
			anchor: pool[0],
			pool,
			transitions
		});

		const clickIdx = out.findIndex((x) => x.id === 2);
		const nonClickIdx = out.findIndex((x) => x.id === 4);
		expect(clickIdx).toBeGreaterThanOrEqual(0);
		expect(nonClickIdx).toBeGreaterThanOrEqual(0);
		expect(clickIdx).toBeLessThan(nonClickIdx);
	});

	it('orders click-next candidates by click count first', () => {
		const now = '2026-02-13T00:00:00Z';
		const pool = [
			{ id: 1, user_id: 10, family_id: 'A', meta: { server_id: 's1', method: 'm1' }, created_at: '2026-02-12T00:00:00Z', published: true },
			{ id: 2, user_id: 11, family_id: 'B', meta: { server_id: 's2', method: 'm2' }, created_at: '2026-02-12T01:00:00Z', published: true },
			{ id: 3, user_id: 12, family_id: 'C', meta: { server_id: 's3', method: 'm3' }, created_at: '2026-02-12T01:30:00Z', published: true },
			{ id: 4, user_id: 13, family_id: 'D', meta: { server_id: 's4', method: 'm4' }, created_at: '2026-02-12T02:00:00Z', published: true },
			{ id: 5, user_id: 10, family_id: 'A', meta: { server_id: 's1', method: 'm1' }, created_at: '2026-02-12T03:00:00Z', published: true } // strong contextual but non-click
		];
		const transitions = [
			{ from_created_image_id: 1, to_created_image_id: 2, count: 10, last_updated: '2026-02-12T23:00:00Z' },
			{ from_created_image_id: 1, to_created_image_id: 3, count: 5, last_updated: '2026-02-12T23:00:00Z' },
			{ from_created_image_id: 1, to_created_image_id: 4, count: 1, last_updated: '2026-02-12T23:00:00Z' }
		];

		const out = recommend({
			config: {
				now: () => +new Date(now),
				rng: seededRng(21),
				batchSize: 4,
				clickNextWeight: 1,
				lineageWeight: 200,
				sameCreatorWeight: 200,
				sameServerMethodWeight: 200,
				fallbackWeight: 0
			},
			anchor: pool[0],
			pool,
			transitions
		});

		expect(out.slice(0, 3).map((x) => x.id)).toEqual([2, 3, 4]);
		expect(out.slice(0, 3).every((x) => x.reasons.includes('clickNext'))).toBe(true);
	});

	it('uses non-click signals as tie-breakers only when click counts tie', () => {
		const now = '2026-02-13T00:00:00Z';
		const pool = [
			{ id: 1, user_id: 10, family_id: 'A', meta: { server_id: 's1', method: 'm1' }, created_at: '2026-02-12T00:00:00Z', published: true },
			{ id: 2, user_id: 10, family_id: 'A', meta: { server_id: 's9', method: 'm9', mutate_of_id: 1 }, created_at: '2026-02-12T01:00:00Z', published: true }, // click + lineage + sameCreator
			{ id: 3, user_id: 11, family_id: 'B', meta: { server_id: 's8', method: 'm8' }, created_at: '2026-02-12T02:00:00Z', published: true } // click only
		];
		const transitions = [
			{ from_created_image_id: 1, to_created_image_id: 2, count: 4, last_updated: '2026-02-12T23:00:00Z' },
			{ from_created_image_id: 1, to_created_image_id: 3, count: 4, last_updated: '2026-02-12T23:00:00Z' }
		];

		const out = recommend({
			config: {
				now: () => +new Date(now),
				rng: seededRng(22),
				batchSize: 2,
				clickNextWeight: 10,
				lineageWeight: 100,
				sameCreatorWeight: 50,
				sameServerMethodWeight: 0,
				fallbackWeight: 0
			},
			anchor: pool[0],
			pool,
			transitions
		});

		expect(out.map((x) => x.id)).toEqual([2, 3]);
		expect(out[0].click_score).toBe(out[1].click_score);
		expect(out[0].score).toBeGreaterThan(out[1].score);
	});
});
