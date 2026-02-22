/**
 * Utilities for building forms from provider/server config (methods[].fields).
 * Field types are handled by separate handlers so new types can be added easily.
 */

import { attachAutoGrowTextarea } from './autogrow.js';

// --- Field type detection (used to choose handler) ---

export function isPromptLikeField(fieldKey, field) {
	const key = String(fieldKey || '');
	const label = String(field?.label || '');
	return /prompt/i.test(key) || /prompt/i.test(label);
}

export function isMultilineField(fieldKey, field) {
	const type = typeof field?.type === 'string' ? field.type.toLowerCase() : '';
	if (type === 'textarea' || type === 'multiline') return true;
	if (field?.multiline === true) return true;
	if (type === '' || type === 'text' || type === 'string') {
		return isPromptLikeField(fieldKey, field);
	}
	return false;
}

// --- Label (shared across field types) ---

function createLabel(fieldKey, field, { labelClassName, requiredClassName, fieldIdPrefix }) {
	const label = document.createElement('label');
	label.className = labelClassName;
	label.htmlFor = `${fieldIdPrefix}${fieldKey}`;
	label.appendChild(document.createTextNode(field.label || fieldKey));
	if (field.required) {
		const required = document.createElement('span');
		required.className = requiredClassName;
		required.textContent = ' *';
		label.appendChild(required);
	}
	return label;
}

// --- Field type handlers ---
// Each handler(fieldKey, field, context) returns the input/textarea element.
// Context: { inputClassName, fieldIdPrefix, onValueChange, selectClassName? }.
// Handler must set id, name, className, required, value and attach listeners that call onValueChange(fieldKey, value).

function createColorField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = 'color';
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = inputClassName;
	input.value = typeof field.default === 'string' ? field.default : '#000000';
	if (field.required) input.required = true;

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('change', (e) => notify(e.target.value));
	input.addEventListener('input', (e) => notify(e.target.value));
	return input;
}

function createTextareaField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('textarea');
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = isPromptLikeField(fieldKey, field) ? `${inputClassName} prompt-editor` : inputClassName;
	input.placeholder = field.label || fieldKey;
	input.rows = typeof field.rows === 'number' && field.rows > 0 ? field.rows : 3;
	if (field.required) input.required = true;

	attachAutoGrowTextarea(input);

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('input', (e) => notify(e.target.value));
	return input;
}

function createTextField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = field.type || 'text';
	input.id = `${fieldIdPrefix}${fieldKey}`;
	input.name = fieldKey;
	input.className = inputClassName;
	input.placeholder = field.label || fieldKey;
	if (field.required) input.required = true;

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.value);
	input.addEventListener('input', (e) => notify(e.target.value));
	input.addEventListener('change', (e) => notify(e.target.value));
	return input;
}

/**
 * Normalize field.options to an array of { value, label }.
 * Accepts: string[] or { value?, id?, label? }[].
 */
function normalizeSelectOptions(options) {
	if (!Array.isArray(options)) return [];
	return options.map((item) => {
		if (typeof item === 'string') {
			return { value: item, label: item };
		}
		if (item && typeof item === 'object') {
			const value = item.value ?? item.id ?? item.label ?? '';
			const label = item.label ?? item.value ?? item.id ?? String(value);
			return { value: String(value), label: String(label) };
		}
		return { value: '', label: '' };
	});
}

function createSelectField(fieldKey, field, context) {
	const { fieldIdPrefix, onValueChange } = context;
	const selectClassName = context.selectClassName ?? context.inputClassName;
	const select = document.createElement('select');
	select.id = `${fieldIdPrefix}${fieldKey}`;
	select.name = fieldKey;
	select.className = selectClassName;
	if (field.required) select.required = true;

	const options = normalizeSelectOptions(field.options || []);
	const defaultValue = field.default !== undefined && field.default !== null ? String(field.default) : '';

	options.forEach(({ value, label }) => {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = label;
		if (value === defaultValue) option.selected = true;
		select.appendChild(option);
	});

	const notify = (value) => onValueChange(fieldKey, value);
	notify(select.value);
	select.addEventListener('change', (e) => notify(e.target.value));
	return select;
}

