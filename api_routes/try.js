import express from "express";
import sharp from "sharp";
import { runAnonCreationJob } from "./utils/creationJob.js";
import { scheduleAnonCreationJob } from "./utils/scheduleCreationJob.js";
import { verifyQStashRequest } from "./utils/qstashVerification.js";

const COOKIE_PS_CID = "ps_cid";

/** Reuse a completed image for the same prompt if it was generated within this window (ms). */
const TRY_PROMPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** Max completed images per prompt to keep in the pool; we pick random from these and refill in background when below this. */
const TRY_PROMPT_POOL_MAX = 5;
/** anon_cid used for pool-refill rows (background generations that fill the prompt pool; not tied to a specific user). */
const ANON_CID_POOL = "__pool__";

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

async function ensurePngBuffer(buffer) {
	const isPng =
		buffer &&
		Buffer.isBuffer(buffer) &&
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47;
	if (isPng) return buffer;
	return await sharp(buffer, { failOn: "none" }).png().toBuffer();
}

/** Hardcoded server/method for try/create (matches create page: server 1, fluxImage). */
const TRY_DEFAULT_SERVER_ID = 1;
const TRY_DEFAULT_METHOD = "fluxImage";

function getTryServerAndArgs(prompt) {
	return {
		server_id: TRY_DEFAULT_SERVER_ID,
		method: TRY_DEFAULT_METHOD,
		args: typeof prompt === "string" && prompt.trim() ? { prompt: prompt.trim() } : {},
	};
}

/** Schedules a background generation for the prompt pool (anon_cid = __pool__). Does not block. */
async function schedulePoolRefill(queries, storage, server_id, method, args, canonicalPrompt) {
	const server = await queries.selectServerById.get(server_id);
	if (!server || server.status !== "active") return;
	const started_at = new Date().toISOString();
	const meta = {
		server_id: Number(server_id),
		server_name: typeof server.name === "string" ? server.name : null,
		method,
		args,
		started_at,
		pool_refill: true,
	};
	const placeholderFilename = `creating_anon_pool_${Date.now()}.png`;
	const result = await queries.insertCreatedImageAnon.run(
		canonicalPrompt,
		placeholderFilename,
		"",
		1024,
		1024,
		"creating",
		meta
	);
	const id = result.insertId;
	if (!id) return;
	await scheduleAnonCreationJob({
		payload: {
			created_image_anon_id: id,
			server_id: Number(server_id),
			method,
			args,
		},
		runAnonCreationJob: (opts) => runAnonCreationJob({ queries, storage, payload: opts.payload }),
	});
}

