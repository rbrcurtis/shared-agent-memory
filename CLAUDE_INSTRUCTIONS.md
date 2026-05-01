# Claude Code Setup Instructions

Install the shared-agent-memory Claude Code plugin for persistent memory across sessions.

## Before Starting

Confirm:
1. **Memory API URL** - usually `http://localhost:3100`
2. **Memory API key** - bearer token configured on the API server
3. **Scope** - user, project, or local

## Steps

1. Install the marketplace and plugin:
```bash
curl -fsSL https://raw.githubusercontent.com/rbrcurtis/shared-agent-memory/main/install.sh | bash
```

Manual equivalent:
```bash
claude plugin marketplace add rbrcurtis/shared-agent-memory
claude plugin install shared-agent-memory@shared-agent-memory
```

Or run the setup script from a checkout:
```bash
git clone https://github.com/rbrcurtis/shared-agent-memory.git
cd shared-agent-memory
scripts/setup-claude-code.sh
```

2. When prompted, enter:
- `memory_api_url`: memory API base URL
- `memory_api_key`: API bearer token
- `default_agent`: `claude-code`
- `default_project`: leave empty unless you need a fixed project

3. Restart Claude Code to load the new MCP.

## Verification

After restarting, these tools should be available:
- `store_memory` - Store text with a title and automatic embedding
- `search_memory` - Semantic search, returns titles and IDs only
- `load_memories` - Load full text for selected memory IDs (use after search)
- `list_recent` - List recent memories (titles and IDs)
- `update_memory` - Update existing memory
- `delete_memory` - Remove a memory by ID
- `get_config` - Show current MCP/API configuration

## Two-Step Search Pattern

Memories use a title + body model for context efficiency:

1. **`search_memory`** — returns titles and IDs only (lightweight)
2. Review titles, pick the relevant ones
3. **`load_memories`** — load full text for selected IDs (reinforces those memories)

This keeps search results compact and only reinforces memories you actually use.

## Search Memory When Blocked

**If you hit a roadblock — auth failures, connection errors, missing credentials, unknown URLs, unfamiliar services — ALWAYS search_memory before giving up.** Memory likely has the answer (credential locations, correct endpoints, workarounds). Never abandon a task without checking memory first.

## Storing Memories

When calling `store_memory`, always provide both `title` and `text`:
- **title**: Short descriptive title (max 10 words)
- **text**: Full memory content

## Notes

- The MCP talks to the REST API. It does not connect directly to Qdrant.
- New memories are stored in the current project by default, detected from git remote or folder name.
- Search defaults to all projects the API key can access. Pass `project` to filter.
- Memories decay over 30 days if not accessed — frequently used memories persist longer
