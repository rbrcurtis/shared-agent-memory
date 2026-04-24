export interface IngestTranscriptOptions {
  file: string;
  project?: string;
  model?: string;
  dryRun?: boolean;
}

export interface NormalizedTranscript {
  text: string;
  lineCount: number;
  charCount: number;
}

export interface CandidateLearning {
  title: string;
  text: string;
  tags?: string[];
}

export interface IngestDecision extends CandidateLearning {
  action: 'create' | 'update' | 'skip';
  id?: string;
  reason?: string;
}

export interface IngestSummary {
  project: string;
  candidates: number;
  created: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
}
