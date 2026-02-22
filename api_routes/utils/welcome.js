function safeJsonParse(value, fallback) {
	if (value == null) return fallback;
	if (typeof value === "object") return value;
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	try {
		return JSON.parse(trimmed);
	} catch {
		return fallback;
	}
}

export const WELCOME_VERSION = 1;

function normalizeUserName(profileRow) {
	const raw = profileRow?.user_name;
	const name = typeof raw === "string" ? raw.trim() : "";
	return name || null;
}

function getMeta(profileRow) {
	const raw = profileRow?.meta;
	const parsed = safeJsonParse(raw, {});
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
	return {};
}

function getMetaWelcomeVersion(profileRow) {
	const meta = getMeta(profileRow);
	// Back-compat: previously used a different key name.
	const legacy = meta?.["onb_version"];
	const value = meta?.welcome_version ?? legacy;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 0;
	return Math.max(0, Math.floor(parsed));
}

// Back-compat: before we tracked version, having a username implies v1 completion.
function getEffectiveWelcomeVersion(profileRow) {
	const metaVersion = getMetaWelcomeVersion(profileRow);
	const userName = normalizeUserName(profileRow);
	if (userName && metaVersion < 1) return 1;
	return metaVersion;
}

export function computeWelcome({ profileRow } = {}) {
	const userName = normalizeUserName(profileRow);
	const effectiveVersion = getEffectiveWelcomeVersion(profileRow);

	// v1: require username (unique, permanent)
	if (!userName) {
		return {
			required: true,
			version: WELCOME_VERSION,
			step: "choose_username"
		};
	}

	if (effectiveVersion < WELCOME_VERSION) {
		// Future-proof: if we bump WELCOME_VERSION without adding new derived checks,
		// force the user through the welcome flow once to collect any new non-derived flags.
		return {
			required: true,
			version: WELCOME_VERSION,
			step: "upgrade_welcome"
		};
	}

	return {
		required: false,
		version: WELCOME_VERSION,
		step: null
	};
}

export function isWelcomed({ profileRow } = {}) {
	return computeWelcome({ profileRow }).required === false;
}

