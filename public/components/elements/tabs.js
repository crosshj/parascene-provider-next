const html = String.raw;

function normalizeId(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	return raw.replace(/[^a-z0-9\-_]/gi, '-');
}

function getTabChildren(root) {
	return Array.from(root.children).filter((child) => child?.tagName === 'TAB');
}

class AppTabs extends HTMLElement {
	constructor() {
		super();
		this._uid = `tabs-${Math.random().toString(36).slice(2, 10)}`;
		this._activeId = null;

		this._boundClick = (e) => {
			const target = e.target;
			if (!(target instanceof HTMLElement)) return;
			const button = target.closest('[data-tab-button]');
			if (!(button instanceof HTMLButtonElement)) return;
			const id = normalizeId(button.dataset.tabButton);
			if (!id) return;
			this.setActiveTab(id, { focus: true });
		};

		this._boundKeydown = (e) => {
			const target = e.target;
			if (!(target instanceof HTMLElement)) return;
			const buttons = this._tabButtons || [];
			if (!buttons.length) return;
			if (!(target instanceof HTMLButtonElement)) return;
			if (!target.dataset.tabButton) return;

			const currentIndex = buttons.findIndex((b) => b === target);
			if (currentIndex < 0) return;

			let nextIndex = currentIndex;
			if (e.key === 'ArrowRight') nextIndex = Math.min(buttons.length - 1, currentIndex + 1);
			else if (e.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
			else if (e.key === 'Home') nextIndex = 0;
			else if (e.key === 'End') nextIndex = buttons.length - 1;
			else return;

			e.preventDefault();
			const nextButton = buttons[nextIndex];
			const id = normalizeId(nextButton?.dataset?.tabButton);
			if (!id) return;
			this.setActiveTab(id, { focus: true });
		};
	}

	connectedCallback() {
		this.hydrate();
	}

	disconnectedCallback() {
		this._tabList?.removeEventListener('click', this._boundClick);
		this._tabList?.removeEventListener('keydown', this._boundKeydown);
	}

	hydrate() {
		const tabs = getTabChildren(this);
		if (!tabs.length) return;

		// Remove prior UI (if re-hydrating).
		this.querySelector('[data-app-tabs]')?.remove();

		const tabList = document.createElement('div');
		tabList.className = 'app-tabs';
		tabList.dataset.appTabs = 'true';
		tabList.setAttribute('role', 'tablist');

		const tabButtons = [];
		const normalizedTabs = tabs.map((tab, index) => {
			const rawId = tab.getAttribute('data-id') || tab.dataset.id || `${index + 1}`;
			const id = normalizeId(rawId) || `${index + 1}`;
			const label = String(tab.getAttribute('label') || tab.getAttribute('data-label') || tab.dataset.label || id).trim() || id;
			const isDefault = tab.hasAttribute('default');
			return { tab, id, label, isDefault };
		});

		let nextActive = normalizeId(this.getAttribute('active'));
		if (!nextActive) {
			nextActive = normalizedTabs.find((t) => t.isDefault)?.id || normalizedTabs[0].id;
		}

		normalizedTabs.forEach(({ tab, id, label }) => {
			const buttonId = `${this._uid}-tab-${id}`;
			const panelId = `${this._uid}-panel-${id}`;

			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'app-tabs-button';
			button.dataset.tabButton = id;
			button.id = buttonId;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-controls', panelId);
			button.textContent = label;
			tabList.appendChild(button);
			tabButtons.push(button);

			tab.id = panelId;
			tab.classList.add('app-tabs-panel');
			tab.setAttribute('role', 'tabpanel');
			tab.setAttribute('aria-labelledby', buttonId);
		});

		this.insertBefore(tabList, tabs[0]);
		this._tabList = tabList;
		this._tabButtons = tabButtons;

		this._tabList.addEventListener('click', this._boundClick);
		this._tabList.addEventListener('keydown', this._boundKeydown);

		this.setActiveTab(nextActive, { focus: false });
	}

	setActiveTab(id, { focus = false } = {}) {
		const nextId = normalizeId(id);
		if (!nextId) return;

		const tabs = getTabChildren(this);
		const buttons = this._tabButtons || [];

		let didMatch = false;
		tabs.forEach((panel) => {
			const panelId = normalizeId(panel.getAttribute('data-id') || panel.dataset.id);
			const isActive = panelId === nextId;
			panel.toggleAttribute('hidden', !isActive);
			didMatch = didMatch || isActive;
		});

		buttons.forEach((button) => {
			const buttonId = normalizeId(button.dataset.tabButton);
			const isActive = buttonId === nextId;
			button.classList.toggle('is-active', isActive);
			button.setAttribute('aria-selected', String(isActive));
			button.tabIndex = isActive ? 0 : -1;
			if (focus && isActive) {
				button.focus();
			}
		});

		if (!didMatch && tabs.length) {
			// Fallback to first tab if provided id doesn't exist.
			const fallbackId = normalizeId(tabs[0].getAttribute('data-id') || tabs[0].dataset.id);
			if (fallbackId && fallbackId !== nextId) {
				this.setActiveTab(fallbackId, { focus });
				return;
			}
		}

		this._activeId = nextId;
		this.setAttribute('active', nextId);
		this.dispatchEvent(new CustomEvent('tab-change', { detail: { id: nextId }, bubbles: true }));
	}
}

customElements.define('app-tabs', AppTabs);

