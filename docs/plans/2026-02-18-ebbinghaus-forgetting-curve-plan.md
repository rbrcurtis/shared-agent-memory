# Ebbinghaus Forgetting Curve Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Ebbinghaus forgetting curve to shared memory MCP so memories decay over time but are reinforced through usage, with inline tombstoning of fully decayed memories.

**Architecture:** Pure retention math in `src/retention.ts`. Storage layer gets tombstone filtering, reinforcement, and tombstone methods. Daemon over-fetches 3x from Qdrant, computes retention scores, re-ranks, tombstones decayed results inline, and reinforces returned results asynchronously.

**Tech Stack:** TypeScript, Qdrant REST API (`setPayload` for partial updates, `is_null` filter for tombstone exclusion), vitest for tests.

**Design doc:** `docs/plans/2026-02-18-ebbinghaus-forgetting-curve-design.md`

---

### Task 1: Add retention math module with tests

**Files:**
- Create: `src/retention.ts`
- Create: `src/retention.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/retention.test.ts
import { describe, it, expect } from 'vitest';
import { computeRetention, computeStability, BASE_HALF_LIFE, TOMBSTONE_THRESHOLD } from './retention.js';

describe('computeStability', () => {
  it('returns 1.0 for 0 accesses', () => {
    expect(computeStability(0)).toBeCloseTo(1.0);
  });

  it('returns ~1.69 for 1 access', () => {
    expect(computeStability(1)).toBeCloseTo(1.693, 2);
  });

  it('returns ~2.79 for 5 accesses', () => {
    expect(computeStability(5)).toBeCloseTo(2.792, 2);
  });

  it('returns ~4.04 for 20 accesses', () => {
    expect(computeStability(20)).toBeCloseTo(4.045, 2);
  });
});

describe('computeRetention', () => {
  it('returns 1.0 for 0 days elapsed', () => {
    expect(computeRetention(0, 1.0)).toBeCloseTo(1.0);
  });

  it('returns 0.5 at exactly BASE_HALF_LIFE days with stability=1.0', () => {
    expect(computeRetention(BASE_HALF_LIFE, 1.0)).toBeCloseTo(0.5, 2);
  });

  it('returns 0.5 at 2x BASE_HALF_LIFE days with stability=2.0', () => {
    expect(computeRetention(BASE_HALF_LIFE * 2, 2.0)).toBeCloseTo(0.5, 2);
  });

  it('returns near 0 after very long time', () => {
    const ret = computeRetention(BASE_HALF_LIFE * 10, 1.0);
    expect(ret).toBeLessThan(TOMBSTONE_THRESHOLD);
  });

  it('returns higher retention for higher stability at same time', () => {
    const low = computeRetention(90, 1.0);
    const high = computeRetention(90, 3.0);
    expect(high).toBeGreaterThan(low);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/ryan/Code/memory-mcp && npx vitest run src/retention.test.ts`
Expected: FAIL — cannot find `./retention.js`

**Step 3: Write the implementation**

```typescript
// src/retention.ts
export const BASE_HALF_LIFE = 90; // days
export const OVER_FETCH_MULTIPLIER = 3;
export const TOMBSTONE_THRESHOLD = 0.01;

/**
 * stability = 1.0 + ln(1 + access_count)
 * Diminishing returns: 0→1.0, 1→1.69, 5→2.79, 20→4.04
 */
export function computeStability(accessCount: number): number {
  return 1.0 + Math.log(1 + accessCount);
}

/**
 * retention = e^(-t / (BASE_HALF_LIFE * stability / ln(2)))
 * Returns 0.5 at t = BASE_HALF_LIFE * stability
 */
export function computeRetention(daysSinceAccess: number, stability: number): number {
  const lambda = (BASE_HALF_LIFE * stability) / Math.LN2;
  return Math.exp(-daysSinceAccess / lambda);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/ryan/Code/memory-mcp && npx vitest run src/retention.test.ts`
Expected: All 9 tests PASS

**Step 5: Commit**

```bash
git add src/retention.ts src/retention.test.ts
git commit -m "feat: add retention math module for Ebbinghaus forgetting curve"
```

---

### Task 2: Update types with decay fields

**Files:**
- Modify: `src/types.ts`

**Step 1: Add decay fields to MemoryMetadata and SearchResult**

In `src/types.ts`, add three optional fields to `MemoryMetadata`:

```typescript
export interface MemoryMetadata {
  id: string;
  text: string;
  agent: string;
  project: string;
  tags: string[];
  created_at: string;
  last_accessed?: string;
  access_count?: number;
  stability?: number;
  tombstoned_at?: string;
}
```

Add the same three fields (plus `retention`) to `SearchResult`:

```typescript
export interface SearchResult {
  id: string;
  score: number;
  text: string;
  agent: string;
  project: string;
  tags: string[];
  created_at: string;
  last_accessed?: string;
  access_count?: number;
  stability?: number;
  retention?: number;
}
```

