import { formatRelativeTime } from '../../shared/datetime.js';

const html = String.raw;

function renderProviderCapabilities(container, capabilities) {
	const methodsContainer = document.createElement("div");
	methodsContainer.className = "provider-capabilities";

	const methodsTitle = document.createElement("h4");
	methodsTitle.textContent = "Available Generation Methods";
	methodsContainer.appendChild(methodsTitle);

	const methods = capabilities.methods || {};
	const methodKeys = Object.keys(methods);

	if (methodKeys.length === 0) {
		const noMethods = document.createElement("div");
		noMethods.style.padding = "1rem";
		noMethods.style.textAlign = "center";
		noMethods.style.color = "var(--text-muted)";
		noMethods.textContent = "No generation methods available.";
		methodsContainer.appendChild(noMethods);
	} else {
		methodKeys.forEach(methodKey => {
			const method = methods[methodKey];
			const methodCard = document.createElement("div");
			methodCard.className = "method-card";

			const methodHeader = document.createElement("div");
			methodHeader.className = "method-header";

			const methodName = document.createElement("div");
			methodName.className = "method-name";
			methodName.textContent = method.name || methodKey;
			methodHeader.appendChild(methodName);

			const intentList = Array.isArray(method?.intents)
				? method.intents.filter(v => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
				: (typeof method?.intent === 'string' && method.intent.trim().length > 0 ? [method.intent.trim()] : []);
			if (intentList.length > 0) {
				const intents = document.createElement('div');
				intents.className = 'method-intents';
				intentList.forEach(intent => {
					const badge = document.createElement('span');
					badge.className = 'method-intent-badge';
					badge.textContent = intent;
					intents.appendChild(badge);
				});
				methodHeader.appendChild(intents);
			}

			methodCard.appendChild(methodHeader);

			const methodDesc = document.createElement("div");
			methodDesc.className = "method-desc";
			methodDesc.textContent = method.description || "No description";
			methodCard.appendChild(methodDesc);

			const fields = method.fields || {};
			const fieldKeys = Object.keys(fields);
			if (fieldKeys.length > 0) {
				const fieldsSection = document.createElement("div");
				fieldsSection.className = "fields-section";

				const fieldsTitle = document.createElement("div");
				fieldsTitle.className = "fields-title";
				fieldsTitle.textContent = "Fields";
				fieldsSection.appendChild(fieldsTitle);

				const fieldList = document.createElement("div");
				fieldList.className = "field-list";

				fieldKeys.forEach(fieldKey => {
					const field = fields[fieldKey];
					const fieldItem = document.createElement("div");
					fieldItem.className = "field-item";

					const fieldLabel = document.createElement("span");
					fieldLabel.className = "field-label";
					fieldLabel.textContent = field.label || fieldKey;
					fieldItem.appendChild(fieldLabel);

					const fieldType = document.createElement("span");
					fieldType.className = "field-type";
					fieldType.textContent = field.type || 'text';
					fieldItem.appendChild(fieldType);

					const fieldBadge = document.createElement("span");
					fieldBadge.className = `field-badge ${field.required ? 'required' : 'optional'}`;
					fieldBadge.textContent = field.required ? 'Required' : 'Optional';
					fieldItem.appendChild(fieldBadge);

					fieldList.appendChild(fieldItem);
				});

				fieldsSection.appendChild(fieldList);
				methodCard.appendChild(fieldsSection);
			}

			methodsContainer.appendChild(methodCard);
		});
	}

	container.appendChild(methodsContainer);
}

class AppModalServer extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._isOpen = false;
		this.mode = null;
		this.serverId = null;
		this.serverData = null;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this.handleEscape);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('close-all-modals', this.handleCloseAllModals);

		const overlay = this.shadowRoot.querySelector('.server-modal-overlay');
		const closeButton = this.shadowRoot.querySelector('.server-modal-close');

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
	}

	handleEscape(e) {
		if (e.key === 'Escape' && this.isOpen()) {
			this.close();
		}
	}

	isOpen() {
		return this._isOpen;
	}

	handleCloseAllModals() {
		this.close();
	}

	async open({ mode, serverId = null } = {}) {
		if (!['add', 'edit', 'view'].includes(mode)) {
			// console.error('Invalid mode:', mode);
			return;
		}

		this.mode = mode;
		this.serverId = serverId;
		this._isOpen = true;

		const overlay = this.shadowRoot.querySelector('.server-modal-overlay');
		const body = this.shadowRoot.querySelector('[data-modal-body]');
		const actions = this.shadowRoot.querySelector('[data-modal-actions]');

		// Always reset body/actions immediately so we never show stale content.
		if (body) {
			body.innerHTML = html`<div class="server-loading">Loading...</div>`;
		}
		if (actions) {
			actions.style.display = 'none';
			actions.innerHTML = '';
		}

		if (mode === 'add') {
			this.renderAddMode();
			if (overlay && !overlay.classList.contains('open')) {
				overlay.classList.add('open');
			}
			document.dispatchEvent(new CustomEvent('modal-opened'));
			return;
		}

		if (serverId) {
			await this.loadServer(serverId);
			// loadServer may close the modal on error.
			if (!this._isOpen || !this.serverData) return;

			if (mode === 'edit') {
				this.renderEditMode();
			} else {
				this.renderViewMode();
			}
			if (overlay && !overlay.classList.contains('open')) {
				overlay.classList.add('open');
			}
			document.dispatchEvent(new CustomEvent('modal-opened'));
			return;
		}
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.shadowRoot.querySelector('.server-modal-overlay');
		if (overlay) {
			overlay.classList.remove('open');
		}
		this.mode = null;
		this.serverId = null;
		this.serverData = null;
		document.dispatchEvent(new CustomEvent('modal-closed'));
	}

	async loadServer(serverId) {
		try {
			const response = await fetch(`/api/servers/${serverId}`, {
				credentials: 'include'
			});
			if (!response.ok) {
				throw new Error('Failed to load server');
			}
			const data = await response.json();
			this.serverData = data.server;
		} catch (error) {
			// console.error('Error loading server:', error);
			alert('Failed to load server details');
			this.close();
		}
	}

	render() {
		this.shadowRoot.innerHTML = html`
			<style>
				:host {
					display: block;
				}

				.server-modal-overlay {
					position: fixed;
					inset: 0;
					background: rgba(0, 0, 0, 0.5);
					display: flex;
					align-items: center;
					justify-content: center;
					z-index: 1000;
					opacity: 0;
					pointer-events: none;
					transition: opacity 0.2s ease;
				}

				.server-modal-overlay.open {
					opacity: 1;
					pointer-events: auto;
				}

				.server-modal {
					background: var(--surface);
					border-radius: 14px;
					width: 90%;
					max-width: 600px;
					max-height: 90vh;
					box-shadow: var(--shadow);
					transform: scale(0.95);
					transition: transform 0.2s ease;
					display: flex;
					flex-direction: column;
					overflow: hidden;
				}

				@media (min-width: 1024px) {
					.server-modal {
						max-width: 800px;
					}
				}

				.server-modal-overlay.open .server-modal {
					transform: scale(1);
				}

				.server-modal-header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 1.5rem;
					border-bottom: 1px solid var(--border);
				}

				.server-modal-title {
					font-size: 1.25rem;
					font-weight: 600;
					color: var(--text);
					margin: 0;
				}

				.server-modal-close {
					background: none;
					border: none;
					font-size: 1.5rem;
					cursor: pointer;
					color: var(--text-muted);
					padding: 0;
					width: 32px;
					height: 32px;
					display: flex;
					align-items: center;
					justify-content: center;
					border-radius: 6px;
					transition: background 0.2s ease;
				}

				.server-modal-close:hover {
					background: var(--surface-strong);
				}

				.server-modal-body {
					padding: 1.5rem;
					flex: 1 1 auto;
					min-height: 0;
					overflow-y: auto;
				}

				.server-modal-form {
					display: flex;
					flex-direction: column;
					gap: 1.25rem;
				}

				.server-modal-form label {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
					font-size: 0.9rem;
					font-weight: 500;
					color: var(--text);
				}

				.server-modal-form input,
				.server-modal-form textarea,
				.server-modal-form select {
					padding: 0.75rem 1rem;
					border-radius: 6px;
					border: 1px solid var(--border);
					background: var(--input-bg);
					color: var(--text);
					font-size: 0.95rem;
					font-family: inherit;
					transition: border-color 0.2s ease, box-shadow 0.2s ease;
				}

				.server-modal-form input:focus-visible,
				.server-modal-form textarea:focus-visible,
				.server-modal-form select:focus-visible {
					outline: none;
					border-color: var(--accent);
					box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
				}

				.server-modal-form textarea {
					resize: vertical;
					min-height: 80px;
				}

				.server-modal-actions {
					display: flex;
					gap: 0.75rem;
					padding: 1rem 1.5rem 1.25rem;
					border-top: 1px solid var(--border);
					margin: 0;
					flex-shrink: 0;
					background: var(--surface);
				}

				.server-modal-actions button {
					flex: 1;
					padding: 0.875rem 1.5rem;
					border-radius: 6px;
					border: none;
					font-size: 0.95rem;
					font-weight: 600;
					font-family: inherit;
					cursor: pointer;
					transition: background 0.2s ease, transform 0.1s ease, opacity 0.2s ease;
				}

				.server-modal-actions button:disabled {
					opacity: 0.6;
					cursor: not-allowed;
					transform: none !important;
				}

				.btn-primary {
					background: var(--accent);
					color: var(--accent-text);
				}

				.btn-primary:hover:not(:disabled) {
					background: var(--focus);
					transform: translateY(-1px);
				}

				.btn-secondary {
					background: var(--surface-strong);
					color: var(--text);
					border: 1px solid var(--border);
				}

				.btn-secondary:hover:not(:disabled) {
					background: var(--surface);
					transform: translateY(-1px);
				}

				.server-details {
					display: flex;
					flex-direction: column;
					gap: 1rem;
				}

				.server-detail-row {
					display: flex;
					flex-direction: column;
					gap: 0.25rem;
				}

				.server-detail-row strong {
					font-size: 0.85rem;
					font-weight: 600;
					color: var(--text-muted);
					text-transform: uppercase;
					letter-spacing: 0.5px;
				}

				.server-detail-row span {
					color: var(--text);
					font-size: 0.95rem;
				}

				.server-description-text {
					white-space: pre-wrap;
				}

				.server-auth-controls {
					display: flex;
					gap: 0.5rem;
				}

				.server-auth-controls input {
					flex: 1;
				}

				.server-auth-status {
					font-size: 0.875rem;
					padding: 0.5rem;
					border-radius: 6px;
					margin-top: 0.5rem;
				}

				.server-auth-status.is-error {
					background: var(--error-bg);
					color: var(--error-text);
				}

				.server-capabilities-container {
					margin-top: 1.5rem;
				}

				.provider-capabilities {
					margin-top: 1.25rem;
				}

				.provider-capabilities h4 {
					margin: 0 0 1rem 0;
					font-size: 1rem;
					font-weight: 600;
					color: var(--text);
				}

				.method-card {
					margin-bottom: 1rem;
					padding: 1.25rem;
					background: var(--surface-strong);
					border-radius: 10px;
					border: 1px solid var(--border);
				}

				.method-name {
					font-weight: 600;
					font-size: 1.05rem;
					color: var(--text);
				}

				.method-header {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 12px;
					margin-bottom: 0.5rem;
				}

				.method-intents {
					display: flex;
					flex-wrap: wrap;
					gap: 6px;
					justify-content: flex-end;
				}

				.method-intent-badge {
					font-size: 0.75rem;
					padding: 0.25rem 0.6rem;
					border-radius: 999px;
					font-weight: 600;
					background: var(--surface);
					border: 1px solid var(--border);
					color: var(--text-muted);
					font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
					white-space: nowrap;
				}

				.method-desc {
					font-size: 0.9rem;
					color: var(--text-muted);
					margin-bottom: 1rem;
					line-height: 1.5;
				}

				.fields-section {
					margin-top: 1rem;
					padding-top: 1rem;
					border-top: 1px solid var(--border);
				}

				.fields-title {
					font-size: 0.8rem;
					font-weight: 600;
					text-transform: uppercase;
					letter-spacing: 0.5px;
					margin-bottom: 0.75rem;
					color: var(--text-muted);
				}

				.field-list {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
				}

				.field-item {
					display: flex;
					align-items: center;
					gap: 0.5rem;
					font-size: 0.875rem;
					padding: 0.5rem 0.75rem;
					background: var(--surface);
					border-radius: 6px;
				}

				.field-label {
					font-weight: 500;
					color: var(--text);
				}

				.field-type {
					font-size: 0.8rem;
					padding: 0.125rem 0.5rem;
					background: var(--surface-strong);
					border-radius: 4px;
					color: var(--text-muted);
					font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
				}

				.field-badge {
					font-size: 0.75rem;
					padding: 0.125rem 0.5rem;
					border-radius: 4px;
					font-weight: 600;
					text-transform: uppercase;
					letter-spacing: 0.3px;
				}

				.field-badge.required {
					background: color-mix(in srgb, var(--accent) 20%, transparent);
					color: var(--accent);
				}

				.field-badge.optional {
					background: var(--surface-strong);
					color: var(--text-muted);
				}

				.server-loading {
					text-align: center;
					padding: 2rem;
					color: var(--text-muted);
				}

				.server-success {
					padding: 1rem;
					background: color-mix(in srgb, var(--accent) 10%, transparent);
					border-radius: 6px;
					color: var(--accent);
					font-weight: 500;
					margin-bottom: 1rem;
				}

				.server-error {
					padding: 1rem;
					background: var(--error-bg);
					border-radius: 6px;
					color: var(--error-text);
					font-weight: 500;
					margin-bottom: 1rem;
				}

				.server-suspended-notice {
					padding: 1rem;
					background: color-mix(in srgb, var(--error-text) 12%, transparent);
					border-radius: 6px;
					color: var(--error-text);
					font-weight: 500;
					margin-bottom: 1rem;
				}

				.server-suspended-notice strong {
					display: block;
					margin-bottom: 0.25rem;
				}
			</style>
			<div class="server-modal-overlay">
				<div class="server-modal">
					<header class="server-modal-header">
						<h3 class="server-modal-title" data-modal-title>Server Details</h3>
						<button type="button" class="server-modal-close" aria-label="Close">✕</button>
					</header>
					<div class="server-modal-body" data-modal-body>
						<div class="server-loading">Loading...</div>
					</div>
					<div class="server-modal-actions" data-modal-actions style="display: none;"></div>
				</div>
			</div>
		`;
	}

	renderAddMode() {
		const title = this.shadowRoot.querySelector('[data-modal-title]');
		const body = this.shadowRoot.querySelector('[data-modal-body]');
		const actions = this.shadowRoot.querySelector('[data-modal-actions]');

		if (title) title.textContent = 'Add Server';
		if (body) {
			body.innerHTML = html`
				<form class="server-modal-form" data-server-form>
					<label>
						Name
						<input type="text" name="name" required placeholder="Server Name" />
					</label>
					<label>
						Server URL
						<input type="url" name="server_url" required placeholder="https://your-server.vercel.app/api" />
					</label>
					<label>
						Auth Token (optional)
						<input type="text" name="auth_token" placeholder="Auth token" />
					</label>
					<label>
						Description (optional)
						<textarea name="description" placeholder="Server description"></textarea>
					</label>
					<div id="test-results-container"></div>
				</form>
			`;
		}

		if (actions) {
			actions.style.display = 'flex';
			actions.innerHTML = html`
				<button type="button" class="btn-secondary" data-test-btn>Test Server</button>
				<button type="button" class="btn-primary" data-register-btn>Register</button>
			`;

			const testBtn = actions.querySelector('[data-test-btn]');
			const registerBtn = actions.querySelector('[data-register-btn]');
			const form = body.querySelector('[data-server-form]');

			if (testBtn) {
				testBtn.addEventListener('click', () => this.handleTest());
			}

			if (registerBtn && form) {
				registerBtn.addEventListener('click', () => this.handleRegister());
			}
		}
	}

	renderEditMode() {
		if (!this.serverData) return;

		const title = this.shadowRoot.querySelector('[data-modal-title]');
		const body = this.shadowRoot.querySelector('[data-modal-body]');
		const actions = this.shadowRoot.querySelector('[data-modal-actions]');

		if (title) title.textContent = this.serverData.name;
		if (body) {
			const resolvedAuthToken = typeof this.serverData?.auth_token === "string" && this.serverData.auth_token.trim()
				? this.serverData.auth_token.trim()
				: "";

			const isSpecial = this.serverData.id === 1;

			body.innerHTML = html`
				<form class="server-modal-form" data-server-form>
					${this.serverData.suspended ? html`
						<div class="server-detail-row server-suspended-notice">
							<strong>Suspended</strong>
							<span>This server is suspended. It does not appear in the create dropdown or in the servers list for non-admins.</span>
						</div>
					` : ''}
					<label>
						Name
						<input type="text" name="name" required value="${this.escapeHtml(this.serverData.name || '')}" />
					</label>
					<label>
						Server URL
						<input type="url" name="server_url" required value="${this.escapeHtml(this.serverData.server_url || '')}" />
					</label>
					<label>
						Auth Token
						<input type="text" name="auth_token" value="${this.escapeHtml(resolvedAuthToken)}" />
					</label>
					<label>
						Status
						<select name="status" required>
							<option value="active" ${this.serverData.status === 'active' ? 'selected' : ''}>Active</option>
							<option value="pending" ${this.serverData.status === 'pending' ? 'selected' : ''}>Pending</option>
							<option value="inactive" ${this.serverData.status === 'inactive' ? 'selected' : ''}>Inactive</option>
							${this.serverData.viewer_is_admin ? html`<option value="suspended" ${this.serverData.status === 'suspended' ? 'selected' : ''}>Suspended</option>` : ''}
						</select>
					</label>
					<label>
						Description
						<textarea name="description" placeholder="Server description">${this.escapeHtml(this.serverData.description || '')}</textarea>
					</label>
					<div id="test-results-container"></div>
					<div class="server-details">
						<div class="server-detail-row">
							<strong>Members</strong>
							<span>${isSpecial ? '—' : (this.serverData.members_count || 0)}</span>
						</div>
						<div class="server-detail-row">
							<strong>Created</strong>
							<span>${this.serverData.created_at ? formatRelativeTime(this.serverData.created_at, { style: 'long' }) : '—'}</span>
						</div>
					</div>
					<div id="server-capabilities-container" class="server-capabilities-container"></div>
				</form>
			`;

			// Render capabilities if available
			if (this.serverData.server_config) {
				const container = body.querySelector('#server-capabilities-container');
				if (container) {
					renderProviderCapabilities(container, this.serverData.server_config);
				}
			}

		}

		if (actions) {
			actions.style.display = 'flex';
			actions.innerHTML = html`
				<button type="button" class="btn-secondary" data-test-btn>Test Server</button>
				<button type="button" class="btn-secondary" data-refresh-btn>Refresh Methods</button>
				<button type="button" class="btn-primary" data-save-btn>Save</button>
			`;

			const testBtn = actions.querySelector('[data-test-btn]');
			const refreshBtn = actions.querySelector('[data-refresh-btn]');
			const saveBtn = actions.querySelector('[data-save-btn]');
			const form = body.querySelector('[data-server-form]');

			if (testBtn) {
				testBtn.addEventListener('click', () => this.handleTest());
			}

			if (refreshBtn) {
				refreshBtn.addEventListener('click', () => this.handleRefresh());
			}

			if (saveBtn && form) {
				saveBtn.addEventListener('click', () => this.handleSave());
			}
		}
	}

	renderViewMode() {
		if (!this.serverData) return;

		const title = this.shadowRoot.querySelector('[data-modal-title]');
		const body = this.shadowRoot.querySelector('[data-modal-body]');
		const actions = this.shadowRoot.querySelector('[data-modal-actions]');

		if (title) title.textContent = this.serverData.name || 'Server Details';
		if (body) {
			const isSpecial = this.serverData.id === 1;

			body.innerHTML = html`
				<div class="server-details">
					${this.serverData.suspended ? html`
						<div class="server-detail-row server-suspended-notice">
							<strong>Suspended</strong>
							<span>This server is suspended. It does not appear in the create dropdown or in the servers list for non-admins.</span>
						</div>
					` : ''}
					<div class="server-detail-row">
						<strong>Status</strong>
						<span>${this.serverData.status || '—'}</span>
					</div>
					${this.serverData.description ? html`
						<div class="server-detail-row">
							<strong>Description</strong>
							<span class="server-description-text">${this.escapeHtml(this.serverData.description)}</span>
						</div>
					` : ''}
					<div class="server-detail-row">
						<strong>Members</strong>
						<span>${isSpecial ? '—' : (this.serverData.members_count || 0)}</span>
					</div>
					<div class="server-detail-row">
						<strong>Created</strong>
						<span>${this.serverData.created_at ? formatRelativeTime(this.serverData.created_at, { style: 'long' }) : '—'}</span>
					</div>
					${this.serverData.server_config ? html`
						<div id="server-capabilities-container" class="server-capabilities-container"></div>
					` : ''}
				</div>
			`;

			// Render capabilities if available
			if (this.serverData.server_config) {
				const container = body.querySelector('#server-capabilities-container');
				if (container) {
					renderProviderCapabilities(container, this.serverData.server_config);
				}
			}
		}

		if (actions) {
			// Special server (id = 1): users cannot join/leave; hide actions.
			if (this.serverData.id === 1) {
				actions.style.display = 'none';
				actions.innerHTML = '';
				return;
			}

			actions.style.display = 'flex';
			if (this.serverData.is_member && !this.serverData.is_owner) {
				actions.innerHTML = html`
					<button type="button" class="btn-secondary" data-leave-btn>Leave</button>
				`;
				const leaveBtn = actions.querySelector('[data-leave-btn]');
				if (leaveBtn) {
					leaveBtn.addEventListener('click', () => this.handleLeave());
				}
			} else if (!this.serverData.is_member) {
				actions.innerHTML = html`
					<button type="button" class="btn-primary" data-join-btn>Join</button>
				`;
				const joinBtn = actions.querySelector('[data-join-btn]');
				if (joinBtn) {
					joinBtn.addEventListener('click', () => this.handleJoin());
				}
			} else {
				actions.style.display = 'none';
			}
		}
	}

	async handleTest() {
		const form = this.shadowRoot.querySelector('[data-server-form]');
		if (!form) return;

		const serverUrl = form.querySelector('input[name="server_url"]')?.value?.trim();
		const authToken = form.querySelector('input[name="auth_token"]')?.value?.trim() || '';

		if (!serverUrl) {
			alert('Please enter a server URL');
			return;
		}

		const resultsContainer = this.shadowRoot.querySelector('#test-results-container');
		if (resultsContainer) {
			resultsContainer.innerHTML = '<div class="server-loading">Testing server...</div>';
			resultsContainer.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}

		try {
			// For add mode, test the URL directly
			if (this.mode === 'add') {
				const testUrl = serverUrl.startsWith('http') ? serverUrl : `https://${serverUrl}`;
				const response = await fetch(testUrl, {
					method: 'GET',
					headers: {
						'Accept': 'application/json',
						...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
					},
					signal: AbortSignal.timeout(10000)
				});

				if (!response.ok) {
					throw new Error(`Server returned error: ${response.status} ${response.statusText}`);
				}

				const capabilities = await response.json();
				if (!capabilities.methods || typeof capabilities.methods !== 'object') {
					throw new Error("Server response missing or invalid 'methods' field");
				}

				if (resultsContainer) {
					resultsContainer.innerHTML = html`
						<div class="server-success">✓ Server is accessible and responding</div>
					`;
					renderProviderCapabilities(resultsContainer, capabilities);
					resultsContainer.scrollIntoView({ block: 'center', behavior: 'smooth' });
				}
			} else {
				// For edit mode, use API endpoint
				const response = await fetch(`/api/servers/${this.serverId}/test`, {
					method: 'POST',
					credentials: 'include'
				});

				const data = await response.json();
				if (!response.ok) {
					throw new Error(data.error || 'Failed to test server');
				}

				const methodsContainer = this.shadowRoot.querySelector('#server-capabilities-container');
				if (methodsContainer) {
					methodsContainer.innerHTML = '';
					renderProviderCapabilities(methodsContainer, data.capabilities);
				}

				if (resultsContainer) {
					resultsContainer.innerHTML = html`
						<div class="server-success">✓ Server is accessible and responding</div>
					`;
					resultsContainer.scrollIntoView({ block: 'center', behavior: 'smooth' });
				}
			}
		} catch (error) {
			const target = resultsContainer || this.shadowRoot.querySelector('#server-capabilities-container');
			if (target) {
				target.innerHTML = html`
					<div class="server-error">✗ ${error.message || 'Failed to test server'}</div>
				`;
				target.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
		}
	}

	async handleRegister() {
		const form = this.shadowRoot.querySelector('[data-server-form]');
		if (!form) return;

		const formData = new FormData(form);
		const payload = {
			name: formData.get('name'),
			server_url: formData.get('server_url'),
			auth_token: formData.get('auth_token') || null,
			description: formData.get('description') || null
		};

		const registerBtn = this.shadowRoot.querySelector('[data-register-btn]');
		if (registerBtn) {
			registerBtn.disabled = true;
			registerBtn.textContent = 'Registering...';
		}

		try {
			const response = await fetch('/api/servers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(payload)
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to register server');
				return;
			}

			this.close();
			document.dispatchEvent(new CustomEvent('server-updated'));
		} catch (error) {
			alert(error.message || 'Failed to register server');
		} finally {
			if (registerBtn) {
				registerBtn.disabled = false;
				registerBtn.textContent = 'Register';
			}
		}
	}

	async handleSave() {
		const form = this.shadowRoot.querySelector('[data-server-form]');
		if (!form || !this.serverId) return;

		const formData = new FormData(form);
		const payload = {
			name: formData.get('name'),
			server_url: formData.get('server_url'),
			status: formData.get('status'),
			description: formData.get('description') || null,
			auth_token: formData.get('auth_token') || null
		};

		const saveBtn = this.shadowRoot.querySelector('[data-save-btn]');
		if (saveBtn) {
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';
		}

		try {
			const response = await fetch(`/api/servers/${this.serverId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(payload)
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to save server');
				return;
			}

			this.serverData = data.server;
			this.renderEditMode();
			document.dispatchEvent(new CustomEvent('server-updated'));
			document.dispatchEvent(new CustomEvent('servers-updated', { bubbles: true }));
		} catch (error) {
			alert(error.message || 'Failed to save server');
		} finally {
			if (saveBtn) {
				saveBtn.disabled = false;
				saveBtn.textContent = 'Save';
			}
		}
	}

	async handleSaveAuthToken(input, statusEl) {
		if (!this.serverId || !input) return;

		const token = input.value.trim();
		const saveBtn = this.shadowRoot.querySelector('[data-save-token-btn]');
		const originalText = saveBtn?.textContent || 'Save token';

		if (saveBtn) {
			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';
		}

		try {
			const response = await fetch(`/api/servers/${this.serverId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ auth_token: token })
			});

			const data = await response.json();
			if (!response.ok) {
				if (statusEl) {
					statusEl.textContent = data.error || 'Failed to update auth token';
					statusEl.hidden = false;
					statusEl.classList.add('is-error');
				}
				return;
			}

			if (statusEl) {
				statusEl.textContent = 'Auth token updated';
				statusEl.hidden = false;
				statusEl.classList.remove('is-error');
			}

			if (data.server?.auth_token !== undefined && input) {
				input.value = typeof data.server.auth_token === 'string' ? data.server.auth_token : '';
			}
		} catch (error) {
			if (statusEl) {
				statusEl.textContent = error.message || 'Failed to update auth token';
				statusEl.hidden = false;
				statusEl.classList.add('is-error');
			}
		} finally {
			if (saveBtn) {
				saveBtn.disabled = false;
				saveBtn.textContent = originalText;
			}
		}
	}

	async handleRefresh() {
		if (!this.serverId) return;

		const refreshBtn = this.shadowRoot.querySelector('[data-refresh-btn]');
		const container = this.shadowRoot.querySelector('#server-capabilities-container');
		const originalText = refreshBtn?.textContent || 'Refresh Methods';

		if (refreshBtn) {
			refreshBtn.disabled = true;
			refreshBtn.textContent = 'Refreshing...';
		}

		if (container) {
			container.innerHTML = '<div class="server-loading">Refreshing server methods...</div>';
		}

		try {
			const response = await fetch(`/api/servers/${this.serverId}/refresh`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || 'Failed to refresh server methods');
			}

			if (container) {
				container.innerHTML = html`
					<div class="server-success">✓ Server methods refreshed successfully</div>
				`;
				renderProviderCapabilities(container, data.capabilities);
			}

			// Reload server data
			await this.loadServer(this.serverId);
			this.renderEditMode();
		} catch (error) {
			if (container) {
				container.innerHTML = html`
					<div class="server-error">✗ ${error.message || 'Failed to refresh server methods'}</div>
				`;
			}
		} finally {
			if (refreshBtn) {
				refreshBtn.disabled = false;
				refreshBtn.textContent = originalText;
			}
		}
	}

	async handleJoin() {
		if (!this.serverId) return;

		try {
			const response = await fetch(`/api/servers/${this.serverId}/join`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to join server');
				return;
			}

			this.close();
			document.dispatchEvent(new CustomEvent('server-updated'));
			window.location.reload();
		} catch (error) {
			alert(error.message || 'Failed to join server');
		}
	}

	async handleLeave() {
		if (!this.serverId) return;

		if (!confirm('Are you sure you want to leave this server?')) {
			return;
		}

		try {
			const response = await fetch(`/api/servers/${this.serverId}/leave`, {
				method: 'POST',
				credentials: 'include'
			});

			const data = await response.json();
			if (!response.ok) {
				alert(data.error || 'Failed to leave server');
				return;
			}

			this.close();
			document.dispatchEvent(new CustomEvent('server-updated'));
			window.location.reload();
		} catch (error) {
			alert(error.message || 'Failed to leave server');
		}
	}

	escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}
}

customElements.define('app-modal-server', AppModalServer);
