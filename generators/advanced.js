import sharp from 'sharp';
import { generateFluxImage, fluxFillRequest, flux } from './flux.js';
import { makeFluxPrompt } from './openai.js';
import { fetchImageBuffer } from './utils.js';

/** Credits per advanced operation. */
const ADVANCED_GENERATE_CREDITS = 3;
const ADVANCED_GENERATE_256_CREDITS = 3;
const ADVANCED_OUTPAINT_CREDITS = 7;

/** Response for advanced_query: support and cost depend on requested operation. */
export function getAdvancedQueryResponse(body) {
	console.log('getAdvancedQueryResponse', body);
	const op = body?.args?.operation;
	const operation =
		op === 'outpaint' ? 'outpaint' : op === 'generate_thumb' ? 'generate_thumb' : 'generate';
	const cost =
		operation === 'outpaint'
			? ADVANCED_OUTPAINT_CREDITS
			: operation === 'generate_thumb'
				? ADVANCED_GENERATE_256_CREDITS
				: ADVANCED_GENERATE_CREDITS;
	// TODO: will want to be honest about the cost and support based on the query
	return { supported: true, cost };
}

/** Input size for Flux Pro outpaint; output is 16:9. */
const OUTPAINT_INPUT_SIZE = 1024;
/** Output size for 16:9 Flux Pro outpaint (1824×1024). */
const OUTPAINT_OUTPUT_WIDTH = 1824;
const OUTPAINT_OUTPUT_HEIGHT = 1024;
const OUTPAINT_LEFT_OFFSET = Math.floor((OUTPAINT_OUTPUT_WIDTH - OUTPAINT_INPUT_SIZE) / 2);

const maxOutpaintInputBytes = 20 * 1024 * 1024;

/**
 * Outpaint a 1024×1024 image to 16:9 (1824×1024) using FLUX.1 Fill [pro] with an alpha channel.
 * - Input: image_url (URL) or image_buffer (Buffer). Normalized to 1024×1024 (cover + entropy crop).
 * - Builds a 1824×1024 PNG with the 1024×1024 image centered and the rest transparent; sends to flux-pro-1.0-fill.
 * - Optional prompt describes the expanded areas.
 * @param {{ image_url?: string, image_buffer?: Buffer, prompt?: string }} args
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, ... }>}
 */
export async function generateFluxProOutpaint1024To169(args = {}) {
	const imageUrl = typeof args.image_url === 'string' ? args.image_url.trim() : '';
	const imageBuffer = args.image_buffer;

	let imgBuf;
	if (Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0) {
		imgBuf = imageBuffer;
	} else if (imageUrl) {
		try {
			new URL(imageUrl);
		} catch {
			throw new Error('image_url must be a valid URL');
		}
		const { buffer } = await fetchImageBuffer(imageUrl);
		imgBuf = buffer;
	} else {
		throw new Error('Either image_url or image_buffer is required');
	}

	if (imgBuf.length > maxOutpaintInputBytes) {
		throw new Error(
			`Input image too large: ${imgBuf.length} bytes (max ${maxOutpaintInputBytes})`
		);
	}

	const meta = await sharp(imgBuf).metadata();
	if (
		typeof meta.width === 'number' &&
		typeof meta.height === 'number' &&
		(meta.width !== OUTPAINT_INPUT_SIZE || meta.height !== OUTPAINT_INPUT_SIZE)
	) {
		imgBuf = await sharp(imgBuf)
			.resize(OUTPAINT_INPUT_SIZE, OUTPAINT_INPUT_SIZE, {
				fit: 'cover',
				position: 'entropy',
			})
			.png()
			.toBuffer();
	}

	// 1824×1024 canvas with alpha; center 1024×1024 image (offset left = 400).
	const canvas = await sharp({
		create: {
			width: OUTPAINT_OUTPUT_WIDTH,
			height: OUTPAINT_OUTPUT_HEIGHT,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.png()
		.toBuffer();

	const compositeWithAlpha = await sharp(canvas)
		.composite([
			{
				input: imgBuf,
				left: OUTPAINT_LEFT_OFFSET,
				top: 0,
			},
		])
		.png()
		.toBuffer();

	const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';

	const infillPromptDefault = `
Outpaint only the transparent/masked areas to extend the existing image to widescreen (16:9).
Preserve the original image exactly as-is; do not alter, restyle, recolor, or reposition the central subject.

Continue the environment logically beyond the current borders.
Match perspective, horizon line, depth, lighting direction, color temperature, texture detail, noise level, and rendering quality.
Maintain consistent camera distance and lens characteristics.

No new focal points.
No new elements.
No additional characters.
No compositional changes to the subject.
If the image does not include menus or UI elements, do not include them in the extended image.
We really don't want desktop menus or UI elements in the extended image unless they are part of the original image.

AVOID: text, captions, logos, watermarks, signatures, frames, borders, UI elements, dramatic lighting shifts, style changes.
`;
	const result = await fluxFillRequest({
		image: compositeWithAlpha.toString('base64'),
		prompt: prompt || infillPromptDefault,
		output_format: 'png',
	});

	return {
		...result,
		width: OUTPAINT_OUTPUT_WIDTH,
		height: OUTPAINT_OUTPUT_HEIGHT,
	};
}

/**
 * Generate image for advanced_generate. Dispatches by args.operation:
 * - outpaint: 1024×1024 → 16:9 (1824×1024) via Flux Pro Fill (args.image_url, optional args.prompt).
 * - generate_thumb: items + optional prompt → Flux 2 Pro at 999×999 (just under 1MP).
 * - generate (default): items + optional prompt → Flux 2 Pro.
 */
export async function generateAdvancedImage(body) {
	const args = body?.args ?? {};

	if (args.operation === 'outpaint') {
		const result = await generateFluxProOutpaint1024To169({
			image_url: args.image_url,
			image_buffer: args.image_buffer,
			prompt: args.prompt,
		});
		return { ...result, credits: ADVANCED_OUTPAINT_CREDITS };
	}

	const items = args.items ?? [];
	const userPrompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';

	const input = { items };
	if (userPrompt) input.prompt = userPrompt;

	if (args.operation === 'generate_thumb') {
		const result = await flux(userPrompt, {
			model: 'flux2Pro',
			width: 1000,
			height: 1000,
		});
		return { ...result, credits: ADVANCED_GENERATE_256_CREDITS };
	}

	const fluxPrompt = await makeFluxPrompt(input);
	if (!fluxPrompt) {
		throw new Error('Failed to generate');
	}

	const result = await generateFluxImage({
		model: 'flux2Pro',
		prompt: fluxPrompt,
	});
	return { ...result, credits: ADVANCED_GENERATE_CREDITS };
}
