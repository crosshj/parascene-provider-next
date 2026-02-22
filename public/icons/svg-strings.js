// SVG strings for icons (public/icons). Use across the site (DRY).
// Each icon is (className?) => string. Wrap full SVG with withAttributes to add optional class.

const html = String.raw;

/** Returns (className?) => string that injects class into the <svg> tag when provided. */
function withAttributes(svgString) {
	return (className = '') => {
		if (!className) return svgString.replace('<svg', `<svg data-from="svg-strings"`);
		return svgString.replace('<svg', `<svg class="${className}" data-from="svg-strings"`);
	}
}

// ICONS

export const homeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path class="home-house"
			d="M 3 9 L 12 2 L 21 9 L 21 20 C 21 21.105 20.105 22 19 22 L 15 22 L 15 12 L 9 12 L 9 22 L 5 22 C 3.895 22 3 21.105 3 20 Z">
		</path>
	</svg>
`);

export const helpIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<circle cx="12" cy="12" r="10"></circle>
		<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
		<line x1="12" y1="17" x2="12.01" y2="17"></line>
	</svg>
`);

export const closeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<line x1="18" y1="6" x2="6" y2="18"></line>
		<line x1="6" y1="6" x2="18" y2="18"></line>
	</svg>
`);

export const xIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path
			d="M21.742 21.75l-7.563-11.179 7.056-8.321h-2.456l-5.691 6.714-4.54-6.714H2.359l7.29 10.776L2.25 21.75h2.456l6.035-7.118 4.818 7.118h6.191-.008zM7.739 3.818L18.81 20.182h-2.447L5.29 3.818h2.447z">
		</path>
	</svg>
`);

export const facebookIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v7h3v-7h3l1-3h-4v-2c0-.6.4-1 1-1z"></path>
	</svg>
`);

export const redditIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path
			d="M 19.43 13.883 C 19.43 17.399 14.992 20.874 11.032 20.874 C 7.072 20.874 2.616 17.399 2.616 13.883 C 2.616 10.367 7.174 6.765 11.134 6.765 C 15.094 6.765 19.43 10.367 19.43 13.883 Z M 8.48 12.726 C 7.836 12.726 7.314 13.248 7.314 13.892 C 7.314 14.536 7.836 15.058 8.48 15.058 C 9.124 15.058 9.646 14.536 9.646 13.892 C 9.646 13.248 9.124 12.726 8.48 12.726 Z M 13.726 12.726 C 13.082 12.726 12.56 13.248 12.56 13.892 C 12.56 14.536 13.082 15.058 13.726 15.058 C 14.37 15.058 14.892 14.536 14.892 13.892 C 14.892 13.248 14.37 12.726 13.726 12.726 Z"
			fill="currentColor" stroke-width="0"></path>
		<path d="M 13.22 7.066 L 15.303 3.674 L 17.994 4.685" style=""></path>
		<circle cx="19.981" cy="5.426" r="3" fill="currentColor" stroke="none" style=""
			transform="matrix(0.74681, 0, 0, 0.744378, 4.472072, 1.201748)"></circle>
		<path
			d="M 20.222 14.267 C 20.222 15.664 18.473 16.016 18.473 16.016 L 18.473 12.518 C 18.473 12.518 20.222 12.46 20.222 14.267 Z">
		</path>
		<path
			d="M 1.827 14.31 C 1.827 15.707 3.576 16.059 3.576 16.059 L 3.576 12.561 C 3.576 12.561 1.827 12.503 1.827 14.31 Z">
		</path>
	</svg>
`);

export const linkedinIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M6.5 9.5H3.8V21h2.7V9.5zM5.2 3C4.2 3 3.4 3.8 3.4 4.8s.8 1.8 1.8 1.8S7 5.8 7 4.8 6.2 3 5.2 3zM20.6 21h-2.7v-5.9c0-1.4 0-3.2-2-3.2s-2.3 1.5-2.3 3.1V21H10.9V9.5h2.6v1.6h.04c.36-.7 1.24-1.5 2.56-1.5 2.74 0 3.25 1.8 3.25 4.2V21z">
		</path>
	</svg>
