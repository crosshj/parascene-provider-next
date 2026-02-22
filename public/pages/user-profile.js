import { formatDate, formatDateTime, formatRelativeTime } from '../shared/datetime.js';
import { fetchJsonWithStatusDeduped } from '../shared/api.js';
import { getAvatarColor } from '../shared/avatar.js';
import { processUserText, hydrateUserTextLinks } from '../shared/userText.js';
import { createInfiniteScroll } from '../shared/infinite-scroll.js';
import { buildProfilePath } from '../shared/profileLinks.js';

const html = String.raw;

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = String(text ?? '');
	return div.innerHTML;
}

function safeJsonParse(text, fallback) {
	if (text == null) return fallback;
	if (typeof text === 'object') return text;
	if (typeof text !== 'string') return fallback;
	const trimmed = text.trim();
	if (!trimmed) return fallback;
	try {
		return JSON.parse(trimmed);
	} catch {
		return fallback;
	}
}

function getPathUserTarget() {
	const pathname = window.location.pathname || '';
	if (pathname === '/user') return { kind: 'me', mode: 'id', userId: null, userName: null };
	const match = pathname.match(/^\/user\/(\d+)$/);
	if (match) {
		const id = Number.parseInt(match[1], 10);
		if (!Number.isFinite(id) || id <= 0) return { kind: 'invalid', mode: 'id', userId: null, userName: null };
		return { kind: 'other', mode: 'id', userId: id, userName: null };
	}
	const personalityMatch = pathname.match(/^\/p\/([a-z0-9][a-z0-9_-]{2,23})$/i);
	if (personalityMatch) {
		return { kind: 'other', mode: 'username', userId: null, userName: String(personalityMatch[1] || '').toLowerCase() };
	}
	const tagMatch = pathname.match(/^\/t\/([a-z0-9][a-z0-9_-]{1,31})$/i);
	if (tagMatch) {
		return { kind: 'other', mode: 'tag', userId: null, userName: String(tagMatch[1] || '').toLowerCase() };
	}
	return { kind: 'invalid', mode: 'id', userId: null, userName: null };
}

function buildTargetUserApiBase(target) {
	if (target?.mode === 'username' && target?.userName) {
		return `/api/users/by-username/${encodeURIComponent(target.userName)}`;
	}
	if (Number.isFinite(target?.userId) && target.userId > 0) {
		return `/api/users/${target.userId}`;
	}
	return null;
}

function getServerProfileContext() {
	const ctx = window.__ps_profile_context;
	return ctx && typeof ctx === 'object' ? ctx : null;
}

function renderProfileUnavailableState(container, {
	title = 'Unable to load profile',
	message = 'Something went wrong. Please try again.',
	icon = 'warning'
} = {}) {
	const iconSvg = icon === 'user-not-found'
		? html`<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
	stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<circle cx="10" cy="8" r="3"></circle>
	<path d="M4 19c0-3.3 2.7-6 6-6s6 2.7 6 6"></path>
	<path d="M16 8l4 4"></path>
	<path d="M20 8l-4 4"></path>
</svg>`
		: html`<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
	stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<circle cx="12" cy="12" r="9"></circle>
	<path d="M12 8v5"></path>
	<circle cx="12" cy="16.5" r="0.8" fill="currentColor"></circle>
</svg>`;
	container.innerHTML = html`
		<div class="route-empty route-empty-image-grid route-empty-state">
			<div class="route-empty-icon">${iconSvg}</div>
			<div class="route-empty-title">${escapeHtml(title)}</div>
			<div class="route-empty-message">${escapeHtml(message)}</div>
		</div>
	`;
}

async function copyTextToClipboard(text) {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// ignore
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
}

function guessHandle({ user, profile }) {
	const userName = profile?.user_name ? String(profile.user_name) : '';
	if (userName) return `@${userName}`;
	const emailPrefix =
		(user?.email_prefix ? String(user.email_prefix) : '') ||
		(user?.email ? String(user.email).split('@')[0] : '');
	if (emailPrefix) return `@${emailPrefix}`;
	const id = user?.id != null ? String(user.id) : 'user';
	return `@user-${id}`;
}