function createBooleanField(fieldKey, field, context) {
	const { fieldIdPrefix, onValueChange } = context;
	const input = document.createElement('input');
	input.type = 'checkbox';
	input.name = fieldKey;
	input.className = 'form-switch-input';
	input.setAttribute('aria-hidden', 'true');
	input.setAttribute('tabindex', '-1');
	if (field.required) input.required = true;

	const defaultValue = field.default === true || field.default === 'true';
	input.checked = defaultValue;

	const wrapper = document.createElement('div');
	wrapper.id = `${fieldIdPrefix}${fieldKey}`;
	wrapper.className = 'form-switch';
	wrapper.setAttribute('role', 'switch');
	wrapper.setAttribute('aria-checked', String(input.checked));
	wrapper.setAttribute('tabindex', '0');
	wrapper.setAttribute('aria-label', field.label || fieldKey);

	const track = document.createElement('span');
	track.className = 'form-switch-track';
	const thumb = document.createElement('span');
	thumb.className = 'form-switch-thumb';
	track.appendChild(thumb);
	wrapper.appendChild(input);
	wrapper.appendChild(track);

	const notify = (value) => onValueChange(fieldKey, value);
	notify(input.checked);

	const updateAria = () => wrapper.setAttribute('aria-checked', String(input.checked));

	const handleChange = () => {
		updateAria();
		notify(input.checked);
	};

	input.addEventListener('change', handleChange);

	wrapper.addEventListener('click', (e) => {
		if (e.target === input) return;
		e.preventDefault();
		input.checked = !input.checked;
		updateAria();
		notify(input.checked);
	});

	wrapper.addEventListener('keydown', (e) => {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			input.checked = !input.checked;
			updateAria();
			notify(input.checked);
		}
	});

	return wrapper;
}

