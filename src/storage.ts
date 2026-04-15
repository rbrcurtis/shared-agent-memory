import { QdrantClient } from '@qdrant/js-client-rest';
import { ServerConfig, MemoryMetadata, SearchResult } from './types.js';
import { computeStability, DENSE_VECTOR_NAME, BM25_VECTOR_NAME, BM25_MODEL } from './retention.js';
import { randomUUID } from 'crypto';

interface StoreParams {
  text: string;
  title: string;
  vector: number[];
  agent: string;
  project: string;
  tags: string[];
}

interface SearchParams {
  vector: number[];
  queryText: string;
  limit: number;
  agent?: string;
  project?: string;
  tags?: string[];
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

export class StorageService {
  private client: QdrantClient;
  private config: ServerConfig;
  private readonly vectorSize = 384;

  constructor(config: ServerConfig) {
    this.config = config;
    const url = new URL(config.qdrantUrl);
    const isHttps = url.protocol === 'https:';
    const port = url.port ? parseInt(url.port) : (isHttps ? 443 : 6333);

    this.client = new QdrantClient({
      host: url.hostname,
      port,
      https: isHttps,
      apiKey: config.qdrantApiKey,
    });
  }

  async initialize(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === this.config.collectionName
    );

    if (!exists) {
      await this.client.createCollection(this.config.collectionName, {
        vectors: {
          [DENSE_VECTOR_NAME]: { size: this.vectorSize, distance: 'Cosine' },
        },
        sparse_vectors: {
          [BM25_VECTOR_NAME]: { modifier: 'idf' as any },
        },
      });
      console.error(`Created collection: ${this.config.collectionName}`);
    }
  }

