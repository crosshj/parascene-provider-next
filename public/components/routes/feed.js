import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { enableLikeButtons, initLikeButton } from '../../shared/likes.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { buildProfilePath } from '../../shared/profileLinks.js';

const html = String.raw;

// localStorage helpers for hidden feed items
function getHiddenFeedItems() {
	try {
		const stored = localStorage.getItem('hiddenFeedItems');
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function addHiddenFeedItem(itemId) {
	try {
		const hidden = getHiddenFeedItems();
		if (!hidden.includes(itemId)) {
			hidden.push(itemId);
			localStorage.setItem('hiddenFeedItems', JSON.stringify(hidden));
		}
	} catch {
		// Ignore localStorage errors
	}
}

function isFeedItemHidden(itemId) {
	const hidden = getHiddenFeedItems();
	return hidden.includes(itemId);
}

function scheduleImageWork(start) {
	if (typeof start !== 'function') return Promise.resolve();
	if (document.visibilityState === 'visible') {
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
			document.removeEventListener('visibilitychange', onVisibilityChange);
			start();
			resolve();
		}

		document.addEventListener('visibilitychange', onVisibilityChange);

		// Still preload in background, but at low priority (idle time).
		if (typeof requestIdleCallback === 'function') {
			idleHandle = requestIdleCallback(() => runNow(), { timeout: 2000 });
		} else {
			timeoutHandle = setTimeout(() => runNow(), 500);
		}
	});
}

function setRouteMediaBackgroundImage(mediaEl, url) {
	if (!mediaEl || !url) return;

	// Always preload, but let visible work take priority.
	// If hidden, start the request during idle time and use low fetch priority.
	mediaEl.classList.remove('route-media-has-image');
	mediaEl.classList.remove('route-media-error');
	mediaEl.style.backgroundImage = '';

	const startProbe = () => {
		const probe = new Image();
		probe.decoding = 'async';
		if ('fetchPriority' in probe) {
			probe.fetchPriority = document.visibilityState === 'visible' ? 'auto' : 'low';
		}
		probe.onload = () => {
			mediaEl.classList.remove('route-media-error');
			mediaEl.classList.add('route-media-has-image');
			mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
		};
		probe.onerror = () => {
			mediaEl.classList.remove('route-media-has-image');
			mediaEl.classList.add('route-media-error');
			mediaEl.style.backgroundImage = '';
		};
		probe.src = url;
	};

	void scheduleImageWork(startProbe);
}

class AppRouteFeed extends HTMLElement {
	connectedCallback() {
		this.innerHTML = html`
      <style>
        .feed-route .route-media:not(.route-media-has-image) {
          background:
            linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(5, 199, 111, 0.2)),
            repeating-linear-gradient(
              45deg,
              rgba(255, 255, 255, 0.06) 0,
              rgba(255, 255, 255, 0.06) 6px,
              rgba(255, 255, 255, 0.02) 6px,
              rgba(255, 255, 255, 0.02) 12px
            );
        }
        .feed-route .route-media.route-media-has-image {
          background-size: cover !important;
          background-position: center !important;
        }
      </style>
      <div class="feed-route">
	  	<!-- 
	  	<div class="route-header">
			<h3>Home</h3>
			<p>See creations shared by friends and people you already follow, with the newest highlights at the top.</p>
        </div>
		-->
        <div class="route-cards feed-cards" data-feed-container>
        <div class="route-empty route-empty-image-grid route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
        </div>
      </div>
    `;
		this.feedItems = [];
		this.feedIndex = 0;
		this.feedBatchSize = 6;
		this.sentinelWasIntersecting = false;
		this.isLoading = false;
		enableLikeButtons(this);
		this.setupInfiniteScroll();
		this.routeChangeHandler = (e) => {
			const route = e?.detail?.route;
			if (route === 'feed') this.loadFeed();
		};
		document.addEventListener('route-change', this.routeChangeHandler);
		// Only load feed when feed is the active route (avoids loading on explore/creations and reduces API storm)
		const initialRoute = window.__CURRENT_ROUTE__ || (window.location.pathname === '/' || window.location.pathname === '' ? 'feed' : window.location.pathname.slice(1).split('/')[0]);
		if (initialRoute === 'feed') {
			this.loadFeed();
		}
	}

