import express from 'express';
import { openDb } from '../db/index.js';
import createCreateRoutes from '../api_routes/create.js';

describe('Admin publish image on behalf of creator (sqlite)', () => {
	let db;
	let server;
	let baseUrl;

	let adminUserId;
	let creatorUserId;
	let creatorEmail;
	let createdImageId;

	beforeAll(async () => {
		process.env.DB_ADAPTER = 'sqlite';
		db = await openDb({ quiet: true });
		if (db?.reset) {
			await db.reset();
		}
		db = await openDb({ quiet: true });

		const admin = await db.queries.insertUser.run(`admin-${Date.now()}@example.com`, 'pw', 'admin');
		adminUserId = Number(admin.insertId || admin.lastInsertRowid);

		creatorEmail = `creator-${Date.now()}@example.com`;
		const creator = await db.queries.insertUser.run(creatorEmail, 'pw', 'consumer');
		creatorUserId = Number(creator.insertId || creator.lastInsertRowid);

		const filename = `admin_publish_${Date.now()}.png`;
		const img = await db.queries.insertCreatedImage.run(
			creatorUserId,
			filename,
			`/api/images/created/${filename}`,
			64,
			64,
			'#222222',
			'completed',
			null
		);
		createdImageId = Number(img.insertId || img.lastInsertRowid);

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
		app.use(createCreateRoutes({ queries: db.queries, storage: db.storage }));

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

	it('allows admin to publish another user creation and keeps creator attribution', async () => {
		const publishRes = await fetch(`${baseUrl}/api/create/images/${createdImageId}/publish`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-test-user-id': String(adminUserId)
			},
			body: JSON.stringify({
				title: 'Admin-published title',
				description: 'Published by admin on behalf of creator'
			})
		});

		expect(publishRes.ok).toBe(true);
		const publishBody = await publishRes.json();
		expect(publishBody.published).toBe(true);
		expect(String(publishBody.title)).toBe('Admin-published title');

		const image = await db.queries.selectCreatedImageByIdAnyUser.get(createdImageId);
		expect(image).toBeTruthy();
		expect(image.published === 1 || image.published === true).toBe(true);
		expect(String(image.title)).toBe('Admin-published title');

		const feedItem = await db.queries.selectFeedItemByCreatedImageId.get(createdImageId);
		expect(feedItem).toBeTruthy();
		expect(String(feedItem.author)).toBe(creatorEmail);
	});
});
