#!/usr/bin/env node
import arg from 'arg';
import { SharedMemoryServer } from './server.js';
import { ServerConfig } from './types.js';

const args = arg({
  '--qdrant-url': String,
  '--api-key': String,
  '--collection': String,
  '--agent': String,
  '--project': String,
  '--help': Boolean,
  '-h': '--help',
});

if (args['--help']) {
  console.log(`
shared-agent-memory - MCP server for shared AI agent memory via Qdrant

Options:
  --qdrant-url <url>    Qdrant server URL (default: QDRANT_URL or http://localhost:6333)
  --api-key <key>       Qdrant API key (default: QDRANT_API_KEY)
  --collection <name>   Collection name (default: COLLECTION_NAME or shared_agent_memory)
  --agent <name>        Default agent identifier (default: DEFAULT_AGENT or unknown)
  --project <name>      Default project name (default: DEFAULT_PROJECT or default)
  -h, --help            Show this help message
`);
  process.exit(0);
}

const config: ServerConfig = {
  qdrantUrl: args['--qdrant-url'] || process.env.QDRANT_URL || 'http://localhost:6333',
  qdrantApiKey: args['--api-key'] || process.env.QDRANT_API_KEY,
  collectionName: args['--collection'] || process.env.COLLECTION_NAME || 'shared_agent_memory',
  defaultAgent: args['--agent'] || process.env.DEFAULT_AGENT || 'unknown',
  defaultProject: args['--project'] || process.env.DEFAULT_PROJECT || 'default',
};

async function main(): Promise<void> {
  console.error('Starting Shared Agent Memory MCP Server...');
  console.error(`Node: ${process.version}`);
  console.error(`Platform: ${process.platform}`);
  console.error(`Qdrant URL: ${config.qdrantUrl}`);
  console.error(`Collection: ${config.collectionName}`);
  console.error(`Default Agent: ${config.defaultAgent}`);
  console.error(`Default Project: ${config.defaultProject}`);

  const server = new SharedMemoryServer(config);
  await server.run();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
