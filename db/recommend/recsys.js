// Barebones "after-detail" recommender for image feeds.
// ES module, no deps, deterministic RNG support for tests.

const DEFAULT_CONFIG = {
		// Signal weights (map these to your UI controls)
	lineageWeight: 100,
	sameCreatorWeight: 50,
	sameServerMethodWeight: 80,
	clickNextWeight: 50,
	fallbackWeight: 20,

	// Transition behavior
	transitionCapPerFrom: 50,
	decayHalfLifeDays: 7,
	windowDays: 0, // 0 => use decay only

	// Random & caps
	randomSlotsPerBatch: 0,
	clickNextPriorityFraction: 0.65,
	hardPreference: true,
	candidateCapPerSignal: 100,
	batchSize: 20,
	lineageMinSlots: 2,

	fallbackEnabled: true,
	coldMode: 'auto', // auto | guess | explore
	coldConfidenceThreshold: 0.35,
	coldExploreFraction: 0.7,
	coldExploreMinGuessSlots: 2,
	now: () => Date.now(),
	rng: Math.random
};

export function recommend({ config = {}, anchor, pool, transitions, userId = null }) {
	const cfg = {
		...DEFAULT_CONFIG,
		...config
	};
	if (!anchor) throw new Error("anchor is required");
	if (!Array.isArray(pool)) throw new Error("pool must be an array");
	if (!Array.isArray(transitions)) throw new Error("transitions must be an array");

	const poolById = new Map(pool.map(x => [x.id, x]));
	const anchorTs = +new Date(anchor.created_at || cfg.now());

		// 1) Candidate buckets
		const buckets = {
			lineage: [],
			sameCreator: [],
			sameServerMethod: [],
			clickNext: [],
			fallback: []
		};

		for (const item of pool) {
			if (item.id === anchor.id) continue;
			if (!item.published && item.published !== undefined) continue;

			if (isSameLineage(anchor, item)) buckets.lineage.push(item);
			if (item.user_id === anchor.user_id) buckets.sameCreator.push(item);
			if (sameServerMethod(anchor, item)) buckets.sameServerMethod.push(item);
		}

		const fromTransitions = transitions
			.filter(t => t.from_created_image_id === anchor.id && poolById.has(t.to_created_image_id))
			.slice(0, cfg.transitionCapPerFrom)
			.map(t => ({
				fromId: t.from_created_image_id,
				toId: t.to_created_image_id,
				count: t.count,
				ageDays: ageDays(t.last_updated || cfg.now(), cfg.now())
			}));

		for (const t of fromTransitions) {
			const candidate = poolById.get(t.toId);
			if (!candidate || candidate.id === anchor.id) continue;
			buckets.clickNext.push({
				item: candidate,
				t
			});
		}

		if (cfg.fallbackEnabled) {
			// "around time period" + recent random as fallback
			const around = pool.filter(item => {
				if (item.id === anchor.id) return false;
				const d = Math.abs(ageDays(item.created_at || cfg.now(), anchorTs));
				return d <= 7;
			});
			buckets.fallback = around.length ? around : pool.filter(i => i.id !== anchor.id);
		}

		// cap each signal bucket
		buckets.lineage = cap(buckets.lineage, cfg.candidateCapPerSignal);
		buckets.sameCreator = cap(buckets.sameCreator, cfg.candidateCapPerSignal);
		buckets.sameServerMethod = cap(buckets.sameServerMethod, cfg.candidateCapPerSignal);
		buckets.clickNext = cap(buckets.clickNext, cfg.candidateCapPerSignal);
		buckets.fallback = cap(buckets.fallback, cfg.candidateCapPerSignal);

		// 2) Score merge
		const scored = new Map();

		function addScore(item, delta, reason) {
			const row = scored.get(item.id) || { item, score: 0, reasons: [] };
			row.score += delta;
			row.reasons.push(reason);
			scored.set(item.id, row);
		}

		for (const item of buckets.lineage) {
			addScore(item, cfg.lineageWeight, "lineage");
		}
		for (const item of buckets.sameCreator) {
			addScore(item, cfg.sameCreatorWeight, "sameCreator");
		}
		for (const item of buckets.sameServerMethod) {
			addScore(item, cfg.sameServerMethodWeight, "sameServerMethod");
		}
		const clickScoreById = new Map();
		for (const c of buckets.clickNext) {
			const count = Math.max(0, c.t.count || 0);
			const effective = transitionEffectiveCount(
				count,
				c.t.ageDays,
				cfg.decayHalfLifeDays,
				cfg.windowDays
			);
			if (effective <= 0) continue;
			clickScoreById.set(c.item.id, (clickScoreById.get(c.item.id) || 0) + effective);
		}
		const clickMax = clickScoreById.size > 0 ? Math.max(...clickScoreById.values()) : 0;
		if (clickMax > 0) {
			for (const [itemId, clickScore] of clickScoreById) {
				const baseItem = poolById.get(itemId);
				if (!baseItem) continue;
				const row = scored.get(itemId) || { item: baseItem, score: 0, reasons: [] };
				row.clickEffectiveCount = clickScore;
				row.clickShare = clickScore / clickMax;
				row.score += cfg.clickNextWeight * (clickScore / clickMax);
				row.reasons.push("clickNext");
				scored.set(itemId, row);
			}
		}
		for (const item of buckets.fallback) {
			addScore(item, cfg.fallbackWeight * 0.1, "fallback");
		}

		let ranked = [...scored.values()]
			.sort((a, b) => b.score - a.score);

		// 3) Enforce lineage min slots
		const lineageSet = new Set(buckets.lineage.map(x => x.id));
		ranked = enforceLineageMinSlots(ranked, lineageSet, cfg.lineageMinSlots);
		ranked = dedupeRankedByItemId(ranked);

		const coldConfidence = computeColdConfidence({
			clickCandidateCount: clickScoreById.size,
			lineageCandidateCount: buckets.lineage.length,
			sameCreatorCandidateCount: buckets.sameCreator.length,
			sameServerMethodCandidateCount: buckets.sameServerMethod.length
		});
		const coldStrategy = resolveColdStrategy(cfg.coldMode, coldConfidence, cfg.coldConfidenceThreshold);

		// 4) Randomness blending
		const batchSize = cfg.batchSize;
		const randomSlotsRaw = Math.min(Math.max(0, cfg.randomSlotsPerBatch || 0), batchSize);
		const randomSlots = randomSlotsRaw;
		const deterministicSlots = Math.max(0, batchSize - randomSlots);

		const clickRanked = ranked
			.filter((x) => hasReason(x, "clickNext"))
			.sort(compareClickRows);
		const lineageRanked = ranked.filter((x) => hasReason(x, "lineage"));
		const clickSlots = cfg.hardPreference === false
			? Math.min(
				clickRanked.length,
				Math.max(0, Math.floor(deterministicSlots * Math.max(0, Math.min(1, cfg.clickNextPriorityFraction || 0))))
			)
			: Math.min(clickRanked.length, deterministicSlots);

		const topDeterministic = [];
		const used = new Set();
		for (const row of clickRanked) {
			if (topDeterministic.length >= clickSlots) break;
			if (used.has(row.item.id)) continue;
			topDeterministic.push(row);
			used.add(row.item.id);
		}
		const familyTarget = Math.min(deterministicSlots, Math.max(0, cfg.lineageMinSlots || 0));
		let familyCount = topDeterministic.filter((x) => hasReason(x, "lineage")).length;
		for (const row of lineageRanked) {
			if (topDeterministic.length >= deterministicSlots) break;
			if (familyCount >= familyTarget) break;
			if (used.has(row.item.id)) continue;
			topDeterministic.push(row);
			used.add(row.item.id);
			familyCount += 1;
		}
		for (const row of ranked) {
			if (topDeterministic.length >= deterministicSlots) break;
			if (used.has(row.item.id)) continue;
			topDeterministic.push(row);
			used.add(row.item.id);
		}

		const explorePool = buckets.fallback
			.filter((item) => !used.has(item.id))
			.map((item) => ({ item, score: 0, reasons: ["exploreRandom"] }));
		shuffleInPlace(explorePool, cfg.rng);
		const randomPick = explorePool.slice(0, randomSlots);
		const randomUsed = new Set(randomPick.map((x) => x.item.id));
		const randomFill = ranked
			.filter((x) => !used.has(x.item.id) && !randomUsed.has(x.item.id))
			.slice(0, Math.max(0, randomSlots - randomPick.length))
			.map((x) => ({ ...x, reasons: [...x.reasons, "exploreRandom"] }));

		let batch = dedupeRankedByItemId([...topDeterministic, ...randomPick, ...randomFill]);

		if (coldStrategy === 'explore') {
			const guessSlots = Math.max(0, Math.min(batchSize, cfg.coldExploreMinGuessSlots));
			const exploreSlots = Math.max(
				0,
				Math.min(batchSize - guessSlots, Math.floor(batchSize * cfg.coldExploreFraction))
			);
			const topGuess = ranked.slice(0, guessSlots);
			const usedIds = new Set(topGuess.map((x) => x.item.id));
			const explorePool = buckets.fallback
				.map((item) => ({ item, score: 0, reasons: ['exploreRandom'] }))
				.filter((row) => !usedIds.has(row.item.id));
			shuffleInPlace(explorePool, cfg.rng);
			const explorePick = explorePool.slice(0, exploreSlots);
			const remainSlots = Math.max(0, batchSize - (topGuess.length + explorePick.length));
			const fill = ranked
				.filter((x) => !usedIds.has(x.item.id))
				.slice(0, remainSlots);
			batch = dedupeRankedByItemId([...topGuess, ...explorePick, ...fill]).slice(0, batchSize);
		}
		batch.sort((a, b) => compareRows(a, b, cfg.hardPreference !== false));

	return batch.slice(0, batchSize).map(x => ({
		id: x.item.id,
		score: round2(x.score),
		reasons: x.reasons,
		click_score: Number.isFinite(x.clickEffectiveCount) ? round4(x.clickEffectiveCount) : 0,
		click_share: Number.isFinite(x.clickShare) ? round4(x.clickShare) : 0
	}));
}

