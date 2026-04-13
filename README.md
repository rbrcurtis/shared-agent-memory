# Shared Agent Memory

MCP server enabling multiple AI agents to share persistent memory via Qdrant.

## Features

- **Hybrid search** — dense vector similarity (all-MiniLM-L6-v2) + BM25 keyword matching, fused with Reciprocal Rank Fusion
- **Ebbinghaus forgetting curve** — memories decay over time; frequently-accessed memories persist, unused ones fade and get tombstoned after ~6 months
- **Secret filtering** — four-layer detection (known token prefixes, high-entropy strings, credential assignment, keyword proximity) rejects memories containing API keys, tokens, or credentials
- **REST API** — authenticated Fastify server with Swagger UI for non-MCP clients
- **Memory browser** — standalone web UI for browsing, searching, editing, and deleting memories directly via Qdrant's REST API
- **Multi-agent / multi-Qdrant** — multiple AI agents share the same memory store; different projects can point to different Qdrant instances
- **Two-step search** — returns titles first for context efficiency, then loads full text on demand
- **Local embeddings** — all-MiniLM-L6-v2 runs locally, zero external API costs
- **Daemon architecture** — long-running process keeps embedding model warm; auto-starts on first request, shuts down after idle timeout

## Claude Code Setup

Paste this into Claude Code:

```
Read https://raw.githubusercontent.com/rbrcurtis/shared-agent-memory/main/CLAUDE_INSTRUCTIONS.md and follow the setup instructions.
```

### Manual Installation

```bash
# Clone to your preferred location
git clone https://github.com/rbrcurtis/shared-agent-memory.git <PATH>
cd <PATH>
npm install
npm run build

# Project-level (recommended) - add to current project's .mcp.json
claude mcp add-json shared-memory '{
  "type": "stdio",
  "command": "node",
  "args": ["<PATH>/dist/index.js"],
  "env": {
    "QDRANT_URL": "http://localhost:6333",
    "DEFAULT_AGENT": "claude-code"
  }
}'
```

### Installation Scope

| Scope | Flag | Config File | Use Case |
|-------|------|-------------|----------|
| Project | (default) | `.mcp.json` | Different Qdrant per project |
| User | `-s user` | `~/.claude.json` | Shared Qdrant for all projects |

**Multi-Qdrant Setup**: The daemon supports multiple Qdrant servers simultaneously. Configure different servers per project:

```bash
# Work projects - uses company Qdrant
cd ~/work/api && claude mcp add-json shared-memory '{
  "env": { "QDRANT_URL": "https://qdrant.company.com", "QDRANT_API_KEY": "..." }
}'

# Personal projects - uses local Qdrant
cd ~/projects/app && claude mcp add-json shared-memory '{
  "env": { "QDRANT_URL": "http://localhost:6333" }
}'
```

Project `.mcp.json` overrides user `~/.claude.json` when both exist.

## Project Scoping

Memories are automatically scoped to the current project to prevent cross-project pollution. The project name is determined by:

1. **Git remote** (preferred): Extracted from `git remote get-url origin`
   - `https://github.com/user/my-app.git` → `my-app`
   - `git@bitbucket.org:team/backend.git` → `backend`
2. **Folder name** (fallback): Used when not in a git repo

This means memories stored while working on `my-app` are only visible when working in that repo, regardless of the local folder name.

## Agent Instructions

For consistent memory usage, add instructions to **both** `~/.claude/CLAUDE.md` and a SessionStart hook.

### 1. Add to ~/.claude/CLAUDE.md

```markdown
## Shared Memory
- **ALWAYS search_memory BEFORE searching files** when tasks need project context
- **ALWAYS store_memory** when you learn: workflows, troubleshooting, codebase patterns, user preferences, infrastructure
- **ALWAYS update_memory** when information changes - no stale duplicates
- One concept per memory, descriptive text for semantic search
```

### 2. Add SessionStart hook to ~/.claude/settings.json

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo '## SHARED MEMORY - REQUIRED\\n\\n**ALWAYS search_memory BEFORE searching files** when tasks need project context.\\n\\n**ALWAYS store_memory** when you learn: workflows, troubleshooting steps, codebase patterns, user preferences, infrastructure details.\\n\\n**ALWAYS update_memory** when information changes - never create duplicates of stale data.\\n\\nOne concept per memory. Descriptive text for semantic search.'"
          }
        ]
      }
    ]
  }
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QDRANT_URL` | Qdrant server URL | `http://localhost:6333` |
| `QDRANT_API_KEY` | API key for Qdrant | none |
| `COLLECTION_NAME` | Qdrant collection name | `shared_agent_memory` |
| `DEFAULT_AGENT` | Default agent identifier | `unknown` |
| `DEFAULT_PROJECT` | Override auto-detected project | git repo name or folder |
| `DAEMON_IDLE_TIMEOUT` | Daemon shutdown after N seconds idle | `7200` (2 hours) |

