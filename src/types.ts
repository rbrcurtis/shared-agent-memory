export interface MemoryMetadata {
  id: string;
  text: string;
  title: string;
  agent: string;
  project: string;
  tags: string[];
  created_at: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  last_accessed?: string;
  access_count?: number;
  stability?: number;
  tombstoned_at?: string;
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
  title: string;
  agent: string;
  project: string;
  tags: string[];
  created_at: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  last_accessed?: string;
  access_count?: number;
  stability?: number;
  retention?: number;
}

export interface AuditEvent {
  id: string;
  memoryId: string;
  action: 'create' | 'update' | 'delete';
  actor: string;
  project: string;
  timestamp: string;
  title?: string;
}

export interface ServerConfig {
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName: string;
  defaultAgent: string;
  defaultProject: string;
}
