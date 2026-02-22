import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { marked } from "marked";
import { injectCommonHead } from "./utils/head.js";
import { homeIcon } from "../public/icons/svg-strings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure marked for safe rendering
marked.setOptions({
	gfm: true,
	breaks: false,
	headerIds: true,
	mangle: false
});

function parseFrontmatter(content) {
	const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);
	
	if (match) {
		const frontmatterText = match[1];
		const body = match[2];
		const metadata = {};
		
		// Simple YAML-like parsing for title, description, and beta flag
		for (const line of frontmatterText.split('\n')) {
			const colonIndex = line.indexOf(':');
			if (colonIndex > 0) {
				const key = line.slice(0, colonIndex).trim();
				let value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
				// Handle boolean values
				if (value === 'true') {
					value = true;
				} else if (value === 'false') {
					value = false;
				}
				metadata[key] = value;
			}
		}
		
		return { metadata, body };
	}
	
	return { metadata: {}, body: content };
}

/** Strip numeric prefix from a path segment (e.g. "01-earning-credits" -> "earning-credits") for display and URLs. */
function stripSegmentPrefix(segment) {
	return segment.replace(/^\d+-/, '');
}

/** Strip numeric prefixes from each segment of a path; used for slugs and section display. */
function stripPathPrefix(pathStr) {
	const normalized = pathStr.replace(/\\/g, '/');
	return normalized.split('/').map(stripSegmentPrefix).join('/');
}

async function scanHelpDirectory(dir, baseDir, section = '') {
	const fs = await import("fs/promises");
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const helpFiles = [];
	
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		
		if (entry.isDirectory() && !entry.name.startsWith('_')) {
			// Recursively scan subdirectories (section keeps raw name for sort order)
			const subSection = section ? `${section}/${entry.name}` : entry.name;
			const subFiles = await scanHelpDirectory(fullPath, baseDir, subSection);
			helpFiles.push(...subFiles);
		} else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_') && entry.name.toLowerCase() !== 'index.md') {
			// Process markdown file (exclude index.md from nav - it serves the help home)
			const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
			const slug = stripPathPrefix(relativePath).replace(/\.md$/, '');
			const content = await fs.readFile(fullPath, 'utf-8');
			const { metadata, body } = parseFrontmatter(content);
			
			// Section for display/grouping (prefix stripped); sortSection for ordering (raw)
			const rawSection = section || (relativePath.includes('/') ? path.dirname(relativePath) : '');
			const fileSection = stripPathPrefix(rawSection);
			// Title from filename: strip numeric prefix (e.g. 01-) then format
			const nameWithoutExt = entry.name.replace(/\.md$/i, '');
			const nameForTitle = stripSegmentPrefix(nameWithoutExt);
			const titleFromFilename = nameForTitle.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
			
			helpFiles.push({
				slug,
				section: fileSection,
				sortSection: rawSection,
				sortFilename: entry.name,
				title: metadata.title || titleFromFilename,
				description: metadata.description || '',
				beta: metadata.beta === true,
				content: body,
				html: marked.parse(body)
			});
		}
	}
	
	return helpFiles;
}

async function getHelpFiles(helpDir) {
	const helpFiles = await scanHelpDirectory(helpDir, helpDir);
	
	// Sort by section order (raw prefix), then by filename (raw prefix for file order within section)
	helpFiles.sort((a, b) => {
		if (a.sortSection !== b.sortSection) {
			return (a.sortSection || '').localeCompare(b.sortSection || '');
		}
		return (a.sortFilename || '').localeCompare(b.sortFilename || '');
	});
	
	return helpFiles;
}

