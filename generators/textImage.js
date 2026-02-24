import { renderBitmapToPng } from '../fonts/bitmap.js';

function escapeSvgText(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function isValidHexColor(color) {
	return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
}

export async function generateTextImage(args = {}) {
	const width = 1024;
	const height = 1024;

	if (!args.text || typeof args.text !== 'string' || args.text.trim() === '') {
		throw new Error('Text field is required and must be a non-empty string');
	}

	const text = args.text;

	let textColor = '#000000';
	if (args.color) {
		if (!isValidHexColor(args.color)) {
			throw new Error(
				`Invalid hex color format: ${args.color}. Must be in format #RRGGBB or #RGB`
			);
		}
		textColor = args.color;
	}

	const backgroundColor = '#f0f0f0';

	const escapedText = escapeSvgText(text);

	const imageBuffer = await renderBitmapToPng({
		text: escapedText,
		width,
		height,
		textColor,
		backgroundColor,
	});

	return {
		buffer: imageBuffer,
		color: textColor,
		width,
		height,
	};
}

export default generateTextImage;
