# Shared Agent Memory

MCP server enabling multiple AI agents to share persistent memory via Qdrant.

## Installation

```bash
git clone https://github.com/rbrcurtis/shared-agent-memory.git
cd shared-agent-memory
npm install
npm run build
```

## Claude Code Setup

```bash
claude mcp add-json shared-memory '{
  "type": "stdio",
  "command": "node",
  "args": ["/path/to/shared-agent-memory/dist/index.js"],
  "env": {
    "QDRANT_URL": "http://your-qdrant-server:6333",
    "QDRANT_API_KEY": "your-key",
    "DEFAULT_AGENT": "claude-code"
  }
}' -s user
```

## Project Scoping

Memories are automatically scoped to the current project:

1. If in a git repo, project name is extracted from the remote origin URL
2. Otherwise, the current directory name is used

This prevents cross-project memory pollution.

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