### CLI Arguments

```bash
node dist/index.js \
  --qdrant-url http://your-qdrant:6333 \
  --api-key YOUR_KEY \
  --collection my_memories \
  --agent claude-code
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `store_memory` | Store text with a title, generates embedding automatically |
| `search_memory` | Semantic search — returns titles and IDs only |
| `load_memories` | Load full text by IDs, reinforces loaded memories |
| `list_recent` | List recent memories — returns titles and IDs |
| `update_memory` | Update existing memory with new text and title |
| `delete_memory` | Remove a memory by ID |
| `get_config` | Show current configuration and daemon status |

### Two-Step Search

Search is designed for context efficiency. Instead of dumping full text for every result, it returns compact titles so the agent can pick which memories to actually read:

1. **`search_memory`** — returns a list of titles with IDs and relevance scores
2. Agent reviews titles, picks the relevant ones
3. **`load_memories`** — fetches full text for selected IDs

This matters because AI agents have limited context windows. Returning 10 full memories might consume thousands of tokens, most of which are irrelevant. Titles let the agent be selective.

### Hybrid Search

Search combines two retrieval strategies using Reciprocal Rank Fusion (RRF):

- **Dense vectors**: Semantic similarity via `all-MiniLM-L6-v2` embeddings (384 dimensions)
- **BM25 sparse vectors**: Keyword matching via Qdrant's built-in BM25 model

This means a search for "Docker compose" finds memories that mention containers and orchestration (semantic) as well as those that literally say "Docker compose" (keyword). Both strategies are fused into a single ranked result list.

## REST API

A Fastify-based HTTP server for non-MCP clients, with OpenAPI spec and Swagger UI.

### Setup

```bash
# Run directly
PORT=3000 QDRANT_URL=http://localhost:6333 node dist/api/server.js

# Or via Docker
docker build -t shared-agent-memory .
docker run -p 3000:3000 \
  -e QDRANT_URL=http://your-qdrant:6333 \
  -e QDRANT_API_KEY=optional \
  -e API_KEYS='[{"key":"your-bearer-token","name":"my-service","projects":null}]' \
  shared-agent-memory
```

Swagger UI available at `http://localhost:3000/docs`.

### Authentication

Bearer token via the `API_KEYS` environment variable (JSON array):

```json
[
  {
    "key": "your-secret-token",
    "name": "my-service",
    "projects": ["project-a", "project-b"]
  }
]
```

- `projects: null` — full access to all projects
- `projects: ["a", "b"]` — restricted to listed projects

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check (no auth) |
| POST | `/api/v1/memories` | Store a memory |
| GET | `/api/v1/memories/search` | Search with retention re-ranking |
| GET | `/api/v1/memories/load` | Load full text by IDs, reinforce |
| GET | `/api/v1/memories/recent` | List recent by creation date |
| PUT | `/api/v1/memories/:id` | Update a memory |
| DELETE | `/api/v1/memories/:id` | Delete a memory |
| GET | `/api/v1/config` | Server config and model status |
| GET | `/docs` | Swagger UI (no auth) |

## Ebbinghaus Forgetting Curve

