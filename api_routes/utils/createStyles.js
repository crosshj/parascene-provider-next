/**
 * Server-only: style presets with modifiers for prompt transformation.
 * Keys match data-key on .create-style-card in create.html.
 * Do not use entries after "///NOTE: DO NOT USE AFTER THIS POINT" from the plan.
 */
export const CREATE_STYLES = {
	none: { title: 'None', modifiers: '' },
	default: { title: 'Default', modifiers: 'detailed matte painting, deep color, fantastical, intricate detail, splash screen, complementary colors, fantasy concept art, 8k resolution trending on Artstation Unreal Engine 5' },
	isometricVoxel: { title: "Isometric Voxel", modifiers: 'isometric voxel art' },
	cinematic: { title: 'Cinematic', modifiers: 'Cinematic film still, shot on v-raptor XL, film grain, vignette, color graded, post-processed, cinematic lighting, 35mm film, live-action, best quality, atmospheric, a masterpiece, epic, stunning, dramatic' },
	'realistic-anime': { title: 'Realistic Anime', modifiers: 'By artist "anime", 3d anime art, inspired by WLOP, Artstation, #genshinimpact pixiv, extremely detailed, aesthetic, concept art, ultrafine detail, breathtaking, 8k resolution, vray tracing' },
	'artistic-portrait': { title: 'Artistic Portrait', modifiers: 'head and shoulders portrait, 8k resolution concept art portrait by Greg Rutkowski, Artgerm, WLOP, Alphonse Mucha dynamic lighting hyperdetailed intricately detailed Splash art trending on Artstation triadic colors Unreal Engine 5 volumetric lighting' },
	striking: { title: 'Striking', modifiers: 'intricate details, HDR, beautifully shot, hyperrealistic, sharp focus, 64 megapixels, perfect composition, high contrast, cinematic, atmospheric, moody' },
	'2-5d-anime': { title: '2.5D Anime', modifiers: 'Masterpiece, Best Quality, flat, Manga Scan, Anime, cinematic lighting, drawn Art, by Studio Trigger, clip studio paint, Anime Wallpaper, Deep Color, Cel-Shaded' },
	'anime-v2': { title: 'Anime v2', modifiers: 'by artist "anime", Anime Key Visual, Japanese Manga, Pixiv, Zerochan, Anime art, Fantia' },
	hyperreal: { title: 'Hyperreal', modifiers: 'Hyperrealistic, splash art, concept art, mid shot, intricately detailed, color depth, dramatic, 2/3 face angle, side light, colorful background' },
	vibrant: { title: 'Vibrant', modifiers: 'graffiti art, splash art, street art, spray paint, oil gouache melting, acrylic, high contrast, colorful polychromatic, ultra detailed, ultra quality, CGSociety' },
	'epic-origami': { title: 'Epic Origami', modifiers: 'Origami paper folds papercraft, made of paper, stationery, 8K resolution 64 megapixels soft focus' },
	'3d-game-v2': { title: '3D Game v2', modifiers: '3D Game Cinematic Feel, Epic 3D Videogame Graphics, Intricately Detailed, 8K Resolution, Dynamic Lighting, Unreal Engine 5, CryEngine, Trending on ArtStation, HDR, 3D Masterpiece, Unity Render, Perfect Composition' },
	'color-painting': { title: 'Color Painting', modifiers: 'abstract art complementary colors fine details' },
	mecha: { title: 'Mecha', modifiers: 'intricate mech details, ground level shot, 8K resolution, Cinema 4D, Behance HD, polished metal, Unreal Engine 5, rendered in Blender, sci-fi, futuristic, trending on Artstation, epic, cinematic background, dramatic, atmospheric' },
	'cgi-character': { title: 'CGI Character', modifiers: 'Pixar, Disney, concept art, 3d digital art, Maya 3D, ZBrush Central 3D shading, bright colored background, radial gradient background, cinematic, Reimagined by industrial light and magic, 4k resolution post processing' },
	epic: { title: 'Epic', modifiers: 'Epic cinematic brilliant stunning intricate meticulously detailed dramatic atmospheric maximalist digital matte painting' },
	'dark-fantasy': { title: 'Dark Fantasy', modifiers: 'a masterpiece, 8k resolution, dark fantasy concept art, by Greg Rutkowski, dynamic lighting, hyperdetailed, intricately detailed, Splash screen art, trending on Artstation, deep color, Unreal Engine, volumetric lighting, Alphonse Mucha, Jordan Grimmer, purple and yellow complementary colours' },
	'modern-comic': { title: 'Modern Comic', modifiers: 'Mark Brooks and Dan Mumford, comic book art, perfect, smooth' },
	'abstract-curves': { title: 'Abstract Curves', modifiers: 'abstract vector fractal, wave function, Zentangle, 3d shading' },
	'bon-voyage': { title: 'Bon Voyage', modifiers: '8k resolution concept art by Greg Rutkowski dynamic lighting hyperdetailed intricately detailed Splash art trending on Artstation triadic colors Unreal Engine 5 volumetric lighting Alphonse Mucha WLOP Jordan Grimmer orange and teal' },
	'cubist-v2': { title: 'Cubist v2', modifiers: 'cubist painting, Neo-Cubism, layered overlapping geometry, art deco painting, Dribbble, geometric fauvism, layered geometric vector art, maximalism; V-Ray, Unreal Engine 5, angular oil painting, DeviantArt' },
	'detailed-gouache': { title: 'Detailed Gouache', modifiers: 'in Gouache Style, Watercolor, Museum Epic Impressionist Maximalist Masterpiece, Thick Brush Strokes, Impasto Gouache, thick layers of gouache watercolors textured on Canvas, 8k Resolution, Matte Painting' },
	'neo-impressionist': { title: 'Neo Impressionist', modifiers: 'neo-impressionism expressionist style oil painting, smooth post-impressionist impasto acrylic painting, thick layers of colourful textured paint' },
	'pop-art': { title: 'Pop Art', modifiers: 'Screen print, pop art, splash screen art, triadic colors, digital art, 8k resolution trending on Artstation, golden ratio, symmetrical, rule of thirds, geometric bauhaus' },
	anime: { title: 'Anime', modifiers: 'Studio Ghibli, Anime Key Visual, by Makoto Shinkai, Deep Color, Intricate, 8k resolution concept art, Natural Lighting, Beautiful Composition' },
	'candy-v2': { title: 'Candy v2', modifiers: 'Candy art style! Whimsical playful colorful! candy!!! 🍬🍭 Candyland art!! "Hyperrealistic hyperdetailed highly detailed, digital illustration" postmodernism, artstation, poster art, dynamic lighting, cel-shaded, ray tracing reflections' },
	photo: { title: 'Photo', modifiers: 'Professional photography, bokeh, natural lighting, canon lens, shot on dslr 64 megapixels sharp focus' },
	'bw-portrait': { title: 'B&W Portrait', modifiers: 'Close up portrait, ambient light, Nikon 15mm f/1.8G, by Lee Jeffries, Alessio Albi, Adrian Kuipers' },
	'color-portrait': { title: 'Color Portrait', modifiers: 'Close-up portrait, color portrait, Linkedin profile picture, professional portrait photography by Martin Schoeller, by Mark Mann, by Steve McCurry, bokeh, studio lighting, canon lens, shot on dslr, 64 megapixels, sharp focus' },
	'oil-painting': { title: 'Oil Painting', modifiers: 'oil painting by James Gurney' },
	cosmic: { title: 'Cosmic', modifiers: '8k resolution holographic astral cosmic illustration mixed media by Pablo Amaringo' },
	sinister: { title: 'Sinister', modifiers: 'sinister by Greg Rutkowski' },
	candy: { title: 'Candy', modifiers: 'vibrant colors Candyland wonderland gouache swirls detailed' },
	cubist: { title: 'Cubist', modifiers: 'abstract cubism Euclidean Georgy Kurasov Albert Gleizes' },
	'3d-game': { title: '3D Game', modifiers: 'trending on Artstation Unreal Engine 3D shading shadow depth' },
	fantasy: { title: 'Fantasy', modifiers: 'ethereal fantasy hyperdetailed mist Thomas Kinkade' },
	gouache: { title: 'Gouache', modifiers: 'gouache detailed painting' },
	matte: { title: 'Matte', modifiers: 'detailed matte painting' },
	charcoal: { title: 'Charcoal', modifiers: 'hyperdetailed charcoal drawing' },
	horror: { title: 'Horror', modifiers: 'horror Gustave Doré Greg Rutkowski' },
	surreal: { title: 'Surreal', modifiers: 'surrealism Salvador Dali matte background melting oil on canvas' },
	steampunk: { title: 'Steampunk', modifiers: 'steampunk engine' },
	cyberpunk: { title: 'Cyberpunk', modifiers: 'cyberpunk 2099 blade runner 2049 neon' },
	synthwave: { title: 'Synthwave', modifiers: 'synthwave neon retro' },
	heavenly: { title: 'Heavenly', modifiers: 'heavenly sunshine beams divine bright soft focus holy in the clouds' },
};

/**
 * Get full style info for a key (used for prompt transformation and meta.style).
 * @param {string} key - data-key of the style
 * @returns {{ key: string, label: string, modifiers: string } | null}
 */
export function getStyleInfo(key) {
	if (!key || typeof key !== 'string') return null;
	const style = CREATE_STYLES[key];
	if (!style) return null;
	const modifiers = (style.modifiers || '').trim();
	const label = (style.title || key).trim();
	return { key, label, modifiers };
}
