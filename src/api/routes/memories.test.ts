import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../server.js';
import type { AppConfig } from '../server.js';
import type { FastifyInstance } from 'fastify';

const QDRANT_URL = process.env['QDRANT_URL'] || 'http://localhost:6333';
const TEST_KEY = 'sm_test_integration_key';
const TEST_KEY_RESTRICTED = 'sm_test_restricted_key';
const TEST_COLLECTION = `test_api_${Date.now()}`;

const apiKeysJson = JSON.stringify([
  { key: TEST_KEY, name: 'test-full', projects: null },
  { key: TEST_KEY_RESTRICTED, name: 'test-restricted', projects: ['allowed-project'] },
]);

let app: FastifyInstance;
let storedMemoryId: string;

function authHeader(key = TEST_KEY): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

beforeAll(async () => {
  const config: AppConfig = {
    qdrantUrl: QDRANT_URL,
    collectionName: TEST_COLLECTION,
    apiKeysJson,
    port: 0,
  };

  try {
    app = await buildApp(config);
  } catch (err) {
    console.log(`Skipping integration tests — Qdrant not available: ${err}`);
  }
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe('GET /health', () => {
  it('returns ok', async () => {
    if (!app) return;

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; modelReady: boolean }>();
    expect(body).toEqual({ status: 'ok', modelReady: true });
  });
});

describe('Auth', () => {
  it('rejects request without auth', async () => {
    if (!app) return;

    const res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects request with bad key', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/config',
      headers: { authorization: 'Bearer wrong_key_here' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/config', () => {
  it('returns config with valid auth', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/config',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { qdrantUrl: string; modelReady: boolean } }>();
    expect(body.data.qdrantUrl).toBe(QDRANT_URL);
    expect(body.data.modelReady).toBe(true);
  });
});

describe('POST /api/v1/memories', () => {
  it('stores a memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({
        text: 'Vitest integration test memory content',
        title: 'Test Memory',
        project: 'test-project',
        tags: ['test'],
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { id: string } }>();
    expect(body.data.id).toBeTruthy();
    storedMemoryId = body.data.id;
  });

  it('rejects secrets in text', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({
        text: 'Here is a token ghp_abcdefghijklmnopqrstuvwxyz1234567890',
        title: 'Secret Test',
        project: 'test-project',
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { message: string } }>();
    expect(body.error.message.toLowerCase()).toContain('secret');
  });

  it('rejects store with project=*', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({
        text: 'Some text',
        title: 'Wildcard project test',
        project: '*',
      }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/memories/search', () => {
  it('finds the stored memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/search?query=integration+test+memory&project=test-project',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string }> }>();
    const ids = body.data.map(r => r.id);
    expect(ids).toContain(storedMemoryId);
  });
});

describe('GET /api/v1/memories/load', () => {
  it('returns full text of stored memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/memories/load?ids=${storedMemoryId}&project=*`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; text: string }> }>();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].text).toContain('integration test memory');
  });
});

describe('GET /api/v1/memories/recent', () => {
  it('lists the stored memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/recent?project=test-project',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string }> }>();
    expect(body.data.length).toBeGreaterThan(0);
  });
});

describe('Restricted key access', () => {
  it('cannot access other projects', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/search?query=integration+test+memory&project=test-project',
      headers: authHeader(TEST_KEY_RESTRICTED),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/v1/memories/:id', () => {
  it('updates memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/memories/${storedMemoryId}`,
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'Updated integration test content' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { success: boolean } }>();
    expect(body.data.success).toBe(true);
  });
});

describe('DELETE /api/v1/memories/:id', () => {
  it('deletes memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/memories/${storedMemoryId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { success: boolean } }>();
    expect(body.data.success).toBe(true);
  });

  it('returns 404 for deleted memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/memories/${storedMemoryId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });
});
