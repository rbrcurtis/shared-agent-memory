# Shared Agent Memory

Self-updating RAG for teams of AI agents. Shared Agent Memory gives Claude Code, Codex, Cursor, and other MCP clients a common, searchable project memory backed by Qdrant, then nudges agents to keep that memory current as they work.

Instead of every agent rediscovering the same repo patterns, infrastructure details, and troubleshooting history, teams get a shared retrieval layer that improves over time. Agents search the memory store before diving into files, load only the relevant full notes, and store or update durable learnings when the conversation reveals something worth preserving.

## Features

- **Team RAG layer** — shared retrieval-augmented context across projects, repos, and agents
- **Self-updating workflow** — Claude Code, Codex, and Cursor plugins ship stop hooks that prompt memory curation every fifth assistant turn
- **Project-aware writes** — new memories default to the current git project; searches span all accessible projects unless filtered
- **Hybrid search** — dense vector similarity (all-MiniLM-L6-v2) + BM25 keyword matching, fused with Reciprocal Rank Fusion
- **Ebbinghaus forgetting curve** — memories decay over time; frequently-accessed memories persist, unused ones fade and get tombstoned after ~6 months
- **Secret filtering** — four-layer detection (known token prefixes, high-entropy strings, credential assignment, keyword proximity) rejects memories containing API keys, tokens, or credentials
- **REST API** — authenticated Fastify server with Swagger UI; MCP clients use this API too
- **Memory browser** — standalone web UI for browsing, searching, editing, and deleting memories directly via Qdrant's REST API
- **Multi-agent memory** — multiple AI agents share the same memory store through one API
- **Two-step search** — returns titles first for context efficiency, then loads full text on demand
- **Local embeddings** — all-MiniLM-L6-v2 runs locally, zero external API costs
- **API-backed MCP** — MCP tools call the REST API directly; no background MCP daemon

## How It Works

1. Agents call `search_memory` to retrieve compact titles and IDs from the team memory store.
2. Agents call `load_memories` only for relevant hits, keeping context usage low.
3. Agents call `store_memory` for new durable learnings and `update_memory` when existing knowledge changes.
4. Agent plugins inject the canonical memory-capture prompt every five assistant turns, reminding the active agent to search first, update stale memories, and store new architecture/workflow/troubleshooting learnings.

The hook is intentionally prompt-based. It works in normal agent plugin environments without requiring a separate background model process or direct Qdrant access. The REST API still enforces auth, project access, audit metadata, and secret filtering on every write.

## Claude Code Setup

### Marketplace Install

Install the Claude Code marketplace and plugin:

```bash
curl -fsSL https://raw.githubusercontent.com/rbrcurtis/shared-agent-memory/main/install.sh | bash
```

For project scope:

```bash
curl -fsSL https://raw.githubusercontent.com/rbrcurtis/shared-agent-memory/main/install.sh | SCOPE=project bash
```

Or from a checkout:

```bash
git clone https://github.com/rbrcurtis/shared-agent-memory.git
cd shared-agent-memory
scripts/setup-claude-code.sh
```

Claude Code will prompt for:

| Option            | Description                                | Default                 |
| ----------------- | ------------------------------------------ | ----------------------- |
| `memory_api_url`  | Shared memory API base URL                 | `http://localhost:3100` |
| `memory_api_key`  | Bearer token for the memory API            | required                |
| `default_agent`   | Agent stored on new memories               | `claude-code`           |
| `default_project` | Optional project override for new memories | auto-detect             |

For local marketplace testing from this checkout:

```bash
scripts/setup-claude-code.sh --local
```

For project-level setup with shared team configuration:

```bash
scripts/setup-claude-code.sh \
  --scope project \
  --memory-api-url https://memory.example.com \
  --memory-api-key TEAM_API_KEY \
  --default-agent claude-code \
  --default-project my-project
```

This writes the plugin enablement and `pluginConfigs` values to `.claude/settings.json` in the target repo. Commit that file only when the API key is intentionally shared with the team.

For an internal fork or mirror:

```bash
curl -fsSL https://raw.githubusercontent.com/rbrcurtis/shared-agent-memory/main/install.sh | SOURCE=github-org/shared-agent-memory bash
```

Manual CLI equivalent:

```bash
claude plugin marketplace add rbrcurtis/shared-agent-memory
claude plugin install shared-agent-memory@shared-agent-memory
```

### Installation Scope

| Scope   | Flag              | Config File             | Use Case                           |
| ------- | ----------------- | ----------------------- | ---------------------------------- |
| User    | `--scope user`    | Claude user settings    | Shared memory API for all projects |
| Project | `--scope project` | Project Claude settings | Team/project install               |
| Local   | `--scope local`   | Local Claude settings   | Machine-local test install         |

The setup script defaults to user scope. Pass `--scope project` or `--scope local` when needed:

