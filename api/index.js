import { generateGradientCircle } from '../generators/gradientCircle.js';
import { generateTextImage } from '../generators/textImage.js';
import { generatePoeticImage } from '../generators/zydeco.js';
import {
	generateFluxImage,
	generatePoeticImageFlux,
	fluxImageEdit,
} from '../generators/flux.js';
import { uploadImage } from '../generators/imageEdit.js';
import { generateRetroDiffusionImage } from '../generators/retroDiffusion.js';
import { generatePixelLabImage } from '../generators/pixelLab.js';
import {
	getAdvancedQueryResponse,
	generateAdvancedImage,
} from '../generators/advanced.js';
import { generateReplicateImage } from '../generators/replicate.js';
import { exampleItems } from '../test/fixtures/advanced.items.js';

function validateAuth(req) {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return false;
	}
	const token = authHeader.slice(7);
	return token === process.env.PARASCENE_API_KEY;
}

function sendImageResponse(res, result, credits) {
	res.setHeader('Content-Type', 'image/png');
	res.setHeader('Content-Length', result.buffer.length);
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('X-Image-Color', result?.color ?? '#000000');
	res.setHeader('X-Image-Width', result.width.toString());
	res.setHeader('X-Image-Height', result.height.toString());
	res.setHeader('X-Credits', String(credits));
	return res.send(result.buffer);
}

const fluxResolutionOptions = [
	{ label: 'NES 8-bit', value: 'nes_8bit' },
	{ label: 'SNES 16-bit', value: 'snes_16bit' },
	{ label: 'AI Legacy', value: 'ai_legacy' },
	{ label: 'AI Classic', value: 'ai_classic' },
	{ label: 'AI Latest', value: 'ai_latest' },
];