function buildBannerStyle(coverImageUrl) {
	const url = typeof coverImageUrl === 'string' ? coverImageUrl.trim() : '';
	if (!url) return '';
	// IMPORTANT: This string is injected into an HTML attribute wrapped in double quotes.
	// So we must avoid double quotes inside the value, otherwise the attribute breaks.
	const safeUrl = url.replace(/'/g, "\\'");
	return `background-image: url('${safeUrl}');`;
}

function normalizeWebsite(raw) {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) return null;

	let href = value;
	if (!/^https?:\/\//i.test(href)) href = `https://${href}`;

	try {
		const url = new URL(href);
		const label = value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
		return { href: url.href, label: label || url.host || url.href };
	} catch {
		return { href, label: value };
	}
}

function renderProfilePage(container, { user, profile, stats, plan, isSelf, viewerFollows, isAdmin = false }) {
	const fallbackName =
		(user?.email_prefix && String(user.email_prefix).trim()) ||
		(isSelf && user?.email ? String(user.email).split('@')[0] : '') ||
		'';
	const displayName =
		(profile?.display_name && String(profile.display_name).trim()) ||
		(profile?.user_name && String(profile.user_name).trim()) ||
		(fallbackName || `User ${user?.id ?? ''}`);

	const handle = guessHandle({ user, profile });
	const about = typeof profile?.about === 'string' ? profile.about.trim() : '';
	const characterDescription = typeof profile?.character_description === 'string' ? profile.character_description.trim() : '';
	const website = normalizeWebsite(profile?.socials?.website);
	const avatarUrl = typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '';
	const coverUrl = typeof profile?.cover_image_url === 'string' ? profile.cover_image_url.trim() : '';
	const userNameValue = profile?.user_name && String(profile.user_name).trim() ? String(profile.user_name).trim() : '';
	const userNameLocked = Boolean(userNameValue);

	const avatarInitial = displayName.trim().charAt(0).toUpperCase() || '?';
	const avatarColor = getAvatarColor(profile?.user_name || user?.email_prefix || user?.email || String(user?.id || ''));
	const isFounder = plan === 'founder';

	const memberSince = stats?.member_since ? formatDate(stats.member_since) : null;
	const creationsPublished = Number(stats?.creations_published ?? 0);
	const likesReceived = Number(stats?.likes_received ?? 0);

	const avatarContent = avatarUrl
		? html`<img class="user-profile-avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
: html`<div class="user-profile-avatar-fallback" style="--user-profile-avatar-bg: ${avatarColor};" aria-hidden="true">${escapeHtml(avatarInitial)}</div>`;

	const usernameHint = '3–24 characters. Lowercase letters, numbers, and underscores only. This cannot be changed later.'
	container.innerHTML = html`
		<div class="user-profile-hero">
			<div class="user-profile-banner" style="${buildBannerStyle(coverUrl)}"></div>
			<div class="user-profile-hero-inner">
				<div class="user-profile-avatar">
					${isFounder ? html`
					<div class="avatar-with-founder-flair avatar-with-founder-flair--xl">
						<div class="founder-flair-avatar-ring">
							<div class="founder-flair-avatar-inner">
								${avatarContent}
							</div>
						</div>
					</div>
					` : avatarContent}
				</div>
		
				<div class="user-profile-identity">
					<div class="user-profile-title-row">
						<div class="user-profile-name${isFounder ? ' founder-name' : ''}">${escapeHtml(displayName)}</div>
						<div class="user-profile-actions">
							${isSelf ? html`<button class="btn-primary user-profile-edit" type="button">Edit Profile</button>` :
							''}
							${!isSelf ? html`
							<button class="${viewerFollows ? 'btn-secondary' : 'btn-primary'} user-profile-follow" type="button"
								data-follow-button data-follow-user-id="${escapeHtml(user?.id ?? '')}">
								${viewerFollows ? 'Unfollow' : 'Follow'}
							</button>
							` : ''}
							<!--
																	<button class="btn-secondary user-profile-share" type="button">Share</button>
																	-->
						</div>
					</div>
					<div class="user-profile-handle${isFounder ? ' founder-name' : ''}">${escapeHtml(handle)}</div>
		
					<div class="user-profile-stats">
						<div class="user-profile-stat">
							<div class="user-profile-stat-value">${creationsPublished}</div>
							<div class="user-profile-stat-label">Published</div>
						</div>
						<div class="user-profile-stat">
							<div class="user-profile-stat-value">${likesReceived}</div>
							<div class="user-profile-stat-label">Likes</div>
						</div>
						<div class="user-profile-stat">
							<div class="user-profile-stat-value">${escapeHtml(memberSince || '—')}</div>
							<div class="user-profile-stat-label">Member Since</div>
						</div>
					</div>
		
					${(about || characterDescription || website) ? html`
					<div class="user-profile-meta">
						${about ? html`
						<div class="user-profile-meta-row">
							<span class="user-profile-meta-label">About</span>
							<span class="user-profile-meta-text">${processUserText(about)}</span>
						</div>
						` : ''}
						${characterDescription ? html`
						<div class="user-profile-meta-row">
							<span class="user-profile-meta-label">Character</span>
							<span class="user-profile-meta-text">${processUserText(characterDescription)}</span>
						</div>
						` : ''}
						${website ? html`
						<div class="user-profile-meta-row">
							<span class="user-profile-meta-label">Website</span>
							<a class="user-profile-meta-link" href="${escapeHtml(website.href)}" target="_blank"
								rel="noopener noreferrer">${escapeHtml(website.label)}</a>
						</div>
						` : ''}
					</div>
					` : ''}
				</div>
			</div>
		</div>
		
		<div class="user-profile-content">
			<app-tabs class="user-profile-tabs-pending" data-profile-tabs>
				<tab data-id="creations" label="Creations" default>
					<div class="user-profile-tab-content" data-profile-tab-content="creations">
						<div class="route-cards content-cards-image-grid" data-profile-grid>
							<div class="route-empty route-empty-image-grid route-loading">
								<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
							</div>
						</div>
						<div class="user-profile-load-more" data-profile-load-more="creations" hidden></div>
					</div>
				</tab>
				<tab data-id="mentions" label="Mentions">
					<div class="user-profile-tab-content" data-profile-tab-content="mentions">
						<div class="route-empty" data-profile-mentions>Coming soon.</div>
						<div class="user-profile-load-more" data-profile-load-more="mentions" hidden></div>
					</div>
				</tab>
				<tab data-id="likes" label="Likes">
					<div class="user-profile-tab-content" data-profile-tab-content="likes">
						<div class="route-empty" data-profile-likes>Coming soon.</div>
						<div class="user-profile-load-more" data-profile-load-more="likes" hidden></div>
					</div>
				</tab>
				${(isSelf || isAdmin) ? html`
				<tab data-id="follows" label="${isSelf ? 'You follow' : 'User follows'}">
					<div class="user-profile-tab-content" data-profile-tab-content="follows">
						<div class="route-empty" data-profile-follows>Coming soon.</div>
						<div class="user-profile-load-more" data-profile-load-more="follows" hidden></div>
					</div>
				</tab>
				` : ''}
				<tab data-id="following" label="${isSelf ? 'Follows you' : isAdmin ? 'Follows user' : 'Followers'}">
					<div class="user-profile-tab-content" data-profile-tab-content="following">
						<div class="route-empty" data-profile-following>Coming soon.</div>
						<div class="user-profile-load-more" data-profile-load-more="following" hidden></div>
					</div>
				</tab>
				<tab data-id="comments" label="Comments">
					<div class="user-profile-tab-content" data-profile-tab-content="comments">
						<div class="route-empty" data-profile-comments>Coming soon.</div>
						<div class="user-profile-load-more" data-profile-load-more="comments" hidden></div>
					</div>
				</tab>
			</app-tabs>
		</div>
		
		<div class="modal-overlay" data-profile-edit-overlay>
			<div class="modal modal-large">
				<div class="modal-header">
					<h2>Edit profile</h2>
					<button class="modal-close" type="button" aria-label="Close" data-profile-edit-close>
						<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
							stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					</button>
				</div>
				<div class="modal-body">
					<form class="user-profile-edit-form" data-profile-edit-form>
						<div class="user-profile-form-section">
							<div class="field">
								<label>Username</label>
								<input name="user_name" placeholder="e.g. oceanman" value="${escapeHtml(userNameValue)}"
									${userNameLocked ? 'disabled' : '' }>
								<div class="user-profile-help">
									${userNameLocked
									? 'Username is permanent and cannot be changed.'
									: usernameHint}
								</div>
							</div>
							<div class="field">
								<label>Display name</label>
								<input name="display_name" placeholder="e.g. OceanMan"
									value="${escapeHtml(profile?.display_name || '')}">
								<div class="user-profile-help">Shown on your profile. You can use spaces and caps here.</div>
							</div>
						</div>
		
						<div class="user-profile-form-section">
							<div class="field">
								<label>Bio</label>
								<textarea name="about" rows="4"
									placeholder="A short bio...">${escapeHtml(profile?.about || '')}</textarea>
								<div class="user-profile-help">Keep it short and readable. Line breaks are allowed.</div>
							</div>
						</div>
		
						<div class="user-profile-form-section">
							<div class="field">
								<label>Character</label>
								<textarea name="character_description" rows="3"
									placeholder="e.g. short, middle-aged Asian female with medium-length black hair">${escapeHtml(profile?.character_description || '')}</textarea>
								<div class="user-profile-help">Used when others @mention you in AI prompts. Keep it brief so it
									fits well in context. No line breaks.</div>
							</div>
						</div>
		
						<div class="user-profile-form-section">
							<div class="field">
								<label>Avatar</label>
								<div class="user-profile-upload" data-upload="avatar">
									<input class="user-profile-file-input" type="file" name="avatar_file" accept="image/*"
										data-upload-input="avatar">
									<input type="hidden" name="avatar_remove" value="" data-upload-remove="avatar">
									<input type="hidden" name="avatar_try_url" value="" data-avatar-try-url>
									<div class="user-profile-avatar-actions">
										<button class="user-profile-upload-button btn-secondary" type="button"
											data-upload-trigger="avatar">Upload avatar</button>
										<button class="user-profile-upload-button btn-secondary user-profile-generate-avatar-btn" type="button"
											data-avatar-generate-from-character>
											<span class="user-profile-generate-avatar-spinner" aria-hidden="true" hidden></span>
											<span class="user-profile-generate-avatar-btn-text">Generate</span>
										</button>
									</div>
									<div class="user-profile-upload-preview" data-upload-preview="avatar" hidden>
										<img class="user-profile-upload-img" alt="Avatar preview" data-upload-img="avatar">
										<div class="user-profile-avatar-generating-placeholder" data-avatar-generating-placeholder hidden aria-busy="true">
											<div class="user-profile-avatar-generating-spinner" aria-hidden="true"></div>
										</div>
										<button class="user-profile-upload-remove" type="button" aria-label="Remove avatar"
											data-upload-clear="avatar">✕</button>
									</div>
								</div>
								${profile?.avatar_url ? html`
								<div class="user-profile-upload-hydrate" data-upload-existing="avatar"
									data-url="${escapeHtml(profile.avatar_url)}">
								</div>
								` : ''}
							</div>
							<div class="field">
								<label>Cover</label>
								<div class="user-profile-upload" data-upload="cover">
									<input class="user-profile-file-input" type="file" name="cover_file" accept="image/*"
										data-upload-input="cover">
									<input type="hidden" name="cover_remove" value="" data-upload-remove="cover">
									<button class="user-profile-upload-button btn-secondary" type="button"
										data-upload-trigger="cover">Upload cover</button>
									<div class="user-profile-upload-preview user-profile-upload-preview-cover"
										data-upload-preview="cover" hidden>
										<img class="user-profile-upload-img" alt="Cover preview" data-upload-img="cover">
										<button class="user-profile-upload-remove" type="button" aria-label="Remove cover image"
											data-upload-clear="cover">✕</button>
									</div>
								</div>
								${profile?.cover_image_url ? html`
								<div class="user-profile-upload-hydrate" data-upload-existing="cover"
									data-url="${escapeHtml(profile.cover_image_url)}">
								</div>
								` : ''}
							</div>
						</div>
		
						<div class="user-profile-form-section">
							<div class="field">
								<label>Website</label>
								<input name="social_website" placeholder="https://example.com"
									value="${escapeHtml(profile?.socials?.website || '')}">
							</div>
						</div>
		
						<div class="user-profile-form-section user-profile-account-section" data-account-email-section>
							<h3 class="user-profile-form-section-title">Account</h3>
							<div class="field">
								<label>Current email</label>
								<div class="user-profile-email-readonly" data-account-current-email>${escapeHtml(user?.email ||
				'')}</div>
							</div>
							<div class="field">
								<label>New email</label>
								<input type="email" name="new_email" data-account-new-email placeholder="new@example.com"
									autocomplete="email">
							</div>
							<div class="field">
								<label>Current password</label>
								<input type="password" name="account_password" data-account-password
									placeholder="Required to change email" autocomplete="current-password">
							</div>
							<button type="button" class="btn-secondary" data-account-email-submit>Update email</button>
							<div class="user-profile-account-message" data-account-email-message style="display: none;"></div>
						</div>
		
						<div class="alert error" data-profile-edit-error style="display: none;"></div>
					</form>
				</div>
				<div class="modal-footer">
					<button class="btn-secondary" type="button" data-profile-edit-cancel>Cancel</button>
					<button class="btn-primary" type="button" data-profile-edit-save>Save</button>
				</div>
				<div class="user-profile-edit-generating-overlay" data-profile-edit-generating-overlay hidden aria-busy="true" aria-live="polite">
					<div class="user-profile-edit-generating-spinner" aria-hidden="true"></div>
				</div>
			</div>
			<div class="user-profile-generate-confirm-overlay" data-profile-generate-confirm-overlay hidden>
				<div class="modal user-profile-generate-confirm-modal">
					<div class="modal-header">
						<h3>Generate avatar</h3>
						<button class="modal-close" type="button" aria-label="Close" data-profile-generate-confirm-close>
							<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					</div>
					<div class="modal-body" data-profile-generate-confirm-body>
						<p>This costs <strong>3 credits</strong> and requires the <strong>Character</strong> field to be filled out (at least 12 characters) in the form behind this dialog.</p>
						<div class="alert error" data-profile-generate-confirm-error style="display: none;"></div>
					</div>
					<div class="modal-footer">
						<button class="btn-secondary" type="button" data-profile-generate-confirm-cancel>Cancel</button>
						<button class="btn-primary user-profile-generate-confirm-cta" type="button" data-profile-generate-confirm-cta>
							<span class="user-profile-generate-confirm-cta-text">Generate avatar</span>
							<span class="user-profile-generate-confirm-cta-spinner" aria-hidden="true" hidden role="status"></span>
						</button>
					</div>
				</div>
			</div>
		</div>
		`;
}

function setModalOpen(overlay, open) {
	if (!overlay) return;
	overlay.classList.toggle('open', Boolean(open));
	if (open) {
		document.body.classList.add('modal-open');
		document.dispatchEvent(new CustomEvent('modal-opened'));
	} else {
		document.body.classList.remove('modal-open');
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}
}

function setRouteMediaBackgroundImage(mediaEl, url) {
	if (!mediaEl || !url) return;
	mediaEl.classList.remove('route-media-error');
	mediaEl.style.backgroundImage = '';

	const probe = new Image();
	probe.decoding = 'async';
	if ('fetchPriority' in probe) {
		probe.fetchPriority = document.visibilityState === 'visible' ? 'auto' : 'low';
	}
	probe.onload = () => {
		mediaEl.classList.remove('route-media-error');
		mediaEl.style.backgroundImage = `url("${String(url).replace(/"/g, '\\"')}")`;
	};
	probe.onerror = () => {
		mediaEl.classList.add('route-media-error');
		mediaEl.style.backgroundImage = '';
	};
	probe.src = url;
}

