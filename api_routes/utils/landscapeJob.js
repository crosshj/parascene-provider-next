import { buildProviderHeaders } from "./providerAuth.js";
import sharp from "sharp";

const PROVIDER_TIMEOUT_MS = 50_000;

function log(...args) {
	console.log("[Landscape]", ...args);
}

function logError(...args) {
	console.error("[Landscape]", ...args);
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
	return { ...base, ...(patch && typeof patch === "object" ? patch : {}) };
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

async function ensurePngBuffer(buffer) {
	if (
		buffer &&
		Buffer.isBuffer(buffer) &&
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47
	) {
		return buffer;
	}
	try {
		return await sharp(buffer, { failOn: "none" }).png().toBuffer();
	} catch (err) {
		const msg = safeErrorMessage(err);
		throw new Error(`Failed to convert image to PNG: ${msg}`);
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

/**
 * Run landscape (outpaint) job. Updates the existing creation's meta.landscapeUrl
 * and meta.landscapeFilename; does NOT create a new created_images row.
 * Payload: { created_image_id, user_id, server_id, image_url, credit_cost }
 */
export async function runLandscapeJob({ queries, storage, payload }) {
	const { created_image_id, user_id, server_id, image_url, credit_cost } = payload || {};

	log("runLandscapeJob started", {
		created_image_id,
		user_id,
		server_id,
		credit_cost,
	});

	if (!created_image_id || !user_id || !server_id || !image_url) {
		const err = new Error("runLandscapeJob: missing required payload fields");
		logError("Missing required fields", payload);
		throw err;
	}

	const imageId = Number(created_image_id);
	const userId = Number(user_id);

	const image = await queries.selectCreatedImageById.get(imageId, userId);
	if (!image) {
		log("Image not found or wrong user, skipping", { imageId, userId });
		return { ok: false, reason: "not_found" };
	}

	const existingMeta = parseMeta(image.meta) || {};
	const previousLandscapeFilename =
		typeof existingMeta.landscapeFilename === "string" && existingMeta.landscapeFilename.trim()
			? existingMeta.landscapeFilename.trim()
			: null;
	if (existingMeta.landscapeUrl && existingMeta.landscapeUrl !== "loading") {
		log("Landscape already set, skipping", { landscapeUrl: existingMeta.landscapeUrl?.substring?.(0, 30) });
		return { ok: true, skipped: true };
	}

	const server = await queries.selectServerById.get(server_id);
	if (!server || server.status !== "active") {
		const errorMsg = !server ? "Server not found" : "Server is not active";
		logError("Server validation failed", { server_id, errorMsg });
		const nextMeta = mergeMeta(existingMeta, {
			landscapeUrl: "error:Landscape server is not available.",
			landscapeFilename: null,
			...(credit_cost && !existingMeta.credits_refunded ? { credits_refunded: true } : {}),
		});
		await queries.updateCreatedImageMeta?.run?.(imageId, userId, nextMeta);
		if (credit_cost && !existingMeta.credits_refunded) {
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
		}
		return { ok: false, reason: "invalid_server" };
	}

	let imageBuffer;
	let providerError = null;
	const argsForProvider = { operation: "outpaint", image_url };
	const providerPayload = { method: "advanced_generate", args: argsForProvider };

	try {
		const providerResponse = await fetch(server.server_url, {
			method: "POST",
			headers: buildProviderHeaders(
				{ "Content-Type": "application/json", Accept: "image/png" },
				server.auth_token
			),
			body: JSON.stringify(providerPayload),
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
		});

		if (!providerResponse.ok) {
			const payloadErr = await readProviderErrorPayload(providerResponse);
			const message = providerBodyToMessage(payloadErr.body);
			providerError = new Error(message || `Provider error: ${providerResponse.status} ${providerResponse.statusText}`);
			providerError.code = "PROVIDER_NON_2XX";
			providerError.provider = { status: providerResponse.status, body: payloadErr.body };
			throw providerError;
		}

		const rawBuffer = Buffer.from(await providerResponse.arrayBuffer());
		imageBuffer = await ensurePngBuffer(rawBuffer);
	} catch (err) {
		providerError = err;
	}

	if (providerError) {
		const userMessage = providerError.provider
			? providerBodyToMessage(providerError.provider.body)
			: safeErrorMessage(providerError);
		const landscapeError = userMessage ? `error:${userMessage}` : "error:The image failed to generate.";
		const nextMeta = mergeMeta(existingMeta, {
			landscapeUrl: landscapeError,
			landscapeFilename: null,
			...(credit_cost && !existingMeta.credits_refunded ? { credits_refunded: true } : {}),
		});
		await queries.updateCreatedImageMeta?.run?.(imageId, userId, nextMeta);
		if (credit_cost && !existingMeta.credits_refunded) {
			log("Refunding credits after landscape failure", { userId, credit_cost });
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
		}
		return { ok: false, reason: "provider_failed" };
	}

	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 9);
	const landscapeFilename = `landscape/${userId}_${imageId}_${timestamp}_${random}.png`;

	let landscapeUrl;
	try {
		landscapeUrl = await storage.uploadImage(imageBuffer, landscapeFilename);
	} catch (uploadErr) {
		logError("Landscape upload failed", uploadErr);
		const nextMeta = mergeMeta(existingMeta, {
			landscapeUrl: "error:Failed to save landscape image.",
			landscapeFilename: null,
			...(credit_cost && !existingMeta.credits_refunded ? { credits_refunded: true } : {}),
		});
		await queries.updateCreatedImageMeta?.run?.(imageId, userId, nextMeta);
		if (credit_cost && !existingMeta.credits_refunded) {
			await queries.updateUserCreditsBalance.run(userId, Number(credit_cost));
		}
		return { ok: false, reason: "upload_failed" };
	}

	const completedMeta = mergeMeta(existingMeta, {
		landscapeUrl,
		landscapeFilename,
	});
	await queries.updateCreatedImageMeta.run(imageId, userId, completedMeta);

	// If this is a re-generate, clean up the previous landscape image from storage.
	if (previousLandscapeFilename && previousLandscapeFilename !== landscapeFilename && storage?.deleteImage) {
		try {
			await storage.deleteImage(previousLandscapeFilename);
			log("Deleted previous landscape image", {
				imageId,
				previousLandscapeFilename,
			});
		} catch (err) {
			logError("Failed to delete previous landscape image", err);
		}
	}

	log("Landscape job completed", { imageId, landscapeFilename });
	return { ok: true, landscapeUrl, landscapeFilename };
}
