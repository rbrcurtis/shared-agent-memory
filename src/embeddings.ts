import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

export class EmbeddingService {
  private static instance: EmbeddingService;
  private extractor: FeatureExtractionPipeline | null = null;
  private readonly modelName = 'Xenova/all-MiniLM-L6-v2';
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    console.error('Loading embedding model...');
    this.extractor = await pipeline('feature-extraction', this.modelName);
    console.error('Embedding model loaded');
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.extractor) await this.initialize();
    if (!this.extractor) throw new Error('Embedding model not initialized');

    const result = await this.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  }
}
