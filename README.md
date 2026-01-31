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

## Tools

| Tool | Description |
|------|-------------|
| `store_memory` | Store text in current project, generates embedding automatically |
| `search_memory` | Semantic search within current project |
| `list_recent` | List recent memories in current project |
| `update_memory` | Update existing memory with new text |
| `delete_memory` | Remove a memory by ID |
| `get_config` | Show current configuration and daemon status |

## Architecture

```
Agent 1 (Claude Code) ──┐
                        ├── MCP Wrapper ── Unix Socket ── Daemon ── Qdrant
Agent 2 (Cursor)     ──┘                   /tmp/shared-memory.sock
```

The daemon architecture keeps the embedding model loaded in memory for fast responses:

- **MCP Wrapper** (`index.ts`): Thin stdio server that forwards tool calls
- **Daemon** (`daemon.ts`): Long-running process holding the model, listens on Unix socket
- **Client** (`client.ts`): Auto-starts daemon on first request, handles reconnection

### Daemon Behavior

| Feature | Behavior |
|---------|----------|
| Socket path | `/tmp/shared-memory.sock` (Linux/Mac), `\\.\pipe\shared-memory` (Windows) |
| Auto-start | Client spawns daemon on first connection if not running |
| Idle timeout | Shuts down after 2 hours of inactivity (configurable) |
| Model loading | Pre-warms on startup, ~100ms for subsequent requests |
| Logs | `/tmp/shared-memory-daemon.log` |

Embeddings generated locally using `all-MiniLM-L6-v2` (384 dimensions). Zero external API costs.

## License

MIT
