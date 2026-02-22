import express from "express";

function extractXStatusInfo(url) {
	let parsed;
	try {
		parsed = new URL(String(url || ""));
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	const pathname = parsed.pathname || "";

	const isXHost =
		host === "x.com" ||
		host === "www.x.com" ||
		host === "twitter.com" ||
		host === "www.twitter.com" ||
		host === "mobile.twitter.com" ||
		host === "m.twitter.com";

	if (!isXHost) return null;

	const m = pathname.match(/^\/([A-Za-z0-9_]{1,30})\/status\/(\d+)/);
	if (m) return { user: m[1], statusId: m[2] };

	const web = pathname.match(/^\/i\/web\/status\/(\d+)/);
	if (web) return { user: "", statusId: web[1] };

	const statuses = pathname.match(/^\/([A-Za-z0-9_]{1,30})\/statuses\/(\d+)/);
	if (statuses) return { user: statuses[1], statusId: statuses[2] };

	return null;
}

function normalizeUrl(raw) {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return null;
	if (value.length > 2048) return null;
	if (!value.startsWith("https://") && !value.startsWith("http://")) return null;
	return value;
}

function toTwitterCanonicalUrl({ user, statusId }) {
	if (user) {
		return `https://twitter.com/${encodeURIComponent(user)}/status/${encodeURIComponent(statusId)}`;
	}
	return `https://twitter.com/i/web/status/${encodeURIComponent(statusId)}`;
}

function extractHandleFromAuthorUrl(authorUrl) {
	let parsed;
	try {
		parsed = new URL(String(authorUrl || ""));
	} catch {
		return "";
	}
	const path = String(parsed.pathname || "").replace(/^\/+/, "");
	const seg = path.split("/")[0] || "";
	return /^[A-Za-z0-9_]{1,30}$/.test(seg) ? seg : "";
}

function decodeHtmlEntities(input) {
	const s = String(input ?? "");
	if (!s) return "";

	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&#(\d+);/g, (_m, n) => {
			const code = Number(n);
			if (!Number.isFinite(code) || code <= 0) return "";
			try {
				return String.fromCodePoint(code);
			} catch {
				return "";
			}
		})
		.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
			const code = Number.parseInt(hex, 16);
			if (!Number.isFinite(code) || code <= 0) return "";
			try {
				return String.fromCodePoint(code);
			} catch {
				return "";
			}
		});
}

function stripHtmlTags(input) {
	return String(input ?? "").replace(/<[^>]*>/g, "");
}

function extractTweetTextFromOembedHtml(html) {
	const raw = String(html ?? "");
	if (!raw) return "";

	// oEmbed html typically includes: <blockquote ...><p ...>TWEET TEXT</p>&mdash; ...
	const m = raw.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
	if (!m) return "";

	const inner = m[1] || "";
	const text = decodeHtmlEntities(stripHtmlTags(inner))
		.replace(/\s+/g, " ")
		.trim();
	return text;
}

export default function createXRoutes() {
	const router = express.Router();

	router.get("/api/x/oembed", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const url = normalizeUrl(req.query?.url);
		if (!url) {
			return res.status(400).json({ error: "Missing url" });
		}

		const info = extractXStatusInfo(url);
		if (!info?.statusId) {
			return res.status(400).json({ error: "Invalid X url" });
		}

		// Aggressive caching: browser + CDN where applicable.
		res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");

		// Use the legacy Twitter oEmbed endpoint, but canonicalize to twitter.com.
		const canonical = toTwitterCanonicalUrl(info);
		const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonical)}&omit_script=1&dnt=true`;

		try {
			const upstream = await fetch(oembedUrl, {
				method: "GET",
				headers: {
					"Accept": "application/json",
					"User-Agent": "parascene-oembed-proxy"
				}
			});

			if (!upstream.ok) {
				return res.status(502).json({ error: "X oEmbed failed" });
			}

			const data = await upstream.json().catch(() => null);
			const authorUrl = typeof data?.author_url === "string" ? data.author_url.trim() : "";
			const handle = extractHandleFromAuthorUrl(authorUrl);

			const authorName = typeof data?.author_name === "string" ? data.author_name.trim() : "";
			const tweetText = extractTweetTextFromOembedHtml(data?.html);

			const title = handle ? `@${handle}` : (authorName ? authorName : "");

			if (!title) {
				return res.status(502).json({ error: "No title returned" });
			}

			return res.json({ title, tweetText });
		} catch {
			return res.status(502).json({ error: "X oEmbed fetch failed" });
		}
	});

	return router;
}

