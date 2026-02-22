/**
 * Generate placeholder WebP thumbnails for create page styles.
 * Each image uses the card background color (by index % 9) and an X in the center.
 * Run from repo root: node scripts/generate-style-thumbs.js
 */

import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CREATE_STYLE_KEYS } from '../public/pages/create-styles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'assets', 'style-thumbs');
const WIDTH = 140;
const HEIGHT = 160;

// HSL from creations.css .create-style-card[data-color-index], 33% mix → use solid for thumb
const HSL_BY_INDEX = [
	[0, 48, 62],    // 0 red
	[160, 48, 62],  // 1 green
	[320, 48, 62],  // 2 magenta
	[80, 48, 62],   // 3 lime
	[240, 48, 62],  // 4 blue
	[40, 48, 62],   // 5 orange
	[200, 48, 62],  // 6 cyan
	[280, 48, 62],  // 7 purple
	[120, 48, 62],  // 8 green
];

function hslToHex(h, s, l) {
	s /= 100;
	l /= 100;
	const a = s * Math.min(l, 1 - l);
	const f = (n) => {
		const k = (n + h / 30) % 12;
		return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
	};
	const r = Math.round(f(0) * 255);
	const g = Math.round(f(8) * 255);
	const b = Math.round(f(4) * 255);
	return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function buildSvg(hexColor) {
	const stroke = '#fff';
	const pad = 28;
	const cx = WIDTH / 2;
	const cy = HEIGHT / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="100%" height="100%" fill="${hexColor}"/>
  <line x1="${cx - pad}" y1="${cy - pad}" x2="${cx + pad}" y2="${cy + pad}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
  <line x1="${cx + pad}" y1="${cy - pad}" x2="${cx - pad}" y2="${cy + pad}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
</svg>`;
}

await mkdir(OUT_DIR, { recursive: true });

for (let i = 0; i < CREATE_STYLE_KEYS.length; i++) {
	const key = CREATE_STYLE_KEYS[i];
	const colorIndex = i % 9;
	const [h, s, l] = HSL_BY_INDEX[colorIndex];
	const hex = hslToHex(h, s, l);
	const svg = buildSvg(hex);
	const outPath = join(OUT_DIR, `${key}.webp`);
	await sharp(Buffer.from(svg))
		.webp({ quality: 85 })
		.toFile(outPath);
	console.log(outPath);
}

console.log(`Done: ${CREATE_STYLE_KEYS.length} images in ${OUT_DIR}`);
