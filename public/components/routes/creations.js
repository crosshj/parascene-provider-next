import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { eyeHiddenIcon } from '../../icons/svg-strings.js';

const html = String.raw;

function parseMeta(raw) {
	if (raw == null) return null;
	if (typeof raw === 'object') return raw;
	if (typeof raw !== 'string') return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function isTimedOut(status, meta) {
	if (status !== 'creating') return false;
	const timeoutAt = meta && typeof meta.timeout_at === 'string' ? new Date(meta.timeout_at).getTime() : NaN;
	if (!Number.isFinite(timeoutAt)) return false;
	return Date.now() > timeoutAt;
}

const CREATIONS_PAGE_SIZE = 50;

function scheduleImageWork(start, { immediate = true, wakeOnVisible = true } = {}) {
	if (typeof start !== 'function') return Promise.resolve();

	const isVisible = document.visibilityState === 'visible';
	if (immediate && isVisible) {
		start();
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		let idleHandle = null;
		let timeoutHandle = null;

		function onVisibilityChange() {
			if (document.visibilityState === 'visible') runNow();
		}

		function runNow() {
			if (idleHandle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
			if (wakeOnVisible) document.removeEventListener('visibilitychange', onVisibilityChange);
			start();
			resolve();
		}

		if (wakeOnVisible) {
			document.addEventListener('visibilitychange', onVisibilityChange);
		}

		// Low priority: wait for idle time (and/or small delay).
		if (typeof requestIdleCallback === 'function') {
			idleHandle = requestIdleCallback(() => runNow(), { timeout: 2000 });
		} else {
			timeoutHandle = setTimeout(() => runNow(), 500);
		}
	});
}

function setRouteMediaBackgroundImage(mediaEl, url, { lowPriority = false } = {}) {
	if (!mediaEl || !url) return;

	// Skip if we already have this URL loaded (avoids duplicate requests)
	if (mediaEl.dataset.bgLoadedUrl === url) {
		return Promise.resolve(true);
	}

	mediaEl.classList.remove('route-media-error');
	mediaEl.style.backgroundImage = '';

	return new Promise((resolve) => {
		const startProbe = () => {
			const probe = new Image();
			probe.decoding = 'async';
			if ('fetchPriority' in probe) {
				probe.fetchPriority = lowPriority ? 'low' : (document.visibilityState === 'visible' ? 'auto' : 'low');
			}
			probe.onload = () => {
				mediaEl.dataset.bgLoadedUrl = url;
				mediaEl.classList.remove('route-media-error');
				mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
				resolve(true);
			};
			probe.onerror = () => {
				mediaEl.classList.add('route-media-error');
				mediaEl.style.backgroundImage = '';
				resolve(false);
			};
			probe.src = url;
		};

		void scheduleImageWork(startProbe, { immediate: !lowPriority, wakeOnVisible: !lowPriority });
	});
}

class AppRouteCreations extends HTMLElement {
	isRouteActive() {
		try {
			return window.__CURRENT_ROUTE__ === 'creations' || this.isActiveRoute === true;
		} catch {
			return this.isActiveRoute === true;
		}
	}

	resumeImageLazyLoading() {
		// Recreate observer and re-observe any tiles that still need images.
		this.setupImageLazyLoading();
		const pendingTiles = this.querySelectorAll('.route-media[data-bg-url]');
		pendingTiles.forEach((mediaEl) => {
			if (!mediaEl) return;
			if (mediaEl.classList.contains('route-media-error')) return;
			// If it already has a background image, don't reload.
			if (mediaEl.style && typeof mediaEl.style.backgroundImage === 'string' && mediaEl.style.backgroundImage) return;
			if (!mediaEl.dataset.bgUrl) return;
			mediaEl.dataset.bgQueued = '0';
			if (this.imageObserver) this.imageObserver.observe(mediaEl);
		});
		this.drainImageLoadQueue();
	}

	connectedCallback() {
		this.innerHTML = html`
      <div class="creations-route">
        <div class="route-header">
          <h3>Creations</h3>
          <p>Your generated creations. Share them when you're ready.</p>
        </div>
        <div class="route-cards content-cards-image-grid" data-creations-container>
          <div class="route-empty route-empty-image-grid route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
        </div>
        <div class="creations-load-more-sentinel" data-creations-sentinel aria-hidden="true"></div>
        <div class="creations-load-more-fallback" data-creations-load-more-fallback>
          <button type="button" class="btn-secondary creations-load-more-btn" data-creations-load-more-btn>Load more</button>
        </div>
      </div>
    `;
		this.pollInterval = null;
		this.hasLoadedOnce = false;
		this.isLoading = false;
		this.isLoadingMore = false;
		this.isActiveRoute = false;
		this.creationsWasVisible = false;
		this.lastLoadFromCheckAt = 0;
		this.creationsOffset = 0;
		this.hasMoreCreations = true;
		this.setupRouteListener();
		this.setupLoadMoreFallback();
		this.updateLoadMoreFallback();
		this.pendingUpdateHandler = () => {
			if (this.isActiveRoute) {
				this.loadCreations({ force: true });
			}
		};
		document.addEventListener('creations-pending-updated', this.pendingUpdateHandler);
		this.setupImageLazyLoading();

		const initialRoute = window.__CURRENT_ROUTE__ || null;
		const pathname = window.location.pathname || '';
		const inferred = initialRoute || (pathname.startsWith('/creations') ? 'creations' : null);
		this.isActiveRoute = inferred === 'creations';
		if (this.isRouteActive()) {
			this.refreshOnActivate();
			this.startPolling();
		}
	}

	setupRouteListener() {
		// Listen for route change events to reload when creations route becomes active
		this.routeChangeHandler = (e) => {
			const route = e.detail?.route;
			if (typeof route !== 'string') {
				// Ignore unrelated/malformed route-change events.
				return;
			}
			if (route === 'creations') {
				this.isActiveRoute = true;
				this.refreshOnActivate();
				// If we didn't rebuild, make sure lazy loading resumes.
				if (this.hasLoadedOnce) {
					this.resumeImageLazyLoading();
				}
				// Restart polling in case it was stopped
				if (!this.pollInterval) {
					this.startPolling();
				}
				requestAnimationFrame(() => {
					if (this.hasMoreCreations) this.observeLoadMoreSentinel();
				});
			} else {
				this.isActiveRoute = false;
				this.stopPolling();
				if (this.imageObserver) this.imageObserver.disconnect();
				this.imageLoadQueue = [];
				this.imageLoadsInFlight = 0;
				this.sentinelObserver?.disconnect();
				this.sentinelObserver = null;
			}
		};
		document.addEventListener('route-change', this.routeChangeHandler);

		// Only react when we transition to visible (avoids repeated refreshOnActivate / load loops)
		this.intersectionObserver = new IntersectionObserver((entries) => {
			entries.forEach(entry => {
				const nowVisible = entry.isIntersecting && entry.target === this;
				if (nowVisible && !this.creationsWasVisible) {
					this.creationsWasVisible = true;
					this.isActiveRoute = true;
					this.refreshOnActivate();
					if (this.hasLoadedOnce) {
						this.resumeImageLazyLoading();
					}
					if (!this.pollInterval) {
						this.startPolling();
					}
				} else if (!nowVisible) {
					this.creationsWasVisible = false;
				}
			});
		}, {
			threshold: 0.1
		});

		this.intersectionObserver.observe(this);
	}

	observeLoadMoreSentinel() {
		this.sentinelObserver?.disconnect();
		this.sentinelObserver = null;
		if (!this.hasMoreCreations) return;
		const sentinel = this.querySelector('[data-creations-sentinel]');
		if (!sentinel) return;
		this.sentinelObserver = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (!entry?.isIntersecting) return;
				if (!this.hasMoreCreations || this.isLoadingMore || this.isLoading || !this.isRouteActive()) return;
				this.loadMoreCreations();
			},
			{ root: null, rootMargin: '800px 0px', threshold: 0 }
		);
		this.sentinelObserver.observe(sentinel);
	}

	updateLoadMoreFallback() {
		const wrap = this.querySelector('[data-creations-load-more-fallback]');
		const btn = this.querySelector('[data-creations-load-more-btn]');
		if (!wrap || !btn) return;
		if (!this.hasMoreCreations) {
			wrap.setAttribute('hidden', '');
			wrap.style.display = 'none';
			return;
		}
		wrap.removeAttribute('hidden');
		wrap.style.display = '';
		btn.disabled = false;
		btn.textContent = 'Load more';
	}

	setupLoadMoreFallback() {
		const btn = this.querySelector('[data-creations-load-more-btn]');
		if (!btn) return;
		btn.addEventListener('click', () => {
			if (!this.hasMoreCreations || this.isLoadingMore || this.isLoading) return;
			this.loadMoreCreations();
		});
	}

	setupImageLazyLoading() {
		const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
		const prefersSaveData = Boolean(connection && connection.saveData);
		const isVerySlowConnection = Boolean(connection && typeof connection.effectiveType === 'string' && connection.effectiveType.includes('2g'));

		this.eagerImageCount = prefersSaveData || isVerySlowConnection ? 2 : 6;
		this.maxConcurrentImageLoads = prefersSaveData || isVerySlowConnection ? 2 : 4;
		this.imageRootMargin = prefersSaveData || isVerySlowConnection ? '200px 0px' : '600px 0px';

		this.imageLoadQueue = [];
		this.imageLoadsInFlight = 0;

		if (this.imageObserver) this.imageObserver.disconnect();
		this.imageObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) return;

				const el = entry.target;
				if (!el || el.dataset.bgQueued === '1') return;

				const url = el.dataset.bgUrl;
				if (!url) {
					this.imageObserver.unobserve(el);
					return;
				}
				if (el.dataset.bgLoadedUrl === url) {
					this.imageObserver.unobserve(el);
					return;
				}

				el.dataset.bgQueued = '1';
				this.imageObserver.unobserve(el);
				this.imageLoadQueue.push({ el, url });
				this.drainImageLoadQueue();
			});
		}, {
			root: null,
			rootMargin: this.imageRootMargin,
			threshold: 0.01,
		});
	}

	drainImageLoadQueue() {
		if (!Array.isArray(this.imageLoadQueue)) return;
		if (typeof this.maxConcurrentImageLoads !== 'number' || this.maxConcurrentImageLoads <= 0) return;

		while (this.imageLoadsInFlight < this.maxConcurrentImageLoads && this.imageLoadQueue.length > 0) {
			const next = this.imageLoadQueue.shift();
			if (!next || !next.el || !next.url) continue;

			this.imageLoadsInFlight += 1;
			Promise.resolve(setRouteMediaBackgroundImage(next.el, next.url, { lowPriority: !this.isRouteActive() }))
				.finally(() => {
					this.imageLoadsInFlight -= 1;
					this.drainImageLoadQueue();
				});
		}
	}

	disconnectedCallback() {
		this.stopPolling();
		if (this.routeChangeHandler) {
			document.removeEventListener('route-change', this.routeChangeHandler);
		}
		if (this.pendingUpdateHandler) {
			document.removeEventListener('creations-pending-updated', this.pendingUpdateHandler);
		}
		if (this.intersectionObserver) {
			this.intersectionObserver.disconnect();
		}
		this.sentinelObserver?.disconnect();
		this.sentinelObserver = null;
		if (this.imageObserver) {
			this.imageObserver.disconnect();
			this.imageObserver = null;
		}
		this.imageLoadQueue = [];
		this.imageLoadsInFlight = 0;
	}

	getPendingCreations() {
		const pending = JSON.parse(sessionStorage.getItem("pendingCreations") || "[]");
		return Array.isArray(pending) ? pending : [];
	}

	startPolling() {
		// Poll every 2 seconds for creations that are still being created
		this.pollInterval = setInterval(() => {
			this.checkForUpdates();
		}, 2000);
	}

	stopPolling() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}

	async checkForUpdates() {
		const container = this.querySelector("[data-creations-container]");
		if (!container) return;

		// Check if there are any loading creations (DB rows) or pending placeholders (sessionStorage)
		const loadingCreations = container.querySelectorAll('.route-media[data-image-id][data-status="creating"]');
		const pendingCreations = container.querySelectorAll('.route-media[data-image-id][data-status="pending"]');
		const hasPending = pendingCreations.length > 0 || this.getPendingCreations().length > 0;

		if (loadingCreations.length === 0 && !hasPending) {
			// Nothing to wait for, stop polling
			this.stopPolling();
			return;
		}

		try {
			const result = await fetchJsonWithStatusDeduped("/api/create/images", {
				credentials: 'include'
			}, { windowMs: 300 });
			if (!result.ok) return;

			const creations = Array.isArray(result.data?.images) ? result.data.images : [];

			// Update any creations that have changed out of "creating"
			let hasUpdates = false;
			loadingCreations.forEach(loadingElement => {
				const creationId = loadingElement.getAttribute('data-image-id');
				const updatedCreation = creations.find(c => c.id.toString() === creationId);
				if (updatedCreation && updatedCreation.status && updatedCreation.status !== 'creating') {
					hasUpdates = true;
				}
			});

			// If we have pending placeholders, keep refreshing so they can reconcile into DB rows
			// (or expire via TTL) even before we have a visible "creating" row.
			// Throttle: when only hasPending (no hasUpdates), don't reload more than once per 5s to avoid storms.
			const now = Date.now();
			const throttleMs = 5000;
			const wouldReload = hasUpdates || hasPending;
			const throttleOk = hasUpdates || (now - this.lastLoadFromCheckAt >= throttleMs);
			if (wouldReload && throttleOk) {
				this.lastLoadFromCheckAt = now;
				this.loadCreations({ force: true });
			}
		} catch (error) {
			// console.error("Error checking for updates:", error);
		}
	}

	refreshOnActivate() {
		const hasPending = this.getPendingCreations().length > 0;
		const hasLoading = this.querySelectorAll('.route-media[data-image-id][data-status="creating"]').length > 0;

		if (!this.hasLoadedOnce || hasPending || hasLoading) {
			this.loadCreations({ force: true });
			return;
		}

		// Already loaded and nothing pending: ensure lazy loads keep flowing.
		this.resumeImageLazyLoading();
	}

	async loadCreations({ force = false, reset = false } = {}) {
		const container = this.querySelector("[data-creations-container]");
		if (!container) return;
		if (this.isLoading) return;
		if (!this.isRouteActive()) return;
		if (force && this.hasLoadedOnce) reset = true;
		if (!force && !reset && this.hasLoadedOnce) return;

		this.isLoading = true;
		if (reset || !this.hasLoadedOnce) {
			this.creationsOffset = 0;
			this.hasMoreCreations = true;
		}
		try {
			const offset = reset || !this.hasLoadedOnce ? 0 : this.creationsOffset;
			const creationsResult = await fetchJsonWithStatusDeduped(
				`/api/create/images?limit=${CREATIONS_PAGE_SIZE}&offset=${offset}`,
				{ credentials: 'include' },
				{ windowMs: 500 }
			).catch(() => ({ ok: false, status: 0, data: null }));

			let cont = this.querySelector("[data-creations-container]");
			if (!cont) return;

			const creationsRaw = creationsResult.ok
				? (Array.isArray(creationsResult.data?.images) ? creationsResult.data.images : [])
				: [];
			const apiHasMore = creationsResult.ok && creationsResult.data?.has_more === true;
			if (reset || !this.hasLoadedOnce) {
				this.hasMoreCreations = apiHasMore && creationsRaw.length >= CREATIONS_PAGE_SIZE;
			}

			const creations = creationsRaw;

			cont.innerHTML = "";
			// New content means new media elements; clear previous observers/queue.
			if (this.imageObserver) this.imageObserver.disconnect();
			this.imageLoadQueue = [];
			this.imageLoadsInFlight = 0;
			this.setupImageLazyLoading();

			const pendingCreations = this.getPendingCreations();
			const nowMs = Date.now();
			const PENDING_TTL_MS = 3000;

			// Short TTL for optimistic placeholders: once we have a successful poll response,
			// we assume the backend should already be reporting them.
			const pendingWithinTtl = creationsResult.ok
				? pendingCreations.filter((p) => {
					const createdAtRaw = typeof p?.created_at === 'string' ? p.created_at : '';
					const createdAtMs = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
					if (!Number.isFinite(createdAtMs)) return true;
					return nowMs - createdAtMs <= PENDING_TTL_MS;
				})
				: pendingCreations;

			// Dedupe pending vs DB rows by creation_token when available.
			const creationsByToken = new Map();
			creations.forEach((item) => {
				const meta = parseMeta(item.meta);
				const token = meta && typeof meta.creation_token === 'string' ? meta.creation_token : null;
				if (token) {
					creationsByToken.set(token, item);
				}
			});

			const filteredPending = pendingWithinTtl.filter((p) => {
				const token = typeof p.creation_token === 'string' ? p.creation_token : null;
				if (!token) return true;
				return !creationsByToken.has(token);
			});

			// If we see a DB row with the same creation_token, purge the local pending item so it can't stick forever.
			// This covers cases where the original submit request was interrupted (navigation/unload) and the cleanup
			// in the submitter never ran.
			const shouldPurge = pendingCreations.some((p) => {
				const token = typeof p?.creation_token === 'string' ? p.creation_token : null;
				return Boolean(token) && creationsByToken.has(token);
			});
			const ttlPurged = filteredPending.length !== pendingCreations.length;
			if (shouldPurge || ttlPurged) {
				const newPendingStr = JSON.stringify(filteredPending);
				const oldPendingStr = sessionStorage.getItem("pendingCreations") || "[]";
				try {
					sessionStorage.setItem("pendingCreations", newPendingStr);
				} catch {
					// ignore storage write errors
				}
				// Only dispatch when the stored value actually changed to avoid reload loops
				if (newPendingStr !== oldPendingStr) {
					document.dispatchEvent(new CustomEvent("creations-pending-updated"));
				}
			}

			const combinedCreations = [...filteredPending, ...creations];

			if (combinedCreations.length === 0) {
				cont.innerHTML = html`
          <div class="route-empty route-empty-image-grid">
            <div class="route-empty-title">No creations yet</div>
            <div class="route-empty-message">Start creating to see your work here.</div>
            <a href="/create" class="route-empty-button">Get Started</a>
          </div>
        `;

				this.hasLoadedOnce = true;
				this.creationsOffset = 0;
				this.hasMoreCreations = false;
				this.updateLoadMoreFallback();
				return;
			}

			// Sort creations by created_at (newest first)
			const sortedCreations = combinedCreations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

			this.appendCreationCards(cont, sortedCreations, 0);
			this.hasLoadedOnce = true;
			this.creationsOffset = creationsRaw.length;
			this.updateLoadMoreFallback();
			if (this.hasMoreCreations) this.observeLoadMoreSentinel();
		} catch (error) {
			// console.error("Error loading creations:", error);
			const errCont = this.querySelector("[data-creations-container]");
			if (errCont) errCont.innerHTML = html`
        <div class="route-empty route-empty-image-grid">Unable to load creations.</div>
      `;
		} finally {
			this.isLoading = false;
			this.updateLoadMoreFallback();
		}
	}

	appendCreationCards(cont, items, startEagerIndex) {
		items.forEach((item, i) => {
			const index = startEagerIndex + i;
			const card = document.createElement("div");
			card.className = "route-card route-card-image";

			const meta = parseMeta(item.meta);
			const rawStatus = item.status || 'completed';
			const timedOut = isTimedOut(rawStatus, meta);
			const status = timedOut && rawStatus === 'creating' ? 'failed' : rawStatus;

			const isPending = status === 'pending';
			const isCreating = status === 'creating';
			const isFailed = status === 'failed';

			if (isPending) {
				card.innerHTML = html`
            <div class="route-media loading" data-image-id="${item.id}" data-status="pending" aria-hidden="true"></div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Creating...</div>
                <div class="route-summary">Your creation is being processed...</div>
                <div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
              </div>
            </div>
          `;
				if (this.isActiveRoute && !this.pollInterval) this.startPolling();
			} else if (isCreating) {
				card.innerHTML = html`
            <div class="route-media loading" data-image-id="${item.id}" data-status="creating" aria-hidden="true"></div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Creating...</div>
                <div class="route-summary">Your creation is being processed...</div>
                <div class="route-meta" title="${formatDateTime(item.created_at)}">${formatRelativeTime(item.created_at)}</div>
              </div>
            </div>
          `;
				if (this.isActiveRoute && !this.pollInterval) this.startPolling();
			} else if (isFailed) {
				const reason =
					(meta && typeof meta.error === 'string' && meta.error) ||
					(meta && meta.error_code === 'timeout' ? 'This creation timed out.' : 'This creation failed.');
				const isModerated = item.is_moderated_error === true;
				card.style.cursor = 'pointer';
				card.addEventListener('click', () => { window.location.href = `/creations/${item.id}`; });
				card.innerHTML = html`
            <div class="route-media route-media-error${isModerated ? ' route-media-error-moderated' : ''}" data-image-id="${item.id}" data-status="failed" aria-hidden="true">${isModerated ? html`<span class="route-media-error-moderated-icon" role="img" aria-label="Content moderated">${eyeHiddenIcon()}</span>` : ''}</div>
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">Creation unavailable</div>
                <div class="route-summary">${reason}</div>
                <div class="route-meta" title="${formatDateTime(item.created_at)}">Created ${formatRelativeTime(item.created_at)}</div>
              </div>
            </div>
          `;
			} else {
				card.style.cursor = 'pointer';
				card.addEventListener('click', () => { window.location.href = `/creations/${item.id}`; });
				const isPublished = item.published === true || item.published === 1;
				let publishedBadge = '';
				let publishedInfo = '';
				if (isPublished) {
					publishedBadge = html`
              <div class="creation-published-badge" title="Published">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </div>
            `;
				}
				if (isPublished && item.published_at) {
					publishedInfo = html`<div class="route-meta" title="${formatDateTime(item.published_at)}">Published ${formatRelativeTime(item.published_at)}</div>`;
				}
				card.innerHTML = html`
            <div class="route-media" aria-hidden="true" data-image-id="${item.id}" data-status="completed"></div>
            ${publishedBadge}
            <div class="route-details">
              <div class="route-details-content">
                <div class="route-title">${item.title || 'Untitled'}</div>
                ${publishedInfo}
                <div class="route-meta" title="${formatDateTime(item.created_at)}">Created ${formatRelativeTime(item.created_at)}</div>
              </div>
            </div>
          `;
				const mediaEl = card.querySelector('.route-media');
				const url = item.thumbnail_url || item.url;
				if (mediaEl) {
					if (index < this.eagerImageCount) {
						setRouteMediaBackgroundImage(mediaEl, url, { lowPriority: !this.isRouteActive() });
					} else if (this.imageObserver) {
						mediaEl.dataset.bgUrl = url;
						mediaEl.dataset.bgQueued = '0';
						this.imageObserver.observe(mediaEl);
					}
				}
			}
			cont.appendChild(card);
		});
	}

	async loadMoreCreations() {
		if (!this.hasMoreCreations || this.isLoadingMore || this.isLoading || !this.isRouteActive()) return;
		this.isLoadingMore = true;
		this.updateLoadMoreFallback();
		try {
			const res = await fetchJsonWithStatusDeduped(
				`/api/create/images?limit=${CREATIONS_PAGE_SIZE}&offset=${this.creationsOffset}`,
				{ credentials: 'include' },
				{ windowMs: 500 }
			).catch(() => ({ ok: false, data: null }));
			const container = this.querySelector("[data-creations-container]");
			if (!container || !res.ok) {
				this.isLoadingMore = false;
				this.updateLoadMoreFallback();
				return;
			}
			const items = Array.isArray(res.data?.images) ? res.data.images : [];
			const apiHasMore = res.data?.has_more === true;
			this.hasMoreCreations = apiHasMore && items.length >= CREATIONS_PAGE_SIZE;
			const startEagerIndex = container.querySelectorAll('.route-card').length;
			this.appendCreationCards(container, items, startEagerIndex);
			this.creationsOffset += items.length;
			if (this.hasMoreCreations) this.observeLoadMoreSentinel();
		} finally {
			this.isLoadingMore = false;
			this.updateLoadMoreFallback();
		}
	}

	async retryCreation(item) {
		const meta = item.meta || parseMeta(item.meta);
		const serverId = meta && typeof meta.server_id !== 'undefined' ? meta.server_id : null;
		const method = meta && typeof meta.method === 'string' ? meta.method : null;
		const args = meta && typeof meta.args === 'object' && meta.args ? meta.args : {};

		if (!serverId || !method) {
			// console.warn('retryCreation: missing server_id or method in meta', meta);
			alert('Cannot retry this creation because its details are missing.');
			return;
		}

		const creationToken = `crt_retry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

		try {
			const res = await fetch('/api/create', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify({
					server_id: serverId,
					method,
					args: args || {},
					creation_token: creationToken
				})
			});

			if (!res.ok) {
				let message = 'Failed to retry creation.';
				try {
					const data = await res.json();
					if (data && typeof data.error === 'string') {
						message = data.error;
					} else if (typeof data.message === 'string') {
						message = data.message;
					}
				} catch {
					// ignore parse errors
				}
				alert(message);
				return;
			}

			// Reload list to pick up new creating row + updated credits.
			await this.loadCreations({ force: true });
		} catch (error) {
			// console.error('Error retrying creation:', error);
			alert('Failed to retry creation. Please try again.');
		}
	}

	async deleteCreation(item) {
		if (!item || typeof item.id === 'undefined' || item.id === null) {
			alert('Cannot delete this creation.');
			return;
		}

		if (!confirm('Are you sure you want to delete this creation? This action cannot be undone.')) {
			return;
		}

		try {
			const res = await fetch(`/api/create/images/${item.id}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!res.ok) {
				let message = 'Failed to delete creation.';
				try {
					const data = await res.json();
					if (data && typeof data.error === 'string') {
						message = data.error;
					}
				} catch {
					// ignore
				}
				alert(message);
				return;
			}

			await this.loadCreations({ force: true });
		} catch (error) {
			// console.error('Error deleting creation from list view:', error);
			alert('Failed to delete creation. Please try again.');
		}
	}
}

customElements.define("app-route-creations", AppRouteCreations);
