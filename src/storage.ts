import { QdrantClient } from '@qdrant/js-client-rest';
import { ServerConfig, MemoryMetadata, SearchResult, AuditEvent } from './types.js';
import { computeStability, DENSE_VECTOR_NAME, BM25_VECTOR_NAME, BM25_MODEL } from './retention.js';
import { randomUUID } from 'crypto';

interface StoreParams {
  text: string;
  title: string;
  vector: number[];
  agent: string;
  project: string;
  tags: string[];
  actor?: string;
}

interface UpdateParams extends StoreParams {
  createdAt?: string;
  createdBy?: string;
  accessCount?: number;
  stability?: number;
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
  private readonly auditVectorSize = 1;

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
    const auditExists = collections.collections.some(
      (c) => c.name === this.auditCollectionName()
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

    if (!auditExists) {
      await this.client.createCollection(this.auditCollectionName(), {
        vectors: {
          audit: { size: this.auditVectorSize, distance: 'Cosine' },
        },
      });
      console.error(`Created collection: ${this.auditCollectionName()}`);
    }
  }

  async store(params: StoreParams): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const actor = params.actor || 'unknown';
    const payload: Record<string, unknown> = {
      id,
      text: params.text,
      title: params.title,
      agent: params.agent,
      project: params.project,
      tags: params.tags,
      created_at: now,
      updated_at: now,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
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

    await this.recordAudit({
      memoryId: id,
      action: 'create',
      actor,
      project: params.project,
      timestamp: now,
      title: params.title,
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
      return this.mapPayload(payload, point.score ?? 0, tags);
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
        return this.mapPayload(payload, 1, tags);
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
      return this.mapPayload(payload, 1, tags);
    });
  }

  async update(id: string, params: UpdateParams): Promise<void> {
    const now = new Date().toISOString();
    const actor = params.actor || 'unknown';
    const createdAt = params.createdAt || now;
    const createdBy = params.createdBy || 'unknown';
    const payload: Record<string, unknown> = {
      id,
      text: params.text,
      title: params.title,
      agent: params.agent,
      project: params.project,
      tags: params.tags,
      created_at: createdAt,
      updated_at: now,
      createdAt,
      updatedAt: now,
      createdBy,
      updatedBy: actor,
      last_accessed: now,
      access_count: params.accessCount ?? 0,
      stability: params.stability ?? 1.0,
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

    await this.recordAudit({
      memoryId: id,
      action: 'update',
      actor,
      project: params.project,
      timestamp: now,
      title: params.title,
    });
  }

  async delete(id: string, actor = 'unknown', existing?: SearchResult): Promise<boolean> {
    if (existing) {
      await this.recordAudit({
        memoryId: id,
        action: 'delete',
        actor,
        project: existing.project,
        timestamp: new Date().toISOString(),
        title: existing.title,
      });
    }

    await this.client.delete(this.config.collectionName, {
      wait: true,
      points: [id],
    });
    return true;
  }

  async deleteCollection(): Promise<void> {
    await this.client.deleteCollection(this.config.collectionName);
    try {
      await this.client.deleteCollection(this.auditCollectionName());
    } catch {
      // The audit collection may not exist in older test databases.
    }
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
      return this.mapPayload(payload, 0, normalizeTags(payload.tags));
    });
  }

  async listAudit(memoryId: string): Promise<AuditEvent[]> {
    const results = await this.client.scroll(this.auditCollectionName(), {
      limit: 100,
      with_payload: true,
      filter: {
        must: [
          { key: 'memoryId', match: { value: memoryId } },
        ],
      },
    });

    return results.points
      .map((point) => point.payload as unknown as AuditEvent)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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

  private auditCollectionName(): string {
    return `${this.config.collectionName}_audit`;
  }

  private mapPayload(payload: MemoryMetadata, score: number, tags: string[]): SearchResult {
    const createdAt = payload.createdAt || payload.created_at;
    const updatedAt = payload.updatedAt || payload.updated_at || createdAt;
    return {
      id: payload.id,
      score,
      text: payload.text,
      title: payload.title || '',
      agent: payload.agent,
      project: payload.project,
      tags,
      created_at: payload.created_at,
      updated_at: payload.updated_at,
      createdAt,
      updatedAt,
      createdBy: payload.createdBy,
      updatedBy: payload.updatedBy,
      last_accessed: payload.last_accessed,
      access_count: payload.access_count,
      stability: payload.stability,
    };
  }

  private async recordAudit(event: Omit<AuditEvent, 'id'>): Promise<void> {
    const id = randomUUID();
    await this.client.upsert(this.auditCollectionName(), {
      wait: true,
      points: [{
        id,
        vector: { audit: [1] },
        payload: { id, ...event },
      }],
    });
  }
}