export default function createTryRoutes({ queries, storage }) {
	const router = express.Router();

	function requireAnonCid(req, res) {
		const cid = req.cookies?.[COOKIE_PS_CID];
		if (!cid || typeof cid !== "string" || !cid.trim()) {
			res.status(400).json({
				error: "Missing identity",
				message: "Cookie ps_cid is required. Call POST /api/policy/seen first.",
			});
			return null;
		}
		return cid.trim();
	}

	// POST /api/try/create — require ps_cid; body: { prompt } or { server_id, method, args }
	// Idempotent by prompt: same anon_cid + same prompt returns existing row (so refresh or duplicate submit reuses one creation).
	router.post("/api/try/create", async (req, res) => {
		const anonCid = requireAnonCid(req, res);
		if (!anonCid) return;

		const body = req.body && typeof req.body === "object" ? req.body : {};
		let server_id = body.server_id;
		let method = body.method;
		let args = body.args && typeof body.args === "object" ? { ...body.args } : {};

		if (server_id == null || !method) {
			const prompt = body.prompt;
			const defaults = getTryServerAndArgs(prompt);
			server_id = server_id ?? defaults.server_id;
			method = method ?? defaults.method;
			if (Object.keys(args).length === 0 && defaults.args && Object.keys(defaults.args).length > 0) {
				args = defaults.args;
			}
		}

		// Canonical prompt for idempotency: same prompt => same creation (return existing if found)
		const rawPrompt = body.prompt ?? args?.prompt;
		const canonicalPrompt =
			rawPrompt != null && typeof rawPrompt === "string" && rawPrompt.trim() ? rawPrompt.trim() : null;

		if (canonicalPrompt) {
			// Pool first: if we have 1+ completed images for this prompt, always serve a random one (so refresh gives variety).
			const sinceIso = new Date(Date.now() - TRY_PROMPT_CACHE_TTL_MS).toISOString();
			const cachedList = await queries.selectRecentCompletedCreatedImageAnonByPrompt?.all?.(
				canonicalPrompt,
				sinceIso,
				TRY_PROMPT_POOL_MAX
			);
			const poolCount = Array.isArray(cachedList) ? cachedList.length : 0;

			if (poolCount >= 1) {
				// Serve a random one from the pool and give this user a row pointing at it.
				const cached = cachedList[Math.floor(Math.random() * poolCount)];
				if (cached?.filename) {
					const filePath =
						cached.file_path ||
						(storage.getImageUrlAnon ? storage.getImageUrlAnon(cached.filename) : `/api/try/images/${cached.filename}`);
				const meta = {
					from_cache: true,
					cached_at: new Date().toISOString(),
					original_created_at: cached.created_at,
				};
					const result = await queries.insertCreatedImageAnon.run(
						canonicalPrompt,
						cached.filename,
						filePath,
						cached.width ?? 1024,
						cached.height ?? 1024,
						"completed",
						meta
					);
					const id = result.insertId;
					if (id) {
						const fulfilledAt = new Date().toISOString();
						queries.insertTryRequest?.run?.(anonCid, canonicalPrompt, id, fulfilledAt);
						const url = storage.getImageUrlAnon
							? storage.getImageUrlAnon(cached.filename)
							: `/api/try/images/${cached.filename}`;
						// If pool has fewer than 5, kick off a background refill (pool row, not tied to this user).
						if (poolCount < TRY_PROMPT_POOL_MAX) {
							schedulePoolRefill(queries, storage, server_id, method, args, canonicalPrompt).catch((err) =>
								console.error("[Try] Pool refill failed:", err?.message || err)
							);
						}
						return res.status(201).json({
							id,
							status: "completed",
							created_at: new Date().toISOString(),
							meta,
							prompt: canonicalPrompt,
							url,
							from_cache: true,
						});
					}
				}
			}

			// Idempotency when pool is empty: same cid + prompt returns existing row (in-progress or previous result).
			const existingReq = await queries.selectTryRequestByCidAndPrompt?.get?.(anonCid, canonicalPrompt);
			if (existingReq) {
				const existing = await queries.selectCreatedImageAnonById?.get?.(existingReq.created_image_anon_id);
				if (existing) {
					const meta = parseMeta(existing.meta);
					const url =
						existing.status === "completed" && existing.filename
							? (storage.getImageUrlAnon ? storage.getImageUrlAnon(existing.filename) : `/api/try/images/${existing.filename}`)
							: null;
					return res.status(200).json({
						id: existing.id,
						status: existing.status,
						created_at: existing.created_at,
						meta,
						prompt: existing.prompt,
						url: url ?? undefined,
						existing: true,
					});
				}
			}
		}

		const server = await queries.selectServerById.get(server_id);
		if (!server || server.status !== "active") {
			return res.status(400).json({
				error: "Invalid server",
				message: "Server not found or not active",
			});
		}

		const chargeCredits = Number(body.charge_credits);
		const AVATAR_GENERATE_CREDITS = 3;
		let chargedUserId = null;
		if (Number.isFinite(chargeCredits) && chargeCredits === AVATAR_GENERATE_CREDITS) {
			const userId = req.auth?.userId;
			if (!userId) {
				return res.status(401).json({
					error: "Unauthorized",
					message: "Sign in to generate an avatar from your character.",
				});
			}
			const credits = await queries.selectUserCredits?.get?.(userId);
			const balance = credits?.balance ?? 0;
			if (balance < AVATAR_GENERATE_CREDITS) {
				return res.status(400).json({
					error: "Insufficient credits",
					message: `Generate from character costs ${AVATAR_GENERATE_CREDITS} credits. You have ${balance} credits.`,
					required: AVATAR_GENERATE_CREDITS,
					current: balance,
				});
			}
			await queries.updateUserCreditsBalance.run(userId, -AVATAR_GENERATE_CREDITS);
			chargedUserId = userId;
		}

		const placeholderFilename = `creating_anon_${Date.now()}.png`;
		const started_at = new Date().toISOString();
		const meta = {
			server_id: Number(server_id),
			server_name: typeof server.name === "string" ? server.name : null,
			method,
			args,
			started_at,
		};

		const result = await queries.insertCreatedImageAnon.run(
			canonicalPrompt,
			placeholderFilename,
			"",
			1024,
			1024,
			"creating",
			meta
		);
		const id = result.insertId;
		if (!id) {
			if (chargedUserId && queries.updateUserCreditsBalance?.run) {
				await queries.updateUserCreditsBalance.run(chargedUserId, AVATAR_GENERATE_CREDITS);
			}
			return res.status(500).json({ error: "Failed to create try record" });
		}

		queries.insertTryRequest?.run?.(anonCid, canonicalPrompt, id, null);

		try {
			await scheduleAnonCreationJob({
				payload: {
					created_image_anon_id: id,
					server_id: Number(server_id),
					method,
					args,
				},
				runAnonCreationJob: (opts) =>
					runAnonCreationJob({ queries, storage, payload: opts.payload }),
			});
		} catch (err) {
			if (chargedUserId && queries.updateUserCreditsBalance?.run) {
				await queries.updateUserCreditsBalance.run(chargedUserId, AVATAR_GENERATE_CREDITS);
			}
			await queries.updateCreatedImageAnonJobFailed.run(id, {
				meta: { ...meta, failed_at: new Date().toISOString(), error: err?.message || "Schedule failed" },
			});
			return res.status(500).json({ error: "Failed to schedule creation", message: err?.message });
		}

		return res.status(201).json({
			id,
			status: "creating",
			created_at: started_at,
			meta,
			prompt: canonicalPrompt,
		});
	});

	// GET /api/try/list — require ps_cid; return list from try_requests + created_images_anon (same shape for polling)
	router.get("/api/try/list", async (req, res) => {
		const anonCid = requireAnonCid(req, res);
		if (!anonCid) return;

		const reqs = await queries.selectTryRequestsByCid?.all?.(anonCid) ?? [];
		if (reqs.length === 0) return res.json([]);
		const ids = [...new Set(reqs.map((r) => r.created_image_anon_id).filter(Boolean))];
		const images = await queries.selectCreatedImagesAnonByIds?.all?.(ids) ?? [];
		const imageById = new Map(images.map((i) => [i.id, i]));
		const items = reqs.map((req) => {
			const row = imageById.get(req.created_image_anon_id);
			if (!row) return null;
			const meta = parseMeta(row.meta);
			const url =
				row.status === "completed" && row.filename
					? storage.getImageUrlAnon
						? storage.getImageUrlAnon(row.filename)
						: `/api/try/images/${row.filename}`
					: null;
			return {
				id: row.id,
				prompt: row.prompt ?? req.prompt ?? null,
				filename: row.filename,
				file_path: row.file_path,
				width: row.width,
				height: row.height,
				status: row.status,
				created_at: row.created_at,
				meta,
				url,
			};
		}).filter(Boolean);
		return res.json(items);
	});

	// POST /api/try/discard — require ps_cid; body: { url } or { filename }. Unlinks and deletes the anon image for this session; deletes file only if no other anon row references it.
	router.post("/api/try/discard", async (req, res) => {
		const anonCid = requireAnonCid(req, res);
		if (!anonCid) return;

		const body = req.body && typeof req.body === "object" ? req.body : {};
		let filename = typeof body.filename === "string" ? body.filename.trim() : "";
		if (!filename && typeof body.url === "string") {
			const u = body.url.trim();
			const prefix = "/api/try/images/";
			if (u.startsWith(prefix)) {
				const after = u.slice(prefix.length);
				filename = after ? after.split("/")[0].split("?")[0].trim() : "";
			}
		}
		if (!filename || filename.includes("..") || filename.includes("/")) {
			return res.status(400).json({ error: "Invalid url or filename" });
		}

		const reqs = await queries.selectTryRequestsByCid?.all?.(anonCid) ?? [];
		const anonIds = [...new Set(reqs.map((r) => r.created_image_anon_id).filter(Boolean))];
		if (anonIds.length === 0) return res.status(404).json({ error: "No try image to discard" });

		const images = await queries.selectCreatedImagesAnonByIds?.all?.(anonIds) ?? [];
		const anonRow = images.find((row) => row.filename === filename);
		if (!anonRow) return res.status(404).json({ error: "Try image not found or not yours" });

		const countRow = await queries.countCreatedImagesAnonByFilename?.get?.(filename);
		const onlyReference = countRow && Number(countRow.count) === 1;

		if (queries.updateTryRequestsNullAnonId?.run) {
			await queries.updateTryRequestsNullAnonId.run(anonRow.id);
		}
		if (queries.deleteCreatedImageAnon?.run) {
			await queries.deleteCreatedImageAnon.run(anonRow.id);
		}
		if (onlyReference && storage.deleteImageAnon) {
			try {
				await storage.deleteImageAnon(filename);
			} catch (_) {}
		}
		return res.status(200).json({ ok: true });
	});

	// GET /api/try/images/:filename — serve anon image (no auth; anyone with link can view)
	router.get("/api/try/images/:filename", async (req, res) => {
		const filename = req.params.filename;
		if (!filename || filename.includes("..") || filename.includes("/")) {
			return res.status(400).json({ error: "Invalid filename" });
		}
		try {
			const imageBuffer = await storage.getImageBufferAnon(filename);
			const png = await ensurePngBuffer(imageBuffer);
			res.setHeader("Content-Type", "image/png");
			res.setHeader("Cache-Control", "public, max-age=3600");
			res.send(png);
		} catch (err) {
			if (err?.message && err.message.includes("not found")) {
				return res.status(404).json({ error: "Image not found" });
			}
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	// POST /api/try/worker — QStash callback; verify signature then run anon job
	router.post("/api/try/worker", async (req, res) => {
		res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
		res.setHeader("Pragma", "no-cache");
		res.setHeader("Expires", "0");

		if (req.method !== "POST") {
			return res.status(405).json({ error: "Method not allowed" });
		}

		try {
			if (!process.env.UPSTASH_QSTASH_TOKEN) {
				return res.status(503).json({ error: "QStash not configured" });
			}
			const isValid = await verifyQStashRequest(req);
			if (!isValid) {
				return res.status(401).json({ error: "Invalid QStash signature" });
			}
			const payload = req.body;
			await runAnonCreationJob({ queries, storage, payload });
			return res.json({ ok: true });
		} catch (err) {
			console.error("[Try] Worker failed:", err);
			return res.status(500).json({ ok: false, error: "Worker failed" });
		}
	});

	return router;
}
