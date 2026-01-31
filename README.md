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

Add this to your `CLAUDE.md` or project instructions to ensure consistent memory usage:

```markdown
## Session Start (MANDATORY)

**Before doing ANYTHING else**, run `search_memory` for "context" or "getting started" to retrieve project knowledge from previous sessions. This applies to every new conversation, no exceptions.

## Shared Memory

Use the shared-memory MCP to maintain project knowledge across sessions.

### When to Search
- Before planning any significant task
- When encountering unfamiliar code or errors
- When unsure about project conventions

### When to Store
Store knowledge that would help future sessions:

- **Workflows**: Build/deploy steps, environment quirks, service startup order
- **Troubleshooting**: Error messages and root causes, diagnostic commands
- **Codebase**: Where logic lives, why patterns exist, integration points
- **User preferences**: Naming conventions, preferred approaches, things to avoid
- **Infrastructure**: DNS/networking, credential locations, deployment targets

### Best Practices
- Store memories with descriptive text that will match semantic search
- Search before asking questions that may have been answered before
- Keep memories atomic - one concept per memory
```

### Enforcing with Claude Code Hooks

Add a SessionStart hook to `~/.claude/settings.json` to remind Claude to search memory:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'MANDATORY: Run search_memory for \"context\" or \"getting started\" BEFORE doing anything else. No exceptions.'"
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
