import { buildProviderHeaders } from "./providerAuth.js";
import sharp from "sharp";

const PROVIDER_TIMEOUT_MS = 50_000;
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

function logCreation(...args) {
	console.log("[Creation]", ...args);
}

function logCreationError(...args) {
	console.error("[Creation]", ...args);
}

function logCreationWarn(...args) {
	console.warn("[Creation]", ...args);
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

function mergeMeta(existing, patch) {
	const base = existing && typeof existing === "object" ? existing : {};
	const next = { ...base, ...(patch && typeof patch === "object" ? patch : {}) };
	return next;
}

function inferErrorCode(err) {
	if (!err) return "unknown";
	if (err.name === "AbortError") return "timeout";
	return "provider_error";
}

function safeErrorMessage(err) {
	if (!err) return "Unknown error";
	if (typeof err === "string") return err;
	if (err instanceof Error) return err.message || "Error";
	try {
		return JSON.stringify(err);
	} catch {
		return "Error";
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
	try {
		return await sharp(buffer, { failOn: "none" }).png().toBuffer();
	} catch (err) {
		const msg = safeErrorMessage(err);
		const e = new Error(`Failed to convert image to PNG: ${msg}`);
		e.code = "IMAGE_ENCODE_FAILED";
		throw e;
	}
}

async function readProviderErrorPayload(response) {
	if (!response) return { ok: false, body: null, contentType: "" };
	const contentType = response.headers?.get?.("content-type") || "";
	let text = "";
	try {
		text = await response.text();
	} catch {
		text = "";
	}
	if (typeof text === "string" && text.length > 20_000) {
		text = `${text.slice(0, 20_000)}…`;
	}
	if (contentType.includes("application/json")) {
		try {
			return { ok: true, body: JSON.parse(text || "null"), contentType };
		} catch {
			return { ok: true, body: text, contentType };
		}
	}
	return { ok: true, body: text, contentType };
}

function providerBodyToMessage(body) {
	if (body == null) return "";
	if (typeof body === "string") return body.trim();
	if (typeof body === "object") {
		const err = typeof body.error === "string" ? body.error.trim() : "";
		if (err) return err;
		const msg = typeof body.message === "string" ? body.message.trim() : "";
		if (msg) return msg;
		try {
			return JSON.stringify(body);
		} catch {
			return "[provider_error]";
		}
	}
	return String(body);
}

export async function runCreationJob({ queries, storage, payload }) {
	const {
		created_image_id,
		user_id,
		server_id,
		method,
		args,
		credit_cost,
	} = payload || {};

	logCreation("runCreationJob started", {
		created_image_id,
		user_id,
		server_id,
		method,
		credit_cost,
		args_keys: args ? Object.keys(args) : []
	});

	if (!created_image_id || !user_id || !server_id || !method) {
		const error = new Error("runCreationJob: missing required payload fields");
		logCreationError("Missing required fields", { created_image_id, user_id, server_id, method });
		throw error;
	}

	const userId = Number(user_id);
	const imageId = Number(created_image_id);

	logCreation(`Fetching image ${imageId} for user ${userId}`);
	const image = await queries.selectCreatedImageById.get(imageId, userId);
	if (!image) {
		logCreationWarn(`Image ${imageId} not found for user ${userId} - may have been deleted`);
		// Nothing to do (deleted / wrong user).
		return { ok: false, reason: "not_found" };
	}

	logCreation(`Image ${imageId} found, status: ${image.status || "null"}`);

	// Idempotency: only transition when still creating.
	if (image.status && image.status !== "creating") {
		logCreation(`Skipping job - image ${imageId} already ${image.status}`);
		return { ok: true, skipped: true, status: image.status };
	}

	const existingMeta = parseMeta(image.meta);

	logCreation(`Fetching server ${server_id}`);
	const server = await queries.selectServerById.get(server_id);
	if (!server || server.status !== "active") {
		const errorMsg = !server ? "Server not found" : "Server is not active";
		logCreationError(`Server validation failed: ${errorMsg}`, {
			server_id,
			server_found: !!server,
			server_status: server?.status
		});

		const nextMeta = mergeMeta(existingMeta, {
			failed_at: new Date().toISOString(),
			error_code: "provider_error",
			error: errorMsg,
		});
		await queries.updateCreatedImageJobFailed.run(imageId, userId, { meta: nextMeta });

		// Refund if needed.
		if (credit_cost && !(nextMeta && nextMeta.credits_refunded)) {
			logCreation(`Refunding ${credit_cost} credits to user ${userId}`);
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
			await queries.updateCreatedImageJobFailed.run(imageId, userId, {
				meta: mergeMeta(nextMeta, { credits_refunded: true }),
			});
		}

		return { ok: false, reason: "invalid_server" };
	}

	logCreation(`Server ${server_id} validated`, {
		server_url: server.server_url,
		server_status: server.status,
		has_auth_token: !!server.auth_token
	});

	let imageBuffer;
	let color = null;
	let width = DEFAULT_WIDTH;
	let height = DEFAULT_HEIGHT;
	let providerError = null;

	const argsForProvider = args || {};
	const providerPayload = { method, args: argsForProvider };
	console.log("[Creation] Sending to provider:", JSON.stringify(providerPayload, null, 2));

	try {
		const providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{
					"Content-Type": "application/json",
					Accept: "image/png",
				},
				server.auth_token
			),
			body: JSON.stringify(providerPayload),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
		});

		if (!providerResponse.ok) {
			const payload = await readProviderErrorPayload(providerResponse);
			const providerMessage = providerBodyToMessage(payload.body);
			const err = new Error(providerMessage || `Provider error: ${providerResponse.status} ${providerResponse.statusText}`);
			err.code = "PROVIDER_NON_2XX";
			err.provider = {
				status: providerResponse.status,
				statusText: providerResponse.statusText,
				contentType: payload.contentType,
				body: payload.body
			};
			throw err;
		}

		const providerContentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
		if (providerContentType && !providerContentType.includes("image/png")) {
			logCreationWarn("Provider returned non-PNG; converting to PNG", { providerContentType });
		}

		const rawBuffer = Buffer.from(await providerResponse.arrayBuffer());
		imageBuffer = await ensurePngBuffer(rawBuffer);

		const headerColor = providerResponse.headers.get("X-Image-Color");
		const headerWidth = providerResponse.headers.get("X-Image-Width");
		const headerHeight = providerResponse.headers.get("X-Image-Height");

		if (headerColor) color = headerColor;
		if (headerWidth) width = Number.parseInt(headerWidth, 10) || width;
		if (headerHeight) height = Number.parseInt(headerHeight, 10) || height;
	} catch (err) {
		providerError = err;
	}

	if (providerError) {
		const startedAtMs = existingMeta && existingMeta.started_at ? Date.parse(existingMeta.started_at) : NaN;
		const failedAtIso = new Date().toISOString();
		const failedAtMs = Date.parse(failedAtIso);
		const durationMs =
			Number.isFinite(startedAtMs) && Number.isFinite(failedAtMs) && failedAtMs >= startedAtMs
				? failedAtMs - startedAtMs
				: null;

		const errorCode = inferErrorCode(providerError);
		const providerDetails =
			providerError && typeof providerError === "object" && providerError.provider && typeof providerError.provider === "object"
				? providerError.provider
				: null;
		const errorMsg = safeErrorMessage(providerError);
		const providerMsg = providerDetails ? providerBodyToMessage(providerDetails.body) : "";

		logCreationError(`Marking job as failed`, {
			imageId,
			error_code: errorCode,
			error: errorMsg,
			duration_ms: durationMs
		});

		const nextMetaBase = mergeMeta(existingMeta, {
			failed_at: failedAtIso,
			error_code: errorCode,
			error: providerMsg || errorMsg,
			...(providerDetails ? { provider_error: providerDetails } : {}),
			...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
		});

		await queries.updateCreatedImageJobFailed.run(imageId, userId, { meta: nextMetaBase });

		// Refund once.
		if (credit_cost && !(nextMetaBase && nextMetaBase.credits_refunded)) {
			logCreation(`Refunding ${credit_cost} credits to user ${userId}`);
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
			await queries.updateCreatedImageJobFailed.run(imageId, userId, {
				meta: mergeMeta(nextMetaBase, { credits_refunded: true }),
			});
		}

		return { ok: false, reason: "provider_failed" };
	}

	// Upload and finalize.
	logCreation("Uploading image to storage");
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `${userId}_${imageId}_${timestamp}_${random}.png`;

	const uploadStartTime = Date.now();
	const imageUrl = await storage.uploadImage(imageBuffer, filename);
	const uploadDuration = Date.now() - uploadStartTime;
	logCreation(`Image uploaded in ${uploadDuration}ms`, { filename, url: imageUrl });

	const completedAtIso = new Date().toISOString();
	const startedAtMs = existingMeta && existingMeta.started_at ? Date.parse(existingMeta.started_at) : NaN;
	const completedAtMs = Date.parse(completedAtIso);
	const durationMs =
		Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) && completedAtMs >= startedAtMs
			? completedAtMs - startedAtMs
			: null;

	const completedMeta = mergeMeta(existingMeta, {
		completed_at: completedAtIso,
		...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
	});

	logCreation(`Updating database - marking job as completed`, {
		imageId,
		filename,
		duration_ms: durationMs
	});

	await queries.updateCreatedImageJobCompleted.run(imageId, userId, {
		filename,
		file_path: imageUrl,
		width,
		height,
		color,
		meta: completedMeta,
	});

	// Credit server owner (30% of what user was charged), best-effort.
	const ownerCredits = Number(credit_cost || 0) * 0.3;
	if (server.user_id && ownerCredits > 0) {
		try {
			logCreation(`Crediting server owner ${server.user_id} with ${ownerCredits} credits`);
			let ownerCreditsRecord = await queries.selectUserCredits.get(server.user_id);
			if (!ownerCreditsRecord) {
				await queries.insertUserCredits.run(server.user_id, 0, null);
				ownerCreditsRecord = await queries.selectUserCredits.get(server.user_id);
			}
			if (ownerCreditsRecord) {
				await queries.updateUserCreditsBalance.run(server.user_id, ownerCredits);
			}
		} catch (e) {
			logCreationWarn("Failed to credit server owner:", e?.message || e);
		}
	}

	logCreation(`Job completed successfully`, {
		imageId,
		filename,
		width,
		height,
		color,
		total_duration_ms: durationMs
	});

	return { ok: true, id: imageId, filename, url: imageUrl, width, height, color };
}

