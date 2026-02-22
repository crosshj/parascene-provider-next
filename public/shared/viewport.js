/**
 * Viewport / device helpers for layout (e.g. iOS Safari prompt-editor caps).
 * Used to avoid unbounded autosize and visual viewport feedback loops on mobile.
 */

/** True when running on iOS (iPhone, iPad, iPod). */
export function isIOS() {
	return /iPad|iPhone|iPod/.test(navigator.userAgent || '');
}

/** Max height in px for prompt-style textareas (capped by viewport). ~38vh for stable typing on iOS. */
export function getPromptEditorMaxHeightPx() {
	if (typeof window === 'undefined' || !window.innerHeight) return 400;
	return Math.round(0.38 * window.innerHeight);
}
