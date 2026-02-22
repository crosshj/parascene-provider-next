import { fetchJsonWithStatusDeduped } from '../shared/api.js';
import { genProfile, toMentionText } from '../shared/characterGenerator.js';

const TRY_POLL_MS = 2000;
const TRY_MAX_POLLS = 120;
const WELCOME_TRY_SERVER_ID = 1;
const WELCOME_TRY_METHOD = 'fluxImageKlein';

function $(sel) {
	return document.querySelector(sel);
}

function showError(message) {
	const box = $('[data-error]');
	if (!box) return;
	const text = String(message || '').trim() || 'Something went wrong.';
	box.textContent = text;
	box.hidden = false;
}

function hideError() {
	const box = $('[data-error]');
	if (!box) return;
	box.textContent = '';
	box.hidden = true;
}

function showSuggestion(suggested) {
	const el = document.querySelector('[data-suggestion]');
	if (!el) return;
	const value = typeof suggested === 'string' ? suggested.trim() : '';
	if (!value) {
		el.textContent = '';
		el.hidden = true;
		return;
	}
	el.innerHTML = `Suggestion: <strong>@${value}</strong>`;
	el.hidden = false;
}

function hideSuggestion() {
	const el = document.querySelector('[data-suggestion]');
	if (!el) return;
	el.textContent = '';
	el.hidden = true;
}

function normalizeUsername(input) {
	const raw = typeof input === 'string' ? input.trim() : '';
	if (!raw) return null;
	const normalized = raw.toLowerCase();
	if (!/^[a-z0-9][a-z0-9_]{2,23}$/.test(normalized)) return null;
	return normalized;
}

function suggestUsernameFromEmail(email) {
	const rawEmail = typeof email === 'string' ? email.trim() : '';
	if (!rawEmail) return null;

	const localPart = rawEmail.includes('@') ? rawEmail.split('@')[0] : rawEmail;
	if (!localPart) return null;

	let candidate = localPart.toLowerCase();
	candidate = candidate.replace(/[^a-z0-9_]+/g, '_');
	candidate = candidate.replace(/_+/g, '_');

	// Must start with [a-z0-9]
	candidate = candidate.replace(/^[^a-z0-9]+/g, '');
	// Keep within allowed max (24)
	candidate = candidate.slice(0, 24);
	// Ensure min length (3) without changing the "feel" too much
	if (candidate.length > 0 && candidate.length < 3) {
		candidate = (candidate + '_user').slice(0, 24);
	}

	return normalizeUsername(candidate);
}

async function loadProfile() {
	return await fetchJsonWithStatusDeduped('/api/profile', { credentials: 'include' }, { windowMs: 0 });
}

function isWelcomeTestMode() {
	return getWelcomeTestEmail() !== null;
}

function getWelcomeTestEmail() {
	try {
		const params = new URLSearchParams(window.location.search || '');
		const testEmail = String(params.get('testEmail') || '').trim();
		if (testEmail.length > 0) return testEmail;
		const raw = String(params.get('test') || '').trim().toLowerCase();
		if (raw === '1' || raw === 'true' || raw === 'yes') return 'test@example.com';
		return null;
	} catch {
		return null;
	}
}

async function ensureNeedsWelcome() {
	const testEmail = getWelcomeTestEmail();
	const testMode = testEmail !== null;
	const result = await loadProfile().catch(() => ({ ok: false, status: 0, data: null }));
	if (!result.ok) {
		if (result.status === 401) {
			if (testMode) {
				return { email: testEmail, welcome: { required: true } };
			}
			window.location.href = '/auth.html';
			return null;
		}
		if (testMode) {
			showError('Test mode: using mock welcome profile because /api/profile is unavailable.');
			return { email: testEmail, welcome: { required: true } };
		}
		showError('Unable to load your account. Please refresh and try again.');
		return null;
	}

	const welcome = result.data?.welcome || null;
	if (welcome && welcome.required === false && !testMode) {
		window.location.href = '/';
		return null;
	}

	return result.data;
}

async function submitWelcomeProfile({ displayName, userName, characterDescription, avatarUrl, avatarPrompt, welcomeComplete = false }) {
	return await fetchJsonWithStatusDeduped('/api/profile', {
		method: 'PUT',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			display_name: typeof displayName === 'string' ? displayName.trim() || null : null,
			user_name: userName,
			character_description: characterDescription,
			avatar_url: avatarUrl,
			avatar_prompt: typeof avatarPrompt === 'string' ? avatarPrompt.trim() || null : null,
			welcome_complete: welcomeComplete === true
		})
	}, { windowMs: 0 });
}

