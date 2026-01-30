import { EmbeddingService } from './embeddings.js';
import { StorageService } from './storage.js';
import {
  ServerConfig,
  StoreMemoryRequest,
  SearchMemoryRequest,
  SearchResult,
} from './types.js';

export class MemoryService {
  private embeddings: EmbeddingService;
  private storage: StorageService;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.embeddings = EmbeddingService.getInstance();
    this.storage = new StorageService(config);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.embeddings.initialize(),
      this.storage.initialize(),
    ]);
  }

  async store(request: StoreMemoryRequest): Promise<string> {
    const vector = await this.embeddings.generateEmbedding(request.text);

    return this.storage.store({
      text: request.text,
      vector,
      agent: request.agent || this.config.defaultAgent,
      project: request.project || this.config.defaultProject,
      tags: request.tags || [],
    });
  }

  async search(request: SearchMemoryRequest): Promise<SearchResult[]> {
    const vector = await this.embeddings.generateEmbedding(request.query);

    return this.storage.search({
      vector,
      limit: request.limit || 10,
      agent: request.agent,
      project: request.project,
      tags: request.tags,
    });
  }

  async listRecent(limit: number = 10, daysBack: number = 30): Promise<SearchResult[]> {
    return this.storage.listRecent(limit, daysBack);
  }

  async delete(id: string): Promise<boolean> {
    return this.storage.delete(id);
  }
}
