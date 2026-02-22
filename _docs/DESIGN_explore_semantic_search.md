# Design: Semantic search on Explore

How to use semantic search on the explore page: exclusive vs mixed with current results.

## Current explore search

- **API:** `GET /api/explore/search?q=...` loads explore + feed items, then **keyword match** over title, summary, tags, author (and optionally description/meta/comments for a capped set). Results can be cached in Redis by normalized query.
- **Strengths:** Exact matches (e.g. "Parascene" in title), tag/category hits, fast when cached.
- **Gap:** No "meaning" match — e.g. "cozy winter cabin" won’t surface a creation titled "Dusk in the Rockies" even if the image and description match that idea.

## Semantic-only (replace keyword search)

- Every explore search would be: embed query → nearest neighbours in embedding space.
- **Pros:** Single model, natural-language discovery, finds by meaning.
- **Cons:** Weak for exact strings (searching "Parascene" or a tag name may not rank the right item); only searches over creations that have embeddings; cost/latency for cold queries (mitigated by search cache). You’d also need to **scope** semantic results to the same pool (e.g. exclude users the viewer follows) or accept that results can include items outside current explore rules.

## Hybrid (recommended): keyword + semantic

Keep existing keyword search and add semantic as an extra signal. Options:

1. **Merge and re-rank**
   - Run both: keyword search (current) and semantic search (embed → nearest).
   - Take union of creation IDs, then rank by a combined score (e.g. keyword score + semantic distance converted to a score), or interleave (e.g. 1 keyword, 1 semantic, repeat).
   - **Pro:** One list that benefits from exact match and meaning. **Con:** Need a scoring/merge strategy and to scope semantic to the same explore pool (only creations that appear in explore).

2. **Keyword-first, semantic as boost or fallback**
   - Run keyword search as today. If results exist, optionally boost items that also appear in top semantic results (or append a "Also similar" block).
   - If keyword returns few or no results, run semantic search and show "Similar in meaning" (or use semantic to fill the page).
   - **Pro:** Exact matches stay on top; semantic broadens and saves empty states. **Con:** Two code paths; need a clear UX for "no keyword match but here’s semantic."

3. **Two sections in the UI**
   - **Matches:** current keyword results.
   - **Similar in meaning:** semantic search results (optionally limited to creations already in explore, or with a note like "From the community").
   - **Pro:** Clear intent, no merge logic. **Con:** Two lists to maintain; possible duplication.

**Scoping semantic to explore:** Semantic search today is global (all creations with embeddings). For explore you likely want to restrict to the same set of creations the user can see (e.g. exclude followed users, apply visibility). That could be: filter semantic IDs by "in explore pool" before returning, or add an explore-scoped semantic endpoint that only considers creations in that pool.

## Where semantic-related fits

- **Semantic-related** = "nearest to **this creation**." It’s for "More like this" given an anchor item (e.g. creation detail page).
- On **explore search** the user supplies **text**, not an anchor item. So semantic-related isn’t a direct replacement for the search box.
- You can still **mix** it in: e.g. after showing search results, add a block "More like [top result]" by calling semantic-related with the first result’s id. That’s a separate UX from "what to show in the main search list."

## Chosen approach: parallel requests, then merge

- **Run both in parallel:** Client (or server) fires keyword search and semantic search at the same time.
- **Show first response immediately:** Whichever returns first is shown in its natural order (keyword order or semantic distance order). No waiting for both.
- **Merge when the second arrives:** When the other result set arrives, merge with the first: **dedupe** (each creation at most once) and **re-rank** so the combined order reflects both signals. Then re-render the list so the user sees one unified, ordered list.

So the user gets fast feedback (first list), then the list updates to "best of both" without duplicates.

### How to merge and order: Reciprocal Rank Fusion (RRF)

You have two ordered lists and no direct way to compare "keyword relevance" to "semantic distance." **Reciprocal Rank Fusion** avoids that: it turns each list into a score from **rank** only, then combines.

- **Rank:** In the keyword list, the 1st item has rank 1, the 2nd has rank 2, etc. In the semantic list, same (1st = rank 1, etc.).
- **RRF score** for a creation:
  - If it appears in **keyword** at rank R_k and in **semantic** at rank R_s:
    - score = 1/(k + R_k) + 1/(k + R_s)
  - If it appears in only one list (e.g. keyword at rank 3):
    - score = 1/(k + 3)  (the other list contributes 0)
- **Constant k:** Usually 60 (so rank 1 gives 1/61, rank 2 gives 1/62, …). Smooths the curve so rank 1 isn’t overwhelmingly dominant.
- **Final order:** Sort all unique creations by this score **descending**. Higher score = appears in both lists and/or near the top of one or both.

So:
- **In both lists:** Gets two terms, so it tends to rank higher than items in only one list.
- **Top of one list only:** Still appears, but with a single term (e.g. 1/61 for rank 1 in keyword only).
- **Semantic distance vs keyword:** We never compare distance to keyword score. We only use **position** in each list. So "1st in keyword, 5th in semantic" and "1st in semantic, 5th in keyword" can get similar RRF scores; "1st in both" wins.

**First response only:** Before the second list arrives we have only one list. Show it in its native order (no RRF yet). When the second list arrives, compute RRF over both, dedupe, sort by score, then update the UI. If one request fails or times out, show the other list as-is.

### Summary

| Question | Answer |
|----------|--------|
| Same creation in both lists? | Show once; RRF gives it a higher score so it tends toward the top. |
| How does semantic distance relate to keyword match? | We don’t mix units. We use **rank** in each list; RRF combines ranks so items that rank well in both (or either) rise. |
| Order when only first has arrived? | Use that list’s order. |
| Order after both have arrived? | RRF score descending, deduplicated. |

## Recommendation

- **Don’t** switch explore search to semantic-only; you’d lose reliable exact/tag match and complicate scoping.
- **Do** use **parallel keyword + semantic**, show first-arriving list, then merge with **RRF + dedupe** when the second arrives.
- Implement **scoping** so semantic results respect the same explore rules (e.g. only creations that would appear in the explore feed).
- Optionally add "More like this" (semantic-related) from the first search result as a separate block.
