import { openDb } from '../db/index.js';

describe('related adapter contract compatibility', () => {
	const originalAdapter = process.env.DB_ADAPTER;

	afterAll(() => {
		if (originalAdapter == null) {
			delete process.env.DB_ADAPTER;
			return;
		}
		process.env.DB_ADAPTER = originalAdapter;
	});

	it('mock adapter returns stable related contract shape', async () => {
		process.env.DB_ADAPTER = 'mock';
		const db = await openDb({ quiet: true });
		const out = await db.queries.selectRelatedToCreatedImage.all(1, 1, {
			limit: 10,
			seedIds: [1],
			excludeIds: [2]
		});
		expect(out).toBeTruthy();
		expect(Array.isArray(out.ids)).toBe(true);
		expect(typeof out.hasMore).toBe('boolean');
	});

	it('sqlite adapter returns stable related contract shape', async () => {
		process.env.DB_ADAPTER = 'sqlite';
		const db = await openDb({ quiet: true });
		const out = await db.queries.selectRelatedToCreatedImage.all(1, 1, {
			limit: 10,
			seedIds: [1],
			excludeIds: [2]
		});
		expect(out).toBeTruthy();
		expect(Array.isArray(out.ids)).toBe(true);
		expect(typeof out.hasMore).toBe('boolean');
	});
});
