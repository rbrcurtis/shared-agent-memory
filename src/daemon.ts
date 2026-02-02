#!/usr/bin/env node
import net from 'net';
import fs from 'fs';
import readline from 'readline';
import { StorageService } from './storage.js';
import { EmbeddingService } from './embeddings.js';
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
let embeddings: EmbeddingService;
let modelReady = false;

// Cache StorageService instances by Qdrant URL
const storageCache = new Map<string, StorageService>();

function getStorageCacheKey(url: string, apiKey?: string, collection?: string): string {
  return `${url}|${apiKey || ''}|${collection || 'shared_agent_memory'}`;
}

async function getStorage(params: Record<string, unknown>): Promise<StorageService> {
  const url = (params.qdrantUrl as string) || 'http://localhost:6333';
  const apiKey = params.qdrantApiKey as string | undefined;
  const collection = (params.collectionName as string) || 'shared_agent_memory';

  const key = getStorageCacheKey(url, apiKey, collection);

  if (!storageCache.has(key)) {
    const config: ServerConfig = {
      qdrantUrl: url,
      qdrantApiKey: apiKey,
      collectionName: collection,
      defaultAgent: 'unknown',
      defaultProject: 'default',
    };
    const storage = new StorageService(config);
    await storage.initialize();
    storageCache.set(key, storage);
    log(`Created storage client for ${url}`);
  }

  return storageCache.get(key)!;
}

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
  log(`Request: ${method} qdrantUrl=${params.qdrantUrl} apiKey=${params.qdrantApiKey ? '(set)' : '(not set)'}`);

  try {
  switch (method) {
    case 'store_memory': {
      const storage = await getStorage(params);
      const vector = await embeddings.generateEmbedding(params.text as string);
      const id = await storage.store({
        text: params.text as string,
        vector,
        agent: (params.agent as string) || 'unknown',
        project: (params.project as string) || 'default',
        tags: (params.tags as string[]) || [],
      });
      return { id };
    }

    case 'search_memory': {
      const storage = await getStorage(params);
      const vector = await embeddings.generateEmbedding(params.query as string);
      const results = await storage.search({
        vector,
        limit: (params.limit as number) || 10,
        agent: params.agent as string | undefined,
        project: params.project as string | undefined,
        tags: params.tags as string[] | undefined,
      });
      return { results };
    }

    case 'list_recent': {
      const storage = await getStorage(params);
      const limit = (params.limit as number) || 10;
      const days = (params.days as number) || 30;
      const project = params.project as string | undefined;
      const results = await storage.listRecent(limit, days, project);
      return { results };
    }

    case 'update_memory': {
      const storage = await getStorage(params);
      const id = params.id as string;
      const text = params.text as string;
      const vector = await embeddings.generateEmbedding(text);
      await storage.update(id, {
        text,
        vector,
        agent: 'unknown',
        project: (params.project as string) || 'default',
        tags: [],
      });
      return { success: true };
    }

    case 'delete_memory': {
      const storage = await getStorage(params);
      await storage.delete(params.id as string);
      return { success: true };
    }

    case 'get_config': {
      return {
        qdrantUrl: params.qdrantUrl || 'http://localhost:6333',
        collectionName: params.collectionName || 'shared_agent_memory',
        defaultAgent: params.defaultAgent || 'unknown',
        modelReady,
      };
    }

    case 'ping': {
      return { pong: true, modelReady };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
  } catch (err) {
    log(`Error in ${method}: ${err}`);
    throw err;
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

  // Initialize embedding service (singleton, keeps model in memory)
  embeddings = EmbeddingService.getInstance();

  // Create server
  server = net.createServer(handleConnection);
  server.listen(SOCKET_PATH, () => {
    log(`Daemon ready on ${SOCKET_PATH}`);
  });

  // Pre-warm embedding model
  log('Pre-warming embedding model...');
  await embeddings.initialize();
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
