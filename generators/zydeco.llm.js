import { rewritePoemPrompt } from './zydeco.prompt.js';

export async function testOpenAIKey(key) {
	if (!key) return { ok: false, message: 'No key provided' };
	try {
		const res = await fetch('https://api.openai.com/v1/models', {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
			},
		});

		if (res.status === 401)
			return {
				ok: false,
				status: 401,
				message: 'Unauthorized — invalid API key',
			};
		if (!res.ok) {
			const txt = await res.text();
			return {
				ok: false,
				status: res.status,
				message: txt.slice(0, 500),
			};
		}
		const json = await res.json();
		return { ok: true, status: res.status, data: json };
	} catch (err) {
		return { ok: false, message: err.message };
	}
}

export async function rewritePoemWithOpenAI({ key, poem }) {
	if (!key) return { ok: false, message: 'No API key' };
	try {
		const PROMPT = rewritePoemPrompt({ poem });

		const res = await fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'gpt-4.1',
				input: PROMPT,
				temperature: 0.65,
				max_output_tokens: 300,
			}),
		});

		if (!res.ok) {
			const txt = await res.text();
			return {
				ok: false,
				status: res.status,
				message: txt.slice(0, 1000),
			};
		}

		const data = await res.json();
		// Responses API may return `output_text` convenience field or structured `output`.
		let text = '';
		if (data.output_text) text = data.output_text;
		else if (Array.isArray(data.output) && data.output.length) {
			// attempt to find textual content in output[0].content
			const out = data.output[0];
			if (typeof out === 'string') text = out;
			else if (out && Array.isArray(out.content)) {
				for (const c of out.content) {
					if (typeof c === 'string') text += c;
					else if (c && typeof c.text === 'string') text += c.text;
				}
			}
		}
		text = (text || '').trim();
		return { ok: true, text };
	} catch (err) {
		return { ok: false, message: err.message };
	}
}

export async function generateImageWithOpenAI({ key, prompt }) {
	if (!key) return { ok: false, message: 'No API key' };
	if (!prompt) return { ok: false, message: 'No Prompt' };

	try {
		const res = await fetch('https://api.openai.com/v1/images/generations', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'dall-e-3',
				// model: 'chatgpt-image-latest',
				// model: 'gpt-image-1.5',
				prompt,
				n: 1,
				size: '1024x1024',
				response_format: 'b64_json',
			}),
		});

		if (!res.ok) {
			const txt = await res.text();
			console.log(txt, prompt);
			return {
				ok: false,
				status: res.status,
				message: txt.slice(0, 1000),
			};
		}

		const data = await res.json();
		if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
			return { ok: false, message: 'No image data in response' };
		}

		const imageData = data.data[0];
		let buffer;

		if (imageData.b64_json) {
			buffer = Buffer.from(imageData.b64_json, 'base64');
		} else if (imageData.url) {
			const imgRes = await fetch(imageData.url);
			if (!imgRes.ok) {
				return {
					ok: false,
					message: `Failed to fetch image from URL: ${imgRes.status}`,
				};
			}
			buffer = await imgRes.arrayBuffer();
			buffer = Buffer.from(buffer);
		} else {
			return { ok: false, message: 'No image URL or base64 data in response' };
		}

		return {
			ok: true,
			buffer,
			revised_prompt: imageData.revised_prompt,
		};
	} catch (err) {
		return { ok: false, message: err.message };
	}
}
