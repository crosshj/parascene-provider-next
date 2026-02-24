import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import { log } from './utils.js';

const { PIXEL_LAB_API_KEY } = process.env;
const PIXEL_LAB_BASE = 'https://api.pixellab.ai/v1';

const DEFAULT_WIDTH = 64;
const DEFAULT_HEIGHT = 64;
/** Pixflux: min 32×32, max 400×400. Bitforge: max 200×200. */
const PIXFLUX_MAX = 400;
const BITFORGE_MAX = 200;
/** Output size after nearest-neighbor upscale. */
const UPSCALE_SIZE = 1024;
/** Request timeout in ms; fetch is aborted after this. */
const FETCH_TIMEOUT_MS = 90_000;

/** @param {'pixflux'|'bitforge'} model */
function getPixelLabConfig(model) {
	const m = String(model || 'pixflux').toLowerCase();
	if (m === 'bitforge') {
		return { url: `${PIXEL_LAB_BASE}/generate-image-bitforge`, maxSize: BITFORGE_MAX };
	}
	return { url: `${PIXEL_LAB_BASE}/generate-image-pixflux`, maxSize: PIXFLUX_MAX };
}

/** Random 10-digit positive integer for seed. */
function randomSeed() {
	return randomInt(1e9, 1e10);
}

/**
 * Decode base64 from API; may be raw or "data:image/png;base64,...".
 */
function decodeBase64Image(str) {
	const base64 = str.includes(',') ? str.split(',')[1] : str;
	return Buffer.from(base64, 'base64');
}

function getPrompt(prompt) {
	return `PIXEL ART STYLE:\n\n ${prompt}`;
}

/**
 * Call PixelLab API (Pixflux or Bitforge). Uses process.env.PIXEL_LAB_API_KEY.
 * Auth: Bearer token. Response: image.base64, usage.
 *
 * @param {string} prompt - Text description (description in API).
 * @param {object} [options]
 * @param {'pixflux'|'bitforge'} [options.model]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {boolean} [options.no_background]
 * @returns {Promise<{ buffer: Buffer; width: number; height: number; usage?: { usd?: number }; [key: string]: unknown }>}
 */
export async function pixelLab(prompt, options = {}) {
	if (!PIXEL_LAB_API_KEY) throw new Error('PIXEL_LAB_API_KEY missing');

	const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
	if (!trimmed) throw new Error('A prompt string is required');

	const { url, maxSize } = getPixelLabConfig(options.model);
	const model = options.model ? String(options.model).toLowerCase() : 'pixflux';

	let width = Math.round(Number(options.width) || DEFAULT_WIDTH);
	let height = Math.round(Number(options.height) || DEFAULT_HEIGHT);
	width = Math.max(16, Math.min(maxSize, width));
	height = Math.max(16, Math.min(maxSize, height));

	const noBackground = Boolean(options.no_background);

	const payload =
		model === 'bitforge'
			? {
				description: getPrompt(trimmed),
				image_size: { width, height },
				no_background: noBackground,
				style_guidance_scale: Number(options.style_guidance_scale ?? 3) || 3,
				style_strength: Number(options.style_strength ?? 20),
				text_guidance_scale: Number(options.text_guidance_scale ?? 3) || 3,
				seed: randomSeed(),
			}
			: {
				description: getPrompt(trimmed),
				image_size: { width, height },
				seed: randomSeed(),
				no_background: noBackground,
			};

	const startTime = Date.now();
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	let response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${PIXEL_LAB_API_KEY}`,
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeoutId);
	}

	if (!response.ok) {
		const text = await response.text();
		log('PixelLab API error', { status: response.status, body: text.slice(0, 500) });
		throw new Error(`PixelLab API error: ${response.status} ${text.slice(0, 200)}`);
	}

	const data = await response.json();
	const image = data?.image;
	const usage = data?.usage;

	if (!image?.base64) {
		throw new Error('PixelLab response missing image.base64');
	}

	const buffer = decodeBase64Image(image.base64);
	const duration = Date.now() - startTime;

	log('PixelLab ready', {
		model,
		usd: usage?.usd,
		duration_ms: duration,
	});

	return {
		buffer,
		width,
		height,
		usage,
		duration,
	};
}

/**
 * Generate image via PixelLab (Pixflux or Bitforge) with common args.
 * Calls PixelLab with the user-requested size, then nearest-neighbor upscales to 1024×1024.
 *
 * @param {object} [args]
 * @param {string} [args.prompt]
 * @param {string} [args.text]
 * @param {'pixflux'|'bitforge'} [args.model]
 * @param {number} [args.width]
 * @param {number} [args.height]
 * @param {boolean} [args.no_background]
 * @returns {Promise<{ buffer: Buffer; width: number; height: number; prompt: string; color: string; [key: string]: unknown }>}
 */
export async function generatePixelLabImage(args = {}) {
	const prompt = (args.prompt || args.text || '').trim();
	if (!prompt) throw new Error('prompt or text is required');

	const requestedWidth = args.width ?? DEFAULT_WIDTH;
	const requestedHeight = args.height ?? DEFAULT_HEIGHT;

	const result = await pixelLab(prompt, {
		model: args.model,
		width: requestedWidth,
		height: requestedHeight,
		no_background: args.no_background,
		style_guidance_scale: args.style_guidance_scale,
		style_strength: args.style_strength,
		text_guidance_scale: args.text_guidance_scale,
	});

	let buffer = result.buffer;
	let width = result.width;
	let height = result.height;

	if (width !== UPSCALE_SIZE || height !== UPSCALE_SIZE) {
		buffer = await sharp(buffer)
			.resize(UPSCALE_SIZE, UPSCALE_SIZE, { kernel: 'nearest' })
			.png()
			.toBuffer();
		width = UPSCALE_SIZE;
		height = UPSCALE_SIZE;
	}

	return {
		...result,
		buffer,
		prompt,
		color: '#000000',
		width,
		height,
	};
}