function escapeHtml(text) {
	return String(text || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function countOccurrences(text, query) {
	if (!text || !query) return 0;
	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let count = 0;
	let index = lowerText.indexOf(lowerQuery);
	while (index !== -1) {
		count++;
		index = lowerText.indexOf(lowerQuery, index + 1);
	}
	return count;
}

function searchHelpFiles(helpFiles, query) {
	if (!query || query.trim().length === 0) {
		return [];
	}
	
	const lowerQuery = query.toLowerCase().trim();
	const results = [];
	
	for (const file of helpFiles) {
		let totalCount = 0;
		
		// Count in title
		const titleCount = countOccurrences(file.title, lowerQuery);
		totalCount += titleCount;
		
		// Count in description
		const descCount = file.description ? countOccurrences(file.description, lowerQuery) : 0;
		totalCount += descCount;
		
		// Count in content body
		const contentCount = countOccurrences(file.content, lowerQuery);
		totalCount += contentCount;
		
		if (totalCount > 0) {
			results.push({
				slug: file.slug,
				section: file.section,
				title: file.title,
				description: file.description,
				count: totalCount
			});
		}
	}
	
	return results;
}

function generateNavigation(helpFiles, currentSlug) {
	// Group files by section
	const sections = new Map();
	
	for (const file of helpFiles) {
		const sectionName = file.section || 'General';
		if (!sections.has(sectionName)) {
			sections.set(sectionName, []);
		}
		sections.get(sectionName).push({
			slug: file.slug,
			title: file.title,
			active: file.slug === currentSlug
		});
	}
	
	// Convert to array format
	const navigation = [];
	for (const [sectionName, items] of sections.entries()) {
		navigation.push({
			section: sectionName,
			items
		});
	}
	
	return navigation;
}

/** Display names for help sections (folder key -> label). Used for nav and index. */
const SECTION_DISPLAY_NAMES = {
	'about': 'About',
	'create': 'Create',
	'connect': 'Connect',
	'discover': 'Discover',
	'credits': 'Credits'
};

function formatSectionName(section) {
	if (!section) return 'General';
	if (SECTION_DISPLAY_NAMES[section]) return SECTION_DISPLAY_NAMES[section];
	return section.split('/').map(part =>
		SECTION_DISPLAY_NAMES[part] || part.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
	).join(' / ');
}

function generateHelpPageHtml({ title, description, html, navigation, isIndex = false, beta = false, allFiles = [], notFound = false, searchQuery = '', showMobileHomeLink = true }) {
	// Generate sidebar navigation with sections
	const navHtml = navigation.map(sectionGroup => {
		const sectionTitle = formatSectionName(sectionGroup.section);
		const itemsHtml = sectionGroup.items.map(item => `
			<a href="/help/${item.slug}" class="help-nav-item ${item.active ? 'active' : ''}">
				${item.title}
			</a>
		`).join('');
		
		return `
			<div class="help-nav-section" data-section="${escapeHtml(sectionGroup.section || '')}">
				<div class="help-nav-section-title">${sectionTitle}</div>
				${itemsHtml}
			</div>
		`;
	}).join('');
	
	const indexContent = isIndex ? `
		<div class="help-index">
			<h2>Help Topics</h2>
			${navigation.map(sectionGroup => {
				const sectionTitle = formatSectionName(sectionGroup.section);
				return `
					<div class="help-index-section">
						<h3 class="help-index-section-title">${sectionTitle}</h3>
						<div class="help-index-list">
							${sectionGroup.items.map(item => `
								<div class="help-index-item">
									<a href="/help/${item.slug}" class="help-index-link">
										<h4>${item.title}</h4>
									</a>
								</div>
							`).join('')}
						</div>
					</div>
				`;
			}).join('')}
		</div>
	` : notFound ? `
		<div class="help-content">
			<div class="help-not-found">
				<div class="help-not-found-icon">
					<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10"></circle>
						<line x1="12" y1="8" x2="12" y2="12"></line>
						<line x1="12" y1="16" x2="12.01" y2="16"></line>
					</svg>
				</div>
				<h1>Article Not Found</h1>
				<p class="help-not-found-message">The help article you're looking for doesn't exist or may have been moved. Try searching or browsing from the sidebar.</p>
			</div>
		</div>
	` : `
		<div class="help-content">
			${beta ? `<div class="alert alert-warning" style="margin-bottom: 24px;">
				<p><strong>Beta:</strong> This documentation is in beta and may not reflect current functionality. The features described may also be in beta state and subject to change.</p>
			</div>` : ''}
			<h1>${title}</h1>
			${description ? `<p class="help-description">${description}</p>` : ''}
			<div class="help-body">
				${html}
			</div>
		</div>
	`;
	
	return `<!doctype html>
<html lang="en">
<head>
	<title>${title} - Help - parascene</title>
	<link rel="stylesheet" href="/pages/help.css" />
</head>
<body class="help-page">
	<!--APP_HEADER-->
	
	<app-modal-profile></app-modal-profile>
	<app-modal-credits></app-modal-credits>
	<app-modal-notifications></app-modal-notifications>
	
	<!--APP_MOBILE_BOTTOM_NAV-->
	
	<main>
		<div class="help-container">
			<aside class="help-sidebar">
				<nav class="help-nav">
					${navHtml}
				</nav>
			</aside>
			<div class="help-article-wrapper">
				<div class="help-search-bar">
					${showMobileHomeLink ? `<a href="/help" class="help-mobile-home btn-secondary" aria-label="Help home">${homeIcon('help-mobile-home-icon')}<span class="help-home-label">Overview</span></a>` : ''}
					<input type="search" id="help-search" placeholder="Search help..." aria-label="Search help articles" value="${escapeHtml(searchQuery)}" />
				</div>
				<div class="help-article">
					<div class="help-search-results" id="help-search-results" style="display: none;"></div>
					<div class="help-article-content" id="help-article-content">
						${indexContent}
					</div>
				</div>
			</div>
		</div>
	</main>
	
	<script type="module" src="/pages/help.js"></script>
</body>
</html>`;
}

export default function createHelpRoutes({ pagesDir, queries }) {
	const router = express.Router();
	const helpDir = path.join(pagesDir, 'help');
	
	// Import getPageForUser from pages.js
	function getPageForUser(user) {
		const roleToPage = {
			consumer: "app.html",
			creator: "app.html",
			provider: "app.html",
			admin: "app-admin.html"
		};
		return roleToPage[user.role] || "app.html";
	}
	
	// Cache help files (can be invalidated on file changes in production)
	let helpFilesCache = null;
	let helpFilesCacheTime = 0;
	const CACHE_TTL_MS = process.env.NODE_ENV === 'production' ? 60000 : 0; // 1 min cache in production
	
	async function getHelpFilesCached() {
		const now = Date.now();
		if (helpFilesCache && (now - helpFilesCacheTime) < CACHE_TTL_MS) {
			return helpFilesCache;
		}
		
		helpFilesCache = await getHelpFiles(helpDir);
		helpFilesCacheTime = now;
		return helpFilesCache;
	}
	
	/** Header for unauthenticated users (logo + Login/Sign up from landing page). */
	async function getPublicHeaderHtml() {
		const fs = await import("fs/promises");
		const indexPath = path.join(pagesDir, 'index.html');
		try {
			const indexHtml = await fs.readFile(indexPath, 'utf-8');
			const match = indexHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
			return match ? match[0] : '';
		} catch {
			return '';
		}
	}
	
	// Search API endpoint
	router.get('/api/help/search', async (req, res) => {
		try {
			const query = String(req.query.q || '').trim();
			if (!query || query.length === 0) {
				return res.json({ results: [] });
			}
			
			const helpFiles = await getHelpFilesCached();
			const results = searchHelpFiles(helpFiles, query);
			
			res.json({ results });
		} catch (error) {
			console.error('Error searching help:', error);
			res.status(500).json({ error: 'Error searching help articles' });
		}
	});
	
	// Help index page - serve index.md if present, otherwise show topic list
	router.get('/help', async (req, res) => {
		try {
			const helpFiles = await getHelpFilesCached();
			const navigation = generateNavigation(helpFiles, null);
			const searchQuery = String(req.query.q || '').trim();
			
			const fs = await import("fs/promises");
			const indexPath = path.join(helpDir, 'index.md');
			let indexHtml = '';
			let indexTitle = 'Help';
			let indexDescription = 'Find answers to common questions';
			let indexBeta = false;
			
			try {
				const indexContent = await fs.readFile(indexPath, 'utf-8');
				const { metadata, body } = parseFrontmatter(indexContent);
				indexHtml = marked.parse(body);
				indexTitle = metadata.title || indexTitle;
				indexDescription = metadata.description || indexDescription;
				indexBeta = metadata.beta === true;
			} catch {
				// No index.md or read failed - use topic list (isIndex: true)
			}
			
			const html = generateHelpPageHtml({
				title: indexTitle,
				description: indexDescription,
				html: indexHtml,
				navigation,
				isIndex: !indexHtml,
				beta: indexBeta,
				allFiles: helpFiles,
				searchQuery,
				showMobileHomeLink: false
			});
			
			const htmlWithHead = injectCommonHead(html);
			
			// Inject header if user is logged in
			const userId = req.auth?.userId;
			if (userId && queries) {
				const fs = await import("fs/promises");
				const user = await queries.selectUserById?.get(userId);
				if (user) {
					const rolePageName = getPageForUser(user);
					const rolePagePath = path.join(pagesDir, rolePageName);
					try {
						const roleHtml = await fs.readFile(rolePagePath, 'utf-8');
						const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
						if (headerMatch) {
							const headerHtml = headerMatch[0];
							const htmlWithHeader = htmlWithHead.replace('<!--APP_HEADER-->', headerHtml);
							
							// Add mobile nav if present
							const includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
							const finalHtml = includeMobileBottomNav
								? htmlWithHeader.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '<app-navigation-mobile></app-navigation-mobile>')
								: htmlWithHeader.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '');
							
							res.setHeader("Content-Type", "text/html");
							return res.send(finalHtml);
						}
					} catch {
						// Fall through to non-header version
					}
				}
			}
			
			// Public header (logo + Login/Sign up) when not logged in
			const publicHeader = await getPublicHeaderHtml();
			const finalHtml = htmlWithHead
				.replace('<!--APP_HEADER-->', publicHeader)
				.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '');
			
			res.setHeader("Content-Type", "text/html");
			return res.send(finalHtml);
		} catch (error) {
			console.error('Error rendering help index:', error);
			return res.status(500).send('Error loading help page');
		}
	});
	
	// Redirects for old help URLs (Create / Connect / Discover / Credits structure)
	const HELP_REDIRECTS = {
		'creating/creating': 'create/basic',
		'creating-and-sharing/creating': 'create/basic',
		'create/creating': 'create/basic',
		'create/basic-creation': 'create/basic',
		'create/advanced-creation': 'create/advanced',
		'creating-and-sharing/publishing-to-your-feed': 'connect/share-your-creations',
		'creating-and-sharing/sharing-your-work': 'connect/share-your-creations',
		'publishing-and-sharing/publishing-and-sharing': 'connect/share-your-creations',
		'connect/sharing': 'connect/share-your-creations',
		'connect/boosting-a-server': 'connect/join-a-server',
		'connect/running-a-server': 'connect/join-a-server',
		'connect/feature-requests': 'connect/request-a-feature',
		'connect/connect-and-servers': 'connect/join-a-server',
		'connect/what-is-connect': 'connect/join-a-server',
		'feed-and-explore/feed-and-explore': 'discover/feed-list',
		'feed-and-discovery/feed-and-explore': 'discover/feed-list',
		'feed-and-discovery/following-likes-comments': 'discover/recent-comments',
		'discover/feed-and-explore': 'discover/feed-list',
		'discover/comments': 'discover/recent-comments',
		'earning-credits/what-are-credits': 'credits/daily-credits',
		'credits/what-are-credits': 'credits/daily-credits',
		'earning-credits/boost-compete': 'credits/boost-and-compete',
		'credits/boost-compete': 'credits/boost-and-compete',
		'earning-credits/run-server': 'credits/run-a-server',
		'credits/run-server': 'credits/run-a-server'
	};

	router.get('/help/*', async (req, res) => {
		try {
			// Extract slug from path - remove /help/ prefix and trailing slash
			let slug = req.path.replace(/^\/help\/?/, '').replace(/\/$/, '') || '';
			if (HELP_REDIRECTS[slug]) {
				res.redirect(302, `/help/${HELP_REDIRECTS[slug]}`);
				return;
			}
			const helpFiles = await getHelpFilesCached();
			const helpFile = helpFiles.find(f => f.slug === slug);
			
			const navigation = generateNavigation(helpFiles, helpFile ? slug : null);
			
			if (!helpFile) {
				// Show help page layout with not found message
				const html = generateHelpPageHtml({
					title: 'Article Not Found',
					description: '',
					html: '',
					navigation,
					isIndex: false,
					notFound: true,
					allFiles: helpFiles,
					showMobileHomeLink: true
				});
				
				const htmlWithHead = injectCommonHead(html);
				
				// Inject header if user is logged in
				const userId = req.auth?.userId;
				if (userId && queries) {
					const fs = await import("fs/promises");
					const user = await queries.selectUserById?.get(userId);
					if (user) {
						const rolePageName = getPageForUser(user);
						const rolePagePath = path.join(pagesDir, rolePageName);
						try {
							const roleHtml = await fs.readFile(rolePagePath, 'utf-8');
							const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
							if (headerMatch) {
								const headerHtml = headerMatch[0];
								const htmlWithHeader = htmlWithHead.replace('<!--APP_HEADER-->', headerHtml);
								
								// Add mobile nav if present
								const includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
								const finalHtml = includeMobileBottomNav
									? htmlWithHeader.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '<app-navigation-mobile></app-navigation-mobile>')
									: htmlWithHeader.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '');
								
								res.setHeader("Content-Type", "text/html");
								return res.status(404).send(finalHtml);
							}
						} catch {
							// Fall through to non-header version
						}
					}
				}
				
				// Public header when not logged in
				const publicHeader = await getPublicHeaderHtml();
				const finalHtml = htmlWithHead
					.replace('<!--APP_HEADER-->', publicHeader)
					.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '');
				
				res.setHeader("Content-Type", "text/html");
				return res.status(404).send(finalHtml);
			}
			
			const searchQuery = String(req.query.q || '').trim();
			const html = generateHelpPageHtml({
				title: helpFile.title,
				description: helpFile.description,
				html: helpFile.html,
				navigation,
				isIndex: false,
				beta: helpFile.beta,
				allFiles: helpFiles,
				searchQuery,
				showMobileHomeLink: true
			});
			
			const htmlWithHead = injectCommonHead(html);
			
			// Inject header if user is logged in
			const userId = req.auth?.userId;
			if (userId && queries) {
				const fs = await import("fs/promises");
				const user = await queries.selectUserById?.get(userId);
				if (user) {
					const rolePageName = getPageForUser(user);
					const rolePagePath = path.join(pagesDir, rolePageName);
					try {
						const roleHtml = await fs.readFile(rolePagePath, 'utf-8');
						const headerMatch = roleHtml.match(/<app-navigation[\s\S]*?<\/app-navigation>/i);
						if (headerMatch) {
							const headerHtml = headerMatch[0];
							const htmlWithHeader = htmlWithHead.replace('<!--APP_HEADER-->', headerHtml);
							
							// Add mobile nav if present
							const includeMobileBottomNav = /<app-navigation-mobile\b/i.test(roleHtml);
							const finalHtml = includeMobileBottomNav
								? htmlWithHeader.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '<app-navigation-mobile></app-navigation-mobile>')
								: htmlWithHeader.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '');
							
							res.setHeader("Content-Type", "text/html");
							return res.send(finalHtml);
						}
					} catch {
						// Fall through to non-header version
					}
				}
			}
			
			// Public header when not logged in
			const publicHeader = await getPublicHeaderHtml();
			const finalHtml = htmlWithHead
				.replace('<!--APP_HEADER-->', publicHeader)
				.replace('<!--APP_MOBILE_BOTTOM_NAV-->', '');
			
			res.setHeader("Content-Type", "text/html");
			return res.send(finalHtml);
		} catch (error) {
			console.error('Error rendering help article:', error);
			return res.status(500).send('Error loading help article');
		}
	});
	
	return router;
}
