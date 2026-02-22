// Global components that all pages will use
import './components/navigation/index.js';
import './components/navigation/mobile.js';
import './components/elements/tabs.js';
import './components/modals/profile.js';
import './components/modals/credits.js';
import './components/modals/notifications.js';
import './components/modals/server.js';
import './components/modals/user.js';
import './components/modals/todo.js';
import './components/modals/creation-details.js';
import './components/routes/feed.js';
import './components/routes/explore.js';
import './components/routes/servers.js';
import './components/routes/creations.js';
import './components/routes/create.js';
import './components/routes/templates.js';
import './components/routes/users.js';
import './components/routes/todo.js';
import { refreshAutoGrowTextareas } from './shared/autogrow.js';
import { closeModalsAndNavigate } from './shared/navigation.js';

// Wait for DOM and custom elements to be ready before showing content
async function initPage() {
	// Wait for DOM to be ready
	if (document.readyState === 'loading') {
		await new Promise(resolve => {
			document.addEventListener('DOMContentLoaded', resolve);
		});
	}

	// Wait for all custom elements to be defined
	const customElementTags = [
		'app-navigation',
		'app-navigation-mobile',
		'app-tabs',
		'app-modal-profile',
		'app-modal-credits',
		'app-modal-notifications',
		'app-modal-server',
		'app-modal-user',
		'app-modal-todo',
		'app-modal-creation-details',
		'app-route-feed',
		'app-route-explore',
		'app-route-creations',
		'app-route-servers',
		'app-route-create',
		'app-route-templates',
		'app-route-users',
		'app-route-todo',
		'app-route-servers'
	];
	await Promise.all(
		customElementTags.map(tag => customElements.whenDefined(tag))
	);

	// Small delay to ensure components are fully initialized and rendered
	await new Promise(resolve => {
		requestAnimationFrame(() => {
			requestAnimationFrame(resolve);
		});
	});

	// Show the page
	document.body.classList.add('loaded');

	// Create page: wire image-edit area (placeholder) and "change image" to shared image picker modal
	if (document.body.classList.contains('create-page')) {
		const changeLink = document.getElementById('create-change-image-link');
		const area = document.querySelector('.create-image-edit-area');
		/** @type {string|File|null} */
		let imageEditValue = null;

		function openImagePicker() {
			import('./shared/providerFormFields.js').then(({ openImagePickerModal }) => {
				openImagePickerModal({
					onSelect(value) {
						const box = area?.closest('.create-image-edit-box');
						if (!box) return;
						imageEditValue = value instanceof File || typeof value === 'string' ? value : null;
						const prevThumb = box.querySelector('.create-image-edit-thumb');
						if (prevThumb?.src?.startsWith('blob:')) {
							URL.revokeObjectURL(prevThumb.src);
						}
						box.dataset.imageValue = value instanceof File ? value.name : value;
						let thumbSrc = typeof value === 'string' ? value : value instanceof File ? URL.createObjectURL(value) : null;
						if (thumbSrc && area) {
							let thumb = prevThumb || box.querySelector('.create-image-edit-thumb');
							if (!thumb) {
								thumb = document.createElement('img');
								thumb.className = 'create-image-edit-thumb';
								thumb.alt = '';
								area.insertBefore(thumb, area.firstChild);
							}
							thumb.src = thumbSrc;
							thumb.hidden = false;
							area.querySelector('.create-image-edit-placeholder')?.classList.add('is-hidden');
							changeLink?.classList.add('is-visible');
						}
						if (typeof updateEditImageButtonState === 'function') updateEditImageButtonState();
					},
				});
			});
		}

		if (area) {
			area.addEventListener('click', () => {
				if (!area.querySelector('.create-image-edit-placeholder.is-hidden')) openImagePicker();
			});
			area.addEventListener('keydown', (e) => {
				if ((e.key === 'Enter' || e.key === ' ') && !area.querySelector('.create-image-edit-placeholder.is-hidden')) {
					e.preventDefault();
					openImagePicker();
				}
			});
		}
		if (changeLink) {
			changeLink.addEventListener('click', (e) => {
				e.preventDefault();
				openImagePicker();
			});
		}

		// Create page: remember tab, prompts, and style in localStorage
		const STORAGE_KEYS = {
			tab: 'create_page_tab',
			promptText: 'create_page_prompt_text',
			promptImageEdit: 'create_page_prompt_image_edit',
			styleIndex: 'create_page_style_index',
			styleSelected: 'create_page_style_selected',
		};
		const tabsEl = document.querySelector('.create-content app-tabs');
		const promptInputs = document.querySelectorAll('.create-content .create-prompt-input');
		const textToImagePrompt = promptInputs[0];
		const imageEditPrompt = promptInputs[1];
		const styleCards = document.querySelector('.create-content .create-style-cards');
		const styleColumns = styleCards ? styleCards.querySelectorAll('.create-style-column') : [];

		function saveTab(id) {
			try { localStorage.setItem(STORAGE_KEYS.tab, String(id || '')); } catch (_) {}
		}
		function savePrompts() {
			try {
				if (textToImagePrompt) localStorage.setItem(STORAGE_KEYS.promptText, textToImagePrompt.value || '');
				if (imageEditPrompt) localStorage.setItem(STORAGE_KEYS.promptImageEdit, imageEditPrompt.value || '');
			} catch (_) {}
		}
		function saveStyleIndex(index) {
			try { localStorage.setItem(STORAGE_KEYS.styleIndex, String(Math.max(0, index))); } catch (_) {}
		}
		function saveStyleSelected(key) {
			try { localStorage.setItem(STORAGE_KEYS.styleSelected, String(key || '')); } catch (_) {}
		}

		// Restore tab
		const savedTab = (() => { try { return localStorage.getItem(STORAGE_KEYS.tab); } catch (_) { return null; } })();
		if (tabsEl && savedTab && typeof tabsEl.setActiveTab === 'function') {
			tabsEl.setActiveTab(savedTab, { focus: false });
		}

		// Restore prompts
		if (textToImagePrompt) {
			const v = (() => { try { return localStorage.getItem(STORAGE_KEYS.promptText); } catch (_) { return null; } })();
			if (v != null) textToImagePrompt.value = v;
		}
		if (imageEditPrompt) {
			const v = (() => { try { return localStorage.getItem(STORAGE_KEYS.promptImageEdit); } catch (_) { return null; } })();
			if (v != null) imageEditPrompt.value = v;
		}
		try { refreshAutoGrowTextareas(document); } catch (_) {}

		// Prompt clear links and empty state (glow when no text)
		document.querySelectorAll('.create-content .create-prompt-wrap').forEach((wrap) => {
			const field = wrap.querySelector('.create-prompt-input');
			const clearLink = wrap.querySelector('.create-prompt-clear');
			if (!field || !clearLink) return;
			function updateClearVisibility() {
				clearLink.classList.toggle('is-visible', (field.value || '').trim().length > 0);
			}
			function updateEmptyState() {
				wrap.classList.toggle('is-empty', !(field.value || '').trim().length);
			}
			field.addEventListener('input', () => { updateClearVisibility(); updateEmptyState(); });
			field.addEventListener('change', () => { updateClearVisibility(); updateEmptyState(); });
			updateClearVisibility();
			updateEmptyState();
			clearLink.addEventListener('click', (e) => {
				e.preventDefault();
				field.value = '';
				clearLink.classList.remove('is-visible');
				wrap.classList.add('is-empty');
				field.dispatchEvent(new Event('input', { bubbles: true }));
				try { refreshAutoGrowTextareas(document); } catch (_) {}
			});
		});

		// Restore style selection and scroll so selected style is in view (after layout)
		const savedStyleSelected = (() => { try { return (localStorage.getItem(STORAGE_KEYS.styleSelected) || '').trim(); } catch (_) { return ''; } })();
		const savedStyleIndex = (() => { try { const n = parseInt(localStorage.getItem(STORAGE_KEYS.styleIndex), 10); return isNaN(n) ? null : n; } catch (_) { return null; } })();
		function scrollToStyleColumnAndUpdateDots(index) {
			if (!styleCards || !styleColumns.length) return;
			const step = styleColumns[0].offsetWidth + (parseFloat(getComputedStyle(styleCards).gap) || 12);
			const i = Math.max(0, Math.min(index, styleColumns.length - 1));
			styleCards.scrollLeft = i * step;
			const dotsWrap = styleCards.closest('.create-style-section')?.querySelector('.create-style-dots');
			const dots = dotsWrap?.querySelectorAll('.create-style-dot');
			if (dots?.length) {
				const activeStart = Math.max(0, Math.min(i, styleColumns.length - 4));
				dots.forEach((d, j) => d.classList.toggle('is-active', j >= activeStart && j < activeStart + 4));
			}
		}
		if (styleCards && styleColumns.length) {
			const run = () => {
				let scrollIndex = null;
				if (savedStyleSelected) {
					const selectedCard = Array.from(styleCards.querySelectorAll('.create-style-card')).find((c) => c.getAttribute('data-key') === savedStyleSelected);
					if (selectedCard) {
						const column = selectedCard.closest('.create-style-column');
						if (column) {
							scrollIndex = Array.from(styleColumns).indexOf(column);
							if (scrollIndex >= 0) {
								selectedCard.classList.add('is-selected');
							}
						}
					}
				}
				const hasSelection = styleCards.querySelector('.create-style-card.is-selected');
				if (!hasSelection) {
					const noneCard = Array.from(styleCards.querySelectorAll('.create-style-card')).find((c) => c.getAttribute('data-key') === 'none');
					if (noneCard) {
						noneCard.classList.add('is-selected');
						const column = noneCard.closest('.create-style-column');
						if (column) scrollIndex = Array.from(styleColumns).indexOf(column);
					}
				}
				if (scrollIndex == null && savedStyleIndex != null && savedStyleIndex >= 0) {
					scrollIndex = savedStyleIndex;
				}
				if (scrollIndex != null) scrollToStyleColumnAndUpdateDots(scrollIndex);
			};
			requestAnimationFrame(() => requestAnimationFrame(run));
		}

		// Style card click: select one style, remember it
		const styleSection = document.querySelector('.create-content .create-style-section');
		const allStyleCards = styleSection?.querySelectorAll('.create-style-card');
		if (allStyleCards?.length) {
			allStyleCards.forEach((card, i) => {
				card.setAttribute('data-color-index', String(i % 9));
			});
			// Thumbnails (manual for now; server will build in long run)
			const { getStyleThumbUrl } = await import('./pages/create-styles.js');
			allStyleCards.forEach((card) => {
				const key = card.getAttribute('data-key');
				if (!key) return;
				const url = key === 'none' ? '/assets/style-thumbs/none.webp' : getStyleThumbUrl(key);
				if (!url) return;
				const img = document.createElement('img');
				img.className = 'create-style-card-thumb';
				img.src = url;
				img.width = 140;
				img.height = 160;
				img.loading = 'lazy';
				img.decoding = 'async';
				img.alt = '';
				card.insertBefore(img, card.firstChild);
			});
			allStyleCards.forEach((card) => {
				card.addEventListener('click', () => {
					const key = card.getAttribute('data-key');
					if (!key) return;
					allStyleCards.forEach((c) => c.classList.remove('is-selected'));
					card.classList.add('is-selected');
					saveStyleSelected(key);
				});
			});
		}

		// Listen and save tab changes
		if (tabsEl) {
			tabsEl.addEventListener('tab-change', (e) => { if (e.detail?.id) saveTab(e.detail.id); });
		}

		// Listen and save prompts (debounced)
		let promptSaveTimer;
		function schedulePromptSave() {
			clearTimeout(promptSaveTimer);
			promptSaveTimer = setTimeout(savePrompts, 300);
		}
		[textToImagePrompt, imageEditPrompt].filter(Boolean).forEach((el) => {
			el.addEventListener('input', schedulePromptSave);
			el.addEventListener('change', schedulePromptSave);
		});

		// Listen and save style index (debounced)
		let styleSaveTimer;
		function scheduleStyleSave() {
			clearTimeout(styleSaveTimer);
			styleSaveTimer = setTimeout(() => {
				if (!styleCards || !styleColumns.length) return;
				const step = styleColumns[0].offsetWidth + (parseFloat(getComputedStyle(styleCards).gap) || 12);
				const index = Math.round(styleCards.scrollLeft / step);
				saveStyleIndex(Math.max(0, Math.min(index, styleColumns.length - 1)));
			}, 200);
		}
		if (styleCards) {
			styleCards.addEventListener('scroll', scheduleStyleSave, { passive: true });
			if ('scrollend' in styleCards) styleCards.addEventListener('scrollend', scheduleStyleSave);
		}

		// Text-to-image: Create Image button — same server/method as try (server 1, fluxImage), submit via create API and navigate to creations
		const createImageBtn = document.querySelector('.create-content .create-btn-generate');
		function updateSimpleCreateButtonState() {
			if (!createImageBtn) return;
			const promptText = (textToImagePrompt?.value || '').trim();
			createImageBtn.disabled = !promptText;
		}
		updateSimpleCreateButtonState();
		if (textToImagePrompt) {
			textToImagePrompt.addEventListener('input', updateSimpleCreateButtonState);
			textToImagePrompt.addEventListener('change', updateSimpleCreateButtonState);
		}
		function extractMentions(prompt) {
			const text = typeof prompt === 'string' ? prompt : '';
			if (!text) return [];
			const out = [];
			const seen = new Set();
			const re = /@([a-zA-Z0-9_]+)/g;
			let match;
			while ((match = re.exec(text)) !== null) {
				const full = `@${match[1]}`;
				if (seen.has(full)) continue;
				seen.add(full);
				out.push(full);
			}
			return out;
		}

		async function validateMentionsSimple(args) {
			const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
			const mentions = extractMentions(prompt);
			if (mentions.length === 0) return { ok: true, mentions };
			const res = await fetch('/api/create/validate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ args: args || {} })
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) return { ok: true, mentions, data };
			return { ok: false, mentions, data, status: res.status };
		}

		if (createImageBtn) {
			createImageBtn.addEventListener('click', async () => {
				const userPrompt = (textToImagePrompt?.value || '').trim();
				if (!userPrompt) return;
				const selectedCard = styleSection?.querySelector('.create-style-card.is-selected');
				const styleKey = selectedCard?.getAttribute('data-key') || 'none';
				const { submitCreationWithPending, formatMentionsFailureForDialog } = await import('./shared/createSubmit.js');

				const doSubmit = (hydrateMentions) => {
					submitCreationWithPending({
						serverId: 1,
						methodKey: 'fluxImage',
						args: { prompt: userPrompt },
						styleKey: styleKey !== 'none' ? styleKey : undefined,
						hydrateMentions,
						navigate: 'full'
					});
				};

				const mentions = extractMentions(userPrompt);
				if (mentions.length === 0) {
					doSubmit(false);
					return;
				}

				const validateResult = await validateMentionsSimple({ args: { prompt: userPrompt } });
				if (validateResult.ok) {
					doSubmit(true);
					return;
				}

				const message = formatMentionsFailureForDialog(validateResult.data);
				if (window.confirm(message + '\n\nSubmit anyway?')) {
					doSubmit(false);
				}
			});
		}

		// Image Edit tab: same server/method as creation edit page (shared mutateOptions), required fields, mentions check, submit
		const editImageBtn = document.querySelectorAll('.create-content .create-btn-generate')[1];
		const mutateOptions = { serverId: null, methodKey: null };

		async function loadMutateOptions() {
			const { loadFirstMutateOptions } = await import('./shared/mutateOptions.js');
			const first = await loadFirstMutateOptions();
			if (first) {
				mutateOptions.serverId = first.serverId;
				mutateOptions.methodKey = first.methodKey;
			}
		}

		function updateEditImageButtonState() {
			if (!editImageBtn) return;
			const hasImage = Boolean(imageEditValue);
			const hasPrompt = (imageEditPrompt?.value || '').trim().length > 0;
			const hasMutate = Boolean(mutateOptions.serverId && mutateOptions.methodKey);
			editImageBtn.disabled = !hasImage || !hasPrompt || !hasMutate;
		}

		void loadMutateOptions().then(() => updateEditImageButtonState());
		if (imageEditPrompt) {
			imageEditPrompt.addEventListener('input', updateEditImageButtonState);
			imageEditPrompt.addEventListener('change', updateEditImageButtonState);
		}

		if (editImageBtn) {
			editImageBtn.addEventListener('click', async () => {
				const userPrompt = (imageEditPrompt?.value || '').trim();
				if (!userPrompt || !imageEditValue) return;
				if (!mutateOptions.serverId || !mutateOptions.methodKey) return;

				let imageUrl;
				if (imageEditValue instanceof File) {
					try {
						const { uploadImageFile } = await import('./shared/createSubmit.js');
						imageUrl = await uploadImageFile(imageEditValue);
					} catch (err) {
						alert(err?.message || 'Image upload failed');
						return;
					}
				} else {
					imageUrl = typeof imageEditValue === 'string' ? imageEditValue : '';
				}
				if (!imageUrl) {
					alert('Please choose an image.');
					return;
				}

				const args = { prompt: userPrompt, image_url: imageUrl };
				const { submitCreationWithPending, formatMentionsFailureForDialog } = await import('./shared/createSubmit.js');

				const doSubmit = (hydrateMentions) => {
					submitCreationWithPending({
						serverId: mutateOptions.serverId,
						methodKey: mutateOptions.methodKey,
						args,
						hydrateMentions,
						navigate: 'full'
					});
				};

				const mentions = extractMentions(userPrompt);
				if (mentions.length === 0) {
					doSubmit(false);
					return;
				}

				const validateResult = await validateMentionsSimple({ args });
				if (validateResult.ok) {
					doSubmit(true);
					return;
				}

				const message = formatMentionsFailureForDialog(validateResult.data);
				if (window.confirm(message + '\n\nSubmit anyway?')) {
					doSubmit(false);
				}
			});
		}
	}

	// Auto-grow textareas (run after components + layout settle)
	try {
		refreshAutoGrowTextareas(document);
	} catch {
		// ignore
	}
	try {
		const fonts = document.fonts;
		if (fonts?.ready && typeof fonts.ready.then === 'function') {
			fonts.ready.then(() => refreshAutoGrowTextareas(document)).catch(() => {});
		}
	} catch {
		// ignore
	}
}

