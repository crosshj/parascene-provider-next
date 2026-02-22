import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

const html = String.raw;

class AppModalPublish extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._mode = 'publish'; // 'publish' or 'edit'
		this._creationId = null;
		this._loading = false;
		this._openRequestId = 0;
		this.handleEscape = this.handleEscape.bind(this);
		this.handleOpenPublish = this.handleOpenPublish.bind(this);
		this.handleOpenEdit = this.handleOpenEdit.bind(this);
		this.handleClose = this.handleClose.bind(this);
		this.handleCloseAllModals = this.handleCloseAllModals.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();
		this.setupEventListeners();
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this.handleEscape);
		document.removeEventListener('open-publish-modal', this.handleOpenPublish);
		document.removeEventListener('open-edit-modal', this.handleOpenEdit);
		document.removeEventListener('close-publish-modal', this.handleClose);
		document.removeEventListener('close-all-modals', this.handleCloseAllModals);
	}

	render() {
		this.innerHTML = html`
			<div class="publish-modal-overlay">
				<div class="publish-modal">
					<div class="publish-modal-loading">
						<div class="publish-spinner"></div>
					</div>
					<div class="publish-modal-header">
						<h2 data-modal-title>Publish Creation</h2>
						<button class="publish-modal-close" aria-label="Close">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
								stroke-linecap="round" stroke-linejoin="round">
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					</div>
					<div class="publish-modal-body">
						<div class="publish-alert" data-publish-alert style="display: none;">
							<span class="publish-alert-message" data-publish-alert-message></span>
							<button class="publish-alert-close" data-publish-alert-close aria-label="Close alert">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
									stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							</button>
						</div>
						<div class="publish-field">
							<label for="publish-title">Title <span class="field-required" aria-hidden="true">*</span></label>
							<input type="text" id="publish-title" name="title" placeholder="Enter a title for your creation" required />
						</div>
						<div class="publish-field">
							<label for="publish-description">Description</label>
							<textarea id="publish-description" name="description" rows="4"
								placeholder="Describe your creation..."></textarea>
						</div>
					</div>
					<div class="publish-modal-footer">
						<a href="#" class="publish-cancel-link">Cancel</a>
						<button class="btn-primary publish-submit-btn" data-publish-submit disabled>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"
								style="margin-right: 6px; vertical-align: middle;">
								<path d="M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z" stroke="currentColor" stroke-width="1.5"
									stroke-linecap="round" stroke-linejoin="round" fill="none" />
							</svg>
							<span data-submit-text>Publish</span>
						</button>
					</div>
				</div>
			</div>
		`;
	}

	setupEventListeners() {
		document.addEventListener('keydown', this.handleEscape);
		document.addEventListener('open-publish-modal', this.handleOpenPublish);
		document.addEventListener('open-edit-modal', this.handleOpenEdit);
		document.addEventListener('close-publish-modal', this.handleClose);
		document.addEventListener('close-all-modals', this.handleCloseAllModals);

		const overlay = this.querySelector('.publish-modal-overlay');
		const closeButton = this.querySelector('.publish-modal-close');
		const cancelLink = this.querySelector('.publish-cancel-link');
		const submitBtn = this.querySelector('[data-publish-submit]');
		const alertClose = this.querySelector('[data-publish-alert-close]');

		if (overlay) {
			overlay.addEventListener('click', (e) => {
				if (e.target === overlay && !this._loading) {
					this.close();
				}
			});
		}

		if (closeButton) {
			closeButton.addEventListener('click', () => {
				if (!this._loading) {
					this.close();
				}
			});
		}

		if (cancelLink) {
			cancelLink.addEventListener('click', (e) => {
				e.preventDefault();
				if (!this._loading) {
					this.close();
				}
			});
		}

		if (submitBtn) {
			submitBtn.addEventListener('click', this.handleSubmit);
		}

		if (alertClose) {
			alertClose.addEventListener('click', () => {
				this.hideAlert();
			});
		}

		// Set up title input listener to enable/disable submit button
		const titleInput = this.querySelector('#publish-title');
		if (titleInput && submitBtn) {
			const updateSubmitButton = () => {
				const hasTitle = titleInput.value.trim().length > 0;
				submitBtn.disabled = !hasTitle;
			};
			titleInput.addEventListener('input', updateSubmitButton);
			titleInput.addEventListener('change', updateSubmitButton);
		}
	}

	handleEscape(e) {
		if (e.key === 'Escape' && this.isOpen() && !this._loading) {
			this.close();
		}
	}

	handleOpenPublish(e) {
		const creationId = e.detail?.creationId || null;
		this.openPublish(creationId);
	}

	handleOpenEdit(e) {
		const creationId = e.detail?.creationId || null;
		this.openEdit(creationId);
	}

	handleClose() {
		this.close();
	}

	handleCloseAllModals() {
		this.close();
	}

	isOpen() {
		return this._isOpen;
	}

	async openPublish(creationId) {
		this._mode = 'publish';
		this._creationId = creationId;
		this.updateModalContent();
		this.open();

		// Disable submit button initially (will be enabled when title has text)
		const submitBtn = this.querySelector('[data-publish-submit]');
		if (submitBtn) {
			submitBtn.disabled = true;
		}

		if (!creationId) {
			this.showAlert('Invalid creation ID', true);
			return;
		}

		const requestId = ++this._openRequestId;

		try {
			const response = await fetch(`/api/create/images/${creationId}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new Error('Failed to load creation');
			}

			// Ignore stale async results if another open happened.
			if (requestId !== this._openRequestId) return;

			const creation = await response.json();
			const titleInput = this.querySelector('#publish-title');
			const descriptionTextarea = this.querySelector('#publish-description');

			// Only prefill if still empty (never clobber user typing).
			if (titleInput && !titleInput.value.trim()) {
				titleInput.value = creation.title || '';
			}

			if (descriptionTextarea && !descriptionTextarea.value.trim()) {
				const savedDescription = typeof creation.description === 'string' ? creation.description.trim() : '';
				descriptionTextarea.value = savedDescription || '';
			}

			// Update submit button state based on title
			const submitBtn = this.querySelector('[data-publish-submit]');
			if (submitBtn) {
				const hasTitle = titleInput && titleInput.value.trim().length > 0;
				submitBtn.disabled = !hasTitle;
			}

			// Focus title input
			if (titleInput) {
				setTimeout(() => titleInput.focus(), 100);
			}
		} catch (error) {
			// console.error('Error loading creation:', error);
			this.showAlert('Failed to load creation data', true);
		}
	}

	async openEdit(creationId) {
		this._mode = 'edit';
		this._creationId = creationId;

		// Disable submit button initially (will be enabled when title has text)
		const submitBtn = this.querySelector('[data-publish-submit]');
		if (submitBtn) {
			submitBtn.disabled = true;
		}

		if (!creationId) {
			this.showAlert('Invalid creation ID', true);
			return;
		}

		// Fetch current creation data to populate the form
		try {
			const response = await fetch(`/api/create/images/${creationId}`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new Error('Failed to load creation');
			}

			const creation = await response.json();
			const titleInput = this.querySelector('#publish-title');
			const descriptionTextarea = this.querySelector('#publish-description');

			if (titleInput) titleInput.value = creation.title || '';
			if (descriptionTextarea) descriptionTextarea.value = creation.description || '';

			// Update submit button state based on title
			const submitBtn = this.querySelector('[data-publish-submit]');
			if (submitBtn) {
				const hasTitle = titleInput && titleInput.value.trim().length > 0;
				submitBtn.disabled = !hasTitle;
			}

			this.updateModalContent();
			this.open();

			// Focus on title input
			if (titleInput) {
				setTimeout(() => titleInput.focus(), 100);
			}
		} catch (error) {
			// console.error('Error loading creation:', error);
			this.showAlert('Failed to load creation data', true);
		}
	}

	updateModalContent() {
		const titleEl = this.querySelector('[data-modal-title]');
		const submitTextEl = this.querySelector('[data-submit-text]');
		const submitBtn = this.querySelector('[data-publish-submit]');

		if (this._mode === 'edit') {
			if (titleEl) titleEl.textContent = 'Edit Creation';
			if (submitTextEl) submitTextEl.textContent = 'Save Changes';
			if (submitBtn) {
				const icon = submitBtn.querySelector('svg path');
				if (icon) icon.setAttribute('d', 'M11.5 2.5L13.5 4.5L5.5 12.5H3.5V10.5L11.5 2.5Z');
			}
		} else {
			if (titleEl) titleEl.textContent = 'Publish Creation';
			if (submitTextEl) submitTextEl.textContent = 'Publish';
			if (submitBtn) {
				const icon = submitBtn.querySelector('svg path');
				if (icon) icon.setAttribute('d', 'M1.5 8L14.5 1.5L10.5 14.5L8 9L1.5 8Z');
			}
		}
	}

	open() {
		if (this._isOpen) return;
		this._isOpen = true;
		const overlay = this.querySelector('.publish-modal-overlay');
		if (overlay) {
			overlay.classList.add('open');
		}
		// Body scroll prevention is handled globally in global.js
		this.hideAlert();
	}

	close() {
		if (!this._isOpen) return;
		this._isOpen = false;
		const overlay = this.querySelector('.publish-modal-overlay');
		if (overlay) {
			overlay.classList.remove('open');
		}
		// Body scroll restoration is handled globally in global.js
		// Clear form
		const titleInput = this.querySelector('#publish-title');
		const descriptionTextarea = this.querySelector('#publish-description');
		const submitBtn = this.querySelector('[data-publish-submit]');
		if (titleInput) titleInput.value = '';
		if (descriptionTextarea) descriptionTextarea.value = '';
		if (submitBtn) submitBtn.disabled = true;
		this.hideAlert();
	}

	showAlert(message, isError = true) {
		const alert = this.querySelector('[data-publish-alert]');
		const alertMessage = this.querySelector('[data-publish-alert-message]');
		if (alert && alertMessage) {
			alertMessage.textContent = message;
			alert.className = `publish-alert ${isError ? 'publish-alert-error' : 'publish-alert-success'}`;
			alert.style.display = 'flex';
		}
	}

	hideAlert() {
		const alert = this.querySelector('[data-publish-alert]');
		if (alert) {
			alert.style.display = 'none';
		}
	}

	async handleSubmit() {
		if (this._loading) return;

		if (!this._creationId) {
			this.showAlert('Invalid creation ID', true);
			return;
		}

		const titleInput = this.querySelector('#publish-title');
		const descriptionTextarea = this.querySelector('#publish-description');
		const loadingOverlay = this.querySelector('.publish-modal-loading');
		const submitBtn = this.querySelector('[data-publish-submit]');
		const cancelLink = this.querySelector('.publish-cancel-link');

		if (!titleInput || !loadingOverlay) return;

		const title = titleInput.value.trim();
		const description = descriptionTextarea ? descriptionTextarea.value.trim() : '';

		if (!title) {
			this.showAlert('Title is required', true);
			titleInput.focus();
			return;
		}

		// Hide any existing alert
		this.hideAlert();

		// Show loading state
		this._loading = true;
		loadingOverlay.classList.add('active');
		titleInput.disabled = true;
		if (descriptionTextarea) descriptionTextarea.disabled = true;
		if (submitBtn) submitBtn.disabled = true;
		if (cancelLink) {
			cancelLink.style.pointerEvents = 'none';
			cancelLink.style.opacity = '0.5';
		}

		try {
			if (this._mode === 'edit') {
				await this.handleEditSubmit(title, description);
			} else {
				await this.handlePublishSubmit(title, description);
			}
		} catch (error) {
			// console.error(`Error ${this._mode === 'edit' ? 'updating' : 'publishing'} creation:`, error);
			this.showAlert(error.message || `Failed to ${this._mode === 'edit' ? 'update' : 'publish'} creation. Please try again.`, true);

			// Hide loading state
			loadingOverlay.classList.remove('active');
			titleInput.disabled = false;
			if (descriptionTextarea) descriptionTextarea.disabled = false;
			if (submitBtn) submitBtn.disabled = false;
			if (cancelLink) {
				cancelLink.style.pointerEvents = '';
				cancelLink.style.opacity = '';
			}
			this._loading = false;
		}
	}

	async handlePublishSubmit(title, description) {
		const response = await fetch(`/api/create/images/${this._creationId}/publish`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ title, description }),
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to publish creation');
		}

		// Success - navigate to creation detail page
		window.location.href = `/creations/${this._creationId}`;
	}

	async handleEditSubmit(title, description) {
		const response = await fetch(`/api/create/images/${this._creationId}`, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ title, description }),
			credentials: 'include'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to update creation');
		}

		// Success - reload the page to show updated data
		window.location.reload();
	}
}

customElements.define('app-modal-publish', AppModalPublish);
