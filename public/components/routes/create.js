import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { submitCreationWithPending, uploadImageFile, formatMentionsFailureForDialog } from '../../shared/createSubmit.js';
import { renderFields, isPromptLikeField } from '../../shared/providerFormFields.js';
import { attachAutoGrowTextarea } from '../../shared/autogrow.js';

const html = String.raw;

class AppRouteCreate extends HTMLElement {
	constructor() {
		super();
		this.creditsCount = 0;
		this.selectedServer = null;
		this.selectedMethod = null;
		this.fieldValues = {};
		this.servers = [];
		this.handleCreditsUpdated = this.handleCreditsUpdated.bind(this);
		this.storageKey = 'create-page-selections';
		this._advancedConfirm = null; // { serverId, args, cost } when cost dialog is open
		this._promptFromUrl = null; // prompt from ?prompt= (landing page); applied when Basic tab has a prompt field
		this._confirmPrimaryAction = null;
	}

	connectedCallback() {
		this.innerHTML = html`
      <style>
        .create-route .create-form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          margin-bottom: 1.5rem;
        }
        .create-route [data-fields-container] {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .create-route .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .create-route .form-label {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--text);
          display: inline-block;
        }
        .create-route .field-required {
          display: inline;
          margin-left: 2px;
        }
        .create-route .form-input,
        .create-route .form-select {
          padding: 0.75rem 1rem;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--input-bg);
          color: var(--text);
          font-size: 0.95rem;
          font-family: inherit;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .create-route .form-input[type="textarea"],
        .create-route textarea.form-input {
          resize: none;
          overflow: hidden;
          min-height: auto;
        }
        .create-route textarea.form-input.prompt-editor {
          overflow-y: auto;
        }
        .create-route .form-select {
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
          padding-right: 2.25rem;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a0a0a0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 0.75rem center;
          background-size: 1rem;
          cursor: pointer;
        }
        .create-route .form-input:focus-visible,
        .create-route .form-select:focus-visible {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
        }
        .create-route .form-input::placeholder {
          color: var(--text-muted);
        }
        .create-route .form-input[type="color"] {
          height: 48px;
          cursor: pointer;
        }
        .create-route .form-group-checkbox {
          flex-direction: row;
          align-items: center;
          gap: 0.75rem;
        }
        .create-route .form-group-checkbox .form-label {
          margin-bottom: 0;
        }
        .create-route .form-switch-input {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .create-route .form-switch {
          position: relative;
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          cursor: pointer;
        }
        .create-route .form-switch:focus-visible {
          outline: 2px solid var(--accent-switch);
          outline-offset: 2px;
          border-radius: 999px;
        }
        .create-route .form-switch-track {
          display: flex;
          align-items: center;
          width: 2.75rem;
          height: 1.5rem;
          padding: 2px;
          border-radius: 999px;
          background: var(--switch-track-off);
          transition: background 0.2s ease, box-shadow 0.2s ease;
        }
        .create-route .form-switch-input:focus-visible ~ .form-switch-track,
        .create-route .form-switch:focus-visible .form-switch-track {
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-switch) 40%, transparent);
        }
        .create-route .form-switch-thumb {
          width: 1.25rem;
          height: 1.25rem;
          border-radius: 50%;
          background: var(--switch-thumb-off);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          transition: transform 0.2s ease;
          transform: translateX(0);
        }
        .create-route .form-switch-input:checked ~ .form-switch-track {
          background: color-mix(in srgb, var(--accent-switch) 40%, var(--switch-track-off));
        }
        .create-route .form-switch-input:checked ~ .form-switch-track .form-switch-thumb {
          background: var(--accent-switch);
          transform: translateX(1.25rem);
        }
        .create-route .create-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-start;
          margin-top: 1.5rem;
        }
        .create-route .create-button-spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 2px solid color-mix(in srgb, var(--accent-text) 40%, transparent);
          border-top-color: var(--accent-text);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          vertical-align: middle;
        }
        .create-route .create-cost {
          font-size: 0.875rem;
          color: var(--text-muted);
          margin: 0;
        }
        .create-route .create-cost.insufficient {
          color: var(--error, #e74c3c);
          font-weight: 500;
        }
        .create-route .field-required {
          color: var(--error, #e74c3c);
        }
        /* Advanced tab: context options list + switch */
        .create-route .create-route-advanced {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .create-route .create-route-advanced-server {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .create-route .create-route-advanced-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0;
          border-radius: 10px;
          border: 1px solid var(--border);
          overflow: hidden;
          background: var(--surface);
        }
        .create-route .create-route-advanced-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 1.25rem;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
        }
        .create-route .create-route-advanced-item:last-child {
          border-bottom: none;
        }
        .create-route .create-route-advanced-item-desc {
          flex: 1;
          font-size: 0.95rem;
          color: var(--text);
          line-height: 1.4;
        }
        .create-route .create-route-advanced-item-desc strong {
          display: block;
          font-weight: 600;
          margin-bottom: 0.15rem;
        }
        .create-route .create-route-advanced-switch {
          position: relative;
          width: 44px;
          height: 24px;
          flex-shrink: 0;
          border-radius: 999px;
          background: var(--border);
          cursor: pointer;
          transition: background 0.2s ease;
          border: none;
          padding: 0;
        }
        .create-route .create-route-advanced-switch[aria-checked="true"] {
          background: var(--accent);
        }
        .create-route .create-route-advanced-switch::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--surface);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
          transition: transform 0.2s ease;
        }
        .create-route .create-route-advanced-switch[aria-checked="true"]::after {
          transform: translateX(20px);
        }
        .create-route .create-route-advanced-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-start;
          margin-top: 0.25rem;
        }
        .create-route .create-route-advanced-preview-hint {
          margin: 0.5rem 0 0 0;
          font-size: 0.85rem;
          color: var(--text-muted);
          text-align: right;
        }
        .create-route .create-route-advanced-preview-link {
          background: none;
          border: none;
          padding: 0;
          font-size: inherit;
          color: var(--text-muted);
          text-decoration: underline;
          cursor: pointer;
          font-family: inherit;
        }
        .create-route .create-route-advanced-preview-link:hover {
          color: var(--text);
        }
        .create-route .create-route-advanced-preview-link:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-radius: 2px;
        }
        /* Advanced confirm dialog (cost + Create) */
        .create-route-advanced-confirm {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          visibility: hidden;
          opacity: 0;
          transition: visibility 0.2s ease, opacity 0.2s ease;
        }
        .create-route-advanced-confirm.open {
          visibility: visible;
          opacity: 1;
        }
        .create-route-advanced-confirm[data-advanced-preview-dialog] {
          padding: 0.25rem;
          align-items: stretch;
          justify-content: stretch;
        }
        .create-route-advanced-confirm-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
        }
        .create-route-advanced-confirm-panel {
          position: relative;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 1.5rem;
          max-width: 360px;
          width: 100%;
          box-shadow: var(--shadow);
        }
        .create-route-advanced-confirm-panel .create-cost {
          margin: 0 0 1rem 0;
          white-space: pre-line;
        }
        .create-route-advanced-confirm-actions {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .create-route-advanced-confirm-actions .btn-primary,
        .create-route-advanced-confirm-actions .btn-secondary {
          height: 40px;
          min-height: 40px;
          padding: 0 1rem;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .create-route-advanced-preview-panel {
          width: 100%;
          height: 100%;
          max-width: none;
          padding: 0.5rem;
          display: flex;
          flex-direction: column;
        }
        .create-route-advanced-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.25rem;
          flex-shrink: 0;
        }
        .create-route-advanced-preview-actions {
          justify-content: flex-end;
        }
        .create-route-advanced-preview-title {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text);
          margin: 0;
        }
        .create-route-advanced-preview-json {
          flex: 1;
          min-height: 0;
          overflow: auto;
          margin: 0 0 0.5rem 0;
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          background: var(--surface-strong);
          border: 1px solid var(--border);
          font-size: 0.8rem;
          line-height: 1.4;
          color: var(--text);
          white-space: pre-wrap;
          word-break: break-word;
        }
        /* Image field (image_url): radios + one source block + thumbnail when set */
        .create-route .image-field-multi {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .create-route .image-source-radios {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem 1.5rem;
          align-items: center;
        }
        .create-route .image-source-radio-label {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          cursor: pointer;
          font-size: 0.95rem;
          color: var(--text);
        }
        .create-route .image-source-radio-label input {
          margin: 0;
        }
        .create-route .image-source-block {
          min-height: 0;
        }
        .create-route .image-source-block .form-input,
        .create-route .image-source-block .image-url-input {
          width: 100%;
        }
        .create-route .image-source-block[data-image-block="paste_image"] {
          padding: 1rem;
          border-radius: 8px;
          border: 1px dashed var(--border);
          background: var(--surface-muted);
          color: var(--text-muted);
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .create-route .image-source-block[data-image-block="paste_image"]:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
        }
        .create-route .image-source-block[data-image-block="paste_image"]:focus-visible {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
        }
        .create-route .image-thumb-container {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
        }
        .create-route .image-thumb-container .image-thumb-wrap {
          width: 120px;
          height: 120px;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid var(--border);
          background: color-mix(in srgb, var(--text) 6%, transparent);
          flex: 0 0 auto;
          position: relative;
        }
        .create-route .image-thumb-container .image-thumb-wrap.loading {
          background: linear-gradient(90deg, var(--surface-muted), var(--surface-strong), var(--surface-muted));
          background-size: 200% 100%;
          animation: loading 4s linear infinite;
        }
        .create-route .image-thumb-container .image-thumb-wrap.error {
          background: var(--image-placeholder, #333);
        }
        .create-route .image-thumb-container .image-thumb {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .create-route .image-thumb-container .image-thumb-wrap.loaded .image-thumb {
          opacity: 1;
        }
        .create-route .image-choose-btn {
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--input-bg);
          color: var(--text);
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.2s ease, background 0.2s ease;
          display: inline-block;
        }
        .create-route .image-choose-btn:hover {
          background: var(--surface-muted);
          border-color: var(--text-muted);
        }
        .create-route .image-choose-label {
          margin: 0;
          cursor: pointer;
        }
        .create-route .image-field-error {
          font-size: 0.875rem;
          color: var(--error, #e74c3c);
          margin: 0;
        }
      </style>
      <div class="create-route">
        <div class="route-header">
          <h3>Create</h3>
        </div>
        <app-tabs active="basic">
          <tab data-id="basic" label="Advanced" default>
            <div class="route-header">
              <p>Select a server and generation method to create a new image.</p>
            </div>
            <form class="create-form" data-create-form>
              <div class="form-group">
                <label class="form-label" for="server-select">Server</label>
                <select class="form-select" id="server-select" data-server-select required>
                  <option value="">Select a server...</option>
                </select>
              </div>
              <div class="form-group" data-method-group style="display: none;">
                <label class="form-label" for="method-select">Generation Method</label>
                <select class="form-select" id="method-select" data-method-select required>
                  <option value="">Select a method...</option>
                </select>
              </div>
              <div class="form-group" data-fields-group style="display: none;">
                <div data-fields-container></div>
              </div>
            </form>
            <div class="create-controls">
              <button type="button" class="btn-primary create-button" data-create-button disabled>
                Create
              </button>
              <p class="create-cost" data-create-cost>Select a server and method to see cost</p>
            </div>
          </tab>
          <tab data-id="advanced" label="Data Builder">
            <div class="create-route-advanced">
              <div class="create-route-advanced-server form-group">
                <label class="form-label" for="advanced-server-select">Server</label>
                <select class="form-select" id="advanced-server-select" data-advanced-server-select>
                  <option value="">Select a server...</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="advanced-prompt">Prompt</label>
                <textarea class="form-input prompt-editor" id="advanced-prompt" data-advanced-prompt rows="3" placeholder="Enter a prompt..."></textarea>
              </div>
              <div class="form-group create-route-advanced-data">
                <label class="form-label">Data Builder</label>
                <ul class="create-route-advanced-list" data-advanced-list role="list">
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="recent_comments" aria-label="Include recent comments">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Recent comments</strong>
                    Latest comments across the platform.
                  </div>
                </li>
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="recent_posts" aria-label="Include recent posts">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Newest</strong>
                    Latest published creations on the platform.
                  </div>
                </li>
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="top_likes" aria-label="Include top likes">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Most likes</strong>
                    Creations with the most likes on the platform.
                  </div>
                </li>
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="bottom_likes" aria-label="Include bottom likes">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Least likes</strong>
                    Creations with the fewest likes on the platform.
                  </div>
                </li>
                <li class="create-route-advanced-item">
                  <button type="button" class="create-route-advanced-switch" role="switch" aria-checked="false" data-advanced-option="most_mutated" aria-label="Include most mutated">
                  </button>
                  <div class="create-route-advanced-item-desc">
                    <strong>Most mutated</strong>
                    Creations that appear the most in mutation lineages (history).
                  </div>
                </li>
              </ul>
              <p class="create-route-advanced-preview-hint">
                <button type="button" class="create-route-advanced-preview-link" data-advanced-preview-payload>See what we send to the server</button>
              </p>
              </div>
              <div class="create-route-advanced-actions">
                <button type="button" class="btn-primary create-button" data-advanced-create-button disabled>
                  Query
                </button>
                <p class="create-cost" data-advanced-create-cost>Turn on at least one Data Builder option to create.</p>
                <p class="create-cost" data-advanced-create-cost-query hidden>Query the server to check support and cost.</p>
              </div>
            </div>
          </tab>
        </app-tabs>
        <div class="create-route-advanced-confirm" data-advanced-confirm-dialog hidden>
          <div class="create-route-advanced-confirm-overlay" data-advanced-confirm-overlay></div>
          <div class="create-route-advanced-confirm-panel">
            <p class="create-cost" data-advanced-confirm-message></p>
            <div class="create-route-advanced-confirm-actions">
              <button type="button" class="btn-primary create-button" data-advanced-confirm-create>Create</button>
              <button type="button" class="btn-secondary" data-advanced-confirm-cancel>Cancel</button>
            </div>
          </div>
        </div>
        <div class="create-route-advanced-confirm" data-advanced-preview-dialog hidden>
          <div class="create-route-advanced-confirm-overlay" data-advanced-preview-overlay></div>
          <div class="create-route-advanced-confirm-panel create-route-advanced-preview-panel">
            <div class="create-route-advanced-preview-header">
              <p class="create-route-advanced-preview-title">Payload sent to provider</p>
              <button type="button" class="modal-close" data-advanced-preview-close-x aria-label="Close">
                <svg class="modal-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <pre class="create-route-advanced-preview-json" data-advanced-preview-json></pre>
            <div class="create-route-advanced-confirm-actions create-route-advanced-preview-actions">
              <button type="button" class="btn-secondary" data-advanced-preview-close>Close</button>
              <button type="button" class="btn-primary create-button" data-advanced-preview-copy>Copy</button>
            </div>
          </div>
        </div>
      </div>
    `;
		this.setupEventListeners();
		this.loadServers();
		this.loadCredits();
		// Attach autogrow to prompt textarea
		const promptTextarea = this.querySelector('[data-advanced-prompt]');
		if (promptTextarea) {
			attachAutoGrowTextarea(promptTextarea);
		}
	}