`);

export const smsIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
	</svg>
`);

export const emailIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M4 6h16v12H4z"></path>
		<path d="M4 7l8 6 8-6"></path>
	</svg>
`);

export const shareIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<circle cx="18" cy="5" r="2"></circle>
		<circle cx="6" cy="12" r="2"></circle>
		<circle cx="18" cy="19" r="2"></circle>
		<path d="M8 12l8-6"></path>
		<path d="M8 12l8 6"></path>
	</svg>
`);

export const linkIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"></path>
		<path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"></path>
	</svg>
`);

/** Shield icon (e.g. for content policy / moderated state). */
export const shieldIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
	</svg>
`);

/** Eye with slash through the pupil (e.g. content hidden / not visible / moderated). Balanced proportions, not pinched vertically. */
export const eyeHiddenIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
	
		<path d="M 1.166 11.968 C 8.351 3.687 15.535 3.687 22.721 11.968 C 15.535 20.252 8.351 20.252 1.166 11.968 Z">
		</path>
		<circle cx="12.027" cy="12.053" r="5.632"></circle>
		<line x1="6.986" y1="7.246" x2="16.571" y2="16.832"></line>
	
	</svg>
`);

export const qrCodeIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<rect x="3" y="3" width="7" height="7" rx="1" />
		<rect x="14" y="3" width="3" height="3" rx="0.5" />
		<rect x="14" y="9" width="3" height="3" rx="0.5" />
		<rect x="3" y="14" width="3" height="3" rx="0.5" />
		<rect x="9" y="14" width="3" height="3" rx="0.5" />
		<rect x="14" y="14" width="7" height="7" rx="1" />
	</svg>
`);

export const searchIcon = withAttributes(html`
<svg fill="currentColor" viewBox="0 0 24 24">
	<path
		d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z">
	</path>
</svg>
`);

export const starIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M12 3.25l2.36 4.78 5.28.77-3.82 3.72.9 5.26L12 15.97 7.28 17.78l.9-5.26-3.82-3.72 5.28-.77L12 3.25z">
		</path>
	</svg>
`);

export const notifyIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
		<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
		<path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
	</svg>
`);

export const creditIcon = withAttributes(html`

	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
		stroke-linejoin="round" aria-hidden="true">
	
		<circle cx="12" cy="12" r="9"></circle>
	
		<path
			d="M 9.301 16.612 L 9.301 7.758 L 12.641 7.758 C 13.231 7.758 13.678 7.786 13.988 7.841 C 14.424 7.915 14.788 8.053 15.08 8.257 C 15.376 8.459 15.614 8.745 15.791 9.112 C 15.97 9.477 16.06 9.881 16.06 10.318 C 16.06 11.071 15.821 11.709 15.34 12.231 C 14.862 12.753 13.996 13.013 12.744 13.013 L 10.474 13.013 L 10.474 16.612 L 9.301 16.612 Z M 10.474 11.967 L 12.762 11.967 C 13.518 11.967 14.057 11.826 14.375 11.544 C 14.694 11.264 14.853 10.866 14.853 10.354 C 14.853 9.985 14.759 9.667 14.572 9.403 C 14.385 9.141 14.138 8.967 13.832 8.881 C 13.634 8.829 13.271 8.803 12.739 8.803 L 10.474 8.803 L 10.474 11.967 Z"
			fill="currentColor" stroke-linejoin="miter" stroke-width="1"></path>
	</svg>
`);

/** User avatar icon: square, light grey bg, darker grey head + shoulders. Circle shape from CSS (e.g. border-radius: 50%). */
export const userAvatarIcon = withAttributes(html`
	<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect class="user-avatar-icon-bg" width="24" height="24" rx="0" />
		<circle class="user-avatar-icon-figure" cx="12" cy="8" r="3.5" />
		<ellipse class="user-avatar-icon-figure" cx="12" cy="20.5" rx="6.5" ry="8" />
	</svg>
`);
