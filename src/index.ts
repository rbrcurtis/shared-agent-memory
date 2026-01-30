#!/usr/bin/env node
import { SharedMemoryServer } from './server.js';
import { ServerConfig } from './types.js';

function parseArgs(): ServerConfig {
  const args = process.argv.slice(2);
  const config: ServerConfig = {
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: process.env.COLLECTION_NAME || 'shared_agent_memory',
    defaultAgent: process.env.DEFAULT_AGENT || 'unknown',
    defaultProject: process.env.DEFAULT_PROJECT || 'default',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--qdrant-url':
        config.qdrantUrl = args[++i];
        break;
      case '--api-key':
        config.qdrantApiKey = args[++i];
        break;
      case '--collection':
        config.collectionName = args[++i];
        break;
      case '--agent':
        config.defaultAgent = args[++i];
        break;
      case '--project':
        config.defaultProject = args[++i];
        break;
    }
  }

  return config;
}

async function main(): Promise<void> {
  console.error('Starting Shared Agent Memory MCP Server...');
  console.error(`Node: ${process.version}`);
  console.error(`Platform: ${process.platform}`);

  const config = parseArgs();
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
