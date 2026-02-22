import { formatRelativeTime } from '../../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { getAvatarColor } from '../../shared/avatar.js';
import { fetchLatestComments } from '../../shared/comments.js';
import { processUserText, hydrateUserTextLinks } from '../../shared/userText.js';
import { attachAutoGrowTextarea } from '../../shared/autogrow.js';
import { buildProfilePath } from '../../shared/profileLinks.js';

const html = String.raw;

function escapeHtml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

class AppRouteServers extends HTMLElement {
	connectedCallback() {
		this.innerHTML = html`
      <div class="servers-route">
        <div class="route-header">
          <h3>Connect</h3>
          <p>See what the community is talking about, manage your image generation servers, and send feature requests directly to the team.</p>
        </div>
		<app-tabs>
			<tab data-id="latest-comments" label="Comments" default>
				<div class="comment-list" data-comments-container>
					<div class="route-empty route-loading">
						<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
					</div>
				</div>
			</tab>

			<tab data-id="servers" label="Servers">
				<div class="route-cards admin-cards" data-servers-container>
					<div class="route-empty route-loading">
						<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
					</div>
				</div>
			</tab>

			<tab data-id="feature-requests" label="Feature Requests">
				<div class="route-header">
					<p>Tell us what you want to see next. We read every submission.</p>
				</div>
				<div class="alert" data-feature-request-status hidden></div>
				<form data-feature-request-form>
					<textarea
						name="message"
						rows="10"
						maxlength="5000"
						placeholder="What should we build? What problem does it solve?"
						aria-label="Feature request details"
						data-feature-request-message
						required
					></textarea>
					<button type="submit" class="btn-primary btn-inline" data-feature-request-submit>Send</button>
				</form>
			</tab>
		</app-tabs>
      </div>
    `;

		this.loadLatestComments();
		this.loadServers();
		this.setupFeatureRequestForm();
		this.setupConnectTabHash();
		this._onServersUpdated = () => this.loadServers();
		document.addEventListener('servers-updated', this._onServersUpdated);
	}

	/** Sync Connect tab from URL hash (#servers, #latest-comments, #feature-requests) and update hash when tab changes. */
	setupConnectTabHash() {
		const CONNECT_TAB_IDS = ['latest-comments', 'servers', 'feature-requests'];

		const syncTabFromHash = () => {
			const path = window.location.pathname || '';
			if (path !== '/connect' && !path.startsWith('/connect/')) return;
			const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
			if (!hash || !CONNECT_TAB_IDS.includes(hash)) return;
			const tabs = this.querySelector('app-tabs');
			if (tabs && typeof tabs.setActiveTab === 'function') {
				tabs.setActiveTab(hash, { focus: false });
			}
		};

		const onRouteChange = (e) => {
			if (e.detail?.route === 'connect') syncTabFromHash();
		};

		const onHashChange = () => syncTabFromHash();

		setTimeout(() => {
			if (document.documentElement?.dataset?.route === 'connect') syncTabFromHash();
		}, 0);

		document.addEventListener('route-change', onRouteChange);
		window.addEventListener('hashchange', onHashChange);

		const tabs = this.querySelector('app-tabs');
		if (tabs) {
			tabs.addEventListener('tab-change', (e) => {
				const id = e.detail?.id;
				if (!id) return;
				const path = window.location.pathname || '';
				if (path !== '/connect' && !path.startsWith('/connect/')) return;
				const newHash = `#${id}`;
				if (window.location.hash !== newHash) {
					window.history.replaceState(null, '', `/connect${newHash}`);
				}
			});
		}

		this._connectTabHashCleanup = () => {
			document.removeEventListener('route-change', onRouteChange);
			window.removeEventListener('hashchange', onHashChange);
		};
	}

	disconnectedCallback() {
		document.removeEventListener('servers-updated', this._onServersUpdated);
		if (typeof this._connectTabHashCleanup === 'function') {
			this._connectTabHashCleanup();
		}
	}

	async loadLatestComments() {
		const container = this.querySelector('[data-comments-container]');
		if (!container) return;

		try {
			const result = await fetchLatestComments({ limit: 10 });
			if (!result.ok) {
				throw new Error('Failed to load comments');
			}
			const comments = Array.isArray(result.data?.comments) ? result.data.comments : [];
			this.renderLatestComments(comments, container);
		} catch {
			container.innerHTML = '<div class="route-empty">Error loading comments.</div>';
		}
	}

