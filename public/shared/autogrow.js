import { getPromptEditorMaxHeightPx } from './viewport.js';

const DEFAULT_MAX_HEIGHT_PX = 1200;

// Track per-element minimum heights computed from "empty" content.
const minHeightCache = new WeakMap();
const rafTokenCache = new WeakMap();

function isVisible(el) {
	if (!(el instanceof HTMLElement)) return false;
	// getClientRects is empty when display:none or not in DOM flow.
	return el.getClientRects().length > 0;
}

function getEmptyScrollHeight(textarea) {
	const cached = minHeightCache.get(textarea);
	if (Number.isFinite(cached) && cached > 0) return cached;

	const previousValue = textarea.value;
	const previousHeight = textarea.style.height;

	textarea.value = '';
	textarea.style.height = 'auto';
	const h = textarea.scrollHeight;

	textarea.value = previousValue;
	textarea.style.height = previousHeight;

	if (Number.isFinite(h) && h > 0) {
		minHeightCache.set(textarea, h);
		return h;
	}
	return 0;
}

function schedule(el, fn) {
	const existing = rafTokenCache.get(el);
	if (existing) cancelAnimationFrame(existing);
	const token = requestAnimationFrame(() => {
		rafTokenCache.delete(el);
		fn();
	});
	rafTokenCache.set(el, token);
}

export function resizeAutoGrowTextarea(textarea, { maxHeightPx = DEFAULT_MAX_HEIGHT_PX } = {}) {
	if (!(textarea instanceof HTMLTextAreaElement)) return;
	if (!isVisible(textarea)) return;

	textarea.style.height = 'auto';

	const emptyHeight = getEmptyScrollHeight(textarea);
	const next = textarea.scrollHeight;
	const clamped = Math.min(maxHeightPx, Math.max(emptyHeight || 0, next || 0));
	if (clamped > 0) {
		textarea.style.height = `${clamped}px`;
	}
}

export function attachAutoGrowTextarea(textarea, { maxHeightPx = DEFAULT_MAX_HEIGHT_PX } = {}) {
	if (!(textarea instanceof HTMLTextAreaElement)) return () => {};

	textarea.dataset.autogrow = textarea.dataset.autogrow || 'true';
	const isPromptEditor = textarea.classList.contains('prompt-editor');
	// Prompt editors: cap height and scroll internally to avoid iOS Safari viewport jump.
	if (isPromptEditor) {
		textarea.style.overflowY = 'auto';
		textarea.style.resize = 'none';
	} else {
		textarea.style.overflow = 'hidden';
		textarea.style.resize = 'none';
	}

	const getMaxPx = () => (isPromptEditor ? getPromptEditorMaxHeightPx() : maxHeightPx);
	const refresh = () => schedule(textarea, () => resizeAutoGrowTextarea(textarea, { maxHeightPx: getMaxPx() }));

	textarea.addEventListener('input', refresh);
	textarea.addEventListener('change', refresh);
	textarea.addEventListener('focus', refresh);

	// Initial sizing: do a few passes to handle late font/layout settling.
	refresh();
	setTimeout(refresh, 0);
	setTimeout(refresh, 60);
	setTimeout(refresh, 250);

	// ResizeObserver handles width changes (layout / orientation).
	if (typeof ResizeObserver !== 'undefined') {
		const ro = new ResizeObserver(() => refresh());
		ro.observe(textarea);
		textarea.addEventListener('blur', () => {
			// keep observer; no-op
		});
	}

	return refresh;
}

export function refreshAutoGrowTextareas(root = document) {
	const scope = root instanceof Document ? root : root instanceof HTMLElement ? root : document;
	const textareas = Array.from(scope.querySelectorAll('textarea[data-autogrow], textarea[data-autogrow="true"], textarea[data-feature-request-message]'));
	textareas.forEach((ta) => {
		attachAutoGrowTextarea(ta);
	});
}

