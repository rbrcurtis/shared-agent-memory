#!/usr/bin/env node
import net from 'net';
import fs from 'fs';
import readline from 'readline';
import { MemoryService } from './memory.js';
import { ServerConfig } from './types.js';

// Socket path (cross-platform)
const SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\shared-memory'
  : '/tmp/shared-memory.sock';

const LOG_PATH = process.platform === 'win32'
  ? `${process.env.TEMP}\\shared-memory-daemon.log`
  : '/tmp/shared-memory-daemon.log';

// Idle timeout (default 2 hours, configurable via env)
const IDLE_TIMEOUT = (parseInt(process.env.DAEMON_IDLE_TIMEOUT || '7200', 10)) * 1000;

let lastActivity = Date.now();
let server: net.Server;
let memory: MemoryService;
let modelReady = false;

function log(msg: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
  console.error(msg);
}

function shutdown(): void {
  log('Shutting down daemon...');
  if (server) server.close();
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Check if daemon already running
async function checkExistingDaemon(): Promise<boolean> {
  if (!fs.existsSync(SOCKET_PATH)) return false;

  return new Promise((resolve) => {
    const socket = net.connect(SOCKET_PATH);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

// Handle a single JSON-RPC request
async function handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  lastActivity = Date.now();

  switch (method) {
    case 'store_memory': {
      const id = await memory.store({
        text: params.text as string,
        agent: params.agent as string | undefined,
        project: params.project as string | undefined,
        tags: params.tags as string[] | undefined,
      });
      return { id };
    }

    case 'search_memory': {
      const results = await memory.search({
        query: params.query as string,
        limit: params.limit as number | undefined,
        agent: params.agent as string | undefined,
        project: params.project as string | undefined,
        tags: params.tags as string[] | undefined,
      });
      return { results };
    }

    case 'list_recent': {
      const limit = (params.limit as number) || 10;
      const days = (params.days as number) || 30;
      const project = params.project as string | undefined;
      const results = await memory.listRecent(limit, days, project);
      return { results };
    }

    case 'update_memory': {
      const id = params.id as string;
      const text = params.text as string;
      const project = params.project as string | undefined;
      await memory.update(id, text, project);
      return { success: true };
    }

    case 'delete_memory': {
      await memory.delete(params.id as string);
      return { success: true };
    }

    case 'get_config': {
      return {
        qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
        collectionName: process.env.COLLECTION_NAME || 'shared_agent_memory',
        defaultAgent: process.env.DEFAULT_AGENT || 'unknown',
        modelReady,
      };
    }

    case 'ping': {
      return { pong: true, modelReady };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Handle a client connection
function handleConnection(socket: net.Socket): void {
  const rl = readline.createInterface({ input: socket });

  rl.on('line', async (line: string) => {
    try {
      const request = JSON.parse(line);
      const { id, method, params = {} } = request;

      try {
        const result = await handleRequest(method, params);
        const response = JSON.stringify({ jsonrpc: '2.0', id, result });
        socket.write(response + '\n');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message },
        });
        socket.write(response + '\n');
      }
    } catch {
      // Invalid JSON - ignore
    }
  });

  socket.on('error', () => {
    // Client disconnected - ignore
  });
}

// Main startup
async function main(): Promise<void> {
  log('Starting shared-memory daemon...');
  log(`Socket: ${SOCKET_PATH}`);
  log(`Idle timeout: ${IDLE_TIMEOUT / 1000}s`);

  // Check if daemon already running
  const alreadyRunning = await checkExistingDaemon();
  if (alreadyRunning) {
    log('Daemon already running, exiting');
    process.exit(0);
  }

  // Clean up stale socket if exists
  if (fs.existsSync(SOCKET_PATH)) {
    log('Removing stale socket file');
    fs.unlinkSync(SOCKET_PATH);
  }

  // Build config from environment
  const config: ServerConfig = {
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: process.env.COLLECTION_NAME || 'shared_agent_memory',
    defaultAgent: process.env.DEFAULT_AGENT || 'unknown',
    defaultProject: process.env.DEFAULT_PROJECT || 'default',
  };

  // Initialize memory service
  memory = new MemoryService(config);
  await memory.initialize();
  log('Storage initialized');

  // Create server
  server = net.createServer(handleConnection);
  server.listen(SOCKET_PATH, () => {
    log(`Daemon ready on ${SOCKET_PATH}`);
  });

  // Load embedding model (async, non-blocking)
  // The model loads lazily on first use, but we can pre-warm it
  log('Pre-warming embedding model...');
  const { EmbeddingService } = await import('./embeddings.js');
  await EmbeddingService.getInstance().initialize();
  modelReady = true;
  log('Embedding model ready');

  // Idle timeout checker
  setInterval(() => {
    const idle = Date.now() - lastActivity;
    if (idle > IDLE_TIMEOUT) {
      log(`Idle for ${idle / 1000}s, shutting down`);
      shutdown();
    }
  }, 60000);
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
