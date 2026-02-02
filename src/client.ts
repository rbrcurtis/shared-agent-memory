import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Socket path (must match daemon)
const SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\shared-memory'
  : '/tmp/shared-memory.sock';

// Qdrant config from environment (passed with each request)
function getQdrantConfig(): Record<string, string | undefined> {
  return {
    qdrantUrl: process.env.QDRANT_URL,
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: process.env.COLLECTION_NAME,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function spawnDaemon(): void {
  const daemonPath = path.join(__dirname, 'daemon.js');
  const child = spawn('node', [daemonPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
}

async function ensureDaemon(): Promise<net.Socket> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const socket = await connect(SOCKET_PATH);
      return socket;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        if (attempt === 0) {
          spawnDaemon();
        }
        await sleep(300 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to connect to daemon after 10 attempts');
}

function readLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        resolve(buffer.slice(0, newlineIdx));
      }
    };

    const onError = (err: Error) => {
      socket.removeListener('data', onData);
      reject(err);
    };

    socket.on('data', onData);
    socket.once('error', onError);
  });
}

export async function call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const socket = await ensureDaemon();
  const id = randomUUID();
  // Include Qdrant config with every request so daemon can route to correct server
  const paramsWithConfig = { ...getQdrantConfig(), ...params };
  const request = JSON.stringify({ jsonrpc: '2.0', id, method, params: paramsWithConfig }) + '\n';

  socket.write(request);

  const response = await readLine(socket);
  socket.end();

  const parsed = JSON.parse(response);
  if (parsed.error) {
    throw new Error(parsed.error.message);
  }
  return parsed.result;
}

// Convenience methods
export async function storeMemory(params: {
  text: string;
  agent?: string;
  project?: string;
  tags?: string[];
}): Promise<{ id: string }> {
  return call('store_memory', params) as Promise<{ id: string }>;
}

export async function searchMemory(params: {
  query: string;
  limit?: number;
  agent?: string;
  project?: string;
  tags?: string[];
}): Promise<{ results: unknown[] }> {
  return call('search_memory', params) as Promise<{ results: unknown[] }>;
}

export async function listRecent(params: {
  limit?: number;
  days?: number;
  project?: string;
}): Promise<{ results: unknown[] }> {
  return call('list_recent', params) as Promise<{ results: unknown[] }>;
}

export async function updateMemory(params: {
  id: string;
  text: string;
  project?: string;
}): Promise<{ success: boolean }> {
  return call('update_memory', params) as Promise<{ success: boolean }>;
}

export async function deleteMemory(id: string): Promise<{ success: boolean }> {
  return call('delete_memory', { id }) as Promise<{ success: boolean }>;
}

export async function getConfig(): Promise<Record<string, unknown>> {
  return call('get_config') as Promise<Record<string, unknown>>;
}

export async function ping(): Promise<{ pong: boolean; modelReady: boolean }> {
  return call('ping') as Promise<{ pong: boolean; modelReady: boolean }>;
}