function renderImageGrid(grid, images, showBadge = false, emptyTitle = 'No published creations yet', emptyMessage = "When this user publishes creations, they'll show up here.") {
	if (!grid) return;

	const list = Array.isArray(images) ? images : [];
	if (list.length === 0) {
		grid.innerHTML = html`
			<div class="route-empty route-empty-image-grid">
				<div class="route-empty-title">${escapeHtml(emptyTitle)}</div>
				<div class="route-empty-message">${escapeHtml(emptyMessage)}</div>
			</div>
		`;
		return;
	}

	grid.innerHTML = '';

	// Lazy load images into route-media tiles.
	const observer = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			if (!entry.isIntersecting) return;
			const el = entry.target;
			const url = el.dataset.bgUrl;
			if (!url) return;
			observer.unobserve(el);
			setRouteMediaBackgroundImage(el, url);
		});
	}, { root: null, rootMargin: '600px 0px', threshold: 0.01 });

	list.forEach((item) => {
		const card = document.createElement('div');
		card.className = 'route-card route-card-image';
		card.style.cursor = 'pointer';
		card.addEventListener('click', () => {
			window.location.href = `/creations/${item.id}`;
		});

		const isPublished = item.published === true || item.published === 1;
		const userDeleted = Boolean(item.user_deleted);
		let publishedBadge = '';
		let userDeletedBadge = '';
		let publishedInfo = '';

		if (userDeleted) {
			userDeletedBadge = html`
				<div class="creation-user-deleted-badge" title="User deleted this creation">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
						stroke-linejoin="round">
						<polyline points="3 6 5 6 21 6"></polyline>
						<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
						<line x1="10" y1="11" x2="10" y2="17"></line>
						<line x1="14" y1="11" x2="14" y2="17"></line>
					</svg>
				</div>
			`;
		}

		if (isPublished && showBadge) {
			publishedBadge = html`
				<div class="creation-published-badge" title="Published">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
						stroke-linejoin="round">
						<circle cx="12" cy="12" r="10"></circle>
						<line x1="2" y1="12" x2="22" y2="12"></line>
						<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
					</svg>
				</div>
			`;
		}

		if (isPublished && item.published_at) {
			const publishedDate = new Date(item.published_at);
			const publishedTimeAgo = formatRelativeTime(publishedDate);
			publishedInfo = html`<div class="route-meta" title="${formatDateTime(publishedDate)}">Published ${publishedTimeAgo}</div>`;
		}

		card.innerHTML = html`
			<div class="route-media" aria-hidden="true"></div>
			${userDeletedBadge}
			${publishedBadge}
			<div class="route-details">
				<div class="route-details-content">
					<div class="route-title">${escapeHtml(item.title || 'Untitled')}</div>
					${publishedInfo}
					<div class="route-meta">${escapeHtml(formatDate(item.created_at) || '')}</div>
				</div>
			</div>
		`;

		const mediaEl = card.querySelector('.route-media');
		const url = item.thumbnail_url || item.url;
		if (mediaEl && url) {
			mediaEl.dataset.bgUrl = url;
			observer.observe(mediaEl);
		}

		grid.appendChild(card);
	});
}

/** Appends image cards without clearing the grid (avoids flash on load-more). */
function appendImageGridCards(grid, items, showBadge = false) {
	if (!grid || !Array.isArray(items) || items.length === 0) return;
	const observer = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			if (!entry.isIntersecting) return;
			const el = entry.target;
			const url = el.dataset.bgUrl;
			if (!url) return;
			observer.unobserve(el);
			setRouteMediaBackgroundImage(el, url);
		});
	}, { root: null, rootMargin: '600px 0px', threshold: 0.01 });

	items.forEach((item) => {
		const card = document.createElement('div');
		card.className = 'route-card route-card-image';
		card.style.cursor = 'pointer';
		card.addEventListener('click', () => { window.location.href = `/creations/${item.id}`; });

		const isPublished = item.published === true || item.published === 1;
		const userDeleted = Boolean(item.user_deleted);
		let publishedBadge = '';
		let userDeletedBadge = '';
		let publishedInfo = '';
		if (userDeleted) {
			userDeletedBadge = html`<div class="creation-user-deleted-badge" title="User deleted this creation"><svg viewBox="0 0 24 24" fill="none"
		stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<polyline points="3 6 5 6 21 6"></polyline>
		<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
		<line x1="10" y1="11" x2="10" y2="17"></line>
		<line x1="14" y1="11" x2="14" y2="17"></line>
	</svg></div>`;
		}
		if (isPublished && showBadge) {
			publishedBadge = html`<div class="creation-published-badge" title="Published"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
		stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<circle cx="12" cy="12" r="10"></circle>
		<line x1="2" y1="12" x2="22" y2="12"></line>
		<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
	</svg></div>`;
		}
		if (isPublished && item.published_at) {
			publishedInfo = html`<div class="route-meta" title="${formatDateTime(item.published_at)}">Published ${formatRelativeTime(new
	Date(item.published_at))}</div>`;
		}
		card.innerHTML = html`<div class="route-media" aria-hidden="true"></div>${userDeletedBadge}${publishedBadge}<div class="route-details">
	<div class="route-details-content">
		<div class="route-title">${escapeHtml(item.title || 'Untitled')}</div>${publishedInfo}<div class="route-meta">
			${escapeHtml(formatDate(item.created_at) || '')}</div>
	</div>
</div>`;
		const mediaEl = card.querySelector('.route-media');
		const url = item.thumbnail_url || item.url;
		if (mediaEl && url) {
			mediaEl.dataset.bgUrl = url;
			observer.observe(mediaEl);
		}
		grid.appendChild(card);
	});
}

/** Appends user list items to the existing ul (avoids flash on load-more). */
function appendUserListItems(container, users, options = {}) {
	const ul = container?.querySelector('.user-profile-list');
	if (!ul || !Array.isArray(users) || users.length === 0) return;
	const { showUnfollow = false, showFollow = false, viewerFollowsByUserId = new Set(), viewerUserId = null } = options;
	const viewerFollows = (uid) => viewerFollowsByUserId instanceof Set ? viewerFollowsByUserId.has(uid) : Boolean(viewerFollowsByUserId[uid]);
	const isSelf = (uid) => viewerUserId != null && Number(uid) === Number(viewerUserId);

	users.forEach((u) => {
		const id = u?.user_id ?? u?.id;
		const name = (u?.display_name || u?.user_name || '').trim() || 'User';
		const handle = u?.user_name ? `@${u.user_name}` : '';
		const avatarUrl = typeof u?.avatar_url === 'string' ? u.avatar_url.trim() : '';
		const color = getAvatarColor(u?.user_name || u?.user_id || name);
		const initial = name.charAt(0).toUpperCase() || '?';
		const href = buildProfilePath({ userName: u?.user_name, userId: id }) || '#';
		const avatarContent = avatarUrl
			? html`<img class="user-profile-list-avatar-img" src="${escapeHtml(avatarUrl)}" alt="">`
			: html`<div class="user-profile-list-avatar-fallback" style="--user-profile-avatar-bg: ${color};" aria-hidden="true">${escapeHtml(initial)}</div>`;
		const hideActions = isSelf(id);
		const showUnfollowBtn = showUnfollow && id != null && !hideActions;
		const showFollowBtn = showFollow && id != null && !viewerFollows(Number(id)) && !hideActions;
		const li = document.createElement('li');
		li.className = 'user-profile-list-item';
		li.innerHTML = html`
			<a href="${escapeHtml(href)}" class="user-profile-list-link">
				<span class="user-profile-list-avatar">${avatarContent}</span>
				<span class="user-profile-list-info">
					<span class="user-profile-list-name">${escapeHtml(name)}</span>
					${handle ? html`<span class="user-profile-list-handle">${escapeHtml(handle)}</span>` : ''}
				</span>
			</a>
			${showUnfollowBtn ? html`<button type="button" class="btn-secondary user-profile-list-action" data-action="unfollow"
				data-user-id="${escapeHtml(String(id ?? ''))}">Unfollow</button>` : ''}
			${showFollowBtn ? html`<button type="button" class="btn-secondary user-profile-list-action" data-action="follow"
				data-user-id="${escapeHtml(String(id ?? ''))}">Follow</button>` : ''}
		`;
		ul.appendChild(li);
	});
}

/** Appends comment blocks to the existing list (avoids flash on load-more). */
function appendCommentsListItems(container, comments) {
	const listEl = container?.querySelector('.user-profile-comments-list');
	if (!listEl || !Array.isArray(comments) || comments.length === 0) return;

	function renderUserCell(u) {
		const id = u?.user_id ?? u?.id;
		const name = (u?.display_name || u?.user_name || '').trim() || 'User';
		const handle = u?.user_name ? `@${u.user_name}` : '';
		const avatarUrl = typeof u?.avatar_url === 'string' ? u.avatar_url.trim() : '';
		const color = getAvatarColor(u?.user_name || u?.user_id || name);
		const initial = name.charAt(0).toUpperCase() || '?';
		const href = buildProfilePath({ userName: u?.user_name, userId: id }) || '#';
		const avatarContent = avatarUrl
			? html`<img class="user-profile-comment-avatar-img" src="${escapeHtml(avatarUrl)}" alt="">`
			: html`<span class="user-profile-comment-avatar-fallback" style="--user-profile-avatar-bg: ${color};" aria-hidden="true">${escapeHtml(initial)}</span>`;
		return html`<a href="${escapeHtml(href)}" class="user-profile-comment-user"><span
		class="user-profile-comment-avatar">${avatarContent}</span><span class="user-profile-comment-user-info"><span
			class="user-profile-comment-user-name">${escapeHtml(name)}</span>${handle ? html`<span
			class="user-profile-comment-user-handle">${escapeHtml(handle)}</span>` : ''}</span></a>`;
	}

	comments.forEach((c) => {
		const creationId = c?.created_image_id;
		const title = (c?.created_image_title || 'Creation').trim() || 'Creation';
		const text = (c?.text || '').trim() || '';
		const createdAt = c?.created_at ? formatRelativeTime(new Date(c.created_at)) : '';
		const creationHref = Number.isFinite(creationId) && creationId > 0 ? `/creations/${creationId}` : '#';
		const thumbUrl = (c?.created_image_thumbnail_url || c?.created_image_url || '').trim();
		const creator = { user_id: c?.created_image_user_id, display_name: c?.creator_display_name, user_name: c?.creator_user_name, avatar_url: c?.creator_avatar_url };
		const commenter = { user_id: c?.user_id, display_name: c?.commenter_display_name, user_name: c?.commenter_user_name, avatar_url: c?.commenter_avatar_url };
		const div = document.createElement('div');
		div.className = 'user-profile-comment-block';
		div.innerHTML = html`
			<a href="${escapeHtml(creationHref)}" class="user-profile-comment-thumb">${thumbUrl ? html`<img
					src="${escapeHtml(thumbUrl)}" alt="" class="user-profile-comment-thumb-img" loading="lazy">` : html`<span
					class="user-profile-comment-thumb-placeholder">?</span>`}</a>
			<div class="user-profile-comment-title-creator">
				<a href="${escapeHtml(creationHref)}" class="user-profile-comment-name">${escapeHtml(title)}</a>
				<div class="user-profile-comment-creator">${renderUserCell(creator)}</div>
			</div>
			<div class="user-profile-comment-text">${escapeHtml(text)}</div>
			<div class="user-profile-comment-footer">${renderUserCell(commenter)}${createdAt ? html`<span
					class="user-profile-comment-date">${escapeHtml(createdAt)}</span>` : ''}</div>
		`;
		listEl.appendChild(div);
	});
}

