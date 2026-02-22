import { expressjwt } from "express-jwt";
import crypto from "crypto";

const COOKIE_NAME = "ps_session";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_SKIP_PREFIXES = [
	"/static",
	"/favicon",
	"/robots.txt",
	"/api/images/created/"
];
const SESSION_REFRESH_SKIP_EXTENSIONS = new Set([
	".css",
	".js",
	".mjs",
	".json",
	".map",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".svg",
	".ico",
	".woff",
	".woff2",
	".ttf",
	".otf"
]);

function getJwtSecret() {
	return process.env.SESSION_SECRET || "dev-secret-change-me";
}

function shouldLogSession() {
	return process.env.ENABLE_SESSION_LOGS === "true";
}

function authMiddleware() {
	return expressjwt({
		secret: getJwtSecret(),
		algorithms: ["HS256"],
		credentialsRequired: false,
		requestProperty: "auth",
		getToken: (req) => req.cookies?.[COOKIE_NAME]
	});
}

function hashToken(token) {
	return crypto.createHash("sha256").update(token).digest("hex");
}

function shouldSkipSessionRefresh(req) {
	if (!req?.path) {
		return false;
	}

	if (SESSION_REFRESH_SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
		return true;
	}

	const lastDot = req.path.lastIndexOf(".");
	if (lastDot > -1) {
		const ext = req.path.slice(lastDot).toLowerCase();
		if (SESSION_REFRESH_SKIP_EXTENSIONS.has(ext)) {
			return true;
		}
	}

	return false;
}

function sessionMiddleware(queries = {}) {
	if (!queries.selectSessionByTokenHash || !queries.refreshSessionExpiry) {
		return (req, res, next) => next();
	}

	return async (req, res, next) => {
		const token = req.cookies?.[COOKIE_NAME];
		const userId = req.auth?.userId;

		if (!token) {
			if (shouldLogSession()) {
				// console.log(`[SessionMiddleware] No token in cookies for path: ${req.path}`);
			}
			return next();
		}

		if (!userId) {
			if (shouldLogSession()) {
				// console.log(`[SessionMiddleware] Token present but no userId in auth for path: ${req.path}`);
			}
			return next();
		}

		if (shouldLogSession()) {
			// console.log(`[SessionMiddleware] Checking session for user ${userId}, path: ${req.path}`);
		}

		try {
			const tokenHash = hashToken(token);
			if (shouldLogSession()) {
				// console.log(`[SessionMiddleware] Looking up session with tokenHash: ${tokenHash.substring(0, 8)}...`);
			}

			const session = await queries.selectSessionByTokenHash.get(
				tokenHash,
				userId
			);

			if (!session) {
				// If session not found but JWT is valid, be lenient - don't clear cookie immediately
				// This handles race conditions, DB replication lag, or transient DB issues
				if (shouldLogSession()) {
					// console.warn(
					//   `[SessionMiddleware] Session not found for user ${userId} (tokenHash: ${tokenHash.substring(0, 8)}...) but JWT is valid. ` +
					//   `Path: ${req.path}. This may be a race condition or DB lag. Allowing request to proceed.`
					// );
				}
				// Don't clear cookie - let the JWT validation handle auth
				// The session might be created shortly or there's a transient DB issue
				return next();
			}

			if (shouldLogSession()) {
				// console.log(`[SessionMiddleware] Session found: id=${session.id}, expires_at=${session.expires_at}`);
			}

			const expiresAtMs = Date.parse(session.expires_at);
			const now = Date.now();

			if (!Number.isFinite(expiresAtMs)) {
				if (shouldLogSession()) {
					// console.error(
					//   `[SessionMiddleware] Invalid expires_at format: ${session.expires_at} for session ${session.id}, user ${userId}`
					// );
				}
				// Invalid date format - treat as expired
				await queries.deleteSessionByTokenHash?.run(tokenHash, userId);
				clearAuthCookie(res, req);
				req.auth = null;
				if (shouldLogSession()) {
					// console.log(`[SessionMiddleware] Cleared cookie due to invalid expiry date. Path: ${req.path}`);
				}
				if (req.path.startsWith("/api/") || req.path === "/me") {
					return res.status(401).json({ error: "Unauthorized" });
				}
				return next();
			}

			if (expiresAtMs <= now) {
				// Session is expired - this is a legitimate reason to clear
				const expiredSecondsAgo = Math.floor((now - expiresAtMs) / 1000);
				if (shouldLogSession()) {
					// console.log(
					//   `[SessionMiddleware] Session expired ${expiredSecondsAgo}s ago for user ${userId}. ` +
					//   `Expired at: ${session.expires_at}, now: ${new Date(now).toISOString()}. Clearing cookie.`
					// );
				}
				await queries.deleteSessionByTokenHash?.run(tokenHash, userId);
				clearAuthCookie(res, req);
				req.auth = null;
				if (req.path.startsWith("/api/") || req.path === "/me") {
					return res.status(401).json({ error: "Unauthorized" });
				}
				return next();
			}

			// Throttled update of last_active_at (at most once per 15 min per user)
			try {
				await queries.updateUserLastActive?.run?.(userId);
			} catch {
				// Non-fatal; do not block the request
			}

			if (shouldSkipSessionRefresh(req)) {
				return next();
			}

			const refreshThreshold = now + SESSION_REFRESH_WINDOW_MS;
			if (expiresAtMs > refreshThreshold) {
				return next();
			}

			// Session is valid but near expiry - refresh it and continue
			const refreshedAt = new Date(now + ONE_WEEK_MS).toISOString();
			if (shouldLogSession()) {
				// console.log(
				//   `[SessionMiddleware] Refreshing session ${session.id} expiry to ${refreshedAt}`
				// );
			}

			try {
				await queries.refreshSessionExpiry.run(session.id, refreshedAt);
				setAuthCookie(res, token, req);
				if (shouldLogSession()) {
					// console.log(`[SessionMiddleware] Session refreshed successfully for user ${userId}`);
				}
			} catch (refreshError) {
				if (shouldLogSession()) {
					// console.error(
					//   `[SessionMiddleware] Failed to refresh session ${session.id} for user ${userId}:`,
					//   refreshError
					// );
				}
				// Don't fail the request if refresh fails - session is still valid
			}

			return next();
		} catch (error) {
			// If database query fails, don't clear the cookie - it might be a transient error
			if (shouldLogSession()) {
				// console.error(
				//   `[SessionMiddleware] Database error during session lookup for user ${userId}, path: ${req.path}`,
				//   {
				//     error: error.message,
				//     stack: error.stack,
				//     name: error.name
				//   }
				// );
			}
			// Don't clear cookie on database errors - let it retry on next request
			// The JWT is still valid, so the user should be able to proceed
			return next();
		}
	};
}

