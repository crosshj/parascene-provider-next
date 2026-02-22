# TODO

here are notes about how to handle TODO.json, you will edit TODO.json when user mentions there are TODO changes.  You will not change this markdown file when the previously mentioned file changes.  You do not need to track items that are done.

## Cost

`cost` reflects expected effort and complexity to deliver the item.

- **time-to-ship**: how much focused time it will take to get to “done”.
- **ai-difficulty**: how frustrating/difficult it will be to delegate to an AI (ambiguity, iteration loops, “it keeps getting it wrong” risk).
- **system-complexity**: how complex the change is, how many moving parts it has, and how many parts of the system it touches (surface area).
- **implementation-risk**: likelihood of bugs, regressions, unclear requirements, unknowns, or “hidden work” that makes it blow up.

## Impact

`impact` reflects expected user and business value once the item ships.

- **hooks + retention**: does it engage users quickly and bring them back (more “I want to keep scrolling”).
- **revenue leverage**: does it increase credit purchases, ad/attention value, or referrals/word-of-mouth growth.
- **founder motivation**: does it make the site more fun/meaningful to build so you stay engaged shipping improvements.
- **fun (not just dark patterns)**: does it create genuine enjoyment for a nerdy/creative audience, while still using “engagement” mechanics as a tool (not the whole point).


## Rebalance

When I ask for a "rebalance" of TODO `cost` and `impact` values, I mean:

- Recalculate the numeric scores across the current list so they are comparable to each other.
- Use the full 1-100 scale for each metric.
- The highest `cost` item should be 100, and the lowest `cost` item should be 1.
- The highest `impact` item should be 100, and the lowest `impact` item should be 1.
- Preserve relative ordering between items (if A > B before, A should stay > B after).
- Use a linear rescale across the remaining items.


## Remove / Add

If an item is removed or added, rerun the rebalance so the scores stay aligned to the new set.
