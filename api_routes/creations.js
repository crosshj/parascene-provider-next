import express from "express";
import { createClient } from "@supabase/supabase-js";
import Replicate from "replicate";
import { getThumbnailUrl } from "./utils/url.js";
import { getTextEmbeddingFromReplicate } from "./utils/embeddings.js";
import { recommendWithDataSource } from "../db/recommend/recsysWrapper.js";

const RELATED_LIMIT_CAP = 40;
const RELATED_EXCLUDE_IDS_CAP = 200;
const RECSYS_RANDOM_ONLY_SEEN_THRESHOLD = 120;
/** Default limit when not set; max cap for semantic related/search. */
const SEMANTIC_DEFAULT_LIMIT = 24;
const SEMANTIC_MAX_LIMIT = 100;

const SEMANTIC_MAX_OFFSET = 500;

function parseSemanticLimit(queryLimit) {
	const n = parseInt(queryLimit, 10);
	return Number.isFinite(n) && n >= 1 ? Math.min(n, SEMANTIC_MAX_LIMIT) : SEMANTIC_DEFAULT_LIMIT;
}

function parseSemanticOffset(queryOffset) {
	const n = parseInt(queryOffset, 10);
	return Number.isFinite(n) && n >= 0 ? Math.min(n, SEMANTIC_MAX_OFFSET) : 0;
}
const EMBEDDINGS_TABLE = "prsn_created_embeddings";
const RPC_NEAREST = "prsn_created_embeddings_nearest";
const SEARCH_CACHE_TABLE = "prsn_search_embedding_cache";
const RPC_SEARCH_CACHE_RECORD_USAGE = "prsn_search_embedding_cache_record_usage";

/** Normalize search query for cache key: trim, lowercase, collapse whitespace. */
function normalizeSearchQuery(q) {
	if (typeof q !== "string") return "";
	return q.trim().toLowerCase().replace(/\s+/g, " ");
}

let supabaseServiceClient = null;

function getSupabaseServiceClient() {
	if (supabaseServiceClient) return supabaseServiceClient;
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) return null;
	supabaseServiceClient = createClient(url, key);
	return supabaseServiceClient;
}

function parseRecsysConfigFromParams(params, limit) {
	return {
		lineageWeight: Math.max(0, parseInt(params["related.lineage_weight"], 10) || 100),
		lineageMinSlots: Math.max(0, parseInt(params["related.lineage_min_slots"], 10) || 2),
		sameServerMethodWeight: Math.max(0, parseInt(params["related.same_server_method_weight"], 10) || 80),
		sameCreatorWeight: Math.max(0, parseInt(params["related.same_creator_weight"], 10) || 50),
		fallbackWeight: Math.max(0, parseInt(params["related.fallback_weight"], 10) || 20),
		candidateCapPerSignal: Math.max(1, Math.min(500, parseInt(params["related.candidate_cap_per_signal"], 10) || 100)),
		randomSlotsPerBatch: Math.max(0, parseInt(params["related.random_slots_per_batch"], 10) || 0),
		fallbackEnabled: true,
		hardPreference: true,
		clickNextWeight: 50,
		transitionCapPerFrom: Math.max(1, parseInt(params["related.transition_cap_k"], 10) || 50),
		decayHalfLifeDays: parseFloat(params["related.transition_decay_half_life_days"]),
		windowDays: Math.max(0, parseFloat(params["related.transition_window_days"]) || 0),
		batchSize: limit + 1,
		now: () => Date.now(),
		rng: Math.random,
		coldMode: "auto",
		coldConfidenceThreshold: 0.35,
		coldExploreFraction: 0.7,
		coldExploreMinGuessSlots: 2
	};
}

