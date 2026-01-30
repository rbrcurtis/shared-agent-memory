import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryService } from '../src/memory.js';

vi.mock('../src/embeddings.js', () => ({
  EmbeddingService: {
    getInstance: () => ({
      initialize: vi.fn(),
      generateEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
    }),
  },
}));

vi.mock('../src/storage.js', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    store: vi.fn().mockResolvedValue('test-uuid'),
    search: vi.fn().mockResolvedValue([]),
    listRecent: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  })),
}));

describe('MemoryService', () => {
  let service: MemoryService;

  beforeEach(async () => {
    service = new MemoryService({
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'test',
      defaultAgent: 'test',
      defaultProject: 'test',
    });
    await service.initialize();
  });

  it('stores memory with generated embedding', async () => {
    const id = await service.store({ text: 'test content' });
    expect(id).toBe('test-uuid');
  });

  it('searches memories by query text', async () => {
    const results = await service.search({ query: 'test query' });
    expect(Array.isArray(results)).toBe(true);
  });

  it('uses default agent and project when not specified', async () => {
    const id = await service.store({ text: 'test content' });
    expect(id).toBe('test-uuid');
  });

  it('lists recent memories', async () => {
    const results = await service.listRecent(10, 30);
    expect(Array.isArray(results)).toBe(true);
  });

  it('deletes a memory by id', async () => {
    const deleted = await service.delete('test-id');
    expect(deleted).toBe(true);
  });
});
