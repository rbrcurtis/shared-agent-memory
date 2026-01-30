export interface MemoryMetadata {
  id: string;
  text: string;
  agent: string;
  project: string;
  tags: string[];
  created_at: string;
}

export interface MemoryPoint {
  id: string;
  vector: number[];
  payload: MemoryMetadata;
}

export interface StoreMemoryRequest {
  text: string;
  agent?: string;
  project?: string;
  tags?: string[];
}

export interface SearchMemoryRequest {
  query: string;
  limit?: number;
  agent?: string;
  project?: string;
  tags?: string[];
}

export interface SearchResult {
  id: string;
  score: number;
  text: string;
  agent: string;
  project: string;
  tags: string[];
  created_at: string;
}

export interface ServerConfig {
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName: string;
  defaultAgent: string;
  defaultProject: string;
}
