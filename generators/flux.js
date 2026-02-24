import { getPoem, annotatePoemWithJimp } from './zydeco.js';
import { rewritePoemWithOpenAI } from './zydeco.llm.js';
import sharp from 'sharp';
import { log, fetchImageBuffer } from './utils.js';

const { FLUX_API_KEY } = process.env;
const FLUX_PRO_URL = 'https://api.bfl.ai/v1/flux-2-pro';
const FLUX_KLEIN_9B_URL = 'https://api.bfl.ai/v1/flux-2-klein-9b';
const FLUX_FLEX_URL = 'https://api.bfl.ai/v1/flux-2-flex';
const FLUX_PRO_1_FILL_URL = 'https://api.bfl.ai/v1/flux-pro-1.0-fill';

/** Delay (ms) before first poll of Flux job status. */
const FLUX_POLL_INITIAL_DELAY_MS = 5000;
/** Interval (ms) between subsequent polls. */
const FLUX_POLL_INTERVAL_MS = 1000;

/** Resolution preset key → { width, height, colors }. Value is short label (no spaces), e.g. "nes_8bit". */
export const RESOLUTION_CONFIG = {
	nes_8bit: { width: 32, height: 32, colors: 16 },
	snes_16bit: { width: 64, height: 64, colors: 256 },
	ai_legacy: { width: 512, height: 512, colors: false },
	ai_classic: { width: 768, height: 768, colors: false },
	ai_latest: { width: 1024, height: 1024, colors: false },
};

const DEFAULT_RESOLUTION_KEY = 'ai_latest';

/** Model from handler ('fluxKlein' | 'flux2Flex' | 'flux2Pro') → API URL. */
function getFluxUrl(model) {
	switch (model) {
		case 'fluxKlein':
			return FLUX_KLEIN_9B_URL;
		case 'flux2Flex':
			return FLUX_FLEX_URL;
		case 'flux2Pro':
		default:
			return FLUX_PRO_URL;
	}
}

async function fluxRequest(payload = {}, options = {}) {
	if (!FLUX_API_KEY) throw new Error('FLUX_API_KEY missing');

	const prompt = payload?.prompt;
	if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
		throw new Error('A prompt string is required');
	}

	const url = getFluxUrl(options.model) || FLUX_PRO_URL;
	const startTime = Date.now();
	let rest = null;

	try {
		const post = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-key': FLUX_API_KEY,
			},
			body: JSON.stringify({
				...payload,
				prompt_upsampling: false,
				prompt: prompt.trim(),
			}),
		});
		if (!post.ok) throw new Error(await post.text());
		const { polling_url, ...r } = await post.json();
		rest = r;

		log('Flux request created', {
			id: rest.id,
			cost: rest.cost,
			input_mp: rest.input_mp,
			output_mp: rest.output_mp,
		});

		await new Promise((r) => setTimeout(r, FLUX_POLL_INITIAL_DELAY_MS));

		let pollCount = 0;

		for (; ;) {
			pollCount++;
			const poll = await fetch(polling_url, {
				headers: {
					'x-key': FLUX_API_KEY,
				},
			});
			if (!poll.ok) throw new Error(await poll.text());
			const j = await poll.json();

			const { status, ...jRest } = j;

			if (status === 'Ready') {
				const img = await fetch(j.result.sample);
				if (!img.ok) throw new Error(await img.text());
				const buffer = Buffer.from(await img.arrayBuffer());
				let meta = null;
				try {
					meta = await sharp(buffer).metadata();
				} catch {
					// ignore metadata failures
				}
				const duration = Date.now() - startTime;

				log('Flux request ready', {
					id: rest.id,
					cost: rest.cost,
					usd: rest.cost * 0.01,
					input_mp: rest.input_mp,
					output_mp: rest.output_mp,
					duration_ms: duration,
					pollCount,
				});

				return {
					buffer,
					width: typeof meta?.width === 'number' ? meta.width : undefined,
					height: typeof meta?.height === 'number' ? meta.height : undefined,
					format: meta?.format,
					mime: img.headers.get('content-type') || undefined,
					duration,
					pollCount,
					final: jRest,
					...rest,
				};
			}
			// Per BFL get_result docs: only poll while Pending.
			if (status !== 'Pending') {
				log('Flux non-pending status', { id: rest?.id, status, response: j });
				throw new Error(
					`Flux request did not complete: status=${status} id=${rest?.id || 'unknown'}`
				);
			}

			log('Polling...');
			await new Promise((r) => setTimeout(r, FLUX_POLL_INTERVAL_MS));
		}
	} catch (err) {
		log('Flux request error', {
			id: rest?.id,
			message: err?.message || String(err),
		});
		throw err;
	}
}