	disconnectedCallback() {
		document.removeEventListener('credits-updated', this.handleCreditsUpdated);
		if (this._boundPreviewEscape) {
			document.removeEventListener('keydown', this._boundPreviewEscape);
		}
		if (typeof this._createTabHashCleanup === 'function') {
			this._createTabHashCleanup();
		}
	}

	setupEventListeners() {
		const createButton = this.querySelector("[data-create-button]");
		if (createButton) {
			createButton.addEventListener("click", () => {
				// Apply loading state immediately, before any other code runs
				const btn = this.querySelector("[data-create-button]");
				if (!btn) return;
				btn.style.minWidth = `${btn.offsetWidth}px`;
				btn.disabled = true;
				btn.innerHTML = '<span class="create-button-spinner" aria-hidden="true"></span>';
				void btn.offsetHeight; // force reflow so the loading state is committed
				this.handleCreate(btn);
			});
		}

		const serverSelect = this.querySelector("[data-server-select]");
		if (serverSelect) {
			serverSelect.addEventListener("change", (e) => this.handleServerChange(e.target.value));
		}

		const methodSelect = this.querySelector("[data-method-select]");
		if (methodSelect) {
			methodSelect.addEventListener("change", (e) => this.handleMethodChange(e.target.value));
		}

		// Advanced tab: server select and Create button
		const advancedServerSelect = this.querySelector("[data-advanced-server-select]");
		if (advancedServerSelect) {
			advancedServerSelect.addEventListener("change", () => this.updateAdvancedCreateButton());
		}
		const advancedCreateButton = this.querySelector("[data-advanced-create-button]");
		if (advancedCreateButton) {
			advancedCreateButton.addEventListener("click", () => this.handleAdvancedCreate());
		}
		const previewPayloadBtn = this.querySelector("[data-advanced-preview-payload]");
		if (previewPayloadBtn) {
			previewPayloadBtn.addEventListener("click", () => this.handlePreviewPayload());
		}
		const previewDialog = this.querySelector("[data-advanced-preview-dialog]");
		const previewOverlay = this.querySelector("[data-advanced-preview-overlay]");
		const previewCloseBtn = this.querySelector("[data-advanced-preview-close]");
		const previewCloseX = this.querySelector("[data-advanced-preview-close-x]");
		const previewCopyBtn = this.querySelector("[data-advanced-preview-copy]");
		if (previewOverlay) previewOverlay.addEventListener("click", () => this.closePreviewPayload());
		if (previewCloseBtn) previewCloseBtn.addEventListener("click", () => this.closePreviewPayload());
		if (previewCloseX) previewCloseX.addEventListener("click", () => this.closePreviewPayload());
		if (previewCopyBtn) previewCopyBtn.addEventListener("click", () => this.copyPreviewPayload());
		this._boundPreviewEscape = (e) => {
			if (e.key === "Escape") {
				const d = this.querySelector("[data-advanced-preview-dialog]");
				if (d && !d.hidden && d.classList.contains("open")) this.closePreviewPayload();
			}
		};
		document.addEventListener("keydown", this._boundPreviewEscape);
		// Advanced confirm dialog
		const confirmDialog = this.querySelector("[data-advanced-confirm-dialog]");
		const confirmOverlay = this.querySelector("[data-advanced-confirm-overlay]");
		const confirmCreateBtn = this.querySelector("[data-advanced-confirm-create]");
		const confirmCancelBtn = this.querySelector("[data-advanced-confirm-cancel]");
		if (confirmOverlay) confirmOverlay.addEventListener("click", () => this.closeAdvancedConfirm());
		if (confirmCancelBtn) confirmCancelBtn.addEventListener("click", () => this.closeAdvancedConfirm());
		if (confirmCreateBtn) confirmCreateBtn.addEventListener("click", () => this.handleConfirmPrimary());
		// Advanced tab: switch toggles
		this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				const el = e.currentTarget;
				if (el.getAttribute("role") !== "switch") return;
				const checked = el.getAttribute("aria-checked") === "true";
				el.setAttribute("aria-checked", (!checked).toString());
				this.updateAdvancedCreateButton();
				this.saveAdvancedOptions();
			});
		});
		// Advanced tab: prompt field
		const promptInput = this.querySelector("[data-advanced-prompt]");
		if (promptInput) {
			promptInput.addEventListener("input", () => this.saveAdvancedOptions());
			promptInput.addEventListener("change", () => this.saveAdvancedOptions());
		}
		this.applyPromptFromUrl(); // run first so URL prompt can supersede saved state
		this.restoreAdvancedOptions();

		// Restore and persist active tab (Basic / Advanced); sync with URL hash (#basic, #advanced)
		const tabsEl = this.querySelector('app-tabs');
		if (tabsEl) {
			const CREATE_TAB_IDS = ['basic', 'advanced'];
			const syncTabFromHash = () => {
				if (window.location.pathname !== '/create') return;
				const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
				if (hash !== 'basic' && hash !== 'advanced') return;
				tabsEl.setActiveTab(hash, { focus: false });
				try {
					const stored = sessionStorage.getItem(this.storageKey);
					const selections = stored ? JSON.parse(stored) : {};
					selections.tab = hash;
					sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
				} catch (e) {
					// Ignore storage errors
				}
			};

			// Prefer URL hash over sessionStorage when present; default to basic when neither is set
			if (window.location.pathname === '/create') {
				const hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
				if (hash === 'basic' || hash === 'advanced') {
					tabsEl.setActiveTab(hash);
					try {
						const stored = sessionStorage.getItem(this.storageKey);
						const selections = stored ? JSON.parse(stored) : {};
						selections.tab = hash;
						sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
					} catch (e) {
						// Ignore storage errors
					}
				} else {
					try {
						const stored = sessionStorage.getItem(this.storageKey);
						const selections = stored ? JSON.parse(stored) : {};
						const tab = selections?.tab;
						if (tab === 'basic' || tab === 'advanced') {
							tabsEl.setActiveTab(tab);
						} else {
							tabsEl.setActiveTab('basic');
						}
					} catch (e) {
						// Ignore storage errors
						tabsEl.setActiveTab('basic');
					}
				}
			}

			window.addEventListener('hashchange', syncTabFromHash);

			tabsEl.addEventListener('tab-change', (e) => {
				const id = e.detail?.id;
				if (id !== 'basic' && id !== 'advanced') return;
				try {
					const stored = sessionStorage.getItem(this.storageKey);
					const selections = stored ? JSON.parse(stored) : {};
					selections.tab = id;
					sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
				} catch (e) {
					// Ignore storage errors
				}
				if (window.location.pathname === '/create' && window.location.hash !== `#${id}`) {
					window.history.replaceState(null, '', `/create#${id}`);
				}
			});
			this._createTabHashCleanup = () => window.removeEventListener('hashchange', syncTabFromHash);
		}

		document.addEventListener('credits-updated', this.handleCreditsUpdated);
	}

	async loadServers() {
		try {
			const result = await fetchJsonWithStatusDeduped('/api/servers', { credentials: 'include' }, { windowMs: 2000 });
			if (result.ok) {
				this.servers = Array.isArray(result.data?.servers) ? result.data.servers : [];
				// Show servers where user is owner or member.
				// Additionally, the special server with id = 1 should always appear.
				// Exclude suspended servers from the create dropdown for everyone (including admin).
				this.servers = this.servers.filter(server =>
					!server.suspended && (server.id === 1 || server.is_owner === true || server.is_member === true)
				);
				// Parse server_config if it's a string
				this.servers = this.servers.map(server => {
					if (server.server_config && typeof server.server_config === 'string') {
						try {
							server.server_config = JSON.parse(server.server_config);
						} catch (e) {
							// console.warn('Failed to parse server_config for server', server.id, e);
							server.server_config = null;
						}
					}
					return server;
				});
				this.renderServerOptions();
				this.renderAdvancedServerOptions();

				// Try to restore selections, otherwise auto-select first server (Basic and Advanced)
				const restored = this.restoreSelections();
				if (!restored && this.servers.length > 0) {
					const firstServer = this.servers[0];
					const serverSelect = this.querySelector("[data-server-select]");
					if (serverSelect) {
						serverSelect.value = firstServer.id;
						this.handleServerChange(firstServer.id);
					}
					const advancedSelect = this.querySelector("[data-advanced-server-select]");
					if (advancedSelect) {
						advancedSelect.value = firstServer.id;
						this.updateAdvancedCreateButton();
					}
				}
			}
		} catch (error) {
			// console.error('Error loading servers:', error);
		}
	}

	renderServerOptions() {
		const serverSelect = this.querySelector("[data-server-select]");
		if (!serverSelect) return;

		// Clear existing options except the first one
		while (serverSelect.children.length > 1) {
			serverSelect.removeChild(serverSelect.lastChild);
		}

		// Add server options
		this.servers.forEach(server => {
			const option = document.createElement('option');
			option.value = server.id;
			option.textContent = server.name;
			serverSelect.appendChild(option);
		});
	}

	renderAdvancedServerOptions() {
		const advancedSelect = this.querySelector("[data-advanced-server-select]");
		if (!advancedSelect) return;

		while (advancedSelect.children.length > 1) {
			advancedSelect.removeChild(advancedSelect.lastChild);
		}
		this.servers.forEach(server => {
			const option = document.createElement('option');
			option.value = server.id;
			option.textContent = server.name;
			advancedSelect.appendChild(option);
		});
		this.updateAdvancedCreateButton();
	}

	updateAdvancedCreateButton() {
		const advancedSelect = this.querySelector("[data-advanced-server-select]");
		const advancedCreateButton = this.querySelector("[data-advanced-create-button]");
		const costEl = this.querySelector("[data-advanced-create-cost]");
		const costQueryEl = this.querySelector("[data-advanced-create-cost-query]");
		if (!advancedSelect || !advancedCreateButton) return;
		const hasServer = advancedSelect.value !== '' && Number(advancedSelect.value) > 0;
		const hasAtLeastOneSwitch = Array.from(this.querySelectorAll("[data-advanced-option]")).some(
			(btn) => btn.getAttribute("aria-checked") === "true"
		);
		advancedCreateButton.disabled = !hasServer || !hasAtLeastOneSwitch;
		advancedCreateButton.textContent = 'Query';
		if (costEl) costEl.hidden = hasAtLeastOneSwitch;
		if (costQueryEl) costQueryEl.hidden = !hasAtLeastOneSwitch;
	}

	saveAdvancedOptions() {
		try {
			const options = {};
			this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
				const key = btn.getAttribute("data-advanced-option");
				if (key) options[key] = btn.getAttribute("aria-checked") === "true";
			});
			const promptInput = this.querySelector("[data-advanced-prompt]");
			if (promptInput) {
				options.prompt = promptInput.value;
			}
			const stored = sessionStorage.getItem(this.storageKey);
			const selections = stored ? JSON.parse(stored) : {};
			selections.advancedOptions = options;
			sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
		} catch (e) {
			// Ignore storage errors
		}
	}

	restoreAdvancedOptions() {
		try {
			const stored = sessionStorage.getItem(this.storageKey);
			if (!stored) return;
			const selections = JSON.parse(stored);
			const options = selections?.advancedOptions;
			if (!options || typeof options !== "object") return;
			// Restore data builder options
			this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
				const key = btn.getAttribute("data-advanced-option");
				if (key && options[key] === true) btn.setAttribute("aria-checked", "true");
			});
			// Restore prompt value; query-param prompt supersedes saved
			const promptInput = this.querySelector("[data-advanced-prompt]");
			if (promptInput) {
				const value = this._promptFromUrl ?? (typeof options.prompt === "string" ? options.prompt : "");
				if (value) {
					promptInput.value = value;
					const refresh = attachAutoGrowTextarea(promptInput);
					if (refresh) refresh();
				}
			}
			this.updateAdvancedCreateButton();
		} catch (e) {
			// Ignore storage errors
		}
	}

	/** Store prompt from ?prompt= (e.g. from landing page). Applied to Basic tab when server+method has a prompt field. */
	applyPromptFromUrl() {
		if (window.location.pathname !== "/create") return;
		const params = new URLSearchParams(window.location.search);
		const prompt = params.get("prompt");
		this._promptFromUrl = typeof prompt === "string" && prompt.trim() ? prompt.trim() : null;
	}

	/** If we have a URL prompt and the current method has a prompt field, fill it. Call after renderFields(). */
	applyUrlPromptToBasicFields() {
		if (!this._promptFromUrl || !this.selectedMethod?.fields) return;
		const fields = this.selectedMethod.fields;
		const promptKey = Object.keys(fields).find((k) => isPromptLikeField(k, fields[k]));
		if (!promptKey) return;
		this.fieldValues[promptKey] = this._promptFromUrl;
		const input = this.querySelector(`#field-${promptKey}`);
		if (!input) return;
		input.value = this._promptFromUrl;
		if (input.tagName === "TEXTAREA") {
			const refresh = attachAutoGrowTextarea(input);
			if (refresh) refresh();
		}
		this.updateButtonState();
		this.saveSelections();
	}

	async handleAdvancedCreate() {
		const advancedSelect = this.querySelector("[data-advanced-server-select]");
		const queryBtn = this.querySelector("[data-advanced-create-button]");
		if (!advancedSelect?.value) return;

		const serverId = Number(advancedSelect.value);
		if (!Number.isFinite(serverId) || serverId <= 0) return;

		const args = {};
		// Collect prompt value
		const promptInput = this.querySelector("[data-advanced-prompt]");
		if (promptInput && promptInput.value.trim()) {
			args.prompt = promptInput.value.trim();
		}
		// Collect data builder options
		this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
			const key = btn.getAttribute("data-advanced-option");
			if (key) args[key] = btn.getAttribute("aria-checked") === "true";
		});

		if (queryBtn) {
			queryBtn.disabled = true;
			queryBtn.textContent = 'Querying…';
		}
		try {
			const res = await fetch('/api/create/query', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ server_id: serverId, args })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				this.showAdvancedConfirm(
					data?.message || data?.error || 'Failed to query server',
					null
				);
				return;
			}
			const supported = data?.supported === true || data?.supported === 'true';
			const cost = typeof data?.cost === 'number' ? data.cost : Number(data?.cost);
			if (supported && Number.isFinite(cost) && cost > 0) {
				this._advancedConfirm = { serverId, args, cost };
				this.showAdvancedConfirm(
					`This will cost ${cost} credit${cost === 1 ? '' : 's'}.`,
					true
				);
			} else {
				this._advancedConfirm = null;
				this.showAdvancedConfirm(
					'This server does not support this request.',
					false
				);
			}
		} finally {
			if (queryBtn) {
				queryBtn.disabled = false;
				queryBtn.textContent = 'Query';
				this.updateAdvancedCreateButton();
			}
		}
	}

	handleConfirmPrimary() {
		const action = this._confirmPrimaryAction;
		if (typeof action === 'function') {
			try { action(); } catch { /* ignore */ }
			return;
		}
		this.submitAdvancedCreate();
	}

	showAdvancedConfirm(message, showCreateButton, { primaryLabel, onPrimary } = {}) {
		const dialog = this.querySelector("[data-advanced-confirm-dialog]");
		const msgEl = this.querySelector("[data-advanced-confirm-message]");
		const createBtn = this.querySelector("[data-advanced-confirm-create]");
		if (msgEl) msgEl.textContent = message;
		if (createBtn) {
			createBtn.hidden = !showCreateButton;
			createBtn.textContent = typeof primaryLabel === 'string' && primaryLabel.trim()
				? primaryLabel.trim()
				: 'Create';
		}
		this._confirmPrimaryAction = typeof onPrimary === 'function' ? onPrimary : null;
		if (dialog) {
			dialog.hidden = false;
			dialog.classList.add('open');
		}
	}

	closeAdvancedConfirm() {
		const dialog = this.querySelector("[data-advanced-confirm-dialog]");
		if (dialog) {
			dialog.hidden = true;
			dialog.classList.remove('open');
		}
		this._advancedConfirm = null;
		this._confirmPrimaryAction = null;
	}

	extractMentions(prompt) {
		const text = typeof prompt === 'string' ? prompt : '';
		if (!text) return [];
		const out = [];
		const seen = new Set();
		const re = /@([a-zA-Z0-9_]+)/g;
		let match;
		while ((match = re.exec(text)) !== null) {
			const full = `@${match[1]}`;
			if (seen.has(full)) continue;
			seen.add(full);
			out.push(full);
		}
		return out;
	}

	async validateMentions({ args } = {}) {
		const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
		const mentions = this.extractMentions(prompt);
		if (mentions.length === 0) return { ok: true, mentions };

		const res = await fetch('/api/create/validate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ args: args || {} })
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, mentions, data };
		return { ok: false, mentions, data, status: res.status };
	}

	async handlePreviewPayload() {
		const args = {};
		const promptInput = this.querySelector("[data-advanced-prompt]");
		if (promptInput && promptInput.value.trim()) {
			args.prompt = promptInput.value.trim();
		}
		this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
			const key = btn.getAttribute("data-advanced-option");
			if (key) args[key] = btn.getAttribute("aria-checked") === "true";
		});
		const hasAtLeastOne = Object.keys(args).some((k) => k === 'prompt' || args[k] === true);
		if (!hasAtLeastOne) {
			const pre = this.querySelector("[data-advanced-preview-json]");
			if (pre) pre.textContent = 'Turn on at least one Data Builder option or enter a prompt to preview the payload.';
			this.openPreviewPayload();
			return;
		}
		try {
			const res = await fetch('/api/create/preview', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ args })
			});
			const data = await res.json().catch(() => ({}));
			const pre = this.querySelector("[data-advanced-preview-json]");
			if (pre) {
				if (!res.ok) {
					pre.textContent = data?.message || data?.error || 'Failed to load preview.';
				} else {
					const payload = data?.payload;
					pre.textContent = payload != null
						? JSON.stringify(payload, null, 2)
						: 'No payload returned.';
				}
			}
			this._previewPayloadRaw = data?.payload != null ? JSON.stringify(data.payload) : null;
			this.openPreviewPayload();
		} catch (e) {
			const pre = this.querySelector("[data-advanced-preview-json]");
			if (pre) pre.textContent = 'Failed to load preview.';
			this._previewPayloadRaw = null;
			this.openPreviewPayload();
		}
	}

	openPreviewPayload() {
		const dialog = this.querySelector("[data-advanced-preview-dialog]");
		if (dialog) {
			dialog.hidden = false;
			dialog.classList.add('open');
		}
	}

	closePreviewPayload() {
		const dialog = this.querySelector("[data-advanced-preview-dialog]");
		if (dialog) {
			dialog.hidden = true;
			dialog.classList.remove('open');
		}
		this._previewPayloadRaw = null;
	}

	copyPreviewPayload() {
		const raw = this._previewPayloadRaw;
		if (!raw) return;
		try {
			navigator.clipboard.writeText(raw).then(() => {
				const btn = this.querySelector("[data-advanced-preview-copy]");
				if (btn) {
					const prev = btn.textContent;
					btn.textContent = 'Copied';
					setTimeout(() => { btn.textContent = prev; }, 1500);
				}
			}).catch(() => { });
		} catch (e) { }
	}

	async submitAdvancedCreate() {
		const pending = this._advancedConfirm;
		if (!pending) {
			this.closeAdvancedConfirm();
			return;
		}
		const runSubmit = (hydrateMentions) => {
			this.closeAdvancedConfirm();
			const isStandaloneCreatePage = window.location.pathname === '/create';
			submitCreationWithPending({
				serverId: pending.serverId,
				methodKey: 'advanced_generate',
				args: pending.args,
				creditCost: pending.cost,
				hydrateMentions,
				navigate: isStandaloneCreatePage ? 'full' : 'spa',
				onInsufficientCredits: async () => { await this.loadCredits(); },
				onError: async () => { await this.loadCredits(); }
			});
		};

		const prompt = typeof pending?.args?.prompt === 'string' ? pending.args.prompt : '';
		const mentions = this.extractMentions(prompt);
		if (mentions.length === 0) {
			runSubmit(false);
			return;
		}

		const validateResult = await this.validateMentions({ args: pending.args });
		if (validateResult.ok) {
			runSubmit(true);
			return;
		}

		const message = formatMentionsFailureForDialog(validateResult.data);
		this.showAdvancedConfirm(
			message,
			true,
			{
				primaryLabel: 'Submit anyway',
				onPrimary: () => runSubmit(false)
			}
		);
	}

	handleServerChange(serverId) {
		if (!serverId) {
			this.selectedServer = null;
			this.selectedMethod = null;
			this.fieldValues = {};
			this.hideMethodGroup();
			this.hideFieldsGroup();
			this.updateButtonState();
			this.saveSelections();
			return;
		}

		const server = this.servers.find(s => s.id === Number(serverId));
		if (!server) return;

		this.selectedServer = server;
		this.selectedMethod = null;
		this.fieldValues = {};
		this.renderMethodOptions();
		this.hideFieldsGroup();
		this.updateButtonState();
		this.saveSelections();
	}

	renderMethodOptions(skipAutoSelect = false) {
		const methodGroup = this.querySelector("[data-method-group]");
		const methodSelect = this.querySelector("[data-method-select]");
		if (!methodGroup || !methodSelect) return;

		// Clear existing options except the first one
		while (methodSelect.children.length > 1) {
			methodSelect.removeChild(methodSelect.lastChild);
		}

		if (!this.selectedServer) {
			methodGroup.style.display = 'none';
			return;
		}

		// Ensure server_config is parsed
		let serverConfig = this.selectedServer.server_config;
		if (typeof serverConfig === 'string') {
			try {
				serverConfig = JSON.parse(serverConfig);
				this.selectedServer.server_config = serverConfig;
			} catch (e) {
				// console.warn('Failed to parse server_config:', e);
				methodGroup.style.display = 'none';
				return;
			}
		}

		if (!serverConfig || !serverConfig.methods) {
			methodGroup.style.display = 'none';
			return;
		}

		// Add method options, sorted by display name
		const methods = serverConfig.methods;
		const methodKeys = Object.keys(methods).sort((a, b) => {
			const nameA = (methods[a]?.name || a).toString().toLowerCase();
			const nameB = (methods[b]?.name || b).toString().toLowerCase();
			return nameA.localeCompare(nameB);
		});
		methodKeys.forEach(methodKey => {
			const method = methods[methodKey];
			const option = document.createElement('option');
			option.value = methodKey;
			option.textContent = method.name || methodKey;
			methodSelect.appendChild(option);
		});

		methodGroup.style.display = 'flex';

		// Auto-select first method if available (unless skipping auto-select)
		if (!skipAutoSelect && methodKeys.length > 0) {
			const firstMethodKey = methodKeys[0];
			methodSelect.value = firstMethodKey;
			// Use microtask to ensure DOM is ready and method selection happens after render
			Promise.resolve().then(() => {
				this.handleMethodChange(firstMethodKey);
			});
		} else if (methodKeys.length === 0) {
			methodSelect.value = '';
		}
	}

	handleMethodChange(methodKey) {
		if (!methodKey) {
			this.selectedMethod = null;
			this.fieldValues = {};
			this.hideFieldsGroup();
			this.updateButtonState();
			this.saveSelections();
			return;
		}

		if (!this.selectedServer) {
			return;
		}

		// Ensure server_config is parsed
		let serverConfig = this.selectedServer.server_config;
		if (typeof serverConfig === 'string') {
			try {
				serverConfig = JSON.parse(serverConfig);
				this.selectedServer.server_config = serverConfig;
			} catch (e) {
				// console.warn('Failed to parse server_config:', e);
				return;
			}
		}

		if (!serverConfig || !serverConfig.methods || !serverConfig.methods[methodKey]) {
			return;
		}

		this.selectedMethod = serverConfig.methods[methodKey];
		this.fieldValues = {};
		this.renderFields();
		this.updateButtonState();
		this.saveSelections();
	}

	renderFields() {
		const fieldsGroup = this.querySelector("[data-fields-group]");
		const fieldsContainer = this.querySelector("[data-fields-container]");
		if (!fieldsGroup || !fieldsContainer) return;

		if (!this.selectedMethod || !this.selectedMethod.fields) {
			fieldsGroup.style.display = 'none';
			return;
		}

		const fields = this.selectedMethod.fields;
		if (Object.keys(fields).length === 0) {
			fieldsGroup.style.display = 'none';
			return;
		}

		renderFields(fieldsContainer, fields, {
			onFieldChange: (fieldKey, value) => {
				this.fieldValues[fieldKey] = value;
				this.updateButtonState();
				this.saveSelections();
			}
		});
		fieldsGroup.style.display = 'flex';
		this.applyUrlPromptToBasicFields();
	}

	hideMethodGroup() {
		const methodGroup = this.querySelector("[data-method-group]");
		const methodSelect = this.querySelector("[data-method-select]");
		if (methodGroup) methodGroup.style.display = 'none';
		if (methodSelect) methodSelect.value = '';
	}

	hideFieldsGroup() {
		const fieldsGroup = this.querySelector("[data-fields-group]");
		if (fieldsGroup) fieldsGroup.style.display = 'none';
	}

	handleCreditsUpdated(event) {
		if (event.detail && typeof event.detail.count === 'number') {
			this.creditsCount = event.detail.count;
			this.updateButtonState();
		} else {
			this.loadCredits();
		}
	}

	async loadCredits() {
		try {
			const result = await fetchJsonWithStatusDeduped('/api/credits', { credentials: 'include' }, { windowMs: 2000 });
			if (result.ok) {
				this.creditsCount = this.normalizeCredits(result.data?.balance ?? 0);
				this.updateButtonState();
			} else {
				this.creditsCount = 0;
				this.updateButtonState();
			}
		} catch {
			// Fallback to localStorage if available
			const stored = window.localStorage?.getItem('credits-balance');
			this.creditsCount = stored !== null ? this.normalizeCredits(stored) : 0;
			this.updateButtonState();
		}
	}

	normalizeCredits(value) {
		const count = Number(value);
		if (!Number.isFinite(count)) return 0;
		return Math.max(0, Math.round(count * 10) / 10);
	}

	updateButtonState() {
		const button = this.querySelector("[data-create-button]");
		const costElement = this.querySelector("[data-create-cost]");

		if (!button || !costElement) return;

		// Check if server and method are selected
		if (!this.selectedServer || !this.selectedMethod) {
			button.disabled = true;
			costElement.textContent = 'Select a server and method to see cost';
			costElement.classList.remove('insufficient');
			return;
		}

		// Check if all required fields are filled
		const fields = this.selectedMethod.fields || {};
		const requiredFields = Object.keys(fields).filter(key => fields[key].required);
		const allRequiredFilled = requiredFields.every(key => {
			const value = this.fieldValues[key];
			if (value === undefined || value === null) return false;
			if (value instanceof File) return true;
			return value !== '';
		});

		if (!allRequiredFilled) {
			button.disabled = true;
			// Get cost from method config
			let cost = 0.5; // default fallback
			if (this.selectedMethod && typeof this.selectedMethod.credits === 'number') {
				cost = this.selectedMethod.credits;
			} else if (this.selectedMethod && this.selectedMethod.credits !== undefined) {
				const parsedCost = parseFloat(this.selectedMethod.credits);
				if (!isNaN(parsedCost)) {
					cost = parsedCost;
				}
			}
			costElement.textContent = `Costs ${cost} credits - Fill all required fields`;
			costElement.classList.remove('insufficient');
			return;
		}

		// Check credits - get cost from method config
		let cost = 0.5; // default fallback
		if (this.selectedMethod) {
			if (typeof this.selectedMethod.credits === 'number') {
				cost = this.selectedMethod.credits;
			} else if (this.selectedMethod.credits !== undefined && this.selectedMethod.credits !== null) {
				// Try to parse if it's a string
				const parsedCost = parseFloat(this.selectedMethod.credits);
				if (!isNaN(parsedCost)) {
					cost = parsedCost;
				} else {
					// console.warn('updateButtonState - Could not parse credits:', this.selectedMethod.credits);
				}
			} else {
				// console.warn('updateButtonState - Credits is undefined or null, using default 0.5');
			}
		} else {
			// console.warn('updateButtonState - No selectedMethod');
		}

		const hasEnoughCredits = this.creditsCount >= cost;

		button.disabled = !hasEnoughCredits;

		if (hasEnoughCredits) {
			costElement.textContent = `Costs ${cost} credits`;
			costElement.classList.remove('insufficient');
		} else {
			costElement.textContent = `Insufficient credits. You have ${this.creditsCount} credits, need ${cost} credits.`;
			costElement.classList.add('insufficient');
		}
	}

	handleCreate(button) {
		if (!button) return;
		// Yield so the loading state can paint before we run validation/submit/navigation
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				this.handleCreateAfterSpinner(button);
			});
		});
	}

	async handleCreateAfterSpinner(button) {
		if (!this.selectedServer || !this.selectedMethod) {
			this.resetCreateButton(button);
			return;
		}

		// Get the method key from the selected method
		const methods = this.selectedServer.server_config?.methods || {};
		const methodKey = Object.keys(methods).find(key => methods[key] === this.selectedMethod);

		if (!methodKey) {
			this.resetCreateButton(button);
			return;
		}

		// Collect all field values from inputs right before submission
		const fields = this.selectedMethod.fields || {};
		const collectedArgs = {};
		Object.keys(fields).forEach(fieldKey => {
			let input = this.querySelector(`#field-${fieldKey}`);
			const field = fields[fieldKey];
			if (input?.classList?.contains('form-switch')) {
				input = input.querySelector('.form-switch-input');
			}
			if (input) {
				if (field?.type === 'boolean' || input.type === 'checkbox') {
					collectedArgs[fieldKey] = input.checked;
				} else {
					collectedArgs[fieldKey] = input.value || this.fieldValues[fieldKey] || '';
				}
			} else {
				// Fallback to stored value (e.g. image_url can be string URL or File; upload happens on Create)
				collectedArgs[fieldKey] = this.fieldValues[fieldKey] ?? (field?.type === 'boolean' ? false : '');
			}
		});

		// Validate required data
		if (!this.selectedServer.id || !methodKey) {
			this.resetCreateButton(button);
			return;
		}

		// If image_url is a File (paste or upload), upload it first while spinner is showing; then submit with the URL.
		if (collectedArgs.image_url instanceof File) {
			try {
				collectedArgs.image_url = await uploadImageFile(collectedArgs.image_url);
			} catch (err) {
				this.resetCreateButton(button);
				if (typeof this.showCreateError === 'function') {
					this.showCreateError(err?.message || 'Image upload failed');
				} else {
					alert(err?.message || 'Image upload failed');
				}
				return;
			}
		}

		// Standalone create page (/create) needs full navigation to /creations; SPA only works when create is in-app.
		const isStandaloneCreatePage = window.location.pathname === '/create';
		const argsToSend = collectedArgs || {};
		// Hydration only supports the canonical `prompt` arg for now.
		const prompt = typeof argsToSend?.prompt === 'string' ? String(argsToSend.prompt) : '';
		const mentions = this.extractMentions(prompt);

		const doSubmit = (hydrateMentions) => {
			submitCreationWithPending({
				serverId: this.selectedServer.id,
				methodKey,
				args: argsToSend,
				hydrateMentions,
				navigate: isStandaloneCreatePage ? 'full' : 'spa',
				onInsufficientCredits: async () => {
					this.resetCreateButton(button);
					await this.loadCredits();
				},
				onError: async () => {
					this.resetCreateButton(button);
					await this.loadCredits();
				}
			});
		};

		if (mentions.length === 0) {
			doSubmit(false);
			return;
		}

		const validateResult = await this.validateMentions({ args: { prompt } });
		if (validateResult.ok) {
			doSubmit(true);
			return;
		}

		this.resetCreateButton(button);
		const message = formatMentionsFailureForDialog(validateResult.data);
		this.showAdvancedConfirm(
			message,
			true,
			{
				primaryLabel: 'Submit anyway',
				onPrimary: () => {
					this.closeAdvancedConfirm();
					// Re-apply loading state to the Create button and submit without hydration.
					try {
						button.style.minWidth = `${button.offsetWidth}px`;
						button.disabled = true;
						button.innerHTML = '<span class="create-button-spinner" aria-hidden="true"></span>';
						void button.offsetHeight;
					} catch { /* ignore */ }
					doSubmit(false);
				}
			}
		);
	}

	resetCreateButton(button) {
		if (!button) return;
		button.disabled = false;
		button.style.minWidth = '';
		button.textContent = 'Create';
	}

	saveSelections() {
		try {
			const selections = {
				serverId: this.selectedServer?.id || null,
				methodKey: this.getMethodKey() || null,
				fieldValues: { ...this.fieldValues }
			};
			const tabsEl = this.querySelector('app-tabs');
			const activeTab = tabsEl?.getAttribute?.('active');
			if (activeTab === 'basic' || activeTab === 'advanced') {
				selections.tab = activeTab;
			}
			const options = {};
			this.querySelectorAll("[data-advanced-option]").forEach((btn) => {
				const key = btn.getAttribute("data-advanced-option");
				if (key) options[key] = btn.getAttribute("aria-checked") === "true";
			});
			selections.advancedOptions = options;
			sessionStorage.setItem(this.storageKey, JSON.stringify(selections));
		} catch (e) {
			// Ignore storage errors
		}
	}

	getMethodKey() {
		if (!this.selectedServer || !this.selectedMethod) return null;
		const methods = this.selectedServer.server_config?.methods || {};
		return Object.keys(methods).find(key => methods[key] === this.selectedMethod) || null;
	}

	restoreSelections() {
		// Only restore if servers are loaded
		if (!this.servers || this.servers.length === 0) return false;

		try {
			const stored = sessionStorage.getItem(this.storageKey);
			if (!stored) return false;

			const selections = JSON.parse(stored);
			if (!selections || !selections.serverId) return false;

			// Restore server selection
			const server = this.servers.find(s => s.id === Number(selections.serverId));
			if (!server) return false;

			const serverSelect = this.querySelector("[data-server-select]");
			if (!serverSelect) return false;

			serverSelect.value = server.id;
			this.selectedServer = server;
			this.renderMethodOptions(true); // Skip auto-select when restoring

			// Restore same server on Advanced tab
			const advancedSelect = this.querySelector("[data-advanced-server-select]");
			if (advancedSelect) {
				const optionExists = Array.from(advancedSelect.options).some(opt => opt.value === String(server.id));
				if (optionExists) {
					advancedSelect.value = server.id;
					this.updateAdvancedCreateButton();
				}
			}

			// Restore method selection after methods are rendered
			if (selections.methodKey) {
				// Use microtask to ensure DOM is ready
				Promise.resolve().then(() => {
					const methodSelect = this.querySelector("[data-method-select]");
					if (methodSelect) {
						const methodExists = Array.from(methodSelect.options).some(
							opt => opt.value === selections.methodKey
						);
						if (methodExists) {
							methodSelect.value = selections.methodKey;
							this.handleMethodChange(selections.methodKey);

							// Restore field values after fields are rendered
							if (selections.fieldValues && Object.keys(selections.fieldValues).length > 0) {
								Promise.resolve().then(() => {
									this.restoreFieldValues(selections.fieldValues);
								});
							}
						}
					}
				});
			}

			return true;
		} catch (e) {
			// Ignore storage errors
			return false;
		}
	}

	restoreFieldValues(savedFieldValues) {
		const fields = this.selectedMethod?.fields || {};
		Object.keys(savedFieldValues).forEach(fieldKey => {
			// Query-param prompt supersedes saved prompt on Basic tab
			if (this._promptFromUrl && isPromptLikeField(fieldKey, fields[fieldKey])) return;
			let el = this.querySelector(`#field-${fieldKey}`);
			if (el?.classList?.contains('form-switch')) {
				el = el.querySelector('.form-switch-input');
			}
			if (el) {
				const savedValue = savedFieldValues[fieldKey];
				if (savedValue !== undefined && savedValue !== null && savedValue !== '') {
					if (el.type === 'checkbox') {
						el.checked = savedValue === true || savedValue === 'true';
					} else {
						el.value = savedValue;
					}
					// Trigger change event to update fieldValues and button state
					el.dispatchEvent(new Event('input', { bubbles: true }));
					el.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
		});
		// Re-apply URL prompt so it wins over any saved prompt we skipped
		this.applyUrlPromptToBasicFields();
	}
}

customElements.define("app-route-create", AppRouteCreate);
