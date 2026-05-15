import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../server.js';
import type { AppConfig } from '../server.js';
import type { FastifyInstance } from 'fastify';

const QDRANT_URL = process.env['QDRANT_URL'] || 'http://localhost:6333';
const QDRANT_API_KEY = process.env['QDRANT_API_KEY'];
const TEST_KEY = 'sm_test_integration_key';
const TEST_KEY_RESTRICTED = 'sm_test_restricted_key';
const TEST_COLLECTION = `test_api_${Date.now()}`;

const apiKeysJson = JSON.stringify([
  { key: TEST_KEY, name: 'test-full', projects: null },
  { key: TEST_KEY_RESTRICTED, name: 'test-restricted', projects: ['allowed-project'] },
]);

let app: FastifyInstance;
let storedMemoryId: string;
let allowedMemoryId: string;

function authHeader(key = TEST_KEY): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

beforeAll(async () => {
  const config: AppConfig = {
    qdrantUrl: QDRANT_URL,
    qdrantApiKey: QDRANT_API_KEY,
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

  it('stores a memory in a second project', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({
        text: 'Vitest allowed project memory content',
        title: 'Allowed Project Memory',
        project: 'allowed-project',
        tags: ['test'],
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { id: string } }>();
    expect(body.data.id).toBeTruthy();
    allowedMemoryId = body.data.id;
  });

  it('requires a project when storing directly through the API', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/memories',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: JSON.stringify({
        text: 'Project missing direct API memory',
        title: 'Missing Project',
      }),
    });
    expect(res.statusCode).toBe(400);
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

  it('searches all projects when project is omitted', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/search?query=vitest+memory+content&limit=10',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; project: string }> }>();
    const byId = new Map(body.data.map(r => [r.id, r.project]));
    expect(byId.get(storedMemoryId)).toBe('test-project');
    expect(byId.get(allowedMemoryId)).toBe('allowed-project');
  });

  it('includes project on filtered search results', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/search?query=integration+test+memory&project=test-project',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; project: string }> }>();
    const result = body.data.find(r => r.id === storedMemoryId);
    expect(result?.project).toBe('test-project');
  });
});

describe('GET /api/v1/memories/load', () => {
  it('returns full text of stored memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/memories/load?ids=${storedMemoryId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; text: string; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string }> }>();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].text).toContain('integration test memory');
    expect(body.data[0].createdBy).toBe('test-full');
    expect(body.data[0].updatedBy).toBe('test-full');
    expect(body.data[0].createdAt).toBeTruthy();
    expect(body.data[0].updatedAt).toBeTruthy();
  });
});

describe('GET /api/v1/memories/:id/audit', () => {
  it('returns audit events for stored memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/memories/${storedMemoryId}/audit`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ action: string; actor: string; memoryId: string }> }>();
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'create',
          actor: 'test-full',
          memoryId: storedMemoryId,
        }),
      ]),
    );
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

  it('lists all accessible projects when project is omitted', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/recent?limit=10',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; project: string }> }>();
    const byId = new Map(body.data.map(r => [r.id, r.project]));
    expect(byId.get(storedMemoryId)).toBe('test-project');
    expect(byId.get(allowedMemoryId)).toBe('allowed-project');
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

  it('omitted project only searches allowed projects for restricted keys', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/memories/search?query=vitest+memory+content&limit=10',
      headers: authHeader(TEST_KEY_RESTRICTED),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ id: string; project: string }> }>();
    const ids = body.data.map(r => r.id);
    expect(ids).toContain(allowedMemoryId);
    expect(ids).not.toContain(storedMemoryId);
    expect(body.data.every(r => r.project === 'allowed-project')).toBe(true);
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

    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/v1/memories/${storedMemoryId}/audit`,
      headers: authHeader(),
    });
    expect(auditRes.statusCode).toBe(200);
    const auditBody = auditRes.json<{ data: Array<{ action: string; actor: string }> }>();
    expect(auditBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'update', actor: 'test-full' }),
      ]),
    );
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

  it('deletes second project memory', async () => {
    if (!app) return;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/memories/${allowedMemoryId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });
});
