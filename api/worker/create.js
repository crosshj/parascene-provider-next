// export default async function handler(req, res) {
// 	console.log("[Worker] HIT", req.method, req.url);
// 	return res.status(200).send("ok");
// }

import "dotenv/config";
import { openDb } from "../../db/index.js";
import { verifyQStashRequest } from "../../api_routes/utils/qstashVerification.js";
import { runCreationJob } from "../../api_routes/utils/creationJob.js";
import { runLandscapeJob } from "../../api_routes/utils/landscapeJob.js";

// Log immediately when module loads to verify function is being deployed
console.log("[Worker] Module loaded at", new Date().toISOString());

function logCreation(...args) {
	console.log("[Creation]", ...args);
}

function logCreationError(...args) {
	console.error("[Creation]", ...args);
}

// Standalone Vercel serverless function for QStash worker
// This bypasses Express entirely to avoid auth middleware and caching issues
export default async function handler(req, res) {
	console.log("[Worker] Standalone function invoked", {
		method: req.method,
		url: req.url,
		timestamp: new Date().toISOString(),
		hasBody: !!req.body,
	});

	// Disable caching for this endpoint - QStash webhooks should never be cached
	res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
	res.setHeader("Pragma", "no-cache");
	res.setHeader("Expires", "0");

	// Only allow POST
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	try {
		logCreation("Worker endpoint called (standalone function)", {
			has_body: !!req.body,
			created_image_id: req.body?.created_image_id,
			user_id: req.body?.user_id,
			method: req.method,
		});

		if (!process.env.UPSTASH_QSTASH_TOKEN) {
			logCreationError("QStash not configured");
			return res.status(503).json({ error: "QStash not configured" });
		}

		// Verify QStash signature
		logCreation("Verifying QStash signature");
		const isValid = await verifyQStashRequest(req);
		if (!isValid) {
			logCreationError("Invalid QStash signature");
			return res.status(401).json({ error: "Invalid QStash signature" });
		}

		// Initialize database
		logCreation("Initializing database");
		const { queries, storage } = await openDb();

		const jobType = req.body?.job_type;
		if (jobType === "landscape") {
			logCreation("QStash signature verified, running landscape job");
			await runLandscapeJob({ queries, storage, payload: req.body });
			logCreation("Landscape job completed successfully");
		} else {
			// Run the creation job
			logCreation("QStash signature verified, running job");
			await runCreationJob({ queries, storage, payload: req.body });
			logCreation("Worker job completed successfully");
		}

		return res.json({ ok: true });
	} catch (error) {
		logCreationError("Worker failed with error:", {
			error: error.message,
			stack: error.stack,
			name: error.name,
		});
		console.error("Error running create worker:", error);
		return res.status(500).json({ ok: false, error: "Worker failed" });
	}
}
