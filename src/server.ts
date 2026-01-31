import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryService } from './memory.js';
import { ServerConfig } from './types.js';

export class SharedMemoryServer {
  private server: Server;
  private memory: MemoryService;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.memory = new MemoryService(config);
    this.server = new Server({ name: 'shared-agent-memory', version: '0.1.0' });
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
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

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;

      switch (name) {
        case 'store_memory': {
          const id = await this.memory.store({
            text: args.text as string,
            agent: args.agent as string | undefined,
            tags: args.tags as string[] | undefined,
          });
          return { content: [{ type: 'text', text: `Memory stored with ID: ${id}` }] };
        }

        case 'search_memory': {
          const results = await this.memory.search({
            query: args.query as string,
            limit: args.limit as number | undefined,
            agent: args.agent as string | undefined,
            tags: args.tags as string[] | undefined,
          });
          return {
            content: [{
              type: 'text',
              text: results.length === 0
                ? 'No memories found.'
                : results.map((r, i) =>
                    `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.agent}/${r.project}]\n${r.text}\nTags: ${r.tags.join(', ') || 'none'} | Created: ${r.created_at}`
                  ).join('\n\n'),
            }],
          };
        }

        case 'list_recent': {
          const limit = (args.limit as number) || 10;
          const days = (args.days as number) || 30;
          const results = await this.memory.listRecent(limit, days);
          return {
            content: [{
              type: 'text',
              text: results.length === 0
                ? 'No recent memories.'
                : results.map((r, i) =>
                    `[${i + 1}] [${r.agent}/${r.project}] ${r.created_at}\n${r.text}`
                  ).join('\n\n'),
            }],
          };
        }

        case 'delete_memory': {
          const id = args.id as string;
          await this.memory.delete(id);
          return { content: [{ type: 'text', text: `Memory ${id} deleted.` }] };
        }

        case 'get_config': {
          return {
            content: [{
              type: 'text',
              text: `Qdrant URL: ${this.config.qdrantUrl}\nCollection: ${this.config.collectionName}\nDefault Agent: ${this.config.defaultAgent}\nDefault Project: ${this.config.defaultProject}`,
            }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  async run(): Promise<void> {
    await this.memory.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Shared Agent Memory MCP server running');
  }
}
