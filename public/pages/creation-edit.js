import { submitCreationWithPending, formatMentionsFailureForDialog } from '/shared/createSubmit.js';
import { fetchJsonWithStatusDeduped } from '/shared/api.js';
import { attachAutoGrowTextarea } from '/shared/autogrow.js';
import { DEFAULT_APP_ORIGIN } from '/shared/userText.js';
import { getMethodIntentList, loadMutateServerOptions } from '/shared/mutateOptions.js';

const html = String.raw;

function toParasceneImageUrl(raw) {
	const base = (typeof window !== 'undefined' && window.location?.origin) || DEFAULT_APP_ORIGIN;
	if (typeof raw !== 'string') return '';
	const value = raw.trim();
	if (!value) return '';
	try {
		const parsed = new URL(value, base);
		// Only normalize http(s) URLs.
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return '';
	}
}

let isMutateDirty = false;
let hasInstalledNavigationGuard = false;

function confirmDiscardChanges() {
	if (!isMutateDirty) return true;
	return window.confirm('You have unsaved changes. If you leave this page, you will lose them. Continue?');
}

function installNavigationGuardOnce() {
	if (hasInstalledNavigationGuard) return;
	hasInstalledNavigationGuard = true;

	// Browser-level fallback: refresh, back/forward, closing tab, etc.
	window.addEventListener('beforeunload', (e) => {
		if (!isMutateDirty) return;
		e.preventDefault();
		e.returnValue = '';
	});

	// Intercept user-initiated navigation clicks (header links, mobile nav, anchors).
	document.addEventListener('click', (e) => {
		if (!isMutateDirty) return;

		// Header/mobile nav route clicks (often <a data-route> or <button data-route>).
		const routeEl = e.target?.closest?.('[data-route]');
		if (routeEl) {
			if (!confirmDiscardChanges()) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
			return;
		}

		// Normal links.
		const a = e.target?.closest?.('a[href]');
		if (!a) return;
		const href = a.getAttribute('href') || '';
		if (!href) return;
		if (href.startsWith('#')) return;
		if (href.toLowerCase().startsWith('javascript:')) return;
		if (a.target && a.target !== '_self') return;

		if (!confirmDiscardChanges()) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}, true);
}

function getCreationId() {
	const pathname = window.location.pathname;
	const match = pathname.match(/^\/creations\/(\d+)\/(edit|mutat|mutate)$/);
	return match ? parseInt(match[1], 10) : null;
}

function withVariant(url, variant) {
	if (typeof url !== 'string' || !url) return '';
	try {
		const parsed = new URL(url, window.location.origin);
		parsed.searchParams.set('variant', variant);
		return parsed.toString();
	} catch {
		const parts = url.split('#');
		const base = parts[0] || '';
		const hash = parts.length > 1 ? `#${parts.slice(1).join('#')}` : '';
		const joiner = base.includes('?') ? '&' : '?';
		return `${base}${joiner}variant=${encodeURIComponent(variant)}${hash}`;
	}
}

