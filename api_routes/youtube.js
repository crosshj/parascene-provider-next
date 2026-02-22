import express from "express";

function extractYoutubeVideoId(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ""));
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	const pathname = parsed.pathname || "";

	// youtube.com/watch?v=VIDEO_ID
	if (host === "www.youtube.com" || host === "youtube.com" || host === "m.youtube.com") {
		if (pathname === "/watch") {
			const v = parsed.searchParams.get("v");
			return v && /^[a-zA-Z0-9_-]{6,}$/.test(v) ? v : null;
		}

		// youtube.com/shorts/VIDEO_ID
		const shortsMatch = pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
		if (shortsMatch) return shortsMatch[1];
	}

	// youtu.be/VIDEO_ID
	if (host === "youtu.be" || host === "www.youtu.be") {
		const m = pathname.match(/^\/([a-zA-Z0-9_-]{6,})/);
		if (m) return m[1];
	}

	return null;
}

function normalizeUrl(raw) {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return null;
	if (value.length > 2048) return null;
	if (!value.startsWith("https://") && !value.startsWith("http://")) return null;
	return value;
}

function extractYoutubeCreator({ authorUrl, authorName }) {
	let handle = "";
	try {
		const parsed = new URL(String(authorUrl || ""));
		const path = String(parsed.pathname || "");
		const m = path.match(/^\/@([A-Za-z0-9._-]{2,})/);
		if (m) handle = `@${m[1]}`;
	} catch {
		// ignore
	}

	const name = typeof authorName === "string" ? authorName.trim() : "";
	return handle || name || "";
}

export default function createYoutubeRoutes() {
	const router = express.Router();

	router.get("/api/youtube/oembed", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const url = normalizeUrl(req.query?.url);
		if (!url) {
			return res.status(400).json({ error: "Missing url" });
		}

		const videoId = extractYoutubeVideoId(url);
		if (!videoId) {
			return res.status(400).json({ error: "Invalid YouTube url" });
		}

		// Aggressive caching: browser + CDN where applicable.
		// Note: auth cookies may limit shared caching, but browser caching still helps.
		res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");

		const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

		try {
			const upstream = await fetch(oembedUrl, {
				method: "GET",
				headers: {
					"Accept": "application/json",
					"User-Agent": "parascene-oembed-proxy"
				}
			});

			if (!upstream.ok) {
				return res.status(502).json({ error: "YouTube oEmbed failed" });
			}

			const data = await upstream.json().catch(() => null);
			const title = typeof data?.title === "string" ? data.title.trim() : "";
			if (!title) {
				return res.status(502).json({ error: "No title returned" });
			}

			const creator = extractYoutubeCreator({
				authorUrl: data?.author_url,
				authorName: data?.author_name
			});

			return res.json({ title, creator });
		} catch (error) {
			return res.status(502).json({ error: "YouTube oEmbed fetch failed" });
		}
	});

	return router;
}