// ---------- helpers ----------

function isSameLineage(a, b) {
	if (a.family_id && b.family_id) return a.family_id === b.family_id;
	const aParentId = a.meta?.mutate_of_id;
	const bParentId = b.meta?.mutate_of_id;
	if (aParentId && b.id === aParentId) return true;
	if (bParentId && a.id === bParentId) return true;
	return false;
}

function sameServerMethod(a, b) {
	return a.meta?.server_id === b.meta?.server_id && a.meta?.method === b.meta?.method;
}

function ageDays(ts, nowTs) {
	const t = +new Date(ts);
	const n = +new Date(nowTs);
	return Math.max(0, (n - t) / 86400000);
}

function transitionDecay(ageDaysVal, halfLifeDays) {
	if (!halfLifeDays || halfLifeDays <= 0) return 1;
	// 0.5^(age/halfLife)
	return Math.pow(0.5, ageDaysVal / halfLifeDays);
}

function transitionEffectiveCount(count, ageDaysVal, halfLifeDays, windowDays) {
	const hasHalfLife = Number.isFinite(halfLifeDays) && halfLifeDays > 0;
	const hasWindow = Number.isFinite(windowDays) && windowDays > 0;
	if (hasWindow && !hasHalfLife) {
		return ageDaysVal <= windowDays ? count : 0;
	}
	return count * transitionDecay(ageDaysVal, halfLifeDays);
}

