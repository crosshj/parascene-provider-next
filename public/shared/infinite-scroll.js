/**
 * Shared infinite-scroll / auto-load behavior.
 * Inserts a sentinel after the list container and uses IntersectionObserver
 * to call onLoadMore when the user scrolls near the bottom.
 *
 * @example
 * const scroll = createInfiniteScroll({
 *   listContainer: document.querySelector('[data-list]'),
 *   onLoadMore: async () => {
 *     const { items, has_more } = await fetchPage(offset);
 *     appendItems(items);
 *     return { hasMore: has_more };
 *   },
 *   rootMargin: '400px 0px'
 * });
 * // later: scroll.destroy();
 */

const DEFAULT_ROOT_MARGIN = '800px 0px';
const DEFAULT_THRESHOLD = 0;

/**
 * @param {{
 *   listContainer: HTMLElement;
 *   onLoadMore: () => Promise<{ hasMore: boolean }>;
 *   rootMargin?: string;
 *   threshold?: number;
 *   sentinelClassName?: string;
 * }} options
 * @returns {{ destroy: () => void; setHasMore: (value: boolean) => void }}
 */
export function createInfiniteScroll(options) {
	const {
		listContainer,
		onLoadMore,
		rootMargin = DEFAULT_ROOT_MARGIN,
		threshold = DEFAULT_THRESHOLD,
		sentinelClassName = 'infinite-scroll-sentinel'
	} = options;

	if (!listContainer || typeof onLoadMore !== 'function') {
		return {
			destroy() {},
			setHasMore() {}
		};
	}

	let hasMore = true;
	let isLoading = false;
	let observer = null;
	let sentinel = null;

	const sentinelEl = document.createElement('div');
	sentinelEl.className = sentinelClassName;
	sentinelEl.setAttribute('aria-hidden', 'true');
	sentinelEl.style.height = '1px';
	sentinelEl.style.margin = '0';
	sentinelEl.style.padding = '0';
	sentinelEl.style.overflow = 'hidden';
	listContainer.after(sentinelEl);
	sentinel = sentinelEl;

	function setHasMore(value) {
		hasMore = Boolean(value);
	}

	observer = new IntersectionObserver(
		(entries) => {
			const entry = entries[0];
			if (!entry?.isIntersecting) return;
			if (!hasMore || isLoading) return;

			isLoading = true;
			Promise.resolve(onLoadMore())
				.then((result) => {
					if (result && typeof result.hasMore === 'boolean') {
						hasMore = result.hasMore;
					}
				})
				.catch(() => {})
				.finally(() => {
					isLoading = false;
				});
		},
		{ root: null, rootMargin, threshold }
	);

	observer.observe(sentinel);

	return {
		destroy() {
			if (observer && sentinel) {
				observer.disconnect();
				observer = null;
			}
			if (sentinel?.parentNode) {
				sentinel.parentNode.removeChild(sentinel);
			}
			sentinel = null;
		},
		setHasMore
	};
}
