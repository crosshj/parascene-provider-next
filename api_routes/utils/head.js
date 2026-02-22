const html = String.raw;

function getCommonHead() {
	return html`
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="color-scheme" content="light dark" />
		<meta name="supported-color-schemes" content="light dark" />
		<meta name="description" content="parascene is a community that uses AI, ML, and algorithms to support creation. Join us for creativity, entertainment, and involvement." />
		<meta name="theme-color" content="#242131" />
		<meta name="mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-title" content="Parascene" />

		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="manifest" href="/manifest.webmanifest" />
		<link rel="apple-touch-icon" href="/icons/icon-180.png" />

		<link rel="preconnect" href="https://fonts.googleapis.com">
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
		<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
		<link rel="stylesheet" href="/global.css" />
		<script type="module" src="/global.js"></script>
	`.trimEnd();
}

export function injectCommonHead(htmlContent) {
	// Inject common head elements before existing head content
	const headMatch = htmlContent.match(/<head>([\s\S]*?)<\/head>/i);
	if (!headMatch) {
		return htmlContent;
	}

	const commonHead = getCommonHead();
	const existingHeadContent = headMatch[1];
	return htmlContent.replace(/<head>[\s\S]*?<\/head>/i, `<head>\n${commonHead}${existingHeadContent}</head>`);
}