	disconnectedCallback() {
		if (this.routeChangeHandler) {
			document.removeEventListener('route-change', this.routeChangeHandler);
		}
		if (this.feedObserver) {
			this.feedObserver.disconnect();
			this.feedObserver = null;
		}
	}

	setupInfiniteScroll() {
		const container = this.querySelector("[data-feed-container]");
		if (!container) return;

		if (!this.feedSentinel) {
			this.feedSentinel = document.createElement('div');
			this.feedSentinel.className = 'feed-sentinel';
			container.after(this.feedSentinel);
		}

		if (this.feedObserver) {
			this.feedObserver.disconnect();
		}

		this.feedObserver = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				const nowIntersecting = entry.isIntersecting;
				if (nowIntersecting && !this.sentinelWasIntersecting) {
					this.renderNextBatch();
				}
				this.sentinelWasIntersecting = nowIntersecting;
			});
		}, {
			root: null,
			rootMargin: '200px 0px',
			threshold: 0.01
		});

		this.feedObserver.observe(this.feedSentinel);
	}

	renderNextBatch() {
		const container = this.querySelector("[data-feed-container]");
		if (!container) return;
		if (!Array.isArray(this.feedItems) || this.feedItems.length === 0) return;

		const start = this.feedIndex;
		// Use smaller batch size (3) for initial load, then 6 for subsequent loads
		const batchSize = start === 0 ? 3 : this.feedBatchSize;
		const end = Math.min(start + batchSize, this.feedItems.length);
		if (start >= end) return;

		for (let i = start; i < end; i += 1) {
			const card = this.buildFeedCard(this.feedItems[i], i);
			container.appendChild(card);
		}

		this.feedIndex = end;
	}

	buildFeedCard(item, itemIndex) {
		if (item.type === "tip") {
			return this.buildTipCard(item);
		}

		const card = document.createElement("div");
		card.className = "feed-card";

		const author = item.author || "Anonymous";
		const authorUserName = typeof item.author_user_name === "string" ? item.author_user_name.trim() : "";
		const authorDisplayName = typeof item.author_display_name === "string" ? item.author_display_name.trim() : "";
		const emailPrefix = typeof item.author === "string" && item.author.includes("@")
			? item.author.split("@")[0]
			: author;
		const handle = (authorUserName || emailPrefix || author)
			.toLowerCase()
			.slice(0, 48) || "user";
		const displayName = authorDisplayName || authorUserName || emailPrefix || author;
		const avatarUrl = typeof item.author_avatar_url === "string" ? item.author_avatar_url.trim() : "";
		const avatarInitial = displayName.trim().charAt(0).toUpperCase() || "?";
		const colorSeed = authorUserName || emailPrefix || String(authorUserId || '') || displayName;
		const avatarColor = getAvatarColor(colorSeed);
		const relativeTime = formatRelativeTime(item.created_at) || "recently";
		const title = item.title || "";
		const likeCount = item.like_count ?? 0;
		const likesText = likeCount === 1 ? "like" : "likes";
		const authorUserId = item.user_id != null ? Number(item.user_id) : null;
		const profileHref = buildProfilePath({ userName: authorUserName, userId: authorUserId });
		const isFounder = item.author_plan === "founder";
		const avatarContent = avatarUrl ? html`<img src="${avatarUrl}" alt="">` : avatarInitial;
		const avatarBlock = isFounder
			? html`
          <div class="avatar-with-founder-flair avatar-with-founder-flair--md">
            <div class="founder-flair-avatar-ring">
              <div class="founder-flair-avatar-inner" style="background: ${avatarUrl ? 'var(--surface-strong)' : avatarColor};" aria-hidden="true">
                ${avatarContent}
              </div>
            </div>
          </div>
        `
			: html`
          <div class="feed-card-avatar" style="--feed-card-avatar-bg: ${avatarColor};" aria-hidden="true">
            ${avatarUrl ? html`<img class="feed-card-avatar-img" src="${avatarUrl}" alt="">` : avatarInitial}
          </div>
        `;

		card.innerHTML = html`
      <div class="feed-card-image">
        <img class="feed-card-img" alt="${item.title || 'Feed image'}" loading="lazy" decoding="async">
      </div>
      <div class="feed-card-footer-grid">
        ${profileHref ? html`
          <a class="user-link user-avatar-link" href="${profileHref}" data-profile-link aria-label="View ${author} profile">
            ${avatarBlock}
          </a>
        ` : html`
          <div>
            ${avatarBlock}
          </div>
        `}
        <div class="feed-card-content">
          <div class="feed-card-title">${title}</div>
          <div class="feed-card-metadata" title="${formatDateTime(item.created_at)}">
            ${profileHref
				? html`<a class="user-link" href="${profileHref}" data-profile-link>${isFounder ? html`<span class="founder-name">${displayName}</span> <span class="founder-name">@${handle}</span>` : html`${displayName} @${handle}`}</a>`
				: html`${isFounder ? html`<span class="founder-name">${displayName}</span> <span class="founder-name">@${handle}</span>` : html`${displayName} @${handle}`}`} • ${relativeTime}
          </div>
        </div>
      </div>
      <div class="feed-card-actions">
        <div class="feed-card-actions-left">
          ${item.created_image_id ? html`
            <button class="feed-card-action" type="button" data-details-button aria-label="Details">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 8v8"></path>
                <path d="M12 6h.01"></path>
              </svg>
              <span>Details</span>
            </button>
          ` : ``}
          ${profileHref ? html`
            <button class="feed-card-action" type="button" data-creator-button aria-label="Creator">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>Creator</span>
            </button>
          ` : ``}
        </div>
        <div class="feed-card-actions-right">
          <button class="feed-card-action" type="button" aria-label="Comment" data-comment-button>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 5V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
            </svg>
            <span class="feed-card-action-count">${item.comment_count ?? 0}</span>
          </button>
          <button class="feed-card-action" type="button" aria-label="Like" data-like-button>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1z"></path>
            </svg>
            <span class="feed-card-action-count" data-like-count>${item.like_count ?? 0}</span>
          </button>
          <button class="feed-card-action feed-card-action-more" type="button" aria-label="More" data-more-button data-item-id="${item.created_image_id || item.id}">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.6"></circle>
              <circle cx="12" cy="12" r="1.6"></circle>
              <circle cx="12" cy="19" r="1.6"></circle>
            </svg>
          </button>
          <div class="feed-card-menu" data-feed-menu style="display: none;">
            <button class="feed-card-menu-item" type="button" data-hide-item>Hide from my feed</button>
          </div>
        </div>
      </div>
    `;

		const likeButton = card.querySelector('button[data-like-button]');
		if (likeButton) {
			initLikeButton(likeButton, item);
		}

		const commentButton = card.querySelector('button[data-comment-button]');
		if (commentButton && item.created_image_id) {
			commentButton.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				window.location.href = `/creations/${item.created_image_id}#comments`;
			});
		}

		const detailsButton = card.querySelector('button[data-details-button]');
		if (detailsButton && item.created_image_id) {
			detailsButton.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				window.location.href = `/creations/${item.created_image_id}`;
			});
		}

		const creatorButton = card.querySelector('button[data-creator-button]');
		if (creatorButton && profileHref) {
			creatorButton.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				window.location.href = profileHref;
			});
		}

		// Setup more menu button
		const moreButton = card.querySelector('button[data-more-button]');
		const menu = card.querySelector('[data-feed-menu]');
		const hideButton = card.querySelector('button[data-hide-item]');
		const itemId = item.created_image_id || item.id;

		if (moreButton && menu && hideButton && itemId) {
			// Close any open menus when clicking outside
			const closeMenu = (e) => {
				if (!menu.contains(e.target) && !moreButton.contains(e.target)) {
					menu.style.display = 'none';
					document.removeEventListener('click', closeMenu);
				}
			};

			moreButton.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();

				// Close other open menus first
				document.querySelectorAll('[data-feed-menu]').forEach(m => {
					if (m !== menu) m.style.display = 'none';
				});

				// Toggle this menu
				const isVisible = menu.style.display !== 'none';
				menu.style.display = isVisible ? 'none' : 'block';

				if (!isVisible) {
					// Position menu above the button
					const buttonRect = moreButton.getBoundingClientRect();
					const cardRect = card.getBoundingClientRect();
					menu.style.position = 'absolute';
					menu.style.right = `${cardRect.right - buttonRect.right}px`;
					menu.style.bottom = `${cardRect.bottom - buttonRect.top + 4}px`;
					menu.style.zIndex = '1000';

					// Add click listener to close on outside click
					setTimeout(() => {
						document.addEventListener('click', closeMenu);
					}, 0);
				} else {
					document.removeEventListener('click', closeMenu);
				}
			});

			hideButton.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();

				// Add to hidden items
				addHiddenFeedItem(String(itemId));

				// Hide the card
				card.style.display = 'none';

				// Close menu
				menu.style.display = 'none';
				document.removeEventListener('click', closeMenu);
			});
		}

		const imageEl = card.querySelector('.feed-card-img');
		const imageContainer = card.querySelector('.feed-card-image');

		if (imageEl && item.image_url) {
			// Skip loading if this element already has this URL (avoids duplicate requests)
			const alreadyLoaded = imageEl.dataset.feedImageUrl === item.image_url ||
				(imageEl.src && imageEl.src === item.image_url) ||
				(imageEl.currentSrc && imageEl.currentSrc === item.image_url);
			if (alreadyLoaded) {
				if (imageEl.complete && imageEl.naturalHeight !== 0) {
					imageContainer.classList.remove('loading');
					imageContainer.classList.add('loaded');
				}
			} else {
				imageEl.dataset.feedImageUrl = item.image_url;
				const isHighPriority = typeof itemIndex === 'number' && itemIndex >= 0 && itemIndex < 2;
				imageEl.loading = isHighPriority ? 'eager' : 'lazy';
				if ('fetchPriority' in imageEl) {
					imageEl.fetchPriority = isHighPriority ? 'high' : 'auto';
				}

				imageContainer.classList.add('loading');

				imageEl.onload = () => {
					imageContainer.classList.remove('loading');
					imageContainer.classList.add('loaded');
				};

				imageEl.onerror = () => {
					imageContainer.classList.remove('loading');
					imageContainer.classList.add('error');
				};

				imageEl.src = item.image_url;

				if (imageEl.complete && imageEl.naturalHeight !== 0) {
					imageContainer.classList.remove('loading');
					imageContainer.classList.add('loaded');
				}
			}
		}

		if (item.image_url && item.created_image_id) {
			// Make the entire card clickable except the actions row
			card.style.cursor = 'pointer';

			// Add click handler to the card
			card.addEventListener('click', (e) => {
				// Allow profile links to navigate without triggering card click
				const profileLink = e.target?.closest?.('[data-profile-link]');
				if (profileLink) return;

				// Don't navigate if clicking on actions row or its children
				const actionsRow = card.querySelector('.feed-card-actions');
				if (actionsRow && actionsRow.contains(e.target)) {
					return;
				}
				window.location.href = `/creations/${item.created_image_id}`;
			});

			// Prevent actions row from triggering card click
			const actionsRow = card.querySelector('.feed-card-actions');
			if (actionsRow) {
				actionsRow.style.cursor = 'default';
				actionsRow.addEventListener('click', (e) => {
					e.stopPropagation();
				});
			}
		}

		return card;
	}

	buildTipCard(item) {
		const card = document.createElement("div");
		card.className = "feed-card feed-card-tip";
		const title = item.title || "Tip";
		const message = item.message || "";
		const cta = item.cta || "Explore";
		const ctaRoute = (item.ctaRoute || "/explore").trim();
		const isExternal = ctaRoute.startsWith("http://") || ctaRoute.startsWith("https://");
		const openInNewTab = isExternal && (item.ctaTarget === "_blank" || item.ctaRoute?.startsWith("http"));
		const targetAttr = openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : "";
		card.innerHTML = html`
			<div class="feed-card-tip-inner">
				<div class="feed-card-tip-title">${title}</div>
				<div class="feed-card-tip-message">${message}</div>
				<a class="route-empty-button feed-card-tip-cta" href="${ctaRoute}"${targetAttr} data-tip-cta>${cta}</a>
			</div>
		`;
		const ctaEl = card.querySelector("[data-tip-cta]");
		if (ctaEl) {
			ctaEl.addEventListener("click", (e) => {
				e.preventDefault();
				if (isExternal && ctaEl.getAttribute("target") === "_blank") {
					window.open(ctaRoute, "_blank", "noopener,noreferrer");
				} else {
					window.location.href = ctaRoute;
				}
			});
		}

		const tipInner = card.querySelector(".feed-card-tip-inner");
		if (tipInner && typeof IntersectionObserver !== "undefined") {
			const observer = new IntersectionObserver(
				(entries) => {
					const entry = entries[0];
					if (entry?.isIntersecting) {
						card.classList.add("feed-card-tip-in-view");
						observer.disconnect();
					}
				},
				{ threshold: 0.25, rootMargin: "0px 0px -40px 0px" }
			);
			observer.observe(tipInner);
		}

		return card;
	}

	async loadFeed() {
		const container = this.querySelector("[data-feed-container]");
		if (!container) return;

		if (this.isLoading) return;
		// Skip refetch if we already have feed data (avoids loop from repeated loadFeed calls)
		if (Array.isArray(this.feedItems) && this.feedItems.length > 0) {
			return;
		}

		this.isLoading = true;
		try {
			// Get current user ID
			let currentUserId = null;
			const profile = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 30000 })
				.catch(() => ({ ok: false, status: 0, data: null }));
			if (profile.ok) {
				currentUserId = profile.data?.id ?? null;
			}

			const feed = await fetchJsonWithStatusDeduped("/api/feed", {
				credentials: 'include'
			}, { windowMs: 30000 });
			if (!feed.ok) throw new Error("Failed to load feed.");
			let items = Array.isArray(feed.data?.items) ? feed.data.items : [];

			// Filter out hidden items (only creation items; tips are not hideable)
			const hiddenIds = getHiddenFeedItems();
			items = items.filter(item => {
				if (item.type === "tip") return true;
				const itemId = String(item.created_image_id || item.id);
				return !hiddenIds.includes(itemId);
			});

			container.innerHTML = "";
			if (items.length === 0) {
				container.innerHTML = html`
					<div class="route-empty route-empty-image-grid route-empty-state">
						<div class="route-empty-icon">
						<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10"></circle>
							<line x1="2" y1="12" x2="22" y2="12"></line>
							<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
						</svg>
						</div>
						<div class="route-empty-title">Your feed is empty</div>
						<div class="route-empty-message">Your feed shows creations from people you follow. Explore the community, follow a few creators, and your feed will start filling up.</div>
						<a class="route-empty-button" href="/explore" data-route="explore">Explore creators</a>
					</div>
				`;

				// Use client-side routing for the CTA (matches other routes’ empty states).
				const button = container.querySelector('.route-empty-button[data-route="explore"]');
				if (button) {
					button.addEventListener('click', (e) => {
						e.preventDefault();
						const header = document.querySelector('app-navigation');
						if (header && typeof header.navigateToRoute === 'function') {
							header.navigateToRoute('explore');
							return;
						}
						window.location.href = '/explore';
					});
				}

				return;
			}

			this.feedItems = items;
			this.feedIndex = 0;
			this.sentinelWasIntersecting = false;
			this.renderNextBatch();
		} catch (error) {
			container.innerHTML = html`<div class="route-empty route-empty-image-grid">Unable to load feed.</div>`;
		} finally {
			this.isLoading = false;
		}
	}
}

customElements.define("app-route-feed", AppRouteFeed);
