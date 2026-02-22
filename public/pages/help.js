// Help page search functionality

document.addEventListener('DOMContentLoaded', () => {
	const searchInput = document.getElementById('help-search');
	const searchResults = document.getElementById('help-search-results');
	const articleContent = document.getElementById('help-article-content');
	
	if (!searchInput) return;
	
	let searchTimeout = null;

	function escapeHtml(text) {
		return String(text || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}
	
	function formatSectionName(section) {
		if (!section) return 'General';
		return section.split('/').map(part => 
			part.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
		).join(' / ');
	}
	
	function renderSearchResults(results, query) {
		if (!searchResults || !articleContent) return;
		
		if (results.length === 0) {
			searchResults.innerHTML = `
				<div class="help-not-found">
					<div class="help-not-found-icon" aria-hidden="true">
						<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10"></circle>
							<line x1="12" y1="8" x2="12" y2="12"></line>
							<line x1="12" y1="16" x2="12.01" y2="16"></line>
						</svg>
					</div>
					<h1>No articles found</h1>
					<p class="help-not-found-message">Nothing matched "${escapeHtml(query)}". Try a different search or browse from the sidebar.</p>
				</div>
			`;
			searchResults.style.display = 'block';
			articleContent.style.display = 'none';
			return;
		}
		
		const resultsHtml = results.map((result, index) => {
			const sectionName = formatSectionName(result.section);
			const divider = index > 0 ? '<div class="help-search-divider"></div>' : '';
			
			return `
				${divider}
				<a href="/help/${result.slug}" class="help-search-result">
					<div class="help-search-result-header">
						<span class="help-search-result-title">${result.title}</span>
						<div class="help-search-result-meta">
							${result.section ? `<span class="help-search-result-section">${sectionName}</span>` : ''}
							<span class="help-search-result-count">${result.count} ${result.count === 1 ? 'match' : 'matches'}</span>
						</div>
					</div>
				</a>
			`;
		}).join('');
		
		searchResults.innerHTML = `
			<div class="help-search-results-header">
				<h2>Search Results</h2>
				<p class="help-search-results-count">Found ${results.length} ${results.length === 1 ? 'article' : 'articles'}</p>
			</div>
			<div class="help-search-results-list">
				${resultsHtml}
			</div>
		`;
		
		searchResults.style.display = 'block';
		articleContent.style.display = 'none';
	}
	
	function clearSearchResults() {
		if (!searchResults || !articleContent) return;
		searchResults.style.display = 'none';
		articleContent.style.display = 'block';
		searchResults.innerHTML = '';
		highlightMatchingDocs([]);
		updateNavActiveState(false);
	}
	
	async function performSearch(query) {
		const trimmedQuery = query.trim();
		
		if (!trimmedQuery) {
			clearSearchResults();
			highlightMatchingDocs([]);
			updateNavActiveState(false);
			return;
		}
		
		updateNavActiveState(true);
		try {
			const response = await fetch(`/api/help/search?q=${encodeURIComponent(trimmedQuery)}`);
			if (!response.ok) {
				throw new Error('Search failed');
			}
			
			const data = await response.json();
			const results = data.results || [];
			renderSearchResults(results, trimmedQuery);
			highlightMatchingDocs(results);
		} catch (error) {
			console.error('Search error:', error);
			if (searchResults) {
				searchResults.innerHTML = `
					<div class="help-search-error">
						<p>Error searching help articles. Please try again.</p>
					</div>
				`;
				searchResults.style.display = 'block';
				articleContent.style.display = 'none';
			}
			highlightMatchingDocs([]);
		}
	}
	
	function highlightMatchingDocs(results) {
		const matchingSlugs = new Set((results || []).map(r => r.slug));
		const navItems = document.querySelectorAll('.help-nav-item');
		navItems.forEach(item => {
			const href = item.getAttribute('href') || '';
			const slug = href.replace(/^\/help\/?/, '').replace(/\/$/, '') || null;
			if (slug && matchingSlugs.has(slug)) {
				item.classList.add('help-nav-item-match');
			} else {
				item.classList.remove('help-nav-item-match');
			}
		});
	}

	function updateNavActiveState(hasSearchQuery) {
		const navItems = document.querySelectorAll('.help-nav-item');
		if (hasSearchQuery) {
			navItems.forEach(item => item.classList.remove('active'));
			return;
		}
		const currentPath = (window.location.pathname || '').replace(/^\/help\/?/, '').replace(/\/$/, '');
		navItems.forEach(item => {
			const href = item.getAttribute('href') || '';
			const slug = href.replace(/^\/help\/?/, '').replace(/\/$/, '');
			item.classList.toggle('active', slug === currentPath);
		});
	}
	
	function handleSearchInput(value) {
		// Debounce search requests
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}
		
		searchTimeout = setTimeout(() => {
			performSearch(value);
		}, 300); // 300ms debounce
	}
	
	searchInput.addEventListener('input', (e) => handleSearchInput(e.target.value));
	
	// Handle initial query param
	const urlParams = new URLSearchParams(window.location.search);
	if (urlParams.get('q')) {
		const q = urlParams.get('q');
		searchInput.value = q;
		performSearch(q);
	}
});
