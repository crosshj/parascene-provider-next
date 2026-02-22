import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { notifyIcon, creditIcon } from '../../icons/svg-strings.js';

const html = String.raw;

const AVATAR_URL_STORAGE_KEY = 'profile-avatar-url';

class AppNavigation extends HTMLElement {
	constructor() {
		super();
		this.notificationsMenuOpen = false;
		this.mobileMenuOpen = false;
		this.notificationsCount = 0;
		this.creditsCount = 0;
		this.avatarUrl = null;
		this.avatarLoading = false;
		this.plan = 'free';
		this.previewNotifications = [];
		this.previewLoadedAt = 0;
		this.previewLoading = false;
		this.handleDocumentClick = this.handleDocumentClick.bind(this);
		this.handleKeydown = this.handleKeydown.bind(this);
		this.handleRouteChange = this.handleRouteChange.bind(this);
		this.handleNotificationsUpdated = this.handleNotificationsUpdated.bind(this);
		this.handleCreditsUpdated = this.handleCreditsUpdated.bind(this);
		this.handleCreditsClaimStatus = this.handleCreditsClaimStatus.bind(this);
		this.canClaimCredits = null; // null = unknown (no callout)
		this.currentRoute = null;
		this.routes = [];
		this.authLinks = [];
		this.defaultRoute = null;
		this.hasParsedRoutes = false;
	}

	static get observedAttributes() {
		return ['show-notifications', 'hide-notifications', 'show-profile', 'show-create', 'show-mobile-menu', 'hide-credits', 'default-route', 'credits-count'];
	}

	connectedCallback() {
		// Establish avatar loading state before first render to avoid icon flicker.
		if (this.hasAttribute('show-profile')) {
			this.avatarUrl = this.readStoredAvatarUrl();
			this.avatarLoading = !this.avatarUrl;
		}

		// Parse routes if not already parsed (attributeChangedCallback might have run first)
		if (!this.hasParsedRoutes) {
			this.parseRoutesFromChildren();
		}

		// Now render (which will replace innerHTML and children)
		this.render();
		this.setupEventListeners();
		this.setupNavListeners();
		document.addEventListener('click', this.handleDocumentClick);
		document.addEventListener('keydown', this.handleKeydown);
		window.addEventListener('popstate', this.handleRouteChange);
		document.addEventListener('notifications-acknowledged', this.handleNotificationsUpdated);
		document.addEventListener('credits-updated', this.handleCreditsUpdated);
		document.addEventListener('credits-claim-status', this.handleCreditsClaimStatus);
		this.loadNotificationCount();
		this.loadCreditsCount();
		// Don't show credits callout until claim status is known from API.
		this.updateCreditsAttention(null);
		this.prefetchNotificationPreview();
		// Establish current route immediately so route components can react on mount.
		this.handleRouteChange();
		// Defer again so route content sections (which may not be parsed yet) get display/active set and route-change is heard.
		setTimeout(() => this.handleRouteChange(), 0);
	}

	disconnectedCallback() {
		document.removeEventListener('click', this.handleDocumentClick);
		document.removeEventListener('keydown', this.handleKeydown);
		window.removeEventListener('popstate', this.handleRouteChange);
		document.removeEventListener('notifications-acknowledged', this.handleNotificationsUpdated);
		document.removeEventListener('credits-updated', this.handleCreditsUpdated);
		document.removeEventListener('credits-claim-status', this.handleCreditsClaimStatus);
	}

	attributeChangedCallback(name, oldValue, newValue) {
		// Parse routes BEFORE rendering if not already parsed
		if (!this.hasParsedRoutes) {
			this.parseRoutesFromChildren();
		}

		if (name === 'default-route' && oldValue !== newValue) {
			this.defaultRoute = newValue;
			if (this.hasParsedRoutes) {
				this.handleRouteChange();
			}
		} else if (name === 'credits-count' && oldValue !== newValue) {
			this.creditsCount = this.parseCreditsCount(newValue);
			this.updateCreditsUI(this.creditsCount);
		} else {
			// Re-render to update UI
			this.render();
			this.setupEventListeners();
			this.setupNavListeners();
			this.loadNotificationCount();
			this.loadCreditsCount();
			// Re-apply active route highlight (render replaced DOM, so links lost .active)
			this.handleRouteChange();
		}
	}

	readStoredAvatarUrl() {
		try {
			const stored = window.localStorage?.getItem(AVATAR_URL_STORAGE_KEY);
			const value = typeof stored === 'string' ? stored.trim() : '';
			return value || null;
		} catch {
			return null;
		}
	}

	writeStoredAvatarUrl(url) {
		const value = typeof url === 'string' ? url.trim() : '';
		if (!value) return;
		try {
			window.localStorage?.setItem(AVATAR_URL_STORAGE_KEY, value);
		} catch {
			// ignore storage errors
		}
	}

	clearStoredAvatarUrl() {
		try {
			window.localStorage?.removeItem(AVATAR_URL_STORAGE_KEY);
		} catch {
			// ignore storage errors
		}
	}

	updateProfileAvatarUI({ loading, avatarUrl, plan } = {}) {
		if (typeof loading === 'boolean') {
			this.avatarLoading = loading;
		}
		const nextAvatar = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
		if (avatarUrl !== undefined) {
			this.avatarUrl = nextAvatar || null;
		}
		if (plan !== undefined) {
			this.plan = plan === 'founder' ? 'founder' : 'free';
		}

		const button = this.querySelector('.profile-button');
		if (!button) return;

		button.classList.toggle('has-avatar', Boolean(this.avatarUrl));
		button.classList.toggle('is-avatar-loading', Boolean(this.avatarLoading) && !this.avatarUrl);

		const isFounder = this.plan === 'founder';
		const fallbackSvg = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
		const avatarContent = this.avatarUrl
			? `<img class="profile-avatar" src="${this.avatarUrl.replace(/"/g, '&quot;')}" alt="" aria-hidden="true">`
			: fallbackSvg;

		if (isFounder) {
			button.innerHTML = `
				<div class="avatar-with-founder-flair avatar-with-founder-flair--sm">
					<div class="founder-flair-avatar-ring">
						<div class="founder-flair-avatar-inner">
							${avatarContent}
						</div>
					</div>
				</div>`;
		} else {
			const img = button.querySelector('img.profile-avatar');
			if (img) {
				if (this.avatarUrl) {
					img.src = this.avatarUrl;
				} else {
					img.removeAttribute('src');
				}
			} else {
				button.innerHTML = `
					<img class="profile-avatar" ${this.avatarUrl ? `src="${this.avatarUrl}"` : ''} alt="" aria-hidden="true">
					${fallbackSvg}`;
			}
		}
	}

	parseRoutesFromChildren() {
		// Parse routes from direct children - must be called BEFORE render()
		const children = Array.from(this.children);
		const routeLinks = children.filter(child =>
			child.tagName === 'A' && child.hasAttribute('data-route')
		);

		this.routes = routeLinks.map(link => ({
			id: link.getAttribute('data-route'),
			label: link.textContent.trim()
		}));

		if (!Array.isArray(this.routes)) {
			this.routes = [];
		}

		// Parse auth links (links with class header-auth-link)
		const authLinks = children.filter(child =>
			child.tagName === 'A' && child.classList.contains('header-auth-link')
		);

		this.authLinks = authLinks.map(link => ({
			href: link.getAttribute('href') || '#',
			text: link.textContent.trim(),
			isPrimary: link.classList.contains('btn-primary')
		}));

		if (!Array.isArray(this.authLinks)) {
			this.authLinks = [];
		}

		this.defaultRoute = this.getAttribute('default-route') || this.routes[0]?.id;
		this.hasParsedRoutes = true;
	}


	setupNavListeners() {
		const navLinks = this.querySelectorAll('.header-nav .nav-link, .mobile-menu .nav-link');
		navLinks.forEach(link => {
			link.addEventListener('click', (e) => {
				e.preventDefault();
				const route = link.getAttribute('data-route');
				if (route) {
					this.navigateToRoute(route);
					if (link.closest('.mobile-menu')) {
						this.closeMobileMenu();
					}
				}
			});
		});
	}

