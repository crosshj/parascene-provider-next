import config from './zydeco.config.js';
import {
	generateImageWithOpenAI,
	rewritePoemWithOpenAI,
} from './zydeco.llm.js';
import { imagePoemPrompt } from './zydeco.prompt.js';
import Jimp from 'jimp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

function randItem(items) {
	return items[Math.floor(Math.random() * items.length)];
}

function normalizeForJimp(s) {
	return s
		.replace(/\u2018|\u2019/g, "'") // ‘ ’ -> '
		.replace(/\u201C|\u201D/g, '"') // “ ” -> "
		.replace(/\u2013/g, '-') // – -> -
		.replace(/\u2014/g, '--') // — -> --
		.replace(/\u2026/g, '...') // … -> ...
		.replace(/\u00A0/g, ' '); // nbsp -> space
}

export async function annotatePoemWithJimp(imageBuffer, poemText) {
	try {
		const image = await Jimp.read(imageBuffer);
		const width = image.getWidth();
		const height = image.getHeight();
		const blockHeight = Math.floor(height / 5);
		const blockY = height - blockHeight;

		// Semi-transparent black band for text
		const blackBlock = new Jimp(width, blockHeight, 0x200020b0);
		image.composite(blackBlock, 0, blockY);

		// Load custom font from file
		const __dirname = dirname(fileURLToPath(import.meta.url));
		const fontPath = join(
			__dirname,
			'../fonts/open-sans/open-sans-32-white/open-sans-32-white.fnt'
		);
		const font = await Jimp.loadFont(fontPath);

		image.print(
			font,
			0,
			blockY,
			{
				text: normalizeForJimp(poemText),
				alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
				alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
			},
			width,
			blockHeight
		);

		const finalBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
		return { ok: true, buffer: finalBuffer };
	} catch (err) {
		return { ok: false, message: err.message };
	}
}

export function getPoem() {
	let thepoem = '';
	let { templates } = config['zydeco_bones_v1'];
	const template = randItem(templates);
	template.split(' ').forEach((part) => {
		if (part === 'comma') {
			thepoem = thepoem.trim();
			thepoem += ',\n';
			return;
		}
		if (part === 'period') {
			thepoem = thepoem.trim();
			thepoem += '.  ';
			return;
		}
		thepoem += randItem(config[part]) + ' ';
	});
	return thepoem.trim();
}

export async function poeticImage({ key, style }) {
	const poem = getPoem();
	const poemPlusAI = await rewritePoemWithOpenAI({ key, poem });
	if (!poemPlusAI.ok) return { ok: false, message: poemPlusAI.message };

	const prompt = imagePoemPrompt({ poem: poemPlusAI.text, style });
	const openAIImage = await generateImageWithOpenAI({ key, prompt });
	if (!openAIImage.ok) return { ok: false, message: openAIImage.message };

	const annotated = await annotatePoemWithJimp(
		openAIImage.buffer,
		poemPlusAI.text
	);
	if (!annotated.ok) return { ok: false, message: annotated.message };

	return { ok: true, buffer: annotated.buffer, description: poemPlusAI.text };
}

export async function generatePoeticImage(args = {}) {
	const key = process.env.OPENAI_API_KEY;
	const res = await poeticImage({ key, style: args.style });
	if (!res || res.ok === false) {
		const message = res?.message || 'poeticImage failed';
		throw new Error(message);
	}
	return {
		buffer: res.buffer,
		description: res.description,
		color: '#000000',
		width: 1024,
		height: 1024,
	};
}
