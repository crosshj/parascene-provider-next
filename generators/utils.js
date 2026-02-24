export function log(...args) {
	// Vercel sets these in serverless environments (prod/preview/dev).
	const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
	if (isVercel) return;
	console.log(...args);
}

export async function fetchImageBuffer(imageUrl) {
	const attempt = async (options = {}) => {
		const response = await fetch(imageUrl, {
			redirect: 'follow',
			...options,
		});
		if (!response.ok) {
			const contentType = response.headers.get('content-type') || 'unknown';
			let bodySnippet = '';
			try {
				const text = await response.text();
				bodySnippet = text.slice(0, 500);
			} catch {
				// ignore body read failures
			}
			throw new Error(
				`Failed to download image: status=${response.status} content-type=${contentType}` +
					(bodySnippet ? ` body=${bodySnippet}` : '')
			);
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		return {
			buffer,
			contentType: response.headers.get('content-type') || undefined,
		};
	};

	try {
		return await attempt();
	} catch (err) {
		const message = err?.message || '';
		if (!/status=401|status=403/.test(message)) {
			throw err;
		}
		return attempt({
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
				Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
				Referer: new URL(imageUrl).origin + '/',
				Origin: new URL(imageUrl).origin,
			},
		});
	}
}

