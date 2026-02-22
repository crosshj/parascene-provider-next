import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Busboy from "busboy";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import Replicate from "replicate";
import { getThumbnailUrl, getBaseAppUrl, getBaseAppUrlForEmail } from "./utils/url.js";
import { buildPublicImageUrl } from "./utils/publicImageUrl.js";
import {
	buildEmbeddingText,
	getEmbeddingFromReplicate,
	REPLICATE_CLIP_MODEL,
	upsertCreationEmbedding
} from "./utils/embeddings.js";
import { buildProviderHeaders } from "./utils/providerAuth.js";
import { runCreationJob, PROVIDER_TIMEOUT_MS } from "./utils/creationJob.js";
import { runLandscapeJob } from "./utils/landscapeJob.js";
import { scheduleCreationJob, scheduleLandscapeJob } from "./utils/scheduleCreationJob.js";
import { verifyQStashRequest } from "./utils/qstashVerification.js";
import { ACTIVE_SHARE_VERSION, mintShareToken, verifyShareToken } from "./utils/shareLink.js";
import { getStyleInfo } from "./utils/createStyles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Best-effort: compute and store CLIP embedding for a creation. Does not throw. */
async function tryStoreEmbeddingForCreation(creation) {
	if (!creation) return;
	try {
		const supabaseUrl = process.env.SUPABASE_URL;
		const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
		const replicateToken = process.env.REPLICATE_API_TOKEN;
		if (!supabaseUrl || !supabaseKey || !replicateToken) return;
		const creationId = Number(creation.id);
		const userId = Number(creation.user_id);
		const baseUrl = getBaseAppUrlForEmail();
		const imagePublicUrl = buildPublicImageUrl(creationId, userId, baseUrl);
		if (!imagePublicUrl) return;
		const title = creation.title ?? "";
		const description = creation.description ?? "";
		const prompt = (creation.meta && typeof creation.meta === "object" && creation.meta.args?.prompt) ?? "";
		const text = buildEmbeddingText({ title, description, prompt });
		const replicate = new Replicate({ auth: replicateToken });
		const output = await getEmbeddingFromReplicate(replicate, { text, image: imagePublicUrl });
		const embedding = output?.embedding;
		if (!Array.isArray(embedding)) return;
		const supabase = createClient(supabaseUrl, supabaseKey);
		await upsertCreationEmbedding(supabase, creationId, embedding, REPLICATE_CLIP_MODEL);
	} catch (e) {
		console.warn("[create] Embedding store failed:", e?.message || e);
	}
}

function isPng(buffer) {
	return (
		buffer &&
		Buffer.isBuffer(buffer) &&
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	);
}

async function ensurePngBuffer(buffer) {
	if (isPng(buffer)) return buffer;
	return await sharp(buffer, { failOn: "none" }).png().toBuffer();
}

function buildGenericUrl(key) {
	const segments = String(key || "")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg));
	return `/api/images/generic/${segments.join("/")}`;
}

function parseMultipartCreate(req, { maxFileBytes = 12 * 1024 * 1024 } = {}) {
	return new Promise((resolve, reject) => {
		const busboy = Busboy({ headers: req.headers, limits: { fileSize: maxFileBytes, files: 1, fields: 20 } });
		const fields = {};
		const files = {};
		busboy.on("field", (name, value) => {
			fields[name] = value;
		});
		busboy.on("file", (name, file, info) => {
			const chunks = [];
			let total = 0;
			file.on("data", (data) => {
				total += data.length;
				chunks.push(data);
			});
			file.on("limit", () => reject(new Error("File too large")));
			file.on("end", () => {
				if (total > 0) {
					files[name] = { buffer: Buffer.concat(chunks), mimeType: info?.mimeType || "application/octet-stream" };
				}
			});
		});
		busboy.on("error", reject);
		busboy.on("finish", () => resolve({ fields, files }));
		req.pipe(busboy);
	});
}