	navigateToRoute(route) {
		// Check if we're on a server-sent or standalone page (create, creation detail, pricing, etc.)
		// If so, use full page navigation for ANY route change
		const isServerSentPage = window.location.pathname === '/create' ||
			window.location.pathname === '/pricing' ||
			/^\/creations\/\d+(\/(edit|mutat|mutate))?$/.test(window.location.pathname) ||
			window.location.pathname.startsWith('/s/') ||
			(window.location.pathname === '/help' || window.location.pathname.startsWith('/help/')) ||
			window.location.pathname === '/user' ||
			/^\/user\/\d+$/.test(window.location.pathname) ||
			/^\/p\/[a-z0-9][a-z0-9_-]{2,23}$/i.test(window.location.pathname) ||
			/^\/t\/[a-z0-9][a-z0-9_-]{1,31}$/i.test(window.location.pathname);
		if (isServerSentPage) {
			// Use full page navigation for server-sent pages
			window.location.href = `/${route}`;
			return;
		}
		// Use History API with pathname-based routing for client-side pages
		window.history.pushState({ route }, '', `/${route}`);
		this.handleRouteChange();
	}

	updateCreateButtonState() {
		const createButtons = this.querySelectorAll('.create-button');
		if (createButtons.length === 0) return;

		const pathname = window.location.pathname;
		const currentRoute = pathname === '/' || pathname === '' ? this.defaultRoute : pathname.slice(1);
		const isCreateRoute = currentRoute === 'create' || pathname === '/create';

		createButtons.forEach(createButton => {
			createButton.disabled = isCreateRoute;
			createButton.classList.toggle('is-active', isCreateRoute);
		});
	}

	async loadNotificationCount({ force = false } = {}) {
		if (!this.hasAttribute('show-notifications')) return;

		try {
			const result = await fetchJsonWithStatusDeduped('/api/notifications/unread-count', {
				credentials: 'include'
			}, { windowMs: force ? 0 : 2000 });
			if (!result.ok) throw new Error('Failed to load notifications count');
			const count = Number(result.data?.count || 0);
			this.updateNotificationsUI(count);
		} catch {
			this.updateNotificationsUI(0);
		}
	}

	updateNotificationsUI(count) {
		this.notificationsCount = count;
		const badge = this.querySelector('.notifications-badge');
		if (badge) {
			if (count > 0) {
				badge.textContent = count > 99 ? '99+' : String(count);
			} else {
				badge.textContent = '';
			}
		}

		const status = this.querySelector('.notifications-status');
		if (status) {
			status.textContent =
				count > 0
					? `${count} new notification${count === 1 ? '' : 's'}`
					: 'No new notifications';
		}
	}

	async loadCreditsCount() {
		if (!this.hasAttribute('show-profile')) return;

		// While we determine avatar state, hide the profile icon (unless we already have a cached avatar).
		this.updateProfileAvatarUI({ loading: !this.avatarUrl });

		if (this.hasAttribute('credits-count')) {
			const count = this.parseCreditsCount(this.getAttribute('credits-count'));
			this.updateCreditsUI(count);
			// Continue to fetch profile for avatar + cache consistency.
		}

		try {
			const profile = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 });
			if (!profile.ok) {
				if (profile.status === 401) {
					this.clearStoredCredits();
					this.clearStoredUserEmail();
					this.clearStoredAvatarUrl();
				}
				const fallbackAvatarUrl = this.avatarUrl || this.readStoredAvatarUrl();
				this.updateProfileAvatarUI({ loading: false, avatarUrl: fallbackAvatarUrl || null });
				this.updateCreditsUI(0);
				return;
			}
			const user = profile.data;
			const currentUserEmail = user?.email || null;
			const nextAvatarUrl = typeof user?.profile?.avatar_url === 'string' ? user.profile.avatar_url.trim() : '';

			// If no signed-in user, clear cache
			if (!currentUserEmail) {
				this.clearStoredCredits();
				this.clearStoredUserEmail();
				this.clearStoredAvatarUrl();
				this.updateProfileAvatarUI({ loading: false, avatarUrl: null });
				this.updateCreditsUI(0);
				return;
			}

			// Check if user changed - if so, clear cache
			const cachedUserEmail = this.readStoredUserEmail();
			if (cachedUserEmail && currentUserEmail !== cachedUserEmail) {
				// User changed - clear cache
				this.clearStoredCredits();
				this.clearStoredUserEmail();
				this.clearStoredAvatarUrl();
			}

			const count = this.parseCreditsCount(user?.credits);
			this.updateCreditsUI(count);
			this.plan = user?.plan === 'founder' ? 'founder' : 'free';

			// Avatar cache + UI
			if (nextAvatarUrl) {
				this.writeStoredAvatarUrl(nextAvatarUrl);
				this.updateProfileAvatarUI({ loading: false, avatarUrl: nextAvatarUrl });
			} else {
				this.clearStoredAvatarUrl();
				this.updateProfileAvatarUI({ loading: false, avatarUrl: null });
			}
			this.updateProfileAvatarUI({ plan: this.plan });

