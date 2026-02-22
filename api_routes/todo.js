import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TODO_PATH = path.resolve(__dirname, "..", "_docs", "TODO.json");

// pre-release
// priority: 100 (highest) .. 1 (lowest)
// Goal: Get something real into users’ hands fast.
// Impact dominates unless time gets too high.
function computePriority(time, impact) {
	if (!Number.isFinite(time) || !Number.isFinite(impact)) return 1;

	const MIN = 1, MAX = 100;

	// --- weighting knobs (tweak later) ---
	const timeScale = 100; // time at which priority bottoms out
	const timeCurve = 2;   // 1=linear, 2=quadratic, 3+=harsher
	const timeWeight = 1;   // >1 makes time matter more

	// --- normalize inputs ---
	const i = clamp(impact, 0, MAX);
	const t = clamp(time / timeScale, 0, 1);

	// --- time suppresses impact ---
	const penalty = clamp(timeWeight * Math.pow(t, timeCurve), 0, 1);
	const rawScore = i * (1 - penalty);

	// map 0..100 → 1..100
	return clamp(Math.round(rawScore || MIN), MIN, MAX);

	function clamp(n, lo, hi) {
		return Math.max(lo, Math.min(hi, n));
	}
}

// post-release
// Goal: Allocate effort efficiently under real constraints.
// priority: 100 (highest) .. 1 (lowest)
// Impact dominates, but time progressively taxes it (no hard cutoff).
function computePriorityRatio(time, impact) {
	if (!Number.isFinite(time) || !Number.isFinite(impact)) return 1;

	const MIN = 1, MAX = 100;

	// --- weighting knobs (tweak later) ---
	const timeScale = 100; // time where cost meaningfully bites
	const timeCurve = 2;   // 1=linear, 2=quadratic, 3+=harsher
	const timeWeight = 1;   // >1 makes time matter more

	// --- normalize inputs ---
	const i = clamp(impact, 0, MAX);
	const t = Math.max(0, time / timeScale);

	// --- time taxes impact (ratio form) ---
	// denominator grows smoothly; impact can still win
	const cost = timeWeight * Math.pow(t, timeCurve);
	const rawScore = i / (1 + cost);

	// map 0..100 → 1..100
	return clamp(Math.round(rawScore || MIN), MIN, MAX);

	function clamp(n, lo, hi) {
		return Math.max(lo, Math.min(hi, n));
	}
}

function computePriorityImpact(time, impact) {
	if (!Number.isFinite(impact)) return 1;
	return clamp(Math.round(impact), 1, 100);

	function clamp(n, lo, hi) {
		return Math.max(lo, Math.min(hi, n));
	}
}

function computePriorityCost(time, impact) {
	if (!Number.isFinite(time)) return 1;
	return clamp(Math.round(time), 1, 100);

	function clamp(n, lo, hi) {
		return Math.max(lo, Math.min(hi, n));
	}
}

function computeProbability(time) {
	if (!Number.isFinite(time)) return 0;
	return Math.max(0, Math.min(100, Math.round(100 - time)));
}

function normalizeDependencies(dependsOn) {
	if (!Array.isArray(dependsOn)) return [];
	const seen = new Set();
	const normalized = [];
	for (const raw of dependsOn) {
		const dep = String(raw || "").trim();
		if (!dep) continue;
		if (seen.has(dep)) continue;
		seen.add(dep);
		normalized.push(dep);
	}
	return normalized;
}

function normalizeTodoItem(item, computeFn = computePriority) {
	const name = String(item?.name || "").trim();
	const description = String(item?.description || "").trim();
	const cost = Number(item?.cost ?? item?.time);
	const impact = Number(item?.impact);
	const dependsOn = normalizeDependencies(item?.dependsOn).filter((dep) => dep !== name);
	const priority = Number.isFinite(cost) && Number.isFinite(impact)
		? computeFn(cost, impact)
		: 0;
	const probability = Number.isFinite(cost)
		? computeProbability(cost)
		: 0;
	return {
		name,
		description,
		cost,
		impact,
		dependsOn,
		priority,
		probability,
		starred: Boolean(item?.starred)
	};
}

function applyDependencyPriority(items) {
	const byName = new Map(items.map((item) => [item.name, item]));
	let updated = true;
	let guard = 0;
	const maxIterations = Math.max(items.length * 4, 10);

	while (updated && guard < maxIterations) {
		updated = false;
		guard += 1;
		for (const item of items) {
			for (const depName of item.dependsOn || []) {
				const dependency = byName.get(depName);
				if (!dependency) continue;
				if (item.priority >= dependency.priority) {
					const boostedPriority = Math.min(100, item.priority + 1);
					if (boostedPriority > dependency.priority) {
						dependency.priority = boostedPriority;
						updated = true;
					}
				}
			}
		}
	}
}

