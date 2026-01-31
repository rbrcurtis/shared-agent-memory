# Claude Code Setup Instructions

Install the shared-agent-memory MCP server for persistent memory across sessions.

## Before Starting

Ask the user:
1. **Qdrant URL** - Where is your Qdrant instance? (e.g., `http://localhost:6333`, `https://qdrant.example.com`)
2. **API Key** - Does your Qdrant require an API key? If so, what is it?

## Steps

1. Clone and build:
```bash
git clone https://github.com/rbrcurtis/shared-agent-memory.git ~/shared-agent-memory
cd ~/shared-agent-memory
npm install
npm run build
```

2. Add the MCP server (replace QDRANT_URL and optionally add QDRANT_API_KEY):
```bash
claude mcp add-json shared-memory '{
  "type": "stdio",
  "command": "node",
  "args": ["'$HOME'/shared-agent-memory/dist/index.js"],
  "env": {
    "QDRANT_URL": "<USER_PROVIDED_URL>",
    "QDRANT_API_KEY": "<USER_PROVIDED_KEY_OR_OMIT>",
    "DEFAULT_AGENT": "claude-code"
  }
}' -s user
```

3. Restart Claude Code to load the new MCP.

## Verification

After restarting, these tools should be available:
- `store_memory` - Store text with automatic embedding
- `search_memory` - Semantic search within current project
- `list_recent` - List recent memories
- `update_memory` - Update existing memory
- `delete_memory` - Remove a memory by ID

## Notes

- Memories are automatically scoped to the current project (detected from git remote or folder name)
- Omit QDRANT_API_KEY from env if not needed
