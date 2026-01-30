import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StorageService } from '../src/storage.js';
import { ServerConfig } from '../src/types.js';

describe.skipIf(!process.env.QDRANT_URL)('StorageService', () => {
  let storage: StorageService;
  const testConfig: ServerConfig = {
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: 'test_shared_memory',
    defaultAgent: 'test-agent',
    defaultProject: 'test-project',
  };

  beforeAll(async () => {
    storage = new StorageService(testConfig);
    await storage.initialize();
  });

  afterAll(async () => {
    await storage.deleteCollection();
  });

  it('stores and retrieves a memory', async () => {
    const id = await storage.store({
      text: 'The API uses REST endpoints',
      vector: new Array(384).fill(0.1),
      agent: 'claude-code',
      project: 'my-project',
      tags: ['api', 'rest'],
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  it('searches memories by vector', async () => {
    const results = await storage.search({
      vector: new Array(384).fill(0.1),
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('text');
  });

  it('filters search by agent', async () => {
    await storage.store({
      text: 'Memory from specific agent',
      vector: new Array(384).fill(0.2),
      agent: 'unique-agent',
      project: 'my-project',
      tags: ['test'],
    });

    const results = await storage.search({
      vector: new Array(384).fill(0.2),
      limit: 10,
      agent: 'unique-agent',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.agent === 'unique-agent')).toBe(true);
  });

  it('filters search by project', async () => {
    await storage.store({
      text: 'Memory from specific project',
      vector: new Array(384).fill(0.3),
      agent: 'test-agent',
      project: 'unique-project',
      tags: ['test'],
    });

    const results = await storage.search({
      vector: new Array(384).fill(0.3),
      limit: 10,
      project: 'unique-project',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.project === 'unique-project')).toBe(true);
  });

  it('filters search by tags', async () => {
    await storage.store({
      text: 'Memory with specific tags',
      vector: new Array(384).fill(0.4),
      agent: 'test-agent',
      project: 'test-project',
      tags: ['unique-tag', 'another-tag'],
    });

    const results = await storage.search({
      vector: new Array(384).fill(0.4),
      limit: 10,
      tags: ['unique-tag'],
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.tags.includes('unique-tag'))).toBe(true);
  });

  it('lists recent memories', async () => {
    const results = await storage.listRecent(10, 30);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('deletes a memory', async () => {
    const id = await storage.store({
      text: 'Memory to delete',
      vector: new Array(384).fill(0.5),
      agent: 'test-agent',
      project: 'test-project',
      tags: ['delete-test'],
    });

    const deleted = await storage.delete(id);
    expect(deleted).toBe(true);
  });
});
