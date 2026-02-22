const html = String.raw;

function normalizeTodoMode(mode) {
	if (mode === 'post') return 'ratio';
	if (mode === 'pre') return 'gated';
	if (mode === 'ratio' || mode === 'impact' || mode === 'cost') return mode;
	return 'gated';
}

function buildTodoDependencyMap(items) {
	const map = new Map();
	for (const item of items || []) {
		const name = String(item?.name || '').trim();
		if (!name) continue;
		const dependsOn = Array.isArray(item?.dependsOn) ? item.dependsOn : [];
		map.set(name, dependsOn.map((dep) => String(dep || '').trim()).filter(Boolean));
	}
	return map;
}

function canReachDependency(from, target, map, visited = new Set()) {
	if (!from || !target) return false;
	if (from === target) return true;
	if (visited.has(from)) return false;
	visited.add(from);
	const deps = map.get(from) || [];
	for (const dep of deps) {
		if (canReachDependency(dep, target, map, visited)) return true;
	}
	return false;
}

function getDialColor(value) {
	const clamped = Math.max(0, Math.min(100, Number(value) || 0));
	let hue;
	if (clamped <= 20) {
		hue = 0;
	} else if (clamped <= 50) {
		const t = (clamped - 20) / 30;
		hue = 0 + t * 30;
	} else {
		const t = (clamped - 50) / 50;
		hue = 30 + t * 90;
	}
	return `hsl(${hue} 70% 50%)`;
}

function applyDialStyles(dial, value) {
	if (!dial) return;
	const dialColor = getDialColor(value);
	const dialPercent = Math.max(0, Math.min(100, Number(value) || 0));
	dial.textContent = value ?? '0';
	dial.style.setProperty('--dial-color', dialColor);
	dial.style.setProperty('--dial-percent', `${dialPercent}%`);
}

class AppModalTodo extends HTMLElement {
	constructor() {
		super();
		this._isOpen = false;
		this._mode = 'readonly';
		this._item = null;
		this._writable = false;
		this._itemsCache = [];
		this._dependsOn = [];

		this._boundEscape = (e) => {
			if (e.key === 'Escape' && this._isOpen) this.close();
		};
		this._boundCloseAllModals = () => this.close();
	}

	connectedCallback() {
		this.setAttribute('data-modal', '');
		this.render();

		this._overlay = this.querySelector('[data-todo-modal]');
		this._title = this.querySelector('[data-todo-modal-title]');
		this._body = this.querySelector('[data-todo-modal-body]');

		this._overlay?.addEventListener('click', (e) => {
			if (e.target?.dataset?.todoClose !== undefined || e.target === this._overlay) {
				this.close();
			}
		});
		document.addEventListener('keydown', this._boundEscape);
		document.addEventListener('close-all-modals', this._boundCloseAllModals);
	}

	disconnectedCallback() {
		document.removeEventListener('keydown', this._boundEscape);
		document.removeEventListener('close-all-modals', this._boundCloseAllModals);
	}

	render() {
		this.innerHTML = html`
			<div class="publish-modal-overlay" data-todo-modal role="dialog" aria-modal="true" aria-labelledby="todo-modal-title">
				<div class="publish-modal" data-todo-modal-container>
					<header class="publish-modal-header todo-modal-header">
						<h3 id="todo-modal-title" class="todo-modal-title" data-todo-modal-title>Todo Item</h3>
						<button type="button" class="publish-modal-close" data-todo-close aria-label="Close">✕</button>
					</header>
					<div class="publish-modal-body" data-todo-modal-body></div>
				</div>
			</div>
		`;
	}

	isAllowedDependency({ itemName, dependencyName }) {
		const name = String(itemName || '').trim();
		const dep = String(dependencyName || '').trim();
		if (!dep) return false;
		if (!name) return true;
		if (dep === name) return false;
		const map = buildTodoDependencyMap(this._itemsCache);
		return !canReachDependency(dep, name, map);
	}