function createImageField(fieldKey, field, context) {
	const { inputClassName, fieldIdPrefix, onValueChange } = context;
	const defaultValue = typeof field?.default === 'string' ? field.default : '';

	const wrapper = document.createElement('div');
	wrapper.className = 'image-field image-field-multi';

	const values = { paste_image: 'paste_image', paste_link: 'paste_link', upload_file: 'upload_file' };

	const thumbPlaceholder = document.createElement('button');
	thumbPlaceholder.type = 'button';
	thumbPlaceholder.className = 'image-thumb-placeholder';
	thumbPlaceholder.setAttribute('aria-label', 'Choose image');
	thumbPlaceholder.textContent = 'Click To Choose';
	wrapper.appendChild(thumbPlaceholder);

	const thumbContainer = document.createElement('div');
	thumbContainer.className = 'image-thumb-container';
	thumbContainer.setAttribute('data-image-thumb-container', '');
	thumbContainer.hidden = true;
	const thumbWrap = document.createElement('div');
	thumbWrap.className = 'image-thumb-wrap loading';
	thumbWrap.title = 'Preview';
	const thumbImg = document.createElement('img');
	thumbImg.className = 'image-thumb';
	thumbImg.alt = '';
	thumbWrap.appendChild(thumbImg);
	const removeBtn = document.createElement('button');
	removeBtn.type = 'button';
	removeBtn.className = 'image-pick-another';
	removeBtn.textContent = 'Remove';
	thumbContainer.appendChild(thumbWrap);
	thumbContainer.appendChild(removeBtn);
	wrapper.appendChild(thumbContainer);

	// Modal: choose method then show that UI; on image set, close and fill thumbnail
	const modalOverlay = document.createElement('div');
	modalOverlay.className = 'image-picker-modal-overlay';
	modalOverlay.setAttribute('data-image-picker-modal', '');
	const modal = document.createElement('div');
	modal.className = 'image-picker-modal modal';
	const modalHeader = document.createElement('div');
	modalHeader.className = 'modal-header';
	const modalTitle = document.createElement('h3');
	modalTitle.textContent = 'Choose image';
	const modalClose = document.createElement('button');
	modalClose.type = 'button';
	modalClose.className = 'modal-close';
	modalClose.setAttribute('aria-label', 'Close');
	modalClose.textContent = '×';
	modalHeader.appendChild(modalTitle);
	modalHeader.appendChild(modalClose);
	modal.appendChild(modalHeader);
	const modalBody = document.createElement('div');
	modalBody.className = 'image-picker-modal-body';

	const methodButtons = document.createElement('div');
	methodButtons.className = 'image-picker-methods';
	const btnPasteImage = document.createElement('button');
	btnPasteImage.type = 'button';
	btnPasteImage.className = 'image-picker-method-btn';
	btnPasteImage.textContent = 'Paste image';
	const btnPasteLink = document.createElement('button');
	btnPasteLink.type = 'button';
	btnPasteLink.className = 'image-picker-method-btn';
	btnPasteLink.textContent = 'Paste link';
	const btnUploadFile = document.createElement('button');
	btnUploadFile.type = 'button';
	btnUploadFile.className = 'image-picker-method-btn';
	btnUploadFile.textContent = 'Upload file';
	methodButtons.appendChild(btnPasteImage);
	methodButtons.appendChild(btnPasteLink);
	methodButtons.appendChild(btnUploadFile);

	const pastePanel = document.createElement('div');
	pastePanel.className = 'image-picker-panel';
	pastePanel.setAttribute('data-image-picker-panel', 'paste_image');
	pastePanel.hidden = true;
	const pasteZone = document.createElement('div');
	pasteZone.setAttribute('tabindex', '0');
	pasteZone.setAttribute('role', 'button');
	pasteZone.setAttribute('aria-label', 'Paste image here. Focus then Ctrl+V or Cmd+V.');
	pasteZone.className = 'image-picker-paste-zone';
	pasteZone.textContent = 'Paste image here — focus this box, then Ctrl+V (or Cmd+V)';
	const pasteReady = document.createElement('div');
	pasteReady.className = 'image-picker-ready';
	pasteReady.hidden = true;
	const pasteReadyThumb = document.createElement('img');
	pasteReadyThumb.className = 'image-picker-ready-thumb';
	pasteReadyThumb.alt = '';
	const pasteReadyText = document.createElement('span');
	pasteReadyText.className = 'image-picker-ready-text';
	pasteReady.appendChild(pasteReadyThumb);
	pasteReady.appendChild(pasteReadyText);
	const pasteAttachBtn = document.createElement('button');
	pasteAttachBtn.type = 'button';
	pasteAttachBtn.className = 'image-picker-attach-btn';
	pasteAttachBtn.textContent = 'Attach';
	pasteAttachBtn.disabled = true;
	pastePanel.appendChild(pasteZone);
	pastePanel.appendChild(pasteReady);
	pastePanel.appendChild(pasteAttachBtn);

	const linkPanel = document.createElement('div');
	linkPanel.className = 'image-picker-panel';
	linkPanel.setAttribute('data-image-picker-panel', 'paste_link');
	linkPanel.hidden = true;
	const urlInput = document.createElement('input');
	urlInput.type = 'url';
	urlInput.className = `${inputClassName} image-url-input`;
	urlInput.placeholder = 'Paste or enter image URL';
	urlInput.setAttribute('data-image-url-input', '');
	const linkAttachBtn = document.createElement('button');
	linkAttachBtn.type = 'button';
	linkAttachBtn.className = 'image-picker-attach-btn';
	linkAttachBtn.textContent = 'Attach';
	linkAttachBtn.disabled = true;
	linkPanel.appendChild(urlInput);
	linkPanel.appendChild(linkAttachBtn);

	const uploadPanel = document.createElement('div');
	uploadPanel.className = 'image-picker-panel';
	uploadPanel.setAttribute('data-image-picker-panel', 'upload_file');
	uploadPanel.hidden = true;
	const chooseLabel = document.createElement('label');
	chooseLabel.className = 'image-choose-label';
	const chooseSpan = document.createElement('span');
	chooseSpan.className = 'image-choose-btn';
	chooseSpan.textContent = 'Choose file';
	const fileInput = document.createElement('input');
	fileInput.type = 'file';
	fileInput.className = 'image-file-input';
	fileInput.accept = 'image/*';
	fileInput.hidden = true;
	chooseLabel.appendChild(chooseSpan);
	chooseLabel.appendChild(fileInput);
	const uploadReady = document.createElement('div');
	uploadReady.className = 'image-picker-ready';
	uploadReady.hidden = true;
	const uploadReadyText = document.createElement('span');
	uploadReadyText.className = 'image-picker-ready-text';
	uploadReady.appendChild(uploadReadyText);
	const uploadAttachBtn = document.createElement('button');
	uploadAttachBtn.type = 'button';
	uploadAttachBtn.className = 'image-picker-attach-btn';
	uploadAttachBtn.textContent = 'Attach';
	uploadAttachBtn.disabled = true;
	uploadPanel.appendChild(chooseLabel);
	uploadPanel.appendChild(uploadReady);
	uploadPanel.appendChild(uploadAttachBtn);

	const modalError = document.createElement('p');
	modalError.className = 'image-field-error image-picker-modal-error';
	modalError.setAttribute('role', 'alert');
	modalError.hidden = true;
	modalBody.appendChild(methodButtons);
	modalBody.appendChild(pastePanel);
	modalBody.appendChild(linkPanel);
	modalBody.appendChild(uploadPanel);
	modalBody.appendChild(modalError);
	modal.appendChild(modalBody);
	modalOverlay.appendChild(modal);
	wrapper.appendChild(modalOverlay);

	const hiddenInput = document.createElement('input');
	hiddenInput.type = 'hidden';
	hiddenInput.id = `${fieldIdPrefix}${fieldKey}`;
	hiddenInput.name = fieldKey;
	hiddenInput.value = defaultValue;
	if (field.required) hiddenInput.required = true;
	wrapper.appendChild(hiddenInput);

	const errorEl = document.createElement('p');
	errorEl.className = 'image-field-error';
	errorEl.setAttribute('role', 'alert');
	errorEl.setAttribute('aria-live', 'polite');
	errorEl.hidden = true;
	wrapper.appendChild(errorEl);

	function setError(msg) {
		errorEl.textContent = msg || '';
		errorEl.hidden = !msg;
		modalError.textContent = msg || '';
		modalError.hidden = !msg;
	}

	let currentObjectUrl = null;
	let pastePreviewUrl = null;
	let pendingPasteFile = null;
	let pendingUploadFile = null;

	function revokeObjectUrl() {
		if (currentObjectUrl) {
			URL.revokeObjectURL(currentObjectUrl);
			currentObjectUrl = null;
		}
	}

	function closeModal() {
		modalOverlay.classList.remove('open');
		// Don’t show method buttons here — they would flash before overlay fades. openModal() shows them.
		pastePanel.hidden = true;
		linkPanel.hidden = true;
		uploadPanel.hidden = true;
		pasteAttachBtn.disabled = true;
		linkAttachBtn.disabled = true;
		uploadAttachBtn.disabled = true;
		urlInput.value = '';
		fileInput.value = '';
		pendingPasteFile = null;
		pendingUploadFile = null;
		if (pastePreviewUrl) {
			URL.revokeObjectURL(pastePreviewUrl);
			pastePreviewUrl = null;
		}
		pasteReady.hidden = true;
		pasteZone.hidden = false;
		uploadReady.hidden = true;
	}

	function openModal() {
		modalOverlay.classList.add('open');
		methodButtons.hidden = false;
		pastePanel.hidden = true;
		linkPanel.hidden = true;
		uploadPanel.hidden = true;
		setError('');
	}

	function setValue(url) {
		revokeObjectUrl();
		const v = (url || '').trim();
		hiddenInput.value = v;
		urlInput.value = v;
		onValueChange(fieldKey, v);
		if (v) {
			thumbPlaceholder.hidden = true;
			thumbContainer.hidden = false;
			setThumbSrc(v);
		} else {
			thumbPlaceholder.hidden = false;
			thumbContainer.hidden = true;
			thumbImg.removeAttribute('src');
		}
	}

	function setFile(file) {
		if (!file || !(file instanceof File)) return;
		revokeObjectUrl();
		hiddenInput.value = '';
		urlInput.value = '';
		onValueChange(fieldKey, file);
		thumbPlaceholder.hidden = true;
		thumbContainer.hidden = false;
		currentObjectUrl = URL.createObjectURL(file);
		setThumbSrc(currentObjectUrl);
		setError('');
	}

	function setThumbSrc(src) {
		if (!src) return;
		thumbWrap.classList.add('loading');
		thumbWrap.classList.remove('loaded', 'error');
		thumbImg.style.opacity = '0';
		thumbImg.onload = () => {
			thumbWrap.classList.remove('loading');
			thumbWrap.classList.add('loaded');
			thumbImg.style.opacity = '';
		};
		thumbImg.onerror = () => {
			thumbWrap.classList.remove('loading');
			thumbWrap.classList.add('loaded', 'error');
			thumbImg.style.opacity = '';
		};
		thumbImg.src = src;
		thumbImg.loading = 'lazy';
		thumbImg.decoding = 'async';
	}

	function clearValue() {
		revokeObjectUrl();
		hiddenInput.value = '';
		urlInput.value = '';
		thumbPlaceholder.hidden = false;
		thumbContainer.hidden = true;
		thumbImg.removeAttribute('src');
		fileInput.value = '';
		setError('');
		onValueChange(fieldKey, '');
	}

	function showPanel(source) {
		methodButtons.hidden = true;
		pastePanel.hidden = source !== values.paste_image;
		linkPanel.hidden = source !== values.paste_link;
		uploadPanel.hidden = source !== values.upload_file;
		pasteAttachBtn.disabled = true;
		linkAttachBtn.disabled = !(urlInput.value || '').trim();
		uploadAttachBtn.disabled = true;
		pendingPasteFile = null;
		pendingUploadFile = null;
		if (pastePreviewUrl) {
			URL.revokeObjectURL(pastePreviewUrl);
			pastePreviewUrl = null;
		}
		pasteReady.hidden = true;
		pasteZone.hidden = false;
		uploadReady.hidden = true;
		if (source === values.paste_link) setTimeout(() => urlInput.focus(), 0);
		if (source === values.paste_image) setTimeout(() => pasteZone.focus(), 0);
	}

	thumbPlaceholder.addEventListener('click', () => openModal());
	removeBtn.addEventListener('click', () => clearValue());

	function handleEscape(e) {
		if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
			closeModal();
			e.preventDefault();
		}
	}
	modalClose.addEventListener('click', () => closeModal());
	modalOverlay.addEventListener('click', (e) => {
		if (e.target === modalOverlay) closeModal();
	});
	modal.addEventListener('click', (e) => e.stopPropagation());
	document.addEventListener('keydown', handleEscape);

	btnPasteImage.addEventListener('click', () => showPanel(values.paste_image));
	btnPasteLink.addEventListener('click', () => showPanel(values.paste_link));
	btnUploadFile.addEventListener('click', () => showPanel(values.upload_file));

	pasteZone.addEventListener('paste', (e) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) {
					pendingPasteFile = file;
					if (pastePreviewUrl) URL.revokeObjectURL(pastePreviewUrl);
					pastePreviewUrl = URL.createObjectURL(file);
					pasteReadyThumb.src = pastePreviewUrl;
					pasteReadyText.textContent = `Image ready — ${file.name || 'pasted image'}`;
					pasteReady.hidden = false;
					pasteZone.hidden = true;
					pasteAttachBtn.disabled = false;
					setError('');
				}
				return;
			}
		}
	});
	pasteAttachBtn.addEventListener('click', () => {
		if (pendingPasteFile) {
			setFile(pendingPasteFile);
			closeModal();
		}
	});

	urlInput.addEventListener('input', () => {
		setError('');
		linkAttachBtn.disabled = !(urlInput.value || '').trim();
	});
	urlInput.addEventListener('change', () => {
		linkAttachBtn.disabled = !(urlInput.value || '').trim();
	});
	linkAttachBtn.addEventListener('click', () => {
		const v = (urlInput.value || '').trim();
		if (v) {
			setValue(v);
			closeModal();
		}
	});

	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		if (!file || !file.type.startsWith('image/')) {
			if (file) setError('Please choose an image file.');
			uploadAttachBtn.disabled = true;
			pendingUploadFile = null;
			uploadReady.hidden = true;
			return;
		}
		pendingUploadFile = file;
		uploadReadyText.textContent = `Selected: ${file.name}`;
		uploadReady.hidden = false;
		uploadAttachBtn.disabled = false;
		setError('');
	});
	uploadAttachBtn.addEventListener('click', () => {
		if (pendingUploadFile) {
			setFile(pendingUploadFile);
			closeModal();
		}
	});

	const hasInitial = typeof defaultValue === 'string' && defaultValue.trim().length > 0;
	urlInput.value = typeof defaultValue === 'string' ? defaultValue : '';
	thumbPlaceholder.hidden = !!hasInitial;
	thumbContainer.hidden = !hasInitial;
	onValueChange(fieldKey, defaultValue != null ? defaultValue : (hiddenInput.value || '').trim());

	if (defaultValue && typeof defaultValue === 'string') {
		setThumbSrc(defaultValue);
	}

	return wrapper;
}

