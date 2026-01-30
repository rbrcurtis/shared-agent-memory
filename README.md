# Shared Agent Memory

MCP server enabling multiple AI agents to share persistent memory via Qdrant.

## Quick Start

```bash
# Install
npm install -g shared-agent-memory

# Or run directly
npx shared-agent-memory --qdrant-url https://your-qdrant.example.com --api-key YOUR_KEY
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QDRANT_URL` | Qdrant server URL | `http://localhost:6333` |
| `QDRANT_API_KEY` | API key for Qdrant | none |
| `COLLECTION_NAME` | Qdrant collection name | `shared_agent_memory` |
| `DEFAULT_AGENT` | Default agent identifier | `unknown` |
| `DEFAULT_PROJECT` | Default project name | `default` |

### CLI Arguments

```bash
shared-agent-memory \
  --qdrant-url https://your-qdrant.example.com \
  --api-key YOUR_KEY \
  --collection my_memories \
  --agent claude-code \
  --project my-project
```

### Claude Code Setup

```bash
claude mcp add-json shared-memory '{
  "type": "stdio",
  "command": "npx",
  "args": ["shared-agent-memory"],
  "env": {
    "QDRANT_URL": "https://your-qdrant.example.com",
    "QDRANT_API_KEY": "your-key",
    "DEFAULT_AGENT": "claude-code",
    "DEFAULT_PROJECT": "my-project"
  }
}' -s user
```

## Tools

| Tool | Description |
|------|-------------|
| `store_memory` | Save text with metadata, generates embedding automatically |
| `search_memory` | Semantic search across all memories |
| `list_recent` | List recent memories by timestamp |
| `delete_memory` | Remove a memory by ID |

## Architecture

```
Agent 1 (Claude Code) ──┐
                        ├── MCP (local, stdio) ── Qdrant (remote)
Agent 2 (Cursor)     ──┘
```

Embeddings generated locally using `all-MiniLM-L6-v2` (384 dimensions).
Zero external API costs for embeddings.

## Kubernetes Deployment

Manifests in `k8s/` directory for deploying Qdrant to minikube or any Kubernetes cluster:

```bash
kubectl apply -f k8s/
```

Default ingress host: `qdrant.trackable.io`

### Authentication

Qdrant is deployed with API key authentication enabled. The key is stored in a Kubernetes Secret:

```bash
# View current API key
kubectl get secret qdrant-api-key -n qdrant -o jsonpath='{.data.api-key}' | base64 -d

# Generate new key and update secret
NEW_KEY=$(openssl rand -base64 32)
kubectl create secret generic qdrant-api-key -n qdrant \
  --from-literal=api-key="$NEW_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment/qdrant -n qdrant
```

Pass the API key to the MCP via `QDRANT_API_KEY` env var or `--api-key` argument.

## License

MIT
