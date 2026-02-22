import express from "express";
import QRCode from "qrcode";

export default function createQRRoutes() {
	const router = express.Router();

	/**
	 * GET /api/qr?url=... — returns a QR code as SVG for the given URL (or text).
	 * No auth required; used by share modal and other UIs.
	 */
	router.get("/api/qr", async (req, res) => {
		const url = typeof req.query?.url === "string" ? req.query.url.trim() : "";
		if (!url) {
			return res.status(400).set("Content-Type", "text/plain").send("Missing url query parameter");
		}

		// Limit length to avoid abuse (e.g. huge payloads)
		if (url.length > 2048) {
			return res.status(400).set("Content-Type", "text/plain").send("URL too long");
		}

		try {
			const svg = await QRCode.toString(url, {
				type: "svg",
				width: 256,
				margin: 2,
				errorCorrectionLevel: "M"
			});
			res.setHeader("Content-Type", "image/svg+xml");
			res.setHeader("Cache-Control", "public, max-age=3600");
			res.send(svg);
		} catch (err) {
			res.status(500).set("Content-Type", "text/plain").send("Failed to generate QR code");
		}
	});

	return router;
}