	buildDependencyOptions({ excludeName } = {}) {
		const select = this.querySelector('[data-todo-depends-select]');
		if (!select) return;
		const exclude = String(excludeName || '').trim();
		const currentName = exclude;
		const names = this._itemsCache
			.map((item) => String(item?.name || '').trim())
			.filter((name) => {
				if (!name || name === exclude) return false;
				if (this._dependsOn.includes(name)) return false;
				return this.isAllowedDependency({ itemName: currentName, dependencyName: name });
			})
			.sort((a, b) => a.localeCompare(b));

		select.innerHTML = '';
		const placeholder = document.createElement('option');
		placeholder.value = '';
		placeholder.textContent = names.length ? 'Select an item…' : 'No other items';
		placeholder.disabled = true;
		placeholder.selected = true;
		select.appendChild(placeholder);

		for (const name of names) {
			const option = document.createElement('option');
			option.value = name;
			option.textContent = name;
			select.appendChild(option);
		}
		select.disabled = names.length === 0;
	}

	renderDependsOn() {
		const list = this.querySelector('[data-todo-depends-list]');
		const form = this.querySelector('[data-todo-modal-form]');
		if (!list) return;
		list.innerHTML = '';

		for (const dep of this._dependsOn) {
			const pill = document.createElement('div');
			pill.className = 'todo-depends-pill';
			pill.appendChild(document.createTextNode(dep));

			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'todo-depends-remove';
			remove.dataset.todoDependsRemove = dep;
			remove.setAttribute('aria-label', `Remove dependency ${dep}`);
			remove.textContent = '×';
			pill.appendChild(remove);
			list.appendChild(pill);
		}

		if (form?.elements?.dependsOn) {
			form.elements.dependsOn.value = JSON.stringify(this._dependsOn);
		}
	}

	setDependsOn(next) {
		const seen = new Set();
		const cleaned = (Array.isArray(next) ? next : [])
			.map((d) => String(d || '').trim())
			.filter((d) => d.length > 0 && !seen.has(d) && (seen.add(d), true));

		const form = this.querySelector('[data-todo-modal-form]');
		const currentName = String(form?.elements?.name?.value || '').trim();
		this._dependsOn = cleaned.filter((d) => {
			if (d === currentName) return false;
			return this.isAllowedDependency({ itemName: currentName, dependencyName: d });
		});
		this.renderDependsOn();
		this.buildDependencyOptions({ excludeName: currentName });
	}

	updateSliderValues() {
		const form = this.querySelector('[data-todo-modal-form]');
		if (!form) return;
		const costValue = form.querySelector('[data-slider-value="time"]');
		const impactValue = form.querySelector('[data-slider-value="impact"]');
		if (costValue) costValue.textContent = form.elements.time.value;
		if (impactValue) impactValue.textContent = form.elements.impact.value;
	}

	updateSaveState() {
		const form = this.querySelector('[data-todo-modal-form]');
		if (!form) return;
		const submit = form.querySelector('.todo-modal-submit');
		if (!submit) return;
		const initial = form.dataset.initial ? JSON.parse(form.dataset.initial) : null;
		const current = {
			name: form.elements.name.value,
			description: form.elements.description.value,
			time: String(form.elements.time.value),
			impact: String(form.elements.impact.value),
			dependsOn: form.elements.dependsOn?.value || '[]',
			starred: form.elements.starred && form.elements.starred.checked ? '1' : '0'
		};
		const hasChanges = !initial
			|| initial.name !== current.name
			|| initial.description !== current.description
			|| initial.time !== current.time
			|| initial.impact !== current.impact
			|| initial.dependsOn !== current.dependsOn
			|| initial.starred !== current.starred;
		submit.disabled = !hasChanges;
	}

	open({ mode = 'readonly', item, writable = false, itemsCache = [], priorityMode } = {}) {
		this._itemsCache = Array.isArray(itemsCache) ? itemsCache : [];
		this._writable = Boolean(writable);
		this._mode = mode;
		this._item = item || null;
		const container = this.querySelector('[data-todo-modal-container]');
		if (container) {
			container.classList.toggle('todo-readonly-modal', mode === 'readonly');
		}

		// Populate before show (avoid flashing stale content).
		if (mode === 'readonly') {
			this.renderReadonly(item);
		} else {
			const normalized = mode === 'add' ? 'add' : 'edit';
			const normalizedPriorityMode = normalizeTodoMode(priorityMode);
			this.renderEdit({ mode: normalized, item, priorityMode: normalizedPriorityMode });
		}

		this._overlay?.classList.add('open');
		this._isOpen = true;
	}