/**
 * Open the same "Choose image" modal used by image fields (Paste image / Paste link / Upload file).
 * Call onSelect with the chosen image as string (URL) or File, then closes the modal.
 * @param {{ onSelect: (value: string | File) => void }} options
 */
export function openImagePickerModal({ onSelect }) {
	const modalOverlay = document.createElement('div');
	modalOverlay.className = 'image-picker-modal-overlay';
	modalOverlay.setAttribute('data-image-picker-modal', '');
	const modal = document.createElement('div');
	modal.className = 'image-picker-modal modal';
	const modalHeader = document.createElement('div');
	modalHeader.className = 'modal-header';
	const modalTitle = document.createElement('h3');
	modalTitle.textContent = 'Choose image';
	const modalClose = document.createElement('button');
	modalClose.type = 'button';
	modalClose.className = 'modal-close';
	modalClose.setAttribute('aria-label', 'Close');
	modalClose.textContent = '×';
	modalHeader.appendChild(modalTitle);
	modalHeader.appendChild(modalClose);
	modal.appendChild(modalHeader);
	const modalBody = document.createElement('div');
	modalBody.className = 'image-picker-modal-body';

	const methodButtons = document.createElement('div');
	methodButtons.className = 'image-picker-methods';
	const btnPasteImage = document.createElement('button');
	btnPasteImage.type = 'button';
	btnPasteImage.className = 'image-picker-method-btn';
	btnPasteImage.textContent = 'Paste image';
	const btnPasteLink = document.createElement('button');
	btnPasteLink.type = 'button';
	btnPasteLink.className = 'image-picker-method-btn';
	btnPasteLink.textContent = 'Paste link';
	const btnUploadFile = document.createElement('button');
	btnUploadFile.type = 'button';
	btnUploadFile.className = 'image-picker-method-btn';
	btnUploadFile.textContent = 'Upload file';
	methodButtons.appendChild(btnPasteImage);
	methodButtons.appendChild(btnPasteLink);
	methodButtons.appendChild(btnUploadFile);

	const pastePanel = document.createElement('div');
	pastePanel.className = 'image-picker-panel';
	pastePanel.setAttribute('data-image-picker-panel', 'paste_image');
	pastePanel.hidden = true;
	const pasteZone = document.createElement('div');
	pasteZone.setAttribute('tabindex', '0');
	pasteZone.setAttribute('role', 'button');
	pasteZone.setAttribute('aria-label', 'Paste image here. Focus then Ctrl+V or Cmd+V.');
	pasteZone.className = 'image-picker-paste-zone';
	pasteZone.textContent = 'Paste image here — focus this box, then Ctrl+V (or Cmd+V)';
	const pasteReady = document.createElement('div');
	pasteReady.className = 'image-picker-ready';
	pasteReady.hidden = true;
	const pasteReadyThumb = document.createElement('img');
	pasteReadyThumb.className = 'image-picker-ready-thumb';
	pasteReadyThumb.alt = '';
	const pasteReadyText = document.createElement('span');
	pasteReadyText.className = 'image-picker-ready-text';
	pasteReady.appendChild(pasteReadyThumb);
	pasteReady.appendChild(pasteReadyText);
	const pasteAttachBtn = document.createElement('button');
	pasteAttachBtn.type = 'button';
	pasteAttachBtn.className = 'image-picker-attach-btn';
	pasteAttachBtn.textContent = 'Attach';
	pasteAttachBtn.disabled = true;
	pastePanel.appendChild(pasteZone);
	pastePanel.appendChild(pasteReady);
	pastePanel.appendChild(pasteAttachBtn);

	const linkPanel = document.createElement('div');
	linkPanel.className = 'image-picker-panel';
	linkPanel.setAttribute('data-image-picker-panel', 'paste_link');
	linkPanel.hidden = true;
	const urlInput = document.createElement('input');
	urlInput.type = 'url';
	urlInput.className = 'form-input image-url-input';
	urlInput.placeholder = 'Paste or enter image URL';
	urlInput.setAttribute('data-image-url-input', '');
	const linkAttachBtn = document.createElement('button');
	linkAttachBtn.type = 'button';
	linkAttachBtn.className = 'image-picker-attach-btn';
	linkAttachBtn.textContent = 'Attach';
	linkAttachBtn.disabled = true;
	linkPanel.appendChild(urlInput);
	linkPanel.appendChild(linkAttachBtn);

	const uploadPanel = document.createElement('div');
	uploadPanel.className = 'image-picker-panel';
	uploadPanel.setAttribute('data-image-picker-panel', 'upload_file');
	uploadPanel.hidden = true;
	const chooseLabel = document.createElement('label');
	chooseLabel.className = 'image-choose-label';
	const chooseSpan = document.createElement('span');
	chooseSpan.className = 'image-choose-btn';
	chooseSpan.textContent = 'Choose file';
	const fileInput = document.createElement('input');
	fileInput.type = 'file';
	fileInput.className = 'image-file-input';
	fileInput.accept = 'image/*';
	fileInput.hidden = true;
	chooseLabel.appendChild(chooseSpan);
	chooseLabel.appendChild(fileInput);
	const uploadReady = document.createElement('div');
	uploadReady.className = 'image-picker-ready';
	uploadReady.hidden = true;
	const uploadReadyText = document.createElement('span');
	uploadReadyText.className = 'image-picker-ready-text';
	uploadReady.appendChild(uploadReadyText);
	const uploadAttachBtn = document.createElement('button');
	uploadAttachBtn.type = 'button';
	uploadAttachBtn.className = 'image-picker-attach-btn';
	uploadAttachBtn.textContent = 'Attach';
	uploadAttachBtn.disabled = true;
	uploadPanel.appendChild(chooseLabel);
	uploadPanel.appendChild(uploadReady);
	uploadPanel.appendChild(uploadAttachBtn);

	const modalError = document.createElement('p');
	modalError.className = 'image-field-error image-picker-modal-error';
	modalError.setAttribute('role', 'alert');
	modalError.hidden = true;
	modalBody.appendChild(methodButtons);
	modalBody.appendChild(pastePanel);
	modalBody.appendChild(linkPanel);
	modalBody.appendChild(uploadPanel);
	modalBody.appendChild(modalError);
	modal.appendChild(modalBody);
	modalOverlay.appendChild(modal);
	document.body.appendChild(modalOverlay);

	let pastePreviewUrl = null;
	let pendingPasteFile = null;
	let pendingUploadFile = null;

	function revokePastePreview() {
		if (pastePreviewUrl) {
			URL.revokeObjectURL(pastePreviewUrl);
			pastePreviewUrl = null;
		}
	}

	function closeModal() {
		modalOverlay.classList.remove('open');
		methodButtons.hidden = false;
		pastePanel.hidden = true;
		linkPanel.hidden = true;
		uploadPanel.hidden = true;
		pasteAttachBtn.disabled = true;
		linkAttachBtn.disabled = true;
		uploadAttachBtn.disabled = true;
		urlInput.value = '';
		fileInput.value = '';
		pendingPasteFile = null;
		pendingUploadFile = null;
		revokePastePreview();
		pasteReady.hidden = true;
		pasteZone.hidden = false;
		uploadReady.hidden = true;
		modalError.textContent = '';
		modalError.hidden = true;
		document.removeEventListener('keydown', handleEscape);
		modalOverlay.remove();
	}

	function showPanel(source) {
		methodButtons.hidden = true;
		pastePanel.hidden = source !== 'paste_image';
		linkPanel.hidden = source !== 'paste_link';
		uploadPanel.hidden = source !== 'upload_file';
		pasteAttachBtn.disabled = true;
		linkAttachBtn.disabled = !(urlInput.value || '').trim();
		uploadAttachBtn.disabled = true;
		pendingPasteFile = null;
		pendingUploadFile = null;
		revokePastePreview();
		pasteReady.hidden = true;
		pasteZone.hidden = false;
		uploadReady.hidden = true;
		if (source === 'paste_link') setTimeout(() => urlInput.focus(), 0);
		if (source === 'paste_image') setTimeout(() => pasteZone.focus(), 0);
	}

	function handleEscape(e) {
		if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
			closeModal();
			e.preventDefault();
		}
	}

	modalOverlay.classList.add('open');
	document.addEventListener('keydown', handleEscape);

	modalClose.addEventListener('click', () => closeModal());
	modalOverlay.addEventListener('click', (e) => {
		if (e.target === modalOverlay) closeModal();
	});
	modal.addEventListener('click', (e) => e.stopPropagation());

	btnPasteImage.addEventListener('click', () => showPanel('paste_image'));
	btnPasteLink.addEventListener('click', () => showPanel('paste_link'));
	btnUploadFile.addEventListener('click', () => showPanel('upload_file'));

	pasteZone.addEventListener('paste', (e) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) {
					pendingPasteFile = file;
					if (pastePreviewUrl) URL.revokeObjectURL(pastePreviewUrl);
					pastePreviewUrl = URL.createObjectURL(file);
					pasteReadyThumb.src = pastePreviewUrl;
					pasteReadyText.textContent = `Image ready — ${file.name || 'pasted image'}`;
					pasteReady.hidden = false;
					pasteZone.hidden = true;
					pasteAttachBtn.disabled = false;
					modalError.hidden = true;
				}
				return;
			}
		}
	});
	pasteAttachBtn.addEventListener('click', () => {
		if (pendingPasteFile) {
			onSelect(pendingPasteFile);
			closeModal();
		}
	});

	urlInput.addEventListener('input', () => {
		linkAttachBtn.disabled = !(urlInput.value || '').trim();
		modalError.hidden = true;
	});
	urlInput.addEventListener('change', () => {
		linkAttachBtn.disabled = !(urlInput.value || '').trim();
	});
	linkAttachBtn.addEventListener('click', () => {
		const v = (urlInput.value || '').trim();
		if (v) {
			onSelect(v);
			closeModal();
		}
	});

	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		if (!file || !file.type.startsWith('image/')) {
			if (file) {
				modalError.textContent = 'Please choose an image file.';
				modalError.hidden = false;
			}
			uploadAttachBtn.disabled = true;
			pendingUploadFile = null;
			uploadReady.hidden = true;
			return;
		}
		pendingUploadFile = file;
		uploadReadyText.textContent = `Selected: ${file.name}`;
		uploadReady.hidden = false;
		uploadAttachBtn.disabled = false;
		modalError.hidden = true;
	});
	uploadAttachBtn.addEventListener('click', () => {
		if (pendingUploadFile) {
			onSelect(pendingUploadFile);
			closeModal();
		}
	});
}

