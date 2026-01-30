# CLAUDE.md

## What This Is

Shared Agent Memory MCP server - enables AI agents to share persistent context via Qdrant.

## Key Files

- `src/index.ts` - Entry point, CLI parsing
- `src/server.ts` - MCP server, tool handlers
- `src/memory.ts` - Orchestrates embedding + storage
- `src/embeddings.ts` - Local embedding generation
- `src/storage.ts` - Qdrant client wrapper
- `src/types.ts` - TypeScript interfaces

## Commands

```bash
npm run build    # Compile TypeScript
npm test         # Run tests
npm start        # Run server (needs QDRANT_URL)
```

## Testing with Local Qdrant

```bash
docker run -p 6333:6333 qdrant/qdrant
QDRANT_URL=http://localhost:6333 npm test
```