async function fetchSuggestedUsername(userName) {
	const params = new URLSearchParams({ user_name: userName });
	return await fetchJsonWithStatusDeduped(`/api/username-suggest?${params.toString()}`, { credentials: 'include' }, { windowMs: 0 });
}

function setAvatarPreview(url) {
	const wrap = $('[data-avatar-preview-wrap]');
	const placeholder = $('[data-avatar-placeholder]');
	const img = $('[data-avatar-preview]');
	if (!wrap || !(img instanceof HTMLImageElement)) return;
	const value = typeof url === 'string' ? url.trim() : '';
	if (!value) {
		img.removeAttribute('src');
		img.hidden = true;
		if (placeholder instanceof HTMLElement) placeholder.hidden = false;
		return;
	}
	img.src = value;
	img.hidden = false;
	if (placeholder instanceof HTMLElement) placeholder.hidden = true;
}

async function ensureTryIdentityCookie() {
	const tz = typeof Intl !== 'undefined' && Intl.DateTimeFormat
		? (Intl.DateTimeFormat().resolvedOptions()?.timeZone || '')
		: '';
	const screenHint = typeof window.screen !== 'undefined'
		? `${window.screen.width}x${window.screen.height}`
		: '';
	await fetch('/api/policy/seen', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ tz, screen: screenHint })
	}).catch(() => null);
}

function buildAvatarPrompt(description, variationKey) {
	const core = typeof description === 'string' ? description.trim() : '';
	return [
		`Portrait of ${core}. Avoid showing body, focus on face and head.`,
		`Head-and-shoulders framing, square composition.`,
		`Clean, plain and simple background colorful and contrasting with subject.`,
		`Expressive eyes, clear facial details, emotive head position.`,
		`Stylized digital portrait suitable for a social profile photo.`,
		`No text, no logo, no watermark, no frame. Variation hint: ${variationKey}.`
	].join('\n');
}

async function createTryImage(prompt) {
	const response = await fetch('/api/try/create', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({
			server_id: WELCOME_TRY_SERVER_ID,
			method: WELCOME_TRY_METHOD,
			args: { prompt, resolution: 'ai_latest' }
		})
	});
	const data = await response.json().catch(() => ({}));
	return { ok: response.ok, status: response.status, data };
}

async function pollTryImageById(id) {
	for (let i = 0; i < TRY_MAX_POLLS; i++) {
		await new Promise((resolve) => setTimeout(resolve, TRY_POLL_MS));
		const listRes = await fetch('/api/try/list', { credentials: 'include' }).catch(() => null);
		if (!listRes || !listRes.ok) continue;
		const list = await listRes.json().catch(() => []);
		const item = Array.isArray(list) ? list.find((entry) => Number(entry?.id) === Number(id)) : null;
		if (!item) continue;
		if (item.status === 'completed' && typeof item.url === 'string' && item.url.trim()) {
			return { ok: true, url: item.url.trim() };
		}
		if (item.status === 'failed') {
			const message = String(item.meta?.error || '').trim() || 'Portrait generation failed.';
			return { ok: false, error: message };
		}
	}
	return { ok: false, error: 'Portrait generation timed out. Try again.' };
}

