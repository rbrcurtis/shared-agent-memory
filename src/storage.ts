import { QdrantClient } from '@qdrant/js-client-rest';
import { ServerConfig, MemoryMetadata, SearchResult } from './types.js';
import { randomUUID } from 'crypto';

interface StoreParams {
  text: string;
  vector: number[];
  agent: string;
  project: string;
  tags: string[];
}

interface SearchParams {
  vector: number[];
  limit: number;
  agent?: string;
  project?: string;
  tags?: string[];
}

export class StorageService {
  private client: QdrantClient;
  private config: ServerConfig;
  private readonly vectorSize = 384;

  constructor(config: ServerConfig) {
    this.config = config;
    this.client = new QdrantClient({
      url: config.qdrantUrl,
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
        vectors: { size: this.vectorSize, distance: 'Cosine' },
      });
      console.error(`Created collection: ${this.config.collectionName}`);
    }
  }

  async store(params: StoreParams): Promise<string> {
    const id = randomUUID();
    const payload: Record<string, unknown> = {
      id,
      text: params.text,
      agent: params.agent,
      project: params.project,
      tags: params.tags,
      created_at: new Date().toISOString(),
    };

    await this.client.upsert(this.config.collectionName, {
      wait: true,
      points: [{ id, vector: params.vector, payload }],
    });

    return id;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const filter = this.buildFilter(params);

    const results = await this.client.query(this.config.collectionName, {
      query: params.vector,
      limit: params.limit,
      filter: filter.must.length > 0 ? filter : undefined,
      with_payload: true,
    });

    return results.points.map((point) => {
      const payload = point.payload as unknown as MemoryMetadata;
      return {
        id: payload.id,
        score: point.score ?? 0,
        text: payload.text,
        agent: payload.agent,
        project: payload.project,
        tags: payload.tags,
        created_at: payload.created_at,
      };
    });
  }

  async listRecent(limit: number, daysBack: number = 30): Promise<SearchResult[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const results = await this.client.scroll(this.config.collectionName, {
      limit,
      with_payload: true,
      filter: {
        must: [
          {
            key: 'created_at',
            range: { gte: cutoff.toISOString() },
          },
        ],
      },
    });

    return results.points
      .map((point) => {
        const payload = point.payload as unknown as MemoryMetadata;
        return {
          id: payload.id,
          score: 1,
          text: payload.text,
          agent: payload.agent,
          project: payload.project,
          tags: payload.tags,
          created_at: payload.created_at,
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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

  private buildFilter(params: SearchParams): { must: object[] } {
    const must: object[] = [];

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
