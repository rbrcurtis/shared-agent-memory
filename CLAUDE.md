# CLAUDE.md

## What This Is

Shared Agent Memory MCP server - enables AI agents to share persistent context via Qdrant.

## Architecture

```
MCP Wrapper (index.ts) → REST API (api/server.ts) → Qdrant
```

- `index.ts` — MCP stdio server + CLI parsing, exposes memory tools to agents
- `client.ts` — HTTP client for the REST API
- `api/server.ts` — Fastify API server, holds the embedding model and handles all Qdrant operations
- `storage.ts` — Qdrant client wrapper (hybrid search: dense + BM25 sparse vectors)
- `embeddings.ts` — local embedding generation (all-MiniLM-L6-v2, 384-dim)
- `retention.ts` — Ebbinghaus forgetting curve (decay, stability, tombstoning)
- `secret-filter.ts` — three-layer secret detection (prefix patterns, high-entropy strings, keyword proximity)
- `types.ts` — TypeScript interfaces

Legacy files (unused): `server.ts`, `memory.ts`

## Commands

```bash
npm run build    # Compile TypeScript
npm test         # Run tests (vitest)
npm start        # Run MCP server (needs MEMORY_API_KEY)
npm run start:api # Run REST API server (needs QDRANT_URL and API_KEYS)
```

## Testing

```bash
npm test                           # All tests
npx vitest src/secret-filter.test  # Secret filter only
npx vitest src/retention.test      # Retention only
```

## Other Files

- `web/index.html` — standalone memory browser UI (talks directly to Qdrant REST API)
- `scripts/backfill-titles.ts` — one-time migration to add titles to existing memories
- `scripts/migrate-hybrid.ts` — one-time migration to add BM25 sparse vectors
- `k8s/` — Kubernetes manifests for memory browser deployment (nginx + ConfigMap)
