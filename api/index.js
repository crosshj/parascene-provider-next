import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { openDb } from "../db/index.js";
import createAdminRoutes from "../api_routes/admin.js";
import createExploreRoutes from "../api_routes/explore.js";
import createFeedRoutes from "../api_routes/feed.js";
import createCreateRoutes from "../api_routes/create.js";
import createCreationsRoutes from "../api_routes/creations.js";
import createImagesRoutes from "../api_routes/images.js";
import createPageRoutes from "../api_routes/pages.js";
import createHelpRoutes from "../api_routes/help.js";
import createProviderRoutes from "../api_routes/provider.js";
import createServersRoutes from "../api_routes/servers.js";
import createTemplatesRoutes from "../api_routes/templates.js";
import createLikesRoutes from "../api_routes/likes.js";
import createCommentsRoutes from "../api_routes/comments.js";
import createUserRoutes from "../api_routes/user.js";
import createFollowsRoutes from "../api_routes/follows.js";
import createTodoRoutes from "../api_routes/todo.js";
import createYoutubeRoutes from "../api_routes/youtube.js";
import createXRoutes from "../api_routes/x.js";
import createFeatureRequestRoutes from "../api_routes/feature_requests.js";
import createShareRoutes from "../api_routes/share.js";
import createQRRoutes from "../api_routes/qr.js";
import createPolicyRoutes from "../api_routes/policy.js";
import createTryRoutes from "../api_routes/try.js";
import { computeWelcome } from "../api_routes/utils/welcome.js";
import {
	authMiddleware,
	clearAuthCookie,
	COOKIE_NAME,
	probabilisticSessionCleanup,
	sessionMiddleware,
	shouldLogSession
} from "../api_routes/auth.js";
import { injectCommonHead } from "../api_routes/utils/head.js";

function shouldLogStartup() {
	return process.env.ENABLE_STARTUP_LOGS === "true";
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
	// console.error("Unhandled Promise Rejection:", reason);
	if (reason instanceof Error) {
		// console.error("Error stack:", reason.stack);
	}
	// Don't exit in production, but log the error
	if (process.env.NODE_ENV === "production") {
		// console.error("Continuing in production mode...");
	} else {
		// console.error("Exiting due to unhandled rejection in development");
		process.exit(1);
	}
});

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pagesDir = path.join(__dirname, "..", "pages");
const staticDir = path.join(__dirname, "..", "public");

// Initialize database asynchronously using top-level await
let queries, storage;
try {
	if (shouldLogStartup()) {
		// console.log("[Startup] Initializing database...");
		// console.log("[Startup] Environment:", {
		// 	VERCEL: !!process.env.VERCEL,
		// 	NODE_ENV: process.env.NODE_ENV,
		// 	DB_ADAPTER: process.env.DB_ADAPTER || "sqlite (default)"
		// });
	}
	const dbResult = await openDb();
	queries = dbResult.queries;
	storage = dbResult.storage;
	if (shouldLogStartup()) {
		// console.log("[Startup] Database initialized successfully");
	}
} catch (error) {
	if (shouldLogStartup()) {
		// console.error("[Startup] Failed to initialize database:", error);
		// console.error("[Startup] Error details:", error.message);
		if (error.message?.includes("Missing required env var")) {
			// console.error("\n[Startup] Please ensure all required environment variables are set.");
			// console.error("[Startup] For Supabase: SUPABASE_URL and SUPABASE_ANON_KEY are required.");
		}
	}
	process.exit(1);
}

// CRITICAL: Log EVERY request at the absolute top to see if Vercel is invoking the function
// app.use((req, res, next) => {
// 	console.log("[Vercel] Function invoked", {
// 		method: req.method,
// 		path: req.path,
// 		originalUrl: req.originalUrl,
// 		url: req.url,
// 		timestamp: new Date().toISOString(),
// 		userAgent: req.get("user-agent"),
// 	});
// 	next();
// });

// On Vercel, static files are served from public/ automatically, so skip express.static
// Locally, Express serves static files from public/
if (!process.env.VERCEL) {
	app.use(express.static(staticDir));
}
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// CORS: allow credentials so cookies are sent when frontend is on a different origin (e.g. dev port).
app.use((req, res, next) => {
	const origin = req.get("origin");
	if (origin) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Credentials", "true");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-upload-kind, X-upload-name");
	}
	if (req.method === "OPTIONS") {
		return res.sendStatus(204);
	}
	next();
});

// Make storage accessible to routes that need it.
app.locals.storage = storage;

// Add request logging middleware for debugging
app.use((req, res, next) => {
	if (shouldLogSession()) {
		// console.log(`[Request] ${req.method} ${req.path}`, {
		// 	hasCookie: !!req.cookies?.[COOKIE_NAME],
		// 	cookieValue: req.cookies?.[COOKIE_NAME] ? `${req.cookies[COOKIE_NAME].substring(0, 20)}...` : "none",
		// 	userAgent: req.get("user-agent")?.substring(0, 50),
		// 	referer: req.get("referer")
		// });
	}
	next();
});

app.use(authMiddleware());
app.use(sessionMiddleware(queries));
app.use(probabilisticSessionCleanup(queries));

