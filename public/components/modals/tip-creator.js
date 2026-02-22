/**
 * Modal to tip credits to a creator (e.g. from creation detail page).
 * Listens for open-tip-creator-modal with detail: { userId, userName, createdImageId, viewerBalance? }.
 * Uses same API as admin user tip: POST /api/credits/tip with toUserId, amount, createdImageId, message.
 */
const html = String.raw;

const TIP_MIN_VISIBLE_BALANCE = 10.0;
const TIP_LARGE_AMOUNT_WARNING = 5.0;

class AppModalTipCreator extends HTMLElement {
	constructor() {
		super();
		this._userId = null;
		this._userName = null;
		this._createdImageId = null;
		this._viewerBalance = null;
		this._overlay = null;
		this._form = null;
		this._amountInput = null;
		this._errorEl = null;
		this._submitBtn = null;
		this._cancelBtn = null;
		this._closeBtn = null;
		this._recipientEl = null;
		this._balanceHintEl = null;
		this._warningEl = null;
		this._boundEscape = (e) => {
			if (e.key === 'Escape') this.close();
		};
		this._boundOpen = (e) => this.open(e.detail);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this._overlay = this.querySelector('[data-tip-creator-modal-overlay]');
		this._form = this.querySelector('[data-tip-creator-form]');
		this._amountInput = this.querySelector('#tip-creator-modal-amount');
		this._errorEl = this.querySelector('[data-tip-creator-error]');
		this._submitBtn = this.querySelector('[data-tip-creator-submit]');
		this._cancelBtn = this.querySelector('[data-tip-creator-cancel]');
		this._closeBtn = this.querySelector('[data-tip-creator-close]');
		this._recipientEl = this.querySelector('[data-tip-creator-recipient]');
		this._balanceHintEl = this.querySelector('[data-tip-creator-balance-hint]');
		this._warningEl = this.querySelector('[data-tip-creator-warning]');

		this._overlay?.addEventListener('click', (e) => {
			if (e.target?.dataset?.tipCreatorModalClose !== undefined || e.target === this._overlay) this.close();
		});
		this._form?.addEventListener('submit', (e) => this.handleSubmit(e));
		this._closeBtn?.addEventListener('click', () => this.close());
		this._cancelBtn?.addEventListener('click', () => this.close());
		this._submitBtn?.addEventListener('click', () => this._form?.requestSubmit());

		if (this._amountInput) {
			this._amountInput.addEventListener('input', () => this.updateStateFromAmount());
		}

		document.addEventListener('keydown', this._boundEscape);
		document.addEventListener('open-tip-creator-modal', this._boundOpen);
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this._boundEscape);
		document.removeEventListener('open-tip-creator-modal', this._boundOpen);
	}

	render() {
		this.innerHTML = html`
			<div class="publish-modal-overlay" data-tip-creator-modal-overlay data-tip-creator-modal hidden
				aria-label="Tip Creator" role="dialog" aria-modal="true">
				<div class="publish-modal tip-creator-modal">
					<header class="publish-modal-header">
						<h3>Tip Creator</h3>
						<button type="button" class="publish-modal-close" data-tip-creator-close aria-label="Close">✕</button>
					</header>
					<div class="publish-modal-body">
						<p class="tip-creator-recipient" data-tip-creator-recipient></p>
						<form class="tip-creator-form" data-tip-creator-form>
							<input type="hidden" name="toUserId" value="" />
							<input type="hidden" name="createdImageId" value="" />
							<div class="tip-creator-label">
								<label for="tip-creator-modal-amount">Amount (credits)</label>
								<input id="tip-creator-modal-amount" type="number" name="amount" min="0.1" step="0.1"
									inputmode="decimal" required placeholder="0.0" />
							</div>
							<p class="tip-creator-balance-hint" data-tip-creator-balance-hint></p>
							<div class="tip-creator-label">
								<label for="tip-creator-modal-message">Message (optional)</label>
								<textarea id="tip-creator-modal-message" name="message" rows="2" maxlength="500"
									class="tip-creator-message" placeholder="Optional note to the creator"></textarea>
							</div>
							<p class="tip-creator-warning" data-tip-creator-warning hidden></p>
							<div class="alert error tip-creator-error" data-tip-creator-error hidden></div>
						</form>
					</div>
					<footer class="publish-modal-footer">
						<button type="button" class="btn-secondary" data-tip-creator-cancel>Cancel</button>
						<button type="button" class="btn-primary tip-creator-submit" data-tip-creator-submit>
							<span class="tip-creator-submit-label">Tip</span>
							<span class="tip-creator-spinner" aria-hidden="true"></span>
						</button>
					</footer>
				</div>
			</div>
		`;
	}

	open(detail) {
		const userId = detail?.userId != null ? Number(detail.userId) : null;
		const userName = typeof detail?.userName === 'string' ? detail.userName.trim() : '';
		const createdImageId = detail?.createdImageId != null ? Number(detail.createdImageId) : null;
		const viewerBalanceRaw = detail?.viewerBalance;
		let viewerBalance = null;
		if (typeof viewerBalanceRaw === 'number' && Number.isFinite(viewerBalanceRaw)) {
			viewerBalance = viewerBalanceRaw;
		} else {
			try {
				const stored = window.localStorage?.getItem('credits-balance');
				if (stored != null) {
					const n = Number(stored);
					if (Number.isFinite(n)) viewerBalance = n;
				}
			} catch {
				// ignore
			}
		}

		if (!Number.isFinite(userId) || userId <= 0) return;

		this._userId = userId;
		this._userName = userName || 'Creator';
		this._createdImageId = Number.isFinite(createdImageId) && createdImageId > 0 ? createdImageId : null;
		this._viewerBalance = viewerBalance;

		if (this._form) {
			this._form.reset();
			this._form.elements.toUserId.value = String(userId);
			if (this._form.elements.createdImageId) {
				this._form.elements.createdImageId.value = this._createdImageId != null ? String(this._createdImageId) : '';
			}
		}
		if (this._amountInput) this._amountInput.value = '';
		if (this._errorEl) {
			this._errorEl.hidden = true;
			this._errorEl.textContent = '';
		}
		if (this._recipientEl) {
			this._recipientEl.textContent = `Send credits to ${this._userName}`;
		}

		this.updateStateFromAmount();

		if (this._overlay) {
			this._overlay.hidden = false;
			this._overlay.classList.add('open');
			if (this._amountInput) setTimeout(() => this._amountInput.focus(), 100);
		}
		document.dispatchEvent(new CustomEvent('modal-opened'));
	}

	close() {
		if (this._overlay) {
			this._overlay.classList.remove('open');
			setTimeout(() => {
				if (this._overlay) this._overlay.hidden = true;
			}, 200);
		}
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}

	updateStateFromAmount() {
		if (!this._amountInput || !this._submitBtn) return;
		const raw = this._amountInput.value;
		const amount = Number(raw);
		let canSubmit = Number.isFinite(amount) && amount > 0;

		if (this._balanceHintEl) {
			let hintText = '';

			if (this._viewerBalance != null && Number.isFinite(this._viewerBalance)) {
				const balance = this._viewerBalance;

				if (!Number.isFinite(amount) || amount <= 0) {
					// No amount yet: show current balance so the space is reserved and UI doesn't jump.
					hintText = `You have ${balance.toFixed(1)} credits.`;
				} else {
					const remaining = balance - amount;
					if (remaining >= 0) {
						hintText = `You'll have ${remaining.toFixed(1)} credits left.`;
					} else {
						hintText = 'This exceeds your available credits.';
						canSubmit = false;
					}
				}
			}

			this._balanceHintEl.textContent = hintText;
		}

		if (this._warningEl) {
			if (Number.isFinite(amount) && amount >= TIP_LARGE_AMOUNT_WARNING) {
				this._warningEl.hidden = false;
				this._warningEl.textContent = 'This is a large tip. Please confirm you\'re sure.';
			} else {
				this._warningEl.hidden = true;
				this._warningEl.textContent = '';
			}
		}

		this._submitBtn.disabled = !canSubmit;
	}

	async handleSubmit(e) {
		if (e) e.preventDefault();
		if (!this._form) return;

		const amountInput = this._form.elements.amount;
		const fixedWidth = this._submitBtn?.getBoundingClientRect().width;
		if (this._submitBtn) {
			this._submitBtn.disabled = true;
			if (fixedWidth) this._submitBtn.style.width = `${fixedWidth}px`;
			this._submitBtn.classList.add('is-loading');
		}
		if (amountInput) amountInput.disabled = true;
		if (this._errorEl) {
			this._errorEl.hidden = true;
			this._errorEl.textContent = '';
		}

		const toUserId = Number(this._form.elements.toUserId.value);
		const amount = Number(this._form.elements.amount.value);
		const createdImageId = this._createdImageId != null ? Number(this._createdImageId) : null;
		const message = this._form.elements.message ? String(this._form.elements.message.value || '').trim() : '';

		try {
			const response = await fetch('/api/credits/tip', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					toUserId,
					amount,
					createdImageId,
					message
				})
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				const message = data?.error || 'Failed to tip credits.';
				if (this._errorEl) {
					this._errorEl.hidden = false;
					this._errorEl.textContent = message;
				} else alert(message);
				return;
			}

			const nextFromBalance = typeof data?.fromBalance === 'number' ? data.fromBalance : null;
			if (nextFromBalance !== null) {
				document.dispatchEvent(new CustomEvent('credits-updated', { detail: { count: nextFromBalance } }));
				try {
					window.localStorage?.setItem('credits-balance', String(nextFromBalance));
				} catch {}
			}
			document.dispatchEvent(new CustomEvent('user-updated', { detail: { userId: toUserId } }));
			this.close();
			if (createdImageId !== null) {
				try {
					window.location.reload();
				} catch {}
			}
		} catch (err) {
			const message = err?.message || 'Failed to tip credits.';
			if (this._errorEl) {
				this._errorEl.hidden = false;
				this._errorEl.textContent = message;
			} else alert(message);
		} finally {
			if (this._submitBtn) {
				this._submitBtn.disabled = false;
				this._submitBtn.classList.remove('is-loading');
				this._submitBtn.style.width = '';
			}
			if (amountInput) amountInput.disabled = false;
		}
	}
}

customElements.define('app-modal-tip-creator', AppModalTipCreator);