	close() {
		if (!this._overlay) return;
		this._overlay.classList.remove('open');
		this._isOpen = false;
		this._mode = 'readonly';
		this._item = null;
		this._dependsOn = [];
	}

	renderReadonly(item) {
		if (this._title) this._title.textContent = 'Todo Item';
		if (!this._body) return;
		const name = String(item?.name || '').trim() || 'Todo item';
		const description = String(item?.description || '').trim() || 'No description provided.';
		const time = item?.time ?? 0;
		const impact = item?.impact ?? 0;

		this._body.innerHTML = html`
			<div class="todo-readonly-body">
				<div class="todo-readonly-title" data-todo-readonly-title></div>
				<div class="todo-readonly-description" data-todo-readonly-description></div>
				<div class="todo-readonly-dials">
					<div class="todo-readonly-dial">
						<div class="todo-card-dial" data-todo-readonly-dial="time"></div>
						<div class="todo-readonly-dial-label">Cost</div>
					</div>
					<div class="todo-readonly-dial">
						<div class="todo-card-dial" data-todo-readonly-dial="impact"></div>
						<div class="todo-readonly-dial-label">Impact</div>
					</div>
				</div>
				<div class="todo-readonly-actions">
					<button type="button" class="todo-readonly-dismiss btn-primary" data-todo-dismiss>Dismiss</button>
				</div>
			</div>
		`;

		const title = this._body.querySelector('[data-todo-readonly-title]');
		const desc = this._body.querySelector('[data-todo-readonly-description]');
		const timeDial = this._body.querySelector('[data-todo-readonly-dial="time"]');
		const impactDial = this._body.querySelector('[data-todo-readonly-dial="impact"]');
		if (title) title.textContent = name;
		if (desc) desc.textContent = description;
		applyDialStyles(timeDial, time);
		applyDialStyles(impactDial, impact);

		this._body.querySelector('[data-todo-dismiss]')?.addEventListener('click', () => this.close());
	}

