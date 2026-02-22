const html = String.raw;

class AppModalCreationDetails extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._meta = null;
		this._creationId = null;
		this._description = '';
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpen = this.handleOpen.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
	}

	disconnectedCallback() {
		document.removeEventListener("keydown", this.handleEscape);
		document.removeEventListener("open-creation-details-modal", this.handleOpen);
		document.removeEventListener("close-all-modals", this.handleCloseAllModals);
	}

	render() {
		this.innerHTML = html`
			<div class="modal-overlay" data-overlay>
				<div class="modal modal-medium">
					<div class="modal-header">
						<h3>More Info</h3>
						<button class="modal-close" type="button" aria-label="Close">
							<svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
								stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					</div>
					<div class="modal-body">
						<div class="field" data-args-field>
							<div class="label">Arguments</div>
							<pre class="creation-details-args" data-args></pre>
						</div>
						<div class="field" data-provider-error-field style="display: none;">
							<div class="label">Provider error</div>
							<pre class="creation-details-args" data-provider-error></pre>
						</div>
					</div>
					<div class="modal-footer">
						<button type="button" class="btn-secondary" data-close-secondary>Close</button>
					</div>
				</div>
			</div>
		`;

	}

	setupEventListeners() {
		document.addEventListener("keydown", this.handleEscape);
		document.addEventListener("open-creation-details-modal", this.handleOpen);
		document.addEventListener("close-all-modals", this.handleCloseAllModals);

		const overlay = this.querySelector("[data-overlay]");
		const closeBtn = this.querySelector(".modal-close");
		const closeSecondary = this.querySelector("[data-close-secondary]");

		if (overlay) {
			overlay.addEventListener("click", (e) => {
				if (e.target === overlay) {
					this.close();
				}
			});
		}

		if (closeBtn) {
			closeBtn.addEventListener("click", () => this.close());
		}

		if (closeSecondary) {
			closeSecondary.addEventListener("click", () => this.close());
		}
	}

	handleEscape(event) {
		if (event.key === "Escape" && this._isOpen) {
			this.close();
		}
	}

	handleCloseAllModals() {
		this.close();
	}

	handleOpen(event) {
		const detail = event.detail || {};
		this._meta = detail.meta || null;
		this._creationId = detail.creationId || null;
		this._description = detail.description || '';
		this.updateContent();
		this.open();
	}

	updateContent() {
		const meta = this._meta || {};
		const argsEl = this.querySelector("[data-args]");
		const argsField = this.querySelector("[data-args-field]");
		const providerErrorField = this.querySelector("[data-provider-error-field]");
		const providerErrorEl = this.querySelector("[data-provider-error]");

		const args = meta.args ?? null;
		const isPlainObject = args && typeof args === "object" && !Array.isArray(args);
		const argKeys = isPlainObject ? Object.keys(args) : [];
		const isPromptOnly = isPlainObject && argKeys.length === 1 && Object.prototype.hasOwnProperty.call(args, "prompt");

		// Check if there's history/lineage
		const historyRaw = meta.history;
		const hasHistory = Array.isArray(historyRaw) && historyRaw.length > 0;

		// Check if prompt matches description or would be shown in description
		const description = typeof this._description === 'string' ? this._description.trim() : '';
		const promptText = isPlainObject && Object.prototype.hasOwnProperty.call(args, "prompt") && typeof args.prompt === 'string' ? args.prompt.trim() : '';
		const hasPrompt = promptText.length > 0;
		// Hide prompt if: it's prompt-only, OR prompt exists (always shown in description section)
		const shouldHidePrompt = isPromptOnly || hasPrompt;

		if (isPromptOnly) {
			if (argsField) {
				argsField.style.display = "none";
			}
		} else {
			if (argsField) {
				argsField.style.display = "";
			}
			if (argsEl) {
				try {
					// Filter out image_url if there's history, and prompt if it matches description or would be shown in description
					let argsToDisplay = args;
					if (isPlainObject) {
						argsToDisplay = { ...args };
						if (hasHistory && Object.prototype.hasOwnProperty.call(argsToDisplay, "image_url")) {
							delete argsToDisplay.image_url;
						}
						if (shouldHidePrompt && Object.prototype.hasOwnProperty.call(argsToDisplay, "prompt")) {
							delete argsToDisplay.prompt;
						}
					}
					const pretty = JSON.stringify(argsToDisplay ?? {}, null, 2);
					argsEl.textContent = pretty;
				} catch {
					argsEl.textContent = String(args ?? "");
				}
			}
		}

		// Provider error details (non-2xx payloads captured from provider)
		const providerError = meta.provider_error ?? null;
		if (providerErrorField instanceof HTMLElement && providerErrorEl) {
			if (!providerError || typeof providerError !== "object") {
				providerErrorField.style.display = "none";
				providerErrorEl.textContent = "";
			} else {
				providerErrorField.style.display = "";
				try {
					// Prefer showing provider's own error/message if present.
					const body = providerError.body;
					const msg =
						body && typeof body === "object"
							? (typeof body.error === "string" ? body.error : (typeof body.message === "string" ? body.message : ""))
							: (typeof body === "string" ? body : "");
					if (msg) {
						providerErrorEl.textContent = msg;
					} else {
						providerErrorEl.textContent = JSON.stringify(providerError, null, 2);
					}
				} catch {
					providerErrorEl.textContent = String(providerError);
				}
			}
		}
	}

	open() {
		if (this._isOpen) return;
		this._isOpen = true;
		const overlay = this.querySelector("[data-overlay]");
		if (overlay) {
			overlay.classList.add("open");
		}
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.querySelector("[data-overlay]");
		if (overlay) {
			overlay.classList.remove("open");
		}
	}
}

customElements.define("app-modal-creation-details", AppModalCreationDetails);

