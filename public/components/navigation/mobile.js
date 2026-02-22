import { homeIcon } from '../../icons/svg-strings.js';

const html = String.raw;

class AppNavigationMobile extends HTMLElement {
	constructor() {
		super();
		this.handleNavClick = this.handleNavClick.bind(this);
		this.handleRouteChange = this.handleRouteChange.bind(this);
	}

	connectedCallback() {
		this.render();
		this.setupEventListeners();
		window.addEventListener('popstate', this.handleRouteChange);
		document.addEventListener('route-change', this.handleRouteChange);
		setTimeout(() => this.handleRouteChange(), 0);
	}

	disconnectedCallback() {
		window.removeEventListener('popstate', this.handleRouteChange);
		document.removeEventListener('route-change', this.handleRouteChange);
	}

	setupEventListeners() {
		const navButtons = this.querySelectorAll('.mobile-bottom-nav-item[data-route]');
		navButtons.forEach(button => {
			button.addEventListener('click', this.handleNavClick);
		});
	}

	handleNavClick(event) {
		event.preventDefault();
		event.stopPropagation();
		const button = event.currentTarget;
		if (button?.disabled) return;
		const route = button?.getAttribute('data-route');
		if (!route) return;

		// Create is a standalone page; full navigation to/from it
		if (route === 'create') {
			window.location.href = '/create';
			return;
		}
		if (window.location.pathname === '/create') {
			window.location.href = `/${route}`;
			return;
		}

		const isServerSentPage = window.location.pathname === '/pricing' ||
			/^\/creations\/\d+(\/(edit|mutat|mutate))?$/.test(window.location.pathname) ||
			window.location.pathname.startsWith('/s/') ||
			(window.location.pathname === '/help' || window.location.pathname.startsWith('/help/')) ||
			window.location.pathname === '/user' ||
			/^\/user\/\d+$/.test(window.location.pathname) ||
			window.location.pathname.startsWith('/p/') ||
			window.location.pathname.startsWith('/t/');
		if (isServerSentPage) {
			window.location.href = `/${route}`;
			return;
		}

		window.history.pushState({ route }, '', `/${route}`);
		const header = document.querySelector('app-navigation');
		if (header && typeof header.handleRouteChange === 'function') {
			header.handleRouteChange();
		} else {
			this.updateContentForRoute(route);
		}
		this.handleRouteChange();
	}

	updateContentForRoute(route) {
		const contentSections = document.querySelectorAll('[data-route-content]');
		contentSections.forEach(section => {
			const isActive = section.getAttribute('data-route-content') === route;
			section.classList.toggle('active', isActive);
			section.style.display = isActive ? 'block' : 'none';
		});
	}

	resetSectionScroll() {
		const scroller = document.scrollingElement || document.documentElement;
		if (!scroller) return;
		scroller.scrollTop = 0;
		if (typeof window.scrollTo === 'function') {
			window.scrollTo(0, 0);
		}
	}

	handleRouteChange() {
		const navButtons = this.querySelectorAll('.mobile-bottom-nav-item[data-route]');
		if (navButtons.length === 0) return;
		const pathname = window.location.pathname;
		const header = document.querySelector('app-navigation');
		const defaultRoute = header?.getAttribute('default-route') || 'feed';
		let currentRoute = pathname === '/' || pathname === '' ? defaultRoute : pathname.slice(1);
		if (pathname.startsWith('/creations/')) {
			currentRoute = null;
		}
		if (pathname.startsWith('/s/')) {
			currentRoute = null;
		}
		if (pathname === '/user' || /^\/user\/\d+$/.test(pathname) || pathname.startsWith('/p/') || pathname.startsWith('/t/')) {
			currentRoute = null;
		}
		if (pathname === '/pricing') {
			currentRoute = null;
		}
		// Create is a standalone page at /create
		const isCreatePage = pathname === '/create';
		navButtons.forEach(button => {
			const route = button.getAttribute('data-route');
			const isActive = Boolean(currentRoute) && route === currentRoute;
			button.classList.toggle('is-active', isActive);
			if (button.classList.contains('create-button')) {
				button.disabled = isCreatePage;
			}
		});
	}

	render() {
		this.innerHTML = html`
      <div class="mobile-bottom-nav-wrap" aria-label="Mobile actions">
        <div class="mobile-bottom-nav-bar" aria-hidden="true"></div>
        <div class="mobile-bottom-nav-buttons" role="navigation" aria-label="Mobile actions">
          <button class="mobile-bottom-nav-item" data-route="feed" aria-label="Home">
			${homeIcon('mobile-bottom-nav-icon mobile-bottom-nav-icon-home')}
            <span class="mobile-bottom-nav-text" aria-hidden="true">Home</span>
          </button>
          <button class="mobile-bottom-nav-item" data-route="explore" aria-label="Explore">
            <svg class="mobile-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Explore</span>
          </button>
		  <button class="mobile-bottom-nav-item create-button" data-route="create" aria-label="Create">
            <span class="create-button-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </span>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Create</span>
          </button>
          <button class="mobile-bottom-nav-item" data-route="creations" aria-label="Creations">
            <svg class="mobile-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2"></rect>
              <circle cx="8" cy="10" r="2"></circle>
              <path d="M21 17l-5-5L5 19"></path>
            </svg>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Creations</span>
          </button>
          <button class="mobile-bottom-nav-item" data-route="connect" aria-label="Connect">
            <svg class="mobile-bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.6" y1="10.5" x2="15.5" y2="6.9"></line>
              <line x1="8.6" y1="13.5" x2="15.5" y2="17.1"></line>
            </svg>
            <span class="mobile-bottom-nav-text" aria-hidden="true">Connect</span>
          </button>
        </div>
      </div>
    `;
	}
}

customElements.define('app-navigation-mobile', AppNavigationMobile);
