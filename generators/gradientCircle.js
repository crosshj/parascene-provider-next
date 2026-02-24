import sharp from 'sharp';

const html = String.raw;

function generateRandomColor() {
	return (
		'#' +
		Math.floor(Math.random() * 16777215)
			.toString(16)
			.padStart(6, '0')
	);
}

export async function generateGradientCircle(args = {}) {
	const width = 1024;
	const height = 1024;

	const cornerColors = [
		generateRandomColor(),
		generateRandomColor(),
		generateRandomColor(),
		generateRandomColor(),
	];

	const circleColor = generateRandomColor();

	const circleRadius = Math.floor(width / 3);
	const circleCenterX = width / 2;
	const circleCenterY = height / 2;

	const svgBackground = html`
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="topGrad" x1="0%" y1="0%" x2="100%" y2="0%">
					<stop offset="0%" stop-color="${cornerColors[0]}" />
					<stop offset="100%" stop-color="${cornerColors[1]}" />
				</linearGradient>
				<linearGradient id="bottomGrad" x1="0%" y1="0%" x2="100%" y2="0%">
					<stop offset="0%" stop-color="${cornerColors[2]}" />
					<stop offset="100%" stop-color="${cornerColors[3]}" />
				</linearGradient>
			</defs>
			<rect width="100%" height="50%" fill="url(#topGrad)" />
			<rect width="100%" height="50%" y="50%" fill="url(#bottomGrad)" />
		</svg>
	`;

	const circleSvg = html`
		<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
			<circle
				cx="${circleCenterX}"
				cy="${circleCenterY}"
				r="${circleRadius}"
				fill="${circleColor}"
			/>
		</svg>
	`;

	const backgroundBuffer = await sharp(Buffer.from(svgBackground))
		.png()
		.toBuffer();

	const imageBuffer = await sharp(backgroundBuffer)
		.composite([
			{
				input: Buffer.from(circleSvg),
				blend: 'over',
			},
		])
		.png()
		.toBuffer();

	return {
		buffer: imageBuffer,
		color: cornerColors[0],
		width,
		height,
		colors: {
			corners: cornerColors,
			circle: circleColor,
		},
	};
}

export default generateGradientCircle;
