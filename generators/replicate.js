import Replicate from 'replicate';
import sharp from 'sharp';
import { log, fetchImageBuffer } from './utils.js';

/**
 * Get the first image URL from Replicate run output.
 * Output may be a single FileOutput/URL, an array, or nested structure.
 * @param {unknown} output
 * @returns {string}
 */
function getFirstImageUrl(output) {
	if (output == null) {
		throw new Error('Replicate run returned no output');
	}
	const first = Array.isArray(output) ? output[0] : output;
	if (first == null) {
		throw new Error('Replicate run returned empty output');
	}
	// FileOutput has .url() (returns URL) and .toString() (returns url string)
	if (typeof first.url === 'function') {
		const u = first.url();
		return typeof u === 'string' ? u : String(u?.href ?? u);
	}
	if (typeof first.toString === 'function' && (first.toString() || '').startsWith('http')) {
		return first.toString();
	}
	if (typeof first === 'string' && (first.startsWith('http') || first.startsWith('data:'))) {
		return first;
	}
	if (first && typeof first === 'object' && typeof first.url === 'string') {
		return first.url;
	}
	throw new Error('Replicate output did not contain an image URL');
}

/**
 * Run a Replicate model and return the first image as a buffer with dimensions.
 * Args may be { model, input } or flat { model, ...inputFields }.
 *
 * @param {object} args - model (required) and either input (object) or flat input fields
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
export async function generateReplicateImage(args = {}) {
	const token = process.env.REPLICATE_API_TOKEN;
	if (!token || typeof token !== 'string') {
		throw new Error('REPLICATE_API_TOKEN is not set');
	}

	const model = args?.model;
	if (!model || typeof model !== 'string' || !model.trim()) {
		throw new Error('Replicate args must include a non-empty model (e.g. "owner/model" or "owner/model:version")');
	}

	const input =
		args.input != null && typeof args.input === 'object' && !Array.isArray(args.input)
			? args.input
			: (() => {
					const { model: _m, ...rest } = args;
					return rest;
				})();

	const replicate = new Replicate({ auth: token });

	log('Replicate run', { model, inputKeys: Object.keys(input || {}) });

	const output = await replicate.run(model, { input });

	const imageUrl = getFirstImageUrl(output);
	const { buffer } = await fetchImageBuffer(imageUrl);

	const meta = await sharp(buffer).metadata();
	const width = typeof meta.width === 'number' ? meta.width : 1024;
	const height = typeof meta.height === 'number' ? meta.height : 1024;

	return {
		buffer: await sharp(buffer).png().toBuffer(),
		width,
		height,
	};
}