	renderLatestComments(comments, container) {
		container.innerHTML = '';

		if (!Array.isArray(comments) || comments.length === 0) {
			container.innerHTML = '<div class="route-empty">No recent comments yet.</div>';
			return;
		}

		container.classList.add('connect-comment-list');

		comments.forEach((comment) => {
			const createdImageId = Number(comment?.created_image_id);
			const href = (Number.isFinite(createdImageId) && createdImageId > 0) ? `/creations/${createdImageId}` : null;

			const displayName = (typeof comment?.display_name === 'string' && comment.display_name.trim())
				? comment.display_name.trim()
				: '';
			const userName = (typeof comment?.user_name === 'string' && comment.user_name.trim())
				? comment.user_name.trim()
				: '';
			const fallbackName = userName ? userName : 'User';
			const commenterName = displayName || fallbackName;
			const commenterHandle = userName ? `@${userName}` : '';

			const createdImageTitle = (typeof comment?.created_image_title === 'string' && comment.created_image_title.trim())
				? comment.created_image_title.trim()
				: (Number.isFinite(createdImageId) && createdImageId > 0 ? `Creation ${createdImageId}` : 'Creation');

			const creatorDisplayName = (typeof comment?.created_image_display_name === 'string' && comment.created_image_display_name.trim())
				? comment.created_image_display_name.trim()
				: '';
			const creatorUserName = (typeof comment?.created_image_user_name === 'string' && comment.created_image_user_name.trim())
				? comment.created_image_user_name.trim()
				: '';
			const creator = creatorDisplayName || (creatorUserName ? `@${creatorUserName}` : '');

			const row = document.createElement('div');
			row.className = `connect-comment${href ? '' : ' is-disabled'}`;
			if (href) {
				row.setAttribute('role', 'link');
				row.tabIndex = 0;
				row.dataset.href = href;
				row.setAttribute('aria-label', `Open creation ${createdImageTitle}`);
				row.addEventListener('click', (e) => {
					const target = e.target;
					if (target instanceof HTMLElement && target.closest('a')) return;
					window.location.href = href;
				});
				row.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						window.location.href = href;
					}
				});
			}

			const thumbWrap = document.createElement('div');
			thumbWrap.className = 'connect-comment-thumb';
			thumbWrap.setAttribute('aria-hidden', 'true');
			const thumbUrl = typeof comment?.created_image_thumbnail_url === 'string' ? comment.created_image_thumbnail_url.trim() : '';
			const imageUrl = typeof comment?.created_image_url === 'string' ? comment.created_image_url.trim() : '';
			const resolvedThumb = thumbUrl || imageUrl || '';
			if (resolvedThumb) {
				const img = document.createElement('img');
				img.src = resolvedThumb;
				img.alt = '';
				img.loading = 'lazy';
				img.decoding = 'async';
				img.className = 'connect-comment-thumb-img';
				thumbWrap.appendChild(img);
			}

			const creationTitle = document.createElement('div');
			creationTitle.className = 'connect-comment-creation-title';
			creationTitle.textContent = createdImageTitle;

			const creatorRow = document.createElement('div');
			creatorRow.className = 'connect-comment-creator';

			const creatorId = Number(comment?.created_image_user_id ?? 0);
			const creatorProfileHref = buildProfilePath({ userName: creatorUserName, userId: creatorId });
			const creatorName = creatorDisplayName || (creatorUserName ? creatorUserName : 'User');
			const creatorHandle = creatorUserName ? `@${creatorUserName}` : '';
			const creatorSeed = creatorUserName || String(creatorId || '') || creatorName;
			const creatorColor = getAvatarColor(creatorSeed);
			const creatorInitial = creatorName.charAt(0).toUpperCase() || '?';
			const creatorAvatarUrl = typeof comment?.created_image_avatar_url === 'string' ? comment.created_image_avatar_url.trim() : '';
			const creatorPlan = comment?.created_image_owner_plan === 'founder';
			const creatorAvatarContent = creatorAvatarUrl ? `<img class="comment-avatar-img" src="${escapeHtml(creatorAvatarUrl)}" alt="">` : escapeHtml(creatorInitial);
			const creatorInnerStyle = `background: ${creatorAvatarUrl ? 'var(--surface-strong)' : creatorColor};`;
			const creatorFlairInner = creatorPlan
				? `<div class="avatar-with-founder-flair avatar-with-founder-flair--xs"><div class="founder-flair-avatar-ring"><div class="founder-flair-avatar-inner" style="${creatorInnerStyle}" aria-hidden="true">${creatorAvatarContent}</div></div></div>`
				: creatorAvatarContent;

