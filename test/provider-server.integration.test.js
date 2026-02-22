import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, '.output');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
	fs.mkdirSync(outputDir, { recursive: true });
}

// Server URL from seed data
const SERVER_URL = 'https://parascene-provider.vercel.app/api';
const PROVIDER_API_KEY =
	process.env.PROVIDER_API_KEY ||
	process.env.PROVIDER_SERVER_API_KEY ||
	process.env.PARASCENE_PROVIDER_API_KEY;
const maybeIt = PROVIDER_API_KEY ? it : it.skip;

describe('Provider Server Integration Test', () => {
	maybeIt('should generate centeredTextOnWhite image and save to .output folder', async () => {
		const response = await fetch(SERVER_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'image/png',
				Authorization: `Bearer ${PROVIDER_API_KEY}`
			},
			body: JSON.stringify({
				method: 'centeredTextOnWhite',
				args: {
					text: 'Oh, I see  you  are empty!      Hello, world!',
					color: '#110011'
				}
			}),
			signal: AbortSignal.timeout(30000)
		});

		if (!response.ok) {
			const bodyText = await response.text().catch(() => '');
			throw new Error(
				`Provider request failed: ${response.status} ${response.statusText}. ` +
				`${bodyText.slice(0, 500)}`
			);
		}
		expect(response.headers.get('content-type')).toContain('image/png');

		const imageBuffer = Buffer.from(await response.arrayBuffer());
		expect(imageBuffer.length).toBeGreaterThan(0);

		// Save image to .output folder
		const filename = `centeredTextOnWhite_${Date.now()}.png`;
		const filePath = path.join(outputDir, filename);
		fs.writeFileSync(filePath, imageBuffer);

		// Verify file was created
		expect(fs.existsSync(filePath)).toBe(true);
		const stats = fs.statSync(filePath);
		expect(stats.size).toBeGreaterThan(0);

		console.log(`✓ Saved image to ${filePath} (${stats.size} bytes)`);
	});
});