/** Anonymous (try) creation job: same provider flow, anon table + anon storage, no credits. */
export async function runAnonCreationJob({ queries, storage, payload }) {
	const { created_image_anon_id, server_id, method, args } = payload || {};

	logCreation("runAnonCreationJob started", {
		created_image_anon_id,
		server_id,
		method,
		args_keys: args ? Object.keys(args) : []
	});

	if (!created_image_anon_id || !server_id || !method) {
		const error = new Error("runAnonCreationJob: missing required payload fields");
		logCreationError("Missing required fields", {
			created_image_anon_id,
			server_id,
			method
		});
		throw error;
	}

	const imageId = Number(created_image_anon_id);

	const image = await queries.selectCreatedImageAnonById.get(imageId);
	if (!image) {
		logCreationWarn(`Anon image ${imageId} not found`);
		return { ok: false, reason: "not_found" };
	}
	if (image.status && image.status !== "creating") {
		logCreation(`Skipping anon job - image ${imageId} already ${image.status}`);
		return { ok: true, skipped: true, status: image.status };
	}

	const existingMeta = parseMeta(image.meta);

	const server = await queries.selectServerById.get(server_id);
	if (!server || server.status !== "active") {
		const errorMsg = !server ? "Server not found" : "Server is not active";
		logCreationError(`Anon server validation failed: ${errorMsg}`, { server_id });
		const nextMeta = mergeMeta(existingMeta, {
			failed_at: new Date().toISOString(),
			error_code: "provider_error",
			error: errorMsg
		});
		await queries.updateCreatedImageAnonJobFailed.run(imageId, { meta: nextMeta });
		return { ok: false, reason: "invalid_server" };
	}

	let imageBuffer;
	let width = DEFAULT_WIDTH;
	let height = DEFAULT_HEIGHT;

	try {
		const providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{ "Content-Type": "application/json", Accept: "image/png" },
				server.auth_token
			),
			body: JSON.stringify({ method, args: args || {} }),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
		});

		if (!providerResponse.ok) {
			const payloadErr = await readProviderErrorPayload(providerResponse);
			const providerMessage = providerBodyToMessage(payloadErr.body);
			const err = new Error(providerMessage || `Provider error: ${providerResponse.status} ${providerResponse.statusText}`);
			err.code = "PROVIDER_NON_2XX";
			err.provider = {
				status: providerResponse.status,
				statusText: providerResponse.statusText,
				contentType: payloadErr.contentType,
				body: payloadErr.body
			};
			throw err;
		}

		const providerContentType = String(providerResponse.headers.get("content-type") || "").toLowerCase();
		if (providerContentType && !providerContentType.includes("image/png")) {
			logCreationWarn("Provider returned non-PNG; converting to PNG", { providerContentType });
		}
		const rawBuffer = Buffer.from(await providerResponse.arrayBuffer());
		imageBuffer = await ensurePngBuffer(rawBuffer);

		const headerWidth = providerResponse.headers.get("X-Image-Width");
		const headerHeight = providerResponse.headers.get("X-Image-Height");
		if (headerWidth) width = Number.parseInt(headerWidth, 10) || width;
		if (headerHeight) height = Number.parseInt(headerHeight, 10) || height;
	} catch (err) {
		const startedAtMs = existingMeta?.started_at ? Date.parse(existingMeta.started_at) : NaN;
		const failedAtIso = new Date().toISOString();
		const failedAtMs = Date.parse(failedAtIso);
		const durationMs =
			Number.isFinite(startedAtMs) && Number.isFinite(failedAtMs) && failedAtMs >= startedAtMs
				? failedAtMs - startedAtMs
				: null;
		const errorCode = inferErrorCode(err);
		const providerDetails =
			err && typeof err === "object" && err.provider && typeof err.provider === "object" ? err.provider : null;
		const errorMsg = safeErrorMessage(err);
		const providerMsg = providerDetails ? providerBodyToMessage(providerDetails.body) : "";
		const nextMeta = mergeMeta(existingMeta, {
			failed_at: failedAtIso,
			error_code: errorCode,
			error: providerMsg || errorMsg,
			...(providerDetails ? { provider_error: providerDetails } : {}),
			...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
		});
		await queries.updateCreatedImageAnonJobFailed.run(imageId, { meta: nextMeta });
		return { ok: false, reason: "provider_failed" };
	}

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const filename = `anon_${imageId}_${timestamp}_${random}.png`;

	const imageUrl = await storage.uploadImageAnon(imageBuffer, filename);
	const completedAtIso = new Date().toISOString();
	const startedAtMs = existingMeta?.started_at ? Date.parse(existingMeta.started_at) : NaN;
	const completedAtMs = Date.parse(completedAtIso);
	const durationMs =
		Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) && completedAtMs >= startedAtMs
			? completedAtMs - startedAtMs
			: null;
	const completedMeta = mergeMeta(existingMeta, {
		completed_at: completedAtIso,
		...(Number.isFinite(durationMs) && durationMs >= 0 ? { duration_ms: durationMs } : {}),
	});

	await queries.updateCreatedImageAnonJobCompleted.run(imageId, {
		filename,
		file_path: imageUrl,
		width,
		height,
		meta: completedMeta,
	});

	await queries.updateTryRequestFulfilledByCreatedImageAnonId?.run?.(imageId, completedAtIso);

	logCreation("Anon job completed", { imageId, filename, width, height });
	return { ok: true, id: imageId, filename, url: imageUrl, width, height };
}

export { PROVIDER_TIMEOUT_MS };

