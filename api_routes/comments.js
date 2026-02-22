import express from "express";
import { getThumbnailUrl } from "./utils/url.js";

async function requireUser(req, res, queries) {
	if (!req.auth?.userId) {
		res.status(401).json({ error: "Unauthorized" });
		return null;
	}

	const user = await queries.selectUserById.get(req.auth.userId);
	if (!user) {
		res.status(404).json({ error: "User not found" });
		return null;
	}

	return user;
}

function isPublishedImage(image) {
	return image?.published === true || image?.published === 1;
}

async function requireCreatedImageAccess({ queries, imageId, userId, userRole }) {
	// Owner access
	const owned = await queries.selectCreatedImageById?.get(imageId, userId);
	if (owned) {
		return owned;
	}

	// Published access or admin access
	const anyImage = await queries.selectCreatedImageByIdAnyUser?.get(imageId);
	if (anyImage) {
		const isPublished = isPublishedImage(anyImage);
		const isAdmin = userRole === 'admin';
		if (isPublished || isAdmin) {
			return anyImage;
		}
	}

	return null;
}

function normalizeOrder(raw) {
	const value = String(raw || "").toLowerCase();
	return value === "desc" ? "desc" : "asc";
}

function normalizeLimit(raw, fallback = 50) {
	const n = Number.parseInt(String(raw ?? ""), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(200, Math.max(1, n));
}

function normalizeOffset(raw) {
	const n = Number.parseInt(String(raw ?? ""), 10);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, n);
}


export default function createCommentsRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/comments/latest", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		const limit = normalizeLimit(req.query?.limit, 10);

		const commentsRaw = await queries.selectLatestCreatedImageComments?.all({ limit })
			?? [];

		const comments = (commentsRaw || []).map((row) => {
			const createdImageUrl = row?.created_image_url ?? null;
			return {
				...row,
				created_image_url: createdImageUrl,
				created_image_thumbnail_url: getThumbnailUrl(createdImageUrl)
			};
		});

		return res.json({ comments });
	});

	router.get("/api/created-images/:id/activity", async (req, res) => {
		const user = await requireUser(req, res, queries);
		if (!user) return;

		const imageId = Number.parseInt(req.params.id, 10);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			return res.status(400).json({ error: "Invalid image id" });
		}

		const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
		if (!image) {
			return res.status(404).json({ error: "Image not found" });
		}

		const order = normalizeOrder(req.query?.order);
		const limit = normalizeLimit(req.query?.limit, 50);
		const offset = normalizeOffset(req.query?.offset);

		const comments = await queries.selectCreatedImageComments?.all(imageId, { order, limit, offset })
			?? [];

		let commentCount = comments.length;
		try {
			const countRow = await queries.selectCreatedImageCommentCount?.get(imageId);
			if (countRow && countRow.comment_count !== undefined) {
				commentCount = Number(countRow.comment_count ?? 0);
			}
		} catch {
			// ignore count failures
		}

		let tips = [];
		if (queries.selectCreatedImageTips?.all && image) {
			try {
				const isCreator = Number(image.user_id) === Number(user.id);
				const isAdmin = String(user.role) === "admin";
				if (isCreator || isAdmin) {
					tips = await queries.selectCreatedImageTips.all(imageId, { order, limit: 200, offset: 0 }) ?? [];
				} else {
					// Only include tips where viewer is the tipper.
					const allTips = await queries.selectCreatedImageTips.all(imageId, { order, limit: 200, offset: 0 }) ?? [];
					tips = allTips.filter((t) => Number(t.user_id) === Number(user.id));
				}
			} catch {
				tips = [];
			}
		}

		const items = [
			...comments.map((c) => ({
				type: "comment",
				...c
			})),
			...tips.map((t) => ({
				type: "tip",
				...t
			}))
		];

		items.sort((a, b) => {
			const aTime = a.created_at ?? a.createdAt ?? "";
			const bTime = b.created_at ?? b.createdAt ?? "";
			const cmp = String(aTime).localeCompare(String(bTime));
			return order === "desc" ? -cmp : cmp;
		});

		return res.json({ items, comment_count: commentCount });
	});

	router.post("/api/created-images/:id/comments", async (req, res) => {

		const user = await requireUser(req, res, queries);
		if (!user) return;

		const imageId = Number.parseInt(req.params.id, 10);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			return res.status(400).json({ error: "Invalid image id" });
		}

		const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
		if (!image) {
			return res.status(404).json({ error: "Image not found" });
		}

		const rawText = req.body?.text;
		const text = typeof rawText === "string" ? rawText.trim() : "";
		if (!text) {
			return res.status(400).json({ error: "Comment text is required" });
		}
		if (text.length > 2000) {
			return res.status(400).json({ error: "Comment is too long" });
		}

		const comment = await queries.insertCreatedImageComment?.run(user.id, imageId, text);

		// console.log(`[Comments] POST /api/created-images/${req.params.id}/comments`);

		// Best-effort in-app notifications: creation owner + prior commenters (for digest / in-app).
		// Do not block comment creation if notification insert fails.
		try {
			if (queries.insertNotification?.run) {
				const commenterId = Number(user.id);
				const creationTitle = typeof image?.title === "string" ? image.title.trim() : "";
				const title = "New comment";
				const link = `/creations/${encodeURIComponent(String(imageId))}`;
				const target = { creation_id: imageId };
				const meta = creationTitle ? { creation_title: creationTitle } : {};

				// Notify creation owner when someone else comments (so they get digest / in-app).
				const ownerUserId = Number(image?.user_id);
				if (Number.isFinite(ownerUserId) && ownerUserId > 0 && ownerUserId !== commenterId) {
					const message = creationTitle
						? `Someone commented on “${creationTitle}”.`
						: `Someone commented on your creation.`;
					await queries.insertNotification.run(ownerUserId, null, title, message, link, commenterId, "comment", target, meta);
				}

				// Notify prior commenters (excluding current commenter and owner, to avoid duplicate).
				if (queries.selectCreatedImageCommenterUserIdsDistinct?.all) {
					const rawIds = await queries.selectCreatedImageCommenterUserIdsDistinct.all(imageId);
					const recipientIds = Array.from(new Set(
						(rawIds ?? [])
							.map((r) => Number(r?.user_id ?? r))
							.filter((id) => Number.isFinite(id) && id > 0 && id !== commenterId && id !== ownerUserId)
					));

					if (recipientIds.length > 0) {
						const message = creationTitle
							? `Someone commented on “${creationTitle}”.`
							: `Someone commented on a creation you commented on.`;

						for (const toUserId of recipientIds) {
							await queries.insertNotification.run(toUserId, null, title, message, link, commenterId, "comment_thread", target, meta);
						}
					}
				}
			}
		} catch (error) {
			// This catch exists so comment posting still succeeds even if notifications fail.
		}

		let commentCount = null;
		try {
			const countRow = await queries.selectCreatedImageCommentCount?.get(imageId);
			commentCount = Number(countRow?.comment_count ?? 0);
		} catch {
			// ignore count failures
		}

		return res.json({
			comment,
			comment_count: commentCount
		});
	});

	return router;
}

