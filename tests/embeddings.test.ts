import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingService } from '../src/embeddings.js';

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeAll(async () => {
    service = EmbeddingService.getInstance();
    await service.initialize();
  }, 60000);

  it('generates 384-dimensional embeddings', async () => {
    const embedding = await service.generateEmbedding('hello world');
    expect(embedding).toHaveLength(384);
  });

  it('generates normalized embeddings', async () => {
    const embedding = await service.generateEmbedding('test text');
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 2);
  });

  it('returns same instance (singleton)', () => {
    const instance1 = EmbeddingService.getInstance();
    const instance2 = EmbeddingService.getInstance();
    expect(instance1).toBe(instance2);
  });
});
