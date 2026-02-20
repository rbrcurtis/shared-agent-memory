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
- `store_memory` - Store text with a title and automatic embedding
- `search_memory` - Semantic search, returns titles and IDs only
- `load_memories` - Load full text for selected memory IDs (use after search)
- `list_recent` - List recent memories (titles and IDs)
- `update_memory` - Update existing memory
- `delete_memory` - Remove a memory by ID
- `get_config` - Show current configuration and daemon status

## Two-Step Search Pattern

Memories use a title + body model for context efficiency:

1. **`search_memory`** — returns titles and IDs only (lightweight)
2. Review titles, pick the relevant ones
3. **`load_memories`** — load full text for selected IDs (reinforces those memories)

This keeps search results compact and only reinforces memories you actually use.

## Storing Memories

When calling `store_memory`, always provide both `title` and `text`:
- **title**: Short descriptive title (max 10 words)
- **text**: Full memory content

## Notes

- **Project vs User scope**: Project-level (`.mcp.json`) is recommended when using different Qdrant servers per project. User-level (`~/.claude.json`) is simpler when sharing one Qdrant everywhere.
- **Multi-Qdrant**: The daemon supports multiple Qdrant servers simultaneously. Project config overrides user config.
- Memories are automatically scoped to the current project (detected from git remote or folder name)
- Omit QDRANT_API_KEY from env if not needed
- Memories decay over 30 days if not accessed — frequently used memories persist longer