async function loadEditPage() {
	const editContent = document.querySelector('[data-edit-content]');
	if (!editContent) return;

	installNavigationGuardOnce();

	const creationId = getCreationId();
	if (!creationId) {
		editContent.innerHTML = html`
			<div class="route-empty">
				<div class="route-empty-title">Invalid creation ID</div>
			</div>
		`;
		return;
	}

	editContent.innerHTML = '<div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>';

	try {
		const response = await fetch(`/api/create/images/${creationId}`, { credentials: 'include' });
		if (!response.ok) {
			editContent.innerHTML = html`
				<div class="route-empty">
					<div class="route-empty-title">Unable to load creation</div>
					<div class="route-empty-message">The creation you're trying to edit doesn't exist or you don't have access.</div>
				</div>
			`;
			return;
		}

		const creation = await response.json();
		const status = creation.status || 'completed';
		const canEdit = status === 'completed' && Boolean(creation.url);
		const title = typeof creation.title === 'string' && creation.title.trim() ? creation.title.trim() : 'Untitled';
		const creationDetailHref = `/creations/${creationId}`;
		const sourceImageUrl = canEdit ? String(creation.url) : '';
		const thumbUrl = canEdit ? withVariant(sourceImageUrl, 'thumbnail') : '';

		function escapeHtml(value) {
			return String(value ?? '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		if (!canEdit) {
			editContent.innerHTML = html`
				<div class="route-empty">
					<div class="route-empty-title">This creation is not ready to mutate</div>
					<div class="route-empty-message">Wait for it to finish rendering, then try again.</div>
				</div>
			`;
			return;
		}

		// While we build the form, keep the existing route loader visible.
		// Preload the thumbnail in the background so it can pop in quickly once rendered.
		const thumbPreload = new Promise((resolve) => {
			if (!thumbUrl) return resolve({ ok: false });
			const img = new Image();
			img.onload = () => resolve({ ok: true });
			img.onerror = () => resolve({ ok: false });
			img.decoding = 'async';
			img.src = thumbUrl;
		});

		const allServers = await loadMutateServerOptions();
		const flattened = [];
		allServers.forEach(server => {
			const methods = server?.server_config?.methods;
			if (!methods || typeof methods !== 'object') return;
			Object.keys(methods).forEach(methodKey => {
				const method = methods[methodKey];
				const intents = getMethodIntentList(method);
				if (!intents.includes('image_mutate')) return;
				flattened.push({
					serverId: Number(server.id),
					serverName: String(server.name || `Server ${server.id}`),
					server,
					methodKey,
					method,
					intents
				});
			});
		});

		if (flattened.length === 0) {
			editContent.innerHTML = html`
				<div class="route-empty">
					<div class="route-empty-title">No mutate methods available</div>
					<div class="route-empty-message">No servers currently expose a method with intent <strong>image_mutate</strong>.
					</div>
				</div>
			`;
			return;
		}

		// Unique servers in stable order
		const serverOrder = [];
		const serverById = new Map();
		flattened.forEach(item => {
			if (!serverById.has(item.serverId)) {
				serverById.set(item.serverId, { id: item.serverId, name: item.serverName, server: item.server });
				serverOrder.push(item.serverId);
			}
		});
		const availableServers = serverOrder.map(id => serverById.get(id)).filter(Boolean);

		function methodsForServer(serverId) {
			return flattened
				.filter(item => item.serverId === Number(serverId))
				.map(item => ({ methodKey: item.methodKey, method: item.method }))
				.sort((a, b) => String(a.method?.name || a.methodKey).localeCompare(String(b.method?.name || b.methodKey)));
		}

		const selectionState = {
			serverId: availableServers[0]?.id ?? null,
			methodKey: null
		};

		function renderServerOptions() {
			if (!(serverSelect instanceof HTMLSelectElement)) return;
			// Clear except placeholder
			while (serverSelect.children.length > 1) serverSelect.removeChild(serverSelect.lastChild);
			availableServers.forEach(s => {
				const opt = document.createElement('option');
				opt.value = String(s.id);
				opt.textContent = s.name;
				serverSelect.appendChild(opt);
			});
		}

		function renderMethodOptions() {
			if (!(methodSelect instanceof HTMLSelectElement)) return;
			// Clear except placeholder
			while (methodSelect.children.length > 1) methodSelect.removeChild(methodSelect.lastChild);
			if (!selectionState.serverId) return;
			const methods = methodsForServer(selectionState.serverId);
			methods.forEach(m => {
				const opt = document.createElement('option');
				opt.value = m.methodKey;
				opt.textContent = m.method?.name || m.methodKey;
				methodSelect.appendChild(opt);
			});
		}

		// Now that we have the server+method universe, render the full form in one shot.
		editContent.innerHTML = html`
			<form class="create-form" data-edit-form>
				<div class="form-group">
					<label class="form-label">Image</label>
					<div class="form-static image-field" aria-label="Source image">
						<div class="image-thumb-wrap" data-source-thumb-wrap title="View creation">
							<img class="image-thumb" data-source-thumb alt="Source image" />
						</div>
						<div class="image-meta">
							<div class="image-meta-title">${escapeHtml(title ? String(title) : 'Source image')}</div>
							<div class="image-meta-subtitle">Creation #${creationId}</div>
						</div>
					</div>
				</div>
			
				<div class="form-group" data-server-group style="display: none;">
					<label class="form-label" for="mutate-server">Server</label>
					<select class="form-select" id="mutate-server" data-server-select>
						<option value="">Select a server...</option>
					</select>
				</div>
			
				<div class="form-group" data-method-group style="display: none;">
					<div class="method-context" data-method-context style="display: none;">
						Server: <span data-method-server-name></span>
					</div>
					<label class="form-label" for="mutate-method">Method</label>
					<select class="form-select" id="mutate-method" data-method-select>
						<option value="">Select a method...</option>
					</select>
				</div>
			
				<div class="form-group">
					<label class="form-label" for="edit-prompt">Prompt <span class="field-required"
							aria-hidden="true">*</span></label>
					<textarea class="form-input form-textarea prompt-editor" id="edit-prompt" data-edit-prompt rows="3"
						placeholder="Describe what you want to change..."></textarea>
				</div>
			</form>
			
			<div class="create-controls">
				<button class="create-button" data-generate-btn disabled>
					Mutate
				</button>
				<p class="create-cost" data-mutate-cost>Loading credits…</p>
			</div>
		`;

		// Wire up image thumbnail (with shimmer) and click-to-view behavior.
		const thumb = editContent.querySelector('[data-source-thumb]');
		const thumbWrap = editContent.querySelector('[data-source-thumb-wrap]');
		if (thumb instanceof HTMLImageElement && thumbWrap instanceof HTMLElement) {
			thumbWrap.classList.add('loading');
			thumbWrap.classList.remove('loaded');
			thumbWrap.classList.remove('error');
			thumb.style.opacity = '0';
			thumb.addEventListener('load', () => {
				thumbWrap.classList.remove('loading');
				thumbWrap.classList.add('loaded');
				thumbWrap.classList.remove('error');
				thumb.style.opacity = '';
			}, { once: true });
			thumb.addEventListener('error', () => {
				thumbWrap.classList.remove('loading');
				thumbWrap.classList.remove('loaded');
				thumbWrap.classList.add('error');
			}, { once: true });

			thumb.src = thumbUrl;
			thumb.loading = 'lazy';
			thumb.decoding = 'async';

			thumbWrap.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (!confirmDiscardChanges()) return;
				window.location.href = creationDetailHref;
			});
		}

		// Ensure preloaded image has a chance to resolve (no-op if it already did).
		await thumbPreload;

		const promptEl = editContent.querySelector('[data-edit-prompt]');
		const generateBtn = editContent.querySelector('[data-generate-btn]');
		const costEl = editContent.querySelector('[data-mutate-cost]');

		// Server/method selection elements
		const serverGroup = editContent.querySelector('[data-server-group]');
		const serverSelect = editContent.querySelector('[data-server-select]');
		const methodGroup = editContent.querySelector('[data-method-group]');
		const methodSelect = editContent.querySelector('[data-method-select]');
		const methodContext = editContent.querySelector('[data-method-context]');
		const methodServerName = editContent.querySelector('[data-method-server-name]');

		const showServerList = availableServers.length > 1;
		const initialMethods = selectionState.serverId ? methodsForServer(selectionState.serverId) : [];
		const showMethodList = initialMethods.length > 1;

		if (serverGroup instanceof HTMLElement) {
			serverGroup.style.display = showServerList ? '' : 'none';
		}
		if (showServerList) renderServerOptions();
		if (serverSelect instanceof HTMLSelectElement && selectionState.serverId) {
			serverSelect.value = String(selectionState.serverId);
		}

		// Choose first method by default (always), even if we hide the dropdown.
		selectionState.methodKey = initialMethods[0]?.methodKey ?? null;
		let creditsCount = null; // number | null (loading)

		if (methodGroup instanceof HTMLElement) {
			methodGroup.style.display = showMethodList ? '' : 'none';
		}
		if (methodContext instanceof HTMLElement) {
			methodContext.style.display = showMethodList ? '' : 'none';
		}
		if (methodServerName instanceof HTMLElement) {
			const serverName = availableServers.find(s => s.id === selectionState.serverId)?.name || '';
			methodServerName.textContent = serverName;
		}
		if (showMethodList) {
			renderMethodOptions();
			if (methodSelect instanceof HTMLSelectElement && selectionState.methodKey) {
				methodSelect.value = selectionState.methodKey;
			}
		}

		// Persist selection for the upcoming integration step.
		editContent.dataset.mutateSourceId = String(creationId);
		editContent.dataset.mutateServerId = selectionState.serverId ? String(selectionState.serverId) : '';
		editContent.dataset.mutateMethodKey = selectionState.methodKey ? String(selectionState.methodKey) : '';
		editContent.dataset.mutateImageUrl = sourceImageUrl;

		function getSelectedMethodCost() {
			if (!selectionState.serverId || !selectionState.methodKey) return null;
			const methods = methodsForServer(selectionState.serverId);
			const selected = methods.find(m => m.methodKey === selectionState.methodKey);
			const method = selected?.method || null;
			if (!method) return null;
			let cost = 0.5;
			if (typeof method.credits === 'number') {
				cost = method.credits;
			} else if (method.credits !== undefined && method.credits !== null) {
				const parsed = parseFloat(method.credits);
				if (!Number.isNaN(parsed)) cost = parsed;
			}
			return cost;
		}

		function updateCostAndButtonState() {
			const hasPrompt = promptEl instanceof HTMLTextAreaElement && promptEl.value.trim().length > 0;
			isMutateDirty = Boolean(hasPrompt);
			const hasSelection = Boolean(selectionState.serverId) && Boolean(selectionState.methodKey);
			const cost = getSelectedMethodCost();

			if (costEl instanceof HTMLElement) {
				costEl.classList.remove('insufficient');

				if (!hasSelection || cost == null) {
					costEl.textContent = 'Select a server and method to see cost';
				} else if (creditsCount == null) {
					costEl.textContent = 'Loading credits…';
				} else if (creditsCount >= cost) {
					costEl.textContent = `Costs ${cost} credits`;
				} else {
					costEl.textContent = `Insufficient credits. You have ${creditsCount} credits, need ${cost} credits.`;
					costEl.classList.add('insufficient');
				}
			}

			const hasEnoughCredits = creditsCount != null && cost != null && creditsCount >= cost;
			if (generateBtn instanceof HTMLButtonElement) {
				generateBtn.disabled = !(hasPrompt && hasSelection && hasEnoughCredits);
			}
		}

		// Auto-grow prompt like comments, min 3 rows.
		if (promptEl instanceof HTMLTextAreaElement) {
			attachAutoGrowTextarea(promptEl);
		}

		// Load credits (match create)
		async function loadCredits() {
			try {
				const result = await fetchJsonWithStatusDeduped('/api/credits', { credentials: 'include' }, { windowMs: 2000 });
				if (result.ok) {
					const n = Number(result.data?.balance ?? 0);
					creditsCount = Number.isFinite(n) ? Math.max(0, Math.round(n * 10) / 10) : 0;
				} else {
					creditsCount = 0;
				}
			} catch {
				const stored = window.localStorage?.getItem('credits-balance');
				const n = Number(stored);
				creditsCount = Number.isFinite(n) ? Math.max(0, Math.round(n * 10) / 10) : 0;
			}
			updateCostAndButtonState();
		}

		function handleCreditsUpdated(event) {
			const n = Number(event?.detail?.count);
			if (Number.isFinite(n)) {
				creditsCount = Math.max(0, Math.round(n * 10) / 10);
				updateCostAndButtonState();
			} else {
				void loadCredits();
			}
		}

		document.addEventListener('credits-updated', handleCreditsUpdated);
		void loadCredits();

		updateCostAndButtonState();
		if (promptEl instanceof HTMLTextAreaElement) {
			promptEl.addEventListener('input', updateCostAndButtonState);
		}

		function handleServerChange(nextServerIdRaw) {
			const nextServerId = Number(nextServerIdRaw);
			if (!Number.isFinite(nextServerId)) return;
			selectionState.serverId = nextServerId;
			selectionState.methodKey = null;

			const methods = methodsForServer(selectionState.serverId);
			const showMethods = methods.length > 1;
			selectionState.methodKey = methods[0]?.methodKey ?? null;

			// Re-render method UI for this server
			if (methodGroup instanceof HTMLElement) {
				methodGroup.style.display = showMethods ? '' : 'none';
			}
			if (methodContext instanceof HTMLElement) {
				methodContext.style.display = showMethods ? '' : 'none';
			}
			if (methodServerName instanceof HTMLElement) {
				const serverName = availableServers.find(s => s.id === selectionState.serverId)?.name || '';
				methodServerName.textContent = serverName;
			}
			if (showMethods) {
				renderMethodOptions();
				if (methodSelect instanceof HTMLSelectElement && selectionState.methodKey) {
					methodSelect.value = selectionState.methodKey;
				}
			}

			editContent.dataset.mutateServerId = selectionState.serverId ? String(selectionState.serverId) : '';
			editContent.dataset.mutateMethodKey = selectionState.methodKey ? String(selectionState.methodKey) : '';
			updateCostAndButtonState();
		}

		if (serverSelect instanceof HTMLSelectElement) {
			serverSelect.addEventListener('change', () => handleServerChange(serverSelect.value));
		}

		if (methodSelect instanceof HTMLSelectElement) {
			methodSelect.addEventListener('change', () => {
				selectionState.methodKey = methodSelect.value || null;
				editContent.dataset.mutateMethodKey = selectionState.methodKey ? String(selectionState.methodKey) : '';
				updateCostAndButtonState();
			});
		}
	} catch {
		editContent.innerHTML = html`
			<div class="route-empty">
				<div class="route-empty-title">Unable to load creation</div>
				<div class="route-empty-message">An error occurred while loading the creation.</div>
			</div>
		`;
	}
}

