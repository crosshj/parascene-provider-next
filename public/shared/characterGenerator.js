// Fairly-terse, deterministic character generator w/ huge variation.
// Usage:
//   const p = genProfile("userId-or-random-seed");
//   const mention = toMentionText(p);
//   const signature = sig(p); // send to server to de-dupe

function xmur3(str) {
	let h = 1779033703 ^ str.length;
	for (let i = 0; i < str.length; i++) {
		h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return function () {
		h = Math.imul(h ^ (h >>> 16), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		return (h ^= h >>> 16) >>> 0;
	};
}

function mulberry32(seed) {
	return function () {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick(rng, arr) {
	return arr[(rng() * arr.length) | 0];
}

function maybe(rng, p = 0.5) {
	return rng() < p;
}

// Weighted pick: items like ["commonThing", 10], ["rareThing", 1]
function wpick(rng, items) {
	let total = 0;
	for (const [, w] of items) total += w;
	let x = rng() * total;
	for (const [v, w] of items) {
		x -= w;
		if (x <= 0) return v;
	}
	return items[items.length - 1][0];
}

function cap(s) {
	return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function genProfile(seedStr, nonce = 0) {
	const seedFn = xmur3(`${seedStr}|${nonce}`);
	const rng = mulberry32(seedFn());

	const gender = wpick(rng, [
		["woman", 8],
		["man", 8],
		["person", 4],
	]);

	// human or animal (animals very likely)
	const species = wpick(rng, [
		["human", 3],
		["fox", 8],
		["wolf", 8],
		["cat", 8],
		["dog", 6],
		["rabbit", 6],
		["bear", 4],
		["mouse", 4],
		["otter", 4],
		["deer", 4],
		["lion", 4],
		["tiger", 4],
		["raccoon", 4],
		["owl", 4],
		["coyote", 3],
		["badger", 3],
		["horse", 3],
		["crow", 3],
	]);

	const ageBand = wpick(rng, [
		["teen", 2],
		["young adult", 8],
		["adult", 12],
		["middle-aged", 8],
		["older", 5],
		["elderly", 2],
	]);

	const body = wpick(rng, [
		["slim", 8],
		["petite", 5],
		["athletic", 8],
		["lean", 6],
		["average-build", 10],
		["stocky", 5],
		["broad-shouldered", 4],
		["tall and lanky", 5],
		["curvy", 5],
		["muscular", 5],
		["plus-size", 4],
		["willowy", 3],
		["compact", 4],
		["rangy", 3],
	]);

	const isHuman = species === "human";

	const skinTone = isHuman
		? wpick(rng, [
			["porcelain", 2],
			["very fair", 4],
			["fair", 8],
			["light", 10],
			["warm light", 6],
			["medium", 10],
			["olive", 8],
			["tan", 8],
			["golden", 6],
			["brown", 8],
			["deep brown", 6],
			["mahogany", 4],
			["very deep", 3],
			["ebony", 2],
		])
		: wpick(rng, [
			["reddish", 6],
			["tawny", 5],
			["gray", 6],
			["white", 4],
			["cream", 4],
			["brown", 8],
			["black", 5],
			["sandy", 5],
			["mottled", 3],
			["striped", 3],
			["rust", 4],
			["pale", 4],
			["golden", 5],
			["dark", 5],
		]);

	const face = isHuman
		? pick(rng, [
			"oval face",
			"round face",
			"square jaw",
			"heart-shaped face",
			"angular face",
			"long face",
			"diamond-shaped face",
			"oblong face",
			"soft round cheeks",
			"high cheekbones",
			"strong jawline",
			"delicate features",
		])
		: pick(rng, [
			"pointed muzzle",
			"rounded muzzle",
			"sharp ears",
			"floppy ears",
			"tufted ears",
			"broad snout",
			"narrow snout",
			"expressive eyes",
			"large round eyes",
			"alert ears",
			"soft features",
			"strong jaw",
		]);

	const eyes = pick(rng, [
		"brown eyes",
		"dark brown eyes",
		"hazel eyes",
		"green eyes",
		"blue eyes",
		"gray eyes",
		"amber eyes",
		"deep-set brown eyes",
		"almond-shaped hazel eyes",
		"bright blue eyes",
		"steel gray eyes",
		"warm brown eyes",
		"light green eyes",
		"dark eyes",
		"heterochromia (one blue, one green)",
	]);

	let hair = null;
	if (isHuman) {
		const hairLen = wpick(rng, [
			["buzz cut", 2],
			["pixie cut", 4],
			["short", 10],
			["chin-length", 6],
			["shoulder-length", 10],
			["medium-length", 10],
			["long", 8],
			["very long", 4],
			["shaved", 2],
		]);
		const hairTex = pick(rng, [
			"straight",
			"wavy",
			"curly",
			"coily",
			"loose waves",
			"tight curls",
			"kinky",
			"silky straight",
		]);
		const hairColor = pick(rng, [
			"black",
			"jet black",
			"dark brown",
			"brown",
			"light brown",
			"auburn",
			"copper",
			"blonde",
			"dirty blonde",
			"platinum",
			"silver",
			"gray",
			"salt-and-pepper",
			"red",
			"burgundy",
			"streaked",
		]);
		const hairStyle = wpick(rng, [
			["", 15],
			["in a low ponytail", 4],
			["in a high ponytail", 3],
			["in a bun", 4],
			["in braids", 3],
			["swept back", 3],
			["with bangs", 4],
			["sideswept", 3],
			["messy", 2],
			["slicked back", 2],
		]);
		hair = hairStyle
			? `${hairLen} ${hairTex} ${hairColor} hair ${hairStyle}`
			: `${hairLen} ${hairTex} ${hairColor} hair`;
	}

	const glasses = maybe(rng, 0.42)
		? pick(rng, [
			"round glasses",
			"oval glasses",
			"square glasses",
			"rectangular frames",
			"thin metal frames",
			"black-frame glasses",
			"tortoiseshell glasses",
			"cat-eye glasses",
			"wire-rimmed glasses",
			"oversized glasses",
			"rimless glasses",
			"half-frame glasses",
			"aviator-style glasses",
			"geek-chic glasses",
		])
		: null;

	const feature = isHuman
		? wpick(rng, [
			["freckles", 8],
			["a small scar on the eyebrow", 2],
			["a beauty mark", 4],
			["dimples", 5],
			["a gap tooth", 2],
			["a nose ring", 3],
			["a subtle cheek tattoo", 1],
			["heterochromia", 1],
			["a lip ring", 1],
			["pierced ears", 4],
			["a birthmark on the neck", 2],
			["crow's feet when they smile", 3],
			["a small chin dimple", 2],
			["high arched eyebrows", 3],
			["a mole above the lip", 2],
			["sun-kissed cheeks", 3],
			["a tiny star tattoo behind the ear", 1],
		])
		: wpick(rng, [
			["long whiskers", 6],
			["a nicked ear", 3],
			["ear tufts", 5],
			["a bushy tail", 5],
			["a scar across the muzzle", 2],
			["gaunt look", 4],
			["dark ear tips", 4],
			["a white chest patch", 3],
			["ringed tail", 2],
			["tufted tail", 3],
			["bright markings", 4],
			["soft ear edges", 3],
			["a notch in one ear", 3],
			["thick ruff", 3],
		]);

	const vibe = wpick(rng, [
		["skater", 4],
		["streetwear fan", 7],
		["coffee-shop regular", 6],
		["bookish", 7],
		["techy", 7],
		["outdoorsy", 6],
		["artist", 6],
		["musician", 5],
		["retro", 5],
		["minimalist", 6],
		["mysterious", 4],
		["bohemian", 5],
		["preppy", 4],
		["goth", 3],
		["punk", 3],
		["vintage", 5],
		["sporty", 5],
		["academic", 5],
		["wanderlust", 4],
		["cozy", 5],
		["edgy", 4],
		["whimsical", 3],
		["stoic", 3],
		["warm", 5],
		["quirky", 4],
	]);

	const color = pick(rng, [
		"black",
		"white",
		"navy",
		"charcoal",
		"gray",
		"olive",
		"teal",
		"crimson",
		"burgundy",
		"mustard",
		"lavender",
		"cobalt",
		"forest green",
		"rust",
		"cream",
		"maroon",
		"sage",
		"terracotta",
		"dusty rose",
		"camel",
		"emerald",
		"coral",
		"slate",
		"moss",
	]);
	const pattern = wpick(rng, [
		["solid", 14],
		["striped", 6],
		["checker", 3],
		["plaid", 4],
		["speckled", 2],
		["floral", 3],
		["geometric", 3],
		["paisley", 2],
		["camouflage", 2],
		["houndstooth", 2],
		["polka dot", 2],
		["tie-dye", 1],
		["argyle", 2],
	]);

	const top = pick(rng, [
		"hoodie",
		"oversized hoodie",
		"bomber jacket",
		"denim jacket",
		"leather jacket",
		"crewneck sweater",
		"turtleneck",
		"t-shirt",
		"graphic tee",
		"button-up shirt",
		"flannel shirt",
		"cardigan",
		"track jacket",
		"blazer",
		"vest",
		"crop top",
		"tank top",
		"henley",
		"polo shirt",
		"wrap top",
		"blouse",
		"tunic",
		"quarter-zip",
	]);
	const bottom = pick(rng, [
		"jeans",
		"skinny jeans",
		"wide-leg pants",
		"cargo pants",
		"chinos",
		"joggers",
		"shorts",
		"skirt",
		"midi skirt",
		"trousers",
		"palazzo pants",
		"corduroy pants",
		"high-waisted jeans",
		"culottes",
		"leggings",
	]);
	const shoes = pick(rng, [
		"sneakers",
		"boots",
		"ankle boots",
		"loafers",
		"high-tops",
		"running shoes",
		"slip-ons",
		"oxfords",
		"mules",
		"sandals",
		"combat boots",
		"chelsea boots",
		"espadrilles",
		"canvas shoes",
		"platform sneakers",
	]);

	const accessory = maybe(rng, 0.62)
		? pick(rng, [
			"a small pendant necklace",
			"a chunky watch",
			"a simple ring",
			"a canvas tote bag",
			"a crossbody bag",
			"a beanie",
			"a baseball cap",
			"a bucket hat",
			"a scarf",
			"a single earring",
			"a set of bracelets",
			"a chain necklace",
			"round hoop earrings",
			"stud earrings",
			"a leather belt",
			"a fanny pack",
			"a messenger bag",
			"a knit beanie",
			"a headband",
			"a bandana",
			"a silk scarf",
			"a statement ring",
			"a nose stud",
			"a septum ring",
			"a backpack",
		])
		: null;

	const topStr = `${color} ${pattern === "solid" ? "" : pattern + " "} ${top}`.replace(/\s+/g, " ").trim();

	// Animals have low likelihood of wearing clothes
	const wearsOutfit = species === "human" || maybe(rng, 0.18);

	return {
		gender,
		species,
		ageBand,
		body,
		skinTone,
		face,
		eyes,
		hair,
		glasses,
		feature,
		vibe,
		wearsOutfit,
		outfit: {
			top: topStr,
			bottom,
			shoes,
			accessory,
		},
	};
}

export function toMentionText(p) {
	const skinOrFur = p.species === "human" ? "skin" : "fur";
	const faceAndEyes = p.hair ? `a ${p.face}, ${p.hair}, and ${p.eyes}` : `a ${p.face} and ${p.eyes}`;
	const intro =
		p.species === "human"
			? `A ${p.body} ${p.ageBand} ${p.gender} with ${p.skinTone} ${skinOrFur}, ${faceAndEyes}`
			: `A ${p.body} ${p.ageBand} ${p.species} with ${p.skinTone} ${skinOrFur}, ${faceAndEyes}`;
	const bits = [
		intro,
		p.glasses ? `wearing ${p.glasses}` : null,
		`with ${p.feature}`,
		p.wearsOutfit ? `dressed in a ${p.outfit.top}, ${p.outfit.bottom}, and ${p.outfit.shoes}` : null,
		p.wearsOutfit && p.outfit.accessory ? `plus ${p.outfit.accessory}` : null,
		`${cap(p.vibe)} vibe.`,
	].filter(Boolean);
	return bits.join(", ");
}

// Canonical signature string (send to server; hash + store to de-dupe)
export function sig(p) {
	const norm = (v) => (v == null ? "" : String(v).toLowerCase().replace(/\s+/g, " ").trim());
	const parts = [
		p.gender,
		p.species,
		p.ageBand,
		p.body,
		p.skinTone,
		p.face,
		p.eyes,
		p.hair,
		p.glasses,
		p.feature,
		p.vibe,
		String(Boolean(p.wearsOutfit)),
		p.outfit?.top,
		p.outfit?.bottom,
		p.outfit?.shoes,
		p.outfit?.accessory,
	].map(norm);
	return parts.join("|");
}