async function init() {
	const setup = $('[data-welcome-setup]');
	const form = $('[data-form]');
	const displayNameInput = $('[data-display-name]');
	const input = $('[data-username]');
	const characterDescriptionInput = $('[data-character-description]');
	const submit = $('[data-submit]');
	const submitSpinner = $('[data-submit-spinner]');
	const generateAvatarButton = $('[data-generate-avatar]');
	const avatarBtnText = $('[data-avatar-btn-text]');
	const avatarSpinner = $('[data-avatar-spinner]');
	const stepProgress = $('[data-step-progress]');
	const reviewIdentity = $('[data-review-identity]');
	const reviewIdentityName = $('[data-review-identity-name]');
	const reviewIdentityHandle = $('[data-review-identity-handle]');
	const reviewDescription = $('[data-review-description]');
	const reviewAvatarWrap = $('[data-review-avatar-wrap]');
	const reviewAvatar = $('[data-review-avatar]');
	const stepItems = Array.from(document.querySelectorAll('[data-step-item]'));
	const stepPanels = Array.from(document.querySelectorAll('[data-step-panel]'));
	const nextButtons = Array.from(document.querySelectorAll('[data-step-next]'));
	const backButtons = Array.from(document.querySelectorAll('[data-step-back]'));
	const availabilityEl = $('[data-username-availability]');
	const testEmail = getWelcomeTestEmail();
	const testMode = isWelcomeTestMode();

	if (
		!(setup instanceof HTMLElement) ||
		!form ||
		!(input instanceof HTMLInputElement) ||
		!(characterDescriptionInput instanceof HTMLTextAreaElement) ||
		!(submit instanceof HTMLButtonElement) ||
		!(generateAvatarButton instanceof HTMLButtonElement) ||
		!(avatarBtnText instanceof HTMLElement) ||
		!(avatarSpinner instanceof HTMLElement) ||
		!(stepProgress instanceof HTMLElement) ||
		!(reviewIdentity instanceof HTMLElement) ||
		!(reviewDescription instanceof HTMLElement) ||
		!(reviewAvatarWrap instanceof HTMLElement) ||
		!(reviewAvatar instanceof HTMLImageElement)
	) {
		return;
	}

	hideError();
	hideSuggestion();
	setAvatarPreview(null);

	let generatedAvatarUrl = '';
	let generatedAvatarForDescription = '';
	let generatedAvatarPrompt = '';
	let isGeneratingAvatar = false;
	let currentStep = 1;
	const TOTAL_STEPS = 4;
	let availabilityDebounceTimer = null;
	let lastAvailabilityCheck = '';
	/** @type {Record<string, { available: boolean, suggested: string }>} */
	const usernameAvailabilityCache = {};

	function showAvailability(state, suggested) {
		if (!(availabilityEl instanceof HTMLElement)) return;
		if (!state) {
			availabilityEl.textContent = '';
			availabilityEl.removeAttribute('data-state');
			availabilityEl.hidden = true;
			return;
		}
		availabilityEl.hidden = false;
		availabilityEl.dataset.state = state;
		if (state === 'loading') {
			availabilityEl.textContent = 'Checking...';
		} else if (state === 'available') {
			availabilityEl.textContent = 'Username available';
		} else {
			const alt = typeof suggested === 'string' && suggested.trim() ? suggested.trim() : '';
			availabilityEl.textContent = alt ? `Username taken. Try @${alt}` : 'Username taken';
		}
	}

	async function updateUsernameAvailability() {
		const normalized = normalizeUsername(input.value);
		if (!normalized) {
			showAvailability(null);
			return;
		}
		const cached = usernameAvailabilityCache[normalized];
		if (cached) {
			showAvailability(cached.available ? 'available' : 'taken', cached.suggested);
			return;
		}
		lastAvailabilityCheck = normalized;
		showAvailability('loading');
		const res = await fetchSuggestedUsername(normalized).catch(() => ({ ok: false, data: null }));
		if (normalizeUsername(input.value) !== lastAvailabilityCheck) {
			showAvailability(null);
			return;
		}
		if (!res.ok || !res.data) {
			showAvailability(null);
			return;
		}
		const available = res.data.available === true;
		const suggested = typeof res.data.suggested === 'string' ? res.data.suggested.trim() : '';
		usernameAvailabilityCache[normalized] = { available, suggested };
		showAvailability(available ? 'available' : 'taken', suggested);
	}

	function scheduleUsernameAvailabilityCheck() {
		clearTimeout(availabilityDebounceTimer);
		availabilityDebounceTimer = setTimeout(() => { void updateUsernameAvailability(); }, 400);
	}

	function updateGenerateButtonDisabled() {
		if (!(generateAvatarButton instanceof HTMLButtonElement)) return;
		if (isGeneratingAvatar) {
			generateAvatarButton.disabled = true;
			return;
		}
		generateAvatarButton.disabled = !characterDescriptionInput.value.trim();
	}

	function setAvatarGenerateButtonState(loading) {
		if (!(generateAvatarButton instanceof HTMLElement)) return;
		const wrap = $('[data-avatar-preview-wrap]');
		if (wrap instanceof HTMLElement) {
			if (loading) wrap.classList.add('is-loading');
			else wrap.classList.remove('is-loading');
		}
		if (loading) {
			generateAvatarButton.classList.add('is-loading');
			generateAvatarButton.disabled = true;
			generateAvatarButton.setAttribute('aria-busy', 'true');
			if (avatarSpinner instanceof HTMLElement) avatarSpinner.hidden = false;
		} else {
			generateAvatarButton.classList.remove('is-loading');
			generateAvatarButton.removeAttribute('aria-busy');
			if (avatarSpinner instanceof HTMLElement) avatarSpinner.hidden = true;
			if (avatarBtnText instanceof HTMLElement) {
				avatarBtnText.textContent = generatedAvatarUrl ? 'Try Again' : 'Generate portrait';
			}
			updateGenerateButtonDisabled();
		}
	}

	function clearGeneratedAvatar() {
		generatedAvatarUrl = '';
		generatedAvatarForDescription = '';
		generatedAvatarPrompt = '';
		setAvatarPreview(null);
		setAvatarGenerateButtonState(false);
		updateStepCTADisabled();
	}

	function updateReview() {
		const displayName = displayNameInput instanceof HTMLInputElement ? displayNameInput.value.trim() : '';
		const normalized = normalizeUsername(input.value);
		// When no display name, treat username as the display name: show "new2 @new2"
		const effectiveName = displayName || (normalized || 'Not set');
		const showHandle = Boolean(normalized);
		if (reviewIdentityName instanceof HTMLElement) {
			reviewIdentityName.textContent = effectiveName + (showHandle ? ' ' : '');
		}
		if (reviewIdentityHandle instanceof HTMLElement) {
			reviewIdentityHandle.textContent = showHandle ? `@${normalized}` : '';
		}
		const description = characterDescriptionInput.value.trim();
		reviewDescription.textContent = description || 'Not set';
		if (generatedAvatarUrl) {
			reviewAvatar.src = generatedAvatarUrl;
			reviewAvatarWrap.hidden = false;
		} else {
			reviewAvatar.removeAttribute('src');
			reviewAvatarWrap.hidden = true;
		}
	}

	function renderStep() {
		const pct = (Number(currentStep) / Number(TOTAL_STEPS)) * 100;
		stepProgress.style.width = `${Math.max(0, Math.min(100, pct))}%`;
		for (const item of stepItems) {
			const value = Number(item.getAttribute('data-step-item'));
			if (!Number.isFinite(value)) continue;
			if (value < currentStep) {
				item.dataset.state = 'done';
			} else if (value === currentStep) {
				item.dataset.state = 'active';
			} else {
				item.dataset.state = 'pending';
			}
		}
		for (const panel of stepPanels) {
			const value = Number(panel.getAttribute('data-step-panel'));
			panel.hidden = value !== currentStep;
		}
		if (currentStep === 4) {
			updateReview();
		}
		updateStepCTADisabled();
	}

	function setStep(step) {
		const next = Number(step);
		if (!Number.isFinite(next)) return;
		currentStep = Math.max(1, Math.min(TOTAL_STEPS, next));
		renderStep();
		if (currentStep === 2) {
			void updateUsernameAvailability();
			try { input.focus(); } catch { /* ignore */ }
		}
		if (currentStep === 3) {
			try { characterDescriptionInput.focus(); } catch { /* ignore */ }
		}
	}

	function step2Valid() {
		return Boolean(normalizeUsername(input.value));
	}

	function step3Valid() {
		const characterDescription = characterDescriptionInput.value.trim();
		if (characterDescription.length < 12) return false;
		if (!generatedAvatarUrl) return false;
		if (generatedAvatarForDescription && generatedAvatarForDescription !== characterDescription) return false;
		return true;
	}

	function updateStepCTADisabled() {
		const step2Next = nextButtons.find((b) => Number(b.getAttribute('data-step-next')) === 2);
		const step3Next = nextButtons.find((b) => Number(b.getAttribute('data-step-next')) === 3);
		if (step2Next instanceof HTMLButtonElement) step2Next.disabled = !step2Valid();
		if (step3Next instanceof HTMLButtonElement) step3Next.disabled = !step3Valid();
		if (submit instanceof HTMLButtonElement) submit.disabled = !step2Valid() || !step3Valid();
	}

	function validateStepOne() {
		if (!step2Valid()) {
			showError('Username must be 3–24 chars, lowercase letters/numbers/underscore, starting with a letter/number.');
			return false;
		}
		return true;
	}

	function validateStepTwo() {
		const characterDescription = characterDescriptionInput.value.trim();
		if (characterDescription.length < 12) {
			showError('Describe your character in a bit more detail (at least 12 characters).');
			return false;
		}
		if (!generatedAvatarUrl) {
			showError('Generate a portrait before continuing.');
			return false;
		}
		if (generatedAvatarForDescription && generatedAvatarForDescription !== characterDescription) {
			showError('Your description changed. Generate a new portrait before continuing.');
			return false;
		}
		return true;
	}

	async function generateAvatar() {
		if (isGeneratingAvatar) return;
		const characterDescription = characterDescriptionInput.value.trim();
		if (!characterDescription) {
			showError('Add a character description before generating your portrait.');
			return;
		}
		hideError();
		isGeneratingAvatar = true;
		setAvatarPreview(null);
		setAvatarGenerateButtonState(true);
		try {
			await ensureTryIdentityCookie();
			const variationKey = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
			const prompt = buildAvatarPrompt(characterDescription, variationKey);
			const created = await createTryImage(prompt);
			if (!created.ok) {
				const message =
					created.status === 400
						? 'Could not start portrait generation. Refresh and try again.'
						: (created.data?.message || created.data?.error || 'Could not start portrait generation.');
				throw new Error(message);
			}
			if (created.data?.status === 'completed' && typeof created.data?.url === 'string' && created.data.url.trim()) {
				generatedAvatarUrl = created.data.url.trim();
				generatedAvatarForDescription = characterDescription;
				generatedAvatarPrompt = prompt;
				setAvatarPreview(generatedAvatarUrl);
				updateStepCTADisabled();
				return;
			}
			const id = created.data?.id;
			if (!id) {
				throw new Error('Portrait generation did not return a job id.');
			}
			const polled = await pollTryImageById(id);
			if (!polled.ok || !polled.url) {
				throw new Error(polled.error || 'Portrait generation failed.');
			}
			generatedAvatarUrl = polled.url;
			generatedAvatarForDescription = characterDescription;
			generatedAvatarPrompt = prompt;
			setAvatarPreview(generatedAvatarUrl);
			updateStepCTADisabled();
		} catch (error) {
			const message = String(error?.message || '').trim() || 'Portrait generation failed.';
			showError(message);
		} finally {
			isGeneratingAvatar = false;
			setAvatarGenerateButtonState(false);
		}
	}

	const user = await ensureNeedsWelcome();
	if (!user) return;

	const existingDisplayName = typeof user?.profile?.display_name === 'string' ? user.profile.display_name.trim() : '';
	if (existingDisplayName && displayNameInput instanceof HTMLInputElement && !displayNameInput.value.trim()) {
		displayNameInput.value = existingDisplayName;
	}

	const existingDescription = typeof user?.profile?.character_description === 'string'
		? user.profile.character_description.trim()
		: '';
	if (existingDescription && !characterDescriptionInput.value.trim()) {
		characterDescriptionInput.value = existingDescription;
	}

	const existingAvatar = typeof user?.profile?.avatar_url === 'string' ? user.profile.avatar_url.trim() : '';
	if (existingAvatar) {
		generatedAvatarUrl = existingAvatar;
		generatedAvatarForDescription = characterDescriptionInput.value.trim();
		setAvatarPreview(existingAvatar);
		setAvatarGenerateButtonState(false);
	}
	updateGenerateButtonDisabled();
	updateStepCTADisabled();

	if (!input.value.trim()) {
		const email = testEmail ?? user?.email ?? user?.user?.email ?? null;
		const suggested = suggestUsernameFromEmail(email);
		if (suggested) {
			input.value = suggested;
			const check = await fetchSuggestedUsername(suggested).catch(() => ({ ok: false, status: 0, data: null }));
			if (check.ok && check.data) {
				const suggestedAlt = typeof check.data.suggested === 'string' ? check.data.suggested.trim() : '';
				const available = check.data.available === true;
				usernameAvailabilityCache[suggested] = { available, suggested: suggestedAlt };
				if (!available && suggestedAlt) {
					input.value = suggestedAlt;
					usernameAvailabilityCache[suggestedAlt] = { available: true, suggested: suggestedAlt };
				}
				showAvailability(available ? 'available' : 'taken', suggestedAlt);
			}
		}
	}
	updateStepCTADisabled();

	input.addEventListener('input', () => {
		scheduleUsernameAvailabilityCheck();
		updateStepCTADisabled();
	});
	input.addEventListener('change', () => updateStepCTADisabled());
	input.addEventListener('blur', () => { void updateUsernameAvailability(); });

	characterDescriptionInput.addEventListener('input', () => {
		const now = characterDescriptionInput.value.trim();
		if (!now) {
			clearGeneratedAvatar();
			updateStepCTADisabled();
			updateGenerateButtonDisabled();
			return;
		}
		if (generatedAvatarForDescription && now !== generatedAvatarForDescription) {
			clearGeneratedAvatar();
		}
		updateStepCTADisabled();
		updateGenerateButtonDisabled();
	});

	for (const button of nextButtons) {
		button.addEventListener('click', () => {
			hideError();
			hideSuggestion();
			const rawStep = Number(button.getAttribute('data-step-next'));
			if (rawStep === 1) {
				setStep(2);
				return;
			}
			if (rawStep === 2) {
				if (!validateStepOne()) return;
				setStep(3);
				return;
			}
			if (rawStep === 3) {
				if (!validateStepTwo()) return;
				setStep(4);
			}
		});
	}

	for (const button of backButtons) {
		button.addEventListener('click', () => {
			hideError();
			hideSuggestion();
			const rawStep = Number(button.getAttribute('data-step-back'));
			if (!Number.isFinite(rawStep)) return;
			setStep(rawStep - 1);
		});
	}

	generateAvatarButton.addEventListener('click', () => {
		void generateAvatar();
	});

	const shuffleCharacterBtn = $('[data-shuffle-character]');
	if (shuffleCharacterBtn) {
		shuffleCharacterBtn.addEventListener('click', () => {
			const seed = Math.random().toString(36) + Date.now().toString(36);
			const p = genProfile(seed, 0);
			characterDescriptionInput.value = toMentionText(p);
			clearGeneratedAvatar();
			updateStepCTADisabled();
			updateGenerateButtonDisabled();
		});
	}

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		hideError();
		hideSuggestion();

		if (!validateStepOne() || !validateStepTwo()) return;
		const normalized = normalizeUsername(input.value);
		const characterDescription = characterDescriptionInput.value.trim();
		const displayName = displayNameInput instanceof HTMLInputElement ? displayNameInput.value.trim() : '';
		if (!normalized) return;

		// Disable form interaction and show submit loading state
		form.classList.add('welcome-form-submitting');
		form.setAttribute('inert', '');
		submit.disabled = true;
		generateAvatarButton.disabled = true;
		submit.classList.add('is-loading');
		submit.setAttribute('aria-busy', 'true');
		if (submitSpinner instanceof HTMLElement) submitSpinner.hidden = false;

		function resetSubmitState() {
			form.classList.remove('welcome-form-submitting');
			form.removeAttribute('inert');
			submit.disabled = false;
			generateAvatarButton.disabled = false;
			submit.classList.remove('is-loading');
			submit.removeAttribute('aria-busy');
			if (submitSpinner instanceof HTMLElement) submitSpinner.hidden = true;
		}

		let didSucceed = false;
		try {
			if (testMode) {
				showError(`Test mode: would save @${normalized} with generated portrait and continue.`);
				resetSubmitState();
				return;
			}
			const result = await submitWelcomeProfile({
				displayName,
				userName: normalized,
				characterDescription,
				avatarUrl: generatedAvatarUrl,
				avatarPrompt: generatedAvatarPrompt,
				welcomeComplete: true
			}).catch(() => ({ ok: false, status: 0, data: null }));
			if (!result.ok) {
				resetSubmitState();
				if (result.status === 409 && String(result.data?.error || '').toLowerCase().includes('taken')) {
					const check = await fetchSuggestedUsername(normalized).catch(() => ({ ok: false, status: 0, data: null }));
					const next = check.ok ? check.data?.suggested : null;
					if (typeof next === 'string' && next && next !== normalized) {
						showError('Try again. That name is already taken.');
						showSuggestion(next);
						try { input.focus(); } catch { /* ignore */ }
						return;
					}
				}
				const message =
					result.data?.message ||
					result.data?.error ||
					(result.status === 409 ? 'That username is unavailable.' : 'Failed to save username.');
				showError(message);
				return;
			}

			// Navigate away without resetting UI (keep spinner, leave page as-is)
			didSucceed = true;
			window.location.href = '/';
		} finally {
			if (!didSucceed) {
				resetSubmitState();
			}
		}
	});

	renderStep();
}

document.addEventListener('DOMContentLoaded', () => {
	void init();
});