**Step 2: Verify build**

Run: `cd /home/ryan/Code/memory-mcp && npx tsc --noEmit`
Expected: No errors (fields are optional, existing code still compiles)

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add decay and tombstone fields to memory types"
```

---

### Task 3: Add tombstone filter and partial update methods to StorageService

**Files:**
- Modify: `src/storage.ts`

**Step 1: Add tombstone filter to `buildFilter`**

The `buildFilter` method in `src/storage.ts:158-174` currently builds a `must` array. Add a `must_not` array that excludes tombstoned points. Change the method signature to return `{ must: object[]; must_not: object[] }` and add the tombstone exclusion:

```typescript
private buildFilter(params: SearchParams): { must: object[]; must_not: object[] } {
  const must: object[] = [];
  const must_not: object[] = [
    { is_null: { key: 'tombstoned_at' } }
  ];

  if (params.agent) {
    must.push({ key: 'agent', match: { value: params.agent } });
  }
  if (params.project) {
    must.push({ key: 'project', match: { value: params.project } });
  }
  if (params.tags && params.tags.length > 0) {
    for (const tag of params.tags) {
      must.push({ key: 'tags', match: { value: tag } });
    }
  }

  return { must, must_not };
}
```

**IMPORTANT:** Qdrant's `is_null` matches points where the field IS null/missing. We want to EXCLUDE tombstoned points (where `tombstoned_at` IS set), so we put `is_null` in `must_not`. This means: "must NOT have tombstoned_at be null" — wait, that's backwards. Let me clarify:

- `must_not: [{ is_null: { key: 'tombstoned_at' } }]` means "exclude points where tombstoned_at is null" — this is WRONG, it would exclude non-tombstoned points.

The correct approach: we want points where `tombstoned_at` IS null (doesn't exist). So:

```typescript
// Add to the must array, not must_not
must.push({ is_null: { key: 'tombstoned_at' } });
```

This means "tombstoned_at must be null/absent" — which filters IN non-tombstoned memories.

Update the `search` method call at line 76-81 to pass the filter correctly:

```typescript
async search(params: SearchParams): Promise<SearchResult[]> {
  const filter = this.buildFilter(params);

  const results = await this.client.query(this.config.collectionName, {
    query: params.vector,
    limit: params.limit,
    filter: filter.must.length > 0 ? filter : undefined,
    with_payload: true,
  });
```

No change needed to the filter passing logic — `buildFilter` now always has at least the tombstone filter in `must`, so the condition `filter.must.length > 0` will always be true.

**Step 2: Add tombstone filter to `listRecent`**

In `listRecent` at line 97-128, add the tombstone filter to the `must` array:

```typescript
async listRecent(limit: number, daysBack: number = 30, project?: string): Promise<SearchResult[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const must: object[] = [
    { key: 'created_at', range: { gte: cutoff.toISOString() } },
    { is_null: { key: 'tombstoned_at' } },
  ];
  if (project) {
    must.push({ key: 'project', match: { value: project } });
  }
  // ... rest unchanged
```

**Step 3: Add `reinforceMemories` method**

Add this method to `StorageService`. Uses Qdrant's `setPayload` to update only the decay fields without needing the vector:

```typescript
async reinforceMemories(points: Array<{ id: string; accessCount: number }>): Promise<void> {
  const now = new Date().toISOString();
  for (const point of points) {
    const newCount = point.accessCount + 1;
    await this.client.setPayload(this.config.collectionName, {
      payload: {
        last_accessed: now,
        access_count: newCount,
        stability: computeStability(newCount),
      },
      points: [point.id],
    });
  }
}
```

Add `import { computeStability } from './retention.js';` at the top of storage.ts.

**Step 4: Add `tombstoneMemories` method**

```typescript
async tombstoneMemories(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  for (const id of ids) {
    await this.client.setPayload(this.config.collectionName, {
      payload: { tombstoned_at: now },
      points: [id],
    });
  }
}
```

**Step 5: Update `store` to set initial decay fields**

In the `store` method at line 54-71, add the decay fields to the payload:

```typescript
async store(params: StoreParams): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    id,
    text: params.text,
    agent: params.agent,
    project: params.project,
    tags: params.tags,
    created_at: now,
    last_accessed: now,
    access_count: 0,
    stability: 1.0,
  };
  // ... rest unchanged
```

**Step 6: Update `update` to reset decay fields**

In the `update` method at line 130-144, reset decay fields:

```typescript
async update(id: string, params: StoreParams): Promise<void> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    id,
    text: params.text,
    agent: params.agent,
    project: params.project,
    tags: params.tags,
    created_at: now,
    last_accessed: now,
    access_count: 0,
    stability: 1.0,
  };
  // ... rest unchanged
