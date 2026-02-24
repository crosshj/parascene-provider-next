import sharp from 'sharp';
import { log, fetchImageBuffer } from './utils.js';

const maxBytes = 20 * 1024 * 1024;

/**
 * Resize an image to 1024x1024 using the same logic as fluxImageEdit:
 * fit 'cover' + position 'entropy' (no stretching, crop to fill).
 */
export async function uploadImage(args = {}) {
	if (!args || typeof args !== 'object')
		throw new Error('Arguments object is required');

	const image_url = (args.image_url || '').trim();
	if (!image_url) throw new Error('An image_url is required');

	try {
		new URL(image_url);
	} catch {
		throw new Error('image_url must be a valid URL');
	}

	const { buffer: fetchedBuffer } = await fetchImageBuffer(image_url);
	let imgBuf = fetchedBuffer;

	if (imgBuf.length > maxBytes)
		throw new Error(
			`Input image too large: ${imgBuf.length} bytes (max ${maxBytes})`
		);

	const meta = await sharp(imgBuf).metadata();
	if (
		typeof meta.width === 'number' &&
		typeof meta.height === 'number' &&
		(meta.width !== 1024 || meta.height !== 1024)
	) {
		log('Resizing image to 1024x1024', {
			from: { width: meta.width, height: meta.height },
			mode: 'cover+entropy',
		});

		imgBuf = await sharp(imgBuf)
			.resize(1024, 1024, {
				fit: 'cover',
				position: 'entropy',
			})
			.png()
			.toBuffer();
	} else {
		// Already 1024x1024; ensure we output PNG for consistent response
		imgBuf = await sharp(imgBuf).png().toBuffer();
	}

	if (imgBuf.length > maxBytes)
		throw new Error(
			`Image too large after resize: ${imgBuf.length} bytes (max ${maxBytes})`
		);

	return {
		buffer: imgBuf,
		width: 1024,
		height: 1024,
		color: '#000000',
	};
}
