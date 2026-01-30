# Claude Code Setup Instructions

Install the shared-agent-memory MCP server for persistent memory across sessions.

## Steps

1. Clone the repository:
```bash
git clone https://github.com/rbrcurtis/shared-agent-memory.git ~/shared-agent-memory
cd ~/shared-agent-memory
npm install
npm run build
```

2. Add the MCP server to Claude Code (adjust QDRANT_URL to your Qdrant instance):
```bash
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

3. Restart Claude Code to load the new MCP.

## Verification

After restarting, you should have these tools available:
- `store_memory` - Store text with automatic embedding
- `search_memory` - Semantic search within current project
- `list_recent` - List recent memories
- `delete_memory` - Remove a memory by ID

## Notes

- Memories are automatically scoped to the current project (detected from git remote or folder name)
- Requires a running Qdrant instance - update QDRANT_URL accordingly
- Add QDRANT_API_KEY to env if your Qdrant requires authentication