```

**Step 7: Update `search` result mapping to include decay fields**

In the `search` method, update the result mapping at line 83-94 to include the new fields:

```typescript
return results.points.map((point) => {
  const payload = point.payload as unknown as MemoryMetadata;
  return {
    id: payload.id,
    score: point.score ?? 0,
    text: payload.text,
    agent: payload.agent,
    project: payload.project,
    tags: payload.tags,
    created_at: payload.created_at,
    last_accessed: payload.last_accessed,
    access_count: payload.access_count,
    stability: payload.stability,
  };
});
```

**Step 8: Verify build**

Run: `cd /home/ryan/Code/memory-mcp && npx tsc --noEmit`
Expected: No errors

**Step 9: Commit**

```bash
git add src/storage.ts
git commit -m "feat: add tombstone filtering, reinforcement, and decay fields to storage"
```

---

### Task 4: Modify daemon search handler for over-fetch + re-rank + reinforce

**Files:**
- Modify: `src/daemon.ts`

**Step 1: Add retention import**

Add at top of `src/daemon.ts`:

```typescript
import { computeRetention, computeStability, OVER_FETCH_MULTIPLIER, TOMBSTONE_THRESHOLD } from './retention.js';
```

**Step 2: Modify `search_memory` handler**

Replace the `search_memory` case in `handleRequest` (lines 117-128) with:

```typescript
case 'search_memory': {
  const storage = await getStorage(params);
  const vector = await embeddings.generateEmbedding(params.query as string);
  const requestedLimit = (params.limit as number) || 10;

  // Over-fetch to compensate for retention re-ranking
  const results = await storage.search({
    vector,
    limit: requestedLimit * OVER_FETCH_MULTIPLIER,
    agent: params.agent as string | undefined,
    project: params.project as string | undefined,
    tags: params.tags as string[] | undefined,
  });

  const now = Date.now();
  const toTombstone: string[] = [];
  const scored: Array<typeof results[number] & { retention: number }> = [];

  for (const r of results) {
    const lastAccessed = r.last_accessed || r.created_at;
    const daysSince = (now - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
    const stability = r.stability ?? 1.0;
    const retention = computeRetention(daysSince, stability);

    if (retention < TOMBSTONE_THRESHOLD) {
      toTombstone.push(r.id);
    } else {
      scored.push({ ...r, score: r.score * retention, retention });
    }
  }

  // Sort by decay-adjusted score, take top N
  scored.sort((a, b) => b.score - a.score);
  const final = scored.slice(0, requestedLimit);

  // Async: tombstone decayed memories (fire and forget)
  if (toTombstone.length > 0) {
    storage.tombstoneMemories(toTombstone).catch((err: unknown) => {
      log(`Failed to tombstone memories: ${err}`);
    });
  }

  // Async: reinforce returned memories (fire and forget)
  if (final.length > 0) {
    storage.reinforceMemories(
      final.map((r) => ({ id: r.id, accessCount: r.access_count ?? 0 }))
    ).catch((err: unknown) => {
      log(`Failed to reinforce memories: ${err}`);
    });
  }

  return { results: final };
}
```

**Step 3: Modify `store_memory` handler**

No changes needed — `storage.store()` already sets the decay fields from Task 3.

**Step 4: Verify build**

Run: `cd /home/ryan/Code/memory-mcp && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/daemon.ts
git commit -m "feat: add over-fetch, retention re-ranking, inline tombstoning to search"
```

---

### Task 5: Build, restart daemon, and manual smoke test

**Files:** None (runtime verification)

**Step 1: Build**

Run: `cd /home/ryan/Code/memory-mcp && npm run build`
Expected: Clean compilation, no errors

**Step 2: Restart the daemon**

Run: `cd /home/ryan/Code/memory-mcp && bash scripts/restart-daemon.sh`
Expected: Daemon restarts with new code

**Step 3: Smoke test — store a memory**

Use the MCP tools to store a test memory and verify it gets the new decay fields. Run a search and confirm:
- Results include `retention` score
- `last_accessed` and `access_count` are present
- Searching again shows `access_count` incremented

**Step 4: Smoke test — verify old memories work**

Search for an existing memory (stored before this change). Verify:
- It returns with `retention` computed from `created_at` (since `last_accessed` is absent)
- Score is `similarity * retention`
- After being returned, it gets reinforced (search again, `access_count` should be 1)

**Step 5: Run all tests**

Run: `cd /home/ryan/Code/memory-mcp && npx vitest run`
Expected: All retention tests pass

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: Ebbinghaus forgetting curve for shared memory MCP

Memories now decay over time following the Ebbinghaus forgetting curve.
Search results are ranked by similarity * retention. Memories are
reinforced when returned in search results or updated. Fully decayed
memories are tombstoned inline during search."
```
