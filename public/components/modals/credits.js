import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { formatRelativeTime } from '../../shared/datetime.js';
import { helpIcon, creditIcon, closeIcon } from '../../icons/svg-strings.js';

const html = String.raw;

class AppModalCredits extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._claimInFlight = false;
		this._creditsRefreshLastCall = 0;
		this.creditsCount = 0;
		this.lastClaimDate = null;
		this.canClaim = null; // null = unknown until /api/credits responds
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenEvent = this.handleOpenEvent.bind(this);
		this.handleCloseEvent = this.handleCloseEvent.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
		this.handleClaimCredits = this.handleClaimCredits.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
		this.refreshCredits();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this.handleEscape);
		document.removeEventListener('open-credits', this.handleOpenEvent);
		document.removeEventListener('close-credits', this.handleCloseEvent);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('open-credits', this.handleOpenEvent);
		document.addEventListener('close-credits', this.handleCloseEvent);
		document.addEventListener('close-all-modals', this.handleCloseAllModals);

		const overlay = this.querySelector('.credits-overlay');
		const closeButton = this.querySelector('.credits-close');
		const claimButton = this.querySelector('.credits-claim-button');

		if (overlay) {
			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) {
					this.close();
				}
			});
		}

		if (closeButton) {
			closeButton.addEventListener('click', () => {
				this.close();
			});
		}

		if (claimButton) {
			claimButton.addEventListener('click', this.handleClaimCredits);
		}
	}

	handleOpenEvent() {
		this.open();
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

	open() {
		if (this._isOpen) return;
		this._isOpen = true;
		const overlay = this.querySelector('.credits-overlay');
		if (overlay) {
			overlay.classList.add('open');
		}
		document.dispatchEvent(new CustomEvent('close-notifications'));
		document.dispatchEvent(new CustomEvent('modal-opened'));
		this.refreshCredits();
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.querySelector('.credits-overlay');
		if (overlay) {
			overlay.classList.remove('open');
		}
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}

	async refreshCredits({ force = false } = {}) {
		// Throttle: avoid repeated fetches when connectedCallback or open() fires many times (e.g. reconnection loop).
		const now = Date.now();
		if (!force && now - this._creditsRefreshLastCall < 2500) return;
		this._creditsRefreshLastCall = now;

		try {
			// First, get current user to check if user changed (deduped).
			const profileResult = await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 2000 })
				.catch(() => ({ ok: false, status: 0, data: null }));
			const currentUserEmail = profileResult.ok ? (profileResult.data?.email || null) : null;

			// If no signed-in user, clear cache
			if (!currentUserEmail) {
				this.clearStoredCredits();
				this.clearStoredUserEmail();
				this.creditsCount = 0;
				this.updateCreditsUI();
				this.updateClaimUI();
				return;
			}

			// Check if user changed - if so, clear cache
			const cachedUserEmail = this.readStoredUserEmail();
			if (cachedUserEmail && currentUserEmail !== cachedUserEmail) {
				// User changed - clear cache
				this.clearStoredCredits();
				this.clearStoredUserEmail();
			}

			// Note: fetchJsonWithStatusDeduped caches GET results for a short window.
			// After mutating credits (claim), force a cache-busted read to avoid stale UI.
			const creditsUrl = force ? `/api/credits?bust=${Date.now()}` : '/api/credits';
			const credits = await fetchJsonWithStatusDeduped(
				creditsUrl,
				{ credentials: 'include' },
				{ windowMs: force ? 0 : 2000 }
			);
			if (!credits.ok) {
				// If unauthorized or any error, clear cache
				if (credits.status === 401 || !currentUserEmail) {
					this.clearStoredCredits();
					this.clearStoredUserEmail();
				}
				this.creditsCount = 0;
				this.canClaim = null;
				this.updateCreditsUI();
				this.updateClaimUI();
				return;
			}
			this.creditsCount = this.normalizeCredits(credits.data?.balance ?? 0);
			this.lastClaimDate = credits.data?.lastClaimDate || null;
			this.canClaim = typeof credits.data?.canClaim === 'boolean'
				? credits.data.canClaim
				: null;
			// Keep a simple YYYY-MM-DD marker for header claim attention.
			if (this.lastClaimDate) {
				this.writeStoredClaimDate(String(this.lastClaimDate).slice(0, 10));
			}
			// Cache in localStorage with user email
			if (currentUserEmail) {
				this.writeStoredCredits(this.creditsCount);
				this.writeStoredUserEmail(currentUserEmail);
			}
			this.updateCreditsUI();
			this.updateClaimUI();
		} catch {
			// Fallback to cached value (best-effort).
			const storedCredits = this.readStoredCredits();
			if (storedCredits !== null && this.readStoredUserEmail()) {
				this.creditsCount = storedCredits;
				this.updateCreditsUI();
				this.updateClaimUI();
				return;
			}

			this.clearStoredCredits();
			this.clearStoredUserEmail();
			this.creditsCount = 0;
			this.canClaim = null;
			this.updateCreditsUI();
			this.updateClaimUI();
		}
	}

	async handleClaimCredits() {
		if (this._claimInFlight) return;
		if (this.canClaim === false) return;
		if (this.isClaimedToday()) return;

		this._claimInFlight = true;
		this.updateClaimUI();
		try {
			const response = await fetch('/api/credits/claim', {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				const error = await response.json();
				// console.error('Failed to claim credits:', error);
				return;
			}

			const data = await response.json();
			if (data.success) {
				this.creditsCount = this.normalizeCredits(data.balance);
				this.writeStoredCredits(this.creditsCount);
				// Immediately mark as claimed today so header/UI updates even if refresh fails.
				this.lastClaimDate = new Date().toISOString();
				this.writeStoredClaimDate(this.getTodayKey());
				this.canClaim = false;
				// Refresh (forced) to get updated lastClaimDate/balance from server.
				await this.refreshCredits({ force: true });
				this.updateCreditsUI();
				this.updateClaimUI();
				document.dispatchEvent(new CustomEvent('credits-updated', {
					detail: { count: this.creditsCount }
				}));
				document.dispatchEvent(new CustomEvent('credits-claim-status', {
					detail: { canClaim: false }
				}));
			}
		} catch (error) {
			// console.error('Error claiming credits:', error);
		} finally {
			this._claimInFlight = false;
			this.updateClaimUI();
		}
	}

	updateCreditsUI() {
		const balanceValue = this.querySelector('.credits-balance-value');
		if (balanceValue) {
			balanceValue.textContent = this.formatCredits(this.creditsCount);
		}
	}

	getNextAvailableTime() {
		// Daily credits reset at midnight UTC
		const now = new Date();
		const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		const tomorrowUTC = new Date(todayUTC);
		tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
		return tomorrowUTC;
	}

	updateClaimUI() {
		const claimButton = this.querySelector('.credits-claim-button');
		const claimNote = this.querySelector('.credits-claim-note');
		const canClaim = this.canClaim;
		const claimed = canClaim === null ? this.isClaimedToday() : !canClaim;
		if (claimButton) {
			claimButton.disabled = this._claimInFlight || (canClaim === null ? claimed : !canClaim);
			claimButton.textContent = this._claimInFlight ? 'Claiming…' : 'Claim 10 credits';
			claimButton.setAttribute('aria-busy', this._claimInFlight ? 'true' : 'false');
		}
		if (claimNote) {
			// Calculate when next daily credits will be available (midnight UTC)
			const nextAvailable = this.getNextAvailableTime();
			const now = new Date();
			const hoursUntilAvailable = (nextAvailable.getTime() - now.getTime()) / (1000 * 60 * 60);

			// If more than 12 hours away, show simple "tomorrow" message
			if (hoursUntilAvailable > 12) {
				claimNote.textContent = 'Check back tomorrow for more credits.';
			} else {
				const relativeTime = formatRelativeTime(nextAvailable, { style: 'long' });
				claimNote.textContent = `Daily credits available ${relativeTime}.`;
			}
			claimNote.style.visibility = canClaim === false ? 'visible' : 'hidden';
		}
		// Only broadcast claim status when it is confirmed by /api/credits.
		if (typeof canClaim === 'boolean') {
			document.dispatchEvent(new CustomEvent('credits-claim-status', {
				detail: { canClaim }
			}));
		}
	}

	isClaimedToday() {
		if (!this.lastClaimDate) return false;
		const now = new Date();
		const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		const lastClaimDate = new Date(this.lastClaimDate);
		const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
		return lastClaimUTC.getTime() >= todayUTC.getTime();
	}

	getTodayKey() {
		return new Date().toISOString().slice(0, 10);
	}

	normalizeCredits(value) {
		const count = Number(value);
		if (!Number.isFinite(count)) return 0;
		return Math.max(0, Math.round(count * 10) / 10);
	}

	formatCredits(value) {
		const count = this.normalizeCredits(value);
		// Show the actual decimal value (e.g., "101.5" instead of "101+")
		// If it's a whole number, show without decimal places
		const wholePart = Math.floor(count);
		const decimalPart = count - wholePart;
		if (decimalPart > 0) {
			// Show one decimal place
			return count.toFixed(1);
		}
		return String(wholePart);
	}

	readStoredCredits() {
		try {
			const stored = window.localStorage?.getItem('credits-balance');
			if (stored == null) return null;
			return this.normalizeCredits(stored);
		} catch {
			return null;
		}
	}

	writeStoredCredits(value) {
		try {
			window.localStorage?.setItem('credits-balance', String(this.normalizeCredits(value)));
		} catch {
			// ignore storage errors
		}
	}

	readStoredClaimDate() {
		try {
			return window.localStorage?.getItem('credits-last-claim');
		} catch {
			return null;
		}
	}

	writeStoredClaimDate(value) {
		try {
			window.localStorage?.setItem('credits-last-claim', value);
		} catch {
			// ignore storage errors
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

	render() {
		this.innerHTML = html`
      <style>
        app-modal-credits {
          display: block;
        }
        .credits-overlay {
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
        .credits-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .credits-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: var(--shadow);
          max-width: 560px;
          width: 92%;
          max-height: 90vh;
          overflow-y: auto;
          transform: scale(0.95);
          transition: transform 0.2s;
        }
        .credits-overlay.open .credits-modal {
          transform: scale(1);
        }
        .credits-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--border);
        }
        .credits-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }
        .credits-close {
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
        .credits-close:hover {
          background: var(--surface-strong);
        }
        .credits-close-icon {
          width: 24px;
          height: 24px;
        }
        .credits-body {
          padding: 20px;
        }
        .credits-balance {
          margin-bottom: 18px;
        }
        .credits-body p {
          margin: 0 0 12px;
          color: var(--text-muted);
        }
        .credits-section {
          margin-top: 3em;
        }
        .credits-section h3 {
          margin: 0 0 8px;
          font-size: 1rem;
        }
        .credits-list {
          margin: 0;
          padding-left: 18px;
        }
        .credits-list li {
          margin: 6px 0;
        }
        .credits-action-row {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 12px;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        /* Modal-specific: ensure button maintains min-width when disabled */
        app-modal-credits .btn-primary {
          min-width: 140px;
        }
        /* Ensure btn-secondary matches button height in this modal */
        app-modal-credits .btn-secondary {
          padding: 10px 16px;
        }
        .credits-claim-note {
          color: var(--text-muted);
          font-size: 0.95rem;
        }
        .credits-note {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface-strong);
          color: var(--text-muted);
          font-size: 0.95rem;
        }
      </style>
      <div class="credits-overlay">
        <div class="credits-modal">
          <div class="credits-header">
            <div></div>
            <button class="credits-close" aria-label="Close">
              ${closeIcon('credits-close-icon')}
            </button>
          </div>
          <div class="credits-body">
            <div class="credits-balance">
              <span>You have</span>
			  <strong class="credits-balance-value">0.0</strong>
			  <strong>credits</strong>
			  <span>available.</span>
            </div>

            <div class="credits-section">
              <h3>Claim daily free credits</h3>
              <p>Claim 10 credits once per day.</p>
              <div class="credits-action-row">
                <button class="btn-primary credits-claim-button" type="button">Claim 10 credits</button>
                <span class="credits-claim-note">Come back tomorrow for more credits.</span>
              </div>
            </div>

            <div class="credits-section">
              <h3>Get more credits</h3>
              <p>Explore subscription options and plans.</p>
              <a class="btn-outlined" href="/pricing">
                ${creditIcon('icon')}
                View Plans
              </a>
            </div>

            <div class="credits-section">
              <h3>Run a server</h3>
              <p>Run a server and earn credits for supporting the community.</p>
              <a class="btn-secondary" href="/help/credits/run-a-server">
                ${helpIcon('icon')}
                Learn More
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
	}
}

customElements.define('app-modal-credits', AppModalCredits);
