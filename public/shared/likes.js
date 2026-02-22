function getCreationLikeId(creation) {
	if (!creation) return null;

	const id = creation.created_image_id
		?? creation.creation_id
		?? creation.id
		?? creation.image_id
		?? creation.slug;

	if (id === null || id === undefined) return null;
	return String(id);
}

function toSafeInt(value, fallback = 0) {
	const n = Number.parseInt(String(value ?? ''), 10);
	return Number.isFinite(n) ? n : fallback;
}

export function getCreationBaseLikeCount(creation) {
	if (!creation) return 0;

	// Prefer API-like naming, but allow a few variants.
	if (creation.like_count !== undefined && creation.like_count !== null) {
		const full = Math.max(0, toSafeInt(creation.like_count, 0));
		// If API also provides viewer_liked, treat like_count as "full count"
		// and compute a base that excludes the viewer's own like so optimistic
		// toggles work and counts don't double-increment in detail views.
		if (typeof creation.viewer_liked === 'boolean') {
			return Math.max(0, full - (creation.viewer_liked ? 1 : 0));
		}
		return full;
	}

	if (creation.likeCount !== undefined && creation.likeCount !== null) {
		return Math.max(0, toSafeInt(creation.likeCount, 0));
	}

	if (creation.likes !== undefined && creation.likes !== null) {
		return Math.max(0, toSafeInt(creation.likes, 0));
	}

	return 0;
}

// What the UI should show given our local like state.
export function getCreationLikeCount(creation) {
	const base = getCreationBaseLikeCount(creation);
	return base + (isCreationLiked(creation) ? 1 : 0);
}

export function isCreationLiked(creation) {
	if (creation && typeof creation.viewer_liked === 'boolean') {
		return creation.viewer_liked;
	}

	return false;
}

export function setCreationLiked(creation, liked) {
	if (!creation) return false;
	creation.viewer_liked = Boolean(liked);
	return creation.viewer_liked;
}

export function toggleCreationLiked(creation) {
	if (!creation) return false;
	const next = !Boolean(creation.viewer_liked);
	creation.viewer_liked = next;
	return next;
}

export function applyLikeButtonState(buttonEl, liked, animate = false) {
	if (!(buttonEl instanceof HTMLElement)) return;

	buttonEl.setAttribute('aria-pressed', liked ? 'true' : 'false');
	buttonEl.classList.toggle('is-liked', Boolean(liked));

	if (!animate) return;

	// Restart animation even if clicked rapidly.
	buttonEl.classList.remove('is-like-animating');
	// eslint-disable-next-line no-unused-expressions
	buttonEl.offsetWidth;
	buttonEl.classList.add('is-like-animating');

	const svg = buttonEl.querySelector('svg');
	if (!(svg instanceof SVGElement)) return;

	svg.addEventListener('animationend', () => {
		buttonEl.classList.remove('is-like-animating');
	}, { once: true });
}

function getLikeCountEl(buttonEl) {
	if (!(buttonEl instanceof HTMLElement)) return null;

	const preferred = buttonEl.querySelector('[data-like-count]');
	if (preferred instanceof HTMLElement) return preferred;

	// Back-compat for existing markup (feed uses this class today)
	const fallback = buttonEl.querySelector('.feed-card-action-count');
	if (fallback instanceof HTMLElement) return fallback;

	return null;
}

function setDisplayedLikeCount(buttonEl, creation, likedOverride) {
	const countEl = getLikeCountEl(buttonEl);
	if (!countEl) return;

	const base = getCreationBaseLikeCount(creation);
	const liked = typeof likedOverride === 'boolean'
		? likedOverride
		: isCreationLiked(creation);
	const displayed = Math.max(0, base + (liked ? 1 : 0));
	countEl.textContent = String(displayed);
}

export function initLikeButton(buttonEl, creation) {
	if (!(buttonEl instanceof HTMLElement)) return false;

	const id = getCreationLikeId(creation);
	if (id) buttonEl.dataset.likeId = id;
	buttonEl.dataset.likeButton = 'true';
	buttonEl.dataset.likeBaseCount = String(getCreationBaseLikeCount(creation));
	const liked = isCreationLiked(creation);
	applyLikeButtonState(buttonEl, liked, false);
	setDisplayedLikeCount(buttonEl, creation, liked);
	return liked;
}

const rootsWithListener = new WeakSet();

export function enableLikeButtons(root = document) {
	const target = root instanceof Document ? root : (root instanceof HTMLElement ? root : null);
	if (!target) return;
	if (rootsWithListener.has(target)) return;
	rootsWithListener.add(target);

	target.addEventListener('click', (e) => {
		const el = e.target;
		if (!(el instanceof Element)) return;

		const button = el.closest('button[data-like-button], button[data-like-id]');
		if (!(button instanceof HTMLButtonElement)) return;

		const id = button.dataset.likeId;
		if (!id) return;

		if (button.dataset.likeBusy === '1') return;

		const baseCount = toSafeInt(button.dataset.likeBaseCount, null);
		const baseCreation = { like_count: baseCount !== null ? baseCount : undefined };

		e.preventDefault();
		e.stopPropagation();

		const prev = button.getAttribute('aria-pressed') === 'true';
		const next = !prev;

		// Always recompute from base + local liked state (don’t trust rendered text).
		setDisplayedLikeCount(button, baseCreation, next);
		applyLikeButtonState(button, next, next);

		const imageId = Number.parseInt(id, 10);
		if (!Number.isFinite(imageId) || imageId <= 0) {
			// Not a created-image id; no backend support.
			setDisplayedLikeCount(button, baseCreation, prev);
			applyLikeButtonState(button, prev, false);
			return;
		}

		button.dataset.likeBusy = '1';

		const url = `/api/created-images/${encodeURIComponent(String(imageId))}/like`;
		const method = next ? 'POST' : 'DELETE';

		fetch(url, { method, credentials: 'include' })
			.then(async (res) => {
				if (!res.ok) {
					let detail = '';
					try {
						const json = await res.json();
						detail = json?.error ? `: ${json.error}` : '';
					} catch {
						// ignore
					}
					throw new Error(`Like request failed (${res.status})${detail}`);
				}
				return res.json();
			})
			.then((meta) => {
				const likeCount = Math.max(0, toSafeInt(meta?.like_count, 0));
				const viewerLiked = Boolean(meta?.viewer_liked);
				const newBase = Math.max(0, likeCount - (viewerLiked ? 1 : 0));

				button.dataset.likeBaseCount = String(newBase);
				setDisplayedLikeCount(button, { like_count: newBase }, viewerLiked);
				applyLikeButtonState(button, viewerLiked, false);
			})
			.catch(() => {
				// Revert optimistic state on failure.
				setDisplayedLikeCount(button, baseCreation, prev);
				applyLikeButtonState(button, prev, false);
			})
			.finally(() => {
				delete button.dataset.likeBusy;
			});
	}, { capture: true });
}

