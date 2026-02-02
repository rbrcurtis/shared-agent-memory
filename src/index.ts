#!/usr/bin/env node
import arg from 'arg';
import { execSync } from 'child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as client from './client.js';
import { SearchResult } from './types.js';

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
  --project <name>      Default project name (default: git repo name or folder name)
  -h, --help            Show this help message
`);
  process.exit(0);
}

function getProjectFromGitRemote(): string | null {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const match = remote.match(/[/:]([^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getDefaultProject(): string {
  if (args['--project']) return args['--project'];
  if (process.env.DEFAULT_PROJECT) return process.env.DEFAULT_PROJECT;
  const gitProject = getProjectFromGitRemote();
  if (gitProject) return gitProject;
  const pwd = process.env.PWD || process.cwd();
  return pwd.split('/').pop() || 'default';
}

// Set environment variables for the daemon (it reads from env)
if (args['--qdrant-url']) process.env.QDRANT_URL = args['--qdrant-url'];
if (args['--api-key']) process.env.QDRANT_API_KEY = args['--api-key'];
if (args['--collection']) process.env.COLLECTION_NAME = args['--collection'];
if (args['--agent']) process.env.DEFAULT_AGENT = args['--agent'];

const defaultProject = getDefaultProject();
const defaultAgent = args['--agent'] || process.env.DEFAULT_AGENT || 'unknown';

async function main(): Promise<void> {
  console.error('Starting Shared Agent Memory MCP Server (wrapper)...');
  console.error(`Default Project: ${defaultProject}`);
  console.error(`Default Agent: ${defaultAgent}`);

  const server = new Server({ name: 'shared-agent-memory', version: '0.2.0' });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'store_memory',
        description: 'Store a memory scoped to the current project. Use for insights, decisions, patterns, or any knowledge worth preserving.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The memory content to store' },
            agent: { type: 'string', description: 'Agent identifier (e.g., claude-code, cursor)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
          },
          required: ['text'],
        },
      },
      {
        name: 'search_memory',
        description: 'Search memories by semantic similarity within the current project.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language search query' },
            limit: { type: 'number', description: 'Max results (default 10)' },
            agent: { type: 'string', description: 'Filter by agent' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_recent',
        description: 'List recent memories within the current project.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max results (default 10)' },
            days: { type: 'number', description: 'Days to look back (default 30)' },
          },
        },
      },
      {
        name: 'update_memory',
        description: 'Update an existing memory with new text. Use this to keep memories current when information changes.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Memory ID to update' },
            text: { type: 'string', description: 'New memory content' },
          },
          required: ['id', 'text'],
        },
      },
      {
        name: 'delete_memory',
        description: 'Delete a memory by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Memory ID to delete' },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_config',
        description: 'Get the current MCP server configuration including detected project name.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs = {} } = request.params;

    switch (name) {
      case 'store_memory': {
        const result = await client.storeMemory({
          text: toolArgs.text as string,
          agent: (toolArgs.agent as string) || defaultAgent,
          project: defaultProject,
          tags: toolArgs.tags as string[] | undefined,
        });
        return { content: [{ type: 'text', text: `Memory stored with ID: ${result.id}` }] };
      }

      case 'search_memory': {
        const result = await client.searchMemory({
          query: toolArgs.query as string,
          limit: toolArgs.limit as number | undefined,
          agent: toolArgs.agent as string | undefined,
          project: defaultProject,
          tags: toolArgs.tags as string[] | undefined,
        });
        const results = result.results as SearchResult[];
        return {
          content: [{
            type: 'text',
            text: results.length === 0
              ? 'No memories found.'
              : results.map((r, i) =>
                  `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.agent}/${r.project}]\nID: ${r.id}\n${r.text}\nTags: ${r.tags.join(', ') || 'none'} | Created: ${r.created_at}`
                ).join('\n\n'),
          }],
        };
      }

      case 'list_recent': {
        const limit = (toolArgs.limit as number) || 10;
        const days = (toolArgs.days as number) || 30;
        const result = await client.listRecent({ limit, days, project: defaultProject });
        const results = result.results as SearchResult[];
        return {
          content: [{
            type: 'text',
            text: results.length === 0
              ? 'No recent memories.'
              : results.map((r, i) =>
                  `[${i + 1}] [${r.agent}/${r.project}] ${r.created_at}\nID: ${r.id}\n${r.text}`
                ).join('\n\n'),
          }],
        };
      }

      case 'update_memory': {
        const id = toolArgs.id as string;
        const text = toolArgs.text as string;
        await client.updateMemory({ id, text, project: defaultProject });
        return { content: [{ type: 'text', text: `Memory ${id} updated.` }] };
      }

      case 'delete_memory': {
        const id = toolArgs.id as string;
        await client.deleteMemory(id);
        return { content: [{ type: 'text', text: `Memory ${id} deleted.` }] };
      }

      case 'get_config': {
        const config = await client.getConfig();
        return {
          content: [{
            type: 'text',
            text: `Qdrant URL: ${config.qdrantUrl}\nCollection: ${config.collectionName}\nDefault Agent: ${defaultAgent}\nDefault Project: ${defaultProject}\nModel Ready: ${config.modelReady}`,
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP wrapper connected');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
