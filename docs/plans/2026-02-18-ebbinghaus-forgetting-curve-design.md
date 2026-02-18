# Ebbinghaus Forgetting Curve for Shared Memory MCP

## Problem

All memories are treated equally regardless of age or usage. A stale note from 6 months ago that was never accessed again ranks the same as a frequently-used memory from yesterday. As memory count grows, search results get polluted with irrelevant old data.

## Solution

Apply the Ebbinghaus forgetting curve to memory retrieval. Memories decay over time but are reinforced each time they're accessed. Unused memories fade; useful ones persist.

## Approach: Over-fetch + Re-rank

Qdrant returns results based on vector similarity only. The daemon over-fetches 3x the requested limit, computes a retention score for each result, multiplies it with the similarity score, re-ranks, and returns the top-K.

## Data Model Changes

Three new payload fields on each Qdrant point:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `last_accessed` | ISO string | `created_at` | When this memory was last reinforced |
| `access_count` | number | `0` | How many times it's been reinforced |
| `stability` | number | `1.0` | Decay half-life multiplier, increases with reinforcement |
| `tombstoned_at` | ISO string | absent | Set when retention drops below threshold; excluded from search |

Existing memories without these fields use defaults: `last_accessed = created_at`, `access_count = 0`, `stability = 1.0`. No migration needed.

## Retention Formula

```
retention = e^(-t / (BASE_HALF_LIFE * stability / ln(2)))
```

- `t` = days since `last_accessed`
- `BASE_HALF_LIFE` = 90 days
- `stability` starts at 1.0, grows with reinforcement
- `ln(2)` normalizes so retention = 0.5 at exactly `BASE_HALF_LIFE * stability` days

## Stability Growth

```
stability = 1.0 + ln(1 + access_count)
```

| access_count | stability | effective half-life |
|-------------|-----------|-------------------|
| 0 | 1.0 | 90 days |
| 1 | 1.69 | 152 days |
| 5 | 2.79 | 251 days |
| 20 | 4.04 | 364 days |

## Search Flow (modified)

1. Agent calls `search_memory(query, limit=10)`
2. Daemon embeds query, sends to Qdrant with `limit = requested_limit * 3`
3. Qdrant filter excludes points where `tombstoned_at` exists
4. Qdrant returns up to 30 results with cosine similarity scores
5. Daemon computes `retention` for each result
6. Tombstone any results where `retention < 0.01` (inline cleanup, no daemon sweep needed)
7. Final score = `similarity * retention` for remaining results
8. Sort by final score, return top requested_limit
9. Asynchronously reinforce returned memories (update `last_accessed`, increment `access_count`, recalculate `stability`)

## Reinforcement Triggers

| Action | Effect |
|--------|--------|
| `search_memory` returns a memory | Reinforce: bump access_count, update last_accessed, recalculate stability |
| `update_memory` called | Full reset: stability = 1.0, access_count = 0, last_accessed = now |
| `store_memory` | Initial values: stability = 1.0, access_count = 0, last_accessed = now |
| `list_recent` | No reinforcement |

## Tombstoning (inline during search)

- When search computes retention for over-fetched results, any memory with `retention < 0.01` is tombstoned on the spot
- Tombstoned: sets `tombstoned_at = now()` on the Qdrant point (asynchronous, non-blocking)
- All search and list_recent queries filter out points where `tombstoned_at` exists (using Qdrant `is_empty` filter, NOT `is_null` — `is_null` doesn't match absent fields)
- No daemon sweep or timer needed — cleanup happens organically during search
- Orphaned memories that never match a search won't get tombstoned, but they're already irrelevant
- No automatic hard delete. Tombstoned memories persist until manually purged from Qdrant

## Files to Modify

- `src/storage.ts` — Add tombstone filter to search/listRecent, add reinforcement update method, add tombstone method
- `src/daemon.ts` — Modify search handler to over-fetch + re-rank + reinforce + inline tombstone, add retention computation
- `src/types.ts` — Add new payload fields to types
- `src/index.ts` — No changes (MCP tool interface unchanged)

## Constants

```
BASE_HALF_LIFE = 90          // days
OVER_FETCH_MULTIPLIER = 3    // fetch 3x requested limit from Qdrant
TOMBSTONE_THRESHOLD = 0.01   // retention below this triggers tombstone
```