```bash
scripts/setup-claude-code.sh --scope project
```

### Direct MCP Fallback

The marketplace plugin is preferred. For a one-off direct MCP install:

```bash
git clone https://github.com/rbrcurtis/shared-agent-memory.git <PATH>
cd <PATH>
npm install
npm run build

claude mcp add-json shared-memory '{
  "type": "stdio",
  "command": "node",
  "args": ["<PATH>/dist/index.js"],
  "env": {
    "MEMORY_API_URL": "http://localhost:3100",
    "MEMORY_API_KEY": "your-bearer-token",
    "DEFAULT_AGENT": "claude-code"
  }
}'
```

The MCP server talks to the REST API. It does not start Qdrant and does not run a background daemon.

## Codex Setup

Codex support ships as a native plugin manifest plus a repo-local marketplace:

- `.codex-plugin/plugin.json` - Codex plugin metadata
- `.agents/plugins/marketplace.json` - marketplace entry for this repo
- `.mcp.codex.json` - bundled MCP server config
- `hooks/hooks.json` - Codex `Stop` hook for memory capture

Add this repo as a Codex marketplace:

```bash
codex plugin marketplace add rbrcurtis/shared-agent-memory
```

For local testing from this checkout:

```bash
codex plugin marketplace add "$(pwd)"
```

Then open `/plugins` in Codex, install **Shared Agent Memory**, and start a new thread. Bundled plugin hooks require:

```bash
codex features enable plugin_hooks
```

Codex hooks are otherwise enabled by default. If they were disabled locally, re-enable them:

```bash
codex features enable hooks
```

The Codex MCP config forwards `MEMORY_API_URL`, `MEMORY_API_KEY`, `DEFAULT_AGENT`, and `DEFAULT_PROJECT` from Codex's local environment. If you prefer explicit user config, keep a direct MCP entry in `~/.codex/config.toml`:

```toml
[mcp_servers.shared-memory]
command = "/path/to/shared-agent-memory/bin/shared-agent-memory"
startup_timeout_sec = 60

[mcp_servers.shared-memory.env]
MEMORY_API_URL = "http://localhost:3100"
MEMORY_API_KEY = "your-bearer-token"
DEFAULT_AGENT = "codex"
DEFAULT_PROJECT = ""
```

## Cursor Setup

Cursor support ships with the same plugin shape as the official Cursor marketplace:

- `.cursor-plugin/marketplace.json` - repo marketplace entry
- `.cursor-plugin/plugin.json` - Cursor plugin metadata
- `.mcp.cursor.json` - bundled MCP server config
- `hooks/hooks.cursor.json` - Cursor `stop` hook for memory capture

For local testing, expose this checkout as a local Cursor plugin and reload Cursor:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s "$(pwd)" ~/.cursor/plugins/local/shared-agent-memory
```

For team rollout, import `rbrcurtis/shared-agent-memory` as a Cursor team marketplace and enable auto refresh. Marketplace updates are repo-driven; new pushes are re-indexed and clients pick them up on refresh/restart.

The Cursor MCP config launches `bin/shared-agent-memory` through `CURSOR_PLUGIN_ROOT` and defaults `DEFAULT_AGENT` to `cursor`. Set these in Cursor's environment or your deployment wrapper:

```bash
export MEMORY_API_URL=http://localhost:3100
export MEMORY_API_KEY=your-bearer-token
export DEFAULT_AGENT=cursor
```

Use a direct Cursor MCP entry only when you need machine-local credentials outside the plugin marketplace.

## Project Scoping

MCP `store_memory` stores new memories in the detected current project when `project` is omitted. Agents may pass `project` only when deliberately saving knowledge for a different related repo. The MCP server determines the default project by:

1. **Git remote** (preferred): Extracted from `git remote get-url origin`
   - `https://github.com/user/my-app.git` → `my-app`
   - `git@bitbucket.org:team/backend.git` → `backend`
2. **Folder name** (fallback): Used when not in a git repo

Search and recent-listing default to all projects the API key can access. Pass `project` to `search_memory`, `list_recent`, or the REST API endpoints to filter to a single project. Search results include the project name so callers can see where each memory came from.

## Agent Instructions

The Claude Code, Codex, and Cursor plugins automatically register a stop hook. After assistant turns, the hook runs the shared wrapper:

```bash
bin/shared-agent-memory --memory-turn-hook
```

The hook counts assistant turns from the client transcript when available, falls back to per-session plugin data, and injects the canonical memory-capture prompt every fifth assistant turn. The prompt tells the active agent to:

- Review the conversation for durable learnings
- Search existing memories before writing
- Update outdated memories instead of creating duplicates
- Store new architecture, workflow, troubleshooting, codebase, infrastructure, and user-preference learnings
- Keep one concept per memory

