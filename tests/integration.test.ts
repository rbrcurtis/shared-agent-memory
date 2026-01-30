import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryService } from '../src/memory.js';
import { ServerConfig } from '../src/types.js';

describe.skipIf(!process.env.QDRANT_URL)('Integration', () => {
  let memory: MemoryService;
  const config: ServerConfig = {
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: 'test_integration_' + Date.now(),
    defaultAgent: 'test-agent',
    defaultProject: 'test-project',
  };

  beforeAll(async () => {
    memory = new MemoryService(config);
    await memory.initialize();
  }, 120000);

  afterAll(async () => {
    // Cleanup handled by test collection naming
  });

  it('stores and retrieves a memory end-to-end', async () => {
    const id = await memory.store({
      text: 'The authentication system uses JWT tokens stored in httpOnly cookies',
      tags: ['auth', 'jwt'],
    });

    expect(id).toBeDefined();

    const results = await memory.search({
      query: 'how does authentication work',
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain('JWT');
  }, 30000);

  it('filters by project', async () => {
    await memory.store({
      text: 'Project A uses PostgreSQL',
      project: 'project-a',
    });

    await memory.store({
      text: 'Project B uses MongoDB',
      project: 'project-b',
    });

    const results = await memory.search({
      query: 'database',
      project: 'project-a',
    });

    expect(results.every((r) => r.project === 'project-a')).toBe(true);
  }, 30000);
});