function buildDependencyMap(items) {
	const map = new Map();
	for (const item of items || []) {
		const name = String(item?.name || "").trim();
		if (!name) continue;
		const deps = normalizeDependencies(item?.dependsOn);
		map.set(name, deps);
	}
	return map;
}

function canReach(from, target, map, visited = new Set()) {
	if (!from || !target) return false;
	if (from === target) return true;
	if (visited.has(from)) return false;
	visited.add(from);
	const deps = map.get(from) || [];
	for (const dep of deps) {
		if (canReach(dep, target, map, visited)) return true;
	}
	return false;
}

function wouldCreateCycle({ items, itemName, dependsOn }) {
	const name = String(itemName || "").trim();
	if (!name) return false;
	const deps = normalizeDependencies(dependsOn).filter((dep) => dep !== name);
	if (!deps.length) return false;
	const map = buildDependencyMap(items);
	// treat the edited item's deps as the new truth
	map.set(name, deps);
	return deps.some((dep) => canReach(dep, name, map));
}

async function readTodoItems({ mode } = {}) {
	const normalizedMode =
		mode === "post" ? "ratio"
			: mode === "pre" ? "gated"
				: mode;

	const computeFn =
		normalizedMode === "ratio"
			? computePriorityRatio
			: normalizedMode === "impact"
				? computePriorityImpact
				: normalizedMode === "cost"
					? computePriorityCost
					: computePriority;
	const raw = await fs.readFile(TODO_PATH, "utf8");
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed)) return [];
	const items = parsed.map((item) => normalizeTodoItem(item, computeFn));
	applyDependencyPriority(items);
	return items;
}

async function writeTodoItems(items) {
	const normalized = items.map((item, index) => ({
		...normalizeTodoItem(item),
		order: index
	}));
	applyDependencyPriority(normalized);
	normalized.sort((a, b) => {
		if (b.priority !== a.priority) return b.priority - a.priority;
		return a.order - b.order;
	});
	const serialized = normalized.map(({ name, description, cost, impact, dependsOn, starred }) => ({
		name,
		description,
		cost,
		impact,
		dependsOn,
		starred: Boolean(starred)
	}));
	await fs.writeFile(TODO_PATH, JSON.stringify(serialized, null, 2), "utf8");
}

