import express from 'express';
import { openDb } from '../db/index.js';
import createCommentsRoutes from '../api_routes/comments.js';

describe('Comment thread notifications (sqlite)', () => {
	let db;
	let server;
	let baseUrl;

	let ownerUserId;
	let aliceUserId;
	let bobUserId;
	let createdImageId;

	beforeAll(async () => {
		process.env.DB_ADAPTER = 'sqlite';
		db = await openDb({ quiet: true });

		// Create users
		const owner = await db.queries.insertUser.run(`owner-${Date.now()}@example.com`, 'pw', 'consumer');
		ownerUserId = Number(owner.insertId || owner.lastInsertRowid);

		const alice = await db.queries.insertUser.run(`alice-${Date.now()}@example.com`, 'pw', 'consumer');
		aliceUserId = Number(alice.insertId || alice.lastInsertRowid);

		const bob = await db.queries.insertUser.run(`bob-${Date.now()}@example.com`, 'pw', 'consumer');
		bobUserId = Number(bob.insertId || bob.lastInsertRowid);

		// Create + publish image so non-owners can comment
		const filename = `comment_test_${Date.now()}.png`;
		const img = await db.queries.insertCreatedImage.run(
			ownerUserId,
			filename,
			`/api/images/created/${filename}`,
			64,
			64,
			'#000000',
			'completed',
			null
		);
		createdImageId = Number(img.insertId || img.lastInsertRowid);
		await db.queries.publishCreatedImage.run(createdImageId, ownerUserId, 'Thread test', '');

		// Spin up a tiny app with auth injected via header
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			const raw = req.headers['x-test-user-id'];
			const userId = Number(Array.isArray(raw) ? raw[0] : raw);
			if (Number.isFinite(userId) && userId > 0) {
				req.auth = { userId };
			}
			next();
		});
		app.use(createCommentsRoutes({ queries: db.queries }));

		await new Promise((resolve) => {
			server = app.listen(0, () => resolve());
		});
		const addr = server.address();
		const port = typeof addr === 'object' && addr ? addr.port : null;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		if (server) {
			await new Promise((resolve) => server.close(() => resolve()));
		}
		if (db?.reset) {
			await db.reset();
		}
	});

	it('notifies distinct prior commenters (excluding the commenter)', async () => {
		// Alice comments first: no prior commenters to notify
		{
			const res = await fetch(`${baseUrl}/api/created-images/${createdImageId}/comments`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-test-user-id': String(aliceUserId)
				},
				body: JSON.stringify({ text: 'first!' })
			});
			expect(res.ok).toBe(true);
		}

		const aliceNotesAfterFirst = await db.queries.selectNotificationsForUser.all(aliceUserId, 'consumer');
		expect(aliceNotesAfterFirst.length).toBe(0);

		// Bob comments: Alice should get a notification
		{
			const res = await fetch(`${baseUrl}/api/created-images/${createdImageId}/comments`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-test-user-id': String(bobUserId)
				},
				body: JSON.stringify({ text: 'second!' })
			});
			expect(res.ok).toBe(true);
		}

		const aliceNotesAfterBob = await db.queries.selectNotificationsForUser.all(aliceUserId, 'consumer');
		expect(aliceNotesAfterBob.length).toBe(1);
		expect(String(aliceNotesAfterBob[0].title)).toBe('New comment');
		expect(String(aliceNotesAfterBob[0].link)).toBe(`/creations/${createdImageId}`);

		const bobNotesAfterBob = await db.queries.selectNotificationsForUser.all(bobUserId, 'consumer');
		expect(bobNotesAfterBob.length).toBe(0);

		// Alice comments again: Bob should now get a notification (Alice excluded)
		{
			const res = await fetch(`${baseUrl}/api/created-images/${createdImageId}/comments`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-test-user-id': String(aliceUserId)
				},
				body: JSON.stringify({ text: 'third!' })
			});
			expect(res.ok).toBe(true);
		}

		const bobNotesAfterAlice2 = await db.queries.selectNotificationsForUser.all(bobUserId, 'consumer');
		expect(bobNotesAfterAlice2.length).toBe(1);
		expect(String(bobNotesAfterAlice2[0].title)).toBe('New comment');
		expect(String(bobNotesAfterAlice2[0].link)).toBe(`/creations/${createdImageId}`);
	});
});

