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

/** Defensively parse a value that should be an array but may arrive as a JSON string. */
function ensureArray<T>(val: unknown): T[] | undefined {
  if (val == null) return undefined;
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string') {
    try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed as T[]; } catch { /* not JSON */ }
  }
  return undefined;
}

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
  const gitProject = getProjectFromGitRemote();
  if (gitProject) return gitProject;
  if (process.env.DEFAULT_PROJECT) return process.env.DEFAULT_PROJECT;
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
            title: { type: 'string', description: 'Short descriptive title for the memory (max 10 words)' },
            agent: { type: 'string', description: 'Agent identifier (e.g., claude-code, cursor)' },
            project: { type: 'string', description: 'Project to store in (defaults to current project)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
          },
          required: ['text', 'title'],
        },
      },
      {
        name: 'search_memory',
        description: 'Search memories by semantic similarity. Returns titles and IDs only — use load_memories to get full text for selected results.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language search query' },
            limit: { type: 'number', description: 'Max results (default 10)' },
            agent: { type: 'string', description: 'Filter by agent' },
            project: { type: 'string', description: 'Project to search (defaults to current project)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
          },
          required: ['query'],
        },
      },
      {
        name: 'load_memories',
        description: 'Load full text of memories by IDs. Use after search_memory to retrieve details for selected results. Reinforces loaded memories.',
        inputSchema: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: 'Memory IDs to load in full' },
          },
          required: ['ids'],
        },
      },
      {
        name: 'list_recent',
        description: 'List recent memories within the current project. Returns titles and IDs — use load_memories for full text.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max results (default 10)' },
            days: { type: 'number', description: 'Days to look back (default 30)' },
            project: { type: 'string', description: 'Project to list from (defaults to current project)' },
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
            title: { type: 'string', description: 'New title for the memory' },
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
          title: (toolArgs.title as string) || '',
          agent: (toolArgs.agent as string) || defaultAgent,
          project: (toolArgs.project as string) || defaultProject,
          tags: ensureArray<string>(toolArgs.tags),
        });
        return { content: [{ type: 'text', text: `Memory stored with ID: ${result.id}` }] };
      }

      case 'search_memory': {
        const result = await client.searchMemory({
          query: toolArgs.query as string,
          limit: toolArgs.limit as number | undefined,
          agent: toolArgs.agent as string | undefined,
          project: (toolArgs.project as string) || defaultProject,
          tags: ensureArray<string>(toolArgs.tags),
        });
        const results = result.results as SearchResult[];
        return {
          content: [{
            type: 'text',
            text: results.length === 0
              ? 'No memories found.'
              : results.map((r, i) =>
                  `[${i + 1}] (score: ${r.score.toFixed(3)}) ${r.id}\n${r.title || '(untitled)'}`
                ).join('\n'),
          }],
        };
      }

      case 'load_memories': {
        const ids = ensureArray<string>(toolArgs.ids) || [];
        const result = await client.loadMemories(ids);
        const results = result.results as SearchResult[];
        return {
          content: [{
            type: 'text',
            text: results.length === 0
              ? 'No memories found for the given IDs.'
              : results.map((r, i) =>
                  `[${i + 1}] [${r.agent}/${r.project}]\nID: ${r.id}\nTitle: ${r.title || '(untitled)'}\n${r.text}\nTags: ${Array.isArray(r.tags) ? r.tags.join(', ') : 'none'} | Created: ${r.created_at}`
                ).join('\n\n'),
          }],
        };
      }

      case 'list_recent': {
        const limit = (toolArgs.limit as number) || 10;
        const days = (toolArgs.days as number) || 30;
        const project = (toolArgs.project as string) || defaultProject;
        const result = await client.listRecent({ limit, days, project });
        const results = result.results as SearchResult[];
        return {
          content: [{
            type: 'text',
            text: results.length === 0
              ? 'No recent memories.'
              : results.map((r, i) =>
                  `[${i + 1}] ${r.id} ${r.created_at}\n${r.title || '(untitled)'}`
                ).join('\n'),
          }],
        };
      }

      case 'update_memory': {
        const id = toolArgs.id as string;
        const text = toolArgs.text as string;
        const title = toolArgs.title as string | undefined;
        await client.updateMemory({ id, text, title, project: defaultProject });
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