async function buildRecsysInputsWithSupabase(client, seedId, excludeIds, params) {
	const cap = Math.max(1, Math.min(500, parseInt(params["related.candidate_cap_per_signal"], 10) || 100));
	const transitionCap = Math.max(1, parseInt(params["related.transition_cap_k"], 10) || 50);
	const excludeSet = new Set((excludeIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0));
	excludeSet.add(Number(seedId));

	const { data: seedRows, error: seedErr } = await client
		.from("prsn_created_images")
		.select("id,user_id,created_at,published,meta,title")
		.eq("id", seedId)
		.eq("published", true)
		.limit(1);
	if (seedErr) throw seedErr;
	const anchor = seedRows?.[0];
	if (!anchor) return null;

	const byId = new Map();
	const addRows = (rows) => {
		for (const row of rows || []) {
			const id = Number(row?.id);
			if (!Number.isFinite(id) || id < 1 || excludeSet.has(id)) continue;
			if (!byId.has(id)) byId.set(id, row);
		}
	};

	const parentIds = anchor?.meta?.mutate_of_id != null
		? [Number(anchor.meta.mutate_of_id)].filter((id) => Number.isFinite(id) && id > 0 && !excludeSet.has(id))
		: [];
	const lineageOr = `meta->>mutate_of_id.eq.${seedId}`;
	addRows((await client
		.from("prsn_created_images")
		.select("id,user_id,created_at,published,meta,title")
		.eq("published", true)
		.or(lineageOr)
		.limit(cap)).data);

	if (parentIds.length > 0) {
		addRows((await client
			.from("prsn_created_images")
			.select("id,user_id,created_at,published,meta,title")
			.in("id", parentIds)
			.eq("published", true)
			.limit(cap)).data);
	}

	const sid = anchor?.meta?.server_id;
	const method = anchor?.meta?.method;
	if (sid != null && method != null) {
		addRows((await client
			.from("prsn_created_images")
			.select("id,user_id,created_at,published,meta,title")
			.eq("published", true)
			.or(`and(meta->>server_id.eq.${sid},meta->>method.eq.${method})`)
			.limit(cap)).data);
	}

	if (anchor?.user_id != null) {
		addRows((await client
			.from("prsn_created_images")
			.select("id,user_id,created_at,published,meta,title")
			.eq("published", true)
			.eq("user_id", anchor.user_id)
			.limit(cap)).data);
	}

	const { data: transitions, error: transErr } = await client
		.from("prsn_related_transitions")
		.select("from_created_image_id,to_created_image_id,count,last_updated")
		.eq("from_created_image_id", seedId)
		.order("last_updated", { ascending: false })
		.limit(transitionCap);
	if (transErr) throw transErr;
	const transitionToIds = (transitions || [])
		.map((row) => Number(row?.to_created_image_id))
		.filter((id) => Number.isFinite(id) && id > 0 && !excludeSet.has(id));
	if (transitionToIds.length > 0) {
		addRows((await client
			.from("prsn_created_images")
			.select("id,user_id,created_at,published,meta,title")
			.in("id", [...new Set(transitionToIds)])
			.eq("published", true)
			.limit(Math.max(cap, transitionToIds.length))).data);
	}

	addRows((await client
		.from("prsn_created_images")
		.select("id,user_id,created_at,published,meta,title")
		.eq("published", true)
		.order("created_at", { ascending: false })
		.limit(cap)).data);

	return { anchor, pool: [anchor, ...byId.values()], transitions: transitions ?? [] };
}