			// Store user email for future checks
			this.writeStoredUserEmail(currentUserEmail);
		} catch {
			// Network/unknown error fallback: show cached value (if any).
			const storedCount = this.readStoredCreditsCount();
			if (storedCount !== null && this.readStoredUserEmail()) {
				this.updateCreditsUI(storedCount);
				// If we have a cached avatar, show it; otherwise stop loading and show icon.
				const storedAvatarUrl = this.readStoredAvatarUrl();
				if (storedAvatarUrl) {
					this.updateProfileAvatarUI({ loading: false, avatarUrl: storedAvatarUrl });
				} else {
					this.updateProfileAvatarUI({ loading: false, avatarUrl: null });
				}
				return;
			}
			this.updateProfileAvatarUI({ loading: false, avatarUrl: null });
			this.updateCreditsUI(0);
		}
	}

	updateCreditsUI(count) {
		this.creditsCount = count;
		const creditsCount = this.querySelector('.credits-count');
		if (creditsCount) {
			// Format credits: if there's a non-zero decimal remainder, show as "X+" (rounded down)
			// Otherwise show the whole number without decimal
			const normalized = this.parseCreditsCount(count);
			const wholePart = Math.floor(normalized);
			const decimalPart = normalized - wholePart;
			const formatted = decimalPart > 0 ? `${wholePart}+` : String(wholePart);
			creditsCount.textContent = formatted;
		}
	}

	parseCreditsCount(value) {
		const count = Number(value);
		if (!Number.isFinite(count)) return 0;
		return Math.max(0, Math.round(count * 10) / 10);
	}

	handleCreditsUpdated(event) {
		const count = this.parseCreditsCount(event?.detail?.count);
		this.updateCreditsUI(count);
	}

	handleCreditsClaimStatus(event) {
		const value = event?.detail?.canClaim;
		const canClaim = typeof value === 'boolean' ? value : null;
		this.canClaimCredits = canClaim;
		this.updateCreditsAttention(canClaim);
	}

	updateCreditsAttention(forceCanClaim) {
		const creditsButton = this.querySelector('.credits-button');
		if (!creditsButton) return;
		const canClaim = typeof forceCanClaim === 'boolean'
			? forceCanClaim
			: null;
		// Only show callout if status is known and canClaim is true.
		creditsButton.classList.toggle('attention', canClaim === true);
	}

	readStoredCreditsCount() {
		try {
			const stored = window.localStorage?.getItem('credits-balance');
			if (stored == null) return null;
			const parsed = this.parseCreditsCount(stored);
			return parsed;
		} catch {
			return null;
		}
	}

	readStoredUserEmail() {
		try {
			return window.localStorage?.getItem('credits-user-email');
		} catch {
			return null;
		}
	}

	writeStoredUserEmail(email) {
		try {
			window.localStorage?.setItem('credits-user-email', email);
		} catch {
			// ignore storage errors
		}
	}

	clearStoredCredits() {
		try {
			window.localStorage?.removeItem('credits-balance');
		} catch {
			// ignore storage errors
		}
	}

	clearStoredUserEmail() {
		try {
			window.localStorage?.removeItem('credits-user-email');
		} catch {
			// ignore storage errors
		}
	}

	async loadNotificationPreview({ silent = true, force = false } = {}) {
		if (!this.hasAttribute('show-notifications')) return;

		const preview = this.querySelector('.notifications-preview');
		if (!preview) return;

		if (this.previewLoading) return;
		const now = Date.now();
		if (!force && now - this.previewLoadedAt < 30000) return;

		try {
			this.previewLoading = true;
			const result = await fetchJsonWithStatusDeduped('/api/notifications', {
				credentials: 'include'
			}, { windowMs: 2000 });
			if (result.status === 401) {
				if (!this.previewNotifications.length) {
					preview.innerHTML = html`
			<div class="notifications-menu-item notifications-loading">
				Sign in to view notifications.
			</div>
          `;
				}
				this.updateNotificationsMenuViewAllVisibility();
				return;
			}
			if (!result.ok) {
				throw new Error('Failed to load notifications');
			}
			const notifications = Array.isArray(result.data?.notifications)
				? result.data.notifications.slice(0, 5)
				: [];

			const nextKey = notifications
				.map((notification) => `${notification.id}:${notification.acknowledged_at || ''}`)
				.join('|');
			const currentKey = this.previewNotifications
				.map((notification) => `${notification.id}:${notification.acknowledged_at || ''}`)
				.join('|');

			if (nextKey === currentKey) {
				this.previewLoadedAt = Date.now();
				return;
			}

			this.previewNotifications = notifications;
			this.previewLoadedAt = Date.now();

			if (notifications.length === 0) {
				preview.innerHTML = html`
		<div class="notifications-menu-item notifications-loading">
			No notifications yet.
		</div>
        `;
				this.updateNotificationsMenuViewAllVisibility();
				return;
			}

			const fragment = document.createDocumentFragment();
			for (const notification of notifications) {
				const item = document.createElement('div');
				item.className = 'notification-preview-item';
				if (notification.acknowledged_at) {
					item.classList.add('is-read');
				} else {
					item.classList.add('is-new');
				}
				item.setAttribute('role', 'button');
				item.setAttribute('tabindex', '0');
				item.addEventListener('click', async () => {
					const goDirect = (notification.type === 'comment' || notification.type === 'comment_thread' || notification.type === 'tip' || notification.type === 'creation_activity') &&
						typeof notification.link === 'string' && notification.link.trim();
					if (goDirect) {
						item.classList.add('is-loading');
						item.setAttribute('aria-busy', 'true');
						const spinner = document.createElement('div');
						spinner.className = 'notification-preview-item-spinner';
						spinner.setAttribute('aria-hidden', 'true');
						item.appendChild(spinner);
						try {
							await fetch('/api/notifications/acknowledge', {
								method: 'POST',
								headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
								body: new URLSearchParams({ id: String(notification.id) }),
								credentials: 'include'
							});
						} catch {
							// ignore
						}
						this.closeNotificationsMenu();
						document.dispatchEvent(new CustomEvent('close-all-modals'));
						window.location.href = notification.link.trim();
					} else {
						document.dispatchEvent(new CustomEvent('open-notifications', {
							detail: { notificationId: notification.id }
						}));
						this.closeNotificationsMenu();
					}
				});

				const title = document.createElement('div');
				title.className = 'notification-preview-title';
				title.textContent = notification.title || 'Notification';

				const message = document.createElement('div');
				message.className = 'notification-preview-message';
				message.textContent = notification.message || '';

				const time = document.createElement('div');
				time.className = 'notification-preview-time';
				time.textContent = formatRelativeTime(notification.created_at) || '';
				time.title = formatDateTime(notification.created_at) || '';

				item.appendChild(title);
				item.appendChild(message);
				item.appendChild(time);
				fragment.appendChild(item);
			}
			preview.innerHTML = '';
			preview.appendChild(fragment);
			this.updateNotificationsMenuViewAllVisibility();
		} catch {
			if (!silent && !this.previewNotifications.length) {
				preview.innerHTML = html`
		<div class="notifications-menu-item notifications-loading">
			Failed to load notifications.
		</div>
        `;
			}
			this.updateNotificationsMenuViewAllVisibility();
		} finally {
			this.previewLoading = false;
		}
	}

	prefetchNotificationPreview() {
		const schedule = window.requestIdleCallback
			? window.requestIdleCallback.bind(window)
			: (cb) => setTimeout(cb, 250);
		schedule(() => {
			this.loadNotificationPreview({ silent: true, force: true });
		});
	}

	async autoAcknowledgeNotificationsForPath(pathname) {
		if (!this.hasAttribute('show-notifications')) return;
		const path = typeof pathname === 'string' && pathname ? pathname.split('#')[0].split('?')[0] : '';
		if (!path) return;
		// Avoid duplicate runs when handleRouteChange fires multiple times (e.g. connect + setTimeout, desktop + mobile nav).
		const now = Date.now();
		try {
			const last = window.__autoAckPathDedup;
			if (last?.path === path && (now - (last.t || 0)) < 1500) return;
		} catch {
			// ignore
		}
		try {
			window.__autoAckPathDedup = { path, t: now };
		} catch {
			// ignore
		}

		try {
			const result = await fetchJsonWithStatusDeduped(
				'/api/notifications',
				{ credentials: 'include' },
				{ windowMs: 0 }
			);
			if (!result.ok || !Array.isArray(result.data?.notifications)) {
				return;
			}

			const matching = result.data.notifications.filter((notification) => {
				if (!notification || notification.acknowledged_at) return false;
				const link = typeof notification.link === 'string' ? notification.link : '';
				const linkPath = link.split('#')[0].split('?')[0];
				return linkPath === path;
			});

			// One ack per link is enough: backend marks all notifications for that creation when we ack any one.
			const seenLink = new Set();
			const toAcknowledge = matching.filter((notification) => {
				const link = typeof notification.link === 'string' ? notification.link : '';
				const linkPath = link.split('#')[0].split('?')[0];
				if (seenLink.has(linkPath)) return false;
				seenLink.add(linkPath);
				return true;
			});

			if (toAcknowledge.length > 0) {
				await Promise.all(
					toAcknowledge.map((notification) =>
						fetch('/api/notifications/acknowledge', {
							method: 'POST',
							headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
							body: new URLSearchParams({ id: String(notification.id) }),
							credentials: 'include'
						}).catch(() => null)
					)
				);
			}

			// Always refresh bell and preview so they reflect current state (e.g. after landing from a notification click).
			this.loadNotificationCount({ force: true });
			this.loadNotificationPreview({ silent: true, force: true });
			document.dispatchEvent(new CustomEvent('notifications-acknowledged'));
		} catch {
			// Best-effort only; ignore failures.
		}
	}

	handleNotificationsUpdated() {
		this.loadNotificationCount({ force: true });
		this.loadNotificationPreview({ silent: true, force: true });
	}

	handleRouteChange() {
		const pathname = window.location.pathname;

		// Logged-in user on auth URL (e.g. /auth#login from another tab) → redirect to app so we don't show a blank content area
		if (pathname === '/auth' || pathname === '/auth.html') {
			const params = new URLSearchParams(window.location.search);
			let returnUrl = params.get('returnUrl') || '';
			if (returnUrl === '/auth' || returnUrl === '/auth.html') returnUrl = '';
			const target = (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') && !returnUrl.includes('://'))
				? returnUrl
				: `/${this.defaultRoute || 'feed'}`;
			window.history.replaceState(null, '', target);
			this.handleRouteChange();
			return;
		}

		// First: auto-ack any notifications that point at this URL.
		void this.autoAcknowledgeNotificationsForPath(pathname);

		// If we're on a server-sent page (like creation detail, pricing), don't handle route changes
		// Any navigation should result in a full page load
		const isServerSentPage = pathname === '/pricing' ||
			/^\/creations\/\d+(\/(edit|mutat|mutate))?$/.test(pathname) ||
			pathname.startsWith('/s/') ||
			(pathname === '/help' || pathname.startsWith('/help/')) ||
			pathname === '/user' ||
			/^\/user\/\d+$/.test(pathname) ||
			/^\/p\/[a-z0-9][a-z0-9_-]{2,23}$/i.test(pathname) ||
			/^\/t\/[a-z0-9][a-z0-9_-]{1,31}$/i.test(pathname);
		if (isServerSentPage) {
			return;
		}

		this.closeMobileMenu();

		// Get route from pathname (e.g., /feed -> feed, / -> defaultRoute)
		let currentRoute = pathname === '/' || pathname === '' ? this.defaultRoute : pathname.slice(1).split('/')[0];
		if (pathname.startsWith('/connect')) {
			currentRoute = 'connect';
		}

		const previousRoute = this.currentRoute;
		const routeChanged = previousRoute !== currentRoute;

		// Make current route discoverable to other components immediately on mount.
		try {
			window.__CURRENT_ROUTE__ = currentRoute;
		} catch {
			// ignore
		}
		try {
			document.documentElement.dataset.route = currentRoute;
		} catch {
			// ignore
		}

		// If at root and we have a default route, update URL to reflect it
		if ((pathname === '/' || pathname === '') && this.defaultRoute && currentRoute) {
			window.history.replaceState({ route: currentRoute }, '', `/${currentRoute}`);
		}

		// Always update active nav link (both desktop and mobile) so highlight is correct after re-renders
		const navLinks = this.querySelectorAll('.header-nav .nav-link, .mobile-menu .nav-link');
		navLinks.forEach(link => {
			const isActive = link.getAttribute('data-route') === currentRoute;
			link.classList.toggle('active', isActive);
		});

		// Update Create button state
		this.updateCreateButtonState();

		// Show/hide route content sections
		const contentSections = document.querySelectorAll('[data-route-content]');
		contentSections.forEach(section => {
			const isActive = section.getAttribute('data-route-content') === currentRoute;
			section.classList.toggle('active', isActive);
			section.style.display = isActive ? 'block' : 'none';
		});

		this.currentRoute = currentRoute;

		// Only reset scroll and dispatch when the route actually changed (stops duplicate loads and handler storms)
		if (routeChanged && previousRoute != null) {
			this.resetSectionScroll();
		}
		if (routeChanged) {
			this.dispatchEvent(new CustomEvent('route-change', {
				detail: { route: currentRoute },
				bubbles: true
			}));
		}
	}

	handleDocumentClick(e) {
		// Ensure nav link clicks always use client-side routing (no full page load = no manifest reload).
		// Delegation so we never miss a link even if DOM was re-rendered before listeners reattached.
		if (e.button === 0 && this.contains(e.target)) {
			const link = e.target?.closest?.('a.nav-link[data-route]');
			if (link) {
				// Only handle if no other listener did (avoids double navigate when link listener already ran)
				if (!e.defaultPrevented) {
					e.preventDefault();
					e.stopPropagation();
					const route = link.getAttribute('data-route');
					if (route) {
						this.navigateToRoute(route);
						if (link.closest('.mobile-menu')) {
							this.closeMobileMenu();
						}
					}
				}
				return;
			}
		}
		if (this.notificationsMenuOpen) {
			this.closeNotificationsMenu();
		}
		if (this.mobileMenuOpen) {
			const menu = this.querySelector('.mobile-menu');
			const toggle = this.querySelector('[data-mobile-menu-toggle]');
			const clickedInside = menu?.contains(e.target) || toggle?.contains(e.target);
			if (!clickedInside) {
				this.closeMobileMenu();
			}
		}
	}

	handleKeydown(e) {
		if (e.key === 'Escape' && this.mobileMenuOpen) {
			this.closeMobileMenu();
		}
	}

	resetSectionScroll() {
		const scroller = document.scrollingElement || document.documentElement;
		if (!scroller) return;
		scroller.scrollTop = 0;
		if (typeof window.scrollTo === 'function') {
			window.scrollTo(0, 0);
		}
	}

	setupEventListeners() {
		const createButtons = this.querySelectorAll('.create-button');
		createButtons.forEach(createButton => {
			createButton.addEventListener('click', (e) => {
				// Don't navigate if already on create page
				if (createButton.disabled) {
					e.preventDefault();
					e.stopPropagation();
					return;
				}
				// Allow default navigation for link to /create (standalone create page)
				if (createButton.getAttribute?.('href') === '/create') return;
				e.preventDefault();
				e.stopPropagation();
				this.navigateToRoute('create');
				if (createButton.closest('.mobile-menu')) {
					this.closeMobileMenu();
				}
			});
		});

		const profileButtons = this.querySelectorAll('.profile-button');
		profileButtons.forEach(profileButton => {
			profileButton.addEventListener('click', (e) => {
				e.stopPropagation();
				document.dispatchEvent(new CustomEvent('open-profile'));
			});

			// Fallback to icon if avatar image fails to load.
			const avatarImg = profileButton.querySelector('img.profile-avatar');
			if (avatarImg) {
				avatarImg.addEventListener('error', () => {
					this.clearStoredAvatarUrl();
					this.updateProfileAvatarUI({ loading: false, avatarUrl: null });
				});
			}
		});

		const notificationsButtons = this.querySelectorAll('.notifications-button');
		notificationsButtons.forEach(notificationsButton => {
			notificationsButton.addEventListener('click', (e) => {
				e.stopPropagation();
				this.toggleNotificationsMenu();
			});
		});

		const creditsButtons = this.querySelectorAll('.credits-button');
		creditsButtons.forEach(creditsButton => {
			creditsButton.addEventListener('click', (e) => {
				e.stopPropagation();
				document.dispatchEvent(new CustomEvent('open-credits'));
			});
		});

		const notificationsMenu = this.querySelector('.notifications-menu');
		if (notificationsMenu) {
			notificationsMenu.addEventListener('click', (e) => {
				const link = e.target.closest('a[data-action="notifications"]');
				if (link) {
					e.preventDefault();
					e.stopPropagation();
					this.closeNotificationsMenu();
					document.dispatchEvent(new CustomEvent('open-notifications'));
				} else {
					e.stopPropagation();
				}
			});
		}

		this.setupMobileMenuListeners();
	}

	setupMobileMenuListeners() {
		const toggleButton = this.querySelector('[data-mobile-menu-toggle]');
		if (toggleButton) {
			toggleButton.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.toggleMobileMenu();
			});
		}

		const closeButtons = this.querySelectorAll('[data-mobile-menu-close]');
		closeButtons.forEach(button => {
			button.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.closeMobileMenu();
			});
		});

		const backdrop = this.querySelector('[data-mobile-menu-backdrop]');
		if (backdrop) {
			backdrop.addEventListener('click', () => {
				this.closeMobileMenu();
			});
		}

		const actionButtons = this.querySelectorAll('[data-mobile-menu-action]');
		actionButtons.forEach(button => {
			button.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const action = button.getAttribute('data-mobile-menu-action');
				this.closeMobileMenu();
				if (action === 'notifications') {
					document.dispatchEvent(new CustomEvent('open-notifications'));
				} else if (action === 'credits') {
					document.dispatchEvent(new CustomEvent('open-credits'));
				} else if (action === 'profile') {
					document.dispatchEvent(new CustomEvent('open-profile'));
				} else if (action === 'create') {
					window.location.href = '/create';
				}
			});
		});
	}

	toggleMobileMenu() {
		this.mobileMenuOpen = !this.mobileMenuOpen;
		this.syncMobileMenuUI();
	}

	closeMobileMenu() {
		if (!this.mobileMenuOpen) return;
		this.mobileMenuOpen = false;
		this.syncMobileMenuUI();
	}

	syncMobileMenuUI() {
		const menu = this.querySelector('.mobile-menu');
		const backdrop = this.querySelector('.mobile-menu-backdrop');
		const toggle = this.querySelector('[data-mobile-menu-toggle]');
		if (menu) {
			menu.classList.toggle('open', this.mobileMenuOpen);
			menu.setAttribute('aria-hidden', this.mobileMenuOpen ? 'false' : 'true');
		}
		if (backdrop) {
			backdrop.classList.toggle('open', this.mobileMenuOpen);
		}
		if (toggle) {
			toggle.classList.toggle('active', this.mobileMenuOpen);
			toggle.setAttribute('aria-expanded', this.mobileMenuOpen ? 'true' : 'false');
		}
	}

	updateNotificationsMenuViewAllVisibility() {
		const hasNotifications = (this.notificationsCount || 0) > 0 || (this.previewNotifications || []).length > 0;
		const menu = this.querySelector('.notifications-menu');
		if (!menu) return;
		const divider = menu.querySelector('.notifications-menu-divider');
		const viewAllLink = menu.querySelector('a[data-action="notifications"]');
		if (divider) divider.style.display = hasNotifications ? '' : 'none';
		if (viewAllLink) viewAllLink.style.display = hasNotifications ? '' : 'none';
	}

	toggleNotificationsMenu() {
		const wasOpen = this.notificationsMenuOpen;
		this.notificationsMenuOpen = !this.notificationsMenuOpen;
		const menu = this.querySelector('.notifications-menu');
		if (menu) {
			menu.classList.toggle('open', this.notificationsMenuOpen);
			if (this.notificationsMenuOpen) {
				const preview = menu.querySelector('.notifications-preview');
				if (preview && !preview.innerHTML.trim()) {
					preview.innerHTML = html`
			<div class="notifications-menu-item notifications-loading">
				You're all caught up. New notifications will appear here.
			</div>
            `;
				}
				this.updateNotificationsMenuViewAllVisibility();
				this.loadNotificationPreview({ silent: true });
			}
		}
		if (!wasOpen && this.notificationsMenuOpen) {
			document.dispatchEvent(new CustomEvent('modal-opened'));
		} else if (wasOpen && !this.notificationsMenuOpen) {
			document.dispatchEvent(new CustomEvent('modal-closed'));
		}
	}

	closeNotificationsMenu() {
		if (!this.notificationsMenuOpen) return;
		this.notificationsMenuOpen = false;
		const menu = this.querySelector('.notifications-menu');
		if (menu) {
			menu.classList.remove('open');
		}
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}


	render() {
		const showNotifications = this.hasAttribute('show-notifications') && !this.hasAttribute('hide-notifications');
		const showProfile = this.hasAttribute('show-profile');
		const showCreate = this.hasAttribute('show-create');
		const showMobileMenu = this.hasAttribute('show-mobile-menu');
		const showCredits = this.hasAttribute('show-profile') && !this.hasAttribute('hide-credits');
		const hasAuthLinks = (this.authLinks || []).length > 0;
		const hasMobileActions = showCreate || showNotifications || showCredits || showProfile;

		this.innerHTML = html`
	<header>
		<div class="header-content">
			${showMobileMenu ? html`
			<button class="hamburger-button ${this.mobileMenuOpen ? 'active' : ''}" data-mobile-menu-toggle
				aria-label="Open menu" aria-controls="mobile-menu"
				aria-expanded="${this.mobileMenuOpen ? 'true' : 'false'}">
				<span></span>
				<span></span>
				<span></span>
			</button>
			` : ''}
			<div class="header-logo">
				<a href="/" style="text-decoration: none; display: block;">
					<!-- 
				<svg class="logo" width="200" height="40" viewBox="0 0 185 40">
	                <text x="2" y="27" class="logo-text">
	                  <tspan opacity="1">par</tspan><tspan opacity="0.7">asc</tspan><tspan opacity="1">ene</tspan>
	                </text>
	              </svg>
			  		-->
					<svg class="logo" width="120" height="40" viewBox="0 0 185 40">
						<g class="logo-text">
							<path style="opacity: 1;"
								d="M 4.201 36.305 L 8.683 9.305 L 13.869 9.305 L 13.271 12.609 L 13.429 12.609 Q 13.922 11.801 14.721 10.975 Q 15.521 10.148 16.699 9.603 Q 17.877 9.059 19.459 9.059 Q 21.41 9.059 22.93 9.929 Q 24.451 10.799 25.339 12.53 Q 26.226 14.262 26.226 16.828 Q 26.226 18.937 25.637 21.126 Q 25.048 23.314 23.862 25.16 Q 22.675 27.006 20.882 28.148 Q 19.089 29.291 16.664 29.291 Q 14.994 29.291 13.93 28.711 Q 12.867 28.131 12.287 27.287 Q 11.707 26.443 11.461 25.652 L 11.214 25.652 L 9.474 36.305 Z M 15.17 25.055 Q 16.629 25.055 17.701 24.281 Q 18.773 23.508 19.476 22.295 Q 20.179 21.082 20.513 19.711 Q 20.847 18.34 20.847 17.127 Q 20.847 15.369 20.074 14.323 Q 19.3 13.277 17.683 13.277 Q 16.277 13.277 15.214 13.989 Q 14.15 14.701 13.438 15.87 Q 12.726 17.039 12.357 18.419 Q 11.988 19.799 11.988 21.152 Q 11.988 22.963 12.797 24.009 Q 13.605 25.055 15.17 25.055 Z M 34.036 29.291 Q 31.786 29.291 30.16 28.113 Q 28.534 26.936 27.848 24.677 Q 27.163 22.418 27.708 19.148 Q 28.27 15.791 29.729 13.55 Q 31.188 11.309 33.192 10.184 Q 35.196 9.059 37.376 9.059 Q 39.046 9.059 40.056 9.612 Q 41.067 10.166 41.612 10.992 Q 42.157 11.818 42.386 12.609 L 42.561 12.609 L 43.106 9.305 L 48.362 9.305 L 45.11 28.957 L 39.925 28.957 L 40.434 25.811 L 40.188 25.811 Q 39.678 26.619 38.852 27.419 Q 38.026 28.219 36.831 28.755 Q 35.636 29.291 34.036 29.291 Z M 36.374 25.055 Q 37.727 25.055 38.791 24.308 Q 39.854 23.561 40.575 22.233 Q 41.296 20.906 41.577 19.148 Q 41.876 17.355 41.603 16.037 Q 41.331 14.719 40.505 13.998 Q 39.678 13.277 38.325 13.277 Q 36.936 13.277 35.864 14.033 Q 34.792 14.789 34.097 16.107 Q 33.403 17.426 33.122 19.148 Q 32.841 20.871 33.104 22.207 Q 33.368 23.543 34.185 24.299 Q 35.003 25.055 36.374 25.055 Z M 48.344 28.957 L 51.596 9.305 L 56.694 9.305 L 56.149 12.732 L 56.36 12.732 Q 57.186 10.904 58.61 9.973 Q 60.034 9.041 61.686 9.041 Q 62.108 9.041 62.565 9.085 Q 63.022 9.129 63.373 9.217 L 62.582 13.928 Q 62.231 13.805 61.572 13.734 Q 60.913 13.664 60.35 13.664 Q 59.137 13.664 58.1 14.183 Q 57.063 14.701 56.369 15.624 Q 55.674 16.547 55.463 17.777 L 53.618 28.957 Z">
							</path>
							<path style="opacity: 0.7;"
								d="M 68.879 29.291 Q 66.629 29.291 65.003 28.113 Q 63.377 26.936 62.691 24.677 Q 62.006 22.418 62.551 19.148 Q 63.113 15.791 64.572 13.55 Q 66.031 11.309 68.035 10.184 Q 70.039 9.059 72.219 9.059 Q 73.888 9.059 74.899 9.612 Q 75.91 10.166 76.455 10.992 Q 77 11.818 77.228 12.609 L 77.404 12.609 L 77.949 9.305 L 83.205 9.305 L 79.953 28.957 L 74.767 28.957 L 75.277 25.811 L 75.031 25.811 Q 74.521 26.619 73.695 27.419 Q 72.869 28.219 71.674 28.755 Q 70.478 29.291 68.879 29.291 Z M 71.217 25.055 Q 72.57 25.055 73.634 24.308 Q 74.697 23.561 75.418 22.233 Q 76.138 20.906 76.42 19.148 Q 76.719 17.355 76.446 16.037 Q 76.174 14.719 75.347 13.998 Q 74.521 13.277 73.168 13.277 Q 71.779 13.277 70.707 14.033 Q 69.635 14.789 68.94 16.107 Q 68.246 17.426 67.965 19.148 Q 67.683 20.871 67.947 22.207 Q 68.211 23.543 69.028 24.299 Q 69.845 25.055 71.217 25.055 Z M 91.165 29.344 Q 88.792 29.344 87.035 28.649 Q 85.277 27.955 84.301 26.689 Q 83.326 25.424 83.22 23.684 Q 83.22 23.596 83.211 23.534 Q 83.203 23.473 83.203 23.42 L 88.142 22.91 Q 88.283 24.281 89.047 24.879 Q 89.812 25.477 91.412 25.477 Q 92.378 25.477 93.24 25.213 Q 94.101 24.949 94.672 24.448 Q 95.244 23.947 95.314 23.227 Q 95.367 22.559 94.883 22.102 Q 94.4 21.645 93.222 21.398 L 89.953 20.695 Q 87.386 20.15 86.156 18.77 Q 84.925 17.391 85.083 15.369 Q 85.207 13.33 86.455 11.924 Q 87.703 10.518 89.698 9.788 Q 91.693 9.059 94.048 9.059 Q 97.511 9.059 99.401 10.447 Q 101.29 11.836 101.537 14.086 Q 101.572 14.191 101.589 14.279 Q 101.607 14.367 101.607 14.473 L 96.914 14.947 Q 96.773 13.945 96.123 13.392 Q 95.472 12.838 94.066 12.838 Q 93.205 12.838 92.378 13.102 Q 91.552 13.365 90.99 13.857 Q 90.427 14.35 90.357 15.088 Q 90.287 15.756 90.744 16.195 Q 91.201 16.635 92.431 16.916 L 95.841 17.619 Q 98.425 18.146 99.665 19.43 Q 100.904 20.713 100.746 22.699 Q 100.64 24.264 99.84 25.494 Q 99.04 26.725 97.705 27.586 Q 96.369 28.447 94.69 28.895 Q 93.011 29.344 91.165 29.344 Z M 110.891 29.344 Q 108.272 29.344 106.409 28.315 Q 104.546 27.287 103.544 25.433 Q 102.542 23.578 102.542 21.082 Q 102.542 18.814 103.263 16.661 Q 103.983 14.508 105.389 12.794 Q 106.796 11.08 108.87 10.069 Q 110.944 9.059 113.669 9.059 Q 115.444 9.059 116.886 9.516 Q 118.327 9.973 119.373 10.834 Q 120.419 11.695 120.99 12.908 Q 121.561 14.121 121.597 15.633 L 116.587 16.477 Q 116.534 15.703 116.349 15.105 Q 116.165 14.508 115.805 14.077 Q 115.444 13.646 114.908 13.427 Q 114.372 13.207 113.616 13.207 Q 112.139 13.207 111.041 13.963 Q 109.942 14.719 109.239 15.932 Q 108.536 17.145 108.193 18.551 Q 107.85 19.957 107.85 21.24 Q 107.85 22.418 108.184 23.314 Q 108.518 24.211 109.23 24.703 Q 109.942 25.195 111.05 25.195 Q 111.841 25.195 112.561 24.949 Q 113.282 24.703 113.889 24.246 Q 114.495 23.789 114.97 23.147 Q 115.444 22.506 115.725 21.715 L 120.489 22.699 Q 119.962 24.246 119.056 25.468 Q 118.151 26.689 116.921 27.56 Q 115.69 28.43 114.17 28.887 Q 112.649 29.344 110.891 29.344 Z">
							</path>
							<path style="opacity: 1;"
								d="M 130.92 29.379 Q 128.301 29.379 126.403 28.421 Q 124.504 27.463 123.485 25.67 Q 122.465 23.877 122.465 21.363 Q 122.465 18.885 123.283 16.644 Q 124.1 14.402 125.612 12.68 Q 127.123 10.957 129.198 9.964 Q 131.272 8.971 133.768 8.971 Q 135.842 8.971 137.486 9.665 Q 139.129 10.359 140.078 11.634 Q 141.028 12.908 141.028 14.701 Q 141.028 16.529 139.955 17.716 Q 138.883 18.902 136.791 19.561 Q 134.7 20.221 131.641 20.484 Q 128.582 20.748 124.61 20.748 L 125.155 17.566 Q 128.512 17.566 130.665 17.452 Q 132.819 17.338 134.005 17.039 Q 135.192 16.74 135.658 16.239 Q 136.123 15.738 136.123 14.965 Q 136.123 14.033 135.341 13.488 Q 134.559 12.943 133.223 12.943 Q 131.5 12.943 130.393 13.84 Q 129.286 14.736 128.67 16.09 Q 128.055 17.443 127.8 18.894 Q 127.545 20.344 127.545 21.451 Q 127.545 22.576 127.888 23.473 Q 128.231 24.369 129.057 24.888 Q 129.883 25.406 131.307 25.406 Q 132.801 25.406 133.953 24.782 Q 135.104 24.158 135.614 23.051 L 140.342 23.684 Q 139.375 26.25 136.879 27.814 Q 134.383 29.379 130.92 29.379 Z M 149.071 17.742 L 147.208 28.957 L 141.934 28.957 L 145.204 9.305 L 150.161 9.305 L 149.475 14.209 L 149.106 14.033 Q 150.266 11.607 151.989 10.333 Q 153.712 9.059 156.102 9.059 Q 158.212 9.059 159.653 9.99 Q 161.094 10.922 161.692 12.627 Q 162.29 14.332 161.903 16.635 L 159.864 28.957 L 154.59 28.957 L 156.542 17.197 Q 156.858 15.352 156.067 14.411 Q 155.276 13.471 153.712 13.471 Q 152.534 13.471 151.558 13.998 Q 150.583 14.525 149.932 15.483 Q 149.282 16.441 149.071 17.742 Z M 172.076 29.379 Q 169.457 29.379 167.558 28.421 Q 165.66 27.463 164.64 25.67 Q 163.621 23.877 163.621 21.363 Q 163.621 18.885 164.438 16.644 Q 165.256 14.402 166.767 12.68 Q 168.279 10.957 170.353 9.964 Q 172.428 8.971 174.924 8.971 Q 176.998 8.971 178.641 9.665 Q 180.285 10.359 181.234 11.634 Q 182.183 12.908 182.183 14.701 Q 182.183 16.529 181.111 17.716 Q 180.039 18.902 177.947 19.561 Q 175.855 20.221 172.797 20.484 Q 169.738 20.748 165.765 20.748 L 166.31 17.566 Q 169.668 17.566 171.821 17.452 Q 173.974 17.338 175.161 17.039 Q 176.347 16.74 176.813 16.239 Q 177.279 15.738 177.279 14.965 Q 177.279 14.033 176.497 13.488 Q 175.715 12.943 174.379 12.943 Q 172.656 12.943 171.549 13.84 Q 170.441 14.736 169.826 16.09 Q 169.211 17.443 168.956 18.894 Q 168.701 20.344 168.701 21.451 Q 168.701 22.576 169.044 23.473 Q 169.387 24.369 170.213 24.888 Q 171.039 25.406 172.463 25.406 Q 173.957 25.406 175.108 24.782 Q 176.26 24.158 176.769 23.051 L 181.498 23.684 Q 180.531 26.25 178.035 27.814 Q 175.539 29.379 172.076 29.379 Z">
							</path>
						</g>
					</svg>
	
				</a>
			</div>
			<nav class="header-nav">
				${(this.routes || []).map(route => {
				const routeId = route.id;
				const routeLabel = route.label;
				// Generate clean URL path (e.g., /feed, /explore)
				return html`<a href="/${routeId}" class="nav-link" data-route="${routeId}">${routeLabel}</a>`;
				}).join('')}
			</nav>
			${showCreate ? html`
			<a href="/create" class="action-item create-button btn-primary">
				Create
			</a>
			` : ''}
			<div class="header-actions">
				${hasAuthLinks ? (this.authLinks || []).map(authLink =>
				html`<a href="${authLink.href}"
					class="header-auth-link ${authLink.isPrimary ? 'btn-primary' : ''}">${authLink.text}</a>`
				).join('') : ''}
				${showNotifications ? html`
				<div class="notifications-wrapper">
					<button class="action-item notifications-button" aria-label="Open notifications">
						${notifyIcon('icon')}
						<span class="notifications-badge"></span>
					</button>
					<div class="notifications-menu">
						<div class="notifications-preview"></div>
						<div class="notifications-menu-divider"></div>
						<a href="#" data-action="notifications" class="notifications-menu-item">View All</a>
					</div>
				</div>
				` : ''}
				${showCredits ? html`
				<button class="action-item credits-button" aria-label="Credits balance">
					${creditIcon('icon')}
					<span class="credits-count">${this.creditsCount}</span>
					<span class="credits-badge" aria-hidden="true"></span>
				</button>
				` : ''}
				${showProfile ? html`
				<button
					class="action-item profile-button ${this.avatarUrl ? 'has-avatar' : ''} ${this.avatarLoading && !this.avatarUrl ? 'is-avatar-loading' : ''}"
					aria-label="Open profile">
					<img class="profile-avatar" ${this.avatarUrl ? `src="${this.avatarUrl}" ` : '' } alt=""
						aria-hidden="true" />
					<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
						stroke-linecap="round" stroke-linejoin="round">
						<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
						<circle cx="12" cy="7" r="4"></circle>
					</svg>
				</button>
				` : ''}
			</div>
		</div>
	</header>
	${showMobileMenu ? html`
	<div class="mobile-menu-backdrop ${this.mobileMenuOpen ? 'open' : ''}" data-mobile-menu-backdrop></div>
	<aside id="mobile-menu" class="mobile-menu ${this.mobileMenuOpen ? 'open' : ''}"
		aria-hidden="${this.mobileMenuOpen ? 'false' : 'true'}">
		<div class="mobile-menu-header">
			<div class="header-logo">
				<a href="/" style="text-decoration: none; display: block;">
					<!-- 
					<svg class="logo" width="200" height="40" viewBox="0 0 185 40">
						<text x="2" y="27" class="logo-text">
						<tspan opacity="1">par</tspan><tspan opacity="0.7">asc</tspan><tspan opacity="1">ene</tspan>
						</text>
					</svg>
						-->
					<svg class="logo" width="120" height="40" viewBox="0 0 185 40">
						<g class="logo-text">
							<path style="opacity: 1;"
								d="M 4.201 36.305 L 8.683 9.305 L 13.869 9.305 L 13.271 12.609 L 13.429 12.609 Q 13.922 11.801 14.721 10.975 Q 15.521 10.148 16.699 9.603 Q 17.877 9.059 19.459 9.059 Q 21.41 9.059 22.93 9.929 Q 24.451 10.799 25.339 12.53 Q 26.226 14.262 26.226 16.828 Q 26.226 18.937 25.637 21.126 Q 25.048 23.314 23.862 25.16 Q 22.675 27.006 20.882 28.148 Q 19.089 29.291 16.664 29.291 Q 14.994 29.291 13.93 28.711 Q 12.867 28.131 12.287 27.287 Q 11.707 26.443 11.461 25.652 L 11.214 25.652 L 9.474 36.305 Z M 15.17 25.055 Q 16.629 25.055 17.701 24.281 Q 18.773 23.508 19.476 22.295 Q 20.179 21.082 20.513 19.711 Q 20.847 18.34 20.847 17.127 Q 20.847 15.369 20.074 14.323 Q 19.3 13.277 17.683 13.277 Q 16.277 13.277 15.214 13.989 Q 14.15 14.701 13.438 15.87 Q 12.726 17.039 12.357 18.419 Q 11.988 19.799 11.988 21.152 Q 11.988 22.963 12.797 24.009 Q 13.605 25.055 15.17 25.055 Z M 34.036 29.291 Q 31.786 29.291 30.16 28.113 Q 28.534 26.936 27.848 24.677 Q 27.163 22.418 27.708 19.148 Q 28.27 15.791 29.729 13.55 Q 31.188 11.309 33.192 10.184 Q 35.196 9.059 37.376 9.059 Q 39.046 9.059 40.056 9.612 Q 41.067 10.166 41.612 10.992 Q 42.157 11.818 42.386 12.609 L 42.561 12.609 L 43.106 9.305 L 48.362 9.305 L 45.11 28.957 L 39.925 28.957 L 40.434 25.811 L 40.188 25.811 Q 39.678 26.619 38.852 27.419 Q 38.026 28.219 36.831 28.755 Q 35.636 29.291 34.036 29.291 Z M 36.374 25.055 Q 37.727 25.055 38.791 24.308 Q 39.854 23.561 40.575 22.233 Q 41.296 20.906 41.577 19.148 Q 41.876 17.355 41.603 16.037 Q 41.331 14.719 40.505 13.998 Q 39.678 13.277 38.325 13.277 Q 36.936 13.277 35.864 14.033 Q 34.792 14.789 34.097 16.107 Q 33.403 17.426 33.122 19.148 Q 32.841 20.871 33.104 22.207 Q 33.368 23.543 34.185 24.299 Q 35.003 25.055 36.374 25.055 Z M 48.344 28.957 L 51.596 9.305 L 56.694 9.305 L 56.149 12.732 L 56.36 12.732 Q 57.186 10.904 58.61 9.973 Q 60.034 9.041 61.686 9.041 Q 62.108 9.041 62.565 9.085 Q 63.022 9.129 63.373 9.217 L 62.582 13.928 Q 62.231 13.805 61.572 13.734 Q 60.913 13.664 60.35 13.664 Q 59.137 13.664 58.1 14.183 Q 57.063 14.701 56.369 15.624 Q 55.674 16.547 55.463 17.777 L 53.618 28.957 Z">
							</path>
							<path style="opacity: 0.7;"
								d="M 68.879 29.291 Q 66.629 29.291 65.003 28.113 Q 63.377 26.936 62.691 24.677 Q 62.006 22.418 62.551 19.148 Q 63.113 15.791 64.572 13.55 Q 66.031 11.309 68.035 10.184 Q 70.039 9.059 72.219 9.059 Q 73.888 9.059 74.899 9.612 Q 75.91 10.166 76.455 10.992 Q 77 11.818 77.228 12.609 L 77.404 12.609 L 77.949 9.305 L 83.205 9.305 L 79.953 28.957 L 74.767 28.957 L 75.277 25.811 L 75.031 25.811 Q 74.521 26.619 73.695 27.419 Q 72.869 28.219 71.674 28.755 Q 70.478 29.291 68.879 29.291 Z M 71.217 25.055 Q 72.57 25.055 73.634 24.308 Q 74.697 23.561 75.418 22.233 Q 76.138 20.906 76.42 19.148 Q 76.719 17.355 76.446 16.037 Q 76.174 14.719 75.347 13.998 Q 74.521 13.277 73.168 13.277 Q 71.779 13.277 70.707 14.033 Q 69.635 14.789 68.94 16.107 Q 68.246 17.426 67.965 19.148 Q 67.683 20.871 67.947 22.207 Q 68.211 23.543 69.028 24.299 Q 69.845 25.055 71.217 25.055 Z M 91.165 29.344 Q 88.792 29.344 87.035 28.649 Q 85.277 27.955 84.301 26.689 Q 83.326 25.424 83.22 23.684 Q 83.22 23.596 83.211 23.534 Q 83.203 23.473 83.203 23.42 L 88.142 22.91 Q 88.283 24.281 89.047 24.879 Q 89.812 25.477 91.412 25.477 Q 92.378 25.477 93.24 25.213 Q 94.101 24.949 94.672 24.448 Q 95.244 23.947 95.314 23.227 Q 95.367 22.559 94.883 22.102 Q 94.4 21.645 93.222 21.398 L 89.953 20.695 Q 87.386 20.15 86.156 18.77 Q 84.925 17.391 85.083 15.369 Q 85.207 13.33 86.455 11.924 Q 87.703 10.518 89.698 9.788 Q 91.693 9.059 94.048 9.059 Q 97.511 9.059 99.401 10.447 Q 101.29 11.836 101.537 14.086 Q 101.572 14.191 101.589 14.279 Q 101.607 14.367 101.607 14.473 L 96.914 14.947 Q 96.773 13.945 96.123 13.392 Q 95.472 12.838 94.066 12.838 Q 93.205 12.838 92.378 13.102 Q 91.552 13.365 90.99 13.857 Q 90.427 14.35 90.357 15.088 Q 90.287 15.756 90.744 16.195 Q 91.201 16.635 92.431 16.916 L 95.841 17.619 Q 98.425 18.146 99.665 19.43 Q 100.904 20.713 100.746 22.699 Q 100.64 24.264 99.84 25.494 Q 99.04 26.725 97.705 27.586 Q 96.369 28.447 94.69 28.895 Q 93.011 29.344 91.165 29.344 Z M 110.891 29.344 Q 108.272 29.344 106.409 28.315 Q 104.546 27.287 103.544 25.433 Q 102.542 23.578 102.542 21.082 Q 102.542 18.814 103.263 16.661 Q 103.983 14.508 105.389 12.794 Q 106.796 11.08 108.87 10.069 Q 110.944 9.059 113.669 9.059 Q 115.444 9.059 116.886 9.516 Q 118.327 9.973 119.373 10.834 Q 120.419 11.695 120.99 12.908 Q 121.561 14.121 121.597 15.633 L 116.587 16.477 Q 116.534 15.703 116.349 15.105 Q 116.165 14.508 115.805 14.077 Q 115.444 13.646 114.908 13.427 Q 114.372 13.207 113.616 13.207 Q 112.139 13.207 111.041 13.963 Q 109.942 14.719 109.239 15.932 Q 108.536 17.145 108.193 18.551 Q 107.85 19.957 107.85 21.24 Q 107.85 22.418 108.184 23.314 Q 108.518 24.211 109.23 24.703 Q 109.942 25.195 111.05 25.195 Q 111.841 25.195 112.561 24.949 Q 113.282 24.703 113.889 24.246 Q 114.495 23.789 114.97 23.147 Q 115.444 22.506 115.725 21.715 L 120.489 22.699 Q 119.962 24.246 119.056 25.468 Q 118.151 26.689 116.921 27.56 Q 115.69 28.43 114.17 28.887 Q 112.649 29.344 110.891 29.344 Z">
							</path>
							<path style="opacity: 1;"
								d="M 130.92 29.379 Q 128.301 29.379 126.403 28.421 Q 124.504 27.463 123.485 25.67 Q 122.465 23.877 122.465 21.363 Q 122.465 18.885 123.283 16.644 Q 124.1 14.402 125.612 12.68 Q 127.123 10.957 129.198 9.964 Q 131.272 8.971 133.768 8.971 Q 135.842 8.971 137.486 9.665 Q 139.129 10.359 140.078 11.634 Q 141.028 12.908 141.028 14.701 Q 141.028 16.529 139.955 17.716 Q 138.883 18.902 136.791 19.561 Q 134.7 20.221 131.641 20.484 Q 128.582 20.748 124.61 20.748 L 125.155 17.566 Q 128.512 17.566 130.665 17.452 Q 132.819 17.338 134.005 17.039 Q 135.192 16.74 135.658 16.239 Q 136.123 15.738 136.123 14.965 Q 136.123 14.033 135.341 13.488 Q 134.559 12.943 133.223 12.943 Q 131.5 12.943 130.393 13.84 Q 129.286 14.736 128.67 16.09 Q 128.055 17.443 127.8 18.894 Q 127.545 20.344 127.545 21.451 Q 127.545 22.576 127.888 23.473 Q 128.231 24.369 129.057 24.888 Q 129.883 25.406 131.307 25.406 Q 132.801 25.406 133.953 24.782 Q 135.104 24.158 135.614 23.051 L 140.342 23.684 Q 139.375 26.25 136.879 27.814 Q 134.383 29.379 130.92 29.379 Z M 149.071 17.742 L 147.208 28.957 L 141.934 28.957 L 145.204 9.305 L 150.161 9.305 L 149.475 14.209 L 149.106 14.033 Q 150.266 11.607 151.989 10.333 Q 153.712 9.059 156.102 9.059 Q 158.212 9.059 159.653 9.99 Q 161.094 10.922 161.692 12.627 Q 162.29 14.332 161.903 16.635 L 159.864 28.957 L 154.59 28.957 L 156.542 17.197 Q 156.858 15.352 156.067 14.411 Q 155.276 13.471 153.712 13.471 Q 152.534 13.471 151.558 13.998 Q 150.583 14.525 149.932 15.483 Q 149.282 16.441 149.071 17.742 Z M 172.076 29.379 Q 169.457 29.379 167.558 28.421 Q 165.66 27.463 164.64 25.67 Q 163.621 23.877 163.621 21.363 Q 163.621 18.885 164.438 16.644 Q 165.256 14.402 166.767 12.68 Q 168.279 10.957 170.353 9.964 Q 172.428 8.971 174.924 8.971 Q 176.998 8.971 178.641 9.665 Q 180.285 10.359 181.234 11.634 Q 182.183 12.908 182.183 14.701 Q 182.183 16.529 181.111 17.716 Q 180.039 18.902 177.947 19.561 Q 175.855 20.221 172.797 20.484 Q 169.738 20.748 165.765 20.748 L 166.31 17.566 Q 169.668 17.566 171.821 17.452 Q 173.974 17.338 175.161 17.039 Q 176.347 16.74 176.813 16.239 Q 177.279 15.738 177.279 14.965 Q 177.279 14.033 176.497 13.488 Q 175.715 12.943 174.379 12.943 Q 172.656 12.943 171.549 13.84 Q 170.441 14.736 169.826 16.09 Q 169.211 17.443 168.956 18.894 Q 168.701 20.344 168.701 21.451 Q 168.701 22.576 169.044 23.473 Q 169.387 24.369 170.213 24.888 Q 171.039 25.406 172.463 25.406 Q 173.957 25.406 175.108 24.782 Q 176.26 24.158 176.769 23.051 L 181.498 23.684 Q 180.531 26.25 178.035 27.814 Q 175.539 29.379 172.076 29.379 Z">
							</path>
						</g>
					</svg>
				</a>
			</div>
			<button class="mobile-menu-close" data-mobile-menu-close aria-label="Close menu">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
					stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</div>
		<div class="mobile-menu-content">
			<nav class="mobile-menu-nav">
				${(this.routes || []).map(route => {
				const routeId = route.id;
				const routeLabel = route.label;
				return html`<a href="/${routeId}" class="nav-link" data-route="${routeId}">${routeLabel}</a>`;
				}).join('')}
				<a href="/help" class="mobile-menu-help">Help</a>
			</nav>
			${hasMobileActions ? html`
			<div class="mobile-menu-actions">
				${showCreate ? html`
				<a href="/create" class="create-button btn-primary">
					Create
				</a>
				` : ''}
				${showNotifications ? html`
				<button class="action-item" data-mobile-menu-action="notifications">
					Notifications
				</button>
				` : ''}
				${showCredits ? html`
				<button class="action-item" data-mobile-menu-action="credits">
					Credits
				</button>
				` : ''}
				${showProfile ? html`
				<button class="action-item" data-mobile-menu-action="profile">
					Profile
				</button>
				` : ''}
			</div>
			` : ''}
		</div>
	</aside>
	` : ''}
    `;
	}
}

customElements.define('app-navigation', AppNavigation);