Memories decay over time using a model inspired by the [Ebbinghaus forgetting curve](https://en.wikipedia.org/wiki/Forgetting_curve). This ensures that unused memories fade naturally while frequently-accessed memories persist.

### How It Works

Each memory tracks three fields:

- **`last_accessed`** — timestamp of the last time the memory was loaded
- **`access_count`** — how many times it has been loaded
- **`stability`** — derived from access_count, controls how slowly the memory decays

The retention (probability of recall) at time `t` days since last access is:

```
retention = e^(-t / (BASE_HALF_LIFE * stability / ln(2)))
```

With `BASE_HALF_LIFE = 27 days`, a never-accessed memory (stability = 1.0) drops to 50% retention after 27 days. Frequently-accessed memories decay much slower because their stability grows logarithmically:

| Access Count | Stability | Effective Half-Life |
|-------------|-----------|-------------------|
| 0 | 1.0 | 27 days |
| 1 | 1.69 | 46 days |
| 5 | 2.79 | 75 days |
| 10 | 3.40 | 92 days |
| 20 | 4.04 | 109 days |

### Reinforcement Through Loading, Not Searching

The key design choice: **searching does not reinforce memories**. Only `load_memories` (explicitly fetching full text) counts as an access. This means:

- A memory that appears in search results but is never loaded will naturally decay
- Only memories the agent finds useful enough to read get reinforced
- The system learns which memories matter through actual usage, not just semantic proximity

### Tombstoning

When a memory's retention drops below 1% (`TOMBSTONE_THRESHOLD = 0.01`), it is soft-deleted by setting a `tombstoned_at` timestamp. Tombstoned memories are excluded from all future queries but remain in Qdrant for potential recovery.

A never-accessed memory reaches the tombstone threshold after approximately **180 days (~6 months)**. Memories that have been loaded even a few times last much longer — a memory loaded 5 times won't tombstone for over a year.

Tombstone checks happen lazily during search — when a search returns a decayed memory, it gets tombstoned as a side effect.

### Search Re-Ranking

During search, the raw similarity score from Qdrant is multiplied by the retention value. This means recent, frequently-used memories rank higher than stale ones, even if the stale memory is a slightly better semantic match. To compensate for filtering, search over-fetches 3x the requested limit before applying retention re-ranking and trimming to the final result set.

## Secret Filtering

Memories are scanned for secrets before storage. If a secret is detected, the memory is rejected with an error describing what was found — the calling agent can then redact and retry.

Four detection layers, applied in order:

1. **Known prefix patterns** — regex rules for ~24 known token formats (GitHub PATs, AWS keys, Slack tokens, JWTs, private keys, webhooks, etc.)
2. **Long high-entropy strings** — hex strings ≥32 chars or base64 strings ≥17 chars with Shannon entropy >3.0
3. **Credential assignment** — direct assignment patterns (`token=value`, `api_key: value`) where the value contains digits or special characters
4. **Keyword proximity** — high-entropy strings (>8 chars, entropy >3.2) within 50 characters of keywords like `token`, `password`, `api_key`, `secret`, `bearer`

False positive filtering skips code identifiers (camelCase), file paths, kebab-case strings, and MongoDB ObjectIDs.

Applied to both `store_memory` and `update_memory` at the daemon level, covering all clients.

## Memory Browser

A standalone web UI for browsing, searching, editing, and deleting memories. Single HTML file (`web/index.html`) with inline CSS/JS — no build step, no framework, no server.

- Talks directly to Qdrant's REST API (requires CORS enabled on Qdrant)
- BM25 keyword search via Qdrant's built-in sparse vector query
- Retention bars showing memory decay status
- Filter by project, agent, tags; toggle tombstoned memories
- Edit titles, text, and tags; tombstone-delete memories

Open locally:
```
file:///path/to/web/index.html?url=http://localhost:6333&key=YOUR_KEY
```

For Kubernetes deployment, see `k8s/` directory (nginx serving static files via ConfigMap).

## Architecture

```
Agent 1 (Claude Code) ──┐
                        ├── MCP Wrapper ── Unix Socket ── Daemon ── Qdrant
Agent 2 (Cursor)     ──┘                   /tmp/shared-memory.sock

External Service ────── REST API (Fastify) ── Qdrant
                        localhost:3000
```

The daemon architecture keeps the embedding model loaded in memory for fast responses:

- **MCP Wrapper** (`index.ts`): Thin stdio server that forwards tool calls
- **Daemon** (`daemon.ts`): Long-running process holding the model, listens on Unix socket
- **Client** (`client.ts`): Auto-starts daemon on first request, handles reconnection
- **REST API** (`api/server.ts`): Standalone Fastify server for HTTP access, shares storage and embedding code with the daemon

### Daemon Behavior

| Feature | Behavior |
|---------|----------|
| Socket path | `/tmp/shared-memory.sock` (Linux/Mac), `\\.\pipe\shared-memory` (Windows) |
| Auto-start | Client spawns daemon on first connection if not running |
| Idle timeout | Shuts down after 2 hours of inactivity (configurable) |
| Model loading | Pre-warms on startup, ~100ms for subsequent requests |
| Logs | `/tmp/shared-memory-daemon.log` |

Embeddings generated locally using `all-MiniLM-L6-v2` (384 dimensions). Zero external API costs.

## Docker

```bash
docker build -t shared-agent-memory .
docker run -p 3000:3000 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  -e API_KEYS='[{"key":"your-token","name":"default","projects":null}]' \
  shared-agent-memory
```

The Docker image runs the REST API server. For the MCP server, run `node dist/index.js` directly (it uses stdio, not HTTP).

## License

MIT
