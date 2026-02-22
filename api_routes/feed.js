import express from "express";
import { getThumbnailUrl } from "./utils/url.js";

/** Tip items shown in the newbie feed to explain following and other features */
const NEWBIE_FEED_TIPS = [
	{
		id: "tip-create",
		title: "Create new images",
		message: "Use the create flow to generate new images. Pick a method, add your ideas, and publish to your profile.",
		cta: "Create",
		ctaRoute: "/create"
	},
	{
		id: "tip-share",
		title: "Share your creations",
		message: "Your published work lives in Creations. Open any creation to get a shareable link, copy it, or share to social.",
		cta: "My creations",
		ctaRoute: "/creations"
	},
	{
		id: "tip-explore",
		title: "Explore other creators",
		message: "Discover what others are making. Follow creators you like and their new posts will show up in your feed.",
		cta: "Explore",
		ctaRoute: "/explore"
	},
	{
		id: "tip-discord",
		title: "Join our Discord",
		message: "Chat with the community, get help, and share feedback. We’d love to have you.",
		cta: "Join Discord",
		ctaRoute: "https://discord.gg/pqzWstTb8f",
		ctaTarget: "_blank"
	},
	{
		id: "tip-help",
		title: "Help & docs",
		message: "Learn how everything works—creating, sharing, following, and more. Check the help section when you need it.",
		cta: "Help",
		ctaRoute: "/help"
	}
];

/** Insert tip items every N creation items in the newbie feed */
const NEWBIE_FEED_TIP_INTERVAL = 10;

export default function createFeedRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/feed", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		let rows = await queries.selectFeedItems.all(user.id);
		let isNewbieFeed = false;
		if (rows.length === 0 && queries.selectNewbieFeedItems) {
			rows = await queries.selectNewbieFeedItems.all(user.id) ?? [];
			isNewbieFeed = true;
		}

		const transformItem = (item) => {
			const imageUrl = item.url || null;
			return {
				id: item.id,
				title: item.title,
				summary: item.summary,
				author: item.author,
				author_user_name: item.author_user_name ?? null,
				author_display_name: item.author_display_name ?? null,
				author_avatar_url: item.author_avatar_url ?? null,
				author_plan: item.author_plan === "founder" ? "founder" : "free",
				tags: item.tags,
				created_at: item.created_at,
				image_url: imageUrl,
				thumbnail_url: getThumbnailUrl(imageUrl),
				created_image_id: item.created_image_id || null,
				user_id: item.user_id || null,
				like_count: Number(item.like_count ?? 0),
				comment_count: Number(item.comment_count ?? 0),
				viewer_liked: Boolean(item.viewer_liked)
			};
		};

		const itemsWithImages = rows.map(transformItem);

		let items = itemsWithImages;
		if (isNewbieFeed && itemsWithImages.length > 0) {
			items = [];
			let tipIndex = 0;
			for (let i = 0; i < itemsWithImages.length; i++) {
				if (i > 0 && i % NEWBIE_FEED_TIP_INTERVAL === 0 && tipIndex < NEWBIE_FEED_TIPS.length) {
					const tip = NEWBIE_FEED_TIPS[tipIndex];
					items.push({
						type: "tip",
						id: tip.id,
						title: tip.title,
						message: tip.message,
						cta: tip.cta,
						ctaRoute: tip.ctaRoute
					});
					tipIndex += 1;
				}
				items.push(itemsWithImages[i]);
			}
		}

		return res.json({ items });
	});

	return router;
}
