// Entity extraction using ollama qwen3:8b structured output
// Extracts named entities from memory text for cross-linking via tags

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = 'qwen3:8b';

const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entity: { type: 'string' },
          type: {
            type: 'string',
            enum: [
              'PERSON', 'ORG', 'PRODUCT', 'SERVICE', 'TECH',
              'DOMAIN', 'IP', 'PATH', 'EMAIL', 'EVENT', 'CONCEPT',
            ],
          },
        },
        required: ['entity', 'type'],
      },
    },
  },
  required: ['entities'],
} as const;

interface OllamaGenerateResponse {
  response: string;
}

interface ExtractedEntity {
  entity: string;
  type: string;
}

/**
 * Parse entities from JSON that may be truncated mid-generation.
 * Extracts all complete {"entity":"...","type":"..."} objects via regex.
 */
function parseEntitiesFromPartialJson(json: string): ExtractedEntity[] {
  const pattern = /\{\s*"entity"\s*:\s*"([^"]+)"\s*,\s*"type"\s*:\s*"([^"]+)"\s*\}/g;
  const entities: ExtractedEntity[] = [];
  let match;
  while ((match = pattern.exec(json)) !== null) {
    entities.push({ entity: match[1], type: match[2] });
  }
  return entities;
}

function dedupeEntities(entities: ExtractedEntity[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const e of entities) {
    const tag = e.entity.toLowerCase().trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Extract named entities from text using ollama qwen3:8b.
 * Returns lowercased entity names suitable for use as tags.
 * Graceful failure: returns [] on any error, never throws.
 */
export async function extractEntities(text: string): Promise<string[]> {
  try {
    const prompt = `Extract named entities from this text. Return specific names, technologies, services, domains, IPs, file paths, etc. Only include entities explicitly mentioned, not generic concepts.\n\nText:\n${text}\n\n/no_think`;

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        format: ENTITY_SCHEMA,
        options: {
          temperature: 0.1,
          num_predict: 4096,
          num_ctx: 4096,
        },
      }),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as OllamaGenerateResponse;
    const raw = data.response;

    // Try full parse first, fall back to partial extraction on truncated JSON
    let entities: ExtractedEntity[];
    try {
      const parsed = JSON.parse(raw) as { entities: ExtractedEntity[] };
      entities = Array.isArray(parsed.entities) ? parsed.entities : [];
    } catch {
      entities = parseEntitiesFromPartialJson(raw);
    }

    return dedupeEntities(entities);
  } catch {
    return [];
  }
}