const generationMethods = {
	fluxImage: {
		name: 'Flux 2 Pro',
		description:
			'Black Forest Labs Flux 2 Pro. Higher quality, higher credits.',
		intent: 'image_generate',
		credits: 3,
		fields: {
			prompt: {
				label: 'Prompt',
				type: 'text',
				required: true,
			},
		},
	},
	fluxImageFlex: {
		name: 'Flux 2 Flex',
		description:
			'Black Forest Labs Flux 2 Flex. More control, highest cost.',
		intent: 'image_generate',
		credits: 6,
		fields: {
			prompt: {
				label: 'Prompt',
				type: 'text',
				required: true,
			},
		},
	},
	fluxImageKlein: {
		name: 'Flux Klein',
		description:
			'Black Forest Labs Flux Klein + resolution options. Lower quality, lower credits.',
		intent: 'image_generate',
		credits: 1.5,
		fields: {
			prompt: {
				label: 'Prompt',
				type: 'text',
				required: true,
			},
			resolution: {
				label: 'Resolution',
				type: 'select',
				required: false,
				default: 'ai_latest',
				options: fluxResolutionOptions,
			},
		},
	},
	fluxImageEdit: {
		name: 'Flux 2 Pro - Image Edit',
		description:
			'Edit and image with Flux 2 Pro',
		intent: 'image_mutate',
		credits: 5,
		fields: {
			image_url: {
				label: 'Image URL',
				type: 'image_url',
				required: true,
			},
			prompt: {
				label: 'Prompt',
				type: 'text',
				required: true,
			},
		},
	},
	// MEH... PixelLab is better for now.
	// retroDiffusionImage: {
	// 	name: 'Retro Diffusion',
	// 	description:
	// 		'Generate an image with Retro Diffusion; trained on pixel art.',
	// 	intent: 'image_generate',
	// 	credits: 1,
	// 	fields: {
	// 		prompt: {
	// 			label: 'Prompt',
	// 			type: 'text',
	// 			required: true,
	// 		},
	// 		width: {
	// 			label: 'Width',
	// 			type: 'number',
	// 			required: false,
	// 		},
	// 		height: {
	// 			label: 'Height',
	// 			type: 'number',
	// 			required: false,
	// 		},
	// 	},
	// },
	pixelLabImage: {
		name: 'PixelLab',
		description:
			'Generate pixel art with PixelLab\'s Pixflux and Bitforge',
		intent: 'image_generate',
		credits: 0.2,
		fields: {
			prompt: {
				label: 'Prompt',
				type: 'text',
				required: true,
			},
			model: {
				label: 'Model',
				type: 'select',
				required: false,
				default: 'pixflux',
				options: [
					{ label: 'Pixflux', value: 'pixflux' },
					{ label: 'Bitforge', value: 'bitforge' },
				],
			},
			no_background: {
				label: 'No Background',
				type: 'boolean',
				required: false,
				default: false,
			},
			// width: {
			// 	label: 'Width',
			// 	type: 'number',
			// 	required: false,
			// },
			// height: {
			// 	label: 'Height',
			// 	type: 'number',
			// 	required: false,
			// },
		},
	},
	uploadImage: {
		name: 'Upload Image From URL',
		description:
			'Resizes an image from a URL to 1024x1024 (cover + entropy crop).',
		intent: 'image_generate',
		credits: 0,
		fields: {
			image_url: {
				label: 'Image URL',
				type: 'image_url',
				required: true,
			},
		},
	},
	replicate: {
		name: 'Replicate',
		description:
			'Run a Replicate image generation model.',
		intent: 'image_generate',
		credits: 3,
		fields: {
			model: {
				label: 'Model',
				type: 'select',
				required: true,
				options: [
					{ label: 'Luma Photon', value: 'luma/photon' },
					// { label: 'DreamShaper 8', value: 'dreamshaper/dreamshaper_8_pruned:fp16' },
				]
			},
			prompt: {
				label: 'Prompt',
				type: 'text',
				required: true,
			},
			input: {
				label: 'Input (JSON)',
				type: 'text',
				required: true,
				default: JSON.stringify({ aspect_ratio: '1:1' }, null, 2),
			},
		},
	},
	// fluxPoeticImage: {
	// 	name: 'Poetic Image (Zydeco + Flux)',
	// 	description:
	// 		'Generates a zydeco poem, builds an image prompt, renders with Flux, then overlays the poem at the bottom.',
	// 	intent: 'image_generate',
	// 	credits: 5,
	// 	fields: {
	// 		style: {
	// 			label: 'Style',
	// 			type: 'text',
	// 			required: false,
	// 		},
	// 	},
	// },
	// poeticImage: {
	// 	name: 'Poetic Image (Zydeco)',
	// 	description:
	// 		'Zydeco makes a random poem. Open AI cleans it up. Then OpenAI (Dall-E 3) generates an image from poem.',
	// 	intent: 'image_generate',
	// 	credits: 2,
	// 	fields: {
	// 		style: {
	// 			label: 'Style',
	// 			type: 'text',
	// 			required: false,
	// 		},
	// 	},
	// },
	// gradientCircle: {
	// 	name: 'Gradient Circle',
	// 	description:
	// 		'Generates a 1024x1024 image with a gradient background using random colors at each corner and a random colored circle',
	// 	intent: 'image_generate',
	// 	credits: 0.25,
	// 	fields: {},
	// },
	// centeredTextOnWhite: {
	// 	name: 'Centered Text on White',
	// 	description:
	// 		'Generates a 1024x1024 image with centered text rendered on a white background',
	// 	intent: 'image_generate',
	// 	credits: 0.25,
	// 	fields: {
	// 		text: {
	// 			label: 'Text',
	// 			type: 'text',
	// 			required: true,
	// 		},
	// 		color: {
	// 			label: 'Text Color',
	// 			type: 'color',
	// 			required: false,
	// 		},
	// 	},
	// },
};

const methodHandlers = {
	gradientCircle: generateGradientCircle,
	centeredTextOnWhite: generateTextImage,
	poeticImage: generatePoeticImage,
	fluxImage: (args) => generateFluxImage({ ...args, model: 'flux2Pro' }),
	fluxImageFlex: (args) => generateFluxImage({ ...args, model: 'flux2Flex' }),
	fluxImageKlein: (args) => generateFluxImage({ ...args, model: 'fluxKlein' }),
	fluxPoeticImage: generatePoeticImageFlux,
	fluxImageEdit: fluxImageEdit,
	retroDiffusionImage: generateRetroDiffusionImage,
	pixelLabImage: generatePixelLabImage,
	uploadImage,
	replicate: generateReplicateImage,
};

