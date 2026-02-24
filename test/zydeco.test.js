import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import {
	testOpenAIKey,
	rewritePoemWithOpenAI,
	generateImageWithOpenAI,
} from '../generators/zydeco.llm.js';
import { imagePoemPrompt } from '../generators/zydeco.prompt.js';
import { poeticImage } from '../generators/zydeco.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, '..', '.output');

const key = process.env.OPENAI_API_KEY;
const poem = `
    Right now after the validated plenum dithering (in silence) ran,
    a certain standard vampire is melting not ever.
`;

jest.setTimeout(60000);

describe('zydeco llm', () => {
	beforeAll(async () => {
		await fs.mkdir(outputDir, { recursive: true });
	});

	it('calls OpenAI to check API key', async () => {
		const result = await testOpenAIKey(key);
		expect(result.ok).toBe(true);
		expect(result.status).toBe(200);
		expect(result.data || result.message).toBeDefined();
	});

	it('rewrites a poem via OpenAI', async () => {
		const result = await rewritePoemWithOpenAI({ key, poem });

		// console.log(result.text);

		expect(result.ok).toBe(true);
		expect(typeof result.text).toBe('string');
		expect(result.text.length).toBeGreaterThan(0);
	});

	it.only('getPoeticImage', async () => {
		if (!key) {
			console.warn('Skipping getPoeticImage test: OPENAI_API_KEY not set');
			return;
		}

		const style = 'clean lines, modern, detailed';
		const {
			buffer: imageResult,
			description,
			ok,
		} = await poeticImage({
			key,
			style,
		});

		expect(ok).toBe(true);
		expect(Buffer.isBuffer(imageResult)).toBe(true);
		expect(imageResult?.length).toBeGreaterThan(0);
		expect(typeof description).toBe('string');

		// console.log(description);

		const imagePath = path.join(outputDir, 'poetic-image.png');
		await fs.writeFile(imagePath, imageResult);
		console.log(`Poetic image saved to ${imagePath}`);
	});

	// it('poem -> rewrite -> picture', async () => {
	// 	// Rewrite the poem
	// 	const rewriteResult = await rewritePoemWithOpenAI({ key, poem });
	// 	expect(rewriteResult.ok).toBe(true);
	// 	const rewrittenPoem = rewriteResult.text;

	// 	// Generate image from rewritten poem
	// 	// const style = 'modern, excellent draftsmanship, high quality';
	// 	const style = undefined;
	// 	const prompt = imagePoemPrompt({ poem: rewrittenPoem, style });
	// 	const imageResult = await generateImageWithOpenAI({
	// 		key,
	// 		prompt,
	// 	});

	// 	expect(imageResult.ok).toBe(true);
	// 	expect(Buffer.isBuffer(imageResult.buffer)).toBe(true);
	// 	expect(imageResult.buffer.length).toBeGreaterThan(0);

	// 	const { buffer } = await overlayPoemOnImage(
	// 		imageResult.buffer,
	// 		rewrittenPoem
	// 	);

	// 	// Write image to .output
	// 	const imagePath = path.join(outputDir, 'poem-rewrite-image.png');
	// 	await fs.writeFile(imagePath, buffer);
	// 	console.log(`Image saved to ${imagePath}`);
	// });
});