// --- Handler resolution ---

const FIELD_HANDLERS = {
	color: createColorField,
	textarea: createTextareaField,
	text: createTextField,
	select: createSelectField,
	boolean: createBooleanField,
	image: createImageField
};

/**
 * Returns the handler key for a given field (e.g. 'color', 'textarea', 'text', 'select', 'boolean').
 * Used to look up the handler in FIELD_HANDLERS.
 */
export function isImageUrlField(fieldKey) {
	return String(fieldKey || '').toLowerCase() === 'image_url';
}

export function getFieldType(fieldKey, field) {
	if (field?.type === 'color') return 'color';
	if (field?.type === 'select') return 'select';
	if (field?.type === 'boolean') return 'boolean';
	if (isImageUrlField(fieldKey)) return 'image';
	if (isMultilineField(fieldKey, field)) return 'textarea';
	return 'text';
}

/**
 * Create an input/textarea for a single field from provider config.
 * Uses the appropriate handler for the field type.
 *
 * @param {string} fieldKey - Field key from config
 * @param {object} field - Field config { type, label, required, rows?, default?, options? (for select) }
 * @param {object} context - { inputClassName, fieldIdPrefix, onValueChange, selectClassName? }
 * @returns {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement}
 */
export function createFieldInput(fieldKey, field, context) {
	const type = getFieldType(fieldKey, field);
	const handler = FIELD_HANDLERS[type] || FIELD_HANDLERS.text;
	return handler(fieldKey, field, context);
}