  async store(params: StoreParams): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      id,
      text: params.text,
      title: params.title,
      agent: params.agent,
      project: params.project,
      tags: params.tags,
      created_at: now,
      last_accessed: now,
      access_count: 0,
      stability: 1.0,
    };

    await this.client.upsert(this.config.collectionName, {
      wait: true,
      points: [{
        id,
        vector: {
          [DENSE_VECTOR_NAME]: params.vector,
          [BM25_VECTOR_NAME]: { text: params.text, model: BM25_MODEL } as any,
        },
        payload,
      }],
    });

    return id;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const filter = this.buildFilter(params);

    const results = await this.client.query(this.config.collectionName, {
      prefetch: [
        {
          query: params.vector,
          using: DENSE_VECTOR_NAME,
          limit: params.limit,
          filter,
        },
        {
          query: { text: params.queryText, model: BM25_MODEL } as any,
          using: BM25_VECTOR_NAME,
          limit: params.limit,
          filter,
        },
      ],
      query: { fusion: 'rrf' } as any,
      limit: params.limit,
      with_payload: true,
    });

    const toFixTags: Array<{ id: string; tags: string[] }> = [];

    const mapped = results.points.map((point) => {
      const payload = point.payload as unknown as MemoryMetadata;
      const tags = normalizeTags(payload.tags);
      if (!Array.isArray(payload.tags)) {
        toFixTags.push({ id: payload.id, tags });
      }
      return {
        id: payload.id,
        score: point.score ?? 0,
        text: payload.text,
        title: payload.title || '',
        agent: payload.agent,
        project: payload.project,
        tags,
        created_at: payload.created_at,
        last_accessed: payload.last_accessed,
        access_count: payload.access_count,
        stability: payload.stability,
      };
    });

    // Auto-fix bad tags in Qdrant (fire and forget)
    for (const fix of toFixTags) {
      this.client.setPayload(this.config.collectionName, {
        payload: { tags: fix.tags },
        points: [fix.id],
      }).catch(() => {});
    }

    return mapped;
  }

  async listRecent(limit: number, daysBack: number = 30, project?: string): Promise<SearchResult[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const must: object[] = [
      { key: 'created_at', range: { gte: cutoff.toISOString() } },
      { is_empty: { key: 'tombstoned_at' } },
    ];
    if (project) {
      must.push({ key: 'project', match: { value: project } });
    }

    const results = await this.client.scroll(this.config.collectionName, {
      limit,
      with_payload: true,
      filter: { must },
    });

    const toFixTags: Array<{ id: string; tags: string[] }> = [];

    const mapped = results.points
      .map((point) => {
        const payload = point.payload as unknown as MemoryMetadata;
        const tags = normalizeTags(payload.tags);
        if (!Array.isArray(payload.tags)) {
          toFixTags.push({ id: payload.id, tags });
        }
        return {
          id: payload.id,
          score: 1,
          text: payload.text,
          title: payload.title || '',
          agent: payload.agent,
          project: payload.project,
          tags,
          created_at: payload.created_at,
          last_accessed: payload.last_accessed,
          access_count: payload.access_count,
          stability: payload.stability,
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Auto-fix bad tags in Qdrant (fire and forget)
    for (const fix of toFixTags) {
      this.client.setPayload(this.config.collectionName, {
        payload: { tags: fix.tags },
        points: [fix.id],
      }).catch(() => {});
    }

    return mapped;
  }

  async getByIds(ids: string[]): Promise<SearchResult[]> {
    const results = await this.client.retrieve(this.config.collectionName, {
      ids,
      with_payload: true,
    });

    return results.map((point) => {
      const payload = point.payload as unknown as MemoryMetadata;
      const tags = normalizeTags(payload.tags);
      return {
        id: payload.id,
        score: 1,
        text: payload.text,
        title: payload.title || '',
        agent: payload.agent,
        project: payload.project,
        tags,
        created_at: payload.created_at,
        last_accessed: payload.last_accessed,
        access_count: payload.access_count,
        stability: payload.stability,
      };
    });
  }

  async update(id: string, params: StoreParams): Promise<void> {
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      id,
      text: params.text,
      title: params.title,
      agent: params.agent,
      project: params.project,
      tags: params.tags,
      created_at: now,
      last_accessed: now,
      access_count: 0,
      stability: 1.0,
    };

    await this.client.upsert(this.config.collectionName, {
      wait: true,
      points: [{
        id,
        vector: {
          [DENSE_VECTOR_NAME]: params.vector,
          [BM25_VECTOR_NAME]: { text: params.text, model: BM25_MODEL } as any,
        },
        payload,
      }],
    });
  }

  async delete(id: string): Promise<boolean> {
    await this.client.delete(this.config.collectionName, {
      wait: true,
      points: [id],
    });
    return true;
  }

  async deleteCollection(): Promise<void> {
    await this.client.deleteCollection(this.config.collectionName);
  }

  async setPayload(id: string, payload: Record<string, unknown>): Promise<void> {
    await this.client.setPayload(this.config.collectionName, {
      payload,
      points: [id],
    });
  }

  async searchByTags(params: {
    tags: string[];
    excludeIds: string[];
    limit: number;
    project?: string;
  }): Promise<SearchResult[]> {
    if (params.tags.length === 0) return [];

    const should = params.tags.map(tag => ({ key: 'tags', match: { value: tag } }));
    const must: object[] = [
      { is_empty: { key: 'tombstoned_at' } },
    ];
    if (params.project) {
      must.push({ key: 'project', match: { value: params.project } });
    }

    const mustNot: object[] = [];
    if (params.excludeIds.length > 0) {
      mustNot.push({ has_id: params.excludeIds });
    }

    const results = await this.client.scroll(this.config.collectionName, {
      limit: params.limit,
      with_payload: true,
      filter: { must, should, must_not: mustNot },
    });

    return results.points.map((point) => {
      const payload = point.payload as unknown as MemoryMetadata;
      return {
        id: payload.id,
        score: 0,
        text: payload.text,
        title: payload.title || '',
        agent: payload.agent,
        project: payload.project,
        tags: normalizeTags(payload.tags),
        created_at: payload.created_at,
        last_accessed: payload.last_accessed,
        access_count: payload.access_count,
        stability: payload.stability,
      };
    });
  }

  async reinforceMemories(points: Array<{ id: string; accessCount: number }>): Promise<void> {
    const now = new Date().toISOString();
    for (const point of points) {
      const newCount = point.accessCount + 1;
      await this.client.setPayload(this.config.collectionName, {
        payload: {
          last_accessed: now,
          access_count: newCount,
          stability: computeStability(newCount),
        },
        points: [point.id],
      });
    }
  }

  async tombstoneMemories(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    for (const id of ids) {
      await this.client.setPayload(this.config.collectionName, {
        payload: { tombstoned_at: now },
        points: [id],
      });
    }
  }

  private buildFilter(params: SearchParams): { must: object[] } {
    const must: object[] = [
      { is_empty: { key: 'tombstoned_at' } },
    ];

    if (params.agent) {
      must.push({ key: 'agent', match: { value: params.agent } });
    }
    if (params.project) {
      must.push({ key: 'project', match: { value: params.project } });
    }
    if (params.tags && params.tags.length > 0) {
      for (const tag of params.tags) {
        must.push({ key: 'tags', match: { value: tag } });
      }
    }

    return { must };
  }
}
