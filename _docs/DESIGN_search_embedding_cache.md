# Design: Search embedding cache

Avoid Replicate cost for repeated semantic search queries by caching text→embedding per normalized search term and culling by daily usage.

## Normalization

- Trim, lowercase, collapse runs of whitespace to a single space.
- Same logical query always maps to one cache key (e.g. `"Star  Wars  t-shirt"` → `"star wars t-shirt"`).

## Tables

### `prsn_search_embedding_cache`

- **id** bigint PK
- **normalized_query** text UNIQUE NOT NULL — cache key
- **embedding** vector(768) NOT NULL — CLIP embedding for that text
- **created_at** timestamptz NOT NULL DEFAULT now()

One row per distinct normalized query.

### `prsn_search_embedding_cache_usage`

- **cache_id** bigint NOT NULL REFERENCES prsn_search_embedding_cache(id) ON DELETE CASCADE
- **day** date NOT NULL — calendar day (UTC) when the cache was used
- **count** int NOT NULL DEFAULT 0

UNIQUE(cache_id, day). On each cache hit we upsert: increment `count` for today.

## Flow

1. Normalize `q` → `normalized`.
2. SELECT id, embedding FROM prsn_search_embedding_cache WHERE normalized_query = normalized.
3. **If found:** record usage (upsert usage for today, count += 1), return embedding.
4. **If not found:** call Replicate → get embedding; INSERT cache (normalized_query, embedding); INSERT usage for today (count = 1); return embedding.

## Culling

Goal: drop entries that are rarely used so the table doesn’t grow unbounded and we don’t pay to store vectors for one-off queries.

- **Per-day counts** allow policies like: “remove cache entries whose total usage in the last 30 days is below X” or “remove entries not used in the last 14 days”.
- Options:
  - **Scheduled job (cron):** e.g. weekly, delete from cache where id IN (SELECT cache_id FROM usage WHERE day >= today - 30 GROUP BY cache_id HAVING sum(count) < 5) OR created_at < today - 90 AND id NOT IN (any usage in last 30 days).
  - **RPC:** `prsn_search_embedding_cache_cull(window_days, min_uses_in_window)` deletes cache rows where total usage in the last window is below threshold; CASCADE cleans usage. Returns number deleted. Example: weekly with `(30, 2)` drops entries used &lt; 2 times in 30 days.
- Keep usage rows for a bounded window (e.g. 90 days) and drop older usage so the usage table doesn’t grow forever; optional cleanup job.

## Security

- RLS on both tables; only service role (API) can read/write. No user-facing access.
