# Memory-MCP REST API Design

## Overview

Add a REST API surface to the memory-mcp system so that agents and external services (OpenClaw, etc.) can search and store memories via HTTP without running the MCP server locally. The existing daemon/MCP architecture remains unchanged — the API is a new, independent entry point sharing the same service layer.

### Goals

- Centralized API that agents call via HTTP — no local MCP server or daemon required
- Self-documenting via Swagger/OpenAPI (Fastify + @fastify/swagger)
- Deployable as a Docker container alongside Qdrant (sidecar in k8s, separate service in compose)
- API key authentication with optional project scoping
- Update server logic without affecting agent configurations (beyond possibly updating usage prompts)

### Non-Goals

- Replacing the existing daemon/MCP path (it stays as-is)
- Admin UI for key management (v1 uses env vars)
- Rate limiting (can be added later)
- Skill file for agent discovery (future enhancement)

## Architecture

```
Existing (unchanged):
  MCP clients → index.ts → client.ts → daemon.ts (Unix socket) → storage.ts → Qdrant

New:
  HTTP clients → api/server.ts (Fastify) → storage.ts → Qdrant
                                          → embeddings.ts
                                          → retention.ts
                                          → secret-filter.ts
```

The API server is a self-contained process. It loads its own embedding model (Xenova/all-MiniLM-L6-v2, ~35MB, ~100ms per embedding after warmup) and connects to Qdrant directly. No dependency on the daemon.

Both surfaces share the same service layer files — `storage.ts`, `embeddings.ts`, `retention.ts`, `secret-filter.ts` — imported directly.

The API server is stateless with respect to Qdrant. It reads/writes the existing `shared_agent_memory` collection. No migrations, no schema changes, no risk to existing memories.

## REST API Surface

All endpoints are under `/api/v1`. Swagger UI is served at `/docs`, OpenAPI JSON at `/docs/json`.

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/memories` | Store a new memory |
| GET | `/api/v1/memories/search` | Search by semantic similarity |
| GET | `/api/v1/memories/load` | Fetch full text by IDs |
| GET | `/api/v1/memories/recent` | List recent memories |
| PUT | `/api/v1/memories/:id` | Update an existing memory |
| DELETE | `/api/v1/memories/:id` | Delete a memory |
| GET | `/api/v1/config` | Server health and config info |

### POST /api/v1/memories

Store a new memory.

**Request body:**
```json
{
  "text": "string (required)",
  "title": "string (required)",
  "agent": "string (optional)",
  "project": "string (optional, defaults from key config or rejected)",
  "tags": ["string"] 
}
```

**Response (201):**
```json
{
  "data": { "id": "uuid" }
}
```

### GET /api/v1/memories/search

Search memories by semantic similarity. Returns titles and IDs only (no full text, no reinforcement).

**Query params:**
- `query` (required) — natural language search query
- `limit` (optional, default 10) — max results
- `agent` (optional) — filter by agent
- `project` (optional) — filter by project
- `tags` (optional, comma-separated) — filter by tags

**Response (200):**
```json
{
  "data": [
    { "id": "uuid", "title": "string", "score": 0.85 }
  ]
}
```

### GET /api/v1/memories/load

Fetch full text of memories by ID. Triggers reinforcement internally (increments access_count, updates last_accessed, recalculates stability). Callers don't need to know about reinforcement — they're just fetching memories.

**Query params:**
- `ids` (required) — comma-separated UUIDs

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "text": "string",
      "agent": "string",
      "project": "string",
      "tags": ["string"],
      "created_at": "iso8601",
      "last_accessed": "iso8601",
      "access_count": 5
    }
  ]
}
```

### GET /api/v1/memories/recent

List recently created memories. Returns titles and IDs only.

**Query params:**
- `limit` (optional, default 10)
- `days` (optional, default 7)
- `project` (optional)

**Response (200):**
```json
{
  "data": [
    { "id": "uuid", "title": "string", "created_at": "iso8601" }
  ]
}
```

### PUT /api/v1/memories/:id

Update an existing memory's text and optionally its title.

**Request body:**
```json
{
  "text": "string (required)",
  "title": "string (optional, preserves existing if omitted)",
  "project": "string (optional)"
}
```

**Response (200):**
```json
{
  "data": { "success": true }
}
```

### DELETE /api/v1/memories/:id

Hard delete a memory.

**Response (200):**
```json
{
  "data": { "success": true }
}
```

### GET /api/v1/config