/**
 * Call BFL FLUX.1 Fill [pro] (flux-pro-1.0-fill). Payload must include image (base64).
 * Uses same polling pattern as fluxRequest. Returns { buffer, width, height, ... }.
 */
export async function fluxFillRequest(payload = {}, options = {}) {
	if (!FLUX_API_KEY) throw new Error('FLUX_API_KEY missing');

	const image = payload?.image;
	if (!image || typeof image !== 'string') {
		throw new Error('fluxFillRequest requires payload.image (base64 string)');
	}

	const url = options.url ?? FLUX_PRO_1_FILL_URL;
	const startTime = Date.now();
	let rest = null;

	try {
		const post = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-key': FLUX_API_KEY,
			},
			body: JSON.stringify({
				image,
				prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
				prompt_upsampling: false,
				seed: payload.seed ?? 0,
				steps: payload.steps ?? 50,
				guidance: payload.guidance ?? 60,
				output_format: payload.output_format ?? 'png',
				...payload,
			}),
		});
		if (!post.ok) throw new Error(await post.text());
		const { polling_url, ...r } = await post.json();
		rest = r;

		log('Flux fill request created', {
			id: rest.id,
			cost: rest.cost,
			input_mp: rest.input_mp,
			output_mp: rest.output_mp,
		});

		await new Promise((r) => setTimeout(r, FLUX_POLL_INITIAL_DELAY_MS));

		let pollCount = 0;

		for (;;) {
			pollCount++;
			const poll = await fetch(polling_url, {
				headers: { 'x-key': FLUX_API_KEY },
			});
			if (!poll.ok) throw new Error(await poll.text());
			const j = await poll.json();

			const { status, ...jRest } = j;

			if (status === 'Ready') {
				const img = await fetch(j.result.sample);
				if (!img.ok) throw new Error(await img.text());
				const buffer = Buffer.from(await img.arrayBuffer());
				let meta = null;
				try {
					meta = await sharp(buffer).metadata();
				} catch {
					// ignore metadata failures
				}
				const duration = Date.now() - startTime;

				const defaultCost = 5;
				log('Flux fill request ready', {
					id: rest.id,
					cost: rest.cost || defaultCost,
					usd: (rest.cost || defaultCost) * 0.01,
					duration_ms: duration,
					pollCount,
				});

				return {
					buffer,
					width: typeof meta?.width === 'number' ? meta.width : undefined,
					height: typeof meta?.height === 'number' ? meta.height : undefined,
					format: meta?.format,
					mime: img.headers.get('content-type') || undefined,
					duration,
					pollCount,
					final: jRest,
					...rest,
				};
			}
			if (status !== 'Pending') {
				log('Flux fill non-pending status', { id: rest?.id, status, response: j });
				throw new Error(
					`Flux fill request did not complete: status=${status} id=${rest?.id || 'unknown'}`
				);
			}

			log('Flux fill polling...');
			await new Promise((r) => setTimeout(r, FLUX_POLL_INTERVAL_MS));
		}
	} catch (err) {
		log('Flux fill request error', {
			id: rest?.id,
			message: err?.message || String(err),
		});
		throw err;
	}
}

export async function flux(prompt, options = {}) {
	const apiWidth = options.width ?? 1024;
	const apiHeight = options.height ?? 1024;
	const model = options.model ?? 'flux2Pro';

	return fluxRequest(
		{
			prompt,
			prompt_upsampling: false,
			seed: 0,
			width: apiWidth,
			height: apiHeight,
		},
		{ model },
	);
}

const API_SIZE = 1024;
const PIXEL_ART_PROMPT = `
VERY BOLD AND THICK OUTLINES
flat colors
simple shading
limited color palette
very limited details
very limited textures
no gradients
no soft lighting
no reflections
no shadows
no highlights
no outlines
no borders
no backgrounds
no backgrounds
`;

