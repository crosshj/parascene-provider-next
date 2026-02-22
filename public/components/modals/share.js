const html = String.raw;

import {
	closeIcon,
	xIcon,
	facebookIcon,
	redditIcon,
	linkedinIcon,
	smsIcon,
	emailIcon,
	shareIcon,
	linkIcon,
	qrCodeIcon
} from '../../icons/svg-strings.js';

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
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.left = "-9999px";
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
}

function openShareUrl(url) {
	try {
		window.open(url, "_blank", "noopener,noreferrer");
	} catch {
		window.location.href = url;
	}
}

function buildSmsHref(body) {
	const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "");
	const sep = isIOS ? "&" : "?";
	return `sms:${sep}body=${encodeURIComponent(body)}`;
}

class AppModalShare extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._qrModalOpen = false;
		this._creationId = null;
		this._shareUrl = null;
		this._loading = false;
		this._openRequestId = 0;
		this._ctaTimers = new Set();

		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpen = this.handleOpen.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
		this.closeQrModal = this.closeQrModal.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
		this.updateButtons();
	}

	disconnectedCallback() {
		document.removeEventListener("keydown", this.handleEscape);
		document.removeEventListener("open-share-modal", this.handleOpen);
		document.removeEventListener("close-all-modals", this.handleCloseAllModals);

		for (const t of this._ctaTimers) clearTimeout(t);
		this._ctaTimers.clear();
	}

	render() {
		const iconClose = closeIcon('modal-close-icon');
		const iconCloseQr = closeIcon('qr-modal-close-icon');
		const iconX = xIcon('share-option-icon share-option-icon-x is-brand');
		const iconFacebook = facebookIcon('share-option-icon share-option-icon-facebook is-brand');
		const iconReddit = redditIcon('share-option-icon share-option-icon-reddit is-brand');
		const iconLinkedin = linkedinIcon('share-option-icon share-option-icon-linkedin is-brand');
		const iconSms = smsIcon();
		const iconEmail = emailIcon();
		const iconShare = shareIcon();
		const iconQrCode = qrCodeIcon();
		const iconLink = linkIcon();

		this.innerHTML = html`
			<div class="modal-overlay" data-overlay>
				<div class="modal modal-medium">
					<div class="modal-header">
						<h3>Share</h3>
						<button class="modal-close" type="button" aria-label="Close">
							${iconClose}
						</button>
					</div>
			
					<div class="modal-body share-modal-body">
						<!--
												<p class="share-modal-note">
													<span class="share-modal-note-strong">You may be rewarded if someone joins after viewing.</span>
												</p>
												-->
			
						<div class="share-action-list" role="list">
							<button type="button" class="share-action-row" data-share-x>
								<span class="share-action-left">
									<span class="share-option-icon share-option-icon-x is-brand">${iconX}</span>
									<span class="share-action-text">
										<span class="share-action-title">Share on X</span>
										<span class="share-action-subtitle">Formerly known as Twitter</span>
									</span>
								</span>
								<span class="share-action-cta share-action-cta-x" data-cta><span
										class="share-action-cta-label">Post</span></span>
							</button>
			
							<button type="button" class="share-action-row" data-share-facebook>
								<span class="share-action-left">
									<span class="share-option-icon share-option-icon-facebook is-brand">${iconFacebook}</span>
									<span class="share-action-text">
										<span class="share-action-title">Share on Facebook</span>
										<span class="share-action-subtitle">Show your friends</span>
									</span>
								</span>
								<span class="share-action-cta share-action-cta-facebook" data-cta><span
										class="share-action-cta-label">Share</span></span>
							</button>
			
							<button type="button" class="share-action-row" data-share-reddit>
								<span class="share-action-left">
									<span class="share-option-icon share-option-icon-reddit is-brand">${iconReddit}</span>
									<span class="share-action-text">
										<span class="share-action-title">Post to Reddit</span>
										<span class="share-action-subtitle">Share to a subreddit</span>
									</span>
								</span>
								<span class="share-action-cta share-action-cta-reddit" data-cta><span
										class="share-action-cta-label">Post</span></span>
							</button>
			
							<button type="button" class="share-action-row" data-share-linkedin>
								<span class="share-action-left">
									<span class="share-option-icon share-option-icon-linkedin is-brand">${iconLinkedin}</span>
									<span class="share-action-text">
										<span class="share-action-title">Share on LinkedIn</span>
										<span class="share-action-subtitle">Share with your network</span>
									</span>
								</span>
								<span class="share-action-cta share-action-cta-linkedin" data-cta><span
										class="share-action-cta-label">Share</span></span>
							</button>
			
							<button type="button" class="share-action-row" data-share-sms>
								<span class="share-action-left">
									<span class="share-option-icon">${iconSms}</span>
									<span class="share-action-text">
										<span class="share-action-title">Text message</span>
										<span class="share-action-subtitle">Send via Messages</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Send</span></span>
							</button>
			
							<button type="button" class="share-action-row" data-share-email>
								<span class="share-action-left">
									<span class="share-option-icon">${iconEmail}</span>
									<span class="share-action-text">
										<span class="share-action-title">Email</span>
										<span class="share-action-subtitle">Send a message with the link</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Send</span></span>
							</button>
			
							<button type="button" class="share-action-row" data-native-share style="display: none;">
								<span class="share-action-left">
									<span class="share-option-icon">${iconShare}</span>
									<span class="share-action-text">
										<span class="share-action-title">Device share</span>
										<span class="share-action-subtitle">Use your device's share menu</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Open</span></span>
							</button>
			
							<button type="button" class="share-action-row" data-qr-code>
								<span class="share-action-left">
									<span class="share-option-icon">${iconQrCode}</span>
									<span class="share-action-text">
										<span class="share-action-title">QR Code</span>
										<span class="share-action-subtitle">Scan to open link</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Show</span></span>
							</button>
			
							<button type="button" class="share-action-row" data-copy-link>
								<span class="share-action-left">
									<span class="share-option-icon">${iconLink}</span>
									<span class="share-action-text">
										<span class="share-action-title">Copy link</span>
										<span class="share-action-subtitle">Share it anywhere</span>
									</span>
								</span>
								<span class="share-action-cta" data-cta><span class="share-action-cta-label">Copy</span></span>
							</button>
						</div>
			
						<button type="button" class="share-modal-cancel" data-cancel>Cancel</button>
					</div>
				</div>
			</div>
			
			<div class="modal-overlay qr-modal-overlay" data-qr-overlay aria-hidden="true" inert>
				<div class="modal qr-modal">
					<div class="qr-modal-header">
						<button class="modal-close qr-modal-close" type="button"
							aria-label="Close">${iconCloseQr}</button>
					</div>
					<div class="qr-modal-body">
						<div class="qr-modal-svg-wrap" data-qr-content></div>
					</div>
				</div>
			</div>
		`;
	}

	setupEventListeners() {
		document.addEventListener("keydown", this.handleEscape);
		document.addEventListener("open-share-modal", this.handleOpen);
		document.addEventListener("close-all-modals", this.handleCloseAllModals);

		const overlay = this.querySelector("[data-overlay]");
		const closeBtn = this.querySelector(".modal-close");
		const cancelBtn = this.querySelector("[data-cancel]");
		const copyBtn = this.querySelector("[data-copy-link]");
		const qrBtn = this.querySelector("[data-qr-code]");
		const nativeBtn = this.querySelector("[data-native-share]");
		const smsBtn = this.querySelector("[data-share-sms]");
		const emailBtn = this.querySelector("[data-share-email]");
		const xBtn = this.querySelector("[data-share-x]");
		const fbBtn = this.querySelector("[data-share-facebook]");
		const redditBtn = this.querySelector("[data-share-reddit]");
		const liBtn = this.querySelector("[data-share-linkedin]");

		if (overlay) {
			overlay.addEventListener("click", (e) => {
				if (e.target === overlay && !this._loading) {
					this.close();
				}
			});
		}
		if (closeBtn) closeBtn.addEventListener("click", () => this.close());
		if (cancelBtn) cancelBtn.addEventListener("click", () => this.close());

		if (copyBtn) copyBtn.addEventListener("click", (e) => void this.handleCopy(e.currentTarget));
		if (qrBtn) qrBtn.addEventListener("click", (e) => void this.handleQrCode(e.currentTarget));
		if (nativeBtn) nativeBtn.addEventListener("click", (e) => void this.handleNativeShare(e.currentTarget));

		const qrOverlay = this.querySelector("[data-qr-overlay]");
		const qrCloseBtn = this.querySelector(".qr-modal-close");
		if (qrOverlay) {
			qrOverlay.addEventListener("click", (e) => {
				if (e.target === qrOverlay) this.closeQrModal();
			});
		}
		if (qrCloseBtn) qrCloseBtn.addEventListener("click", () => this.closeQrModal());

		if (smsBtn) smsBtn.addEventListener("click", (e) => void this.handleSms(e.currentTarget));
		if (emailBtn) emailBtn.addEventListener("click", (e) => void this.handleEmail(e.currentTarget));
		if (xBtn) xBtn.addEventListener("click", (e) => void this.handleX(e.currentTarget));
		if (fbBtn) fbBtn.addEventListener("click", (e) => void this.handleFacebook(e.currentTarget));
		if (redditBtn) redditBtn.addEventListener("click", (e) => void this.handleReddit(e.currentTarget));
		if (liBtn) liBtn.addEventListener("click", (e) => void this.handleLinkedIn(e.currentTarget));
	}

	handleEscape(e) {
		if (e.key !== "Escape") return;
		if (this._qrModalOpen) {
			this.closeQrModal();
			return;
		}
		if (this._isOpen && !this._loading) {
			this.close();
		}
	}

	handleOpen(e) {
		const id = e.detail?.creationId ?? null;
		this.open(id);
	}

	handleCloseAllModals() {
		this.close();
	}

	resetAllCtas() {
		const ctas = Array.from(this.querySelectorAll("[data-cta]"));
		for (const cta of ctas) {
			if (!(cta instanceof HTMLElement)) continue;
			this.setCtaState(cta, "");
			const defaultLabel = cta.dataset.defaultLabel || cta.textContent?.trim() || "";
			if (!cta.dataset.defaultLabel) cta.dataset.defaultLabel = defaultLabel;
			this.setCtaLabel(cta, cta.dataset.defaultLabel || defaultLabel);
		}
	}

	open(creationId) {
		this._creationId = creationId ?? null;
		this._shareUrl = null;
		this._openRequestId++;
		this.resetAllCtas();
		this._isOpen = true;
		const overlay = this.querySelector("[data-overlay]");
		if (overlay) overlay.classList.add("open");
		this.updateButtons();
	}

	close() {
		this.closeQrModal();
		this._isOpen = false;
		this._loading = false;
		this._creationId = null;
		this._shareUrl = null;
		this._openRequestId++;
		const overlay = this.querySelector("[data-overlay]");
		if (overlay) overlay.classList.remove("open");
		this.resetAllCtas();
	}

	updateButtons() {
		const nativeBtn = this.querySelector("[data-native-share]");
		if (nativeBtn instanceof HTMLButtonElement) {
			nativeBtn.style.display = typeof navigator.share === "function" ? "" : "none";
		}
	}

	getCtaEl(buttonEl) {
		if (!(buttonEl instanceof HTMLElement)) return null;
		return buttonEl.querySelector("[data-cta]");
	}

	setCtaLabel(ctaEl, label) {
		if (!(ctaEl instanceof HTMLElement)) return;
		const labelEl = ctaEl.querySelector(".share-action-cta-label");
		if (labelEl) labelEl.textContent = String(label || "");
	}

	setCtaState(ctaEl, state) {
		if (!(ctaEl instanceof HTMLElement)) return;
		if (!state) {
			ctaEl.removeAttribute("data-state");
			ctaEl.removeAttribute("aria-busy");
			return;
		}
		ctaEl.setAttribute("data-state", String(state));
		if (state === "loading") ctaEl.setAttribute("aria-busy", "true");
		else ctaEl.removeAttribute("aria-busy");
	}

	async runCtaAction(buttonEl, fn, opts = {}) {
		const btn = buttonEl instanceof HTMLButtonElement ? buttonEl : null;
		if (!btn) return;
		if (btn.dataset.busy === "1") return;
		btn.dataset.busy = "1";

		const cta = this.getCtaEl(btn);
		const defaultLabel = cta?.dataset?.defaultLabel || cta?.textContent?.trim() || "";
		if (cta && !cta.dataset.defaultLabel) cta.dataset.defaultLabel = defaultLabel;

		const resetMs = Number.isFinite(opts.resetMs) ? opts.resetMs : 1200;
		const successLabel = typeof opts.successLabel === "string" ? opts.successLabel : defaultLabel;
		const errorLabel = typeof opts.errorLabel === "string" ? opts.errorLabel : "Failed";

		try {
			if (cta) {
				this.setCtaLabel(cta, defaultLabel);
				this.setCtaState(cta, "loading");
			}
			await fn();
			if (cta) {
				this.setCtaState(cta, "");
				this.setCtaLabel(cta, successLabel);
			}
		} catch (err) {
			if (cta) {
				this.setCtaState(cta, "");
				this.setCtaLabel(cta, errorLabel);
			}
		} finally {
			const t = setTimeout(() => {
				if (cta) {
					this.setCtaState(cta, "");
					this.setCtaLabel(cta, cta.dataset.defaultLabel || defaultLabel);
				}
				if (btn) delete btn.dataset.busy;
				this._ctaTimers.delete(t);
			}, resetMs);
			this._ctaTimers.add(t);
		}
	}

	async ensureShareUrl() {
		if (this._shareUrl) return this._shareUrl;
		const creationId = Number(this._creationId);
		if (!Number.isFinite(creationId) || creationId <= 0) {
			throw new Error("Invalid creation");
		}

		const requestId = this._openRequestId;
		this._loading = true;
		try {
			const res = await fetch(`/api/create/images/${creationId}/share`, {
				method: "POST",
				credentials: "include"
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error((data && data.error) ? String(data.error) : "Failed to create share link");
			}
			const data = await res.json().catch(() => null);
			const url = typeof data?.url === "string" ? data.url.trim() : "";
			if (!url) throw new Error("Failed to create share link");
			if (requestId !== this._openRequestId) throw new Error("Stale");
			this._shareUrl = url;
			return url;
		} finally {
			this._loading = false;
		}
	}

	shareMessage(url) {
		return `Check this out on Parascene: ${url}\n\nCreate your own for free (your friend may be rewarded if you join after viewing).`;
	}

	closeQrModal() {
		this._qrModalOpen = false;
		const overlay = this.querySelector("[data-qr-overlay]");
		if (overlay) {
			// Move focus out before hiding so we never have focus inside an aria-hidden/inert subtree.
			if (overlay.contains(document.activeElement)) {
				const qrTrigger = this.querySelector("[data-qr-code]");
				if (qrTrigger instanceof HTMLElement) qrTrigger.focus();
			}
			overlay.classList.remove("open");
			overlay.setAttribute("aria-hidden", "true");
			overlay.setAttribute("inert", "");
		}
		const content = this.querySelector("[data-qr-content]");
		if (content) content.innerHTML = "";
	}

	async handleQrCode(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const res = await fetch(`/api/qr?url=${encodeURIComponent(url)}`);
			if (!res.ok) throw new Error("Failed to load QR code");
			const svgText = await res.text();
			const content = this.querySelector("[data-qr-content]");
			if (!content) return;
			content.innerHTML = svgText;
			this._qrModalOpen = true;
			const overlay = this.querySelector("[data-qr-overlay]");
			if (overlay) {
				overlay.classList.add("open");
				overlay.setAttribute("aria-hidden", "false");
				overlay.removeAttribute("inert");
			}
		}, { successLabel: "Show", errorLabel: "Failed", resetMs: 800 });
	}

	async handleCopy(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const ok = await copyTextToClipboard(url);
			if (!ok) throw new Error("Copy failed");
		}, { successLabel: "Copied", errorLabel: "Copy failed", resetMs: 1600 });
	}

	async handleNativeShare(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			if (typeof navigator.share !== "function") return;
			await navigator.share({
				title: "Parascene",
				text: "A creation on Parascene",
				url
			});
		}, { resetMs: 900 });
	}

	async handleSms(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			window.location.href = buildSmsHref(this.shareMessage(url));
		}, { resetMs: 900 });
	}

	async handleEmail(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const subject = "Parascene";
			const body = this.shareMessage(url);
			window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
		}, { resetMs: 900 });
	}

	async handleX(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const hashtags = "parascene";
			openShareUrl(
				`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&hashtags=${encodeURIComponent(hashtags)}`
			);
		}, { resetMs: 900 });
	}

	async handleFacebook(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			openShareUrl(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
		}, { resetMs: 900 });
	}

	async handleReddit(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			const title = "Parascene";
			openShareUrl(`https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`);
		}, { resetMs: 900 });
	}

	async handleLinkedIn(buttonEl) {
		await this.runCtaAction(buttonEl, async () => {
			const url = await this.ensureShareUrl();
			openShareUrl(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`);
		}, { resetMs: 900 });
	}
}

customElements.define("app-modal-share", AppModalShare);