function probabilisticSessionCleanup(queries = {}, options = {}) {
	if (!queries.deleteExpiredSessions) {
		return (req, res, next) => next();
	}

	const chance =
		Number.isFinite(options.chance) && options.chance > 0
			? options.chance
			: 0.01;

	return async (req, res, next) => {
		if (Math.random() > chance) {
			return next();
		}

		const now = new Date().toISOString();
		if (shouldLogSession()) {
			// console.log(`[SessionCleanup] Running cleanup for expired sessions before ${now}`);
		}
		try {
			const result = await queries.deleteExpiredSessions.run(now);
			if (shouldLogSession()) {
				// console.log(`[SessionCleanup] Cleanup completed, deleted ${result.changes || 0} expired sessions`);
			}
		} catch (error) {
			if (shouldLogSession()) {
				// console.error("[SessionCleanup] Cleanup failed:", {
				//   error: error.message,
				//   stack: error.stack,
				//   name: error.name
				// });
			}
		}

		return next();
	};
}

function isSecureRequest(req) {
	// Check if request is over HTTPS
	// Vercel sets x-forwarded-proto header
	if (req) {
		return (
			req.secure ||
			req.headers["x-forwarded-proto"] === "https" ||
			process.env.NODE_ENV === "production"
		);
	}
	// Fallback to NODE_ENV check if req not available
	return process.env.NODE_ENV === "production";
}

function setAuthCookie(res, token, req = null) {
	const isSecure = isSecureRequest(req);
	// For Vercel/production, use 'none' with secure to ensure cookies work with fetch requests
	// 'lax' doesn't send cookies with cross-site fetch requests, even on same domain
	const sameSite = isSecure ? "none" : "lax";
	const cookieOptions = {
		httpOnly: true,
		sameSite: sameSite,
		secure: isSecure,
		maxAge: ONE_WEEK_MS,
		path: "/"
	};
	if (shouldLogSession()) {
		// console.log(`[setAuthCookie] Setting cookie with options:`, {
		//   sameSite,
		//   secure: isSecure,
		//   path: cookieOptions.path,
		//   maxAge: `${ONE_WEEK_MS}ms (${Math.floor(ONE_WEEK_MS / 86400000)} days)`
		// });
	}
	res.cookie(COOKIE_NAME, token, cookieOptions);
}

function clearAuthCookie(res, req = null) {
	const isSecure = isSecureRequest(req);
	// Must match the same options used in setAuthCookie for clearCookie to work
	const sameSite = isSecure ? "none" : "lax";
	const cookieOptions = {
		httpOnly: true,
		sameSite: sameSite,
		secure: isSecure,
		path: "/"
	};
	const path = req?.path || "unknown";
	if (shouldLogSession()) {
		// console.log(`[clearAuthCookie] Clearing cookie for path: ${path}`, {
		//   sameSite,
		//   secure: isSecure,
		//   path: cookieOptions.path
		// });
	}
	res.clearCookie(COOKIE_NAME, cookieOptions);
}

export {
	COOKIE_NAME,
	ONE_WEEK_MS,
	getJwtSecret,
	authMiddleware,
	sessionMiddleware,
	probabilisticSessionCleanup,
	hashToken,
	setAuthCookie,
	clearAuthCookie,
	shouldLogSession
};
