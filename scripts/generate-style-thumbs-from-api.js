/**
 * Call local API per prompt, resize/crop with sharp, save WebP to public/assets/style-thumbs/.
 * Run from repo root. Server must be up at http://localhost:3000.
 */

import sharp from "sharp";
import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "assets", "style-thumbs");

const PROMPTS = [
	// ["none", "simple neutral gray sphere centered on dark background, soft studio lighting, minimal, high contrast, clean composition, no texture"],
	// ["default", "heroic fantasy knight standing on cliff edge, glowing sky behind, dramatic rim lighting, detailed matte painting, bold silhouette, centered composition"],
	// ["isometricVoxel", "large isometric voxel castle floating on small island, blocky geometry, clean edges, bright colors, minimal night sky background, centered"],
	// ["cinematic", "lone figure walking through rain-soaked street at night, strong backlight, heavy shadows, cinematic film still, shallow depth of field, centered"],
	// ["realistic-anime", "anime warrior girl, semi-realistic shading, dynamic lighting, strong contrast, centered portrait framing"],
	// ["artistic-portrait", "stylized head-and-shoulders portrait of elegant woman, dramatic lighting, painterly brush detail, dark background, centered"],
	// ["striking", "sharp high-contrast portrait of girl with intense gaze, dramatic side lighting, deep shadows, centered, hyper-detailed"],
	// ["2-5d-anime", "anime character standing in stylized city street, cel-shaded, subtle depth, cinematic lighting, centered full-body"],
	// ["anime-v2", "anime key visual of heroic boy with wind blowing hair, bold colors, clean linework, simple sky background, centered"],
	// ["hyperreal", "hyperreal close-up of face with dramatic lighting, ultra sharp detail, high contrast background, centered portrait"],
	// ["vibrant", "graffiti-style tiger face bursting with color splashes, neon paint splatter, bold contrast, centered on dark wall"],
	// ["epic-origami", "origami dragon folded from crisp white paper, strong shadows, minimal dark background, centered composition"],
	// ["3d-game-v2", "fantasy game character in armor standing heroically, Unreal Engine style lighting, glowing rim light, centered"],
	// ["color-painting", "abstract swirling color explosion, bold complementary colors, strong central focus, simple backdrop"],
	// ["mecha", "massive mech robot standing front-facing, glowing accents, dramatic lighting, minimal smoky background, centered"],
	// ["cgi-character", "closeup of stylized 3D cartoon hero character, Pixar-like proportions, soft gradient background, centered"],
	// ["epic", "epic fantasy warrior with cape flowing, storm clouds behind, glowing highlights, bold silhouette, centered"],
	// ["dark-fantasy", "dark armored knight in mist, glowing eyes, purple and yellow lighting contrast, moody atmosphere, centered"],
	// ["modern-comic", "closeup superhero bust portrait, bold ink lines, vibrant comic shading, flat background, centered, avoid chest emblem, dark costume"],
	// ["abstract-curves", "smooth abstract flowing neon curves on dark background, glossy reflections, centered"],
	// ["bon-voyage", "fantasy traveler with glowing lantern on cliff edge, orange and teal sky, dramatic lighting, centered"],
	// ["cubist-v2", "cubist portrait fragmented geometric face, bold color blocks, strong angular shapes, centered"],
	// ["detailed-gouache", "gouache painting of fox head, thick textured brush strokes, simple neutral background, centered"],
	// ["neo-impressionist", "neo-impressionist landscape tree silhouette, visible paint dots, bold color contrast, centered"],
	// ["pop-art", "pop art portrait with bold triadic colors, halftone dots, flat background, centered face"],
	// ["anime", "Studio Ghibli inspired character standing in golden sunlight field, soft glow, centered"],
	// ["candy-v2", "tiny,whimsical candy castle made of colorful sweets, glossy highlights, high saturation, centered"],
	// ["photo", "professional portrait photo of confident person, soft natural light, blurred background, centered"],
	// ["bw-portrait", "black and white close-up portrait with dramatic shadows, strong texture, centered face"],
	// ["color-portrait", "color studio portrait, vibrant skin tones, clean backdrop, centered head-and-shoulders"],
	// ["oil-painting", "classical oil painting portrait, rich brush strokes, dark background, centered composition"],
	// ["cosmic", "closeup of a rich and colorful, glowing nebula, vibrant purples and blues, centered"],
	// ["sinister", "hooded figure with faint glowing eyes in darkness, high contrast shadows, centered"],
	// ["candy", "bright candy swirl lollipop close-up, saturated colors, simple background, centered"],
	// ["cubist", "cubist still life geometric fruit arrangement, bold shapes, centered"],
	// ["3d-game", "fantasy game hero character mid-shot, dynamic lighting, clean background, centered"],
	// ["fantasy", "ethereal elf standing in glowing forest mist, soft light beams, centered"],
	// ["gouache", "gouache style painted mountain peak, thick brush texture, simple sky, centered"],
	// ["matte", "fantasy matte painting castle on cliff, dramatic sky, strong silhouette, centered"],
	// ["charcoal", "charcoal sketch portrait, heavy shading, high contrast, white background, centered"],
	// ["horror", "horror creature emerging from darkness, sharp lighting from below, centered"],
	// ["surreal", "surreal melting clock floating in minimal desert, bold shapes, centered composition"],
	// ["steampunk", "steampunk mechanical owl with brass gears, centered, dark background"],
	// ["cyberpunk", "cyberpunk city skyline with neon lights, strong magenta and teal contrast, centered focal building"],
	// ["synthwave", "synthwave sunset with grid horizon and neon sun, bold pink and purple, centered"],
	// ["heavenly", "angelic figure in bright clouds, sunbeams radiating, soft glow, centered"],
];

await mkdir(OUT_DIR, { recursive: true });

for (const [key, prompt] of PROMPTS) {
	try {
		const res = await fetch("http://localhost:3000/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.e30.Kd92aQ",
				"Referer": "http://localhost:3000/",
				"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
			},
			body: JSON.stringify({ method: "fluxImage", args: { prompt } }),
		});
		if (!res.ok) throw new Error(`API ${res.status}`);
		const buffer = Buffer.from(await res.arrayBuffer());
		await sharp(buffer)
			.resize(160, 160)
			.extract({ left: 10, top: 0, width: 140, height: 160 })
			.webp({ quality: 85 })
			.toFile(join(OUT_DIR, `${key}.webp`));
		console.log(key);
	} catch (err) {
		console.error(`${key}: ${err.message}`);
	}
}
console.log("Done.");
