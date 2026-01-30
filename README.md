# Shared Agent Memory

MCP server enabling multiple AI agents to share persistent memory via Qdrant.

## Claude Code Setup

Paste this into Claude Code:

```
Read https://raw.githubusercontent.com/rbrcurtis/shared-agent-memory/main/CLAUDE_INSTRUCTIONS.md and follow the setup instructions.
```

### Manual Installation

```bash
git clone https://github.com/rbrcurtis/shared-agent-memory.git ~/shared-agent-memory
cd ~/shared-agent-memory
npm install
npm run build

claude mcp add-json shared-memory '{
  "type": "stdio",
  "command": "node",
  "args": ["'$HOME'/shared-agent-memory/dist/index.js"],
  "env": {
    "QDRANT_URL": "http://localhost:6333",
    "DEFAULT_AGENT": "claude-code"
  }
}' -s user
```

## Project Scoping

Memories are automatically scoped to the current project to prevent cross-project pollution. The project name is determined by:

1. **Git remote** (preferred): Extracted from `git remote get-url origin`
   - `https://github.com/user/my-app.git` → `my-app`
   - `git@bitbucket.org:team/backend.git` → `backend`
2. **Folder name** (fallback): Used when not in a git repo

This means memories stored while working on `my-app` are only visible when working in that repo, regardless of the local folder name.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QDRANT_URL` | Qdrant server URL | `http://localhost:6333` |
| `QDRANT_API_KEY` | API key for Qdrant | none |
| `COLLECTION_NAME` | Qdrant collection name | `shared_agent_memory` |
| `DEFAULT_AGENT` | Default agent identifier | `unknown` |
| `DEFAULT_PROJECT` | Override auto-detected project | git repo name or folder |

### CLI Arguments

```bash
node dist/index.js \
  --qdrant-url http://your-qdrant:6333 \
  --api-key YOUR_KEY \
  --collection my_memories \
  --agent claude-code
```

## Tools

| Tool | Description |
|------|-------------|
| `store_memory` | Store text in current project, generates embedding automatically |
| `search_memory` | Semantic search within current project |
| `list_recent` | List recent memories in current project |
| `delete_memory` | Remove a memory by ID |

## Architecture

```
Agent 1 (Claude Code) ──┐
                        ├── MCP (local, stdio) ── Qdrant (remote)
Agent 2 (Cursor)     ──┘
```

Embeddings generated locally using `all-MiniLM-L6-v2` (384 dimensions). Zero external API costs for embeddings.

## License

MIT
