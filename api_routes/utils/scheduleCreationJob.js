import { getBaseAppUrl } from "./url.js";

function hasNonEmpty(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function logCreation(...args) {
	console.log("[Creation]", ...args);
}

function logCreationError(...args) {
	console.error("[Creation]", ...args);
}

export async function scheduleCreationJob({ payload, runCreationJob, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;

	logCreation("scheduleCreationJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		created_image_id: payload?.created_image_id,
		user_id: payload?.user_id,
		server_id: payload?.server_id,
		method: payload?.method
	});

	// cloud: enqueue via QStash
	if (isVercel && !hasNonEmpty(qstashToken)) {
		const error = new Error("QStash token is required on Vercel. Set UPSTASH_QSTASH_TOKEN environment variable.");
		logCreationError("QStash token missing on Vercel");
		throw error;
	}
	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/worker/create", getBaseAppUrl()).toString();
		const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
		const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;

		logCreation("Publishing job to QStash", {
			publish_url: publishUrl,
			callback_url: callbackUrl
		});

		const res = await fetch(publishUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${qstashToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const error = new Error(`Failed to publish QStash job: ${res.status} ${res.statusText} ${text}`.trim());
			logCreationError("QStash publish failed", {
				status: res.status,
				statusText: res.statusText,
				response: text.substring(0, 200)
			});
			throw error;
		}

		logCreation("Job successfully enqueued to QStash");
		return { enqueued: true };
	}

	// Local: fire-and-forget in-process.
	logCreation("Running job locally (fire-and-forget)");
	queueMicrotask(() => {
		Promise.resolve(runCreationJob({ payload })).catch((err) => {
			logCreationError("runCreationJob failed in local mode:", err);
			log.error("runCreationJob failed:", err);
		});
	});

	return { enqueued: false };
}

/** Schedule landscape (outpaint) job: same callback as creation job; worker branches on job_type. */
export async function scheduleLandscapeJob({ payload, runLandscapeJob, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;
	const body = { ...payload, job_type: "landscape" };

	logCreation("scheduleLandscapeJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		created_image_id: payload?.created_image_id,
		user_id: payload?.user_id,
		server_id: payload?.server_id,
	});

	if (isVercel && !hasNonEmpty(qstashToken)) {
		const error = new Error("QStash token is required on Vercel. Set UPSTASH_QSTASH_TOKEN environment variable.");
		logCreationError("QStash token missing on Vercel (landscape)");
		throw error;
	}
	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/worker/create", getBaseAppUrl()).toString();
		const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
		const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;
		logCreation("Publishing landscape job to QStash", { callback_url: callbackUrl });
		const res = await fetch(publishUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${qstashToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const error = new Error(`Failed to publish QStash landscape job: ${res.status} ${res.statusText} ${text}`.trim());
			logCreationError("QStash landscape publish failed", { status: res.status, response: text.substring(0, 200) });
			throw error;
		}
		logCreation("Landscape job successfully enqueued to QStash");
		return { enqueued: true };
	}

	logCreation("Running landscape job locally (fire-and-forget)");
	queueMicrotask(() => {
		Promise.resolve(runLandscapeJob({ payload })).catch((err) => {
			logCreationError("runLandscapeJob failed in local mode:", err);
			log.error("runLandscapeJob failed:", err);
		});
	});
	return { enqueued: false };
}

/** Schedule anonymous (try) creation job: QStash on Vercel, in-process locally. */
export async function scheduleAnonCreationJob({ payload, runAnonCreationJob, log = console }) {
	const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
	const isVercel = !!process.env.VERCEL;

	logCreation("scheduleAnonCreationJob called", {
		isVercel,
		has_qstash_token: !!qstashToken,
		created_image_anon_id: payload?.created_image_anon_id,
		server_id: payload?.server_id,
		method: payload?.method
	});

	if (isVercel && !hasNonEmpty(qstashToken)) {
		const error = new Error("QStash token is required on Vercel. Set UPSTASH_QSTASH_TOKEN environment variable.");
		logCreationError("QStash token missing on Vercel (anon)");
		throw error;
	}
	if (isVercel && hasNonEmpty(qstashToken)) {
		const callbackUrl = new URL("/api/try/worker", getBaseAppUrl()).toString();
		const qstashBaseUrl = process.env.UPSTASH_QSTASH_URL;
		const publishUrl = `${qstashBaseUrl}/v2/publish/${callbackUrl}`;
		logCreation("Publishing anon job to QStash", { callback_url: callbackUrl });
		const res = await fetch(publishUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${qstashToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const error = new Error(`Failed to publish QStash anon job: ${res.status} ${res.statusText} ${text}`.trim());
			logCreationError("QStash anon publish failed", { status: res.status, response: text.substring(0, 200) });
			throw error;
		}
		logCreation("Anon job successfully enqueued to QStash");
		return { enqueued: true };
	}

	logCreation("Running anon job locally (fire-and-forget)");
	queueMicrotask(() => {
		Promise.resolve(runAnonCreationJob({ payload })).catch((err) => {
			logCreationError("runAnonCreationJob failed in local mode:", err);
			log.error("runAnonCreationJob failed:", err);
		});
	});
	return { enqueued: false };
}

