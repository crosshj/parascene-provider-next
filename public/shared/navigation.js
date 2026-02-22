/**
 * Standard way to navigate from a modal (or any context that should close modals first).
 * Closes all open modals so the user sees them close, then navigates after a short delay.
 * Use this for any link/action that leaves the current page from inside a modal.
 * Future: loading indicator, page transitions.
 */


export function closeModalsAndNavigate(href) {
	if (!href || typeof href !== 'string') return;
	const trimmed = href.trim();
	if (!trimmed || trimmed === '#') return;

	document.dispatchEvent(new CustomEvent('close-all-modals'));
	window.location.href = trimmed;
}