	renderEdit({ mode, item } = {}) {
		if (this._title) {
			this._title.textContent = mode === 'edit' ? 'Edit Todo Item' : 'Add Todo Item';
		}
		if (!this._body) return;

		// Render form shell first.
		this._body.innerHTML = html`
			<form class="todo-modal-form" data-todo-modal-form>
				<input type="hidden" name="mode" value="${mode === 'edit' ? 'edit' : 'add'}" />
				<input type="hidden" name="originalName" value="${mode === 'edit' ? String(item?.name || '') : ''}" />
				<label>
					Name
					<input type="text" name="name" required />
				</label>
				<label>
					Description
					<textarea name="description" rows="3" required></textarea>
				</label>
				<div class="todo-star-toggle-row">
					<span class="todo-star-toggle-label">Starred</span>
					<label class="form-switch todo-star-switch" role="switch" aria-label="Starred">
						<input type="checkbox" name="starred" class="form-switch-input" aria-hidden="true" tabindex="-1" />
						<span class="form-switch-track"><span class="form-switch-thumb"></span></span>
					</label>
				</div>
				<input type="hidden" name="dependsOn" value="[]" />
				<div class="todo-depends" data-todo-depends>
					<div class="todo-depends-label">Depends on</div>
					<div class="todo-depends-list" data-todo-depends-list></div>
					<div class="todo-depends-controls">
						<select class="todo-depends-select" data-todo-depends-select aria-label="Add dependency"></select>
						<button type="button" class="btn-secondary todo-depends-add" data-todo-depends-add>Add</button>
					</div>
				</div>
				<label class="todo-slider">
					Cost
					<input type="range" name="time" min="1" max="100" required />
					<div class="todo-slider-meta">
						<span>Low</span>
						<span class="todo-slider-value" data-slider-value="time">50</span>
						<span>High</span>
					</div>
				</label>
				<label class="todo-slider">
					Impact
					<input type="range" name="impact" min="1" max="100" required />
					<div class="todo-slider-meta">
						<span>Low</span>
						<span class="todo-slider-value" data-slider-value="impact">50</span>
						<span>High</span>
					</div>
				</label>
				<div class="todo-modal-actions">
					<button type="button" class="todo-modal-delete" data-todo-delete ${mode !== 'edit' ? 'hidden' : ''}>Delete</button>
					<button type="submit" class="todo-modal-submit btn-primary">${mode === 'edit' ? 'Save changes' : 'Save'}</button>
				</div>
			</form>
		`;

		const form = this._body.querySelector('[data-todo-modal-form]');
		if (!form) return;

		// Populate form values before showing it.
		form.reset();
		form.elements.name.value = item?.name || '';
		form.elements.description.value = item?.description || '';
		form.elements.time.value = item?.time || 50;
		form.elements.impact.value = item?.impact || 50;
		if (form.elements.starred) {
			form.elements.starred.checked = Boolean(item?.starred);
		}
		this.setDependsOn(Array.isArray(item?.dependsOn) ? item.dependsOn : []);

		form.dataset.initial = JSON.stringify({
			name: form.elements.name.value,
			description: form.elements.description.value,
			time: String(form.elements.time.value),
			impact: String(form.elements.impact.value),
			dependsOn: form.elements.dependsOn?.value || '[]',
			starred: form.elements.starred && form.elements.starred.checked ? '1' : '0'
		});

		this.updateSliderValues();
		this.updateSaveState();

		// Disable inputs when not writable.
		if (!this._writable) {
			form.querySelectorAll('input, textarea, button, select').forEach((el) => {
				el.disabled = true;
			});
		}

		const addButton = form.querySelector('[data-todo-depends-add]');
		addButton?.addEventListener('click', () => {
			const select = form.querySelector('[data-todo-depends-select]');
			const selected = String(select?.value || '').trim();
			if (!selected) return;
			const currentName = String(form.elements.name.value || '').trim();
			if (selected === currentName) return;
			if (!this.isAllowedDependency({ itemName: currentName, dependencyName: selected })) return;
			if (this._dependsOn.includes(selected)) return;
			this.setDependsOn([...this._dependsOn, selected]);
			this.updateSaveState();
		});

		const dependsList = form.querySelector('[data-todo-depends-list]');
		dependsList?.addEventListener('click', (e) => {
			const target = e.target;
			if (!(target instanceof HTMLElement)) return;
			const dep = target.dataset.todoDependsRemove;
			if (!dep) return;
			this.setDependsOn(this._dependsOn.filter((d) => d !== dep));
			this.updateSaveState();
		});

		form.addEventListener('input', (e) => {
			const target = e.target;
			if (target instanceof HTMLInputElement && (target.name === 'time' || target.name === 'impact')) {
				this.updateSliderValues();
			}
			if (target instanceof HTMLInputElement && target.name === 'name') {
				this.setDependsOn(this._dependsOn);
			}
			this.updateSaveState();
		});
		form.addEventListener('change', () => this.updateSaveState());

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			const submit = form.querySelector('.todo-modal-submit');
			if (submit?.disabled) return;
			await this.saveFromForm(form);
		});

		form.querySelector('[data-todo-delete]')?.addEventListener('click', async () => {
			await this.deleteFromForm(form);
		});
	}

	async saveFromForm(form) {
		const mode = form.elements.mode.value === 'edit' ? 'edit' : 'add';
		const payload = {
			name: form.elements.name.value,
			description: form.elements.description.value,
			time: Number(form.elements.time.value),
			impact: Number(form.elements.impact.value),
			dependsOn: this._dependsOn,
			starred: Boolean(form.elements.starred && form.elements.starred.checked)
		};
		if (mode === 'edit') {
			payload.originalName = form.elements.originalName.value;
		}

		try {
			const response = await fetch('/api/todo', {
				method: mode === 'edit' ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				credentials: 'include'
			});
			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw new Error(error.error || 'Failed to save todo item.');
			}
			this.close();
			document.dispatchEvent(new CustomEvent('todo-updated'));
		} catch (err) {
			alert(err?.message || 'Failed to save todo item.');
		}
	}

	async deleteFromForm(form) {
		const name = String(form.elements.originalName.value || '').trim();
		if (!name) return;
		const confirmed = window.confirm(`Delete \"${name}\"?`);
		if (!confirmed) return;
		try {
			const response = await fetch('/api/todo', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name }),
				credentials: 'include'
			});
			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw new Error(error.error || 'Failed to delete todo item.');
			}
			this.close();
			document.dispatchEvent(new CustomEvent('todo-updated'));
		} catch (err) {
			alert(err?.message || 'Failed to delete todo item.');
		}
	}
}

customElements.define('app-modal-todo', AppModalTodo);

