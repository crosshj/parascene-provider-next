import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import { log } from './utils.js';


const { RETRO_DIFFUSION_API_KEY } = process.env;
const RETRO_DIFFUSION_URL = 'https://api.retrodiffusion.ai/v1/inferences';

const DEFAULT_WIDTH = 256;
const DEFAULT_HEIGHT = 256;
/** Output size after nearest-neighbor upscale. */
const UPSCALE_SIZE = 1024;

/**
 * Call Retro Diffusion API. Uses process.env.RETRO_DIFFUSION_API_KEY.
 * Auth: X-RD-Token header. Request: width, height, prompt, num_images.
 * Response: base64_images[], credit_cost, remaining_credits, etc.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {number} [options.num_images]
 * @returns {Promise<{ buffer: Buffer; width: number; height: number; credit_cost?: number; remaining_credits?: number; [key: string]: unknown }>}
 */
export async function retroDiffusion(prompt, options = {}) {
	if (!RETRO_DIFFUSION_API_KEY) throw new Error('RETRO_DIFFUSION_API_KEY missing');

	const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
	if (!trimmed) throw new Error('A prompt string is required');

	const width = options.width ?? DEFAULT_WIDTH;
	const height = options.height ?? DEFAULT_HEIGHT;
	const num_images = options.num_images ?? 1;

	const startTime = Date.now();

	const payload = {
		width,
		height,
		model: "RD_CLASSIC",
		// model: "RD_FLUX",
		prompt: trimmed,
		prompt_style: "rd_plus__default",
		num_images,
		seed: randomInt(1e9, 1e10),
		tile_x: false,
		tile_y: false,
		remove_bg: true,
		// check_cost: true,
	};

	const response = await fetch(RETRO_DIFFUSION_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-RD-Token': RETRO_DIFFUSION_API_KEY,
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const text = await response.text();
		log('Retro Diffusion API error', { status: response.status, body: text.slice(0, 500) });
		throw new Error(`Retro Diffusion API error: ${response.status} ${text.slice(0, 200)}`);
	}

	const data = await response.json();
	const { base64_images, credit_cost, created_at, type, remaining_credits } = data;

	if (!Array.isArray(base64_images) || base64_images.length === 0) {
		throw new Error('Retro Diffusion response missing base64_images');
	}

	const buffer = Buffer.from(base64_images[0], 'base64');
	const duration = Date.now() - startTime;

	log('Retro Diffusion ready', {
		credit_cost,
		remaining_credits,
		type,
		duration_ms: duration,
	});

	return {
		buffer,
		width,
		height,
		credit_cost,
		created_at,
		type,
		remaining_credits,
		duration,
	};
}

/**
 * Generate image via Retro Diffusion with common args (prompt/text, width, height).
 * Calls RD with the user-requested size, then nearest-neighbor upscales to 1024×1024.
 *
 * @param {object} [args]
 * @param {string} [args.prompt]
 * @param {string} [args.text]
 * @param {number} [args.width]
 * @param {number} [args.height]
 * @returns {Promise<{ buffer: Buffer; width: number; height: number; prompt: string; color: string; [key: string]: unknown }>}
 */
export async function generateRetroDiffusionImage(args = {}) {
	const prompt = (args.prompt || args.text || '').trim();
	if (!prompt) throw new Error('prompt or text is required');

	const requestedWidth = args.width ?? DEFAULT_WIDTH;
	const requestedHeight = args.height ?? DEFAULT_HEIGHT;

	const result = await retroDiffusion(prompt, {
		width: requestedWidth,
		height: requestedHeight,
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
