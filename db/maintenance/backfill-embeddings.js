#!/usr/bin/env node
/**
 * Backfill embeddings for the N most recent (published) creations that don't yet have one.
 * Starts from the latest; skips any creation that already has a row in prsn_created_embeddings.
 * Keeps fetching pages until N new embeddings have been upserted (or no more creations).
 * Uses Replicate CLIP; upserts into prsn_created_embeddings (embedding_multi, model).
 *
 * Two categories of code:
 * 1) Script-only: setting up the situation (DB connection, fetching recent creations, env).
 * 2) Reusable: public URL building, embedding text building, Replicate call (used here and intended for API).
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import Replicate from "replicate";
import { getBaseAppUrlForEmail } from "../../api_routes/utils/url.js";
import { buildPublicImageUrl } from "../../api_routes/utils/publicImageUrl.js";
import { buildEmbeddingText, getEmbeddingFromReplicate, REPLICATE_CLIP_MODEL } from "../../api_routes/utils/embeddings.js";

/** Target number of new embeddings to upsert (only creations that don't already have one). Set high to backfill all missing. */
const N = 2000;

/** Page size when fetching creations from DB (order by most recent). */
const PAGE_SIZE = 500;

const EMBEDDINGS_TABLE = "prsn_created_embeddings";

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

/**
 * Check if we already have an embedding row for this creation (skip Replicate call).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} creationId
 * @returns {Promise<boolean>}
 */
async function hasCachedEmbedding(supabase, creationId) {
	const { data, error } = await supabase
		.from(EMBEDDINGS_TABLE)
		.select("created_image_id")
		.eq("created_image_id", creationId)
		.maybeSingle();
	if (error) throw error;
	return data != null;
}

/**
 * Upsert embedding into prsn_created_embeddings (embedding_multi, model).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} creationId
 * @param {number[]} embedding - 768-dim array from Replicate
 * @param {string} model
 */
async function upsertEmbedding(supabase, creationId, embedding, model) {
	const now = new Date().toISOString();
	const { error } = await supabase
		.from(EMBEDDINGS_TABLE)
		.upsert(
			{
				created_image_id: creationId,
				embedding_multi: embedding,
				model,
				updated_at: now
			},
			{ onConflict: "created_image_id" }
		);
	if (error) throw error;
}

// ——— (1) Script-only: situation setup ———

/**
 * Fetch a page of recent creations (most recent first). Only published with filename.
 */
async function fetchRecentCreationsPage(supabaseClient, limit, offset) {
	const { data, error } = await supabaseClient
		.from("prsn_created_images")
		.select("id, user_id, title, description, meta, filename")
		.eq("published", true)
		.not("filename", "is", null)
		.order("created_at", { ascending: false })
		.range(offset, offset + limit - 1);
	if (error) throw error;
	return data ?? [];
}

/**
 * Return set of created_image_id that already have a row in prsn_created_embeddings.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number[]} creationIds
 * @returns {Promise<Set<number>>}
 */
async function getExistingEmbeddingIds(supabase, creationIds) {
	if (creationIds.length === 0) return new Set();
	const { data, error } = await supabase
		.from(EMBEDDINGS_TABLE)
		.select("created_image_id")
		.in("created_image_id", creationIds);
	if (error) throw error;
	return new Set((data ?? []).map((row) => Number(row.created_image_id)));
}

function normalizeCreation(row) {
	const id = row?.id != null ? Number(row.id) : null;
	const userId = row?.user_id != null ? Number(row.user_id) : null;
	const title = row?.title ?? "";
	const description = row?.description ?? "";
	const prompt = (row?.meta && typeof row.meta === "object" && row.meta.args?.prompt) ?? "";
	if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(userId) || userId <= 0) return null;
	return {
		id,
		user_id: userId,
		title: typeof title === "string" ? title : "",
		description: typeof description === "string" ? description : "",
		prompt: typeof prompt === "string" ? prompt : ""
	};
}

// ——— (2) Reusable flow: public URL, embed, cache check, upsert ———

/**
 * @returns {Promise<boolean>} true if an embedding was upserted, false if skipped
 */
async function processCreation(creation, supabase, replicate, baseUrl, log = console) {
	const { id, user_id, title, description, prompt } = creation;

	if (await hasCachedEmbedding(supabase, id)) {
		log.log(`[${id}] Embedding already in DB; skipping.`);
		return false;
	}

	const imageUrl = buildPublicImageUrl(id, user_id, baseUrl);
	if (!imageUrl) {
		log.warn(`[${id}] Could not build public image URL; skipping.`);
		return false;
	}

	const text = buildEmbeddingText({ title, description, prompt });
	const output = await getEmbeddingFromReplicate(replicate, { text, image: imageUrl });
	const embedding = output?.embedding;
	if (!Array.isArray(embedding)) {
		throw new Error(`Replicate output missing embedding array (got ${typeof output?.embedding})`);
	}
	await upsertEmbedding(supabase, id, embedding, REPLICATE_CLIP_MODEL);
	log.log(`[${id}] Upserted embedding to ${EMBEDDINGS_TABLE}`);
	return true;
}

async function main() {
	const supabaseUrl = requireEnv("SUPABASE_URL");
	const supabaseServiceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
	const replicateToken = requireEnv("REPLICATE_API_TOKEN");
	const baseUrl = getBaseAppUrlForEmail();

	const supabase = createClient(supabaseUrl, supabaseServiceKey);
	const replicate = new Replicate({ auth: replicateToken });

	console.log(`Backfilling up to ${N} new embeddings (skipping creations that already have one).`);

	let processedCount = 0;
	let offset = 0;

	while (processedCount < N) {
		const rows = await fetchRecentCreationsPage(supabase, PAGE_SIZE, offset);
		if (rows.length === 0) {
			console.log("No more creations to consider; stopping.");
			break;
		}

		const creationIds = rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
		const existingIds = await getExistingEmbeddingIds(supabase, creationIds);
		const creations = rows
			.map(normalizeCreation)
			.filter(Boolean)
			.filter((c) => !existingIds.has(c.id))
			.slice(0, N - processedCount);

		if (creations.length === 0) {
			offset += PAGE_SIZE;
			continue;
		}

		for (const creation of creations) {
			if (processedCount >= N) break;
			try {
				const upserted = await processCreation(creation, supabase, replicate, baseUrl, console);
				if (upserted) processedCount++;
			} catch (err) {
				console.error(`[${creation.id}] Error:`, err.message);
			}
		}

		offset += PAGE_SIZE;
	}

	console.log(`Done. Upserted ${processedCount} embeddings.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