async function loadProfileSummary(target) {
	const apiBase = buildTargetUserApiBase(target);
	if (!apiBase) throw new Error('Invalid target user');
	const result = await fetchJsonWithStatusDeduped(`${apiBase}/profile`, {
		credentials: 'include'
	}, { windowMs: 1000 });
	if (!result.ok) {
		throw new Error('Failed to load profile');
	}
	return result.data;
}

const PROFILE_PAGE_SIZE = {
	creations: 24,
	mentions: 24,
	likes: 24,
	comments: 20,
	follows: 20,
	following: 20
};

async function loadUserImages(target, { includeAll = false, limit = PROFILE_PAGE_SIZE.creations, offset = 0 } = {}) {
	const apiBase = buildTargetUserApiBase(target);
	if (!apiBase) throw new Error('Invalid target user');
	const params = new URLSearchParams();
	if (includeAll) params.set('include', 'all');
	params.set('limit', String(limit));
	params.set('offset', String(offset));
	const url = `${apiBase}/created-images?${params.toString()}`;
	const result = await fetchJsonWithStatusDeduped(url, { credentials: 'include' }, { windowMs: 800 });
	if (!result.ok) {
		throw new Error('Failed to load images');
	}
	const images = Array.isArray(result.data?.images) ? result.data.images : [];
	const has_more = Boolean(result.data?.has_more);
	return { images, has_more };
}

function renderUserList(container, users, emptyTitle, emptyMessage, options = {}) {
	if (!container) return;
	const { showUnfollow = false, showFollow = false, viewerFollowsByUserId = new Set(), viewerUserId = null } = options;
	const list = Array.isArray(users) ? users : [];
	if (list.length === 0) {
		container.innerHTML = html`
			<div class="route-empty">
				<div class="route-empty-title">${escapeHtml(emptyTitle)}</div>
				<div class="route-empty-message">${escapeHtml(emptyMessage)}</div>
			</div>
		`;
		return;
	}
	const viewerFollows = (uid) => viewerFollowsByUserId instanceof Set ? viewerFollowsByUserId.has(uid) : Boolean(viewerFollowsByUserId[uid]);
	const isSelf = (uid) => viewerUserId != null && Number(uid) === Number(viewerUserId);
	container.innerHTML = html`
		<ul class="user-profile-list">
			${list.map((u) => {
			const id = u?.user_id ?? u?.id;
			const name = (u?.display_name || u?.user_name || '').trim() || 'User';
			const handle = u?.user_name ? `@${u.user_name}` : '';
			const avatarUrl = typeof u?.avatar_url === 'string' ? u.avatar_url.trim() : '';
			const color = getAvatarColor(u?.user_name || u?.user_id || name);
			const initial = name.charAt(0).toUpperCase() || '?';
			const href = buildProfilePath({ userName: u?.user_name, userId: id }) || '#';
			const avatarContent = avatarUrl
			? html`<img class="user-profile-list-avatar-img" src="${escapeHtml(avatarUrl)}" alt="">`
			: html`<div class="user-profile-list-avatar-fallback" style="--user-profile-avatar-bg: ${color};"
				aria-hidden="true">${escapeHtml(initial)}</div>`;
			const hideActions = isSelf(id);
			const showUnfollowBtn = showUnfollow && id != null && !hideActions;
			const showFollowBtn = showFollow && id != null && !viewerFollows(Number(id)) && !hideActions;
			return html`
			<li class="user-profile-list-item">
				<a href="${escapeHtml(href)}" class="user-profile-list-link">
					<span class="user-profile-list-avatar">${avatarContent}</span>
					<span class="user-profile-list-info">
						<span class="user-profile-list-name">${escapeHtml(name)}</span>
						${handle ? html`<span class="user-profile-list-handle">${escapeHtml(handle)}</span>` : ''}
					</span>
				</a>
				${showUnfollowBtn ? html`<button type="button" class="btn-secondary user-profile-list-action"
					data-action="unfollow" data-user-id="${escapeHtml(String(id ?? ''))}">Unfollow</button>` : ''}
				${showFollowBtn ? html`<button type="button" class="btn-secondary user-profile-list-action" data-action="follow"
					data-user-id="${escapeHtml(String(id ?? ''))}">Follow</button>` : ''}
			</li>
			`;
			}).join('')}
		</ul>
	`;
}

function renderCommentsList(container, comments, emptyMessage) {
	if (!container) return;
	const list = Array.isArray(comments) ? comments : [];
	if (list.length === 0) {
		container.innerHTML = html`
			<div class="route-empty">
				<div class="route-empty-title">No comments yet</div>
				<div class="route-empty-message">${escapeHtml(emptyMessage)}</div>
			</div>
		`;
		return;
	}
	function renderUserCell(u, prefix) {
		const id = u?.user_id ?? u?.id;
		const name = (u?.display_name || u?.user_name || '').trim() || 'User';
		const handle = u?.user_name ? `@${u.user_name}` : '';
		const avatarUrl = typeof u?.avatar_url === 'string' ? u.avatar_url.trim() : '';
		const color = getAvatarColor(u?.user_name || u?.user_id || name);
		const initial = name.charAt(0).toUpperCase() || '?';
		const href = buildProfilePath({ userName: u?.user_name, userId: id }) || '#';
		const avatarContent = avatarUrl
			? html`<img class="user-profile-comment-avatar-img" src="${escapeHtml(avatarUrl)}" alt="">`
			: html`<span class="user-profile-comment-avatar-fallback" style="--user-profile-avatar-bg: ${color};" aria-hidden="true">${escapeHtml(initial)}</span>`;
		return html`
			<a href="${escapeHtml(href)}" class="user-profile-comment-user">
				<span class="user-profile-comment-avatar">${avatarContent}</span>
				<span class="user-profile-comment-user-info">
					<span class="user-profile-comment-user-name">${escapeHtml(name)}</span>
					${handle ? html`<span class="user-profile-comment-user-handle">${escapeHtml(handle)}</span>` : ''}
				</span>
			</a>
		`;
	}
	container.innerHTML = html`
		<div class="user-profile-comments-list">
			${list.map((c) => {
			const creationId = c?.created_image_id;
			const title = (c?.created_image_title || 'Creation').trim() || 'Creation';
			const text = (c?.text || '').trim() || '';
			const createdAt = c?.created_at ? formatRelativeTime(new Date(c.created_at)) : '';
			const creationHref = Number.isFinite(creationId) && creationId > 0 ? `/creations/${creationId}` : '#';
			const thumbUrl = (c?.created_image_thumbnail_url || c?.created_image_url || '').trim();
			const creator = {
			user_id: c?.created_image_user_id,
			display_name: c?.creator_display_name,
			user_name: c?.creator_user_name,
			avatar_url: c?.creator_avatar_url
			};
			const commenter = {
			user_id: c?.user_id,
			display_name: c?.commenter_display_name,
			user_name: c?.commenter_user_name,
			avatar_url: c?.commenter_avatar_url
			};
			return html`
			<div class="user-profile-comment-block">
				<a href="${escapeHtml(creationHref)}" class="user-profile-comment-thumb">
					${thumbUrl ? html`<img src="${escapeHtml(thumbUrl)}" alt="" class="user-profile-comment-thumb-img"
						loading="lazy">` : html`<span class="user-profile-comment-thumb-placeholder">?</span>`}
				</a>
				<div class="user-profile-comment-title-creator">
					<a href="${escapeHtml(creationHref)}" class="user-profile-comment-name">${escapeHtml(title)}</a>
					<div class="user-profile-comment-creator">${renderUserCell(creator, 'creator')}</div>
				</div>
				<div class="user-profile-comment-text">${escapeHtml(text)}</div>
				<div class="user-profile-comment-footer">
					${renderUserCell(commenter, 'commenter')}
					${createdAt ? html`<span class="user-profile-comment-date">${escapeHtml(createdAt)}</span>` : ''}
				</div>
			</div>
			`;
			}).join('')}
		</div>
	`;
}

async function loadPersonalityCreations(personality, { limit = 100, offset = 0 } = {}) {
	const normalized = String(personality || '').trim().toLowerCase();
	const url = `/api/personalities/${encodeURIComponent(normalized)}/creations?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
	const result = await fetchJsonWithStatusDeduped(url, { credentials: 'include' }, { windowMs: 1200 });
	if (!result.ok) {
		throw new Error('Failed to search personality creations');
	}
	const items = Array.isArray(result.data?.images) ? result.data.images : [];
	return { items, hasMore: Boolean(result.data?.has_more) };
}

async function loadTagCreations(tag, { limit = 100, offset = 0 } = {}) {
	const normalized = String(tag || '').trim().toLowerCase();
	const url = `/api/tags/${encodeURIComponent(normalized)}/creations?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
	const result = await fetchJsonWithStatusDeduped(url, { credentials: 'include' }, { windowMs: 1200 });
	if (!result.ok) {
		throw new Error('Failed to search tag creations');
	}
	const items = Array.isArray(result.data?.images) ? result.data.images : [];
	return { items, hasMore: Boolean(result.data?.has_more) };
}

function renderPersonalityDiscoveryPage(container, personality, items, { hasMore = false, prefix = '@' } = {}) {
	const safePersonality = String(personality || '').trim().toLowerCase();
	const token = `${prefix}${safePersonality}`;
	container.innerHTML = html`
		<div class="route-header">
			<h3>${escapeHtml(token)}</h3>
		</div>
		<div class="route-cards content-cards-image-grid" data-personality-grid>
			<div class="route-empty route-empty-image-grid route-loading">
				<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
			</div>
		</div>
		${hasMore ? html`<div class="route-empty">
			<div class="route-empty-message">Showing top results. Refine the personality name to narrow matches.</div>
		</div>` : ''}
	`;
	const grid = container.querySelector('[data-personality-grid]');
	renderImageGrid(
		grid,
		items,
		false,
		'No results found',
		`No creations currently match ${token}.`
	);
}

