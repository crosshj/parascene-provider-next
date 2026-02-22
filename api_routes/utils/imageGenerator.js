import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const html = String.raw;

/**
 * Generates a random hex color
 */
function generateRandomColor() {
  return "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
}

/**
 * Converts hex color to RGB
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : null;
}

/**
 * Generates a 1024x1024 image with:
 * - A gradient background using random colors at each of the 4 corners
 * - A circle that is 1/3 the page size in a random color
 * @param {string} outputPath - Full path where the image should be saved
 * @returns {Promise<{color: string, width: number, height: number, colors: {corners: string[], circle: string}}>}
 */
export async function generateRandomColorImage(outputPath) {
  const width = 1024;
  const height = 1024;
  
  // Generate 4 random colors for the corners (top-left, top-right, bottom-left, bottom-right)
  const cornerColors = [
    generateRandomColor(), // top-left
    generateRandomColor(), // top-right
    generateRandomColor(), // bottom-left
    generateRandomColor()  // bottom-right
  ];
  
  // Generate a random color for the circle
  const circleColor = generateRandomColor();
  
  // Calculate circle size (1/3 of page size = radius)
  const circleRadius = Math.floor(width / 3);
  const circleCenterX = width / 2;
  const circleCenterY = height / 2;
  
  // Create SVG with 4-corner gradient using a simple bilinear approach
  // Top row blends top-left to top-right, bottom row blends bottom-left to bottom-right
  // Then blend vertically
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
  <!-- Top half with top gradient -->
  <rect width="100%" height="50%" fill="url(#topGrad)" />
  <!-- Bottom half with bottom gradient -->
  <rect width="100%" height="50%" y="50%" fill="url(#bottomGrad)" />
</svg>
`;

  // Create circle SVG
  const circleSvg = html`
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${circleCenterX}" cy="${circleCenterY}" r="${circleRadius}" fill="${circleColor}" />
</svg>
`;

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Create the background with 4-corner gradient
  const backgroundBuffer = await sharp(Buffer.from(svgBackground))
    .png()
    .toBuffer();

  // Add the circle on top
  await sharp(backgroundBuffer)
    .composite([
      {
        input: Buffer.from(circleSvg),
        blend: 'over'
      }
    ])
    .png()
    .toFile(outputPath);

  // Return metadata including all colors used
  return {
    color: cornerColors[0], // Primary color for backward compatibility
    width,
    height,
    colors: {
      corners: cornerColors,
      circle: circleColor
    }
  };
}

/**
 * Generates a 1024x1024 image to a buffer (does not write to disk)
 * - A gradient background using random colors at each of the 4 corners
 * - A circle that is 1/3 the page size in a random color
 * @returns {Promise<{buffer: Buffer, color: string, width: number, height: number, colors: {corners: string[], circle: string}}>}
 */
export async function generateRandomColorImageToBuffer() {
  const width = 1024;
  const height = 1024;
  
  // Generate 4 random colors for the corners (top-left, top-right, bottom-left, bottom-right)
  const cornerColors = [
    generateRandomColor(), // top-left
    generateRandomColor(), // top-right
    generateRandomColor(), // bottom-left
    generateRandomColor()  // bottom-right
  ];
  
  // Generate a random color for the circle
  const circleColor = generateRandomColor();
  
  // Calculate circle size (1/3 of page size = radius)
  const circleRadius = Math.floor(width / 3);
  const circleCenterX = width / 2;
  const circleCenterY = height / 2;
  
  // Create SVG with 4-corner gradient using a simple bilinear approach
  // Top row blends top-left to top-right, bottom row blends bottom-left to bottom-right
  // Then blend vertically
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
  <!-- Top half with top gradient -->
  <rect width="100%" height="50%" fill="url(#topGrad)" />
  <!-- Bottom half with bottom gradient -->
  <rect width="100%" height="50%" y="50%" fill="url(#bottomGrad)" />
</svg>
`;

  // Create circle SVG
  const circleSvg = html`
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${circleCenterX}" cy="${circleCenterY}" r="${circleRadius}" fill="${circleColor}" />
</svg>
`;

  // Create the background with 4-corner gradient
  const backgroundBuffer = await sharp(Buffer.from(svgBackground))
    .png()
    .toBuffer();

  // Add the circle on top and return as buffer
  const imageBuffer = await sharp(backgroundBuffer)
    .composite([
      {
        input: Buffer.from(circleSvg),
        blend: 'over'
      }
    ])
    .png()
    .toBuffer();

  // Return buffer and metadata including all colors used
  return {
    buffer: imageBuffer,
    color: cornerColors[0], // Primary color for backward compatibility
    width,
    height,
    colors: {
      corners: cornerColors,
      circle: circleColor
    }
  };
}
