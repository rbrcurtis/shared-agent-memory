import { loadMemories, searchMemory, storeMemory, updateMemory } from '../client.js';
import type { SearchResult } from '../types.js';
import { normalizeClaudeCodeTranscriptFile } from './claude-code.js';
import { extractCandidateLearnings } from './extract.js';
import type { CandidateLearning, IngestDecision, IngestSummary, IngestTranscriptOptions } from './types.js';

const DEFAULT_PROJECT = 'default';
const INGEST_AGENT = 'claude-code-ingest';
const DUPLICATE_THRESHOLD = 0.92;
const UPDATE_THRESHOLD = 0.78;

export interface IngestTranscriptResult extends IngestSummary {
  decisions: IngestDecision[];
}

export async function ingestClaudeCodeTranscript(
  options: IngestTranscriptOptions,
): Promise<IngestTranscriptResult> {
  const project = options.project ?? DEFAULT_PROJECT;
  const transcript = await normalizeClaudeCodeTranscriptFile(options.file);
  const candidates = await extractCandidateLearnings(transcript, options.model);
  const decisions: IngestDecision[] = [];

  for (const candidate of candidates) {
    const decision = await decideCandidate(candidate, project);
    decisions.push(decision);

    if (options.dryRun || decision.action === 'skip') continue;

    if (decision.action === 'create') {
      const stored = await storeMemory({
        title: candidate.title,
        text: candidate.text,
        project,
        agent: INGEST_AGENT,
        tags: candidate.tags,
      });
      decision.id = stored.id;
    } else if (decision.id) {
      await updateMemory({
        id: decision.id,
        title: candidate.title,
        text: candidate.text,
        project,
      });
    }
  }

  return summarize(project, Boolean(options.dryRun), decisions);
}

async function decideCandidate(candidate: CandidateLearning, project: string): Promise<IngestDecision> {
  const matches = await findMatches(candidate, project);
  const best = matches[0];

  if (!best) return { ...candidate, action: 'create', reason: 'no similar memory found' };

  if (best.score >= DUPLICATE_THRESHOLD) {
    return { ...candidate, action: 'skip', id: best.id, reason: 'similar memory already exists' };
  }

  if (best.score >= UPDATE_THRESHOLD) {
    const existing = await loadExistingMemory(best.id);
    return {
      ...candidate,
      action: existing?.text === candidate.text ? 'skip' : 'update',
      id: best.id,
      reason: existing?.text === candidate.text ? 'existing memory has same text' : 'similar memory can be refined',
    };
  }

  return { ...candidate, action: 'create', reason: 'no close memory found' };
}

async function findMatches(candidate: CandidateLearning, project: string): Promise<SearchResult[]> {
  const response = await searchMemory({ query: `${candidate.title}\n${candidate.text}`, project, limit: 3 });
  return response.results.filter(isSearchResult).sort((a, b) => b.score - a.score);
}

async function loadExistingMemory(id: string): Promise<SearchResult | undefined> {
  const response = await loadMemories([id]);
  return response.results.find(isSearchResult);
}

function summarize(
  project: string,
  dryRun: boolean,
  decisions: IngestDecision[],
): IngestTranscriptResult {
  return {
    project,
    dryRun,
    decisions,
    candidates: decisions.length,
    created: decisions.filter((decision) => decision.action === 'create').length,
    updated: decisions.filter((decision) => decision.action === 'update').length,
    skipped: decisions.filter((decision) => decision.action === 'skip').length,
  };
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== 'object') return false;

  const result = value as Partial<SearchResult>;
  return (
    typeof result.id === 'string' &&
    typeof result.score === 'number' &&
    typeof result.text === 'string' &&
    typeof result.title === 'string'
  );
}