async function init() {
	const container = document.querySelector('.user-profile-page');
	if (!container) return;
	const serverContext = getServerProfileContext();

	const info = getPathUserTarget();
	let target = { mode: info.mode, userId: info.userId, userName: info.userName };

	if (info.kind === 'me') {
		const me = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 500 })
			.catch(() => ({ ok: false, status: 0, data: null }));
		if (!me.ok) {
			renderProfileUnavailableState(container, {
				title: 'Please log in',
				message: 'Sign in to view your profile.',
				icon: 'warning'
			});
			return;
		}
		target = { mode: 'id', userId: me.data?.id ?? null, userName: null };
	}

	// For server-sent /user/:id or /p/:personality routes where no backing user exists,
	// render a stable "not found" profile state instead of surfacing a hard error.
	const requestedType = typeof serverContext?.requested?.type === 'string' ? serverContext.requested.type : '';
	const targetExists = serverContext?.resolved?.target_exists;
	if (requestedType === 'user-id' && targetExists === false) {
		renderProfileUnavailableState(container, {
			title: 'User not found',
			message: 'User not found!',
			icon: 'user-not-found'
		});
		return;
	}
	if (requestedType === 'user-name' && targetExists === false) {
		const personality = String(serverContext?.requested?.user_name || target?.userName || '').trim().toLowerCase();
		if (!personality) {
			renderProfileUnavailableState(container, {
				title: 'Personality not found',
				message: 'This personality could not be resolved.',
				icon: 'warning'
			});
			return;
		}
		try {
			const result = await loadPersonalityCreations(personality, { limit: 100, offset: 0 });
			if (!Array.isArray(result.items) || result.items.length === 0) {
				renderProfileUnavailableState(container, {
					title: 'Personality not found',
					message: `No results found for @${personality}.`,
					icon: 'user-not-found'
				});
				return;
			}
			renderPersonalityDiscoveryPage(container, personality, result.items, { hasMore: result.hasMore });
		} catch {
			renderProfileUnavailableState(container, {
				title: 'Unable to load personality results',
				message: 'An error occurred while searching creations for this personality.',
				icon: 'warning'
			});
		}
		return;
	}
	if (requestedType === 'tag') {
		const tag = String(serverContext?.requested?.user_name || target?.userName || '').trim().toLowerCase();
		if (!tag) {
			renderProfileUnavailableState(container, {
				title: 'Tag not found',
				message: 'No results found.',
				icon: 'warning'
			});
			return;
		}
		try {
			const result = await loadTagCreations(tag, { limit: 100, offset: 0 });
			if (!Array.isArray(result.items) || result.items.length === 0) {
				renderProfileUnavailableState(container, {
					title: 'Tag not found',
					message: `No results found for #${tag}.`,
					icon: 'user-not-found'
				});
				return;
			}
			renderPersonalityDiscoveryPage(container, tag, result.items, { hasMore: result.hasMore, prefix: '#' });
		} catch {
			renderProfileUnavailableState(container, {
				title: 'Unable to load tag results',
				message: 'An error occurred while searching creations for this tag.',
				icon: 'warning'
			});
		}
		return;
	}

	const targetApiBase = buildTargetUserApiBase(target);
	if (!targetApiBase) {
		renderProfileUnavailableState(container, {
			title: 'User not found',
			message: 'This profile could not be resolved.',
			icon: 'user-not-found'
		});
		return;
	}

	let summary;
	try {
		summary = await loadProfileSummary(target);
	} catch {
		renderProfileUnavailableState(container, {
			title: 'Unable to load profile',
			message: 'An error occurred while loading this profile.',
			icon: 'warning'
		});
		return;
	}

	const user = summary.user || {};
	const profile = summary.profile || {};
	const stats = summary.stats || {};
	const isSelf = Boolean(summary.is_self);
	const viewerFollows = Boolean(summary.viewer_follows);

	// Get current user for admin role and to hide follow/unfollow on self in lists
	let isAdmin = false;
	let viewerUserId = null;
	try {
		const currentUser = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 500 });
		if (currentUser.ok && currentUser.data) {
			isAdmin = currentUser.data.role === 'admin';
			if (currentUser.data.id != null) viewerUserId = Number(currentUser.data.id);
		}
	} catch {
		// ignore errors
	}

	// Normalize json fields in case adapter returned strings (sqlite)
	profile.socials = safeJsonParse(profile.socials, {});
	profile.badges = safeJsonParse(profile.badges, []);
	profile.meta = safeJsonParse(profile.meta, {});

	renderProfilePage(container, { user, profile, stats, plan: summary.plan, isSelf, viewerFollows, isAdmin });

	// Hydrate any links in user-generated content (e.g., About field)
	hydrateUserTextLinks(container);

	const grid = container.querySelector('[data-profile-grid]');
	const overlay = container.querySelector('[data-profile-edit-overlay]');

	// Keep last tab content height so we can set min-height when loading another tab (prevents scroll jump)
	let lastTabContentHeight = 0;

	// Tab state: { items, hasMore } per tab for pagination
	const tabData = {
		creations: { items: [], hasMore: false },
		mentions: { items: [], hasMore: false },
		likes: { items: [], hasMore: false },
		follows: { items: [], hasMore: false },
		following: { items: [], hasMore: false },
		comments: { items: [], hasMore: false }
	};

	const profileUserName = (profile?.user_name ?? '').trim().toLowerCase();

	const infiniteScrollByTab = {};

	function updateLoadMore(containerEl, tabId, hasMore) {
		const el = containerEl.querySelector(`[data-profile-load-more="${tabId}"]`);
		if (!el) return;
		if (hasMore) {
			el.hidden = false;
			el.innerHTML = html`<div class="user-profile-load-more-inner"><button type="button" class="btn-secondary user-profile-load-more-btn"
		data-load-more-tab="${escapeHtml(tabId)}">Load more</button></div>`;
		} else {
			el.hidden = true;
			el.innerHTML = '';
		}
		if (infiniteScrollByTab[tabId]) {
			infiniteScrollByTab[tabId].setHasMore(hasMore);
		}
	}

	function setupInfiniteScrollForTab(tabId, listContainer) {
		if (!listContainer || infiniteScrollByTab[tabId]) return;
		infiniteScrollByTab[tabId] = createInfiniteScroll({
			listContainer,
			rootMargin: '400px 0px',
			onLoadMore: async () => {
				await loadMoreForTab(tabId);
				return { hasMore: tabData[tabId]?.hasMore ?? false };
			}
		});
	}

	function renderTabContent(tabId) {
		const data = tabData[tabId];
		if (!data) return;
		if (tabId === 'creations') {
			renderImageGrid(grid, data.items, showBadge);
			updateLoadMore(container, 'creations', data.hasMore);
		} else if (tabId === 'mentions') {
			const panel = container.querySelector('[data-profile-mentions]');
			if (panel) {
				renderImageGrid(panel, data.items, false, 'No mentions yet', `Creations that mention @${escapeHtml(profileUserName)} will appear here.`);
				updateLoadMore(container, 'mentions', data.hasMore);
			}
		} else if (tabId === 'likes') {
			const panel = container.querySelector('[data-profile-likes]');
			if (panel) {
				renderImageGrid(panel, data.items, false, 'No likes yet', 'Creations this user likes will appear here.');
				updateLoadMore(container, 'likes', data.hasMore);
			}
		} else if (tabId === 'follows') {
			const panel = container.querySelector('[data-profile-follows]');
			if (panel) {
				renderUserList(panel, data.items, isSelf ? "You're not following anyone yet" : "This user isn't following anyone yet", isSelf ? "When you follow others, they'll show up here." : "When this user follows others, they'll show up here.", { showUnfollow: true, viewerUserId });
				updateLoadMore(container, 'follows', data.hasMore);
			}
		} else if (tabId === 'following') {
			const panel = container.querySelector('[data-profile-following]');
			if (panel) {
				const viewerFollowsSet = new Set((data.items || []).filter((u) => u?.viewer_follows === true).map((u) => Number(u?.user_id ?? u?.id)).filter(Number.isFinite));
				renderUserList(panel, data.items, isSelf ? "No one follows you yet" : "No followers yet", isSelf ? "When others follow you, they'll show up here." : "When others follow this user, they'll show up here.", { showFollow: true, viewerFollowsByUserId: viewerFollowsSet, viewerUserId });
				updateLoadMore(container, 'following', data.hasMore);
			}
		} else if (tabId === 'comments') {
			const panel = container.querySelector('[data-profile-comments]');
			if (panel) {
				renderCommentsList(panel, data.items, 'Comments this user has left will appear here.');
				updateLoadMore(container, 'comments', data.hasMore);
			}
		}
	}

	// Creations tab: initial load with limit
	const includeAllForAdmin = isAdmin;
	const showBadge = isAdmin;
	try {
		const result = await loadUserImages(target, { includeAll: includeAllForAdmin, limit: PROFILE_PAGE_SIZE.creations, offset: 0 });
		tabData.creations = { items: result.images, hasMore: result.has_more };
	} catch {
		tabData.creations = { items: [], hasMore: false };
	}
	renderImageGrid(grid, tabData.creations.items, showBadge);
	updateLoadMore(container, 'creations', tabData.creations.hasMore);
	setupInfiniteScrollForTab('creations', grid);
	const creationsWrapper = container.querySelector('[data-profile-tab-content="creations"]');
	if (creationsWrapper) lastTabContentHeight = creationsWrapper.offsetHeight;

	// Lazy-load Likes, Follows, Following, Comments when user switches to that tab
	const tabsEl = container.querySelector('[data-profile-tabs]');
	const loadedTabs = new Set(['creations']);
	const loadingHtml = html`<div class="route-empty route-loading">
	<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
</div>`;

	async function loadTabContent(tabId, forceRefresh = false) {
		if (!forceRefresh && loadedTabs.has(tabId)) return;
		const selectors = {
			mentions: '[data-profile-mentions]',
			likes: '[data-profile-likes]',
			follows: '[data-profile-follows]',
			following: '[data-profile-following]',
			comments: '[data-profile-comments]'
		};
		const panel = container.querySelector(selectors[tabId]);
		if (!panel) return;
		const tabContentWrapper = panel.closest('[data-profile-tab-content]');
		if (!forceRefresh) {
			if (tabContentWrapper && lastTabContentHeight > 0) {
				tabContentWrapper.style.minHeight = `${lastTabContentHeight}px`;
			}
			panel.innerHTML = loadingHtml;
			loadedTabs.add(tabId);
		}
		try {
			if (tabId === 'mentions') {
				const limit = PROFILE_PAGE_SIZE.mentions;
				const result = await loadPersonalityCreations(profileUserName, { limit, offset: 0 });
				tabData.mentions = { items: result.items, hasMore: result.hasMore };
				panel.className = 'route-cards content-cards-image-grid';
				panel.setAttribute('data-profile-mentions', '');
				panel.innerHTML = '';
				renderImageGrid(panel, tabData.mentions.items, false, 'No mentions yet', `Creations that mention @${escapeHtml(profileUserName)} will appear here.`);
				updateLoadMore(container, 'mentions', tabData.mentions.hasMore);
				setupInfiniteScrollForTab('mentions', panel);
			} else if (tabId === 'likes') {
				const limit = PROFILE_PAGE_SIZE.likes;
				const res = await fetchJsonWithStatusDeduped(`${targetApiBase}/liked-creations?limit=${limit}&offset=0`, { credentials: 'include' }, { windowMs: 800 });
				const images = Array.isArray(res?.data?.images) ? res.data.images : [];
				tabData.likes = { items: images, hasMore: Boolean(res?.data?.has_more) };
				panel.className = 'route-cards content-cards-image-grid';
				panel.setAttribute('data-profile-likes', '');
				panel.innerHTML = '';
				renderImageGrid(panel, tabData.likes.items, false, 'No likes yet', 'Creations this user likes will appear here.');
				updateLoadMore(container, 'likes', tabData.likes.hasMore);
				setupInfiniteScrollForTab('likes', panel);
			} else if (tabId === 'follows') {
				const limit = PROFILE_PAGE_SIZE.follows;
				const res = await fetchJsonWithStatusDeduped(`${targetApiBase}/following?limit=${limit}&offset=0`, { credentials: 'include' }, { windowMs: 800 });
				const users = Array.isArray(res?.data?.following) ? res.data.following : [];
				tabData.follows = { items: users, hasMore: Boolean(res?.data?.has_more) };
				const followsEmptyTitle = isSelf ? "You're not following anyone yet" : 'This user isn\'t following anyone yet';
				const followsEmptyMsg = isSelf ? "When you follow others, they'll show up here." : "When this user follows others, they'll show up here.";
				renderUserList(panel, users, followsEmptyTitle, followsEmptyMsg, { showUnfollow: true, viewerUserId });
				updateLoadMore(container, 'follows', tabData.follows.hasMore);
				setupInfiniteScrollForTab('follows', panel);
			} else if (tabId === 'following') {
				const limit = PROFILE_PAGE_SIZE.following;
				const res = await fetchJsonWithStatusDeduped(`${targetApiBase}/followers?limit=${limit}&offset=0`, { credentials: 'include' }, { windowMs: 800 });
				const users = Array.isArray(res?.data?.followers) ? res.data.followers : [];
				tabData.following = { items: users, hasMore: Boolean(res?.data?.has_more) };
				const viewerFollowsSet = new Set(
					(users || []).filter((u) => u?.viewer_follows === true).map((u) => Number(u?.user_id ?? u?.id)).filter(Number.isFinite)
				);
				const followingEmptyTitle = isSelf ? "No one follows you yet" : 'No followers yet';
				const followingEmptyMsg = isSelf ? "When others follow you, they'll show up here." : "When others follow this user, they'll show up here.";
				renderUserList(panel, users, followingEmptyTitle, followingEmptyMsg, { showFollow: true, viewerFollowsByUserId: viewerFollowsSet, viewerUserId });
				updateLoadMore(container, 'following', tabData.following.hasMore);
				setupInfiniteScrollForTab('following', panel);
			} else if (tabId === 'comments') {
				const limit = PROFILE_PAGE_SIZE.comments;
				const res = await fetchJsonWithStatusDeduped(`${targetApiBase}/comments?limit=${limit}&offset=0`, { credentials: 'include' }, { windowMs: 800 });
				const comments = Array.isArray(res?.data?.comments) ? res.data.comments : [];
				tabData.comments = { items: comments, hasMore: Boolean(res?.data?.has_more) };
				renderCommentsList(panel, comments, 'Comments this user has left will appear here.');
				updateLoadMore(container, 'comments', tabData.comments.hasMore);
				setupInfiniteScrollForTab('comments', panel);
			}
			if (tabContentWrapper) {
				requestAnimationFrame(() => {
					tabContentWrapper.style.minHeight = '';
					lastTabContentHeight = tabContentWrapper.offsetHeight;
				});
			}
		} catch {
			if (tabContentWrapper) tabContentWrapper.style.minHeight = '';
			panel.innerHTML = html`<div class="route-empty">
	<div class="route-empty-title">Unable to load</div>
	<div class="route-empty-message">Something went wrong. Try again later.</div>
</div>`;
			loadedTabs.delete(tabId);
		}
	}

	async function loadMoreForTab(tabId) {
		const data = tabData[tabId];
		if (!data || !data.hasMore) return;
		const offset = data.items.length;
		const limit = PROFILE_PAGE_SIZE[tabId] ?? 20;
		const loadMoreEl = container.querySelector(`[data-profile-load-more="${tabId}"]`);
		const btn = loadMoreEl?.querySelector('.user-profile-load-more-btn');
		if (btn) btn.disabled = true;
		try {
			if (tabId === 'creations') {
				const result = await loadUserImages(target, { includeAll: includeAllForAdmin, limit, offset });
				data.items = data.items.concat(result.images);
				data.hasMore = result.has_more;
				appendImageGridCards(grid, result.images, showBadge);
			} else if (tabId === 'mentions') {
				const result = await loadPersonalityCreations(profileUserName, { limit, offset });
				data.items = data.items.concat(result.items);
				data.hasMore = result.hasMore;
				const panel = container.querySelector('[data-profile-mentions]');
				if (panel) appendImageGridCards(panel, result.items, false);
			} else if (tabId === 'likes') {
				const res = await fetchJsonWithStatusDeduped(`${targetApiBase}/liked-creations?limit=${limit}&offset=${offset}`, { credentials: 'include' }, { windowMs: 800 });
				const images = Array.isArray(res?.data?.images) ? res.data.images : [];
				data.items = data.items.concat(images);
				data.hasMore = Boolean(res?.data?.has_more);
				const panel = container.querySelector('[data-profile-likes]');
				if (panel) appendImageGridCards(panel, images, false);
			} else if (tabId === 'follows') {
				const res = await fetchJsonWithStatusDeduped(`${targetApiBase}/following?limit=${limit}&offset=${offset}`, { credentials: 'include' }, { windowMs: 800 });
				const users = Array.isArray(res?.data?.following) ? res.data.following : [];
				data.items = data.items.concat(users);
				data.hasMore = Boolean(res?.data?.has_more);
				const panel = container.querySelector('[data-profile-follows]');
				if (panel) appendUserListItems(panel, users, { showUnfollow: true, viewerUserId });
			} else if (tabId === 'following') {
				const res = await fetchJsonWithStatusDeduped(`${targetApiBase}/followers?limit=${limit}&offset=${offset}`, { credentials: 'include' }, { windowMs: 800 });
				const users = Array.isArray(res?.data?.followers) ? res.data.followers : [];
				data.items = data.items.concat(users);
				data.hasMore = Boolean(res?.data?.has_more);
				const panel = container.querySelector('[data-profile-following]');
				const viewerFollowsSet = new Set((data.items || []).filter((u) => u?.viewer_follows === true).map((u) => Number(u?.user_id ?? u?.id)).filter(Number.isFinite));
				if (panel) appendUserListItems(panel, users, { showFollow: true, viewerFollowsByUserId: viewerFollowsSet, viewerUserId });
			} else if (tabId === 'comments') {
				const res = await fetchJsonWithStatusDeduped(`${targetApiBase}/comments?limit=${limit}&offset=${offset}`, { credentials: 'include' }, { windowMs: 800 });
				const comments = Array.isArray(res?.data?.comments) ? res.data.comments : [];
				data.items = data.items.concat(comments);
				data.hasMore = Boolean(res?.data?.has_more);
				const panel = container.querySelector('[data-profile-comments]');
				if (panel) appendCommentsListItems(panel, comments);
			}
			updateLoadMore(container, tabId, data.hasMore);
		} finally {
			if (btn) btn.disabled = false;
		}
	}

	if (tabsEl) {
		tabsEl.addEventListener('tab-change', (e) => {
			const id = e.detail?.id;
			if (id && ['mentions', 'likes', 'follows', 'following', 'comments'].includes(id)) {
				void loadTabContent(id);
			}
			// Remember tab in URL so refresh keeps the same tab
			if (id) {
				const base = `${window.location.pathname}${window.location.search}`;
				const newUrl = `${base}#${id}`;
				if (window.location.hash !== `#${id}`) {
					history.replaceState(undefined, '', newUrl);
				}
			}
		});

		// Restore tab from URL hash on load
		const hashTab = (window.location.hash || '').replace(/^#/, '');
		if (hashTab && ['creations', 'mentions', 'likes', 'follows', 'following', 'comments'].includes(hashTab) && hashTab !== 'creations') {
			tabsEl.setActiveTab(hashTab, { focus: false });
			void loadTabContent(hashTab);
		}

		// Show tab bar now that initial tab has been auto-selected (and content loaded)
		tabsEl.classList.remove('user-profile-tabs-pending');
	}

	// Load more button (event delegation)
	container.addEventListener('click', async (e) => {
		const loadMoreBtn = e.target?.closest?.('.user-profile-load-more-btn');
		if (loadMoreBtn && loadMoreBtn instanceof HTMLButtonElement) {
			const tabId = loadMoreBtn.getAttribute('data-load-more-tab');
			if (tabId) {
				e.preventDefault();
				await loadMoreForTab(tabId);
			}
			return;
		}

		const btn = e.target?.closest?.('[data-action="unfollow"], [data-action="follow"]');
		if (!btn || !(btn instanceof HTMLButtonElement)) return;
		e.preventDefault();
		const userId = Number.parseInt(btn.getAttribute('data-user-id') || '', 10);
		if (!Number.isFinite(userId) || userId <= 0) return;
		const action = btn.getAttribute('data-action');
		const panel = btn.closest('[data-profile-follows], [data-profile-following]');
		const tabId = panel?.hasAttribute('data-profile-follows') ? 'follows' : panel?.hasAttribute('data-profile-following') ? 'following' : null;
		if (!tabId) return;
		btn.disabled = true;
		const method = action === 'unfollow' ? 'DELETE' : 'POST';
		const result = await fetchJsonWithStatusDeduped(`/api/users/${userId}/follow`, {
			method,
			credentials: 'include'
		}, { windowMs: 0 }).catch(() => ({ ok: false }));
		btn.disabled = false;
		if (result?.ok) {
			await loadTabContent(tabId, true);
		}
	});

	const shareButton = container.querySelector('.user-profile-share');
	if (shareButton) {
		shareButton.addEventListener('click', async () => {
			const link = window.location.href;
			const ok = await copyTextToClipboard(link);
			shareButton.textContent = ok ? 'Copied' : 'Copy failed';
			setTimeout(() => { shareButton.textContent = 'Share'; }, 1200);
		});
	}

	const followButton = container.querySelector('[data-follow-button]');
	if (followButton && !isSelf) {
		let busy = false;
		let following = viewerFollows;

		function updateButton() {
			followButton.textContent = following ? 'Unfollow' : 'Follow';
			followButton.classList.toggle('btn-secondary', following);
			followButton.classList.toggle('btn-primary', !following);
			followButton.disabled = busy;
		}

		updateButton();

		followButton.addEventListener('click', async () => {
			if (busy) return;
			const targetIdRaw = followButton.getAttribute('data-follow-user-id') || '';
			const targetId = Number.parseInt(targetIdRaw, 10);
			if (!Number.isFinite(targetId) || targetId <= 0) return;

			busy = true;
			const prev = following;
			// Optimistic toggle
			following = !following;
			updateButton();

			const method = prev ? 'DELETE' : 'POST';
			const result = await fetchJsonWithStatusDeduped(`/api/users/${targetId}/follow`, {
				method,
				credentials: 'include'
			}, { windowMs: 0 }).catch(() => ({ ok: false, status: 0, data: null }));

			if (!result.ok) {
				// Roll back optimistic change
				following = prev;
			}
			busy = false;
			updateButton();
		});
	}

	const editButton = container.querySelector('.user-profile-edit');
	if (editButton && overlay) {
		editButton.addEventListener('click', () => setModalOpen(overlay, true));
	}

	const closeButton = container.querySelector('[data-profile-edit-close]');
	const cancelButton = container.querySelector('[data-profile-edit-cancel]');
	const saveButton = container.querySelector('[data-profile-edit-save]');
	const form = container.querySelector('[data-profile-edit-form]');
	const errorBox = container.querySelector('[data-profile-edit-error]');
	const generatingOverlay = container.querySelector('[data-profile-edit-generating-overlay]');
	const avatarGeneratingPlaceholder = container.querySelector('[data-avatar-generating-placeholder]');
	const generateConfirmOverlay = container.querySelector('[data-profile-generate-confirm-overlay]');
	const generateConfirmClose = container.querySelector('[data-profile-generate-confirm-close]');
	const generateConfirmCancel = container.querySelector('[data-profile-generate-confirm-cancel]');
	const generateConfirmCta = container.querySelector('[data-profile-generate-confirm-cta]');
	const generateConfirmBody = container.querySelector('[data-profile-generate-confirm-body]');
	const avatarTryUrlInput = container.querySelector('[data-avatar-try-url]');

	// Banner strip aspect (width/height) and max output size. Matches .user-profile-banner (180px height, wide).
	const BANNER_ASPECT = 7; // 1260/180
	const BANNER_MAX_WIDTH = 1260;
	const BANNER_MAX_HEIGHT = 180;

	// Resize image file for smaller uploads (canvas + toBlob). Returns a Promise<Blob>.
	function resizeImageFile(file, { maxWidth, maxHeight, quality = 0.9, mimeType = 'image/jpeg' } = {}) {
		if (!(file instanceof File) || !file.type.startsWith('image/')) {
			return Promise.reject(new Error('Not an image file'));
		}
		return new Promise((resolve, reject) => {
			const img = new Image();
			const url = URL.createObjectURL(file);
			img.onload = () => {
				URL.revokeObjectURL(url);
				const w = img.naturalWidth;
				const h = img.naturalHeight;
				let targetW = w;
				let targetH = h;
				if (maxWidth > 0 && maxHeight > 0 && (w > maxWidth || h > maxHeight)) {
					const r = Math.min(maxWidth / w, maxHeight / h);
					targetW = Math.round(w * r);
					targetH = Math.round(h * r);
				}
				const canvas = document.createElement('canvas');
				canvas.width = targetW;
				canvas.height = targetH;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					reject(new Error('Canvas not supported'));
					return;
				}
				ctx.drawImage(img, 0, 0, targetW, targetH);
				canvas.toBlob(
					(blob) => (blob ? resolve(blob) : reject(new Error('Resize failed'))),
					mimeType,
					quality
				);
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error('Failed to load image'));
			};
			img.src = url;
		});
	}

	// Crop image to the top strip (banner aspect) then resize. Only the strip is uploaded.
	function resizeCoverToBannerStrip(file, { quality = 0.85, mimeType = 'image/jpeg' } = {}) {
		if (!(file instanceof File) || !file.type.startsWith('image/')) {
			return Promise.reject(new Error('Not an image file'));
		}
		return new Promise((resolve, reject) => {
			const img = new Image();
			const url = URL.createObjectURL(file);
			img.onload = () => {
				URL.revokeObjectURL(url);
				const w = img.naturalWidth;
				const h = img.naturalHeight;
				// Always take the top strip only: full width, height = just enough for banner aspect.
				const sx = 0;
				const sy = 0;
				const sw = w;
				const sh = Math.max(1, Math.min(h, Math.round(w / BANNER_ASPECT)));
				// Scale crop to max banner size.
				let targetW = sw;
				let targetH = sh;
				if (sw > BANNER_MAX_WIDTH || sh > BANNER_MAX_HEIGHT) {
					const r = Math.min(BANNER_MAX_WIDTH / sw, BANNER_MAX_HEIGHT / sh);
					targetW = Math.round(sw * r);
					targetH = Math.round(sh * r);
				}
				const canvas = document.createElement('canvas');
				canvas.width = targetW;
				canvas.height = targetH;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					reject(new Error('Canvas not supported'));
					return;
				}
				ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
				canvas.toBlob(
					(blob) => (blob ? resolve(blob) : reject(new Error('Resize failed'))),
					mimeType,
					quality
				);
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error('Failed to load image'));
			};
			img.src = url;
		});
	}

	// Generate avatar from character (try endpoint); state and helpers
	const TRY_POLL_MS = 2000;
	const TRY_MAX_POLLS = 120;
	const TRY_SERVER_ID = 1;
	const TRY_METHOD = 'fluxImageKlein';

	function buildAvatarPrompt(description, variationKey) {
		const core = typeof description === 'string' ? description.trim() : '';
		return [
			`Portrait of ${core}. Avoid showing body, focus on face and head.`,
			'Head-and-shoulders framing, square composition.',
			'Clean, plain and simple background colorful and contrasting with subject.',
			'Expressive eyes, clear facial details, emotive head position.',
			'Stylized digital portrait suitable for a social profile photo.',
			`No text, no logo, no watermark, no frame. Variation hint: ${variationKey}.`
		].join('\n');
	}

	async function ensureTryIdentityCookie() {
		const tz = typeof Intl !== 'undefined' && Intl.DateTimeFormat
			? (Intl.DateTimeFormat().resolvedOptions()?.timeZone || '')
			: '';
		const screenHint = typeof window.screen !== 'undefined'
			? `${window.screen.width}x${window.screen.height}`
			: '';
		await fetch('/api/policy/seen', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ tz, screen: screenHint })
		}).catch(() => null);
	}

	async function createTryImage(prompt, options = {}) {
		const { chargeCredits = 0 } = options;
		const response = await fetch('/api/try/create', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				server_id: TRY_SERVER_ID,
				method: TRY_METHOD,
				args: { prompt, resolution: 'ai_latest' },
				...(chargeCredits > 0 ? { charge_credits: chargeCredits } : {})
			})
		});
		const data = await response.json().catch(() => ({}));
		return { ok: response.ok, status: response.status, data };
	}

	async function pollTryImageById(id) {
		for (let i = 0; i < TRY_MAX_POLLS; i++) {
			await new Promise((r) => setTimeout(r, TRY_POLL_MS));
			const listRes = await fetch('/api/try/list', { credentials: 'include' }).catch(() => null);
			if (!listRes?.ok) continue;
			const list = await listRes.json().catch(() => []);
			const item = Array.isArray(list) ? list.find((entry) => Number(entry?.id) === Number(id)) : null;
			if (!item) continue;
			if (item.status === 'completed' && typeof item.url === 'string' && item.url.trim()) {
				return { ok: true, url: item.url.trim() };
			}
			if (item.status === 'failed') {
				return { ok: false, error: String(item.meta?.error || '').trim() || 'Generation failed.' };
			}
		}
		return { ok: false, error: 'Timed out. Try again.' };
	}

	async function discardTryImage(url) {
		if (!url || typeof url !== 'string' || !url.trim()) return;
		await fetch('/api/try/discard', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ url: url.trim() })
		}).catch(() => null);
	}

	let generatedAvatarBlob = null;
	let generatedAvatarObjectUrl = null;
	let isGeneratingAvatar = false;

	function revokeGeneratedAvatar() {
		if (generatedAvatarObjectUrl) {
			try { URL.revokeObjectURL(generatedAvatarObjectUrl); } catch { /* ignore */ }
			generatedAvatarObjectUrl = null;
		}
		generatedAvatarBlob = null;
	}

	// Image upload UX (avatar/cover): button -> file picker, preview -> remove X
	const objectUrls = { avatar: null, cover: null };
	function revoke(kind) {
		const current = objectUrls[kind];
		if (current) {
			try { URL.revokeObjectURL(current); } catch { /* ignore */ }
			objectUrls[kind] = null;
		}
	}

	function setUploadState(kind, { showPreview, src, removed }) {
		const preview = container.querySelector(`[data-upload-preview="${kind}"]`);
		const img = container.querySelector(`[data-upload-img="${kind}"]`);
		const trigger = container.querySelector(`[data-upload-trigger="${kind}"]`);
		const removeField = container.querySelector(`[data-upload-remove="${kind}"]`);
		if (removeField) removeField.value = removed ? '1' : '';

		if (img && typeof src === 'string') {
			img.src = src;
		}
		if (preview) {
			preview.hidden = !showPreview;
		}
		if (trigger) {
			trigger.hidden = showPreview;
		}
		// Avatar: both buttons hidden when preview is showing.
		if (kind === 'avatar') {
			const actions = container.querySelector('.user-profile-avatar-actions');
			if (actions) {
				actions.querySelectorAll('.user-profile-upload-button').forEach((btn) => { btn.hidden = showPreview; });
			}
		}
	}

	function hydrateExisting(kind) {
		const existing = container.querySelector(`[data-upload-existing="${kind}"]`);
		const url = existing?.getAttribute('data-url') || '';
		if (url) {
			setUploadState(kind, { showPreview: true, src: url, removed: false });
		}
	}

	function setupUpload(kind) {
		const input = container.querySelector(`[data-upload-input="${kind}"]`);
		const trigger = container.querySelector(`[data-upload-trigger="${kind}"]`);
		const clear = container.querySelector(`[data-upload-clear="${kind}"]`);

		if (trigger && input) {
			trigger.addEventListener('click', () => input.click());
		}

		if (input) {
			input.addEventListener('change', () => {
				const file = input.files && input.files[0] ? input.files[0] : null;
				revoke(kind);
				if (!file) {
					// If no file selected, keep existing preview (if any) and don't mark removed.
					hydrateExisting(kind);
					return;
				}
				const url = URL.createObjectURL(file);
				objectUrls[kind] = url;
				setUploadState(kind, { showPreview: true, src: url, removed: false });
			});
		}

		if (clear && input) {
			clear.addEventListener('click', () => {
				revoke(kind);
				// Clear selected file
				try { input.value = ''; } catch { /* ignore */ }
				// Mark removal; hide preview and show button again
				setUploadState(kind, { showPreview: false, src: '', removed: true });
			});
		}

		hydrateExisting(kind);
	}

	setupUpload('avatar');
	setupUpload('cover');

	const avatarInput = container.querySelector('[data-upload-input="avatar"]');
	const avatarRemoveField = container.querySelector('[data-upload-remove="avatar"]');
	const avatarClearBtn = container.querySelector('[data-upload-clear="avatar"]');

	if (avatarInput) {
		avatarInput.addEventListener('change', () => revokeGeneratedAvatar());
	}
	if (avatarClearBtn) {
		avatarClearBtn.addEventListener('click', () => revokeGeneratedAvatar());
	}

	// Delegate generate-from-character clicks to the form so the handler runs even if the button ref wasn’t found at setup.
	if (form) {
		form.addEventListener('click', async (e) => {
			const avatarActions = form.querySelector('[data-upload="avatar"] .user-profile-avatar-actions');
			const avatarActionButtons = avatarActions?.querySelectorAll?.('.user-profile-upload-button') ?? [];
			const btn = avatarActionButtons[1];
			if (!btn || !btn.contains(e.target)) return;
			e.preventDefault();
			const characterField = form.querySelector('textarea[name="character_description"]');
			if (!characterField) return;
			const description = (characterField.value || '').trim();
			if (description.length < 12) {
				if (errorBox) {
					errorBox.style.display = 'block';
					errorBox.textContent = 'Add a character description (at least 12 characters) to generate an avatar.';
				}
				return;
			}
			if (errorBox) {
				errorBox.style.display = 'none';
				errorBox.textContent = '';
			}
			openGenerateConfirmModal();
		});
	}

	function openGenerateConfirmModal() {
		if (generateConfirmOverlay) generateConfirmOverlay.hidden = false;
	}

	function closeGenerateConfirmModal() {
		if (generateConfirmOverlay) generateConfirmOverlay.hidden = true;
		const confirmError = container.querySelector('[data-profile-generate-confirm-error]');
		if (confirmError) {
			confirmError.style.display = 'none';
			confirmError.textContent = '';
		}
	}

	function setGenerateConfirmLoading(loading) {
		if (!generateConfirmCta) return;
		const textEl = generateConfirmCta.querySelector('.user-profile-generate-confirm-cta-text');
		const spinnerEl = generateConfirmCta.querySelector('.user-profile-generate-confirm-cta-spinner');
		generateConfirmCta.disabled = loading;
		if (textEl) textEl.hidden = loading;
		if (spinnerEl) spinnerEl.hidden = !loading;
		if (generateConfirmBody) generateConfirmBody.style.pointerEvents = loading ? 'none' : '';
		if (generateConfirmBody) generateConfirmBody.style.opacity = loading ? '0.6' : '';
		if (generateConfirmCancel) generateConfirmCancel.disabled = loading;
		if (generateConfirmClose) {
			generateConfirmClose.disabled = loading;
			generateConfirmClose.setAttribute('aria-disabled', loading ? 'true' : 'false');
		}
		if (generateConfirmOverlay) {
			if (loading) generateConfirmOverlay.classList.add('user-profile-generate-confirm-loading');
			else generateConfirmOverlay.classList.remove('user-profile-generate-confirm-loading');
		}
	}

	if (generateConfirmClose) {
		generateConfirmClose.addEventListener('click', () => closeGenerateConfirmModal());
	}
	if (generateConfirmCancel) {
		generateConfirmCancel.addEventListener('click', () => closeGenerateConfirmModal());
	}

	if (generateConfirmCta) {
		generateConfirmCta.addEventListener('click', async () => {
			if (isGeneratingAvatar) return;
			const characterField = form?.querySelector('textarea[name="character_description"]');
			if (!characterField) return;
			const description = (characterField.value || '').trim();
			if (description.length < 12) {
				const confirmError = container.querySelector('[data-profile-generate-confirm-error]');
				if (confirmError) {
					confirmError.style.display = 'block';
					confirmError.textContent = 'Character description must be at least 12 characters.';
				}
				return;
			}
			const confirmErrorEl = container.querySelector('[data-profile-generate-confirm-error]');
			if (confirmErrorEl) {
				confirmErrorEl.style.display = 'none';
				confirmErrorEl.textContent = '';
			}
			isGeneratingAvatar = true;
			setGenerateConfirmLoading(true);
			try {
				await ensureTryIdentityCookie();
				const variationKey = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
				const prompt = buildAvatarPrompt(description, variationKey);
				const created = await createTryImage(prompt, { chargeCredits: 3 });
				if (!created.ok) {
					const msg = created.data?.message || created.data?.error || 'Could not start generation.';
					throw new Error(msg);
				}
				let url = null;
				if (created.data?.status === 'completed' && typeof created.data?.url === 'string' && created.data.url.trim()) {
					url = created.data.url.trim();
				} else if (created.data?.id) {
					const polled = await pollTryImageById(created.data.id);
					if (polled.ok && polled.url) url = polled.url;
					else throw new Error(polled.error || 'Generation failed.');
				} else {
					throw new Error('No image returned.');
				}
				if (avatarTryUrlInput) avatarTryUrlInput.value = url;
				revoke('avatar');
				if (avatarRemoveField) avatarRemoveField.value = '';
				setUploadState('avatar', { showPreview: true, src: url, removed: false });
				closeGenerateConfirmModal();
				// Do not save here; created_image is created only when user clicks Save (profile POST promotes try URL).
			} catch (err) {
				const msg = String(err?.message || '').trim() || 'Generation failed.';
				if (confirmErrorEl) {
					confirmErrorEl.style.display = 'block';
					confirmErrorEl.textContent = msg;
				}
			} finally {
				isGeneratingAvatar = false;
				setGenerateConfirmLoading(false);
			}
		});
	}

	function closeModal() {
		setModalOpen(overlay, false);
	}

	if (overlay) {
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) closeModal();
		});
	}

	[closeButton, cancelButton].forEach((btn) => {
		if (!btn) return;
		btn.addEventListener('click', closeModal);
	});

	async function saveProfile(opts) {
		const keepEditOpen = opts && opts.keepEditOpen === true;
		if (!form || !saveButton) return;
		if (errorBox) {
			errorBox.style.display = 'none';
			errorBox.textContent = '';
		}

		const fd = new FormData();
		let hasAvatarFile = false;
		for (const [name, value] of new FormData(form)) {
			if (name === 'avatar_file' && value instanceof File && value.size > 0) {
				hasAvatarFile = true;
				try {
					const blob = await resizeImageFile(value, {
						maxWidth: 128,
						maxHeight: 128,
						quality: 0.9,
						mimeType: 'image/jpeg'
					});
					fd.append(name, blob, 'avatar.jpg');
				} catch {
					fd.append(name, value);
				}
			} else if (name === 'avatar_file' && value instanceof File && value.size === 0) {
				// Skip empty avatar_file from form so generated blob can be appended as sole avatar_file
				continue;
			} else if (name === 'cover_file' && value instanceof File && value.size > 0) {
				try {
					const blob = await resizeCoverToBannerStrip(value, {
						quality: 0.85,
						mimeType: 'image/jpeg'
					});
					fd.append(name, blob, 'cover.jpg');
				} catch {
					fd.append(name, value);
				}
			} else {
				fd.append(name, value);
			}
		}

		saveButton.disabled = true;
		let result;
		try {
			result = await fetchJsonWithStatusDeduped('/api/profile', {
				method: 'POST',
				credentials: 'include',
				body: fd,
			}, { windowMs: 0 });
		} catch {
			result = { ok: false, status: 0, data: null };
		} finally {
			saveButton.disabled = false;
		}

		if (!result.ok) {
			const message = result.status === 0
				? 'Network error. Check your connection and try again.'
				: (result.data?.error || 'Failed to save profile.');
			if (errorBox) {
				errorBox.style.display = 'block';
				errorBox.textContent = message;
			}
			return;
		}

		if (keepEditOpen) {
			// Leave edit modal open (e.g. after generating avatar)
			return;
		}
		closeModal();
		// Reload page to reflect new hero/avatar quickly (simple + robust)
		window.location.reload();
	}

	if (saveButton) {
		saveButton.addEventListener('click', () => { void saveProfile(); });
	}

	// Change email (account section in edit modal)
	const accountEmailSection = container.querySelector('[data-account-email-section]');
	const accountNewEmailInput = container.querySelector('[data-account-new-email]');
	const accountPasswordInput = container.querySelector('[data-account-password]');
	const accountEmailSubmit = container.querySelector('[data-account-email-submit]');
	const accountCurrentEmailEl = container.querySelector('[data-account-current-email]');
	const accountEmailMessage = container.querySelector('[data-account-email-message]');

	if (accountEmailSubmit && accountNewEmailInput && accountPasswordInput && accountEmailMessage) {
		accountEmailSubmit.addEventListener('click', async () => {
			const newEmail = (accountNewEmailInput.value || '').trim();
			const password = accountPasswordInput.value || '';

			accountEmailMessage.style.display = 'none';
			accountEmailMessage.textContent = '';
			accountEmailMessage.classList.remove('error', 'success');

			if (!newEmail) {
				accountEmailMessage.textContent = 'Enter a new email address.';
				accountEmailMessage.classList.add('error');
				accountEmailMessage.style.display = 'block';
				return;
			}
			if (!password) {
				accountEmailMessage.textContent = 'Enter your current password to change email.';
				accountEmailMessage.classList.add('error');
				accountEmailMessage.style.display = 'block';
				return;
			}

			accountEmailSubmit.disabled = true;
			const result = await fetchJsonWithStatusDeduped('/api/account/email', {
				method: 'PUT',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ new_email: newEmail, password })
			}, { windowMs: 0 }).catch(() => ({ ok: false, status: 0, data: null }));

			accountEmailSubmit.disabled = false;

			if (result.ok) {
				accountEmailMessage.textContent = 'Email updated.';
				accountEmailMessage.classList.add('success');
				accountEmailMessage.style.display = 'block';
				if (accountCurrentEmailEl) accountCurrentEmailEl.textContent = result.data?.email ?? newEmail;
				accountNewEmailInput.value = '';
				accountPasswordInput.value = '';
			} else {
				const message = result.data?.message || result.data?.error || 'Could not update email.';
				accountEmailMessage.textContent = message;
				accountEmailMessage.classList.add('error');
				accountEmailMessage.style.display = 'block';
			}
		});
	}
}

document.addEventListener('DOMContentLoaded', () => {
	void init();
});

