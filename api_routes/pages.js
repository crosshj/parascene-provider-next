import express from "express";
import path from "path";
import { clearAuthCookie, COOKIE_NAME } from "./auth.js";
import { injectCommonHead } from "./utils/head.js";
import { getBaseAppUrl } from "./utils/url.js";
import { verifyShareToken } from "./utils/shareLink.js";

function getPageForUser(user) {
	const roleToPage = {
		consumer: "app.html",
		creator: "app.html",
		provider: "app.html",
		admin: "app-admin.html"
	};
	return roleToPage[user.role] || "app.html";
}

export default function createPageRoutes({ queries, pagesDir, staticDir }) {
	const router = express.Router();

	// Serve create page CSS so it loads when static middleware isn't used (e.g. Vercel)
	if (staticDir) {
		router.get("/pages/creations.css", (req, res, next) => {
			const cssPath = path.join(staticDir, "pages", "creations.css");
			res.type("text/css");
			res.sendFile(cssPath, (err) => {
				if (err) next();
			});
		});
	}

	let cachedShareTemplate = null;
	async function getShareTemplate() {
		if (cachedShareTemplate === null) {
			const fs = await import("fs/promises");
			cachedShareTemplate = await fs.readFile(path.join(pagesDir, "share.html"), "utf-8");
		}
		return cachedShareTemplate;
	}

	const shareHtmlCache = new Map();
	const SHARE_CACHE_TTL_MS = 60_000;

	const authLogo = `
		<div class="auth-logo share-auth-logo">
			<a href="/" class="auth-logo-link" aria-label="Parascene home">
				<svg class="logo" width="300" height="60" viewBox="0 0 185 40">
					<g class="logo-text">
					<path style="opacity: 1;" d="M 4.201 36.305 L 8.683 9.305 L 13.869 9.305 L 13.271 12.609 L 13.429 12.609 Q 13.922 11.801 14.721 10.975 Q 15.521 10.148 16.699 9.603 Q 17.877 9.059 19.459 9.059 Q 21.41 9.059 22.93 9.929 Q 24.451 10.799 25.339 12.53 Q 26.226 14.262 26.226 16.828 Q 26.226 18.937 25.637 21.126 Q 25.048 23.314 23.862 25.16 Q 22.675 27.006 20.882 28.148 Q 19.089 29.291 16.664 29.291 Q 14.994 29.291 13.93 28.711 Q 12.867 28.131 12.287 27.287 Q 11.707 26.443 11.461 25.652 L 11.214 25.652 L 9.474 36.305 Z M 15.17 25.055 Q 16.629 25.055 17.701 24.281 Q 18.773 23.508 19.476 22.295 Q 20.179 21.082 20.513 19.711 Q 20.847 18.34 20.847 17.127 Q 20.847 15.369 20.074 14.323 Q 19.3 13.277 17.683 13.277 Q 16.277 13.277 15.214 13.989 Q 14.15 14.701 13.438 15.87 Q 12.726 17.039 12.357 18.419 Q 11.988 19.799 11.988 21.152 Q 11.988 22.963 12.797 24.009 Q 13.605 25.055 15.17 25.055 Z M 34.036 29.291 Q 31.786 29.291 30.16 28.113 Q 28.534 26.936 27.848 24.677 Q 27.163 22.418 27.708 19.148 Q 28.27 15.791 29.729 13.55 Q 31.188 11.309 33.192 10.184 Q 35.196 9.059 37.376 9.059 Q 39.046 9.059 40.056 9.612 Q 41.067 10.166 41.612 10.992 Q 42.157 11.818 42.386 12.609 L 42.561 12.609 L 43.106 9.305 L 48.362 9.305 L 45.11 28.957 L 39.925 28.957 L 40.434 25.811 L 40.188 25.811 Q 39.678 26.619 38.852 27.419 Q 38.026 28.219 36.831 28.755 Q 35.636 29.291 34.036 29.291 Z M 36.374 25.055 Q 37.727 25.055 38.791 24.308 Q 39.854 23.561 40.575 22.233 Q 41.296 20.906 41.577 19.148 Q 41.876 17.355 41.603 16.037 Q 41.331 14.719 40.505 13.998 Q 39.678 13.277 38.325 13.277 Q 36.936 13.277 35.864 14.033 Q 34.792 14.789 34.097 16.107 Q 33.403 17.426 33.122 19.148 Q 32.841 20.871 33.104 22.207 Q 33.368 23.543 34.185 24.299 Q 35.003 25.055 36.374 25.055 Z M 48.344 28.957 L 51.596 9.305 L 56.694 9.305 L 56.149 12.732 L 56.36 12.732 Q 57.186 10.904 58.61 9.973 Q 60.034 9.041 61.686 9.041 Q 62.108 9.041 62.565 9.085 Q 63.022 9.129 63.373 9.217 L 62.582 13.928 Q 62.231 13.805 61.572 13.734 Q 60.913 13.664 60.35 13.664 Q 59.137 13.664 58.1 14.183 Q 57.063 14.701 56.369 15.624 Q 55.674 16.547 55.463 17.777 L 53.618 28.957 Z"></path>
					<path style="opacity: 0.7;" d="M 68.879 29.291 Q 66.629 29.291 65.003 28.113 Q 63.377 26.936 62.691 24.677 Q 62.006 22.418 62.551 19.148 Q 63.113 15.791 64.572 13.55 Q 66.031 11.309 68.035 10.184 Q 70.039 9.059 72.219 9.059 Q 73.888 9.059 74.899 9.612 Q 75.91 10.166 76.455 10.992 Q 77 11.818 77.228 12.609 L 77.404 12.609 L 77.949 9.305 L 83.205 9.305 L 79.953 28.957 L 74.767 28.957 L 75.277 25.811 L 75.031 25.811 Q 74.521 26.619 73.695 27.419 Q 72.869 28.219 71.674 28.755 Q 70.478 29.291 68.879 29.291 Z M 71.217 25.055 Q 72.57 25.055 73.634 24.308 Q 74.697 23.561 75.418 22.233 Q 76.138 20.906 76.42 19.148 Q 76.719 17.355 76.446 16.037 Q 76.174 14.719 75.347 13.998 Q 74.521 13.277 73.168 13.277 Q 71.779 13.277 70.707 14.033 Q 69.635 14.789 68.94 16.107 Q 68.246 17.426 67.965 19.148 Q 67.683 20.871 67.947 22.207 Q 68.211 23.543 69.028 24.299 Q 69.845 25.055 71.217 25.055 Z M 91.165 29.344 Q 88.792 29.344 87.035 28.649 Q 85.277 27.955 84.301 26.689 Q 83.326 25.424 83.22 23.684 Q 83.22 23.596 83.211 23.534 Q 83.203 23.473 83.203 23.42 L 88.142 22.91 Q 88.283 24.281 89.047 24.879 Q 89.812 25.477 91.412 25.477 Q 92.378 25.477 93.24 25.213 Q 94.101 24.949 94.672 24.448 Q 95.244 23.947 95.314 23.227 Q 95.367 22.559 94.883 22.102 Q 94.4 21.645 93.222 21.398 L 89.953 20.695 Q 87.386 20.15 86.156 18.77 Q 84.925 17.391 85.083 15.369 Q 85.207 13.33 86.455 11.924 Q 87.703 10.518 89.698 9.788 Q 91.693 9.059 94.048 9.059 Q 97.511 9.059 99.401 10.447 Q 101.29 11.836 101.537 14.086 Q 101.572 14.191 101.589 14.279 Q 101.607 14.367 101.607 14.473 L 96.914 14.947 Q 96.773 13.945 96.123 13.392 Q 95.472 12.838 94.066 12.838 Q 93.205 12.838 92.378 13.102 Q 91.552 13.365 90.99 13.857 Q 90.427 14.35 90.357 15.088 Q 90.287 15.756 90.744 16.195 Q 91.201 16.635 92.431 16.916 L 95.841 17.619 Q 98.425 18.146 99.665 19.43 Q 100.904 20.713 100.746 22.699 Q 100.64 24.264 99.84 25.494 Q 99.04 26.725 97.705 27.586 Q 96.369 28.447 94.69 28.895 Q 93.011 29.344 91.165 29.344 Z M 110.891 29.344 Q 108.272 29.344 106.409 28.315 Q 104.546 27.287 103.544 25.433 Q 102.542 23.578 102.542 21.082 Q 102.542 18.814 103.263 16.661 Q 103.983 14.508 105.389 12.794 Q 106.796 11.08 108.87 10.069 Q 110.944 9.059 113.669 9.059 Q 115.444 9.059 116.886 9.516 Q 118.327 9.973 119.373 10.834 Q 120.419 11.695 120.99 12.908 Q 121.561 14.121 121.597 15.633 L 116.587 16.477 Q 116.534 15.703 116.349 15.105 Q 116.165 14.508 115.805 14.077 Q 115.444 13.646 114.908 13.427 Q 114.372 13.207 113.616 13.207 Q 112.139 13.207 111.041 13.963 Q 109.942 14.719 109.239 15.932 Q 108.536 17.145 108.193 18.551 Q 107.85 19.957 107.85 21.24 Q 107.85 22.418 108.184 23.314 Q 108.518 24.211 109.23 24.703 Q 109.942 25.195 111.05 25.195 Q 111.841 25.195 112.561 24.949 Q 113.282 24.703 113.889 24.246 Q 114.495 23.789 114.97 23.147 Q 115.444 22.506 115.725 21.715 L 120.489 22.699 Q 119.962 24.246 119.056 25.468 Q 118.151 26.689 116.921 27.56 Q 115.69 28.43 114.17 28.887 Q 112.649 29.344 110.891 29.344 Z"></path>
					<path style="opacity: 1;" d="M 130.92 29.379 Q 128.301 29.379 126.403 28.421 Q 124.504 27.463 123.485 25.67 Q 122.465 23.877 122.465 21.363 Q 122.465 18.885 123.283 16.644 Q 124.1 14.402 125.612 12.68 Q 127.123 10.957 129.198 9.964 Q 131.272 8.971 133.768 8.971 Q 135.842 8.971 137.486 9.665 Q 139.129 10.359 140.078 11.634 Q 141.028 12.908 141.028 14.701 Q 141.028 16.529 139.955 17.716 Q 138.883 18.902 136.791 19.561 Q 134.7 20.221 131.641 20.484 Q 128.582 20.748 124.61 20.748 L 125.155 17.566 Q 128.512 17.566 130.665 17.452 Q 132.819 17.338 134.005 17.039 Q 135.192 16.74 135.658 16.239 Q 136.123 15.738 136.123 14.965 Q 136.123 14.033 135.341 13.488 Q 134.559 12.943 133.223 12.943 Q 131.5 12.943 130.393 13.84 Q 129.286 14.736 128.67 16.09 Q 128.055 17.443 127.8 18.894 Q 127.545 20.344 127.545 21.451 Q 127.545 22.576 127.888 23.473 Q 128.231 24.369 129.057 24.888 Q 129.883 25.406 131.307 25.406 Q 132.801 25.406 133.953 24.782 Q 135.104 24.158 135.614 23.051 L 140.342 23.684 Q 139.375 26.25 136.879 27.814 Q 134.383 29.379 130.92 29.379 Z M 149.071 17.742 L 147.208 28.957 L 141.934 28.957 L 145.204 9.305 L 150.161 9.305 L 149.475 14.209 L 149.106 14.033 Q 150.266 11.607 151.989 10.333 Q 153.712 9.059 156.102 9.059 Q 158.212 9.059 159.653 9.99 Q 161.094 10.922 161.692 12.627 Q 162.29 14.332 161.903 16.635 L 159.864 28.957 L 154.59 28.957 L 156.542 17.197 Q 156.858 15.352 156.067 14.411 Q 155.276 13.471 153.712 13.471 Q 152.534 13.471 151.558 13.998 Q 150.583 14.525 149.932 15.483 Q 149.282 16.441 149.071 17.742 Z M 172.076 29.379 Q 169.457 29.379 167.558 28.421 Q 165.66 27.463 164.64 25.67 Q 163.621 23.877 163.621 21.363 Q 163.621 18.885 164.438 16.644 Q 165.256 14.402 166.767 12.68 Q 168.279 10.957 170.353 9.964 Q 172.428 8.971 174.924 8.971 Q 176.998 8.971 178.641 9.665 Q 180.285 10.359 181.234 11.634 Q 182.183 12.908 182.183 14.701 Q 182.183 16.529 181.111 17.716 Q 180.039 18.902 177.947 19.561 Q 175.855 20.221 172.797 20.484 Q 169.738 20.748 165.765 20.748 L 166.31 17.566 Q 169.668 17.566 171.821 17.452 Q 173.974 17.338 175.161 17.039 Q 176.347 16.74 176.813 16.239 Q 177.279 15.738 177.279 14.965 Q 177.279 14.033 176.497 13.488 Q 175.715 12.943 174.379 12.943 Q 172.656 12.943 171.549 13.84 Q 170.441 14.736 169.826 16.09 Q 169.211 17.443 168.956 18.894 Q 168.701 20.344 168.701 21.451 Q 168.701 22.576 169.044 23.473 Q 169.387 24.369 170.213 24.888 Q 171.039 25.406 172.463 25.406 Q 173.957 25.406 175.108 24.782 Q 176.26 24.158 176.769 23.051 L 181.498 23.684 Q 180.531 26.25 178.035 27.814 Q 175.539 29.379 172.076 29.379 Z"></path>
					</g>
				</svg>
			</a>
		</div>
	`.trim();

	function escapeHtml(value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function replaceTemplateTokens(template, tokens) {
		let out = String(template ?? "");
		const map = tokens && typeof tokens === "object" ? tokens : {};
		for (const [key, value] of Object.entries(map)) {
			const token = `{{${key}}}`;
			out = out.split(token).join(String(value ?? ""));
		}
		return out;
	}

	function serializeInlineScript(value) {
		return JSON.stringify(value).replace(/</g, "\\u003c");
	}

	// External share page (unauthed, unfurl-first)
	router.get("/s/:version/:token/:bust?", async (req, res) => {
		const version = String(req.params.version || "");
		const token = String(req.params.token || "");
		const bust = String(req.params.bust || "").trim();

		const base = getBaseAppUrl();
		const requestUrl = new URL(String(req.originalUrl || req.path || "/"), base).toString();

		function clampText(value, { maxChars = 200 } = {}) {
			const v = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
			if (!v) return "";
			if (v.length <= maxChars) return v;
			return `${v.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
		}

		function ensureMinText(value, { minChars = 0, suffix = "" } = {}) {
			const v = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
			if (!v) return suffix ? suffix.trim() : "";
			if (v.length >= minChars) return v;
			if (!suffix) return v;
			const joiner = /[.!?]$/.test(v) ? " " : " — ";
			return `${v}${joiner}${suffix}`.trim();
		}

		function sendPrettyFallback({ title = "Parascene", message = "This share link is invalid or no longer available." } = {}) {
			let html = `
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<meta name="theme-color" content="#242131" />
	<title>${escapeHtml(title)}</title>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
	<link rel="stylesheet" href="/pages/share.css" />
	<meta name="description" content="${escapeHtml(message)}" />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Parascene" />
	<meta property="og:title" content="${escapeHtml(title)}" />
	<meta property="og:description" content="${escapeHtml(message)}" />
	<meta property="og:url" content="${escapeHtml(requestUrl)}" />

	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="${escapeHtml(title)}" />
	<meta name="twitter:description" content="${escapeHtml(message)}" />
</head>
<body class="share-page">
	<main class="share-main">
		${authLogo}
		<section class="share-hero">
			<div class="share-hero-media">
				<div class="share-image share-image-fallback" aria-hidden="true"></div>
			</div>

			<div class="share-hero-copy">
				<div class="share-kicker">Link unavailable</div>
				<h1 class="share-title">Make something anyway</h1>
				<p class="share-subtitle">${escapeHtml(message)} Create your own for free — it’s easy and fun.</p>
				<p class="share-reward">Jack in for free and start creating in under a minute.</p>

				<div class="share-cta-row">
					<a class="btn-primary btn-large" href="/auth#signup">Create your own</a>
				</div>
				<p class="share-alt">Already have an account? <a href="/auth#login">Sign in</a></p>
			</div>
		</section>
	</main>
</body>
</html>
`.trim();

			res.setHeader("Content-Type", "text/html");
			res.setHeader("Cache-Control", "no-store");
			return res.status(200).send(html);
		}

		const verified = verifyShareToken({ version, token });
		if (!verified.ok) {
			return sendPrettyFallback({
				title: "Parascene — link unavailable",
				message: "This share link is invalid or has been rotated."
			});
		}

		try {
			const image = await queries.selectCreatedImageByIdAnyUser?.get(verified.imageId);
			if (!image) {
				return sendPrettyFallback({
					title: "Parascene — creation not found",
					message: "That creation can’t be found anymore."
				});
			}
			const status = image.status || "completed";
			if (status !== "completed") {
				return sendPrettyFallback({
					title: "Parascene — still cooking",
					message: "That creation isn’t ready yet."
				});
			}

			// If the viewer is already signed in and would normally have access in-app,
			// serve the in-app creation detail page at this URL.
			const viewerId = Number(req.auth?.userId || 0);
			if (viewerId > 0) {
				const fs = await import("fs/promises");
				const viewer = await queries.selectUserById?.get(viewerId).catch(() => null);
				if (viewer) {
					const rolePageName = getPageForUser(viewer);
					const rolePagePath = path.join(pagesDir, rolePageName);
					const htmlPath = path.join(pagesDir, "creation-detail.html");
					let pageHtml = await fs.readFile(htmlPath, "utf-8");

					let headerHtml = "";
					let includeMobileBottomNav = false;
					try {
						const roleHtml = await fs.readFile(rolePagePath, "utf-8");
						const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
						if (headerMatch) {
							headerHtml = headerMatch[0];
						}
						includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
					} catch {
						// ignore
					}

					if (headerHtml) {
						pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
					}
					pageHtml = pageHtml.replace(
						"<!--APP_MOBILE_BOTTOM_NAV-->",
						includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
					);

					const shareContext = `<script>window.__ps_share_context=${JSON.stringify({
						creationId: Number(image.id) || 0,
						version: String(version || ""),
						token: String(token || "")
					})};</script>`;
					pageHtml = pageHtml.replace(
						/<script\s+type="module"\s+src="\/pages\/creation-detail\.js"><\/script>/i,
						`${shareContext}\n\t<script type="module" src="/pages/creation-detail.js"></script>`
					);

					pageHtml = injectCommonHead(pageHtml);
					res.setHeader("Content-Type", "text/html");
					res.setHeader("Cache-Control", "no-store");
					return res.status(200).send(pageHtml);
				}
			}

			const cacheKey = `${version}:${token}`;
			const cached = shareHtmlCache.get(cacheKey);
			if (cached && Date.now() - cached.ts < SHARE_CACHE_TTL_MS) {
				res.setHeader("Content-Type", "text/html");
				res.setHeader("Cache-Control", "public, max-age=60");
				return res.send(cached.html);
			}

			const sharerId = Number(verified.sharedByUserId);
			const creatorId = Number(image.user_id ?? 0);
			const hasCreator = Number.isFinite(creatorId) && creatorId > 0;

			const [template, sharerProfile, sharerUser, creatorProfile, creatorUser] = await Promise.all([
				getShareTemplate(),
				queries.selectUserProfileByUserId?.get(sharerId).catch(() => null),
				queries.selectUserById?.get(sharerId).catch(() => null),
				hasCreator ? queries.selectUserProfileByUserId?.get(creatorId).catch(() => null) : Promise.resolve(null),
				hasCreator ? queries.selectUserById?.get(creatorId).catch(() => null) : Promise.resolve(null)
			]);

			let sharerName = "your friend";
			let sharerHandle = "";
			let sharerAvatarUrl = "";
			try {
				const profile = sharerProfile;
				const user = sharerUser;
				const userName = typeof profile?.user_name === "string" ? profile.user_name.trim() : "";
				const displayName = typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
				sharerAvatarUrl = typeof profile?.avatar_url === "string" ? profile.avatar_url.trim() : "";
				const emailPrefix = typeof user?.email === "string" ? String(user.email).split("@")[0] : "";

				sharerName = displayName || userName || emailPrefix || sharerName;
				sharerHandle = userName ? `@${userName}` : (emailPrefix ? `@${emailPrefix}` : "");
			} catch {
				// ignore
			}

			let creatorName = "the creator";
			let creatorHandle = "";
			let creatorAvatarUrl = "";
			try {
				if (hasCreator && creatorProfile != null && creatorUser != null) {
					const profile = creatorProfile;
					const user = creatorUser;
					const userName = typeof profile?.user_name === "string" ? profile.user_name.trim() : "";
					const displayName = typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
					creatorAvatarUrl = typeof profile?.avatar_url === "string" ? profile.avatar_url.trim() : "";
					const emailPrefix = typeof user?.email === "string" ? String(user.email).split("@")[0] : "";

					creatorName = displayName || userName || emailPrefix || creatorName;
					creatorHandle = userName ? `@${userName}` : (emailPrefix ? `@${emailPrefix}` : "");
				}
			} catch {
				// ignore
			}

			const imageUrlBase = `${base}/api/share/${encodeURIComponent(version)}/${encodeURIComponent(token)}/image`;
			const imageUrl = `${imageUrlBase}?variant=wide&v=${encodeURIComponent(bust || token)}`;
			const secureImageUrl = imageUrl.startsWith("http://") ? `https://${imageUrl.slice("http://".length)}` : imageUrl;

			const titleRaw = typeof image.title === "string" ? image.title.trim() : "";
			const hasTitle = Boolean(titleRaw);
			const metaTitleRaw = hasTitle ? titleRaw : `Creation #${image.id}`;
			const imageAlt = hasTitle ? titleRaw : "Parascene creation";
			const title = clampText(
				ensureMinText(`Parascene — ${metaTitleRaw}`, {
					minChars: 30,
					suffix: "make something beautiful"
				}),
				{ maxChars: 70 }
			);
			const description = clampText(
				ensureMinText(`A creation shared by ${sharerHandle || sharerName} on Parascene.`, {
					minChars: 110,
					suffix: "Explore the image, then create your own for free in minutes."
				}),
				{ maxChars: 200 }
			);

			const width = 1200;
			const height = 675;
			const hasDims = true;

			const heroSharer = sharerHandle || sharerName;
			const heroCreator = creatorHandle || creatorName;
			const showCreator = Number(verified.sharedByUserId) !== Number(image.user_id ?? 0);

			const sharerAvatarFallback = escapeHtml((sharerName || "S").trim().charAt(0).toUpperCase());
			const creatorAvatarFallback = escapeHtml((creatorName || "C").trim().charAt(0).toUpperCase());

			const sharerAvatarHtml = sharerAvatarUrl
				? `<img class="share-avatar-img" src="${escapeHtml(sharerAvatarUrl)}" alt="" />`
				: `<span class="share-avatar-fallback" aria-hidden="true">${sharerAvatarFallback}</span>`;

			const creatorAvatarHtml = creatorAvatarUrl
				? `<img class="share-avatar-img" src="${escapeHtml(creatorAvatarUrl)}" alt="" />`
				: `<span class="share-avatar-fallback" aria-hidden="true">${creatorAvatarFallback}</span>`;

			const overlayTitleHtml = hasTitle ? `<h1 class="share-overlay-title">${escapeHtml(titleRaw)}</h1>` : ``;

			const creatorBlockHtml = showCreator ? `
						<div class="share-person">
							<div class="share-avatar">
								${creatorAvatarHtml}
							</div>
							<div class="share-person-text">
								<div class="share-person-label">Created by</div>
								<div class="share-person-name">${escapeHtml(heroCreator)}</div>
							</div>
						</div>
			`.trim() : ``;

			const ogDimsMeta = hasDims
				? `\t<meta property="og:image:width" content="${width}" />\n\t<meta property="og:image:height" content="${height}" />`
				: "";

			const shareImageSrc = `/api/share/${encodeURIComponent(version)}/${encodeURIComponent(token)}/image`;
			const signInUrl = `/auth?returnUrl=${encodeURIComponent(req.originalUrl || req.path || "/")}#login`;

			let html = replaceTemplateTokens(template, {
				PAGE_TITLE: escapeHtml(title),
				PAGE_DESCRIPTION: escapeHtml(description),
				REQUEST_URL: escapeHtml(requestUrl),
				OG_IMAGE_URL: escapeHtml(imageUrl),
				OG_IMAGE_SECURE_URL: escapeHtml(secureImageUrl),
				OG_IMAGE_DIMS_META: ogDimsMeta,
				IMAGE_ALT: escapeHtml(imageAlt),
				SHARE_IMAGE_SRC: escapeHtml(shareImageSrc),
				OVERLAY_TITLE_HTML: overlayTitleHtml,
				SHARER_AVATAR_HTML: sharerAvatarHtml,
				SHARER_NAME: escapeHtml(heroSharer),
				CREATOR_BLOCK_HTML: creatorBlockHtml,
				SIGNIN_URL: escapeHtml(signInUrl),
				REFERRER_USER_ID: String(Number(verified.sharedByUserId) || 0),
				IMAGE_ID: String(Number(image.id) || 0),
				CREATED_BY_USER_ID: String(Number(image.user_id) || 0)
			});

			shareHtmlCache.set(cacheKey, { html, ts: Date.now() });
			res.setHeader("Content-Type", "text/html");
			res.setHeader("Cache-Control", "public, max-age=60");
			return res.send(html);
		} catch {
			return res.status(500).send("Internal server error");
		}
	});

	function normalizeReturnUrl(raw) {
		const value = typeof raw === "string" ? raw.trim() : "";
		if (!value) return "/";
		if (!value.startsWith("/")) return "/";
		if (value.startsWith("//")) return "/";
		if (value.includes("://")) return "/";
		if (value.length > 2048) return "/";
		// Never return to auth pages after login
		if (value === "/auth" || value === "/auth.html") return "/";
		return value;
	}

	function redirectToAuth(req, res) {
		const returnUrl = normalizeReturnUrl(req?.originalUrl || req?.path || "/");
		const qs = new URLSearchParams({ returnUrl });
		return res.redirect(`/auth.html?${qs.toString()}`);
	}

	function isWelcomeTestMode(req) {
		const testEmail = String(req?.query?.testEmail ?? "").trim();
		if (testEmail.length > 0) return true;
		const raw = String(req?.query?.test ?? "").trim().toLowerCase();
		return raw === "1" || raw === "true" || raw === "yes";
	}

	async function requireLoggedInUser(req, res) {
		const userId = req.auth?.userId;
		if (!userId) {
			redirectToAuth(req, res);
			return null;
		}

		const user = await queries.selectUserById.get(userId);
		if (!user) {
			// Only clear cookie if it was actually sent
			if (req.cookies?.[COOKIE_NAME]) {
				clearAuthCookie(res, req);
			}
			redirectToAuth(req, res);
			return null;
		}

		return user;
	}

	// Welcome (server-sent, minimal chrome)
	router.get("/welcome", async (req, res) => {
		if (!isWelcomeTestMode(req)) {
			const user = await requireLoggedInUser(req, res);
			if (!user) return;
		}
		try {
			const fs = await import("fs/promises");
			let htmlContent = await fs.readFile(path.join(pagesDir, "welcome.html"), "utf-8");
			htmlContent = injectCommonHead(htmlContent);
			res.setHeader("Content-Type", "text/html");
			return res.send(htmlContent);
		} catch (error) {
			return res.status(500).send("Internal server error");
		}
	});

	// Handle root and index.html - same logic
	router.get(["/", "/index.html"], async (req, res) => {
		const userId = req.auth?.userId;

		// NOT logged in → landing page
		if (!userId) {
			const fs = await import("fs/promises");
			let htmlContent = await fs.readFile(path.join(pagesDir, "index.html"), "utf-8");
			htmlContent = injectCommonHead(htmlContent);
			res.setHeader("Content-Type", "text/html");
			return res.send(htmlContent);
		}

		// Logged in → get role and serve role page
		const user = await queries.selectUserById.get(userId);
		if (!user) {
			// Only clear cookie if it was actually sent
			if (req.cookies?.[COOKIE_NAME]) {
				clearAuthCookie(res, req);
			}
			const fs = await import("fs/promises");
			let htmlContent = await fs.readFile(path.join(pagesDir, "index.html"), "utf-8");
			htmlContent = injectCommonHead(htmlContent);
			res.setHeader("Content-Type", "text/html");
			return res.send(htmlContent);
		}

		// Serve role-based page
		const page = getPageForUser(user);
		const fs = await import("fs/promises");
		let htmlContent = await fs.readFile(path.join(pagesDir, page), "utf-8");
		htmlContent = injectCommonHead(htmlContent);
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	});

	// User/profile discovery page - /user (me), /user/:id, /p/:personality, /t/:tag
	router.get(["/user", "/user/:id", "/p/:personality", "/t/:tag"], async (req, res) => {
		const user = await requireLoggedInUser(req, res);
		if (!user) return;

		// Resolve profile target context. We always serve the profile page shell
		// and let the page decide how to render "not found / non-user" states.
		const rawTargetId = req.params?.id;
		const rawTargetUserName = req.params?.personality;
		const rawTargetTag = req.params?.tag;
		const profileRouteContext = {
			requested: {
				type: "me",
				user_id: null,
				user_name: null
			},
			resolved: {
				target_exists: true,
				user_id: null,
				user_name: null
			},
			target_kind: "user"
		};
		if (rawTargetId) {
			profileRouteContext.requested = {
				type: "user-id",
				user_id: Number.parseInt(String(rawTargetId || ""), 10),
				user_name: null
			};
			const targetId = Number.parseInt(rawTargetId, 10);
			if (Number.isFinite(targetId) && targetId > 0) {
				const target = await queries.selectUserById.get(targetId);
				if (target) {
					profileRouteContext.resolved = {
						target_exists: true,
						user_id: Number(target.id),
						user_name: null
					};
				} else {
					profileRouteContext.resolved.target_exists = false;
					profileRouteContext.target_kind = "personality";
				}
			} else {
				profileRouteContext.resolved.target_exists = false;
				profileRouteContext.target_kind = "personality";
			}
		}
		if (rawTargetUserName) {
			const normalizedUserName = String(rawTargetUserName || "").trim().toLowerCase();
			profileRouteContext.requested = {
				type: "user-name",
				user_id: null,
				user_name: normalizedUserName || null
			};
			if (/^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalizedUserName) && queries.selectUserProfileByUsername?.get) {
				const profile = await queries.selectUserProfileByUsername.get(normalizedUserName);
				const targetId = Number.parseInt(String(profile?.user_id ?? ""), 10);
				if (Number.isFinite(targetId) && targetId > 0) {
					const target = await queries.selectUserById.get(targetId);
					if (target) {
						profileRouteContext.resolved = {
							target_exists: true,
							user_id: Number(target.id),
							user_name: normalizedUserName
						};
					} else {
						profileRouteContext.resolved.target_exists = false;
						profileRouteContext.target_kind = "personality";
					}
				} else {
					profileRouteContext.resolved.target_exists = false;
					profileRouteContext.target_kind = "personality";
				}
			} else {
				profileRouteContext.resolved.target_exists = false;
				profileRouteContext.target_kind = "personality";
			}
		}
		if (rawTargetTag) {
			const normalizedTag = String(rawTargetTag || "").trim().toLowerCase();
			profileRouteContext.requested = {
				type: "tag",
				user_id: null,
				user_name: normalizedTag || null
			};
			profileRouteContext.resolved = {
				target_exists: false,
				user_id: null,
				user_name: null
			};
			profileRouteContext.target_kind = "tag";
		}

		try {
			const fs = await import("fs/promises");
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			const htmlPath = path.join(pagesDir, "user-profile.html");
			let pageHtml = await fs.readFile(htmlPath, "utf-8");

			// Inject the correct role header by copying it from the role-based page.
			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// console.warn("Failed to extract role header for profile page:", error?.message || error);
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);
			const profileContextScript = `<script>window.__ps_profile_context=${serializeInlineScript(profileRouteContext)};</script>`;
			pageHtml = pageHtml.replace(
				/<script\s+type="module"\s+src="\/pages\/user-profile\.js"><\/script>/i,
				`${profileContextScript}\n\t<script type="module" src="/pages/user-profile.js"></script>`
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader("Content-Type", "text/html");
			return res.send(pageHtml);
		} catch (error) {
			// console.error("Error loading user profile page:", error);
			return res.status(500).send("Internal server error");
		}
	});

	// Create page - single /create route; cookie create_editor=simple → create.html, else → createAdvanced.html
	const CREATE_EDITOR_COOKIE = "create_editor";
	router.get("/create", async (req, res) => {
		const user = await requireLoggedInUser(req, res);
		if (!user) return;

		try {
			const fs = await import("fs/promises");
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			// When cookie is set to "simple", serve simple create; when not set, serve advanced
			const useSimple = req.cookies?.[CREATE_EDITOR_COOKIE] === "simple";
			const htmlPath = path.join(pagesDir, useSimple ? "create.html" : "createAdvanced.html");
			let pageHtml = await fs.readFile(htmlPath, "utf-8");

			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// ignore
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader("Content-Type", "text/html");
			return res.send(pageHtml);
		} catch (error) {
			return res.status(500).send("Internal server error");
		}
	});

	async function serveCreationMutatePage(req, res) {
		const user = await requireLoggedInUser(req, res);
		if (!user) return;

		// Verify the creation exists and is either published or belongs to the user
		const creationId = parseInt(req.params.id, 10);
		if (!creationId) {
			return serveNotFoundPage(req, res, user);
		}

		try {
			// First try to get as owner
			let image = await queries.selectCreatedImageById.get(creationId, user.id);

			// If not found as owner, check if it exists and is either published or user is admin
			if (!image) {
				const anyImage = await queries.selectCreatedImageByIdAnyUser.get(creationId);
				if (anyImage) {
					const isPublished = anyImage.published === 1 || anyImage.published === true;
					const isAdmin = user.role === 'admin';
					if (isPublished || isAdmin) {
						image = anyImage;
					} else {
						return serveNotFoundPage(req, res, user);
					}
				} else {
					return serveNotFoundPage(req, res, user);
				}
			}

			// Read the HTML file and inject the correct role-based header and mobile nav
			const fs = await import('fs/promises');
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			const htmlPath = path.join(pagesDir, "creation-edit.html");
			let pageHtml = await fs.readFile(htmlPath, 'utf-8');

			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// console.warn("Failed to extract role header for creation mutate page:", error?.message || error);
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader('Content-Type', 'text/html');
			return res.send(pageHtml);
		} catch (error) {
			// console.error("Error loading creation mutate:", error);
			return res.status(500).send("Internal server error");
		}
	}

	async function serveNotFoundPage(req, res, user) {
		try {
			const fs = await import("fs/promises");
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			const htmlPath = path.join(pagesDir, "not-found.html");
			let pageHtml = await fs.readFile(htmlPath, "utf-8");

			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// console.warn("Failed to extract role header for not found page:", error?.message || error);
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader("Content-Type", "text/html");
			return res.status(404).send(pageHtml);
		} catch (error) {
			return res.status(404).send("Not found");
		}
	}

	// Route for creation mutate page - /creations/:id/mutate
	router.get("/creations/:id/mutate", serveCreationMutatePage);

	// Back-compat: redirect /creations/:id/mutat -> /creations/:id/mutate
	router.get("/creations/:id/mutat", async (req, res) => {
		const rawId = typeof req.params?.id === 'string' ? req.params.id : '';
		return res.redirect(`/creations/${rawId}/mutate`);
	});

	// Back-compat: redirect /creations/:id/edit -> /creations/:id/mutate
	router.get("/creations/:id/edit", async (req, res) => {
		const rawId = typeof req.params?.id === 'string' ? req.params.id : '';
		return res.redirect(`/creations/${rawId}/mutate`);
	});

	// Route for creation detail page - /creations/:id
	router.get("/creations/:id", async (req, res) => {
		const user = await requireLoggedInUser(req, res);
		if (!user) return;

		// Verify the creation exists and is either published or belongs to the user
		const creationId = parseInt(req.params.id, 10);
		if (!creationId) {
			return serveNotFoundPage(req, res, user);
		}

		try {
			// First try to get as owner
			let image = await queries.selectCreatedImageById.get(creationId, user.id);

			// If not found as owner, check if it exists and is either published or user is admin
			if (!image) {
				const anyImage = await queries.selectCreatedImageByIdAnyUser.get(creationId);
				if (anyImage) {
					const isPublished = anyImage.published === 1 || anyImage.published === true;
					const isAdmin = user.role === 'admin';
					if (isPublished || isAdmin) {
						image = anyImage;
					} else {
						return serveNotFoundPage(req, res, user);
					}
				} else {
					return serveNotFoundPage(req, res, user);
				}
			}

			// Read the HTML file and inject the correct role-based header and mobile nav
			const fs = await import('fs/promises');
			const rolePageName = getPageForUser(user);
			const rolePagePath = path.join(pagesDir, rolePageName);
			const htmlPath = path.join(pagesDir, "creation-detail.html");
			let pageHtml = await fs.readFile(htmlPath, 'utf-8');

			let headerHtml = "";
			let includeMobileBottomNav = false;
			try {
				const roleHtml = await fs.readFile(rolePagePath, "utf-8");
				const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
				if (headerMatch) {
					headerHtml = headerMatch[0];
				}
				includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
			} catch (error) {
				// console.warn("Failed to extract role header for creation detail page:", error?.message || error);
			}

			if (headerHtml) {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml);
			}
			pageHtml = pageHtml.replace(
				"<!--APP_MOBILE_BOTTOM_NAV-->",
				includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
			);

			pageHtml = injectCommonHead(pageHtml);

			res.setHeader('Content-Type', 'text/html');
			return res.send(pageHtml);
		} catch (error) {
			// console.error("Error loading creation detail:", error);
			return res.status(500).send("Internal server error");
		}
	});

	// Auth page (supports returnUrl query param). Logged-in users are redirected away.
	router.get("/auth.html", async (req, res) => {
		const userId = req.auth?.userId;
		if (userId) {
			const user = await queries.selectUserById.get(userId);
			if (user) {
				const returnUrl = normalizeReturnUrl(req?.query?.returnUrl || "/");
				return res.redirect(returnUrl);
			}
		}
		const fs = await import("fs/promises");
		let htmlContent = await fs.readFile(path.join(pagesDir, "auth.html"), "utf-8");
		htmlContent = injectCommonHead(htmlContent);
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	});

	// Guest header (same as landing / index): Login + Sign Up
	const guestHeaderHtml = `
		<app-navigation>
			<a href="/auth#login" class="header-auth-link">Login</a>
			<a href="/auth#signup" class="header-auth-link btn-primary">Sign Up</a>
		</app-navigation>
	`.trim();

	// Pricing page: when signed in use app header + mobile nav (like creation-detail); when not, use guest header.
	router.get("/pricing", async (req, res) => {
		const fs = await import("fs/promises");
		let pageHtml = await fs.readFile(path.join(pagesDir, "pricing.html"), "utf-8");

		const userId = req.auth?.userId;
		if (userId) {
			const user = await queries.selectUserById.get(userId);
			if (user) {
				const rolePageName = getPageForUser(user);
				const rolePagePath = path.join(pagesDir, rolePageName);
				let headerHtml = "";
				let includeMobileBottomNav = false;
				try {
					const roleHtml = await fs.readFile(rolePagePath, "utf-8");
					const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
					if (headerMatch) headerHtml = headerMatch[0];
					includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
				} catch {
					// fallback: use guest header if role page read fails
				}
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", headerHtml || guestHeaderHtml);
				pageHtml = pageHtml.replace(
					"<!--APP_MOBILE_BOTTOM_NAV-->",
					includeMobileBottomNav ? "<app-navigation-mobile></app-navigation-mobile>" : ""
				);
			} else {
				pageHtml = pageHtml.replace("<!--APP_HEADER-->", guestHeaderHtml);
				pageHtml = pageHtml.replace("<!--APP_MOBILE_BOTTOM_NAV-->", "");
			}
		} else {
			pageHtml = pageHtml.replace("<!--APP_HEADER-->", guestHeaderHtml);
			pageHtml = pageHtml.replace("<!--APP_MOBILE_BOTTOM_NAV-->", "");
			pageHtml = pageHtml.replace('<body class="pricing-page">', '<body class="pricing-page pricing-page-guest">');
		}

		pageHtml = injectCommonHead(pageHtml);
		res.setHeader("Content-Type", "text/html");
		return res.send(pageHtml);
	});

	// Canonical pricing URL is /pricing; redirect old /pricing.html.
	router.get("/pricing.html", (req, res) => {
		return res.redirect(301, "/pricing");
	});

	// Try page (unauthenticated). try.html includes global.css and global.js itself; do not inject common head to avoid loading them twice.
	router.get("/try", async (req, res) => {
		const fs = await import("fs/promises");
		const htmlContent = await fs.readFile(path.join(pagesDir, "try.html"), "utf-8");
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	});

	// Catch-all route for sub-routes - serve the same page for all routes
	// This allows clean URLs like /feed, /explore, etc. while serving the same HTML
	router.get("/*", async (req, res, next) => {
		// Skip if it's an API route, static file, or known endpoint
		if (req.path.startsWith("/api/") ||
			req.path.startsWith("/admin/users") ||
			req.path.startsWith("/creations/") ||
			req.path.startsWith("/help") ||
			req.path === "/welcome" ||
			req.path === "/user" ||
			req.path.startsWith("/user/") ||
			req.path === "/me" ||
			req.path === "/signup" ||
			req.path === "/login" ||
			req.path === "/logout" ||
			req.path === "/index.html") {
			return next(); // Let other routes handle it or 404
		}

		const userId = req.auth?.userId;

		// If NOT logged in → require authentication
		if (!userId) {
			// If user requests /auth or /auth.html directly, serve auth page without redirect
			if (req.path === "/auth" || req.path === "/auth.html") {
				const fs = await import("fs/promises");
				let htmlContent = await fs.readFile(path.join(pagesDir, "auth.html"), "utf-8");
				htmlContent = injectCommonHead(htmlContent);
				res.setHeader("Content-Type", "text/html");
				return res.send(htmlContent);
			}
			return redirectToAuth(req, res);
		}

		// If logged in → get user and their role
		const user = await queries.selectUserById.get(userId);
		if (!user) {
			// Only clear cookie if it was actually sent
			if (req.cookies?.[COOKIE_NAME]) {
				clearAuthCookie(res, req);
			}
			return redirectToAuth(req, res);
		}

		// Logged-in user on auth URL (e.g. /auth or /auth#login from another tab) → redirect to app
		if (req.path === "/auth" || req.path === "/auth.html") {
			const returnUrl = normalizeReturnUrl(req?.query?.returnUrl || "/");
			return res.redirect(returnUrl);
		}

		// User is logged in and has a role → serve their role-based page
		// Client-side routing handles the rest (feed, explore, etc.)
		const page = getPageForUser(user);
		const fs = await import("fs/promises");
		let htmlContent = await fs.readFile(path.join(pagesDir, page), "utf-8");
		htmlContent = injectCommonHead(htmlContent);
		res.setHeader("Content-Type", "text/html");
		return res.send(htmlContent);
	});

	return router;
}
