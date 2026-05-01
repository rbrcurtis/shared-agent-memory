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
import { ingestClaudeCodeTranscript } from './ingest/index.js';
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
  '--api-key': String,
  '--agent': String,
  '--project': String,
  '--memory-api-url': String,
  '--memory-api-key': String,
  '--ingest-transcript': String,
  '--model': String,
  '--dry-run': Boolean,
  '--help': Boolean,
  '-h': '--help',
});

if (args['--help']) {
  console.log(`
shared-agent-memory - MCP server for shared AI agent memory via Qdrant

Options:
  --api-key <key>       Memory API bearer token (alias for --memory-api-key)
  --agent <name>        Default agent identifier (default: DEFAULT_AGENT or unknown)
  --project <name>      Default project name (default: git repo name or folder name)
  --memory-api-url <url>
                         Memory API URL (default: MEMORY_API_URL or http://localhost:3100)
  --memory-api-key <key>
                         Memory API bearer token (default: MEMORY_API_KEY)
  --ingest-transcript <file>
                         Extract durable memories from a Claude Code JSONL transcript
  --model <name>        Ollama model for transcript extraction (default: qwen3:8b)
  --dry-run             Show ingest decisions without writing memories
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

if (args['--agent']) process.env.DEFAULT_AGENT = args['--agent'];
if (args['--memory-api-url']) process.env.MEMORY_API_URL = args['--memory-api-url'];
if (args['--memory-api-key'] || args['--api-key']) {
  process.env.MEMORY_API_KEY = args['--memory-api-key'] || args['--api-key'];
}

const defaultProject = getDefaultProject();
const defaultAgent = args['--agent'] || process.env.DEFAULT_AGENT || 'unknown';

function printIngestSummary(result: Awaited<ReturnType<typeof ingestClaudeCodeTranscript>>): void {
  console.log(
    `Ingested ${result.candidates} candidates for project ${result.project}: ` +
      `${result.created} create, ${result.updated} update, ${result.skipped} skip` +
      `${result.dryRun ? ' (dry run)' : ''}`,
  );

  for (const decision of result.decisions) {
    console.log(
      `- ${decision.action.toUpperCase()}: ${decision.title} (${decision.reason})` +
        `${decision.id ? ` [${decision.id}]` : ''}`,
    );
  }
}

async function main(): Promise<void> {
  if (args['--ingest-transcript']) {
    const result = await ingestClaudeCodeTranscript({
      file: args['--ingest-transcript'],
      project: defaultProject,
      model: args['--model'],
      dryRun: Boolean(args['--dry-run']),
    });
    printIngestSummary(result);
    return;
  }

  console.error('Starting Shared Agent Memory MCP Server (API client)...');
  console.error(`Default Project: ${defaultProject}`);
  console.error(`Default Agent: ${defaultAgent}`);

  const server = new Server({ name: 'shared-agent-memory', version: '0.2.0' });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'store_memory',
        description: 'Store a memory (REQUIRED params: title, text). Title is a short descriptive label (max 10 words). Text is the full memory content.',
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
        description: 'Search memories by semantic similarity. Searches all accessible projects by default and returns titles, IDs, projects, and scores — use load_memories to get full text for selected results.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language search query' },
            limit: { type: 'number', description: 'Max results (default 10)' },
            agent: { type: 'string', description: 'Filter by agent' },
            project: { type: 'string', description: 'Optional project filter. Omit to search all accessible projects.' },
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
        description: 'List recent memories across all accessible projects by default. Returns titles, IDs, and projects — use load_memories for full text.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max results (default 10)' },
            days: { type: 'number', description: 'Days to look back (default 30)' },
            project: { type: 'string', description: 'Optional project filter. Omit to list all accessible projects.' },
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
          project: toolArgs.project as string | undefined,
          tags: ensureArray<string>(toolArgs.tags),
        });
        const results = result.results as SearchResult[];
        return {
          content: [{
            type: 'text',
            text: results.length === 0
              ? 'No memories found.'
              : results.map((r, i) =>
                  `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.project}] ${r.id}\n${r.title || '(untitled)'}`
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
        const project = toolArgs.project as string | undefined;
        const result = await client.listRecent({ limit, days, project });
        const results = result.results as SearchResult[];
        return {
          content: [{
            type: 'text',
            text: results.length === 0
              ? 'No recent memories.'
              : results.map((r, i) =>
                  `[${i + 1}] [${r.project}] ${r.id} ${r.created_at}\n${r.title || '(untitled)'}`
                ).join('\n'),
          }],
        };
      }

      case 'update_memory': {
        const id = toolArgs.id as string;
        const text = toolArgs.text as string;
        const title = toolArgs.title as string | undefined;
        await client.updateMemory({ id, text, title });
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
            text: `Memory API: ${config.apiBaseUrl}\nQdrant URL: ${config.qdrantUrl}\nCollection: ${config.collectionName}\nDefault Agent: ${defaultAgent}\nDefault Project: ${defaultProject}\nModel Ready: ${config.modelReady}`,
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP API client connected');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