initPage();

// Keep autogrow heights correct when UI changes visibility/layout.
document.addEventListener('tab-change', () => {
	try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
});
document.addEventListener('route-change', () => {
	try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
});
window.addEventListener('resize', () => {
	try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
});
window.addEventListener('orientationchange', () => {
	try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
});

document.addEventListener('modal-opened', () => {
	setTimeout(() => {
		try { refreshAutoGrowTextareas(document); } catch { /* ignore */ }
	}, 0);
});


function registerServiceWorker() {
	if (!("serviceWorker" in navigator)) {
		return;
	}

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(error => {
			// console.warn("Service worker registration failed:", error);
		});
	});
}

registerServiceWorker();

// Prevent body scrolling when shadow DOM modals are open
// Regular DOM modals are handled by CSS :has() selector
// Shadow DOM modals dispatch events to toggle body class
let shadowModalCount = 0;

function updateBodyClass() {
	if (shadowModalCount > 0) {
		document.body.classList.add('modal-open');
	} else {
		document.body.classList.remove('modal-open');
	}
}

document.addEventListener('modal-opened', () => {
	shadowModalCount++;
	updateBodyClass();
});

document.addEventListener('modal-closed', () => {
	shadowModalCount = Math.max(0, shadowModalCount - 1);
	updateBodyClass();
});

// Standard modal navigation: intercept links inside modals and use closeModalsAndNavigate
// Use composedPath() so we find the real link when the click is inside shadow DOM (event is retargeted to host)
document.addEventListener('click', (e) => {
	const path = e.composedPath?.() || (e.target ? [e.target, ...ancestors(e.target)] : []);
	let link = null;
	for (const el of path) {
		if (el?.nodeType === 1 && el.tagName === 'A' && el.hasAttribute('href')) {
			link = el;
			break;
		}
	}
	if (!link) return;
	const href = link.getAttribute('href');
	if (!href || href.startsWith('#') || link.target === '_blank' || link.hasAttribute('download')) return;
	const root = link.getRootNode();
	const inModal = root instanceof ShadowRoot
		? root.host.hasAttribute?.('data-modal')
		: link.closest?.('[data-modal]');
	if (!inModal) return;
	e.preventDefault();
	e.stopPropagation();
	closeModalsAndNavigate(href);
}, true);

function ancestors(node) {
	const list = [];
	let n = node?.parentNode;
	while (n) {
		list.push(n);
		n = n.parentNode;
	}
	return list;
}