import { getBaseAppUrl } from "./url.js";

function logCreation(...args) {
	console.log("[Creation]", ...args);
}

function logCreationError(...args) {
	console.error("[Creation]", ...args);
}

// Local: fire-and-forget in-process. Bypassing QStash for local Docker environment.

/** Schedule standard creation job */
export async function scheduleCreationJob({ payload, runCreationJob, log = console }) {
	logCreation("Running creation job locally (fire-and-forget)");

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
	const body = { ...payload, job_type: "landscape" };

	logCreation("Running landscape job locally (fire-and-forget)");

	queueMicrotask(() => {
		Promise.resolve(runLandscapeJob({ payload: body })).catch((err) => {
			logCreationError("runLandscapeJob failed in local mode:", err);
			log.error("runLandscapeJob failed:", err);
		});
	});

	return { enqueued: false };
}

/** Schedule anonymous (try) creation job: in-process locally. */
export async function scheduleAnonCreationJob({ payload, runAnonCreationJob, log = console }) {
	logCreation("Running anon job locally (fire-and-forget)");

	queueMicrotask(() => {
		Promise.resolve(runAnonCreationJob({ payload })).catch((err) => {
			logCreationError("runAnonCreationJob failed in local mode:", err);
			log.error("runAnonCreationJob failed:", err);
		});
	});

	return { enqueued: false };
}