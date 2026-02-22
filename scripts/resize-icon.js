#!/usr/bin/env node
/**
 * Resize an image to 512x512 PNG using sharp.
 * Usage: node scripts/resize-icon.js <input> [output]
 * Supports raster (PNG, JPEG, WebP) and SVG input.
 * Example: node scripts/resize-icon.js public/favicon.svg public/icons/icon-512.png
 */

import sharp from 'sharp';
import { resolve } from 'path';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath) {
	console.error('Usage: node scripts/resize-icon.js <input> [output]');
	process.exit(1);
}

const input = resolve(inputPath);
const output = outputPath ? resolve(outputPath) : input.replace(/\.[^.]+$/, '-512.png');

sharp(input)
	.resize(512, 512)
	.png()
	.toFile(output)
	.then((info) => {
		console.log(`Wrote ${output} (${info.width}x${info.height})`);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