// Welcome gate: block most authenticated actions until user is welcomed.
app.use(async (req, res, next) => {
	const userId = req.auth?.userId;
	if (!userId) {
		return next();
	}

	try {
		const method = String(req.method || "GET").toUpperCase();
		const pathName = String(req.path || "");

		const allow =
			(pathName === "/welcome" && method === "GET") ||
			(pathName === "/api/profile" && (method === "GET" || method === "PUT" || method === "POST")) ||
			(pathName === "/api/account/email" && method === "PUT") ||
			(pathName === "/api/username-suggest" && method === "GET") ||
			(pathName === "/api/policy/seen" && method === "POST") ||
			(pathName === "/api/try/create" && method === "POST") ||
			(pathName === "/api/try/list" && method === "GET") ||
			(pathName === "/api/try/discard" && method === "POST") ||
			(pathName.startsWith("/api/try/images/") && method === "GET") ||
			(pathName === "/api/qr" && method === "GET") ||
			(pathName === "/logout" && method === "POST") ||
			(pathName === "/auth.html" && method === "GET") ||
			(pathName === "/me" && method === "GET");
		if (allow) {
			return next();
		}

		const profileRow = await queries.selectUserProfileByUserId?.get(userId);
		const welcome = computeWelcome({ profileRow });
		if (!welcome.required) {
			return next();
		}

		if (pathName.startsWith("/api/")) {
			return res.status(409).json({ error: "WELCOME_REQUIRED", welcome });
		}

		return res.redirect("/welcome");
	} catch {
		// Fail-open on unexpected errors to avoid hard-locking the app.
		return next();
	}
});

app.use(createUserRoutes({ queries }));
app.use(createFollowsRoutes({ queries }));

app.use(createAdminRoutes({ queries, storage }));
app.use(createFeedRoutes({ queries }));
app.use(createExploreRoutes({ queries }));
app.use(createCreateRoutes({ queries, storage }));
app.use(createImagesRoutes({ storage }));
app.use(createCreationsRoutes({ queries }));
app.use(createLikesRoutes({ queries }));
app.use(createCommentsRoutes({ queries }));
app.use(createShareRoutes({ queries, storage }));
app.use(createQRRoutes());
app.use(createProviderRoutes({ queries }));
app.use(createServersRoutes({ queries }));
app.use(createTemplatesRoutes({ queries }));
app.use(createHelpRoutes({ pagesDir, queries }));
app.use(createPageRoutes({ queries, pagesDir, staticDir }));
app.use(createTodoRoutes());
app.use(createPolicyRoutes());
app.use(createTryRoutes({ queries, storage }));
app.use(createYoutubeRoutes());
app.use(createXRoutes());
app.use(createFeatureRequestRoutes({ queries }));

app.use(async (err, req, res, next) => {
	if (err?.name !== "UnauthorizedError") {
		return next(err);
	}

	console.log("[ErrorHandler] UnauthorizedError", {
		path: req.path,
		originalUrl: req.originalUrl,
		hasCookie: !!req.cookies?.[COOKIE_NAME],
		error: err.message
	});

	// Only clear cookie if one was actually sent in the request
	// This prevents clearing cookies that weren't sent (e.g., due to SameSite issues)
	if (req.cookies?.[COOKIE_NAME]) {
		clearAuthCookie(res, req);
	}

	if (req.path.startsWith("/api/") || req.path === "/me") {
		return res.status(401).json({ error: "Unauthorized" });
	}

	// Preserve the user's original destination so login can return them there.
	// Avoid redirect loops when the user is already on the auth page.
	if (req.path === "/auth.html") {
		const fs = await import("fs/promises");
		let htmlContent = await fs.readFile(path.join(pagesDir, "auth.html"), "utf-8");
		htmlContent = injectCommonHead(htmlContent);
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	}
	try {
		const rawReturnUrl = typeof req.originalUrl === "string" ? req.originalUrl : "/";
		const returnUrl =
			rawReturnUrl.startsWith("/") && !rawReturnUrl.startsWith("//") && !rawReturnUrl.includes("://")
				? rawReturnUrl
				: "/";
		const qs = new URLSearchParams({ returnUrl });
		return res.redirect(`/auth.html?${qs.toString()}`);
	} catch {
		const fs = await import("fs/promises");
		let htmlContent = await fs.readFile(path.join(pagesDir, "auth.html"), "utf-8");
		htmlContent = injectCommonHead(htmlContent);
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	}
});

if (process.env.NODE_ENV !== "production") {
	app.listen(port, () => {
		console.log(`Parascene dev server running on http://localhost:${port}`);
	});
}

// Log startup completion
if (shouldLogStartup()) {
	// console.log("[Startup] Express app configured and ready");
	// console.log("[Startup] Routes registered:", {
	// 	userRoutes: "✓",
	// 	adminRoutes: "✓",
	// 	feedRoutes: "✓",
	// 	exploreRoutes: "✓",
	// 	createRoutes: "✓",
	// 	creationsRoutes: "✓",
	// 	providerRoutes: "✓",
	// 	serversRoutes: "✓",
	// 	templatesRoutes: "✓",
	// 	pageRoutes: "✓"
	// });
}

export default app;
