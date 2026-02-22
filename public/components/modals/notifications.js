import { formatDateTime, formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { closeModalsAndNavigate } from '../../shared/navigation.js';

const html = String.raw;

class AppModalNotifications extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._isOpen = false;
		this._isLoading = false;
		this._lastLoadedAt = 0;
		this.notifications = [];
		this.activeIndex = 0;
		this.pendingNotificationId = null;
		this.viewMode = 'list';
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenEvent = this.handleOpenEvent.bind(this);
		this.handleCloseEvent = this.handleCloseEvent.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
		this.prefetchNotifications();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this.handleEscape);
		document.removeEventListener('open-notifications', this.handleOpenEvent);
		document.removeEventListener('close-notifications', this.handleCloseEvent);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('open-notifications', this.handleOpenEvent);
		document.addEventListener('close-notifications', this.handleCloseEvent);
		document.addEventListener('notifications-acknowledged', () => {
			// Reload notifications when one is acknowledged
			this.loadNotifications({ silent: true, force: true });
		});

		const overlays = this.shadowRoot.querySelectorAll(
			'.notifications-overlay, .notification-detail-overlay'
		);
		const closeButtons = this.shadowRoot.querySelectorAll('.notifications-close');

		overlays.forEach((overlay) => {
			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) {
					this.close();
				}
			});
		});

		closeButtons.forEach((button) => {
			button.addEventListener('click', () => {
				this.close();
			});
		});

		const markAllReadBtn = this.shadowRoot.querySelector('[data-action="mark-all-read"]');
		if (markAllReadBtn) {
			markAllReadBtn.addEventListener('click', () => this.handleMarkAllRead());
		}
	}

	handleOpenEvent(event) {
		const notificationId = event?.detail?.notificationId ?? null;
		if (notificationId) {
			this.openDetail(notificationId);
		} else {
			this.openList();
		}
	}

	handleCloseEvent() {
		this.close();
	}

	handleCloseAllModals() {
		this.close();
	}

	handleEscape(e) {
		if (e.key === 'Escape' && this.isOpen()) {
			this.close();
		}
	}

	isOpen() {
		return this._isOpen;
	}

	openList() {
		this.viewMode = 'list';
		this.pendingNotificationId = null;
		this.openModal('.notifications-overlay');
		if (this.notifications.length) {
			this.renderNotificationList();
		}
		this.loadNotifications({ silent: true });
		document.dispatchEvent(new CustomEvent('close-profile'));
	}

	openDetail(notificationId) {
		this.viewMode = 'detail';
		this.pendingNotificationId = notificationId;
		this.openModal('.notification-detail-overlay');
		if (this.notifications.length) {
			this.selectActiveNotification();
			this.renderNotificationDetail();
		}
		this.loadNotifications({ silent: true });
		document.dispatchEvent(new CustomEvent('close-profile'));
	}

	openModal(selector) {
		const overlays = this.shadowRoot.querySelectorAll(
			'.notifications-overlay, .notification-detail-overlay'
		);
		overlays.forEach((overlay) => overlay.classList.remove('open'));
		this._isOpen = true;
		const overlay = this.shadowRoot.querySelector(selector);
		if (overlay) {
			overlay.classList.add('open');
		}
		document.dispatchEvent(new CustomEvent('modal-opened'));
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlays = this.shadowRoot.querySelectorAll(
			'.notifications-overlay, .notification-detail-overlay'
		);
		overlays.forEach((overlay) => overlay.classList.remove('open'));
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}

	async loadNotifications({ silent = false, force = false } = {}) {
		if (this._isLoading) return;
		const now = Date.now();
		if (!force && now - this._lastLoadedAt < 30000) {
			return;
		}

		const listContent = this.shadowRoot.querySelector('.notifications-content');
		const detailContent = this.shadowRoot.querySelector('.notification-detail-content');
		const content = this.viewMode === 'detail' ? detailContent : listContent;
		if (!content) return;

		if (!silent && !this.notifications.length) {
			content.innerHTML = html`<p>Loading...</p>`;
		}

		this._isLoading = true;
		try {
			const result = await fetchJsonWithStatusDeduped('/api/notifications', {
				credentials: 'include'
			}, { windowMs: 2000 });
			if (!result.ok) {
				throw new Error('Failed to load notifications');
			}
			this.notifications = Array.isArray(result.data?.notifications)
				? result.data.notifications
				: [];
			this._lastLoadedAt = Date.now();
			this.selectActiveNotification();
			this.renderNotificationList();
			this.renderNotificationDetail({
				acknowledge: this.isOpen() && this.viewMode === 'detail'
			});
		} catch (error) {
			// console.error('Error loading notifications:', error);
			if (content) {
				content.innerHTML = html`<p style="color: var(--text-muted);">Failed to load notifications.</p>`;
			}
		} finally {
			this._isLoading = false;
		}
	}

	async acknowledgeNotification(id) {
		try {
			const response = await fetch('/api/notifications/acknowledge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ id: String(id) }),
				credentials: 'include'
			});
			if (!response.ok) {
				throw new Error('Failed to acknowledge notification');
			}
			const data = await response.json();
			if (data.updated) {
				// Update local notification state
				const notification = this.notifications.find(n => n.id === id);
				if (notification) {
					notification.acknowledged_at = new Date().toISOString();
				}
				// Reload notifications to get fresh data from server
				await this.loadNotifications({ silent: true, force: true });
				// Dispatch event for other components (like header count)
				document.dispatchEvent(new CustomEvent('notifications-acknowledged'));
			}
		} catch (error) {
			// console.error('Error acknowledging notification:', error);
		}
	}

	async handleMarkAllRead() {
		try {
			const response = await fetch('/api/notifications/acknowledge-all', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
				credentials: 'include'
			});
			if (!response.ok) throw new Error('Failed to mark all as read');
			const data = await response.json();
			if (data.ok && data.updated) {
				this.notifications.forEach((n) => {
					if (!n.acknowledged_at) n.acknowledged_at = new Date().toISOString();
				});
				this.renderNotificationList();
				document.dispatchEvent(new CustomEvent('notifications-acknowledged'));
			}
			await this.loadNotifications({ silent: true, force: true });
		} catch (error) {
			// console.error('Error marking all notifications read:', error);
		}
	}

	selectActiveNotification() {
		if (!this.notifications.length) {
			this.activeIndex = 0;
			return;
		}

		if (this.pendingNotificationId) {
			const index = this.notifications.findIndex(
				(notification) => notification.id === this.pendingNotificationId
			);
			this.activeIndex = index >= 0 ? index : 0;
		} else if (this.activeIndex >= this.notifications.length) {
			this.activeIndex = 0;
		}
	}

	renderNotificationList() {
		const content = this.shadowRoot.querySelector('.notifications-content');
		if (!content) return;

		if (!this.notifications.length) {
			content.innerHTML = html`<p style="color: var(--text-muted);">No notifications.</p>`;
			return;
		}

		const escapeHtml = (text) => {
			const div = document.createElement('div');
			div.textContent = text ?? '';
			return div.innerHTML;
		};

		content.innerHTML = this.notifications.map((notification) => {
			const time = formatRelativeTime(notification.created_at);
			const timeTitle = formatDateTime(notification.created_at);
			return html`
	<button class="notification-list-item ${notification.acknowledged_at ? 'is-read' : 'is-unread'}"
		data-id="${notification.id}">
		<div class="notification-list-title">${escapeHtml(notification.title || 'Notification')}</div>
		<div class="notification-list-message">${escapeHtml(notification.message || '')}</div>
		<div class="notification-list-time" title="${escapeHtml(timeTitle)}">${escapeHtml(time)}</div>
		<span class="notification-list-item-spinner" aria-hidden="true"></span>
	</button>
    `}).join('');

		content.querySelectorAll('.notification-list-item').forEach((item) => {
			item.addEventListener('click', async () => {
				const id = Number(item.getAttribute('data-id'));
				const notification = id ? this.notifications.find((n) => n.id === id) : null;
				const goDirect = notification &&
					(notification.type === 'comment' || notification.type === 'comment_thread' || notification.type === 'tip' || notification.type === 'creation_activity') &&
					typeof notification.link === 'string' && notification.link.trim();
				if (goDirect) {
					item.classList.add('is-loading');
					item.setAttribute('aria-busy', 'true');
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
					closeModalsAndNavigate(notification.link.trim());
				} else if (id) {
					this.openDetail(id);
				}
			});
		});

		const footer = this.shadowRoot.querySelector('[data-mark-all-read-footer]');
		const markAllReadBtn = this.shadowRoot.querySelector('[data-action="mark-all-read"]');
		if (footer && markAllReadBtn) {
			const hasUnread = this.notifications.some((n) => !n.acknowledged_at);
			footer.style.display = this.notifications.length > 0 ? 'block' : 'none';
			markAllReadBtn.disabled = !hasUnread;
		}
	}

	renderNotificationDetail({ acknowledge = true } = {}) {
		const content = this.shadowRoot.querySelector('.notification-detail-content');
		if (!content) return;

		if (!this.notifications.length) {
			content.innerHTML = html`<p style="color: var(--text-muted);">No notifications.</p>`;
			return;
		}

		const escapeHtml = (text) => {
			const div = document.createElement('div');
			div.textContent = text ?? '';
			return div.innerHTML;
		};

		const notification = this.notifications[this.activeIndex];

		if (acknowledge && !notification.acknowledged_at) {
			this.acknowledgeNotification(notification.id);
			notification.acknowledged_at = new Date().toISOString();
		}

		const time = formatRelativeTime(notification.created_at);
		const timeTitle = formatDateTime(notification.created_at);

		content.innerHTML = html`
	<div class="notification-detail">
		<div class="notification-detail-header">
			<div class="notification-title">${escapeHtml(notification.title || 'Notification')}</div>
		</div>
		<div class="notification-message">${escapeHtml(notification.message || '')}</div>
		<div class="notification-time" title="${escapeHtml(timeTitle)}">${escapeHtml(time)}</div>
		<div class="notification-actions">
			<button class="notification-action" type="button">View all notifications</button>
			${notification.link ? html`
			<a class="notification-action is-primary" href="${escapeHtml(notification.link)}">Open related page</a>
			` : ''}
		</div>
	</div>
    `;

		const viewAllButton = this.shadowRoot.querySelector('.notification-actions .notification-action:not(.is-primary)');
		if (viewAllButton) {
			viewAllButton.addEventListener('click', () => {
				this.close();
				this.openList();
			});
		}
	}

	render() {
		this.shadowRoot.innerHTML = html`
      <style>
        :host {
          display: block;
        }
        .notifications-overlay,
        .notification-detail-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99999;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.2s, visibility 0.2s;
        }
        .notifications-overlay.open,
        .notification-detail-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .notifications-modal,
        .notification-detail-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: var(--shadow);
          width: 520px;
          max-width: 92vw;
          max-height: 90vh;
          overflow: hidden;
          transform: scale(0.95);
          transition: transform 0.2s;
        }
        .notification-detail-modal {
          height: auto;
        }
        .notifications-modal {
          width: 760px;
          height: 560px;
          display: flex;
          flex-direction: column;
        }
        .notifications-overlay.open .notifications-modal,
        .notification-detail-overlay.open .notification-detail-modal {
          transform: scale(1);
        }
        .notifications-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
        }
        .notifications-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }
        .notifications-close {
          background: transparent;
          border: none;
          color: var(--text);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: background-color 0.2s;
        }
        .notifications-close:hover {
          background: var(--surface-strong);
        }
        .notifications-close-icon {
          width: 24px;
          height: 24px;
        }
        .notifications-body {
          padding: 20px;
          padding-bottom: 16px;
          height: calc(100% - 64px);
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        .notifications-content {
          min-height: 100px;
        }
        .notifications-list-footer {
          padding: 16px 20px;
          border-top: 1px solid var(--border);
          flex-shrink: 0;
        }
        .notifications-list-footer .notification-action {
          width: 100%;
        }
        .notification-action-muted {
          color: var(--text-muted);
          border-color: var(--border);
        }
        .notification-action-muted:hover:not(:disabled) {
          border-color: var(--text-muted);
          background: var(--surface-strong);
        }
        .notification-action-muted:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .notification-detail-body {
          padding: 20px;
          overflow-y: auto;
        }
        .notification-title {
          font-weight: 600;
          font-size: 1.15rem;
          color: var(--text);
          line-height: 1.25;
          margin-bottom: 0;
        }
        .notification-message {
          font-size: 1rem;
          color: var(--text-muted);
          line-height: 1.6;
          margin-bottom: 0;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .notification-time {
          font-size: 0.9rem;
          color: var(--text-muted);
        }
        .notification-detail {
          display: grid;
          gap: 10px;
        }
        .notification-detail-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        .notification-list-item {
          width: 100%;
          display: grid;
          gap: 6px;
          padding: 12px 0;
          border: none;
          border-bottom: 1px solid var(--border);
          background: transparent;
          text-align: left;
          cursor: pointer;
          color: inherit;
          font: inherit;
          position: relative;
          padding-left: 14px;
        }
        .notification-list-item.is-read {
          opacity: 0.65;
        }
        .notification-list-item.is-unread .notification-list-title {
          color: var(--text);
        }
        .notification-list-item.is-unread::before {
          content: '';
          position: absolute;
          top: 18px;
          left: 0;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          opacity: 0.85;
        }
        .notification-list-item:last-child {
          border-bottom: none;
        }
        .notification-list-item.is-loading {
          pointer-events: none;
          color: var(--text);
        }
        .notification-list-item.is-loading .notification-list-title,
        .notification-list-item.is-loading .notification-list-message,
        .notification-list-item.is-loading .notification-list-time,
        .notification-list-item.is-loading .notification-list-count {
          visibility: hidden;
        }
        .notification-list-item-spinner {
          display: none;
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 18px;
          height: 18px;
          border: 2px solid var(--border);
          border-top-color: currentColor;
          border-radius: 50%;
          animation: notification-item-spin 0.8s linear infinite;
        }
        .notification-list-item.is-loading .notification-list-item-spinner {
          display: block;
        }
        @keyframes notification-item-spin {
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        .notification-list-title {
          font-weight: 600;
          font-size: 0.95rem;
          color: var(--text);
        }
        .notification-list-message {
          font-size: 0.9rem;
          color: var(--text-muted);
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .notification-list-count {
          font-size: 0.8rem;
          color: var(--text-muted);
          opacity: 0.85;
          margin-top: 2px;
        }
        .notification-list-time {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .notification-actions {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 6px;
        }
        .notification-action {
          height: 40px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text);
          cursor: pointer;
          font-weight: 600;
          font: inherit;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          line-height: 1;
          -webkit-appearance: none;
          appearance: none;
        }
        .notification-action:hover {
          border-color: var(--accent);
          background: var(--surface-strong);
        }
        .notification-action.is-primary {
          margin-left: auto;
          background: var(--accent);
          border-color: var(--accent);
          color: var(--accent-text);
        }
        .notification-action.is-primary:hover {
          background: color-mix(in srgb, var(--accent) 90%, black);
          border-color: color-mix(in srgb, var(--accent) 90%, black);
        }

        @media (max-width: 520px) {
          .notification-actions {
            flex-direction: column;
            align-items: stretch;
          }
          .notification-action {
            width: 100%;
          }
          .notification-action.is-primary {
            margin-left: 0;
          }
        }
      </style>
      <div class="notifications-overlay">
        <div class="notifications-modal">
          <div class="notifications-header">
            <h2>Notifications</h2>
            <button class="notifications-close" aria-label="Close">
              <svg class="notifications-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="notifications-body">
            <div class="notifications-content"></div>
          </div>
          <div class="notifications-list-footer" data-mark-all-read-footer style="display: none;">
            <button type="button" class="notification-action notification-action-muted" data-action="mark-all-read">Mark All Read</button>
          </div>
        </div>
      </div>
      <div class="notification-detail-overlay">
        <div class="notification-detail-modal">
          <div class="notifications-header">
            <h2>Notification</h2>
            <button class="notifications-close" aria-label="Close">
              <svg class="notifications-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="notification-detail-body">
            <div class="notification-detail-content"></div>
          </div>
        </div>
      </div>
    `;
	}

	prefetchNotifications() {
		const schedule = window.requestIdleCallback
			? window.requestIdleCallback.bind(window)
			: (cb) => setTimeout(cb, 250);
		schedule(() => {
			this.loadNotifications({ silent: true, force: true });
		});
	}
}

customElements.define('app-modal-notifications', AppModalNotifications);
