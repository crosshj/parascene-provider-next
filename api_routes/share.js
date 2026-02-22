import express from "express";
import sharp from "sharp";
import { verifyShareToken } from "./utils/shareLink.js";

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

function parseVariant(raw) {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (value === "wide" || value === "card") return "wide";
	return "raw";
}

async function toWideCardPng(buffer) {
	// X/OG-friendly card: 1200×675
	const targetWidth = 1200;
	const targetHeight = 675;

	// Your pipeline note: upscale to 1200×1200 then crop a 675px-tall middle slice.
	const square = 1200;
	const top = Math.floor((square - targetHeight) / 2);

	return await sharp(buffer, { failOn: "none" })
		.resize(square, square, { fit: "cover", position: "centre" })
		.extract({ left: 0, top, width: square, height: targetHeight })
		.png()
		.toBuffer();
}

export default function createShareRoutes({ queries, storage }) {
	const router = express.Router();

	router.get("/api/share/:version/:token/image", async (req, res) => {
		const version = String(req.params.version || "");
		const token = String(req.params.token || "");
		const variant = parseVariant(req.query?.variant);
		const hasCacheBust = typeof req.query?.v === "string" && req.query.v.trim().length > 0;

		const verified = verifyShareToken({ version, token });
		if (!verified.ok) {
			return res.status(404).json({ error: "Not found" });
		}

		try {
			const image = await queries.selectCreatedImageByIdAnyUser?.get(verified.imageId);
			if (!image) {
				return res.status(404).json({ error: "Not found" });
			}
			const status = image.status || "completed";
			if (status !== "completed") {
				return res.status(404).json({ error: "Not found" });
			}
			if (!image.filename) {
				return res.status(404).json({ error: "Not found" });
			}

			const buf = await storage.getImageBuffer(image.filename);
			const basePng = await ensurePngBuffer(buf);
			const png = variant === "wide" ? await toWideCardPng(basePng) : basePng;
			res.setHeader("Content-Type", "image/png");
			// If callers include a cache-bust query param, we can safely cache aggressively.
			res.setHeader("Cache-Control", hasCacheBust ? "public, max-age=31536000, immutable" : "public, max-age=3600");
			return res.send(png);
		} catch {
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	return router;
}