async function selectRandomPublishedCreationIdsWithSupabase(client, currentCreationId, limit) {
	const safeLimit = Math.max(1, limit | 0);
	const imageTable = "prsn_created_images";
	const currentIdNum = Number(currentCreationId);
	const countQuery = client
		.from(imageTable)
		.select("id", { count: "exact", head: true })
		.eq("published", true);
	const { count, error: countError } = Number.isFinite(currentIdNum) && currentIdNum > 0
		? await countQuery.neq("id", currentIdNum)
		: await countQuery;
	if (countError) throw countError;
	const total = Math.max(0, Number(count) || 0);
	if (total <= 0) return { ids: [], hasMore: false };

	// Randomize by picking a random offset window, then shuffle locally.
	const windowSize = Math.max(safeLimit * 8, safeLimit + 1);
	const maxStart = Math.max(0, total - windowSize);
	const start = maxStart > 0 ? Math.floor(Math.random() * (maxStart + 1)) : 0;
	const end = Math.min(total - 1, start + windowSize - 1);
	const pageQuery = client
		.from(imageTable)
		.select("id")
		.eq("published", true)
		.order("created_at", { ascending: false })
		.range(start, end);
	const { data: rows, error: rowsError } = Number.isFinite(currentIdNum) && currentIdNum > 0
		? await pageQuery.neq("id", currentIdNum)
		: await pageQuery;
	if (rowsError) throw rowsError;

	const ids = (rows || [])
		.map((row) => Number(row?.id))
		.filter((id) => Number.isFinite(id) && id > 0);
	for (let i = ids.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[ids[i], ids[j]] = [ids[j], ids[i]];
	}
	return {
		ids: ids.slice(0, safeLimit),
		hasMore: total > safeLimit
	};
}

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function mapRelatedItemsToResponse(items, viewerLikedIds, reasonMetaByCreationId = null) {
	const likedSet = new Set((viewerLikedIds ?? []).map(String));
	return (Array.isArray(items) ? items : []).map((item) => {
		const imageUrl = item?.url ?? null;
		const author = item?.author_display_name ?? item?.author_user_name ?? "";
		const creationId = item?.created_image_id ?? item?.id ?? null;
		const reasonMeta = reasonMetaByCreationId?.get?.(Number(creationId));
		return {
			id: item?.id,
			title: escapeHtml(item?.title != null ? item.title : "Untitled"),
			summary: escapeHtml(item?.summary != null ? item.summary : ""),
			author,
			author_user_name: item?.author_user_name ?? null,
			author_display_name: item?.author_display_name ?? null,
			author_avatar_url: item?.author_avatar_url ?? null,
			tags: item?.tags ?? null,
			created_at: item?.created_at,
			image_url: imageUrl,
			thumbnail_url: getThumbnailUrl(imageUrl),
			created_image_id: item?.created_image_id ?? item?.id ?? null,
			user_id: item?.user_id ?? null,
			like_count: Number(item?.like_count ?? 0),
			comment_count: Number(item?.comment_count ?? 0),
			viewer_liked: likedSet.has(String(item?.id ?? item?.created_image_id)),
			reason_labels: Array.isArray(reasonMeta?.labels) ? reasonMeta.labels : [],
			reason_details: Array.isArray(reasonMeta?.details) ? reasonMeta.details : [],
			recsys_score: Number.isFinite(Number(reasonMeta?.score)) ? Number(reasonMeta.score) : null,
			recsys_click_score: Number.isFinite(Number(reasonMeta?.click_score)) ? Number(reasonMeta.click_score) : null,
			recsys_click_share: Number.isFinite(Number(reasonMeta?.click_share)) ? Number(reasonMeta.click_share) : null
		};
	});
}

function recsysReasonDetailsForItem(anchor, candidate, reasons) {
	const out = [];
	const anchorId = Number(anchor?.id);
	const candidateId = Number(candidate?.id);
	const anchorTitle = anchor?.title ?? null;
	const candidateTitle = candidate?.title ?? null;
	for (const reason of reasons || []) {
		if (reason === "clickNext") {
			out.push({
				type: "clickNext",
				label: "Users clicked next from anchor",
				related_creation_id: Number.isFinite(anchorId) ? anchorId : null,
				related_creation_title: anchorTitle
			});
			continue;
		}
		if (reason === "lineage") {
			let label = "Same lineage";
			if (candidate?.meta?.mutate_of_id != null && Number(candidate.meta.mutate_of_id) === anchorId) {
				label = "Child of anchor";
			} else if (anchor?.meta?.mutate_of_id != null && Number(anchor.meta.mutate_of_id) === candidateId) {
				label = "Parent of anchor";
			}
			out.push({
				type: "lineage",
				label,
				related_creation_id: Number.isFinite(anchorId) ? anchorId : null,
				related_creation_title: anchorTitle
			});
			continue;
		}
		if (reason === "sameCreator") {
			out.push({
				type: "sameCreator",
				label: "Same creator",
				related_creation_id: Number.isFinite(anchorId) ? anchorId : null,
				related_creation_title: anchorTitle
			});
			continue;
		}
		if (reason === "sameServerMethod") {
			out.push({
				type: "sameServerMethod",
				label: "Same server/method",
				related_creation_id: Number.isFinite(anchorId) ? anchorId : null,
				related_creation_title: anchorTitle
			});
			continue;
		}
		if (reason === "fallback") {
			out.push({
				type: "fallback",
				label: "Fallback candidate",
				related_creation_id: Number.isFinite(candidateId) ? candidateId : null,
				related_creation_title: candidateTitle
			});
			continue;
		}
		out.push({
			type: String(reason),
			label: String(reason),
			related_creation_id: null,
			related_creation_title: null
		});
	}
	return out;
}