Server health and configuration info.

**Response (200):**
```json
{
  "data": {
    "qdrantUrl": "string",
    "collectionName": "string",
    "modelReady": true
  }
}
```

### Error Responses

All errors use a consistent envelope:

```json
{
  "error": {
    "code": 400,
    "message": "descriptive error message"
  }
}
```

Standard HTTP status codes: 400 (bad request / validation), 401 (missing/invalid key), 403 (project not in scope), 404 (memory not found), 500 (server error).

## Authentication & Project Scoping

### API Keys

Keys are configured via the `API_KEYS` environment variable containing a JSON array:

```json
[
  {"key": "sm_abc123...", "name": "claude-personal", "projects": null, "default_project": null},
  {"key": "sm_def456...", "name": "openclaw", "projects": ["openclaw"], "default_project": "openclaw"}
]
```

- Keys are prefixed with `sm_` for easy identification
- Passed via `Authorization: Bearer sm_...` header
- Compared using constant-time comparison (timing-safe)
- Parsed once at server startup
- `default_project` — optional fallback when the caller omits `project` from a request

### Project Scoping

- `projects: null` — full access to all projects (for personal agents)
- `projects: ["openclaw", "other"]` — restricted to listed projects only

**Enforcement rules:**
- Missing or invalid key → 401 Unauthorized
- Key valid but requested project not in allowed list → 403 Forbidden
- If caller specifies a project, it must be in the key's allowed list (or the key has `projects: null`)
- If caller omits project and the key has `default_project`, that value is used
- If caller omits project and the key has no `default_project`, the request proceeds with no project filter (full-access keys) or is rejected with 400 (restricted keys)

## Project Structure

### New Files (in memory-mcp repo)

```
src/
  api/
    server.ts              # Fastify app setup, plugin registration, listen
    routes/
      memories.ts          # All /api/v1/memories/* route handlers
      config.ts            # GET /api/v1/config
    middleware/
      auth.ts              # API key validation + project scoping
    schemas/
      memory.ts            # Fastify JSON schemas (validation + Swagger generation)
Dockerfile                 # API server image (multi-stage Node build)
```

### Infrastructure Files (in ~/plans/)

```
plans/
  memory-mcp/
    docker-compose.yml     # Local dev: API server + Qdrant containers
    k8s/                   # Metal cluster deployment
      deployment.yaml      # 2-container pod (API server + Qdrant sidecar)
      service.yaml
      ingress.yaml
```

### Dockerfile

Multi-stage build:

1. **Build stage:** Install deps, compile TypeScript
2. **Production stage:** Copy dist/, node_modules (production only), expose port

The embedding model (~35MB) downloads on first use at runtime and is cached in the container's filesystem. For faster cold starts, it could be baked into the image in a future iteration.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QDRANT_URL` | Yes | — | Qdrant REST endpoint (e.g., `http://localhost:6333`) |
| `QDRANT_API_KEY` | No | — | Qdrant authentication key |
| `COLLECTION_NAME` | No | `shared_agent_memory` | Qdrant collection name |
| `API_KEYS` | Yes | — | JSON array of API key configs |
| `PORT` | No | `3000` | HTTP listen port |

## Agent Integration

Agents discover and use the API via:

1. **CLAUDE.md instructions** — updated to include API base URL and Bearer token, replacing MCP tool references
2. **Swagger docs** — agents can fetch `/docs/json` for the full OpenAPI spec
3. **curl / fetch** — agents already have access to shell tools for HTTP calls

Example agent instruction (CLAUDE.md):
```
## Shared Memory API
- Base URL: http://memory-api.local:3000/api/v1
- Auth: Bearer sm_... (in header)
- Search before exploring: GET /memories/search?query=...
- Load full text: GET /memories/load?ids=id1,id2
- Store learnings: POST /memories with {text, title, project?, tags?}
- Full docs: http://memory-api.local:3000/docs
```

## What Stays Unchanged

- `src/daemon.ts` — Unix socket JSON-RPC server
- `src/index.ts` — MCP stdio wrapper
- `src/client.ts` — daemon IPC client
- `src/storage.ts` — Qdrant operations (consumed by both daemon and API)
- `src/embeddings.ts` — local embedding model (consumed by both)
- `src/retention.ts` — forgetting curve logic (consumed by both)
- `src/secret-filter.ts` — secret detection (consumed by both)
- `src/types.ts` — type definitions (consumed by both)
- All existing tests