export async function generateFluxImage(args = {}) {
	const resolutionKey = String(args.resolution || DEFAULT_RESOLUTION_KEY).toLowerCase();
	const config = RESOLUTION_CONFIG[resolutionKey] ?? RESOLUTION_CONFIG[DEFAULT_RESOLUTION_KEY];
	const { width: targetWidth, height: targetHeight, colors } = config;
	// Model from handler ('fluxKlein' | 'flux2Pro') determines which API URL is called.
	const model = args.model ?? 'flux2Pro';

	// 1. Always request 1024×1024; model picks endpoint (Pro vs Klein).
	let prompt = args.prompt || args.text;
	if (targetWidth < API_SIZE || targetHeight < API_SIZE) {
		prompt = `${prompt}, ${PIXEL_ART_PROMPT}`;
	}

	const result = await flux(prompt, {
		width: API_SIZE,
		height: API_SIZE,
		model,
	});

	let buffer = result.buffer;
	let width = result.width ?? API_SIZE;
	let height = result.height ?? API_SIZE;

	// 2. If target is below 1024: downscale → (limit palette if colors) → nearest-neighbor up to 1024.
	if (targetWidth < API_SIZE || targetHeight < API_SIZE) {
		let downscaled = await sharp(buffer)
			.resize(targetWidth, targetHeight, { kernel: 'nearest' })
			.png()
			.toBuffer();
		if (colors) {
			downscaled = await sharp(downscaled)
				.png({ palette: true, colours: colors })
				.toBuffer();
		}
		buffer = await sharp(downscaled)
			.resize(API_SIZE, API_SIZE, { kernel: 'nearest' })
			.png()
			.toBuffer();
		width = API_SIZE;
		height = API_SIZE;
	} else if (width < API_SIZE || height < API_SIZE) {
		buffer = await sharp(buffer)
			.resize(API_SIZE, API_SIZE, { kernel: 'nearest' })
			.png()
			.toBuffer();
		width = API_SIZE;
		height = API_SIZE;
	}

	return {
		...result,
		buffer,
		prompt: (args.prompt || args.text || '').trim(),
		color: '#000000',
		width,
		height,
	};
}

const styledPrompt = ({ poem, style }) =>
	`
${poem}

style
-----
${style}

`.trim();

export async function generatePoeticImageFlux(args = {}) {
	const poem = getPoem();
	const poemPlusAI = await rewritePoemWithOpenAI({
		key: process.env.OPENAI_API_KEY,
		poem,
	});
	//TODO: handle !poemPlusAI?.ok case

	const prompt = args?.style
		? styledPrompt({ poem: poemPlusAI.text, style: args.style })
		: poemPlusAI.text;

	console.log(poemPlusAI);

	const result = await generateFluxImage({ prompt });
	const annotated = await annotatePoemWithJimp(result.buffer, poemPlusAI.text);
	if (!annotated.ok) {
		throw new Error(`Failed to annotate poem: ${annotated.message}`);
	}

	return {
		...result,
		buffer: annotated.buffer,
		description: poemPlusAI.text,
		color: '#000000',
		width: 1024,
		height: 1024,
	};
}

export async function fluxImageEdit(args = {}) {
	if (!args || typeof args !== 'object')
		throw new Error('Arguments object is required');

	const prompt = (args.prompt || args.text || '').trim();
	if (!prompt) throw new Error('A prompt string is required');

	const image_url = (args.image_url || '').trim();
	if (!image_url) throw new Error('An image_url is required');

	// Validate URL shape early for clearer errors.
	try {
		new URL(image_url);
	} catch {
		throw new Error('image_url must be a valid URL');
	}

	const { buffer: fetchedBuffer } = await fetchImageBuffer(image_url);
	let imgBuf = fetchedBuffer;

	// Per BFL docs: input_image supports up to 20MB.
	const maxBytes = 20 * 1024 * 1024;
	if (imgBuf.length > maxBytes)
		throw new Error(
			`Input image too large: ${imgBuf.length} bytes (max ${maxBytes})`
		);

	// Prepare for Flux edit: normalize to 1024x1024 without stretching.
	// This preserves aspect ratio and crops to fill (no bars).
	// 1024 is a multiple of 16, satisfying FLUX.2 requirements.
	const meta = await sharp(imgBuf).metadata();
	if (
		typeof meta.width === 'number' &&
		typeof meta.height === 'number' &&
		(meta.width !== 1024 || meta.height !== 1024)
	) {
		log('Normalizing input image for Flux', {
			from: { width: meta.width, height: meta.height },
			to: { width: 1024, height: 1024 },
			mode: 'cover+entropy',
		});

		imgBuf = await sharp(imgBuf)
			.resize(1024, 1024, {
				fit: 'cover',
				position: 'entropy',
			})
			.png()
			.toBuffer();
	}

	// Re-check size after optional resize/encode.
	if (imgBuf.length > maxBytes)
		throw new Error(
			`Input image too large after resize: ${imgBuf.length} bytes (max ${maxBytes})`
		);

	const input_image = imgBuf.toString('base64');
	const result = await fluxRequest({
		prompt,
		input_image,
		prompt_upsampling: false,
		seed: 0,
		output_format: 'png',
	});

	if (typeof result.width !== 'number' || typeof result.height !== 'number') {
		// API layer expects numeric dimensions for headers.
		throw new Error('Unable to determine output image dimensions');
	}

	return {
		...result,
		prompt,
		image_url,
		color: '#000000',
	};
}