For consistent memory usage, also add durable instructions to `~/.claude/CLAUDE.md` or the repo's `CLAUDE.md`/`AGENTS.md`:

```markdown
## Shared Memory

- **ALWAYS search_memory BEFORE searching files** when tasks need project context
- **ALWAYS store_memory** when you learn: workflows, troubleshooting, codebase patterns, user preferences, infrastructure
- **ALWAYS update_memory** when information changes - no stale duplicates
- One concept per memory, descriptive text for semantic search
```

## Configuration

### Environment Variables

| Variable          | Description                         | Default                 |
| ----------------- | ----------------------------------- | ----------------------- |
| `MEMORY_API_URL`  | Memory API base URL for MCP clients | `http://localhost:3100` |
| `MEMORY_API_KEY`  | Bearer token for MCP clients        | required                |
| `DEFAULT_AGENT`   | Default agent identifier            | `unknown`               |
| `DEFAULT_PROJECT` | Override auto-detected project      | git repo name or folder |

### CLI Arguments

```bash
node dist/index.js \
  --memory-api-url http://localhost:3100 \
  --memory-api-key YOUR_KEY \
  --agent claude-code
```

## MCP Tools

| Tool            | Description                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `store_memory`  | Store text with a title, generates embedding automatically                                            |
| `search_memory` | Semantic search across all accessible projects by default — returns titles, IDs, projects, and scores |
| `load_memories` | Load full text by IDs, reinforces loaded memories                                                     |
| `list_recent`   | List recent memories across all accessible projects by default — returns titles, IDs, and projects    |
| `update_memory` | Update existing memory with new text and title                                                        |
| `delete_memory` | Remove a memory by ID                                                                                 |
| `get_config`    | Show current MCP/API configuration                                                                    |

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
PORT=3100 QDRANT_URL=http://localhost:6333 node dist/api/server.js

# Or via Docker
docker build -t shared-agent-memory .
docker run -p 3100:3100 \
  -e QDRANT_URL=http://your-qdrant:6333 \
  -e QDRANT_API_KEY=optional \
  -e API_KEYS='[{"key":"your-bearer-token","name":"my-service","projects":null}]' \
  shared-agent-memory
```

Swagger UI available at `http://localhost:3100/docs`.

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

| Method | Endpoint                     | Description                      |
| ------ | ---------------------------- | -------------------------------- |
| GET    | `/health`                    | Health check (no auth)           |
| POST   | `/api/v1/memories`           | Store a memory                   |
| GET    | `/api/v1/memories/search`    | Search with retention re-ranking |
| GET    | `/api/v1/memories/load`      | Load full text by IDs, reinforce |
| GET    | `/api/v1/memories/recent`    | List recent by creation date     |
| GET    | `/api/v1/memories/:id/audit` | List audit events for a memory   |
| PUT    | `/api/v1/memories/:id`       | Update a memory                  |
| DELETE | `/api/v1/memories/:id`       | Delete a memory                  |
| GET    | `/api/v1/config`             | Server config and model status   |
| GET    | `/docs`                      | Swagger UI (no auth)             |

### Audit Metadata

Each memory stores current audit metadata in its payload:

- `createdAt` / `updatedAt`
- `createdBy` / `updatedBy`

The actor fields use the matching API key's `name`. Create, update, and delete operations also write append-only audit events to a companion Qdrant collection named `<collection>_audit`.

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
| ------------ | --------- | ------------------- |
| 0            | 1.0       | 27 days             |
| 1            | 1.69      | 46 days             |
| 5            | 2.79      | 75 days             |
| 10           | 3.40      | 92 days             |
| 20           | 4.04      | 109 days            |

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

Applied to both `store_memory` and `update_memory` at the API level, covering all clients.

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
                        ├── MCP Wrapper ── REST API (Fastify) ── Qdrant
Agent 2 (Codex)      ──┤                   localhost:3100
Agent 3 (Cursor)     ──┘

External Service ────── REST API (Fastify) ── Qdrant
                        localhost:3100
```

The API process keeps the embedding model loaded in memory for fast responses:

- **MCP Wrapper** (`index.ts`): Thin stdio server that exposes memory tools
- **Client** (`client.ts`): HTTP client for the REST API
- **REST API** (`api/server.ts`): Fastify server for memory operations and embedding generation

Embeddings generated locally using `all-MiniLM-L6-v2` (384 dimensions). Zero external API costs.

## Docker

```bash
docker build -t shared-agent-memory .
docker run -p 3100:3100 \
  -e QDRANT_URL=http://host.docker.internal:6333 \
  -e API_KEYS='[{"key":"your-token","name":"default","projects":null}]' \
  shared-agent-memory
```

The Docker image runs the REST API server. For the MCP server, run `node dist/index.js` directly; it uses stdio for MCP and HTTP for memory operations.

## License

MIT
