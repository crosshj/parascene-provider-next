import { Receiver } from "@upstash/qstash";

let receiverInstance = null;

function logQStash(...args) {
	console.log("[QStash]", ...args);
}

function logQStashError(...args) {
	console.error("[QStash]", ...args);
}

function getReceiver() {
	if (!receiverInstance) {
		const currentSigningKey = process.env.UPSTASH_QSTASH_CURRENT_SIGNING_KEY;
		const nextSigningKey = process.env.UPSTASH_QSTASH_NEXT_SIGNING_KEY;

		if (!currentSigningKey && !nextSigningKey) {
			logQStashError("QStash receiver: No signing keys configured");
			return null;
		}

		logQStash("Initializing QStash receiver", {
			has_current_key: !!currentSigningKey,
			has_next_key: !!nextSigningKey
		});

		const receiverConfig = {};
		if (currentSigningKey) {
			receiverConfig.currentSigningKey = currentSigningKey;
		}
		if (nextSigningKey) {
			receiverConfig.nextSigningKey = nextSigningKey;
		}

		receiverInstance = new Receiver(receiverConfig);
	}
	return receiverInstance;
}
export async function verifyQStashRequest(req) {
	const receiver = getReceiver();
	if (!receiver) {
		// Most common cause: signing keys not configured in the environment
		logQStashError("QStash verification failed: No receiver instance", {
			has_current_key_env: !!process.env.UPSTASH_QSTASH_CURRENT_SIGNING_KEY,
			has_next_key_env: !!process.env.UPSTASH_QSTASH_NEXT_SIGNING_KEY,
		});
		return false;
	}

	// Support both Express req objects (with .get()) and Vercel native req objects (with headers object)
	const headers = req.headers || {};
	const upstashHeader = req.get ? req.get("Upstash-Signature") : headers["Upstash-Signature"];
	const lowercaseHeader = req.get ? req.get("upstash-signature") : headers["upstash-signature"];
	const signature = upstashHeader || lowercaseHeader;
	if (!signature) {
		logQStashError("QStash verification failed: No signature header", {
			has_upstash_header: !!upstashHeader,
			has_lowercase_header: !!lowercaseHeader,
		});
		return false;
	}

	// Use raw body when set (e.g. cron route mounted with express.raw()). Otherwise: QStash signs the raw body;
	// for empty POST (e.g. cron) that is "". Vercel/serverless often parses empty body as {} so we must use ""
	// for verification when body is missing or empty object, else we'd pass "{}" and body hash would not match.
	const body =
		req.rawBodyForVerify !== undefined
			? req.rawBodyForVerify
			: typeof req.body === "string"
				? req.body
				: req.body != null && typeof req.body === "object" && Object.keys(req.body).length === 0
					? ""
					: req.body != null
						? JSON.stringify(req.body)
						: "";
	const path = req.originalUrl || req.url || "/api/worker/create";

	logQStash("Verifying QStash signature", {
		path,
		has_body: !!body,
		body_length: body?.length || 0,
		signature_length: signature?.length || 0,
	});

	try {
		await receiver.verify({
			body,
			signature,
		});
		logQStash("QStash signature verified successfully");
		return true;
	} catch (err) {
		logQStashError("QStash signature verification failed", {
			error: err.message,
			error_type: err.constructor.name,
			path,
		});
		return false;
	}
}
