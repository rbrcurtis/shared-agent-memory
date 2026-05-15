import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from './types.js';

const mock = vi.hoisted(() => ({
  collections: [] as Array<{ name: string }>,
  createCollection: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => ({
    getCollections: vi.fn(async () => ({ collections: mock.collections })),
    createCollection: mock.createCollection,
    upsert: mock.upsert,
    delete: mock.delete,
    deleteCollection: vi.fn(),
    query: vi.fn(),
    scroll: vi.fn(),
    retrieve: vi.fn(),
    setPayload: vi.fn(),
  })),
}));

describe('StorageService audit metadata', () => {
  beforeEach(() => {
    mock.collections = [];
    mock.createCollection.mockResolvedValue(undefined);
    mock.upsert.mockResolvedValue(undefined);
    mock.delete.mockResolvedValue(undefined);
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function createStorage() {
    const { StorageService } = await import('./storage.js');
    const storage = new StorageService({
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'memories',
      defaultAgent: 'test',
      defaultProject: 'project-a',
    });
    await storage.initialize();
    return storage;
  }

  it('creates an audit collection beside the memory collection', async () => {
    await createStorage();

    expect(mock.createCollection).toHaveBeenCalledWith(
      'memories_audit',
      expect.objectContaining({
        vectors: { audit: { size: 1, distance: 'Cosine' } },
      }),
    );
  });

  it('stores actor and timestamps on new memories and writes a create audit event', async () => {
    const storage = await createStorage();

    await storage.store({
      text: 'Memory text',
      title: 'Memory title',
      vector: new Array(384).fill(0.1),
      agent: 'claude-code',
      project: 'project-a',
      tags: ['tag-a'],
      actor: 'trackable-team',
    });

    const memoryPayload = mock.upsert.mock.calls[0][1].points[0].payload;
    expect(memoryPayload).toMatchObject({
      createdAt: '2026-05-15T12:00:00.000Z',
      updatedAt: '2026-05-15T12:00:00.000Z',
      createdBy: 'trackable-team',
      updatedBy: 'trackable-team',
    });

    const auditPayload = mock.upsert.mock.calls[1][1].points[0].payload;
    expect(auditPayload).toMatchObject({
      action: 'create',
      actor: 'trackable-team',
      project: 'project-a',
      title: 'Memory title',
    });
  });

  it('preserves create metadata on update and writes an update audit event', async () => {
    const storage = await createStorage();

    await storage.update('memory-id', {
      text: 'Updated text',
      title: 'Updated title',
      vector: new Array(384).fill(0.2),
      agent: 'claude-code',
      project: 'project-a',
      tags: ['tag-a'],
      actor: 'alice',
      createdAt: '2026-05-01T00:00:00.000Z',
      createdBy: 'bob',
      accessCount: 3,
      stability: 2,
    });

    const memoryPayload = mock.upsert.mock.calls[0][1].points[0].payload;
    expect(memoryPayload).toMatchObject({
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-15T12:00:00.000Z',
      createdBy: 'bob',
      updatedBy: 'alice',
      access_count: 3,
      stability: 2,
    });

    const auditPayload = mock.upsert.mock.calls[1][1].points[0].payload;
    expect(auditPayload).toMatchObject({
      action: 'update',
      actor: 'alice',
      memoryId: 'memory-id',
    });
  });

  it('writes a delete audit event before deleting a memory', async () => {
    const storage = await createStorage();
    const existing: SearchResult = {
      id: 'memory-id',
      score: 1,
      text: 'Deleted text',
      title: 'Deleted title',
      agent: 'claude-code',
      project: 'project-a',
      tags: [],
      created_at: '2026-05-01T00:00:00.000Z',
    };

    await storage.delete('memory-id', 'alice', existing);

    expect(mock.upsert.mock.calls[0][0]).toBe('memories_audit');
    expect(mock.upsert.mock.calls[0][1].points[0].payload).toMatchObject({
      action: 'delete',
      actor: 'alice',
      memoryId: 'memory-id',
      project: 'project-a',
      title: 'Deleted title',
    });
    expect(mock.delete).toHaveBeenCalledWith('memories', {
      wait: true,
      points: ['memory-id'],
    });
  });
});