// --- Main render ---

const DEFAULTS = {
	inputClassName: 'form-input',
	labelClassName: 'form-label',
	requiredClassName: 'field-required',
	fieldIdPrefix: 'field-',
	selectClassName: 'form-select'
};

/**
 * Render form fields from a provider method's fields config into a container.
 * Each field type is handled by a dedicated handler (color, textarea, text, select, boolean).
 *
 * @param {HTMLElement} container - Element to append form-group divs into (e.g. data-fields-container)
 * @param {object} fields - Method fields config, e.g. method.fields from server_config
 * @param {object} options - Optional overrides
 * @param {function(string, string): void} options.onFieldChange - Called (fieldKey, value) when any field changes and once per field with initial value
 * @param {string} [options.inputClassName] - Class for inputs
 * @param {string} [options.selectClassName] - Class for select elements (default 'form-select')
 * @param {string} [options.labelClassName] - Class for labels
 * @param {string} [options.requiredClassName] - Class for required asterisk span
 * @param {string} [options.fieldIdPrefix] - Prefix for input id/for (default 'field-')
 */
export function renderFields(container, fields, options = {}) {
	if (!container || !fields || typeof fields !== 'object') return;

	const opts = { ...DEFAULTS, ...options };
	const fieldKeys = Object.keys(fields);
	if (fieldKeys.length === 0) return;

	container.innerHTML = '';

	fieldKeys.forEach((fieldKey) => {
		const field = fields[fieldKey];
		const fieldGroup = document.createElement('div');
		const type = getFieldType(fieldKey, field);
		fieldGroup.className = type === 'boolean' ? 'form-group form-group-checkbox' : 'form-group';

		const label = createLabel(fieldKey, type === 'image' ? { ...field, label: 'Image' } : field, {
			labelClassName: opts.labelClassName,
			requiredClassName: opts.requiredClassName,
			fieldIdPrefix: opts.fieldIdPrefix
		});
		const input = createFieldInput(fieldKey, field, {
			inputClassName: opts.inputClassName,
			selectClassName: opts.selectClassName,
			fieldIdPrefix: opts.fieldIdPrefix,
			onValueChange: opts.onFieldChange
		});

		fieldGroup.appendChild(label);
		fieldGroup.appendChild(input);
		container.appendChild(fieldGroup);
	});
}
