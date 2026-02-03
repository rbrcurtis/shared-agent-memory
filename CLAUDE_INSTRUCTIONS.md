# Claude Code Setup Instructions

Install the shared-agent-memory MCP server for persistent memory across sessions.

## Before Starting

Ask the user:
1. **Clone location** - Where should the repo be cloned? (e.g., `~/shared-agent-memory`, `~/Code/shared-agent-memory`)
2. **Qdrant URL** - Where is your Qdrant instance? (e.g., `http://localhost:6333`, `https://qdrant.example.com`)
3. **API Key** - Does your Qdrant require an API key? If so, what is it?
4. **Scope** - Install for this project only, or all projects?

## Steps

1. Clone and build (replace `<PATH>` with user's chosen location):
```bash
git clone https://github.com/rbrcurtis/shared-agent-memory.git <PATH>
cd <PATH>
npm install
npm run build
```

2. Add the MCP server (replace `<PATH>`, `<QDRANT_URL>`, and optionally add `<API_KEY>`):

**For project-level (recommended)** - saves to `.mcp.json` in current directory:
```bash
claude mcp add-json shared-memory '{
  "type": "stdio",
  "command": "node",
  "args": ["<PATH>/dist/index.js"],
  "env": {
    "QDRANT_URL": "<QDRANT_URL>",
    "QDRANT_API_KEY": "<API_KEY_OR_OMIT>",
    "DEFAULT_AGENT": "claude-code"
  }
}'
```

**For user-level** - saves to `~/.claude.json`, applies to all projects:
```bash
claude mcp add-json shared-memory '{
  "type": "stdio",
  "command": "node",
  "args": ["<PATH>/dist/index.js"],
  "env": {
    "QDRANT_URL": "<QDRANT_URL>",
    "QDRANT_API_KEY": "<API_KEY_OR_OMIT>",
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

- **Project vs User scope**: Project-level (`.mcp.json`) is recommended when using different Qdrant servers per project. User-level (`~/.claude.json`) is simpler when sharing one Qdrant everywhere.
- **Multi-Qdrant**: The daemon supports multiple Qdrant servers simultaneously. Project config overrides user config.
- Memories are automatically scoped to the current project (detected from git remote or folder name)
- Omit QDRANT_API_KEY from env if not needed
