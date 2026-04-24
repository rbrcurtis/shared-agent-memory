import type { CandidateLearning, NormalizedTranscript } from './types.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3:8b';

const LEARNING_SCHEMA = {
  type: 'object',
  properties: {
    learnings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          text: { type: 'string' },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['title', 'text'],
      },
    },
  },
  required: ['learnings'],
} as const;

interface OllamaGenerateResponse {
  response: string;
}

interface RawLearning {
  title?: unknown;
  text?: unknown;
  tags?: unknown;
}

export async function extractCandidateLearnings(
  transcript: NormalizedTranscript,
  model = DEFAULT_MODEL,
): Promise<CandidateLearning[]> {
  if (!transcript.text.trim()) return [];

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: buildPrompt(transcript.text),
      stream: false,
      format: LEARNING_SCHEMA,
      options: {
        temperature: 0.1,
        num_predict: 4096,
        num_ctx: 8192,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama extraction failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as OllamaGenerateResponse;
  return normalizeLearnings(parseLearnings(data.response));
}

function buildPrompt(text: string): string {
  return `Extract durable project learnings from this Claude Code transcript.

Include only facts, preferences, conventions, decisions, recurring fixes, project-specific commands, or architectural knowledge that would help a future coding agent. Exclude ordinary conversation, transient task status, secrets, private credentials, raw logs, and one-off implementation details.

Return at most 10 concise learnings. Each learning should stand alone, include the project/tool/context when clear, and use a title under 10 words.

Transcript:
${text}

/no_think`;
}

function parseLearnings(raw: string): RawLearning[] {
  const parsed = JSON.parse(raw) as { learnings?: unknown };
  return Array.isArray(parsed.learnings) ? (parsed.learnings as RawLearning[]) : [];
}

function normalizeLearnings(learnings: RawLearning[]): CandidateLearning[] {
  return learnings
    .map((learning) => ({
      title: cleanTitle(learning.title),
      text: cleanText(learning.text),
      tags: cleanTags(learning.tags),
    }))
    .filter((learning) => learning.title && learning.text)
    .slice(0, 10);
}

function cleanTitle(title: unknown): string {
  if (typeof title !== 'string') return '';
  return title.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function cleanText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.trim().replace(/\s+/g, ' ');
}

function cleanTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;

  const cleaned = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  return cleaned.length ? [...new Set(cleaned)].slice(0, 12) : undefined;
}