function cap(arr, n) {
	return arr.length <= n ? arr : arr.slice(0, n);
}

function enforceLineageMinSlots(ranked, lineageSet, minSlots) {
	if (minSlots <= 0) return ranked;

	const inTop = ranked.slice(0, minSlots).filter(x => lineageSet.has(x.item.id)).length;
	if (inTop >= minSlots) return ranked;

	const need = minSlots - inTop;
	const lineageRest = ranked.filter(x => lineageSet.has(x.item.id));
	if (!lineageRest.length) return ranked;

	const top = ranked.slice(0, minSlots);
	const rest = ranked.slice(minSlots);

	let promoted = 0;
	const promotedItems = [];

	for (const x of lineageRest) {
		if (top.find(y => y.item.id === x.item.id)) continue;
		promotedItems.push(x);
		promoted++;
		if (promoted >= need) break;
	}

	const topNonLineage = top.filter(x => !lineageSet.has(x.item.id));
	const keptTop = top.filter(x => lineageSet.has(x.item.id));
	const fillCount = Math.max(0, minSlots - (keptTop.length + promotedItems.length));
	const survivors = topNonLineage.slice(0, fillCount);

	const rebuiltTop = [...keptTop, ...promotedItems, ...survivors]
		.sort((a, b) => b.score - a.score);

	const removedIds = new Set(topNonLineage.slice(fillCount).map(x => x.item.id));
	const rebuiltRest = [
		...rest.filter(x => !removedIds.has(x.item.id)),
		...topNonLineage.slice(fillCount)
	];

	return [...rebuiltTop, ...rebuiltRest];
}

