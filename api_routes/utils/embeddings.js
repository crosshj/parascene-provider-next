/**
 * Embeddings helpers for semantic search (pgvector). Used by backfill script and can be used by API.
 */

export const REPLICATE_CLIP_MODEL =
	"krthr/clip-embeddings:1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4";

/**
 * Build a single annotated text string from creation fields for CLIP embedding.
 * Labels (Title / Description / Prompt) make the .js output readable; CLIP encodes the full string.
 * Missing parts are emitted as "(none)".
 * @param {{ title?: string | null, description?: string | null, prompt?: string | null }} creation
 * @returns {string}
 */
export function buildEmbeddingText(creation) {
	const title = typeof creation?.title === "string" ? creation.title.trim() : "";
	const description = typeof creation?.description === "string" ? creation.description.trim() : "";
	const prompt = typeof creation?.prompt === "string" ? creation.prompt.trim() : "";
	return [
		`Title: ${title || "(none)"}`,
		`Description: ${description || "(none)"}`,
		`Prompt: ${prompt || "(none)"}`
	].join(" ");
}

/**
 * Call Replicate CLIP embeddings model with text and image URL.
 * @param {import("replicate").default} replicate - Replicate client (auth from env in caller)
 * @param {{ text: string, image: string }} input - text and image URL
 * @returns {Promise<unknown>} Raw model output (typically embedding array)
 */
export async function getEmbeddingFromReplicate(replicate, input) {
	const output = await replicate.run(REPLICATE_CLIP_MODEL, {
		input: {
			text: input.text || "",
			image: input.image
		}
	});
	return output;
}

/**
 * Get embedding for text-only query (e.g. semantic search). Passes only text to CLIP.
 * @param {import("replicate").default} replicate
 * @param {string} text
 * @returns {Promise<number[]|null>} embedding array or null
 */
export async function getTextEmbeddingFromReplicate(replicate, text) {
	if (!text || typeof text !== "string" || !text.trim()) return null;
	const output = await replicate.run(REPLICATE_CLIP_MODEL, {
		input: {
			text: text.trim()
		}
	});
	return output?.embedding && Array.isArray(output.embedding) ? output.embedding : null;
}

const EMBEDDINGS_TABLE = "prsn_created_embeddings";

/**
 * Upsert a creation's embedding into prsn_created_embeddings (used by creation job and backfill).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} creationId
 * @param {number[]} embedding - 768-dim array from Replicate
 * @param {string} model
 */
export async function upsertCreationEmbedding(supabase, creationId, embedding, model) {
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