export default function createTodoRoutes() {
	const router = express.Router();

	router.get("/api/todo", async (req, res) => {
		try {
			const rawMode = String(req.query?.mode || "");
			const mode =
				rawMode === "post" ? "ratio"
					: rawMode === "pre" ? "gated"
						: rawMode === "ratio" || rawMode === "impact" || rawMode === "cost"
							? rawMode
							: "gated";

			const items = await readTodoItems({ mode });
			const formula = mode === "ratio"
				? "round(Impact / (1 + (Cost/100)^2)), deps bumped +1"
				: mode === "impact"
					? "round(Impact), deps bumped +1"
					: mode === "cost"
						? "round(Cost), deps bumped +1"
						: "round(Impact * (1 - (Cost/100)^2)), deps bumped +1";

			res.json({
				items: items.map((item) => ({
					name: item.name,
					description: item.description,
					time: item.cost,
					impact: item.impact,
					dependsOn: item.dependsOn,
					priority: item.priority,
					probability: item.probability,
					starred: Boolean(item.starred)
				})),
				writable: !process.env.VERCEL,
				formula
			});
		} catch (error) {
			res.status(500).json({ error: "Failed to read TODO.json." });
		}
	});

	router.post("/api/todo", async (req, res) => {
		if (process.env.VERCEL) {
			return res.status(403).json({ error: "TODO.md writes are disabled on Vercel." });
		}

		const { name, description, time, impact, starred } = req.body || {};
		const normalizedName = String(name || "").trim();
		const normalizedDescription = String(description || "").trim();
		const timeValue = Number(time);
		const impactValue = Number(impact);
		const starredValue = Boolean(starred);

		if (!normalizedName || !normalizedDescription) {
			return res.status(400).json({ error: "Name and description are required." });
		}
		if (!Number.isFinite(timeValue) || timeValue < 1 || timeValue > 100) {
			return res.status(400).json({ error: "Time must be a number from 1 to 100." });
		}
		if (!Number.isFinite(impactValue) || impactValue < 1 || impactValue > 100) {
			return res.status(400).json({ error: "Impact must be a number from 1 to 100." });
		}

		try {
			const items = await readTodoItems();
			const priorityValue = computePriority(timeValue, impactValue);
			const probabilityValue = computeProbability(timeValue);
			const dependsOnValue = normalizeDependencies(req.body?.dependsOn).filter((dep) => dep !== normalizedName);
			if (wouldCreateCycle({ items, itemName: normalizedName, dependsOn: dependsOnValue })) {
				return res.status(400).json({ error: "Invalid dependency: would create a circular dependency." });
			}
			items.push({
				name: normalizedName,
				description: normalizedDescription,
				cost: timeValue,
				impact: impactValue,
				dependsOn: dependsOnValue,
				starred: starredValue,
				priority: priorityValue,
				probability: probabilityValue
			});
			await writeTodoItems(items);
			res.json({
				ok: true,
				item: {
					name: normalizedName,
					description: normalizedDescription,
					time: timeValue,
					impact: impactValue,
					dependsOn: dependsOnValue,
					starred: starredValue,
					priority: priorityValue,
					probability: probabilityValue
				}
			});
		} catch (error) {
			res.status(500).json({ error: "Failed to update TODO.json." });
		}
	});

	router.put("/api/todo", async (req, res) => {
		if (process.env.VERCEL) {
			return res.status(403).json({ error: "TODO.md writes are disabled on Vercel." });
		}

		const { originalName, name, description, time, impact, starred } = req.body || {};
		const normalizedOriginal = String(originalName || "").trim();
		const normalizedName = String(name || "").trim();
		const normalizedDescription = String(description || "").trim();
		const timeValue = Number(time);
		const impactValue = Number(impact);
		const starredValue = Boolean(starred);

		if (!normalizedOriginal) {
			return res.status(400).json({ error: "Original name is required." });
		}
		if (!normalizedName || !normalizedDescription) {
			return res.status(400).json({ error: "Name and description are required." });
		}
		if (!Number.isFinite(timeValue) || timeValue < 1 || timeValue > 100) {
			return res.status(400).json({ error: "Time must be a number from 1 to 100." });
		}
		if (!Number.isFinite(impactValue) || impactValue < 1 || impactValue > 100) {
			return res.status(400).json({ error: "Impact must be a number from 1 to 100." });
		}

		try {
			const items = await readTodoItems();
			const priorityValue = computePriority(timeValue, impactValue);
			const probabilityValue = computeProbability(timeValue);
			const dependsOnValue = normalizeDependencies(req.body?.dependsOn).filter((dep) => dep !== normalizedName);
			const updatedItems = items.map((item) => {
				// keep dependencies consistent if we rename an item
				const nextDepends = normalizedOriginal !== normalizedName && Array.isArray(item.dependsOn)
					? item.dependsOn.map((dep) => dep === normalizedOriginal ? normalizedName : dep)
					: item.dependsOn;

				if (item.name !== normalizedOriginal) {
					return {
						...item,
						dependsOn: normalizeDependencies(nextDepends).filter((dep) => dep !== item.name)
					};
				}

				return {
					name: normalizedName,
					description: normalizedDescription,
					cost: timeValue,
					impact: impactValue,
					dependsOn: dependsOnValue,
					starred: starredValue,
					priority: priorityValue,
					probability: probabilityValue
				};
			});

			if (wouldCreateCycle({ items: updatedItems, itemName: normalizedName, dependsOn: dependsOnValue })) {
				return res.status(400).json({ error: "Invalid dependency: would create a circular dependency." });
			}
			await writeTodoItems(updatedItems);
			res.json({
				ok: true,
				item: {
					name: normalizedName,
					description: normalizedDescription,
					time: timeValue,
					impact: impactValue,
					dependsOn: dependsOnValue,
					starred: starredValue,
					priority: priorityValue,
					probability: probabilityValue
				}
			});
		} catch (error) {
			res.status(500).json({ error: "Failed to update TODO.json." });
		}
	});

	router.patch("/api/todo", async (req, res) => {
		if (process.env.VERCEL) {
			return res.status(403).json({ error: "TODO.md writes are disabled on Vercel." });
		}

		const { name, starred } = req.body || {};
		const normalizedName = String(name || "").trim();
		const starredValue = Boolean(starred);

		if (!normalizedName) {
			return res.status(400).json({ error: "Name is required." });
		}

		try {
			const items = await readTodoItems();
			const found = items.find((item) => item.name === normalizedName);
			if (!found) {
				return res.status(404).json({ error: "Todo item not found." });
			}
			found.starred = starredValue;
			await writeTodoItems(items);
			res.json({ ok: true, item: { name: found.name, starred: found.starred } });
		} catch (error) {
			res.status(500).json({ error: "Failed to update TODO.json." });
		}
	});

	router.delete("/api/todo", async (req, res) => {
		if (process.env.VERCEL) {
			return res.status(403).json({ error: "TODO.md writes are disabled on Vercel." });
		}

		const { name } = req.body || {};
		const normalizedName = String(name || "").trim();
		if (!normalizedName) {
			return res.status(400).json({ error: "Name is required." });
		}

		try {
			const items = await readTodoItems();
			const updatedItems = items.filter((item) => item.name !== normalizedName);
			await writeTodoItems(updatedItems);
			res.json({ ok: true });
		} catch (error) {
			res.status(500).json({ error: "Failed to delete todo item." });
		}
	});

	return router;
}
