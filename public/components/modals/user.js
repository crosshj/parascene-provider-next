import { buildProfilePath } from '../../shared/profileLinks.js';
const html = String.raw;

/** Matches server: subscription ID for admin-granted founder (no payment). */
const GIFTED_FOUNDER_SUBSCRIPTION_ID = "gifted_founder";

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

function hasRealFounderSubscription(user) {
	const plan = user?.meta?.plan;
	const subId = user?.meta?.stripeSubscriptionId;
	return plan === "founder" && subId != null && String(subId).trim() !== "" && subId !== GIFTED_FOUNDER_SUBSCRIPTION_ID;
}

function hasGiftedFounder(user) {
	return user?.meta?.plan === "founder" && user?.meta?.stripeSubscriptionId === GIFTED_FOUNDER_SUBSCRIPTION_ID;
}

class AppModalUser extends HTMLElement {
	constructor() {
		super();
		this._currentUser = null;
		this._viewerUserId = null;
		this._viewerRole = null;
		this._boundEscape = (e) => {
			if (e.key === 'Escape') {
				if (this._tipModalOverlay && !this._tipModalOverlay.hidden && this._tipModalOverlay.classList.contains('open')) {
					this.hideTipModal();
				} else if (this._suspendConfirmOverlay && !this._suspendConfirmOverlay.hidden && this._suspendConfirmOverlay.classList.contains('open')) {
					this.hideSuspendConfirm();
				} else if (this._deleteConfirmOverlay && !this._deleteConfirmOverlay.hidden && this._deleteConfirmOverlay.classList.contains('open')) {
					this.hideDeleteConfirm();
				} else if (this._overlay?.classList.contains('open')) {
					this.close();
				}
			}
		};
		this._boundCloseAllModals = () => this.close();
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this._overlay = this.querySelector('[data-user-modal-overlay]');
		this._details = this.querySelector('[data-user-modal-details]');
		this._form = this.querySelector('[data-user-tip-form]');
		this._error = this.querySelector('[data-user-tip-error]');
		this._tipModalOverlay = this.querySelector('[data-user-tip-modal-overlay]');
		this._tipModalInput = this.querySelector('#user-tip-modal-amount');
		this._tipModalSubmit = this.querySelector('[data-user-tip-modal-submit]');
		this._unreadNotifications = this.querySelector('[data-user-unread-notifications]');
		this._profileLink = this.querySelector('[data-user-profile-link]');
		this._suspendZone = this.querySelector('[data-user-suspend-zone]');
		this._suspendButton = this.querySelector('[data-user-suspend-button]');
		this._suspendedValue = this.querySelector('[data-user-suspended-value]');
		this._suspendError = this.querySelector('[data-user-suspend-error]');
		this._deleteButton = this.querySelector('[data-user-delete-button]');
		this._deleteError = this.querySelector('[data-user-delete-error]');
		this._tipButton = this.querySelector('[data-user-tip-submit]');
		this._deleteConfirmOverlay = this.querySelector('[data-user-delete-confirm-overlay]');
		this._deleteConfirmName = this.querySelector('[data-user-delete-confirm-name]');
		this._deleteConfirmInput = this.querySelector('[data-user-delete-confirm-input]');
		this._deleteConfirmError = this.querySelector('[data-user-delete-confirm-error]');
		this._deleteConfirmSubmit = this.querySelector('[data-user-delete-confirm-submit]');
		this._suspendConfirmOverlay = this.querySelector('[data-user-suspend-confirm-overlay]');
		this._suspendConfirmTitle = this.querySelector('[data-user-suspend-confirm-title]');
		this._suspendConfirmMessage = this.querySelector('[data-user-suspend-confirm-message]');
		this._suspendConfirmName = this.querySelector('[data-user-suspend-confirm-name]');
		this._suspendConfirmInput = this.querySelector('[data-user-suspend-confirm-input]');
		this._suspendConfirmError = this.querySelector('[data-user-suspend-confirm-error]');
		this._suspendConfirmSubmit = this.querySelector('[data-user-suspend-confirm-submit]');
		this._suspendConfirmButtonText = this.querySelector('[data-user-suspend-confirm-button-text]');
		this._founderZone = this.querySelector('[data-user-founder-zone]');
		this._founderValue = this.querySelector('[data-user-founder-value]');
		this._grantFounderButton = this.querySelector('[data-user-grant-founder-button]');
		this._revokeFounderButton = this.querySelector('[data-user-revoke-founder-button]');
		this._founderError = this.querySelector('[data-user-founder-error]');
		this._overlay?.addEventListener('click', (e) => {
			if (e.target?.dataset?.userClose !== undefined || e.target === this._overlay) this.close();
		});
		document.addEventListener('keydown', this._boundEscape);
		document.addEventListener('close-all-modals', this._boundCloseAllModals);
		this._form?.addEventListener('submit', (e) => this.handleSubmit(e));
		this._tipButton?.addEventListener('click', () => this.showTipModal());
		this._tipModalOverlay?.addEventListener('click', (e) => {
			if (e.target?.dataset?.userTipModalClose !== undefined || e.target === this._tipModalOverlay) this.hideTipModal();
		});
		this._tipModalSubmit?.addEventListener('click', () => this._form?.requestSubmit());
		this.querySelector('[data-user-tip-modal-cancel]')?.addEventListener('click', () => this.hideTipModal());
		this._deleteButton?.addEventListener('click', () => this.showDeleteConfirm());
		this._suspendButton?.addEventListener('click', () => this.showSuspendConfirm());
		this._deleteConfirmOverlay?.addEventListener('click', (e) => {
			if (e.target?.dataset?.userDeleteConfirmClose !== undefined || e.target === this._deleteConfirmOverlay) this.hideDeleteConfirm();
		});
		this._deleteConfirmInput?.addEventListener('input', () => this.updateDeleteConfirmButton());
		this._deleteConfirmSubmit?.addEventListener('click', () => this.handleDeleteUser());
		this.querySelector('[data-user-delete-confirm-cancel]')?.addEventListener('click', () => this.hideDeleteConfirm());
		this._suspendConfirmOverlay?.addEventListener('click', (e) => {
			if (e.target?.dataset?.userSuspendConfirmClose !== undefined || e.target === this._suspendConfirmOverlay) this.hideSuspendConfirm();
		});
		this._suspendConfirmInput?.addEventListener('input', () => this.updateSuspendConfirmButton());
		this._suspendConfirmSubmit?.addEventListener('click', () => this.handleSaveSuspend());
		this.querySelector('[data-user-suspend-confirm-cancel]')?.addEventListener('click', () => this.hideSuspendConfirm());
		this._grantFounderButton?.addEventListener('click', () => this.handleGrantFounder());
		this._revokeFounderButton?.addEventListener('click', () => this.handleRevokeFounder());
		this.loadViewerUser();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this._boundEscape);
		document.removeEventListener('close-all-modals', this._boundCloseAllModals);
	}

	async loadViewerUser() {
		try {
			const response = await fetch('/api/profile', { credentials: 'include' });
			if (!response.ok) {
				this._viewerUserId = null;
				this._viewerRole = null;
				return;
			}
			const data = await response.json();
			this._viewerUserId = Number(data?.id) || null;
			this._viewerRole = typeof data?.role === 'string' ? data.role : null;
			// Update button visibility if modal is already open
			if (this._currentUser) {
				this.updateButtonVisibility(this._currentUser);
			}
		} catch {
			this._viewerUserId = null;
			this._viewerRole = null;
		}
	}

	updateButtonVisibility(user) {
		const isAdmin = this._viewerRole === 'admin';
		const hasValidUserId = Number.isFinite(Number(user?.id)) && Number(user?.id) > 0;
		const isNotSelf = this._viewerUserId == null || Number(user?.id) !== Number(this._viewerUserId);

		const canDelete = isAdmin && hasValidUserId && isNotSelf;
		const canSuspend = isAdmin && hasValidUserId;

		if (this._suspendZone) {
			if (canSuspend) {
				this._suspendZone.style.display = '';
				if (this._suspendButton) {
					this._suspendButton.style.display = '';
					this.updateSuspendButtonText();
				}
				if (this._deleteButton) {
					if (canDelete) {
						this._deleteButton.style.display = '';
					} else {
						this._deleteButton.style.display = 'none';
					}
				}
			} else {
				this._suspendZone.style.display = 'none';
			}
		}

		if (this._founderZone) {
			if (isAdmin && hasValidUserId) {
				this._founderZone.style.display = '';
				this.updateFounderZone(user);
			} else {
				this._founderZone.style.display = 'none';
			}
		}
	}

	updateFounderZone(user) {
		if (!this._founderValue) return;
		const real = hasRealFounderSubscription(user);
		const gifted = hasGiftedFounder(user);
		const plan = user?.meta?.plan;
		if (real) {
			this._founderValue.textContent = "Founder (paid)";
			if (this._grantFounderButton) this._grantFounderButton.style.display = 'none';
			if (this._revokeFounderButton) this._revokeFounderButton.style.display = 'none';
		} else if (gifted) {
			this._founderValue.textContent = "Founder (gifted)";
			if (this._grantFounderButton) this._grantFounderButton.style.display = 'none';
			if (this._revokeFounderButton) this._revokeFounderButton.style.display = '';
		} else {
			this._founderValue.textContent = plan === "founder" ? "Founder" : "Free";
			if (this._grantFounderButton) this._grantFounderButton.style.display = '';
			if (this._revokeFounderButton) this._revokeFounderButton.style.display = 'none';
		}
		if (this._founderError) {
			this._founderError.hidden = true;
			this._founderError.textContent = '';
		}
	}

	render() {
		this.innerHTML = html`
			<div class="publish-modal-overlay" data-user-modal-overlay role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
				<div class="publish-modal user-modal">
					<header class="publish-modal-header">
						<h3 id="user-modal-title" class="user-modal-title">User</h3>
						<button type="button" class="publish-modal-close" data-user-close aria-label="Close">✕</button>
					</header>
					<div class="publish-modal-body user-modal-body">
						<div class="user-modal-section">
							<div class="user-modal-section-title">User Information</div>
							<div class="user-modal-details" data-user-modal-details></div>
						</div>
						<div class="user-modal-section" data-user-suspend-zone style="display: none;">
							<div class="user-modal-section-title user-modal-section-title-no-border">Status</div>
							<div class="user-suspend-zone">
								<div class="user-modal-field">
									<div class="user-modal-field-label">Suspended</div>
									<div class="user-modal-field-value" data-user-suspended-value>false</div>
								</div>
								<div class="user-status-actions">
									<button type="button" class="btn-secondary user-suspend-button" data-user-suspend-button style="display: none;">Suspend</button>
									<button type="button" class="btn-secondary user-delete-button" data-user-delete-button style="display: none;">Delete</button>
								</div>
								<div class="alert error user-suspend-error" data-user-suspend-error hidden></div>
							</div>
						</div>
						<div class="user-modal-section" data-user-founder-zone style="display: none;">
							<div class="user-modal-section-title user-modal-section-title-no-border">Founder status</div>
							<div class="user-founder-zone">
								<div class="user-modal-field">
									<div class="user-modal-field-label">Plan</div>
									<div class="user-modal-field-value" data-user-founder-value>—</div>
								</div>
								<div class="user-status-actions">
									<button type="button" class="btn-secondary user-grant-founder-button" data-user-grant-founder-button style="display: none;">Grant founder status (gifted)</button>
									<button type="button" class="btn-secondary user-revoke-founder-button" data-user-revoke-founder-button style="display: none;">Revoke gifted founder</button>
								</div>
								<div class="alert error user-founder-error" data-user-founder-error hidden></div>
							</div>
						</div>
					</div>
					<footer class="publish-modal-footer">
						<div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 12px;">
							<div style="display: flex; align-items: center; gap: 12px;">
							</div>
							<div style="display: flex; align-items: center; gap: 12px;">
								<button type="button" class="btn-outlined user-tip-button" data-user-tip-submit>
									<span class="user-tip-button-label">Tip</span>
									<span class="user-tip-spinner" aria-hidden="true"></span>
								</button>
								<button type="button" class="btn-primary" data-user-profile-link>View Profile</button>
							</div>
						</div>
						<div class="alert error user-delete-error" data-user-delete-error hidden style="width: 100%; margin-top: 12px;"></div>
					</footer>
				</div>
				<div class="publish-modal-overlay user-delete-confirm-overlay" data-user-delete-confirm-overlay hidden>
					<div class="publish-modal user-delete-confirm-modal">
						<header class="publish-modal-header">
							<h3>Confirm Deletion</h3>
							<button type="button" class="publish-modal-close" data-user-delete-confirm-close aria-label="Close">✕</button>
						</header>
						<div class="publish-modal-body">
							<div class="user-delete-danger-alert">
								<strong>Danger Zone</strong>
								<p>This will permanently delete user <strong data-user-delete-confirm-name></strong> and all associated content including creations, likes, comments, follows, sessions, and credits. This action cannot be undone.</p>
							</div>
							<div class="user-delete-confirm-input">
								<label for="user-delete-confirm-name-input">Type the user's email to confirm:</label>
								<input type="text" id="user-delete-confirm-name-input" data-user-delete-confirm-input placeholder="Enter email address" />
							</div>
							<div class="alert error user-delete-confirm-error" data-user-delete-confirm-error hidden></div>
						</div>
						<footer class="publish-modal-footer">
							<button type="button" class="btn-secondary" data-user-delete-confirm-cancel>Cancel</button>
							<button type="button" class="btn-danger user-delete-confirm-submit" data-user-delete-confirm-submit disabled>Delete user</button>
						</footer>
					</div>
				</div>
				<div class="publish-modal-overlay user-tip-modal-overlay" data-user-tip-modal-overlay hidden>
					<div class="publish-modal user-tip-modal">
						<header class="publish-modal-header">
							<h3>Tip Credits</h3>
							<button type="button" class="publish-modal-close" data-user-tip-modal-close aria-label="Close">✕</button>
						</header>
						<div class="publish-modal-body">
							<form class="user-tip-form" data-user-tip-form>
								<input type="hidden" name="toUserId" value="" />
								<div class="user-tip-label">
									<label for="user-tip-modal-amount">Amount</label>
									<input id="user-tip-modal-amount" type="number" name="amount" min="0.1" step="0.1" inputmode="decimal" required placeholder="0.0" />
								</div>
								<div class="alert error user-tip-error" data-user-tip-error hidden></div>
							</form>
						</div>
						<footer class="publish-modal-footer">
							<button type="button" class="btn-secondary" data-user-tip-modal-cancel>Cancel</button>
							<button type="button" class="btn-primary user-tip-modal-submit" data-user-tip-modal-submit>
								<span class="user-tip-button-label">Tip</span>
								<span class="user-tip-spinner" aria-hidden="true"></span>
							</button>
						</footer>
					</div>
				</div>
				<div class="publish-modal-overlay user-suspend-confirm-overlay" data-user-suspend-confirm-overlay hidden>
					<div class="publish-modal user-suspend-confirm-modal">
						<header class="publish-modal-header">
							<h3 data-user-suspend-confirm-title>Confirm Suspension</h3>
							<button type="button" class="publish-modal-close" data-user-suspend-confirm-close aria-label="Close">✕</button>
						</header>
						<div class="publish-modal-body">
							<p data-user-suspend-confirm-message>This will suspend user <strong data-user-suspend-confirm-name></strong>. Suspended users will not be able to access their account.</p>
							<div class="user-suspend-confirm-input">
								<label for="user-suspend-confirm-name-input">Type the user's email to confirm:</label>
								<input type="text" id="user-suspend-confirm-name-input" data-user-suspend-confirm-input placeholder="Enter email address" />
							</div>
							<div class="alert error user-suspend-confirm-error" data-user-suspend-confirm-error hidden></div>
						</div>
						<footer class="publish-modal-footer">
							<button type="button" class="btn-secondary" data-user-suspend-confirm-cancel>Cancel</button>
							<button type="button" class="btn-primary user-suspend-confirm-submit" data-user-suspend-confirm-submit disabled>
								<span data-user-suspend-confirm-button-text>Suspend user</span>
							</button>
						</footer>
					</div>
				</div>
				</div>
			</div>
		`;
	}

	async open(user) {
		this._currentUser = user;
		const title = this.querySelector('#user-modal-title');
		if (title) title.textContent = user?.email || 'User';
		await this.renderDetails(user);
		if (this._form) {
			this._form.reset();
			this._form.elements.toUserId.value = String(user?.id ?? '');
		}
		if (this._tipModalInput) {
			this._tipModalInput.value = '';
		}
		if (this._error) {
			this._error.hidden = true;
			this._error.textContent = '';
		}
		if (this._deleteError) {
			this._deleteError.hidden = true;
			this._deleteError.textContent = '';
		}

		// Ensure viewer user is loaded before checking permissions
		// Always reload to ensure we have the latest role
		await this.loadViewerUser();

		// Update button visibility - this will show/hide suspend and delete buttons
		this.updateButtonVisibility(user);

		// Update profile link in footer
		const profileHref = buildProfilePath({ userName: user?.user_name, userId: user?.id });
		if (this._profileLink) {
			if (profileHref) {
				this._profileLink.style.display = '';
				this._profileLink.onclick = (e) => {
					e.preventDefault();
					this.close();
					window.location.href = profileHref;
				};
			} else {
				this._profileLink.style.display = 'none';
			}
		}

		this._overlay?.classList.add('open');
	}

	close() {
		this._overlay?.classList.remove('open');
		this.hideTipModal();
		this.hideSuspendConfirm();
		this.hideDeleteConfirm();
		this._currentUser = null;
		if (this._error) {
			this._error.hidden = true;
			this._error.textContent = '';
		}
		if (this._deleteError) {
			this._deleteError.hidden = true;
			this._deleteError.textContent = '';
		}
	}

	async renderDetails(user) {
		if (!this._details) return;
		const creditsValue = typeof user?.credits === 'number' ? user.credits : 0;
		const profileHref = buildProfilePath({ userName: user?.user_name, userId: user?.id });
		
		// Fetch unread notifications count
		let unreadCount = 0;
		if (user?.id) {
			try {
				const response = await fetch(`/admin/users/${user.id}/unread-notifications`, {
					credentials: 'include'
				});
				if (response.ok) {
					const data = await response.json();
					unreadCount = Number(data?.count ?? 0);
				}
			} catch {
				// Ignore errors
			}
		}
		
		// Check suspended status - database uses 'suspended' boolean, not 'suspended_at'
		this._details.innerHTML = `
			<div class="user-modal-field">
				<div class="user-modal-field-label">User ID</div>
				<div class="user-modal-field-value">${escapeHtml(String(user?.id ?? ''))}</div>
			</div>
			<div class="user-modal-field">
				<div class="user-modal-field-label">Email</div>
				<div class="user-modal-field-value">${escapeHtml(String(user?.email ?? ''))}</div>
			</div>
			<div class="user-modal-field">
				<div class="user-modal-field-label">Role</div>
				<div class="user-modal-field-value user-modal-role">${escapeHtml(String(user?.role ?? ''))}</div>
			</div>
			<div class="user-modal-field">
				<div class="user-modal-field-label">Credits</div>
				<div class="user-modal-field-value" data-user-modal-credits>${escapeHtml(creditsValue.toFixed(1))}</div>
			</div>
			<div class="user-modal-field">
				<div class="user-modal-field-label">Unread Notifications</div>
				<div class="user-modal-field-value" data-user-unread-notifications>${unreadCount}</div>
			</div>
			<div class="user-modal-field">
				<div class="user-modal-field-label">Stripe Sub</div>
				<div class="user-modal-field-value">${escapeHtml(String(user?.meta?.stripeSubscriptionId ?? '')) || '—'}</div>
			</div>
		`;
		
		// Update suspended status in Account Status section
		const isSuspended = Boolean(user?.suspended === true || user?.meta?.suspended === true);
		if (this._suspendedValue) {
			this._suspendedValue.textContent = isSuspended ? 'true' : 'false';
		}
		// Update suspend zone visibility and button
		if (this._suspendZone && this._viewerRole === 'admin' && Number.isFinite(Number(user?.id)) && Number(user?.id) > 0) {
			this._suspendZone.style.display = '';
			if (this._suspendButton) {
				this._suspendButton.style.display = '';
				this.updateSuspendButtonText();
			}
		} else if (this._suspendZone) {
			this._suspendZone.style.display = 'none';
		}
		if (this._founderZone && this._viewerRole === 'admin' && Number.isFinite(Number(user?.id))) {
			this._founderZone.style.display = '';
			this.updateFounderZone(user);
		} else if (this._founderZone) {
			this._founderZone.style.display = 'none';
		}
	}

	showTipModal() {
		if (!this._currentUser || !this._tipModalOverlay) return;
		if (this._form) {
			this._form.reset();
			this._form.elements.toUserId.value = String(this._currentUser?.id ?? '');
		}
		if (this._tipModalInput) {
			this._tipModalInput.value = '';
		}
		if (this._error) {
			this._error.hidden = true;
			this._error.textContent = '';
		}
		this._tipModalOverlay.hidden = false;
		this._tipModalOverlay.classList.add('open');
		if (this._tipModalInput) {
			setTimeout(() => this._tipModalInput.focus(), 100);
		}
	}

	hideTipModal() {
		if (this._tipModalOverlay) {
			this._tipModalOverlay.classList.remove('open');
			setTimeout(() => {
				if (this._tipModalOverlay) {
					this._tipModalOverlay.hidden = true;
				}
			}, 200);
		}
	}

	async handleSubmit(e) {
		if (e) e.preventDefault();
		if (!this._currentUser || !this._form) return;

		const amountInput = this._form.elements.amount;
		const fixedWidth = this._tipModalSubmit ? this._tipModalSubmit.getBoundingClientRect().width : null;
		if (this._tipModalSubmit) {
			this._tipModalSubmit.disabled = true;
			if (fixedWidth) this._tipModalSubmit.style.width = `${fixedWidth}px`;
			this._tipModalSubmit.classList.add('is-loading');
		}
		if (amountInput) amountInput.disabled = true;
		if (this._error) {
			this._error.hidden = true;
			this._error.textContent = '';
		}

		const toUserId = Number(this._form.elements.toUserId.value);
		const amount = Number(this._form.elements.amount.value);

		try {
			const response = await fetch('/api/credits/tip', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ toUserId, amount })
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				const message = data?.error || 'Failed to tip credits.';
				if (this._error) {
					this._error.hidden = false;
					this._error.textContent = message;
				} else alert(message);
				return;
			}

			const nextToBalance = typeof data?.toBalance === 'number' ? data.toBalance : null;
			const nextFromBalance = typeof data?.fromBalance === 'number' ? data.fromBalance : null;

			if (nextToBalance !== null) {
				this._currentUser.credits = nextToBalance;
				const creditsEl = this.querySelector('[data-user-modal-credits]');
				if (creditsEl) creditsEl.textContent = nextToBalance.toFixed(1);
			}

			const recipientCard = document.querySelector(`.user-card[data-user-id="${toUserId}"]`);
			if (recipientCard && nextToBalance !== null) {
				const creditsSpan = recipientCard.querySelector('.user-credits');
				if (creditsSpan) creditsSpan.textContent = `${nextToBalance.toFixed(1)} credits`;
			}

			if (nextFromBalance !== null) {
				document.dispatchEvent(new CustomEvent('credits-updated', { detail: { count: nextFromBalance } }));
				try {
					window.localStorage?.setItem('credits-balance', String(nextFromBalance));
				} catch { }
				if (this._viewerUserId) {
					const senderCard = document.querySelector(`.user-card[data-user-id="${this._viewerUserId}"]`);
					if (senderCard) {
						const creditsSpan = senderCard.querySelector('.user-credits');
						if (creditsSpan) creditsSpan.textContent = `${nextFromBalance.toFixed(1)} credits`;
					}
				}
			}

			this._form.reset();
			this._form.elements.toUserId.value = String(toUserId);
			document.dispatchEvent(new CustomEvent('user-updated', { detail: { userId: toUserId } }));
			this.hideTipModal();
		} catch (err) {
			const message = err?.message || 'Failed to tip credits.';
			if (this._error) {
				this._error.hidden = false;
				this._error.textContent = message;
			} else alert(message);
		} finally {
			if (this._tipModalSubmit) {
				this._tipModalSubmit.disabled = false;
				this._tipModalSubmit.classList.remove('is-loading');
				this._tipModalSubmit.style.width = '';
			}
			if (amountInput) amountInput.disabled = false;
		}
	}

	showDeleteConfirm() {
		if (!this._currentUser || !this._deleteConfirmOverlay) return;

		const userId = Number(this._currentUser?.id);
		if (!Number.isFinite(userId) || userId <= 0) return;

		if (this._viewerRole !== 'admin') {
			if (this._deleteError) {
				this._deleteError.hidden = false;
				this._deleteError.textContent = 'Forbidden: Admin role required.';
			}
			return;
		}

		if (this._viewerUserId && Number(this._viewerUserId) === userId) {
			if (this._deleteError) {
				this._deleteError.hidden = false;
				this._deleteError.textContent = 'Refusing to delete current admin user.';
			}
			return;
		}

		const userEmail = String(this._currentUser?.email || '');
		if (this._deleteConfirmName) {
			this._deleteConfirmName.textContent = userEmail;
		}
		if (this._deleteConfirmInput) {
			this._deleteConfirmInput.value = '';
		}
		if (this._deleteConfirmError) {
			this._deleteConfirmError.hidden = true;
			this._deleteConfirmError.textContent = '';
		}
		this.updateDeleteConfirmButton();
		this._deleteConfirmOverlay.hidden = false;
		this._deleteConfirmOverlay.classList.add('open');
		if (this._deleteConfirmInput) {
			setTimeout(() => this._deleteConfirmInput.focus(), 100);
		}
	}

	hideDeleteConfirm() {
		if (this._deleteConfirmOverlay) {
			this._deleteConfirmOverlay.classList.remove('open');
			setTimeout(() => {
				if (this._deleteConfirmOverlay) {
					this._deleteConfirmOverlay.hidden = true;
				}
			}, 200);
		}
	}

	updateDeleteConfirmButton() {
		if (!this._deleteConfirmSubmit || !this._deleteConfirmInput || !this._currentUser) return;
		const userEmail = String(this._currentUser?.email || '').trim().toLowerCase();
		const inputValue = String(this._deleteConfirmInput.value || '').trim().toLowerCase();
		this._deleteConfirmSubmit.disabled = inputValue !== userEmail;
	}

	async handleDeleteUser() {
		const userId = Number(this._currentUser?.id);
		if (!Number.isFinite(userId) || userId <= 0) return;

		const userEmail = String(this._currentUser?.email || '').trim().toLowerCase();
		const inputValue = String(this._deleteConfirmInput?.value || '').trim().toLowerCase();
		
		if (inputValue !== userEmail) {
			if (this._deleteConfirmError) {
				this._deleteConfirmError.hidden = false;
				this._deleteConfirmError.textContent = 'Email does not match.';
			}
			return;
		}

		if (this._deleteConfirmError) {
			this._deleteConfirmError.hidden = true;
			this._deleteConfirmError.textContent = '';
		}

		if (this._deleteConfirmSubmit) {
			this._deleteConfirmSubmit.disabled = true;
			this._deleteConfirmSubmit.classList.add('is-loading');
		}

		try {
			const res = await fetch(`/admin/users/${userId}`, {
				method: 'DELETE',
				credentials: 'include'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const message = data?.error || 'Failed to delete user.';
				if (this._deleteConfirmError) {
					this._deleteConfirmError.hidden = false;
					this._deleteConfirmError.textContent = message;
				} else alert(message);
				return;
			}

			this.hideDeleteConfirm();
			document.dispatchEvent(new CustomEvent('user-updated', { detail: { userId } }));
			this.close();
		} catch (err) {
			const message = err?.message || 'Failed to delete user.';
			if (this._deleteConfirmError) {
				this._deleteConfirmError.hidden = false;
				this._deleteConfirmError.textContent = message;
			} else alert(message);
		} finally {
			if (this._deleteConfirmSubmit) {
				this._deleteConfirmSubmit.disabled = false;
				this._deleteConfirmSubmit.classList.remove('is-loading');
			}
		}
	}

	updateSuspendButtonText() {
		if (!this._suspendButton || !this._currentUser) return;
		const isSuspended = Boolean(this._currentUser?.suspended === true || this._currentUser?.meta?.suspended === true);
		this._suspendButton.textContent = isSuspended ? 'Unsuspend' : 'Suspend';
	}

	async handleGrantFounder() {
		const userId = Number(this._currentUser?.id);
		if (!Number.isFinite(userId) || userId <= 0) return;
		if (this._viewerRole !== 'admin') return;
		if (hasRealFounderSubscription(this._currentUser)) return;

		if (this._founderError) {
			this._founderError.hidden = true;
			this._founderError.textContent = '';
		}
		const btn = this._grantFounderButton;
		if (btn) {
			btn.disabled = true;
			btn.classList.add('is-loading');
		}
		try {
			const res = await fetch(`/admin/users/${userId}/grant-founder`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' }
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const message = data?.message || data?.error || 'Failed to grant founder status.';
				if (this._founderError) {
					this._founderError.hidden = false;
					this._founderError.textContent = message;
				} else alert(message);
				return;
			}
			if (data?.user) {
				this._currentUser = { ...this._currentUser, ...data.user, meta: { ...this._currentUser?.meta, ...data.user?.meta } };
				await this.renderDetails(this._currentUser);
				this.updateFounderZone(this._currentUser);
			}
			document.dispatchEvent(new CustomEvent('user-updated', { detail: { userId } }));
		} finally {
			if (btn) {
				btn.disabled = false;
				btn.classList.remove('is-loading');
			}
		}
	}

	async handleRevokeFounder() {
		const userId = Number(this._currentUser?.id);
		if (!Number.isFinite(userId) || userId <= 0) return;
		if (this._viewerRole !== 'admin') return;
		if (!hasGiftedFounder(this._currentUser)) return;

		if (this._founderError) {
			this._founderError.hidden = true;
			this._founderError.textContent = '';
		}
		const btn = this._revokeFounderButton;
		if (btn) {
			btn.disabled = true;
			btn.classList.add('is-loading');
		}
		try {
			const res = await fetch(`/admin/users/${userId}/revoke-founder`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' }
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const message = data?.message || data?.error || 'Failed to revoke gifted founder.';
				if (this._founderError) {
					this._founderError.hidden = false;
					this._founderError.textContent = message;
				} else alert(message);
				return;
			}
			if (data?.user) {
				this._currentUser = { ...this._currentUser, ...data.user, meta: { ...this._currentUser?.meta, ...data.user?.meta } };
				await this.renderDetails(this._currentUser);
				this.updateFounderZone(this._currentUser);
			}
			document.dispatchEvent(new CustomEvent('user-updated', { detail: { userId } }));
		} finally {
			if (btn) {
				btn.disabled = false;
				btn.classList.remove('is-loading');
			}
		}
	}

	showSuspendConfirm() {
		if (!this._currentUser || !this._suspendConfirmOverlay) return;

		const userId = Number(this._currentUser?.id);
		if (!Number.isFinite(userId) || userId <= 0) return;

		if (this._viewerRole !== 'admin') {
			alert('Forbidden: Admin role required.');
			return;
		}

		const isSuspended = Boolean(this._currentUser?.suspended === true || this._currentUser?.meta?.suspended === true);
		const userEmail = String(this._currentUser?.email || '');

		if (this._suspendConfirmName) {
			this._suspendConfirmName.textContent = userEmail;
		}
		if (this._suspendConfirmTitle) {
			this._suspendConfirmTitle.textContent = isSuspended ? 'Confirm Unsuspension' : 'Confirm Suspension';
		}
		if (this._suspendConfirmMessage) {
			if (isSuspended) {
				this._suspendConfirmMessage.innerHTML = `This will unsuspend user <strong data-user-suspend-confirm-name></strong>. The user will regain access to their account.`;
			} else {
				this._suspendConfirmMessage.innerHTML = `This will suspend user <strong data-user-suspend-confirm-name></strong>. Suspended users will not be able to access their account.`;
			}
			// Update the name in the message as well
			const messageNameEl = this._suspendConfirmMessage.querySelector('strong');
			if (messageNameEl) messageNameEl.textContent = userEmail;
		}
		if (this._suspendConfirmButtonText) {
			this._suspendConfirmButtonText.textContent = isSuspended ? 'Unsuspend user' : 'Suspend user';
		}
		if (this._suspendConfirmInput) {
			this._suspendConfirmInput.value = '';
		}
		if (this._suspendConfirmError) {
			this._suspendConfirmError.hidden = true;
			this._suspendConfirmError.textContent = '';
		}
		this.updateSuspendConfirmButton();
		this._suspendConfirmOverlay.hidden = false;
		this._suspendConfirmOverlay.classList.add('open');
		if (this._suspendConfirmInput) {
			setTimeout(() => this._suspendConfirmInput.focus(), 100);
		}
	}

	hideSuspendConfirm() {
		if (this._suspendConfirmOverlay) {
			this._suspendConfirmOverlay.classList.remove('open');
			setTimeout(() => {
				if (this._suspendConfirmOverlay) {
					this._suspendConfirmOverlay.hidden = true;
				}
			}, 200);
		}
	}

	updateSuspendConfirmButton() {
		if (!this._suspendConfirmSubmit || !this._suspendConfirmInput || !this._currentUser) return;
		const userEmail = String(this._currentUser?.email || '').trim().toLowerCase();
		const inputValue = String(this._suspendConfirmInput.value || '').trim().toLowerCase();
		this._suspendConfirmSubmit.disabled = inputValue !== userEmail;
	}

	async handleSaveSuspend() {
		const userId = Number(this._currentUser?.id);
		if (!Number.isFinite(userId) || userId <= 0) return;

		const userEmail = String(this._currentUser?.email || '').trim().toLowerCase();
		const inputValue = String(this._suspendConfirmInput?.value || '').trim().toLowerCase();
		
		if (inputValue !== userEmail) {
			if (this._suspendConfirmError) {
				this._suspendConfirmError.hidden = false;
				this._suspendConfirmError.textContent = 'Email does not match.';
			}
			return;
		}

		const isSuspended = Boolean(this._currentUser?.suspended === true || this._currentUser?.meta?.suspended === true);
		const newSuspendedState = !isSuspended;

		if (this._suspendConfirmError) {
			this._suspendConfirmError.hidden = true;
			this._suspendConfirmError.textContent = '';
		}

		if (this._suspendConfirmSubmit) {
			this._suspendConfirmSubmit.disabled = true;
			this._suspendConfirmSubmit.classList.add('is-loading');
		}

		try {
			const res = await fetch(`/admin/users/${userId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ suspended: newSuspendedState })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const message = data?.error || 'Failed to update user suspension status.';
				if (this._suspendConfirmError) {
					this._suspendConfirmError.hidden = false;
					this._suspendConfirmError.textContent = message;
				} else alert(message);
				return;
			}

			if (this._currentUser) {
				this._currentUser.suspended = newSuspendedState;
				if (this._currentUser.meta) {
					this._currentUser.meta.suspended = newSuspendedState;
				} else {
					this._currentUser.meta = { suspended: newSuspendedState };
				}
			}
			this.hideSuspendConfirm();
			await this.renderDetails(this._currentUser);
			if (this._suspendedValue) {
				this._suspendedValue.textContent = newSuspendedState ? 'true' : 'false';
			}
			this.updateSuspendButtonText();
			document.dispatchEvent(new CustomEvent('user-updated', { detail: { userId } }));
		} catch (err) {
			const message = err?.message || 'Failed to update user suspension status.';
			if (this._suspendConfirmError) {
				this._suspendConfirmError.hidden = false;
				this._suspendConfirmError.textContent = message;
			} else alert(message);
		} finally {
			if (this._suspendConfirmSubmit) {
				this._suspendConfirmSubmit.disabled = false;
				this._suspendConfirmSubmit.classList.remove('is-loading');
			}
		}
	}
}

customElements.define('app-modal-user', AppModalUser);