function shuffleInPlace(arr, rng) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function round2(x) {
	return Math.round(x * 100) / 100;
}

function round4(x) {
	return Math.round(x * 10000) / 10000;
}

function dedupeRankedByItemId(ranked) {
	const deduped = [];
	const seen = new Set();
	for (const row of ranked) {
		const id = row?.item?.id;
		if (id == null || seen.has(id)) continue;
		seen.add(id);
		deduped.push(row);
	}
	return deduped;
}

function hasReason(row, reason) {
	return Array.isArray(row?.reasons) && row.reasons.includes(reason);
}

function reasonTier(row) {
	if (hasReason(row, "clickNext")) return 0;
	if (hasReason(row, "lineage")) return 1;
	if (hasReason(row, "sameCreator") || hasReason(row, "sameServerMethod") || hasReason(row, "fallback")) return 2;
	if (hasReason(row, "exploreRandom")) return 3;
	return 4;
}

function compareRows(a, b, useHardPreference) {
	if (useHardPreference) {
		const tierDelta = reasonTier(a) - reasonTier(b);
		if (tierDelta !== 0) return tierDelta;
		if (reasonTier(a) === 0) {
			const clickDelta = (b.clickEffectiveCount || 0) - (a.clickEffectiveCount || 0);
			if (clickDelta !== 0) return clickDelta;
		}
	}
	return b.score - a.score;
}

function compareClickRows(a, b) {
	const clickDelta = (b.clickEffectiveCount || 0) - (a.clickEffectiveCount || 0);
	if (clickDelta !== 0) return clickDelta;
	return b.score - a.score;
}

function computeColdConfidence({
	clickCandidateCount,
	lineageCandidateCount,
	sameCreatorCandidateCount,
	sameServerMethodCandidateCount
}) {
	const click = Math.min(1, Math.max(0, clickCandidateCount || 0) / 3) * 0.5;
	const lineage = Math.min(1, Math.max(0, lineageCandidateCount || 0) / 3) * 0.2;
	const creator = Math.min(1, Math.max(0, sameCreatorCandidateCount || 0) / 5) * 0.15;
	const serverMethod = Math.min(1, Math.max(0, sameServerMethodCandidateCount || 0) / 5) * 0.15;
	return click + lineage + creator + serverMethod;
}

function resolveColdStrategy(mode, confidence, threshold) {
	if (mode === 'guess') return 'guess';
	if (mode === 'explore') return 'explore';
	return confidence >= threshold ? 'guess' : 'explore';
}

