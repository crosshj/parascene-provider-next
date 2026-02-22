import express from "express";
import path from "path";
import sharp from "sharp";

function guessContentType(key) {
	const ext = path.extname(String(key || "")).toLowerCase();
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	if (ext === ".svg") return "image/svg+xml";
	return "image/png";
}

function normalizeUploadKind(value) {
	const v = String(value || "").toLowerCase().trim();
	if (v === "avatar" || v === "cover" || v === "edited") return v;
	return "generic";
}

function safeKeySegment(segment) {
	return String(segment || "")
		.replace(/[^a-z0-9._-]/gi, "_")
		.replace(/_+/g, "_")
		.slice(0, 80);
}

function extFromContentType(contentType) {
	const ct = String(contentType || "").toLowerCase();
	if (ct.includes("image/jpeg")) return ".jpg";
	if (ct.includes("image/webp")) return ".webp";
	if (ct.includes("image/gif")) return ".gif";
	if (ct.includes("image/svg+xml")) return ".svg";
	if (ct.includes("image/png")) return ".png";
	return "";
}

function buildImageUrl(namespace, key) {
	const ns = encodeURIComponent(String(namespace || ""));
	const segments = String(key || "")
		.split("/")
		.filter(Boolean)
		.map((s) => encodeURIComponent(s));
	return `/api/images/${ns}/${segments.join("/")}`;
}

export default function createImagesRoutes({ storage }) {
	const router = express.Router();

	// Generic images namespace (Supabase private bucket: prsn_generic-images)
	router.get("/api/images/:namespace/:key(*)", async (req, res, next) => {
		const namespace = String(req.params.namespace || "").toLowerCase();
		const key = String(req.params.key || "");

		// Let other routes handle other namespaces (e.g. /api/images/created/:filename).
		if (namespace !== "generic") {
			return next();
		}

		if (!key) {
			return res.status(400).json({ error: "Invalid key" });
		}

		// Public-read subset: profile images (avatars/covers) and edited images (provider fetch) are viewable without auth.
		const isPublicProfileKey =
			key.startsWith("profile/") && !key.includes("..") && !key.startsWith("profile//");
		const isPublicEditedKey =
			key.startsWith("edited/") && !key.includes("..") && !key.startsWith("edited//");
		if (!isPublicProfileKey && !isPublicEditedKey && !req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		try {
			if (!storage?.getGenericImageBuffer) {
				return res.status(500).json({ error: "Generic images storage not available" });
			}

			const buffer = await storage.getGenericImageBuffer(key);
			res.setHeader("Content-Type", guessContentType(key));
			res.setHeader("Cache-Control", "public, max-age=3600");
			return res.send(buffer);
		} catch (error) {
			const message = String(error?.message || "");
			if (message.toLowerCase().includes("not found")) {
				return res.status(404).json({ error: "Image not found" });
			}
			// console.error("Error serving generic image:", error);
			return res.status(500).json({ error: "Failed to serve image" });
		}
	});

	// Upload generic images (avatar/cover/etc). Body is raw bytes; Content-Type must be an image.
	router.post(
		"/api/images/:namespace",
		express.raw({
			type: (req) => {
				const ct = String(req.headers["content-type"] || "").toLowerCase();
				return ct.startsWith("image/") || ct === "application/octet-stream";
			},
			limit: "12mb"
		}),
		async (req, res, next) => {
			const namespace = String(req.params.namespace || "").toLowerCase();
			if (namespace !== "generic") return next();

			if (!req.auth?.userId) {
				return res.status(401).json({
					error: "Unauthorized",
					code: "LOGIN_REQUIRED",
					message: "You must be logged in to upload images."
				});
			}

			if (!storage?.uploadGenericImage) {
				return res.status(500).json({ error: "Generic images storage not available" });
			}

			let buffer = req.body;
			if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
				return res.status(400).json({ error: "Empty upload" });
			}

			const kind = normalizeUploadKind(req.headers["x-upload-kind"]);
			const originalName = String(req.headers["x-upload-name"] || "");
			const contentType = String(req.headers["content-type"] || "application/octet-stream");
			const ext = path.extname(originalName) || extFromContentType(contentType) || ".png";

			const now = Date.now();
			const rand = Math.random().toString(36).slice(2, 9);
			const userPart = safeKeySegment(String(req.auth.userId));

			if (kind === "edited") {
				try {
					const meta = await sharp(buffer).metadata();
					if (
						typeof meta.width === "number" &&
						typeof meta.height === "number" &&
						(meta.width !== 1024 || meta.height !== 1024)
					) {
						buffer = await sharp(buffer)
							.resize(1024, 1024, {
								fit: "cover",
								position: "entropy"
							})
							.png()
							.toBuffer();
					} else {
						buffer = await sharp(buffer).png().toBuffer();
					}
				} catch (err) {
					return res.status(400).json({ error: "Invalid image" });
				}
			}

			const key =
				kind === "edited"
					? `edited/${userPart}/${now}_${rand}.png`
					: `profile/${userPart}/${kind}_${now}_${rand}${ext}`;

			try {
				const storedKey = await storage.uploadGenericImage(buffer, key, {
					contentType: kind === "edited" ? "image/png" : contentType
				});
				return res.json({
					ok: true,
					key: storedKey,
					url: buildImageUrl("generic", storedKey)
				});
			} catch (error) {
				// console.error("Error uploading generic image:", error);
				return res.status(500).json({ error: "Failed to upload image" });
			}
		}
	);

	return router;
}