export default function createCreationsRoutes({ queries }) {
	const router = express.Router();

	router.get("/api/creations", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		const creations = await queries.selectCreationsForUser.all(user.id);
		return res.json({ creations });
	});

	router.get("/api/creations/:id/related", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const id = parseInt(req.params.id, 10);
			if (!Number.isFinite(id) || id < 1) {
				return res.status(400).json({ error: "Invalid creation id" });
			}

			const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 10), RELATED_LIMIT_CAP);
			const excludeIdsRaw = req.query.exclude_ids;
			const excludeIds = typeof excludeIdsRaw === "string" && excludeIdsRaw
				? excludeIdsRaw
					.split(",")
					.map((s) => parseInt(s.trim(), 10))
					.filter((n) => Number.isFinite(n))
					.slice(0, RELATED_EXCLUDE_IDS_CAP)
				: undefined;
			const seenCount = Math.max(0, parseInt(req.query.seen_count, 10) || 0);
			const forceRandom = String(req.query.force_random || "0") === "1";

			const params = await queries.getRelatedParams?.get?.() ?? {};
			let ids = [];
			let hasMore = false;
			let reasonMetaByCreationId = null;
			const supabaseClient = getSupabaseServiceClient();
			if (!supabaseClient) {
				return res.status(500).json({ error: "Recsys engine is unavailable." });
			}
			const randomOnlyMode = forceRandom || seenCount >= RECSYS_RANDOM_ONLY_SEEN_THRESHOLD;
			if (randomOnlyMode) {
				const randomResult = await selectRandomPublishedCreationIdsWithSupabase(supabaseClient, id, limit);
				ids = randomResult.ids;
				hasMore = randomResult.hasMore;
				reasonMetaByCreationId = new Map(
					ids.map((creationId) => [creationId, {
						labels: ["exploreRandom"],
						details: [{
							type: "exploreRandom",
							label: "Random published item",
							related_creation_id: null,
							related_creation_title: null
						}],
						score: null,
						click_score: null,
						click_share: null
					}])
				);
			} else {
				const recsysWeight = Math.max(0, parseInt(params["related.recsys_weight"], 10) || 50);
				const semanticWeight = Math.max(0, parseInt(params["related.semantic_weight"], 10) || 50);
				const semanticWeightNoClickNext = Math.max(0, Math.min(100, parseInt(params["related.semantic_weight_no_click_next"], 10) || 95));
				const semanticDistanceMax = Math.max(0, Math.min(2, parseFloat(params["related.semantic_distance_max"]) || 0.8));
				const semanticOffset = Math.max(0, (excludeIds?.length ?? 0) - 1);
				const mergePoolSize = Math.min(SEMANTIC_MAX_LIMIT, Math.max(limit * 2, limit + 50));
				const mayBlend = semanticWeight > 0 || semanticWeightNoClickNext > 0;
				const recsysBatchSize = mayBlend ? mergePoolSize : limit + 1;

				let recsysInputs = null;
				const recsysConfig = parseRecsysConfigFromParams(params, limit);
				recsysConfig.batchSize = recsysBatchSize;
				const recsys = await recommendWithDataSource({
					config: recsysConfig,
					context: { seedId: id, userId: req.auth?.userId ?? null },
					loadInputs: async () => {
						const built = await buildRecsysInputsWithSupabase(
							supabaseClient,
							id,
							excludeIds,
							params
						);
						recsysInputs = built;
						return built;
					}
				});

				const excludeSet = new Set([id, ...(excludeIds ?? [])]);
				const recsysById = new Map(
					recsys.items
						.map((row) => ({ id: Number(row.id), score: Number(row.score) || 0, row }))
						.filter((x) => Number.isFinite(x.id) && x.id > 0 && !excludeSet.has(x.id))
						.map((x) => [x.id, x])
				);
				reasonMetaByCreationId = new Map();
				if (recsysInputs?.anchor && Array.isArray(recsys.items)) {
					const byId = new Map((recsysInputs.pool || []).map((x) => [Number(x?.id), x]));
					for (const row of recsys.items) {
						const cid = Number(row.id);
						if (!Number.isFinite(cid) || cid < 1 || excludeSet.has(cid)) continue;
						const candidate = byId.get(cid);
						const labels = Array.isArray(row.reasons) ? row.reasons : [];
						reasonMetaByCreationId.set(cid, {
							labels,
							details: recsysReasonDetailsForItem(recsysInputs.anchor, candidate, labels),
							score: row.score,
							click_score: row.click_score,
							click_share: row.click_share
						});
					}
				}

				const hasClickNext = Array.isArray(recsysInputs?.transitions) && recsysInputs.transitions.length > 0;
				const effectiveRecsysW = hasClickNext ? recsysWeight : Math.max(0, 100 - semanticWeightNoClickNext);
				const effectiveSemanticW = hasClickNext ? semanticWeight : semanticWeightNoClickNext;

				let semanticByDistance = null;
				let semanticPageFull = false;
				if (effectiveSemanticW > 0) {
					const { data: embeddingRow, error: fetchErr } = await supabaseClient
						.from(EMBEDDINGS_TABLE)
						.select("embedding_multi")
						.eq("created_image_id", id)
						.maybeSingle();
					if (!fetchErr && embeddingRow?.embedding_multi) {
						const semLimit = Math.min(mergePoolSize, SEMANTIC_MAX_LIMIT);
						const { data: nearestRaw, error: rpcErr } = await supabaseClient.rpc(RPC_NEAREST, {
							target_embedding: embeddingRow.embedding_multi,
							exclude_id: id,
							lim: semLimit,
							off: Math.min(semanticOffset, SEMANTIC_MAX_OFFSET)
						});
						if (!rpcErr && Array.isArray(nearestRaw) && nearestRaw.length > 0) {
							semanticPageFull = nearestRaw.length >= semLimit;
							semanticByDistance = new Map(
								nearestRaw
									.map((r) => ({ id: Number(r?.created_image_id), distance: Number(r?.distance) }))
									.filter((x) => Number.isFinite(x.id) && x.id > 0 && !excludeSet.has(x.id) && x.distance <= semanticDistanceMax)
									.map((x) => [x.id, x.distance])
							);
						}
					}
				}

				if (effectiveSemanticW > 0 && semanticByDistance && semanticByDistance.size > 0 && (effectiveRecsysW > 0 || recsysById.size === 0)) {
					const totalW = effectiveRecsysW + effectiveSemanticW;
					const recsysScores = [...recsysById.values()].map((x) => x.score);
					const recsysMax = Math.max(1, ...recsysScores);
					const allIds = new Set([...recsysById.keys(), ...semanticByDistance.keys()]);
					const combined = [];
					for (const cid of allIds) {
						const r = recsysById.get(cid);
						const recsysNorm = r ? r.score / recsysMax : 0;
						const dist = semanticByDistance.get(cid);
						const semanticSim = dist != null ? 1 / (1 + Math.max(0, dist)) : 0;
						const score = totalW > 0 ? (effectiveRecsysW * recsysNorm + effectiveSemanticW * semanticSim) / totalW : semanticSim;
						combined.push({ id: cid, score });
					}
					combined.sort((a, b) => b.score - a.score);
					ids = combined.slice(0, limit).map((x) => x.id);
					hasMore = combined.length > limit || semanticPageFull;
					for (const cid of ids) {
						if (!reasonMetaByCreationId.has(cid)) {
							reasonMetaByCreationId.set(cid, {
								labels: ["semanticSimilar"],
								details: [{
									type: "semanticSimilar",
									label: "Visually similar",
									related_creation_id: null,
									related_creation_title: null
								}],
								score: null,
								click_score: null,
								click_share: null
							});
						}
					}
				} else {
					ids = [...recsysById.keys()].slice(0, limit);
					hasMore = recsys.items.length > limit;
					if (ids.length < limit && effectiveSemanticW > 0) {
						const { data: embeddingRow, error: fetchErr } = await supabaseClient
							.from(EMBEDDINGS_TABLE)
							.select("embedding_multi")
							.eq("created_image_id", id)
							.maybeSingle();
						if (!fetchErr && embeddingRow?.embedding_multi) {
							const need = limit - ids.length;
							const lim = Math.min(need + (excludeIds?.length ?? 0) + ids.length + 10, SEMANTIC_MAX_LIMIT);
							const { data: nearestRaw, error: rpcErr } = await supabaseClient.rpc(RPC_NEAREST, {
								target_embedding: embeddingRow.embedding_multi,
								exclude_id: id,
								lim,
								off: Math.min(semanticOffset, SEMANTIC_MAX_OFFSET)
							});
							if (!rpcErr && Array.isArray(nearestRaw)) {
								const filled = new Set(ids);
								for (const r of nearestRaw) {
									const fid = Number(r?.created_image_id);
									const dist = Number(r?.distance);
									if (!Number.isFinite(fid) || fid <= 0 || excludeSet.has(fid) || filled.has(fid)) continue;
									if (dist > semanticDistanceMax) continue;
									filled.add(fid);
									ids.push(fid);
									reasonMetaByCreationId.set(fid, {
										labels: ["semanticSimilar"],
										details: [{ type: "semanticSimilar", label: "Visually similar", related_creation_id: null, related_creation_title: null }],
										score: null,
										click_score: null,
										click_share: null
									});
									if (ids.length >= limit) break;
								}
								if (nearestRaw.length >= lim) hasMore = true;
							}
						}
					}
				}
			}

			if (!ids || ids.length === 0) {
				return res.json({ items: [], hasMore: false });
			}

			const feedByCreation = queries.selectFeedItemsByCreationIds?.all;
			const items = typeof feedByCreation === "function" ? await feedByCreation(ids) : [];
			const viewerLikedIds = typeof queries.selectViewerLikedCreationIds?.all === "function"
				? await queries.selectViewerLikedCreationIds.all(req.auth?.userId, ids)
				: [];
			const itemsWithImages = mapRelatedItemsToResponse(items, viewerLikedIds, reasonMetaByCreationId);

			return res.json({ items: itemsWithImages, hasMore: !!hasMore });
		} catch (err) {
			console.error("[creations] related error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to load related creations." });
		}
	});

	// Semantic related (pgvector). No auth so test page works.
	router.get("/api/creations/:id/semantic-related", async (req, res) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (!Number.isFinite(id) || id < 1) {
				return res.status(400).json({ error: "Invalid creation id" });
			}
			const limit = parseSemanticLimit(req.query.limit);
			const offset = parseSemanticOffset(req.query.offset);
			const supabase = getSupabaseServiceClient();
			if (!supabase) return res.status(503).json({ error: "Embeddings unavailable." });

			const { data: row, error: fetchErr } = await supabase
				.from(EMBEDDINGS_TABLE)
				.select("embedding_multi")
				.eq("created_image_id", id)
				.maybeSingle();
			if (fetchErr) {
				console.error("[creations] semantic-related fetch embedding:", fetchErr);
				return res.status(500).json({ error: "Failed to load embedding." });
			}
			if (!row?.embedding_multi) {
				return res.status(404).json({ error: "No embedding for this creation." });
			}

			const { data: nearestRaw, error: rpcErr } = await supabase.rpc(RPC_NEAREST, {
				target_embedding: row.embedding_multi,
				exclude_id: id,
				lim: limit + 1,
				off: offset
			});
			const hasMore = Array.isArray(nearestRaw) && nearestRaw.length > limit;
			const nearest = hasMore ? nearestRaw.slice(0, limit) : (nearestRaw ?? []);
			if (rpcErr) {
				console.error("[creations] semantic-related RPC:", rpcErr);
				return res.status(500).json({ error: "Similarity search failed." });
			}
			const ids = (nearest ?? []).map((r) => Number(r?.created_image_id)).filter((n) => Number.isFinite(n) && n > 0);
			if (ids.length === 0) {
				const feedByCreation = queries.selectFeedItemsByCreationIds?.all;
				const mainRows = typeof feedByCreation === "function" ? await feedByCreation([id]) : [];
				const mainMapped = mapRelatedItemsToResponse(mainRows, [], null);
				return res.json({ main: mainMapped[0] ?? null, items: [], distances: {}, has_more: false });
			}

			const feedByCreation = queries.selectFeedItemsByCreationIds?.all;
			const mainRows = typeof feedByCreation === "function" ? await feedByCreation([id]) : [];
			const neighbourRows = await feedByCreation(ids);
			const idToDistance = new Map((nearest ?? []).map((r) => [Number(r.created_image_id), Number(r.distance)]));
			const orderIdx = new Map(ids.map((id, i) => [id, i]));
			const sorted = neighbourRows.slice().sort((a, b) => (orderIdx.get(Number(a.id)) ?? 999) - (orderIdx.get(Number(b.id)) ?? 999));
			const items = mapRelatedItemsToResponse(sorted, [], null).map((item) => ({
				...item,
				distance: idToDistance.get(Number(item.created_image_id)) ?? null
			}));
			const mainMapped = mapRelatedItemsToResponse(mainRows, [], null);
			return res.json({ main: mainMapped[0] ?? null, items, distances: Object.fromEntries(idToDistance), has_more: hasMore });
		} catch (err) {
			console.error("[creations] semantic-related error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to load semantic related." });
		}
	});

	// Semantic search by text (embed query → nearest). No auth for test page. Uses cache to avoid Replicate when possible.
	router.get("/api/embeddings/search", async (req, res) => {
		try {
			const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
			if (!q) return res.status(400).json({ error: "Missing query (q)." });
			const normalized = normalizeSearchQuery(q);
			if (!normalized) return res.status(400).json({ error: "Missing query (q)." });
			const limit = parseSemanticLimit(req.query.limit);
			const offset = parseSemanticOffset(req.query.offset);
			const supabase = getSupabaseServiceClient();
			if (!supabase) return res.status(503).json({ error: "Embeddings unavailable." });

			let embedding = null;
			const { data: cached, error: cacheErr } = await supabase
				.from(SEARCH_CACHE_TABLE)
				.select("id, embedding")
				.eq("normalized_query", normalized)
				.maybeSingle();
			if (!cacheErr && cached?.embedding) {
				await supabase.rpc(RPC_SEARCH_CACHE_RECORD_USAGE, { p_cache_id: cached.id });
				embedding = cached.embedding;
			}
			if (!embedding || !Array.isArray(embedding)) {
				const token = process.env.REPLICATE_API_TOKEN;
				if (!token) return res.status(503).json({ error: "Search unavailable (no REPLICATE_API_TOKEN)." });
				const replicate = new Replicate({ auth: token });
				embedding = await getTextEmbeddingFromReplicate(replicate, q);
				if (!embedding || !Array.isArray(embedding)) {
					return res.status(502).json({ error: "Failed to embed query." });
				}
				const { data: inserted, error: insertErr } = await supabase
					.from(SEARCH_CACHE_TABLE)
					.insert({ normalized_query: normalized, embedding })
					.select("id")
					.single();
				if (!insertErr && inserted?.id) {
					await supabase.rpc(RPC_SEARCH_CACHE_RECORD_USAGE, { p_cache_id: inserted.id });
				}
			}

			const { data: nearestRaw, error: rpcErr } = await supabase.rpc(RPC_NEAREST, {
				target_embedding: embedding,
				exclude_id: null,
				lim: limit + 1,
				off: offset
			});
			if (rpcErr) {
				console.error("[creations] embeddings/search RPC:", rpcErr);
				return res.status(500).json({ error: "Similarity search failed." });
			}
			const hasMore = Array.isArray(nearestRaw) && nearestRaw.length > limit;
			const nearest = hasMore ? nearestRaw.slice(0, limit) : (nearestRaw ?? []);
			const ids = nearest.map((r) => Number(r?.created_image_id)).filter((n) => Number.isFinite(n) && n > 0);
			if (ids.length === 0) return res.json({ items: [], distances: {}, has_more: false });

			const feedByCreation = queries.selectFeedItemsByCreationIds?.all;
			const neighbourRows = await feedByCreation(ids);
			const idToDistance = new Map((nearest ?? []).map((r) => [Number(r.created_image_id), Number(r.distance)]));
			const orderIdx = new Map(ids.map((id, i) => [id, i]));
			const sorted = neighbourRows.slice().sort((a, b) => (orderIdx.get(Number(a.id)) ?? 999) - (orderIdx.get(Number(b.id)) ?? 999));
			const items = mapRelatedItemsToResponse(sorted, [], null).map((item) => ({
				...item,
				distance: idToDistance.get(Number(item.created_image_id)) ?? null
			}));
			return res.json({ items, distances: Object.fromEntries(idToDistance), has_more: hasMore });
		} catch (err) {
			console.error("[creations] embeddings/search error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Search failed." });
		}
	});

	router.get("/api/creations/:id/summary", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}
			const id = parseInt(req.params.id, 10);
			if (!Number.isFinite(id) || id < 1) {
				return res.status(400).json({ error: "Invalid creation id" });
			}
			const feedByCreation = queries.selectFeedItemsByCreationIds?.all;
			if (typeof feedByCreation !== "function") {
				return res.status(500).json({ error: "Feed lookup unavailable" });
			}
			const rows = await feedByCreation([id]);
			if (!Array.isArray(rows) || rows.length === 0) {
				return res.status(404).json({ error: "Creation not found" });
			}
			const viewerLikedIds = typeof queries.selectViewerLikedCreationIds?.all === "function"
				? await queries.selectViewerLikedCreationIds.all(req.auth?.userId, [id])
				: [];
			const items = mapRelatedItemsToResponse(rows, viewerLikedIds);
			return res.json({ item: items[0] || null });
		} catch (err) {
			console.error("[creations] summary error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to load creation summary." });
		}
	});

	router.post("/api/creations/transitions", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const fromId = req.body?.from_created_image_id != null ? parseInt(req.body.from_created_image_id, 10) : null;
			const toId = req.body?.to_created_image_id != null ? parseInt(req.body.to_created_image_id, 10) : null;
			if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId < 1 || toId < 1 || fromId === toId) {
				return res.status(400).json({ error: "Invalid from_created_image_id or to_created_image_id" });
			}

			const recordTransition = queries.recordTransition?.run;
			if (typeof recordTransition !== "function") {
				return res.status(204).end();
			}

			await recordTransition(fromId, toId);
			return res.status(204).end();
		} catch (err) {
			console.error("[creations] transitions error:", err);
			if (!res.headersSent) res.status(500).json({ error: "Unable to record transition." });
		}
	});

	return router;
}
