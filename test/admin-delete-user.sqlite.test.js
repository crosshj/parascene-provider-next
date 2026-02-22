import express from "express";
import { openDb } from "../db/index.js";
import createAdminRoutes from "../api_routes/admin.js";

describe("Admin delete user cleanup (sqlite)", () => {
	let db;
	let server;
	let baseUrl;

	let adminUserId;
	let targetUserId;
	let otherUserId;
	let targetImageId;
	let otherImageId;

	beforeAll(async () => {
		process.env.DB_ADAPTER = "sqlite";
		// Ensure we start from a fresh DB file so schema matches current adapter SQL.
		db = await openDb({ quiet: true });
		if (db?.reset) {
			await db.reset();
		}
		db = await openDb({ quiet: true });

		// Users
		const admin = await db.queries.insertUser.run(`admin-${Date.now()}@example.com`, "pw", "admin");
		adminUserId = Number(admin.insertId || admin.lastInsertRowid);

		const target = await db.queries.insertUser.run(`target-${Date.now()}@example.com`, "pw", "consumer");
		targetUserId = Number(target.insertId || target.lastInsertRowid);

		const other = await db.queries.insertUser.run(`other-${Date.now()}@example.com`, "pw", "consumer");
		otherUserId = Number(other.insertId || other.lastInsertRowid);

		// Profile (so avatar/cover keys can be extracted)
		await db.queries.upsertUserProfile.run(targetUserId, {
			user_name: "target_user",
			display_name: "Target",
			about: null,
			socials: {},
			avatar_url: "/api/images/generic/profile/123/avatar.png",
			cover_image_url: "/api/images/generic/profile/123/cover.png",
			badges: [],
			meta: {}
		});

		// Target's created image (will be deleted)
		{
			const filename = `target_img_${Date.now()}.png`;
			const img = await db.queries.insertCreatedImage.run(
				targetUserId,
				filename,
				`/api/images/created/${filename}`,
				64,
				64,
				"#000000",
				"completed",
				null
			);
			targetImageId = Number(img.insertId || img.lastInsertRowid);
			await db.queries.publishCreatedImage.run(targetImageId, targetUserId, "Target image", "");
		}

		// Other user's created image (should remain; target's like/comment on it should be deleted)
		{
			const filename = `other_img_${Date.now()}.png`;
			const img = await db.queries.insertCreatedImage.run(
				otherUserId,
				filename,
				`/api/images/created/${filename}`,
				64,
				64,
				"#111111",
				"completed",
				null
			);
			otherImageId = Number(img.insertId || img.lastInsertRowid);
			await db.queries.publishCreatedImage.run(otherImageId, otherUserId, "Other image", "");
		}

		// Feed item referencing target image (should be deleted)
		await db.queries.insertFeedItem.run("t", "s", "a", null, targetImageId);

		// Likes/comments on target image by other user (should be deleted)
		await db.queries.insertCreatedImageLike.run(otherUserId, targetImageId);
		await db.queries.insertCreatedImageComment.run(otherUserId, targetImageId, "bye");

		// Target user's like/comment on other image (should be deleted; other image stays)
		await db.queries.insertCreatedImageLike.run(targetUserId, otherImageId);
		await db.queries.insertCreatedImageComment.run(targetUserId, otherImageId, "hello");

		// Follow relationships involving target (should be deleted)
		await db.queries.insertUserFollow.run(targetUserId, otherUserId);
		await db.queries.insertUserFollow.run(otherUserId, targetUserId);

		// Notifications, sessions, credits for target (should be deleted)
		await db.queries.insertNotification.run(targetUserId, null, "Note", "Msg", null);
		await db.queries.insertUserCredits.run(targetUserId, 5, null);
		await db.queries.insertSession.run(targetUserId, `hash_${Date.now()}`, new Date(Date.now() + 60_000).toISOString());

		// Spin up app with injected auth.
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			const raw = req.headers["x-test-user-id"];
			const userId = Number(Array.isArray(raw) ? raw[0] : raw);
			if (Number.isFinite(userId) && userId > 0) {
				req.auth = { userId };
			}
			next();
		});
		app.use(createAdminRoutes({ queries: db.queries, storage: db.storage }));

		await new Promise((resolve) => {
			server = app.listen(0, () => resolve());
		});
		const addr = server.address();
		const port = typeof addr === "object" && addr ? addr.port : null;
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

	it("deletes user and cleans up dependent rows", async () => {
		const res = await fetch(`${baseUrl}/admin/users/${targetUserId}`, {
			method: "DELETE",
			headers: {
				"x-test-user-id": String(adminUserId)
			}
		});
		expect(res.ok).toBe(true);

		const target = await db.queries.selectUserById.get(targetUserId);
		expect(target).toBeFalsy();

		const count = (sql, ...params) =>
			Number(db.db.prepare(sql).get(...params)?.count ?? 0);

		// Target image removed
		expect(count("SELECT COUNT(*) AS count FROM created_images WHERE id = ?", targetImageId)).toBe(0);

		// Feed item referencing target image removed
		expect(count("SELECT COUNT(*) AS count FROM feed_items WHERE created_image_id = ?", targetImageId)).toBe(0);

		// Likes/comments on target image removed
		expect(count("SELECT COUNT(*) AS count FROM likes_created_image WHERE created_image_id = ?", targetImageId)).toBe(0);
		expect(count("SELECT COUNT(*) AS count FROM comments_created_image WHERE created_image_id = ?", targetImageId)).toBe(0);

		// Target user's interactions removed
		expect(count("SELECT COUNT(*) AS count FROM likes_created_image WHERE user_id = ?", targetUserId)).toBe(0);
		expect(count("SELECT COUNT(*) AS count FROM comments_created_image WHERE user_id = ?", targetUserId)).toBe(0);

		// Follow rows involving target removed
		expect(
			count("SELECT COUNT(*) AS count FROM user_follows WHERE follower_id = ? OR following_id = ?", targetUserId, targetUserId)
		).toBe(0);

		// Notifications, sessions, credits removed
		expect(count("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?", targetUserId)).toBe(0);
		expect(count("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?", targetUserId)).toBe(0);
		expect(count("SELECT COUNT(*) AS count FROM user_credits WHERE user_id = ?", targetUserId)).toBe(0);

		// Profile removed
		expect(count("SELECT COUNT(*) AS count FROM user_profiles WHERE user_id = ?", targetUserId)).toBe(0);

		// Other user's image still exists
		expect(count("SELECT COUNT(*) AS count FROM created_images WHERE id = ?", otherImageId)).toBe(1);
	});
});