			const creatorAvatarHtml = creatorProfileHref
				? `
					<a class="user-link user-avatar-link comment-avatar" href="${creatorProfileHref}" aria-label="View ${escapeHtml(creatorName)} profile"${creatorPlan ? '' : ` style="background: ${creatorColor};"`}>
						${creatorFlairInner}
					</a>
				`
				: `
					<div class="comment-avatar"${creatorPlan ? '' : ` style="background: ${creatorColor};"`}>
						${creatorFlairInner}
					</div>
				`;

			// Note: on Connect, we intentionally hide the creation timestamp to reduce clutter.
			creatorRow.innerHTML = `
				<div class="connect-comment-creator-left">
					${creatorAvatarHtml}
					<div class="connect-comment-creator-who">
						<span class="comment-author-name${creatorPlan ? ' founder-name' : ''}">${escapeHtml(creatorName)}</span>
						${creatorHandle ? `<span class="comment-author-handle${creatorPlan ? ' founder-name' : ''}">${escapeHtml(creatorHandle)}</span>` : ''}
					</div>
				</div>
			`;

			const commenterId = Number(comment?.user_id ?? 0);
			const profileHref = buildProfilePath({ userName, userId: commenterId });
			const seed = userName || String(comment?.user_id ?? '') || commenterName;
			const color = getAvatarColor(seed);
			const initial = commenterName.charAt(0).toUpperCase() || '?';
			const avatarUrl = typeof comment?.avatar_url === 'string' ? comment.avatar_url.trim() : '';
			const commenterPlan = comment?.plan === 'founder';
			const commenterAvatarContent = avatarUrl ? `<img class="comment-avatar-img" src="${escapeHtml(avatarUrl)}" alt="">` : escapeHtml(initial);
			const commenterInnerStyle = `background: ${avatarUrl ? 'var(--surface-strong)' : color};`;
			const commenterFlairInner = commenterPlan
				? `<div class="avatar-with-founder-flair avatar-with-founder-flair--xs"><div class="founder-flair-avatar-ring"><div class="founder-flair-avatar-inner" style="${commenterInnerStyle}" aria-hidden="true">${commenterAvatarContent}</div></div></div>`
				: commenterAvatarContent;

			const avatarHtml = profileHref
				? `
					<a class="user-link user-avatar-link comment-avatar" href="${profileHref}" aria-label="View ${escapeHtml(commenterName)} profile"${commenterPlan ? '' : ` style="background: ${color};"`}>
						${commenterFlairInner}
					</a>
				`
				: `
					<div class="comment-avatar"${commenterPlan ? '' : ` style="background: ${color};"`}>
						${commenterFlairInner}
					</div>
				`;

			const timeAgo = comment?.created_at ? (formatRelativeTime(comment.created_at) || '') : '';
			const safeText = processUserText(comment?.text ?? '');

			const commentText = document.createElement('div');
			commentText.className = 'comment-text';
			commentText.innerHTML = safeText;

			const footer = document.createElement('div');
			footer.className = 'connect-comment-footer';
			footer.innerHTML = `
				<div class="connect-comment-footer-left">
					${avatarHtml}
					<div class="connect-comment-footer-who">
						<span class="connect-comment-footer-name-handle-time">
							<span class="comment-author-name${commenterPlan ? ' founder-name' : ''}">${escapeHtml(commenterName)}</span>
							${commenterHandle ? `<span class="comment-author-handle${commenterPlan ? ' founder-name' : ''}">${escapeHtml(commenterHandle)}</span>` : ''}
							${timeAgo ? `<span class="comment-time">&nbsp;·&nbsp;${escapeHtml(timeAgo)}</span>` : ''}
						</span>
					</div>
				</div>
			`;

