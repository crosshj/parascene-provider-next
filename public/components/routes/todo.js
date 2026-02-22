import { fetchJsonWithStatusDeduped } from '../../shared/api.js';
import { starIcon } from '../../icons/svg-strings.js';

const html = String.raw;

function normalizeTodoMode(mode) {
	if (mode === 'post') return 'ratio';
	if (mode === 'pre') return 'gated';
	if (mode === 'ratio' || mode === 'impact' || mode === 'cost') return mode;
	return 'gated';
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

class AppRouteTodo extends HTMLElement {
	connectedCallback() {
		this._priorityMode = 'gated';
		this._writable = true;
		this._itemsCache = [];

		this.innerHTML = html`
			<div class="todo-header">
				<h3>Todo</h3>
				<div class="todo-mode-toggle" data-todo-mode-toggle role="group" aria-label="Priority mode">
					<button type="button" class="todo-mode-button" data-todo-mode="gated" aria-pressed="true">Gated</button>
					<button type="button" class="todo-mode-button" data-todo-mode="ratio" aria-pressed="false">Ratio</button>
					<button type="button" class="todo-mode-button" data-todo-mode="impact" aria-pressed="false">Impact</button>
					<button type="button" class="todo-mode-button" data-todo-mode="cost" aria-pressed="false">Cost</button>
				</div>
			</div>
			<div class="todo-layout">
				<div class="todo-list" data-todo-list>
					<div class="route-empty route-loading">
						<div class="route-loading-spinner" aria-label="Loading" role="status"></div>
					</div>
				</div>
			</div>
		`;

		this._list = this.querySelector('[data-todo-list]');
		this._toggle = this.querySelector('[data-todo-mode-toggle]');
		this._modeButtons = this._toggle ? Array.from(this._toggle.querySelectorAll('[data-todo-mode]')) : [];

		this._boundUpdated = () => this.loadTodo({ force: true });
		document.addEventListener('todo-updated', this._boundUpdated);

		this.setupModeToggle();
		this.setupListClicks();
		this.loadTodo();
	}

	disconnectedCallback() {
		document.removeEventListener('todo-updated', this._boundUpdated);
	}

	setupModeToggle() {
		if (!this._modeButtons.length) return;
		this.setPriorityMode(this._priorityMode);
		this._modeButtons.forEach((button) => {
			button.addEventListener('click', () => {
				const nextMode = normalizeTodoMode(button.dataset.todoMode);
				if (nextMode === this._priorityMode) return;
				this.setPriorityMode(nextMode);
				this.loadTodo({ force: true });
			});
		});
	}

	setPriorityMode(mode) {
		this._priorityMode = normalizeTodoMode(mode);
		this._modeButtons.forEach((button) => {
			const isActive = button.dataset.todoMode === this._priorityMode;
			button.classList.toggle('is-active', isActive);
			button.setAttribute('aria-pressed', String(isActive));
		});
	}

	setupListClicks() {
		if (!this._list) return;
		this._list.addEventListener('click', (e) => {
			const target = e.target;
			if (!(target instanceof HTMLElement)) return;

			if (target.dataset.todoAdd !== undefined) {
				this.openTodoModal({ mode: 'add' });
				return;
			}

			const row = target.closest('.todo-card');
			if (!row || row.querySelector('.todo-ghost')) return;

			const item = {
				name: row.dataset.itemName,
				description: row.dataset.itemDescription,
				time: row.dataset.itemTime,
				impact: row.dataset.itemImpact,
				dependsOn: JSON.parse(row.dataset.itemDependsOn || '[]'),
				starred: row.dataset.itemStarred === '1'
			};

			if (!this._writable) {
				this.openTodoModal({ mode: 'readonly', item });
				return;
			}

			this.openTodoModal({ mode: 'edit', item });
		});
	}

	openTodoModal({ mode, item } = {}) {
		const modal = document.querySelector('app-modal-todo');
		if (!modal) return;
		modal.open({
			mode,
			item,
			writable: this._writable,
			itemsCache: this._itemsCache,
			priorityMode: this._priorityMode
		});
	}

	renderTodoRows(items, writable) {
		if (!this._list) return;
		this._list.innerHTML = '';

		const sortedItems = [...(items || [])].sort((a, b) => {
			const aStar = Boolean(a.starred);
			const bStar = Boolean(b.starred);
			if (aStar !== bStar) return bStar ? 1 : -1;
			return (b.priority ?? 0) - (a.priority ?? 0);
		});
		if (!sortedItems.length) {
			const empty = document.createElement('div');
			empty.className = 'todo-loading';
			empty.textContent = 'No todo items yet.';
			this._list.appendChild(empty);
			return;
		}

		sortedItems.forEach((item, index) => {
			const row = document.createElement('div');
			row.className = 'todo-card';
			if (index === sortedItems.length - 1) row.classList.add('todo-card-last');
			row.dataset.itemName = item.name;
			row.dataset.itemDescription = item.description || '';
			row.dataset.itemTime = item.time;
			row.dataset.itemImpact = item.impact;
			row.dataset.itemDependsOn = JSON.stringify(Array.isArray(item.dependsOn) ? item.dependsOn : []);
			row.dataset.itemStarred = item.starred ? '1' : '0';

			const card = document.createElement('div');
			card.className = 'todo-card-inner';

			const header = document.createElement('div');
			header.className = 'todo-card-header';

			const star = document.createElement('div');
			star.className = 'todo-card-star';
			if (item.starred) {
				star.classList.add('todo-card-star-active');
			}
			star.setAttribute('aria-hidden', 'true');
			star.innerHTML = starIcon('todo-card-star-icon');

			const text = document.createElement('div');
			text.className = 'todo-card-text';

			const title = document.createElement('div');
			title.className = 'todo-card-title';
			title.textContent = item.name;

			const description = document.createElement('div');
			description.className = 'todo-card-description';
			description.textContent = item.description || '';

			text.appendChild(title);
			text.appendChild(description);

			const dial = document.createElement('div');
			dial.className = 'todo-card-dial';
			applyDialStyles(dial, item.priority);

			header.appendChild(star);
			header.appendChild(text);
			header.appendChild(dial);
			card.appendChild(header);
			row.appendChild(card);
			this._list.appendChild(row);
		});

		if (writable) {
			const ghostRow = document.createElement('div');
			ghostRow.className = 'todo-card todo-card-ghost';
			const ghostButton = document.createElement('button');
			ghostButton.type = 'button';
			ghostButton.className = 'todo-ghost';
			ghostButton.textContent = 'Add new item';
			ghostButton.dataset.todoAdd = 'true';
			ghostRow.appendChild(ghostButton);
			this._list.appendChild(ghostRow);
		}
	}

	async loadTodo({ force = false } = {}) {
		if (!this._list) return;
		try {
			const query = new URLSearchParams({ mode: this._priorityMode });
			const result = await fetchJsonWithStatusDeduped(`/api/todo?${query.toString()}`, { credentials: 'include' }, { windowMs: 2000 });
			if (!result.ok) {
				throw new Error('Failed to load todo.');
			}
			const writable = result.data?.writable !== false;
			this._writable = writable;
			this._itemsCache = Array.isArray(result.data?.items) ? result.data.items : [];
			this.renderTodoRows(this._itemsCache, writable);
		} catch (err) {
			this._list.innerHTML = '';
			const item = document.createElement('div');
			item.className = 'todo-loading';
			item.textContent = 'Error loading todo.';
			this._list.appendChild(item);
		}
	}
}

customElements.define('app-route-todo', AppRouteTodo);