export default function createCreateRoutes({ queries, storage }) {
	const router = express.Router();
	// Serve created images statically (for filesystem-based adapters)
	// This will be used as fallback for filesystem adapters
	const imagesDir = path.join(__dirname, "..", "db", "data", "images", "created");
	router.use("/images/created", express.static(imagesDir));

	// GET /api/images/created/* - Serve image through backend
	// This route handles images from Supabase Storage and provides authorization.
	// Supports nested paths like "landscape/USERID_IMAGEID_timestamp_random.png".
	router.get("/api/images/created/*", async (req, res) => {
		const filename = req.params[0] || "";
		const variant = req.query?.variant;

		try {
			let image = null;

			// Landscape files are stored under "landscape/{userId}_{imageId}_{ts}_{rand}.png"
			// They don't have their own created_images row, so we derive imageId from the filename
			// and look up the original creation.
			if (filename.startsWith("landscape/")) {
				const afterPrefix = filename.slice("landscape/".length);
				const baseName = afterPrefix.split("/").pop() || "";
				const withoutExt = baseName.replace(/\.[^.]+$/, "");
				const parts = withoutExt.split("_");
				const imageId = Number(parts[1]); // landscape/{userId}_{imageId}_{timestamp}_{random}.png

				if (!Number.isFinite(imageId) || imageId <= 0) {
					return res.status(404).json({ error: "Image not found" });
				}

				image = await queries.selectCreatedImageByIdAnyUser?.get(imageId);
			} else {
				// Main created image: look up by filename column
				image = await queries.selectCreatedImageByFilename?.get(filename);
			}

			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			// Check access: user owns the image OR image is published OR user is admin
			const userId = req.auth?.userId;
			const isOwner = userId && image.user_id === userId;
			const isPublished = image.published === 1 || image.published === true;

			// Get user to check admin role
			let isAdmin = false;
			if (userId && !isOwner && !isPublished) {
				try {
					const user = await queries.selectUserById.get(userId);
					isAdmin = user?.role === 'admin';
				} catch {
					// ignore errors checking user
				}
			}

			if (!isOwner && !isPublished && !isAdmin) {
				return res.status(403).json({ error: "Access denied" });
			}

			// Fetch image buffer from storage
			const imageBuffer = await storage.getImageBuffer(filename, { variant });
			const png = await ensurePngBuffer(imageBuffer);

			// Set appropriate content type
			res.setHeader('Content-Type', 'image/png');
			res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
			res.send(png);
		} catch (error) {
			// console.error("Error serving image:", error);
			if (error.message && error.message.includes("not found")) {
				return res.status(404).json({ error: "Image not found" });
			}
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	async function requireUser(req, res) {
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

	function parseMeta(raw) {
		if (raw == null) return null;
		if (typeof raw === "object") return raw;
		if (typeof raw !== "string") return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}

	/** Only true when the provider/error message text explicitly indicates moderation. */
	function isModeratedError(status, meta) {
		if (status !== "failed" || meta == null) return false;
		try {
			const parts = [];
			if (typeof meta.error === "string" && meta.error.trim()) parts.push(meta.error.trim());
			const pe = meta.provider_error;
			if (pe != null && typeof pe === "object" && pe.body != null) {
				const b = pe.body;
				if (typeof b === "string") parts.push(b.trim());
				else if (typeof b === "object") {
					if (typeof b.error === "string" && b.error.trim()) parts.push(b.error.trim());
					else if (typeof b.message === "string" && b.message.trim()) parts.push(b.message.trim());
				}
			}
			const errorText = parts.join(" ").toLowerCase();
			return errorText.length > 0 && errorText.includes("moderated");
		} catch {
			return false;
		}
	}

	function nowIso() {
		return new Date().toISOString();
	}

	// Provider must fetch image URLs; it cannot access localhost. Always use production host (https://www.parascene.com or APP_ORIGIN).
	const providerBase = getBaseAppUrlForEmail();

	function toParasceneImageUrl(raw) {
		const base = providerBase;
		if (typeof raw !== "string") return null;
		const value = raw.trim();
		if (!value) return null;
		try {
			const parsed = new URL(value, base);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
			return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
		} catch {
			return null;
		}
	}

	/** Build share-page image URL (no auth) for provider. Returns null if mint fails. */
	function shareUrlForImage(imageId, sharedByUserId) {
		const id = Number(imageId);
		const uid = Number(sharedByUserId);
		if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(uid) || uid <= 0) return null;
		try {
			const token = mintShareToken({
				version: ACTIVE_SHARE_VERSION,
				imageId: id,
				sharedByUserId: uid
			});
			return `${providerBase}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/image`;
		} catch {
			return null;
		}
	}

	// Data Builder option keys (boolean flags). Other keys (e.g. prompt) are passed through to the provider.
	const ADVANCED_DATA_BUILDER_KEYS = ["recent_comments", "recent_posts", "top_likes", "bottom_likes", "most_mutated"];

	function getAdvancedExtraArgs(args) {
		if (!args || typeof args !== "object") return {};
		const extra = {};
		for (const [k, v] of Object.entries(args)) {
			if (ADVANCED_DATA_BUILDER_KEYS.includes(k)) continue;
			extra[k] = v;
		}
		return extra;
	}

	/** Build creation_meta subset for provider: inputs, how the image was created, and lineage (args, method_name, server_name, history, mutate_of_id). */
	function buildCreationMetaSubset(meta) {
		const m = parseMeta(meta);
		if (!m || typeof m !== "object") return null;
		const out = {};
		if (m.args != null && typeof m.args === "object" && !Array.isArray(m.args)) {
			out.args = m.args;
		}
		if (typeof m.method_name === "string" && m.method_name.trim()) {
			out.method_name = m.method_name.trim();
		}
		if (typeof m.server_name === "string" && m.server_name.trim()) {
			out.server_name = m.server_name.trim();
		}
		if (Array.isArray(m.history) && m.history.length > 0) {
			out.history = m.history.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
		}
		if (m.mutate_of_id != null && Number.isFinite(Number(m.mutate_of_id)) && Number(m.mutate_of_id) > 0) {
			out.mutate_of_id = Number(m.mutate_of_id);
		}
		return Object.keys(out).length === 0 ? null : out;
	}

	// Build balanced items array (up to 100) from boolean Data Builder options. Used by query and create.
	async function buildAdvancedItems(userId, options) {
		const recent_comments = options?.recent_comments === true;
		const recent_posts = options?.recent_posts === true;
		const top_likes = options?.top_likes === true;
		const bottom_likes = options?.bottom_likes === true;
		const most_mutated = options?.most_mutated === true;
		const selectedOptions = [recent_comments && 'recent_comments', recent_posts && 'recent_posts', top_likes && 'top_likes', bottom_likes && 'bottom_likes', most_mutated && 'most_mutated'].filter(Boolean);
		if (selectedOptions.length === 0) return [];
		const MAX_ITEMS = 100;
		const perOptionLimit = Math.floor(MAX_ITEMS / selectedOptions.length);
		const items = [];

		if (recent_comments && queries.selectLatestCreatedImageComments?.all) {
			const comments = await queries.selectLatestCreatedImageComments.all({ limit: perOptionLimit });
			for (const comment of (comments || []).slice(0, perOptionLimit)) {
				const imageId = comment?.created_image_id || null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'comment',
					source: 'recent_comments',
					id: comment?.id,
					text: comment?.text || '',
					created_at: comment?.created_at,
					author: comment?.user_name || comment?.display_name || null,
					image_url: imageUrl,
					image_id: imageId,
					image_title: comment?.created_image_title || null
				});
			}
		}
		if (recent_posts && queries.selectNewestPublishedFeedItems?.all) {
			const feedItems = await queries.selectNewestPublishedFeedItems.all(userId);
			for (const item of (feedItems || []).slice(0, perOptionLimit)) {
				const imageId = item?.created_image_id || null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'post',
					source: 'recent_posts',
					id: item?.id,
					title: item?.title || '',
					summary: item?.summary || '',
					created_at: item?.created_at,
					author: item?.author_display_name || item?.author_user_name || item?.author || null,
					image_url: imageUrl,
					image_id: imageId,
					like_count: Number(item?.like_count || 0),
					comment_count: Number(item?.comment_count || 0)
				});
			}
		}
		if (top_likes && queries.selectNewestPublishedFeedItems?.all) {
			const feedItems = await queries.selectNewestPublishedFeedItems.all(userId) || [];
			const sorted = [...feedItems].filter(i => i?.like_count !== undefined).sort((a, b) => Number(b?.like_count || 0) - Number(a?.like_count || 0)).slice(0, perOptionLimit);
			for (const item of sorted) {
				const imageId = item?.created_image_id || item?.id || null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'image',
					source: 'top_likes',
					id: imageId,
					title: item?.title || '',
					summary: item?.summary || '',
					created_at: item?.created_at,
					author: item?.author_display_name || item?.author_user_name || item?.author || null,
					image_url: imageUrl,
					like_count: Number(item?.like_count || 0),
					comment_count: Number(item?.comment_count || 0)
				});
			}
		}
		if (bottom_likes && queries.selectNewestPublishedFeedItems?.all) {
			const feedItems = await queries.selectNewestPublishedFeedItems.all(userId) || [];
			const sorted = [...feedItems].filter(i => i?.like_count !== undefined).sort((a, b) => Number(a?.like_count || 0) - Number(b?.like_count || 0)).slice(0, perOptionLimit);
			for (const item of sorted) {
				const imageId = item?.created_image_id || item?.id || null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'image',
					source: 'bottom_likes',
					id: imageId,
					title: item?.title || '',
					summary: item?.summary || '',
					created_at: item?.created_at,
					author: item?.author_display_name || item?.author_user_name || item?.author || null,
					image_url: imageUrl,
					like_count: Number(item?.like_count || 0),
					comment_count: Number(item?.comment_count || 0)
				});
			}
		}
		if (most_mutated && queries.selectAllCreatedImageIdAndMeta?.all && queries.selectFeedItemsByCreationIds?.all) {
			const idMetaRows = await queries.selectAllCreatedImageIdAndMeta.all().catch(() => []) ?? [];
			const countById = new Map();
			function toHistoryArray(raw) {
				const h = raw?.history;
				if (Array.isArray(h)) return h;
				if (typeof h === "string") {
					try { const a = JSON.parse(h); return Array.isArray(a) ? a : []; } catch { return []; }
				}
				return [];
			}
			for (const row of idMetaRows) {
				const meta = parseMeta(row?.meta);
				if (!meta || typeof meta !== "object") continue;
				const history = toHistoryArray(meta);
				for (const v of history) {
					const id = v != null ? Number(v) : NaN;
					if (!Number.isFinite(id) || id <= 0) continue;
					countById.set(id, (countById.get(id) ?? 0) + 1);
				}
				const mid = meta.mutate_of_id != null ? Number(meta.mutate_of_id) : NaN;
				if (Number.isFinite(mid) && mid > 0) countById.set(mid, (countById.get(mid) ?? 0) + 1);
			}
			const topIds = [...countById.entries()]
				.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
				.slice(0, perOptionLimit)
				.map(([id]) => id);
			const feedItems = topIds.length > 0
				? (await queries.selectFeedItemsByCreationIds.all(topIds).catch(() => []) ?? [])
				: [];
			for (const item of feedItems.slice(0, perOptionLimit)) {
				const imageId = item?.created_image_id ?? item?.id ?? null;
				const imageUrl = shareUrlForImage(imageId, userId) ?? null;
				items.push({
					type: 'image',
					source: 'most_mutated',
					id: imageId,
					title: item?.title || '',
					summary: item?.summary || '',
					created_at: item?.created_at,
					author: item?.author_display_name || item?.author_user_name || item?.author || null,
					image_url: imageUrl,
					like_count: Number(item?.like_count || 0),
					comment_count: Number(item?.comment_count || 0)
				});
			}
		}

		const trimmed = items.slice(0, MAX_ITEMS);
		const imageIds = [...new Set(
			trimmed
				.map((it) => it.image_id != null ? it.image_id : it.id)
				.filter((id) => id != null && Number.isFinite(Number(id)) && Number(id) > 0)
		)];
		if (imageIds.length === 0) return trimmed;

		const descriptionAndMetaRows = await queries.selectCreatedImageDescriptionAndMetaByIds?.all(imageIds).catch(() => []) ?? [];
		const byId = new Map();
		for (const row of descriptionAndMetaRows) {
			const id = row?.id != null ? Number(row.id) : null;
			if (id == null || !Number.isFinite(id)) continue;
			const description = typeof row.description === "string" ? row.description.trim() || null : null;
			const creation_meta = buildCreationMetaSubset(row.meta);
			byId.set(id, { description, creation_meta });
		}

		for (const it of trimmed) {
			const imageId = it.image_id != null ? it.image_id : it.id;
			const id = imageId != null ? Number(imageId) : null;
			if (id == null) continue;
			const info = byId.get(id);
			if (info) {
				if (info.description != null) it.description = info.description;
				if (info.creation_meta != null) it.creation_meta = info.creation_meta;
			}
		}

		return trimmed;
	}

	// POST /api/create/preview - Return the exact payload that would be sent to the provider (no provider call, no charge)
	router.post("/api/create/preview", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		// Accept args from req.body.args or, if missing, from req.body (so clients can send { most_mutated: true } or { args: { most_mutated: true } })
		const raw = (req.body && typeof req.body === "object" && req.body.args != null && typeof req.body.args === "object")
			? req.body.args
			: (req.body && typeof req.body === "object" ? req.body : {});
		const safeArgs = { ...raw };
		// Normalize Data Builder booleans so string "true" is treated as true
		for (const k of ADVANCED_DATA_BUILDER_KEYS) {
			if (safeArgs[k] === "true" || safeArgs[k] === true) safeArgs[k] = true;
			else if (safeArgs[k] === "false" || safeArgs[k] === false) safeArgs[k] = false;
		}

		try {
			const items = await buildAdvancedItems(user.id, safeArgs);
			const extraArgs = getAdvancedExtraArgs(safeArgs);
			const providerArgs = { items, ...extraArgs };
			const payload = { method: "advanced_query", args: providerArgs };
			return res.json({ payload });
		} catch (err) {
			return res.status(500).json({
				error: "Preview failed",
				message: err?.message || "Failed to build payload"
			});
		}
	});

	// POST /api/create/query - Query server for advanced create support and cost (no charge, no DB write)
	router.post("/api/create/query", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const { server_id, args } = req.body;
		const safeArgs = args && typeof args === "object" ? { ...args } : {};

		if (!server_id) {
			return res.status(400).json({ error: "Missing required fields", message: "server_id is required" });
		}

		try {
			const server = await queries.selectServerById.get(server_id);
			if (!server) return res.status(404).json({ error: "Server not found" });
			if (server.status !== "active") return res.status(400).json({ error: "Server is not active" });

			// Backend builds items from boolean args and sends that to the provider; include extra args (e.g. prompt)
			const items = await buildAdvancedItems(user.id, safeArgs);
			const extraArgs = getAdvancedExtraArgs(safeArgs);
			const providerArgs = { items, ...extraArgs };

			const providerResponse = await fetch(server.server_url, {
				method: "POST",
				headers: buildProviderHeaders(
					{ "Content-Type": "application/json", Accept: "application/json" },
					server.auth_token
				),
				body: JSON.stringify({ method: "advanced_query", args: providerArgs }),
				signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
			});

			const contentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
			let body = null;
			if (contentType.includes("application/json")) {
				body = await providerResponse.json().catch(() => null);
			} else {
				const text = await providerResponse.text().catch(() => "");
				return res.status(502).json({
					error: "Invalid provider response",
					message: "Server did not return JSON"
				});
			}

			if (!providerResponse.ok) {
				return res.status(502).json({
					error: "Provider error",
					message: body?.error || body?.message || providerResponse.statusText,
					provider: body
				});
			}

			return res.json(body);
		} catch (err) {
			if (err?.name === "AbortError") {
				return res.status(504).json({ error: "Timeout", message: "Server did not respond in time" });
			}
			return res.status(500).json({
				error: "Query failed",
				message: err?.message || "Failed to query server"
			});
		}
	});

	// POST /api/create/landscape/query - Query cost for landscape (outpaint) for a creation. Owner only.
	router.post("/api/create/landscape/query", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const creation_id = req.body?.creation_id;
		if (!creation_id) {
			return res.status(400).json({ error: "Missing required fields", message: "creation_id is required" });
		}

		const creationId = Number(creation_id);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creation_id" });
		}

		const image = await queries.selectCreatedImageById.get(creationId, user.id);
		if (!image) {
			return res.status(404).json({ error: "Creation not found" });
		}
		if (image.status !== "completed" || !image.filename) {
			return res.status(400).json({ error: "Creation is not ready for landscape" });
		}

		let server = null;
		const meta = parseMeta(image.meta) || {};
		if (meta.server_id && Number.isFinite(Number(meta.server_id))) {
			server = await queries.selectServerById.get(Number(meta.server_id));
		}
		if (!server || server.status !== "active") {
			const allServers = (await queries.selectServers?.all?.()) ?? [];
			server = allServers.find((s) => s.status === "active") ?? null;
		}
		if (!server) {
			return res.status(400).json({ error: "No server available", message: "No active server available for landscape." });
		}

		const imageUrl = shareUrlForImage(creationId, user.id);
		if (!imageUrl) {
			return res.status(500).json({ error: "Failed to build image URL", message: "Could not generate share URL for provider." });
		}

		try {
			const providerArgs = { operation: "outpaint", image_url: imageUrl };
			const providerResponse = await fetch(server.server_url, {
				method: "POST",
				headers: buildProviderHeaders(
					{ "Content-Type": "application/json", Accept: "application/json" },
					server.auth_token
				),
				body: JSON.stringify({ method: "advanced_query", args: providerArgs }),
				signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
			});

			const contentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
			let body = null;
			if (contentType.includes("application/json")) {
				body = await providerResponse.json().catch(() => null);
			} else {
				const text = await providerResponse.text().catch(() => "");
				return res.status(502).json({
					error: "Invalid provider response",
					message: "Server did not return JSON"
				});
			}

			if (!providerResponse.ok) {
				return res.status(502).json({
					error: "Provider error",
					message: body?.error || body?.message || providerResponse.statusText,
					provider: body
				});
			}

			return res.json(body);
		} catch (err) {
			if (err?.name === "AbortError") {
				return res.status(504).json({ error: "Timeout", message: "Server did not respond in time" });
			}
			return res.status(500).json({
				error: "Landscape query failed",
				message: err?.message || "Failed to query server"
			});
		}
	});

	// POST /api/create/landscape - Start landscape (outpaint) job. Owner only. Deducts credits, sets meta.landscapeUrl = "loading", enqueues job.
	router.post("/api/create/landscape", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const creation_id = req.body?.creation_id;
		const credit_cost = req.body?.credit_cost;
		if (!creation_id) {
			return res.status(400).json({ error: "Missing required fields", message: "creation_id is required" });
		}
		if (typeof credit_cost !== "number" || !Number.isFinite(credit_cost) || credit_cost <= 0) {
			return res.status(400).json({ error: "Missing required fields", message: "credit_cost is required and must be a positive number" });
		}

		const creationId = Number(creation_id);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creation_id" });
		}

		const image = await queries.selectCreatedImageById.get(creationId, user.id);
		if (!image) {
			return res.status(404).json({ error: "Creation not found" });
		}
		if (image.status !== "completed" || !image.filename) {
			return res.status(400).json({ error: "Creation is not ready for landscape" });
		}

		const existingMeta = parseMeta(image.meta) || {};
		if (existingMeta.landscapeUrl === "loading") {
			return res.status(409).json({ error: "Landscape in progress", message: "A landscape is already being generated." });
		}

		let server = null;
		if (existingMeta.server_id && Number.isFinite(Number(existingMeta.server_id))) {
			server = await queries.selectServerById.get(Number(existingMeta.server_id));
		}
		if (!server || server.status !== "active") {
			const allServers = (await queries.selectServers?.all?.()) ?? [];
			server = allServers.find((s) => s.status === "active") ?? null;
		}
		if (!server) {
			return res.status(400).json({ error: "No server available", message: "No active server available for landscape." });
		}

		const imageUrl = shareUrlForImage(creationId, user.id);
		if (!imageUrl) {
			return res.status(500).json({ error: "Failed to build image URL", message: "Could not generate share URL for provider." });
		}

		let credits = await queries.selectUserCredits.get(user.id);
		if (!credits) {
			await queries.insertUserCredits.run(user.id, 100, null);
			credits = await queries.selectUserCredits.get(user.id);
		}
		if (!credits || credits.balance < credit_cost) {
			return res.status(402).json({
				error: "Insufficient credits",
				message: `Landscape requires ${credit_cost} credits. You have ${credits?.balance ?? 0} credits.`,
				required: credit_cost,
				current: credits?.balance ?? 0
			});
		}

		const nextMeta = { ...existingMeta, landscapeUrl: "loading" };
		await queries.updateCreatedImageMeta.run(creationId, user.id, nextMeta);
		await queries.updateUserCreditsBalance.run(user.id, -credit_cost);

		await scheduleLandscapeJob({
			payload: {
				created_image_id: creationId,
				user_id: user.id,
				server_id: server.id,
				image_url: imageUrl,
				credit_cost
			},
			runLandscapeJob: ({ payload }) => runLandscapeJob({ queries, storage, payload })
		});

		const updatedCredits = await queries.selectUserCredits.get(user.id);
		return res.json({
			ok: true,
			credits_remaining: updatedCredits?.balance ?? credits?.balance ?? 0
		});
	});

	router.post("/api/create/validate", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const rawArgs = req.body && typeof req.body === "object"
				? (req.body.args && typeof req.body.args === "object" ? req.body.args : req.body)
				: {};
			const prompt = typeof rawArgs?.prompt === "string" ? rawArgs.prompt : "";

			const normalizeUsername = (input) => {
				const raw = typeof input === "string" ? input.trim() : "";
				if (!raw) return null;
				const normalized = raw.toLowerCase();
				if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
				return normalized;
			};

			const mentions = [];
			const seen = new Set();
			const re = /@([a-zA-Z0-9_]+)/g;
			let match;
			while ((match = re.exec(prompt)) !== null) {
				const token = match[1] || "";
				const originalMention = `@${token}`;
				const normalized = normalizeUsername(token);
				const key = normalized ? `@${normalized}` : originalMention;
				if (seen.has(key)) continue;
				seen.add(key);
				mentions.push({ originalMention, normalized });
			}

			// No mentions: treat as valid.
			if (mentions.length === 0) {
				return res.json({
					ok: true,
					valid: true,
					failed_mentions: []
				});
			}

			const failed_mentions = [];
			for (const m of mentions) {
				if (!m.normalized) {
					failed_mentions.push({ mention: m.originalMention, reason: "invalid_username" });
					continue;
				}
				if (!queries.selectUserProfileByUsername?.get) {
					failed_mentions.push({ mention: `@${m.normalized}`, reason: "profiles_unavailable" });
					continue;
				}
				const profile = await queries.selectUserProfileByUsername.get(m.normalized);
				if (!profile) {
					failed_mentions.push({ mention: `@${m.normalized}`, reason: "user_not_found" });
					continue;
				}
				const meta = parseMeta(profile.meta) || {};
				const cd = typeof meta.character_description === "string" ? meta.character_description.trim() : "";
				if (!cd) {
					failed_mentions.push({ mention: `@${m.normalized}`, reason: "no_character_description" });
				}
			}

			if (failed_mentions.length > 0) {
				const parts = failed_mentions.map((f) => `${f.mention} (${f.reason})`).join(", ");
				return res.status(400).json({
					error: "Invalid mentions",
					message: `Character could not be found for: ${parts}.`,
					failed_mentions
				});
			}

			return res.json({
				ok: true,
				valid: true,
				failed_mentions: []
			});
		} catch {
			return res.status(500).json({
				error: "Validation failed",
				message: "Validation endpoint encountered an unexpected error."
			});
		}
	});

	// POST /api/create - Create a new image (accepts JSON or multipart with optional image_file)
	router.post("/api/create", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		if (req.is("multipart/form-data")) {
			try {
				const { fields, files } = await parseMultipartCreate(req);
				const args = typeof fields.args === "string" ? (() => {
					try {
						return JSON.parse(fields.args);
					} catch {
						return {};
					}
				})() : (fields.args && typeof fields.args === "object" ? fields.args : {});
				if (files.image_file?.buffer) {
					let imgBuf = files.image_file.buffer;
					const meta = await sharp(imgBuf).metadata();
					if (
						typeof meta.width === "number" &&
						typeof meta.height === "number" &&
						(meta.width !== 1024 || meta.height !== 1024)
					) {
						imgBuf = await sharp(imgBuf)
							.resize(1024, 1024, { fit: "cover", position: "entropy" })
							.png()
							.toBuffer();
					} else {
						imgBuf = await sharp(imgBuf).png().toBuffer();
					}
					const now = Date.now();
					const rand = Math.random().toString(36).slice(2, 9);
					const userPart = String(user.id).replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
					const key = `edited/${userPart}/${now}_${rand}.png`;
					if (storage?.uploadGenericImage) {
						await storage.uploadGenericImage(imgBuf, key, { contentType: "image/png" });
						args.image_url = buildGenericUrl(key);
					}
				}
				req.body = {
					server_id: fields.server_id,
					method: fields.method,
					args,
					creation_token: fields.creation_token,
					retry_of_id: fields.retry_of_id,
					mutate_of_id: fields.mutate_of_id,
					credit_cost: fields.credit_cost,
					hydrate_mentions: fields.hydrate_mentions,
					style_key: fields.style_key
				};
			} catch (err) {
				if (err?.code === "FILE_TOO_LARGE" || err?.message === "File too large") {
					return res.status(413).json({ error: "Image too large" });
				}
				return res.status(400).json({ error: "Invalid multipart body", message: err?.message || "Bad request" });
			}
		}

		const { server_id, method, args, creation_token, retry_of_id, mutate_of_id, credit_cost: bodyCreditCost, hydrate_mentions, style_key } = req.body;
		const safeArgs = args && typeof args === "object" ? { ...args } : {};
		const hydrateMentions = hydrate_mentions === true || hydrate_mentions === "true" || hydrate_mentions === 1 || hydrate_mentions === "1";

		// Validate required fields
		if (!server_id || !method) {
			return res.status(400).json({
				error: "Missing required fields",
				message: "server_id and method are required"
			});
		}

		if (typeof creation_token !== "string" || creation_token.trim().length < 10) {
			return res.status(400).json({
				error: "Missing required fields",
				message: "creation_token is required"
			});
		}

		try {
			// Fetch server
			const server = await queries.selectServerById.get(server_id);
			if (!server) {
				return res.status(404).json({ error: "Server not found" });
			}

			if (server.status !== 'active') {
				return res.status(400).json({ error: "Server is not active" });
			}

			const isAdvancedGenerate = method === "advanced_generate";
			let methodConfig = null;
			let CREATION_CREDIT_COST = 0.5;
			let argsForProvider = safeArgs;
			// For advanced_generate, backend builds items from boolean args; we store/send { items, ...extra } to provider
			if (isAdvancedGenerate) {
				const cost = Number(bodyCreditCost);
				if (!Number.isFinite(cost) || cost <= 0) {
					return res.status(400).json({
						error: "Missing required fields",
						message: "credit_cost is required for advanced_generate and must be a positive number"
					});
				}
				CREATION_CREDIT_COST = cost;
				methodConfig = { name: "Advanced generate", credits: cost };
				const items = await buildAdvancedItems(user.id, safeArgs);
				const extraArgs = getAdvancedExtraArgs(safeArgs);
				argsForProvider = { items, ...extraArgs };
			} else {
				// Parse server_config and validate method
				if (!server.server_config || !server.server_config.methods) {
					return res.status(400).json({ error: "Server configuration is invalid" });
				}
				methodConfig = server.server_config.methods[method];
				if (!methodConfig) {
					return res.status(400).json({
						error: "Method not available",
						message: `Method "${method}" is not available on this server`,
						available_methods: Object.keys(server.server_config.methods)
					});
				}
				CREATION_CREDIT_COST = methodConfig.credits ?? 0.5;
			}

			// Keep a stable copy of args for storage (meta.args) separate from any provider-only transformations.
			argsForProvider = argsForProvider && typeof argsForProvider === "object" ? { ...argsForProvider } : {};

			// Apply style transformation when style_key is provided (create.html flow). Store style + raw user prompt in meta.
			let styleForMeta = null;
			let userPromptForMeta = null;
			if (style_key && typeof style_key === "string" && !isAdvancedGenerate) {
				const styleInfo = getStyleInfo(style_key.trim());
				if (styleInfo) {
					styleForMeta = { key: styleInfo.key, label: styleInfo.label, modifiers: styleInfo.modifiers };
					if (styleInfo.modifiers && typeof argsForProvider.prompt === "string") {
						const userPrompt = argsForProvider.prompt.trim();
						if (userPrompt) {
							userPromptForMeta = userPrompt;
							argsForProvider.prompt = `# style\n${styleInfo.modifiers}\n\n# prompt\n${userPrompt}`;
						}
					}
				}
			}

			// Provider must fetch image_url; relative paths fail. Normalize to absolute URL.
			if (typeof argsForProvider.image_url === "string") {
				const absolute = toParasceneImageUrl(argsForProvider.image_url);
				if (absolute) argsForProvider.image_url = absolute;
			}

			// Check user's credit balance
			let credits = await queries.selectUserCredits.get(user.id);

			// Initialize credits if record doesn't exist
			if (!credits) {
				await queries.insertUserCredits.run(user.id, 100, null);
				credits = await queries.selectUserCredits.get(user.id);
			}

			// Check if user has sufficient credits
			if (!credits || credits.balance < CREATION_CREDIT_COST) {
				return res.status(402).json({
					error: "Insufficient credits",
					message: `Creation requires ${CREATION_CREDIT_COST} credits. You have ${credits?.balance ?? 0} credits.`,
					required: CREATION_CREDIT_COST,
					current: credits?.balance ?? 0
				});
			}

			const started_at = nowIso();
			const timeout_at = new Date(Date.now() + PROVIDER_TIMEOUT_MS + 2000).toISOString();
			const placeholderFilename = `creating_${user.id}_${Date.now()}.png`;
			const meta = {
				creation_token: creation_token.trim(),
				server_id: Number(server_id),
				server_name: typeof server.name === "string" ? server.name : null,
				server_url: server.server_url,
				method,
				method_name: typeof methodConfig.name === "string" && methodConfig.name.trim()
					? methodConfig.name.trim()
					: null,
				args: argsForProvider,
				started_at,
				timeout_at,
				credit_cost: CREATION_CREDIT_COST,
				...(styleForMeta ? { style: styleForMeta } : {}),
				...(userPromptForMeta != null ? { user_prompt: userPromptForMeta } : {}),
			};

			// Mutate lineage: create/extend meta.history
			if (mutate_of_id != null && Number.isFinite(Number(mutate_of_id))) {
				const sourceId = Number(mutate_of_id);

				let source = await queries.selectCreatedImageById.get(sourceId, user.id);
				if (!source) {
					const any = await queries.selectCreatedImageByIdAnyUser?.get(sourceId);
					if (any) {
						const isPublished = any.published === 1 || any.published === true;
						const isAdmin = user.role === 'admin';
						if (isPublished || isAdmin) {
							source = any;
						}
					}
				}

				if (!source) {
					return res.status(404).json({ error: "Image not found" });
				}

				const sourceMeta = parseMeta(source.meta) || {};
				const prior = Array.isArray(sourceMeta.history) ? sourceMeta.history : null;
				const priorIds = Array.isArray(prior)
					? prior.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
					: [];
				meta.history = [...priorIds, sourceId];
				meta.mutate_of_id = sourceId;

				// Normalize image_url for mutate flows only.
				if (typeof safeArgs.image_url === "string") {
					const normalized = toParasceneImageUrl(safeArgs.image_url);
					if (normalized) {
						safeArgs.image_url = normalized;
						meta.args.image_url = normalized;
					}
				}

				// Unpublished sources: provider cannot use /api/images/created/:filename (403).
				// Use share URL so provider can fetch without auth.
				const sourcePublished = source.published === 1 || source.published === true;
				if (!sourcePublished && source.status === "completed" && source.filename) {
					try {
						const token = mintShareToken({
							version: ACTIVE_SHARE_VERSION,
							imageId: source.id,
							sharedByUserId: user.id
						});
						const shareUrl = `${providerBase}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/image`;
						safeArgs.image_url = shareUrl;
						meta.args.image_url = shareUrl;
					} catch {
						// If mint fails, keep existing image_url; provider may 403 for unpublished
					}
				}
			}

			const normalizeUsername = (input) => {
				const raw = typeof input === "string" ? input.trim() : "";
				if (!raw) return null;
				const normalized = raw.toLowerCase();
				if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
				return normalized;
			};

			const extractMentions = (text) => {
				const out = [];
				const seen = new Set();
				const re = /@([a-zA-Z0-9_]+)/g;
				let match;
				while ((match = re.exec(text || "")) !== null) {
					const token = match[1] || "";
					const originalMention = `@${token}`;
					const normalized = normalizeUsername(token);
					const key = normalized ? `@${normalized}` : originalMention;
					if (seen.has(key)) continue;
					seen.add(key);
					out.push({ originalMention, normalized });
				}
				return out;
			};

			const hydrateMentionsToCast = async (promptText) => {
				const cast = {};
				const failed_mentions = [];
				const promptStr = typeof promptText === "string" ? promptText : "";
				const mentions = extractMentions(promptStr);
				if (mentions.length === 0) return { cast, failed_mentions, mentions };

				for (const m of mentions) {
					if (!m.normalized) {
						failed_mentions.push({ mention: m.originalMention, reason: "invalid_username" });
						continue;
					}
					if (!queries.selectUserProfileByUsername?.get) {
						failed_mentions.push({ mention: `@${m.normalized}`, reason: "profiles_unavailable" });
						continue;
					}
					const profile = await queries.selectUserProfileByUsername.get(m.normalized);
					if (!profile) {
						failed_mentions.push({ mention: `@${m.normalized}`, reason: "user_not_found" });
						continue;
					}
					const meta = parseMeta(profile.meta) || {};
					const cd = typeof meta.character_description === "string" ? meta.character_description.trim() : "";
					if (!cd) {
						failed_mentions.push({ mention: `@${m.normalized}`, reason: "no_character_description" });
						continue;
					}
					cast[`@${m.normalized}`] = cd;
				}

				return { cast, failed_mentions, mentions };
			};

			// Retry in place: reuse the same creation row instead of inserting a new one
			if (retry_of_id != null && Number.isFinite(Number(retry_of_id))) {
				const existingId = Number(retry_of_id);
				const image = await queries.selectCreatedImageById.get(existingId, user.id);
				if (!image) {
					return res.status(404).json({ error: "Image not found" });
				}
				const status = image.status || "completed";
				if (status === "completed") {
					return res.status(400).json({
						error: "Cannot retry",
						message: "Only failed or timed-out creations can be retried"
					});
				}
				if (status === "creating") {
					const existingMeta = parseMeta(image.meta) || {};
					const timeoutAt = existingMeta.timeout_at ? new Date(existingMeta.timeout_at).getTime() : NaN;
					if (!Number.isFinite(timeoutAt) || Date.now() <= timeoutAt) {
						return res.status(400).json({
							error: "Cannot retry",
							message: "Creation is still in progress"
						});
					}
				}
				const existingMeta = parseMeta(image.meta) || {};
				// Preserve existing history on retries (including mutated creations).
				if (Array.isArray(existingMeta.history)) {
					meta.history = existingMeta.history;
				}

				let argsForJob = meta.args;
				if (hydrateMentions === true) {
					const promptText = typeof meta.args?.prompt === "string" ? meta.args.prompt : "";
					const { cast, failed_mentions } = await hydrateMentionsToCast(promptText);
					if (failed_mentions.length > 0) {
						const failedAt = nowIso();
						const nextMeta = {
							...meta,
							failed_at: failedAt,
							error_code: "hydrate_mentions_failed",
							error: "Unable to hydrate one or more mentioned users.",
							failed_mentions,
							hydrate_mentions: true
						};
						await queries.updateCreatedImageJobFailed.run(existingId, user.id, { meta: nextMeta });
						const updatedCredits = await queries.selectUserCredits.get(user.id);
						return res.json({
							id: existingId,
							status: "failed",
							created_at: started_at,
							meta: nextMeta,
							credits_remaining: updatedCredits?.balance ?? credits?.balance ?? 0
						});
					}
					if (Object.keys(cast).length > 0) {
						argsForJob = { ...meta.args, prompt: JSON.stringify({ cast, prompt: promptText }, null, 2) };
					}
				}

				// Refund previous attempt if it was never refunded (so we don't double-charge)
				if (existingMeta.credits_refunded !== true && Number(existingMeta.credit_cost) > 0) {
					await queries.updateUserCreditsBalance.run(user.id, Number(existingMeta.credit_cost));
				}
				await queries.updateUserCreditsBalance.run(user.id, -CREATION_CREDIT_COST);
				await queries.resetCreatedImageForRetry.run(existingId, user.id, {
					meta,
					filename: placeholderFilename
				});
				await scheduleCreationJob({
					payload: {
						created_image_id: existingId,
						user_id: user.id,
						server_id: Number(server_id),
						method,
						args: argsForJob,
						credit_cost: CREATION_CREDIT_COST,
					},
					runCreationJob: ({ payload }) => runCreationJob({ queries, storage, payload }),
				});
				const updatedCredits = await queries.selectUserCredits.get(user.id);
				return res.json({
					id: existingId,
					status: "creating",
					created_at: started_at,
					meta,
					credits_remaining: updatedCredits?.balance ?? 0
				});
			}

			// New creation: insert a durable row BEFORE provider call
			let argsForJob = meta.args;
			if (hydrateMentions === true) {
				const promptText = typeof meta.args?.prompt === "string" ? meta.args.prompt : "";
				const { cast, failed_mentions } = await hydrateMentionsToCast(promptText);
				if (failed_mentions.length > 0) {
					const failedAt = nowIso();
					const failedFilename = `failed_hydrate_${user.id}_${Date.now()}.png`;
					const nextMeta = {
						...meta,
						failed_at: failedAt,
						error_code: "hydrate_mentions_failed",
						error: "Unable to hydrate one or more mentioned users.",
						failed_mentions,
						hydrate_mentions: true
					};
					const result = await queries.insertCreatedImage.run(
						user.id,
						failedFilename,
						"", // file_path placeholder (schema requires non-null)
						1024,
						1024,
						null,
						"failed",
						nextMeta
					);
					const updatedCredits = await queries.selectUserCredits.get(user.id);
					return res.json({
						id: result.insertId,
						status: "failed",
						created_at: started_at,
						meta: nextMeta,
						credits_remaining: updatedCredits?.balance ?? credits?.balance ?? 0
					});
				}
				if (Object.keys(cast).length > 0) {
					argsForJob = { ...meta.args, prompt: JSON.stringify({ cast, prompt: promptText }, null, 2) };
				}
			}

			await queries.updateUserCreditsBalance.run(user.id, -CREATION_CREDIT_COST);

			const result = await queries.insertCreatedImage.run(
				user.id,
				placeholderFilename,
				"", // file_path placeholder (schema requires non-null)
				1024,
				1024,
				null,
				"creating",
				meta
			);

			const createdImageId = result.insertId;

			await scheduleCreationJob({
				payload: {
					created_image_id: createdImageId,
					user_id: user.id,
					server_id: Number(server_id),
					method,
					args: argsForJob,
					credit_cost: CREATION_CREDIT_COST,
				},
				runCreationJob: ({ payload }) => runCreationJob({ queries, storage, payload }),
			});

			const updatedCredits = await queries.selectUserCredits.get(user.id);

			return res.json({
				id: createdImageId,
				status: "creating",
				created_at: started_at,
				meta,
				credits_remaining: updatedCredits?.balance ?? 0
			});
		} catch (error) {
			// console.error("Error initiating image creation:", error);
			return res.status(500).json({ error: "Failed to initiate image creation", message: error.message });
		}
	});

	router.post("/api/create/worker", async (req, res) => {
		// Disable caching for this endpoint - QStash webhooks should never be cached
		res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");

		const logCreation = (...args) => {
			console.log("[Creation]", ...args);
		};
		const logCreationError = (...args) => {
			console.error("[Creation]", ...args);
		};

		try {
			logCreation("Worker endpoint called", {
				has_body: !!req.body,
				created_image_id: req.body?.created_image_id,
				user_id: req.body?.user_id,
				path: req.path,
				originalUrl: req.originalUrl,
				method: req.method
			});

			if (!process.env.UPSTASH_QSTASH_TOKEN) {
				logCreationError("QStash not configured");
				return res.status(503).json({ error: "QStash not configured" });
			}

			logCreation("Verifying QStash signature");
			const isValid = await verifyQStashRequest(req);
			if (!isValid) {
				logCreationError("Invalid QStash signature");
				return res.status(401).json({ error: "Invalid QStash signature" });
			}

			logCreation("QStash signature verified, running job");
			await runCreationJob({ queries, storage, payload: req.body });
			logCreation("Worker job completed successfully");
			return res.json({ ok: true });
		} catch (error) {
			logCreationError("Worker failed with error:", {
				error: error.message,
				stack: error.stack,
				name: error.name
			});
			console.error("Error running create worker:", error);
			return res.status(500).json({ ok: false, error: "Worker failed" });
		}
	});

	// GET /api/create/images - List images for user (paginated; supports limit & offset)
	router.get("/api/create/images", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
			const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
			const images = await queries.selectCreatedImagesForUser.all(user.id, { limit, offset });

			// Transform to include URLs (use file_path from DB which now contains the URL)
			const imagesWithUrls = images.map((img) => {
				const status = img.status || 'completed';
				const url = status === "completed" ? (img.file_path || storage.getImageUrl(img.filename)) : null;
				const meta = parseMeta(img.meta);
				return {
					id: img.id,
					filename: img.filename,
					url,
					thumbnail_url: url ? getThumbnailUrl(url) : null,
					width: img.width,
					height: img.height,
					color: img.color,
					status, // Default to completed for backward compatibility
					created_at: img.created_at,
					published: img.published === 1 || img.published === true,
					published_at: img.published_at || null,
					title: img.title || null,
					description: img.description || null,
					meta,
					is_moderated_error: isModeratedError(status, meta)
				};
			});

			const has_more = images.length === limit;
			return res.json({ images: imagesWithUrls, has_more });
		} catch (error) {
			// console.error("Error fetching images:", error);
			return res.status(500).json({ error: "Failed to fetch images" });
		}
	});

	// GET /api/create/images/:id - Get specific image metadata
	router.get("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			// First try to get as owner
			let image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			let shareAccess = null;

			// If not found as owner, check if it exists and is either published or user is admin
			if (!image) {
				const anyImage = await queries.selectCreatedImageByIdAnyUser.get(req.params.id);
				if (anyImage) {
					const isPublished = anyImage.published === 1 || anyImage.published === true;
					const isAdmin = user.role === 'admin';
					const isUnavailable = anyImage.unavailable_at != null && anyImage.unavailable_at !== "";
					// Optional: allow view-only access via external share token (for signed-in non-owners).
					if (!isPublished && !isAdmin) {
						let shareVersion = String(req.headers["x-share-version"] || "");
						let shareToken = String(req.headers["x-share-token"] || "");
						if (shareVersion && shareToken) {
							const verified = verifyShareToken({ version: shareVersion, token: shareToken });
							if (verified.ok && Number(verified.imageId) === Number(anyImage.id)) {
								const status = anyImage.status || "completed";
								if (status === "completed" && !isUnavailable) {
									shareAccess = { version: shareVersion, token: shareToken };
									image = anyImage;
								}
							}
						}
					}

					if (!image && (isPublished || isAdmin) && !isUnavailable) {
						image = anyImage;
					} else if (!image && isAdmin && isUnavailable) {
						image = anyImage;
					} else {
						if (!image) {
							return res.status(404).json({ error: "Image not found" });
						}
					}
				} else {
					return res.status(404).json({ error: "Image not found" });
				}
			}

			// Owner viewing their own image that they deleted: treat as not found
			const isOwner = image.user_id === user.id;
			const isAdmin = user.role === "admin";
			const isUnavailable = image.unavailable_at != null && image.unavailable_at !== "";
			if (isOwner && !isAdmin && isUnavailable) {
				return res.status(404).json({ error: "Image not found" });
			}

			// Get user information for the creator
			let creator = null;
			if (image.user_id) {
				creator = await queries.selectUserById.get(image.user_id);
			}
			const creatorProfile = image.user_id
				? await queries.selectUserProfileByUserId.get(image.user_id).catch(() => null)
				: null;

			const likeCountRow = await queries.selectCreatedImageLikeCount?.get(image.id);
			const likeCount = Number(likeCountRow?.like_count ?? 0);
			const viewerLikedRow = await queries.selectCreatedImageViewerLiked?.get(user.id, image.id);
			const viewerLiked = Boolean(viewerLikedRow?.viewer_liked);

			const isPublished = image.published === 1 || image.published === true;
			// Always read description from created_image, not from feed_item
			// (feed_item may be deleted when un-publishing)
			const description = typeof image.description === "string" ? image.description.trim() : "";
			const meta = parseMeta(image.meta);

			const status = image.status || 'completed';
			const url = status === "completed"
				? (shareAccess
					? `/api/share/${encodeURIComponent(shareAccess.version)}/${encodeURIComponent(shareAccess.token)}/image`
					: (image.file_path || storage.getImageUrl(image.filename)))
				: null;

			const response = {
				id: image.id,
				filename: image.filename,
				url, // Use stored URL or generate one
				width: image.width,
				height: image.height,
				color: image.color,
				status,
				created_at: image.created_at,
				published: isPublished,
				published_at: image.published_at || null,
				title: image.title || null,
				description: description || null,
				like_count: likeCount,
				viewer_liked: viewerLiked,
				user_id: image.user_id,
				meta,
				is_moderated_error: isModeratedError(status, meta),
				creator: creator ? {
					id: creator.id,
					email: creator.email,
					role: creator.role,
					user_name: creatorProfile?.user_name ?? null,
					display_name: creatorProfile?.display_name ?? null,
					avatar_url: creatorProfile?.avatar_url ?? null,
					plan: creator.meta?.plan === 'founder' ? 'founder' : 'free'
				} : null
			};
			if (isAdmin && isUnavailable) {
				response.user_deleted = true;
			}
			return res.json(response);
		} catch (error) {
			// console.error("Error fetching image:", error);
			return res.status(500).json({ error: "Failed to fetch image" });
		}
	});

	// GET /api/create/images/:id/children - Direct children (mutate_of_id = id), published only, order by created_at asc
	router.get("/api/create/images/:id/children", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const parentId = Number(req.params.id);
			if (!Number.isFinite(parentId) || parentId <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}
			const rows = await queries.selectCreatedImageChildrenByParentId?.all(parentId) ?? [];
			const children = rows.map((row) => {
				const status = row.status || "completed";
				const url =
					status === "completed"
						? (row.file_path || storage.getImageUrl(row.filename))
						: null;
				return {
					id: row.id,
					title: row.title ?? null,
					created_at: row.created_at,
					url: url || null,
					thumbnail_url: url ? getThumbnailUrl(url) : null
				};
			});
			return res.json(children);
		} catch (error) {
			return res.status(500).json({ error: "Failed to fetch children" });
		}
	});

	// POST /api/create/images/:id/share - Mint an external share URL (no DB write)
	router.post("/api/create/images/:id/share", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const id = Number(req.params.id);
			if (!Number.isFinite(id) || id <= 0) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			// First try as owner.
			let image = await queries.selectCreatedImageById?.get(id, user.id);

			// If not owner, allow if published or admin.
			if (!image) {
				const any = await queries.selectCreatedImageByIdAnyUser?.get(id);
				if (!any) {
					return res.status(404).json({ error: "Image not found" });
				}
				const isPublished = any.published === 1 || any.published === true;
				const isAdmin = user.role === "admin";
				if (!isPublished && !isAdmin) {
					return res.status(404).json({ error: "Image not found" });
				}
				image = any;
			}

			const status = image.status || "completed";
			if (status !== "completed") {
				return res.status(400).json({ error: "Only completed images can be shared" });
			}

			const token = mintShareToken({
				version: ACTIVE_SHARE_VERSION,
				imageId: id,
				sharedByUserId: Number(user.id)
			});
			const bust = Math.floor(Date.now() / 1000).toString(36);
			const base = getBaseAppUrl();
			const url = `${base}/s/${ACTIVE_SHARE_VERSION}/${token}/${bust}`;
			return res.json({ url });
		} catch (error) {
			return res.status(500).json({ error: "Failed to mint share link" });
		}
	});

	// POST /api/create/images/:id/retry - "Retry" means: mark stale creating as failed (no provider retry)
	router.post("/api/create/images/:id/retry", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const image = await queries.selectCreatedImageById.get(req.params.id, user.id);
			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}

			const meta = parseMeta(image.meta) || {};
			const status = image.status || "completed";
			const timeoutAt = meta?.timeout_at ? new Date(meta.timeout_at).getTime() : NaN;
			const isPastTimeout = Number.isFinite(timeoutAt) && Date.now() > timeoutAt;

			if (status === "completed") {
				return res.status(400).json({ error: "Cannot retry a completed image" });
			}

			if (status === "creating" && !isPastTimeout) {
				return res.status(400).json({ error: "Creation is still in progress" });
			}

			const nextMeta = {
				...meta,
				failed_at: nowIso(),
				error_code: meta?.error_code || (status === "creating" ? "timeout" : "provider_error"),
				error: meta?.error || (status === "creating" ? "Timed out" : "Failed"),
			};

			await queries.updateCreatedImageJobFailed.run(Number(req.params.id), user.id, { meta: nextMeta });

			// If it was stuck creating and credits were never refunded, refund once.
			const creditCost = Number(nextMeta?.credit_cost ?? 0);
			if (status === "creating" && creditCost > 0 && nextMeta.credits_refunded !== true) {
				await queries.updateUserCreditsBalance.run(user.id, creditCost);
				await queries.updateCreatedImageJobFailed.run(Number(req.params.id), user.id, {
					meta: { ...nextMeta, credits_refunded: true }
				});
			}

			return res.json({ ok: true });
		} catch (error) {
			// console.error("Error retrying image:", error);
			return res.status(500).json({ error: "Failed to retry image" });
		}
	});

	// POST /api/create/images/:id/publish - Publish a creation
	router.post("/api/create/images/:id/publish", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const { title, description } = req.body;

			if (!title || title.trim() === '') {
				return res.status(400).json({ error: "Title is required" });
			}

			// Get the image to verify ownership or admin status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and user is admin
			let anyImage = null;
			if (!image) {
				anyImage = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!anyImage) {
					return res.status(404).json({ error: "Image not found" });
				}
				// Only admins can publish images they don't own
				if (user.role !== 'admin') {
					return res.status(403).json({ error: "Forbidden: You can only publish your own creations" });
				}
			}

			const targetImage = image || anyImage;
			const isAdmin = user.role === 'admin';
			const isOwner = image && image.user_id === user.id;

			if (targetImage.status !== 'completed') {
				return res.status(400).json({ error: "Image must be completed before publishing" });
			}

			if (targetImage.published === 1 || targetImage.published === true) {
				return res.status(400).json({ error: "Image is already published" });
			}

			// Publish the image
			const publishResult = await queries.publishCreatedImage.run(
				req.params.id,
				user.id,
				title.trim(),
				description ? description.trim() : null,
				isAdmin
			);

			if (publishResult.changes === 0) {
				return res.status(500).json({ error: "Failed to publish image" });
			}

			// Keep feed attribution tied to the creation owner, not the publishing admin.
			let feedAuthor = user.email || 'User';
			if (targetImage.user_id) {
				try {
					const creator = await queries.selectUserById.get(targetImage.user_id);
					if (creator?.email) {
						feedAuthor = creator.email;
					}
				} catch {
					// Ignore profile lookup errors; use current fallback.
				}
			}

			// Create feed item
			await queries.insertFeedItem.run(
				title.trim(),
				description ? description.trim() : '',
				feedAuthor,
				null, // tags
				parseInt(req.params.id)
			);

			// Get updated image
			const updatedImage = isOwner
				? await queries.selectCreatedImageById.get(req.params.id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);

			// Compute and store embedding at publish (only time we create it).
			await tryStoreEmbeddingForCreation(updatedImage);

			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename), // Use stored URL or generate one
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: true,
				published_at: updatedImage.published_at,
				title: updatedImage.title,
				description: updatedImage.description
			});
		} catch (error) {
			// console.error("Error publishing image:", error);
			return res.status(500).json({ error: "Failed to publish image" });
		}
	});

	// PUT /api/create/images/:id - Update a creation's title/description
	router.put("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			const { title, description } = req.body;

			if (!title || title.trim() === '') {
				return res.status(400).json({ error: "Title is required" });
			}

			// Get the image to verify ownership or admin status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and user is admin
			let anyImage = null;
			if (!image) {
				anyImage = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!anyImage) {
					return res.status(404).json({ error: "Image not found" });
				}
				// Only admins can edit images they don't own
				if (user.role !== 'admin') {
					return res.status(403).json({ error: "Forbidden: You can only edit your own creations" });
				}
			}

			const targetImage = image || anyImage;
			const isAdmin = user.role === 'admin';
			const isOwner = image && image.user_id === user.id;

			// Update the image
			const updateResult = await queries.updateCreatedImage.run(
				req.params.id,
				user.id,
				title.trim(),
				description ? description.trim() : null,
				isAdmin
			);

			if (updateResult.changes === 0) {
				return res.status(500).json({ error: "Failed to update image" });
			}

			// Update the associated feed item if it exists
			const feedItem = await queries.selectFeedItemByCreatedImageId?.get(parseInt(req.params.id));
			if (feedItem) {
				await queries.updateFeedItem?.run(
					parseInt(req.params.id),
					title.trim(),
					description ? description.trim() : ''
				);
			}

			// Get updated image
			const updatedImage = isOwner
				? await queries.selectCreatedImageById.get(req.params.id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);

			// If published, refresh embedding so semantic uses updated title/description.
			if (updatedImage && (updatedImage.published === 1 || updatedImage.published === true)) {
				await tryStoreEmbeddingForCreation(updatedImage);
			}

			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename),
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: updatedImage.published === 1 || updatedImage.published === true,
				published_at: updatedImage.published_at,
				title: updatedImage.title,
				description: updatedImage.description
			});
		} catch (error) {
			// console.error("Error updating image:", error);
			return res.status(500).json({ error: "Failed to update image" });
		}
	});

	// POST /api/create/images/:id/unpublish - Un-publish a creation
	router.post("/api/create/images/:id/unpublish", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		try {
			// Get the image to verify ownership or admin status
			const image = await queries.selectCreatedImageById.get(
				req.params.id,
				user.id
			);

			// If not found as owner, check if it exists and user is admin
			let anyImage = null;
			if (!image) {
				anyImage = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!anyImage) {
					return res.status(404).json({ error: "Image not found" });
				}
				// Only admins can unpublish images they don't own
				if (user.role !== 'admin') {
					return res.status(403).json({ error: "Forbidden: You can only unpublish your own creations" });
				}
			}

			const targetImage = image || anyImage;
			const isPublished = targetImage.published === 1 || targetImage.published === true;

			if (!isPublished) {
				return res.status(400).json({ error: "Image is not published" });
			}

			const isAdmin = user.role === 'admin';
			const isOwner = image && image.user_id === user.id;

			// Un-publish the image
			const unpublishResult = await queries.unpublishCreatedImage.run(
				req.params.id,
				user.id,
				isAdmin
			);

			if (unpublishResult.changes === 0) {
				return res.status(500).json({ error: "Failed to unpublish image" });
			}

			// Delete the associated feed item if it exists
			if (queries.deleteFeedItemByCreatedImageId) {
				await queries.deleteFeedItemByCreatedImageId.run(parseInt(req.params.id));
			}

			// Delete all likes for this created image
			if (queries.deleteAllLikesForCreatedImage) {
				await queries.deleteAllLikesForCreatedImage.run(parseInt(req.params.id));
			}

			// Delete all comments for this created image
			if (queries.deleteAllCommentsForCreatedImage) {
				await queries.deleteAllCommentsForCreatedImage.run(parseInt(req.params.id));
			}

			// Get updated image
			const updatedImage = isOwner
				? await queries.selectCreatedImageById.get(req.params.id, user.id)
				: await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);

			return res.json({
				id: updatedImage.id,
				filename: updatedImage.filename,
				url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename),
				width: updatedImage.width,
				height: updatedImage.height,
				color: updatedImage.color,
				status: updatedImage.status || 'completed',
				created_at: updatedImage.created_at,
				published: false,
				published_at: null,
				title: updatedImage.title,
				description: updatedImage.description
			});
		} catch (error) {
			// console.error("Error unpublishing image:", error);
			return res.status(500).json({ error: "Failed to unpublish image" });
		}
	});

	// DELETE /api/create/images/:id/landscape - Remove landscape from a creation. Owner only.
	router.delete("/api/create/images/:id/landscape", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const creationId = Number(req.params.id);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			return res.status(400).json({ error: "Invalid creation id" });
		}

		const image = await queries.selectCreatedImageById.get(creationId, user.id);
		if (!image) {
			return res.status(404).json({ error: "Creation not found" });
		}

		const meta = parseMeta(image.meta) || {};
		const landscapeFilename = meta.landscapeFilename;
		const hadLandscape = landscapeFilename || (meta.landscapeUrl && meta.landscapeUrl !== "loading" && !String(meta.landscapeUrl).startsWith("error:"));

		if (landscapeFilename && storage?.deleteImage) {
			try {
				await storage.deleteImage(landscapeFilename);
			} catch (storageError) {
				// Log but don't fail the request
			}
		}

		const nextMeta = { ...meta };
		delete nextMeta.landscapeUrl;
		delete nextMeta.landscapeFilename;
		delete nextMeta.credits_refunded;
		await queries.updateCreatedImageMeta.run(creationId, user.id, nextMeta);

		return res.json({
			ok: true,
			removed: !!hadLandscape
		});
	});

	// DELETE /api/create/images/:id - Delete a creation (owner: mark unavailable; admin with ?permanent=1: remove permanently)
	router.delete("/api/create/images/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const permanent = req.query?.permanent === "1" || req.body?.permanent === true;
		const isAdmin = user.role === "admin";

		try {
			if (isAdmin && permanent) {
				// Admin permanent delete: any image, full cleanup (main image + landscape if present)
				const image = await queries.selectCreatedImageByIdAnyUser?.get(req.params.id);
				if (!image) {
					return res.status(404).json({ error: "Image not found" });
				}
				const ownerId = image.user_id;
				try {
					if (image.filename && image.file_path && storage?.deleteImage) {
						await storage.deleteImage(image.filename);
					}
				} catch (storageError) {
					// Log but don't fail
				}
				const permMeta = parseMeta(image.meta) || {};
				if (permMeta.landscapeFilename && storage?.deleteImage) {
					try {
						await storage.deleteImage(permMeta.landscapeFilename);
					} catch (landscapeStorageError) {
						// Log but don't fail
					}
				}
				if (queries.deleteFeedItemByCreatedImageId?.run) {
					await queries.deleteFeedItemByCreatedImageId.run(parseInt(req.params.id));
				}
				if (queries.deleteAllLikesForCreatedImage?.run) {
					await queries.deleteAllLikesForCreatedImage.run(parseInt(req.params.id));
				}
				if (queries.deleteAllCommentsForCreatedImage?.run) {
					await queries.deleteAllCommentsForCreatedImage.run(parseInt(req.params.id));
				}
				const deleteResult = await queries.deleteCreatedImageById.run(req.params.id, ownerId);
				if (deleteResult.changes === 0) {
					return res.status(500).json({ error: "Failed to delete image" });
				}
				return res.json({ success: true, message: "Image permanently deleted" });
			}

			// Owner (or admin without permanent): mark unavailable so it no longer shows anywhere except admin
			const image = await queries.selectCreatedImageById.get(req.params.id, user.id);
			if (!image) {
				return res.status(404).json({ error: "Image not found" });
			}
			const meta = parseMeta(image.meta);
			const status = image.status || "completed";
			if (status === "creating") {
				const timeoutAt = meta?.timeout_at ? new Date(meta.timeout_at).getTime() : NaN;
				if (!Number.isFinite(timeoutAt) || Date.now() <= timeoutAt) {
					return res.status(400).json({ error: "Cannot delete an in-progress creation" });
				}
			}
			const markResult = await queries.markCreatedImageUnavailable?.run(req.params.id, user.id);
			if (!markResult || markResult.changes === 0) {
				return res.status(500).json({ error: "Failed to delete image" });
			}
			if (queries.deleteFeedItemByCreatedImageId?.run) {
				await queries.deleteFeedItemByCreatedImageId.run(parseInt(req.params.id));
			}
			return res.json({ success: true, message: "Image deleted successfully" });
		} catch (error) {
			return res.status(500).json({ error: "Failed to delete image" });
		}
	});

	return router;
}