document.addEventListener('DOMContentLoaded', () => {
	void loadEditPage();
});

document.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-generate-btn]');
	if (!(btn instanceof HTMLButtonElement)) return;
	if (btn.disabled) return;

	e.preventDefault();
	const container = document.querySelector('[data-edit-content]');
	const promptEl = document.querySelector('[data-edit-prompt]');
	const prompt = promptEl instanceof HTMLTextAreaElement ? promptEl.value.trim() : '';

	const serverIdRaw = container?.dataset?.mutateServerId || '';
	const methodKey = container?.dataset?.mutateMethodKey || '';
	const imageUrl = container?.dataset?.mutateImageUrl || '';
	const sourceIdRaw = container?.dataset?.mutateSourceId || '';

	const serverId = Number(serverIdRaw);
	const mutateOfId = Number(sourceIdRaw);

	// Safety checks (button should already be disabled if these are missing).
	if (!prompt) return;
	if (!Number.isFinite(serverId) || serverId <= 0) return;
	if (!methodKey) return;
	const normalizedImageUrl = toParasceneImageUrl(imageUrl);
	if (!normalizedImageUrl) return;
	if (!Number.isFinite(mutateOfId) || mutateOfId <= 0) return;

	const extractMentions = (text) => {
		const out = [];
		const seen = new Set();
		const re = /@([a-zA-Z0-9_]+)/g;
		let match;
		while ((match = re.exec(text || '')) !== null) {
			const full = `@${match[1]}`;
			if (seen.has(full)) continue;
			seen.add(full);
			out.push(full);
		}
		return out;
	};

	const doSubmit = (hydrateMentions) => {
		// Clear dirty state so navigation isn't blocked by our leave-confirm.
		isMutateDirty = false;
		btn.disabled = true;
		submitCreationWithPending({
			serverId,
			methodKey,
			mutateOfId,
			args: {
				image_url: normalizedImageUrl,
				prompt
			},
			hydrateMentions,
			navigate: 'full'
		});
	};

	const mentions = extractMentions(prompt);
	if (mentions.length === 0) {
		doSubmit(false);
		return;
	}

	fetch('/api/create/validate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ args: { prompt } })
	})
		.then(async (res) => {
			const data = await res.json().catch(() => ({}));
			if (res.ok) return { ok: true, data };
			return { ok: false, data };
		})
		.then(({ ok, data }) => {
			if (ok) {
				doSubmit(true);
				return;
			}
			const message = formatMentionsFailureForDialog(data);
			const proceed = window.confirm(message);
			if (proceed) doSubmit(false);
		})
		.catch(() => {
			const message = formatMentionsFailureForDialog({});
			const proceed = window.confirm(message);
			if (proceed) doSubmit(false);
		});
});