export default async function handler(req, res) {
	if (req.method === 'GET') {
		if (!validateAuth(req)) {
			return res.status(401).json({
				error: 'Unauthorized',
				message: 'Valid API key required. Use Authorization: Bearer <key>',
			});
		}

		// Return mock items for advanced_generate UI (test fixture in place)
		const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
		if (url.searchParams.get('mockItems') === '1') {
			return res.status(200).json({ items: exampleItems });
		}

		const capabilities = {
			status: 'operational',
			last_check_at: new Date().toISOString(),
			methods: generationMethods,
		};
		return res.status(200).json(capabilities);
	}

	if (req.method === 'POST') {
		if (!validateAuth(req)) {
			return res.status(401).json({
				error: 'Unauthorized',
				message: 'Valid API key required. Use Authorization: Bearer <key>',
			});
		}

		try {
			let body;
			try {
				body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
			} catch (parseError) {
				return res.status(400).json({
					error: 'Invalid JSON in request body',
					message: parseError.message,
				});
			}

			if (!body.method) {
				return res.status(400).json({
					error: 'Missing required field: method',
					available_methods: Object.keys(generationMethods),
				});
			}

			// Special methods not listed in config
			if (body.method === 'advanced_query') {
				return res.status(200).json(getAdvancedQueryResponse(body));
			}
			if (body.method === 'advanced_generate') {
				const result = await generateAdvancedImage(body);
				return sendImageResponse(res, result, result.credits ?? 0);
			}

			if (!generationMethods[body.method]) {
				return res.status(400).json({
					error: `Unknown generation method: ${body.method}`,
					available_methods: Object.keys(generationMethods),
				});
			}

			const methodDef = generationMethods[body.method];
			let args = body.args || {};

			const fields = methodDef.fields || {};
			for (const [fieldName, fieldDef] of Object.entries(fields)) {
				if (!(fieldName in args) && fieldDef.default !== undefined) {
					args[fieldName] = fieldDef.default;
				}
			}

			const missingFields = [];
			for (const [fieldName, fieldDef] of Object.entries(fields)) {
				if (fieldDef.required && !(fieldName in args)) {
					missingFields.push(fieldName);
				}
			}

			if (missingFields.length > 0) {
				return res.status(400).json({
					error: `Missing required arguments: ${missingFields.join(', ')}`,
					method: body.method,
					missing_fields: missingFields,
				});
			}

			// Replicate: pull model and prompt from fields; merge optional args (JSON) into payload
			if (body.method === 'replicate') {
				const model = (args.model ?? '').toString().trim();
				const prompt = (args.prompt ?? '').toString().trim();
				if (!model) {
					return res.status(400).json({ error: 'Replicate model is required' });
				}
				if (!prompt) {
					return res.status(400).json({ error: 'Replicate prompt is required' });
				}
				let extra = {};
				const inputRaw = args.input;
				if (typeof inputRaw === 'string' && inputRaw.trim()) {
					try {
						const parsed = JSON.parse(inputRaw);
						if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
							extra = parsed;
						}
					} catch (parseError) {
						return res.status(400).json({
							error: 'Invalid JSON in Replicate input',
							message: parseError.message,
						});
					}
				} else if (inputRaw != null && typeof inputRaw === 'object' && !Array.isArray(inputRaw)) {
					extra = inputRaw;
				}
				args = { model, prompt, ...extra };
			}

			const generator = methodHandlers[body.method];
			if (!generator) {
				return res.status(500).json({
					error: `No handler registered for method: ${body.method}`,
				});
			}

			const result = await generator(args);
			const credits =
				typeof methodDef.credits === 'number' ? methodDef.credits : 0;
			return sendImageResponse(res, result, credits);
		} catch (error) {
			console.error('Error generating image:', error);
			const message = error?.message || String(error);
			return res.status(500).json({
				error: message || 'Failed to generate image',
				message,
			});
		}
	}

	return res.status(405).json({
		error:
			'Method not allowed. Use GET for capabilities or POST for generation.',
	});
}