			row.appendChild(thumbWrap);
			row.appendChild(creationTitle);
			row.appendChild(creatorRow);
			row.appendChild(commentText);
			row.appendChild(footer);
			container.appendChild(row);
		});

		// Comments were rendered; hydrate any special link labels within them.
		hydrateUserTextLinks(container);
	}

	// Listen for server updates from modal
	setupEventListeners() {
		document.addEventListener('server-updated', () => {
			this.loadServers({ force: true });
		});
	}

	setupFeatureRequestForm() {
		const form = this.querySelector('[data-feature-request-form]');
		if (!(form instanceof HTMLFormElement)) return;

		const status = this.querySelector('[data-feature-request-status]');
		const submit = this.querySelector('[data-feature-request-submit]');
		const messageEl = this.querySelector('[data-feature-request-message]');
		const refreshMessage = messageEl instanceof HTMLTextAreaElement
			? attachAutoGrowTextarea(messageEl)
			: () => { };

		let statusTimer = null;

		const setStatus = ({ type, text } = {}) => {
			if (!(status instanceof HTMLElement)) return;
			if (statusTimer) {
				clearTimeout(statusTimer);
				statusTimer = null;
			}
			status.hidden = !text;
			status.classList.toggle('error', type === 'error');
			if (!text) {
				status.textContent = '';
				return;
			}

			// Render a dismissible alert.
			status.innerHTML = `
				<span>${escapeHtml(text)}</span>
				<button type="button" class="alert-close" data-alert-close aria-label="Dismiss">✕</button>
			`;

			const close = status.querySelector('[data-alert-close]');
			if (close instanceof HTMLButtonElement) {
				close.addEventListener('click', () => {
					setStatus({ type: 'info', text: '' });
				});
			}

			// Auto-dismiss non-error notices.
			if (type !== 'error') {
				statusTimer = setTimeout(() => {
					setStatus({ type: 'info', text: '' });
				}, 4000);
			}
		};

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			setStatus({ type: 'info', text: '' });

			const message = String(form.elements.message.value || '').trim();
			const context = {
				route: (document.documentElement?.dataset?.route || window.__CURRENT_ROUTE__ || '').toString(),
				referrer: (document.referrer || '').toString(),
				timezone: (() => {
					try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
				})(),
				locale: (navigator.language || '').toString(),
				platform: (navigator.platform || '').toString(),
				colorScheme: (() => {
					try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return ''; }
				})(),
				reducedMotion: (() => {
					try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference'; } catch { return ''; }
				})(),
				network: (() => {
					const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
					const effectiveType = conn?.effectiveType ? String(conn.effectiveType) : '';
					const saveData = typeof conn?.saveData === 'boolean' ? (conn.saveData ? 'save-data' : '') : '';
					return [effectiveType, saveData].filter(Boolean).join(' ');
				})(),
				viewportWidth: window.innerWidth || 0,
				viewportHeight: window.innerHeight || 0,
				screenWidth: window.screen?.width || 0,
				screenHeight: window.screen?.height || 0,
				devicePixelRatio: window.devicePixelRatio || 1
			};

			if (!message) {
				setStatus({ type: 'error', text: 'Please share your idea.' });
				return;
			}

			if (submit instanceof HTMLButtonElement) {
				submit.disabled = true;
				submit.textContent = 'Sending…';
			}

			try {
				const response = await fetch('/api/feature-requests', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ message, context })
				});
				const data = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(data.error || 'Failed to send feature request.');
				}
				form.reset();
				refreshMessage();
				setStatus({ type: 'info', text: 'Sent. Thanks — we’ll review it soon.' });
			} catch (err) {
				setStatus({ type: 'error', text: err?.message || 'Failed to send feature request.' });
			} finally {
				if (submit instanceof HTMLButtonElement) {
					submit.disabled = false;
					submit.textContent = 'Send';
				}
			}
		});
	}

	async loadServers({ force = false } = {}) {
		const container = this.querySelector('[data-servers-container]');
		if (!container) return;

		try {
			const result = await fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 });
			if (!result.ok) {
				throw new Error('Failed to load servers');
			}

			const servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
			const viewerIsAdmin = Boolean(result.data?.viewer_is_admin);
			this.renderServers(servers, container, viewerIsAdmin);
		} catch (error) {
			// console.error('Error loading servers:', error);
			container.innerHTML = '<div class="route-empty">Error loading servers.</div>';
		}
	}

	renderServers(servers, container, viewerIsAdmin = false) {
		container.innerHTML = '';

		// Rely on server-side (ID ascending) ordering so client matches API.
		const sortedServers = [...servers];

		sortedServers.forEach(server => {
			const card = document.createElement('div');
			card.className = 'card admin-card server-card';
			card.dataset.serverId = server.id;
			card.style.cursor = 'pointer';

			const badges = [];
			// Admin-only: show suspended tag (only admins see suspended servers in the list).
			if (server.suspended) {
				badges.push('<span class="server-badge server-badge-suspended">Suspended</span>');
			}
			// Special "home" server (id = 1) has a dedicated Home tag.
			if (server.id === 1) {
				badges.push('<span class="server-badge server-badge-member">Home</span>');
			} else {
				if (server.is_owner) {
					badges.push('<span class="server-badge server-badge-owner">Owned</span>');
				}
				if (server.is_member && !server.is_owner) {
					badges.push('<span class="server-badge server-badge-member">Joined</span>');
				}
			}

			const name = document.createElement('div');
			name.className = 'admin-title';
			name.innerHTML = `${server.name || 'Unnamed Server'} ${badges.join('')}`;

			const hasDescription = typeof server.description === 'string' && server.description.trim().length > 0;
			const descriptionText = hasDescription ? server.description.trim() : '';

			card.appendChild(name);

			if (hasDescription) {
				const desc = document.createElement('div');
				desc.className = 'admin-detail server-card-description';
				desc.textContent = descriptionText;
				card.appendChild(desc);
			}

			// Add owner information if available.
			// Intentionally non-clickable so it doesn't interfere with card click to open the modal.
			if (server.owner && server.id !== 1) {
				const owner = server.owner;
				const ownerDisplayName = owner.display_name || `User ${owner.id}`;
				const ownerUserName = owner.user_name || owner.email_prefix || null;
				const ownerAvatarUrl = owner.avatar_url || null;
				const ownerInitial = ownerDisplayName.trim().charAt(0).toUpperCase() || '?';
				const ownerColor = getAvatarColor(owner.user_name || owner.email_prefix || String(owner.id || ''));

				const ownerInfo = document.createElement('div');
				ownerInfo.className = 'server-owner';

				const ownerRow = document.createElement('div');
				ownerRow.className = 'server-owner-link';

				const avatar = document.createElement('div');
				avatar.className = 'server-owner-avatar';
				avatar.style.background = ownerColor;
				if (ownerAvatarUrl) {
					const img = document.createElement('img');
					img.src = ownerAvatarUrl;
					img.className = 'server-owner-avatar-img';
					img.alt = '';
					avatar.appendChild(img);
				} else {
					avatar.textContent = ownerInitial;
				}

				const ownerText = document.createElement('span');
				ownerText.className = 'server-owner-text';
				ownerText.innerHTML = html`
					<span class="server-owner-name">${ownerDisplayName}</span>
					${ownerUserName ? html`<span class="server-owner-handle">@${ownerUserName}</span>` : ''}
				`;

				ownerRow.appendChild(avatar);
				ownerRow.appendChild(ownerText);
				ownerInfo.appendChild(ownerRow);
				card.appendChild(ownerInfo);
			}

			// Status and timestamp on one line (admin only)
			if (viewerIsAdmin) {
				const meta = document.createElement('div');
				meta.className = 'admin-meta';
				const statusText = server.status || 'unknown';
				const memberText = (typeof server.members_count === 'number' && server.id !== 1)
					? ` • ${server.members_count} member${server.members_count !== 1 ? 's' : ''}`
					: '';
				const timeText = server.created_at ? formatRelativeTime(server.created_at, { style: 'long' }) : '—';
				meta.textContent = `${statusText}${memberText} • ${timeText}`;
				card.appendChild(meta);
			}

			// Click card to view details
			card.addEventListener('click', () => {
				const modal = document.querySelector('app-modal-server');
				if (modal) {
					modal.open({
						mode: server.can_manage ? 'edit' : 'view',
						serverId: server.id
					});
				}
			});

			container.appendChild(card);
		});

		// Ghost card for adding a custom server (always last).
		const ghostCard = document.createElement('button');
		ghostCard.type = 'button';
		ghostCard.className = 'card server-card server-card-ghost';
		ghostCard.setAttribute('aria-label', 'Add custom server');

		const ghostTitle = document.createElement('div');
		ghostTitle.className = 'server-card-ghost-title';
		ghostTitle.textContent = 'Add custom server';

		const ghostSubtitle = document.createElement('div');
		ghostSubtitle.className = 'server-card-ghost-subtitle';
		ghostSubtitle.textContent = 'Register your own image generation server.';

		ghostCard.appendChild(ghostTitle);
		ghostCard.appendChild(ghostSubtitle);

		ghostCard.addEventListener('click', () => {
			const modal = document.querySelector('app-modal-server');
			if (modal) {
				modal.open({ mode: 'add' });
			}
		});

		container.appendChild(ghostCard);
	}

	async handleJoin(serverId) {
		try {
			const response = await fetch(`/api/servers/${serverId}/join`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to join server');
				return;
			}

			// Refresh the page to show updated state
			window.location.reload();
		} catch (error) {
			// console.error('Error joining server:', error);
			alert('Failed to join server');
		}
	}

	async handleLeave(serverId) {
		if (!confirm('Are you sure you want to leave this server?')) {
			return;
		}

		try {
			const response = await fetch(`/api/servers/${serverId}/leave`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to leave server');
				return;
			}

			// Refresh the page to show updated state
			window.location.reload();
		} catch (error) {
			// console.error('Error leaving server:', error);
			alert('Failed to leave server');
		}
	}
}

customElements.define('app-route-servers', AppRouteServers);
