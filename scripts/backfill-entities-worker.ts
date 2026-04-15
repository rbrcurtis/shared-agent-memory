// Backfill entity tags for all memories
// Uses ollama qwen3:8b structured output for entity extraction
// Qdrant POST (merge) to set tags safely — NEVER use PUT which replaces entire payload

const COLLECTION = 'shared_agent_memory';
const OLLAMA_URL = 'http://localhost:11434';
const MODEL = 'qwen3:8b';
const BATCH_SIZE = 100;

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
};

const [qdrantUrl, apiKey, dryRun] = process.argv.slice(2);
if (!qdrantUrl || !apiKey) {
  console.error('Usage: backfill-entities-worker.ts <qdrant_url> <api_key> [true|false]');
  process.exit(1);
}
const isDryRun = dryRun === 'true';

interface QdrantPoint {
  id: string;
  payload: {
    id: string;
    text: string;
    title?: string;
    project?: string;
    tags?: string[];
    tombstoned_at?: string;
  };
}

interface ScrollResponse {
  result: {
    points: QdrantPoint[];
    next_page_offset: string | null;
  };
}

async function qdrantScroll(offset?: string): Promise<ScrollResponse> {
  const body: Record<string, unknown> = {
    limit: BATCH_SIZE,
    with_payload: true,
    filter: {
      must: [{ is_empty: { key: 'tombstoned_at' } }],
    },
  };
  if (offset) body.offset = offset;

  const res = await fetch(`${qdrantUrl}/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Qdrant scroll: ${res.status} ${await res.text()}`);
  return res.json() as Promise<ScrollResponse>;
}

async function extractEntities(text: string): Promise<string[]> {
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

  if (!res.ok) throw new Error(`Ollama: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { response: string };
  const raw = data.response;

  let entities: Array<{ entity: string; type: string }>;
  try {
    const parsed = JSON.parse(raw) as { entities: Array<{ entity: string; type: string }> };
    entities = Array.isArray(parsed.entities) ? parsed.entities : [];
  } catch {
    const pattern = /\{\s*"entity"\s*:\s*"([^"]+)"\s*,\s*"type"\s*:\s*"([^"]+)"\s*\}/g;
    entities = [];
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      entities.push({ entity: match[1], type: match[2] });
    }
  }

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

async function main(): Promise<void> {
  console.log(`=== Backfill entity tags ===`);
  console.log(`Qdrant: ${qdrantUrl}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Dry run: ${isDryRun}`);
  console.log();

  let offset: string | undefined;
  let total = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  do {
    const scroll = await qdrantScroll(offset);
    const points = scroll.result.points;
    offset = scroll.result.next_page_offset ?? undefined;

    for (const point of points) {
      total++;
      const id = point.payload.id || String(point.id);
      const text = point.payload.text || '';
      const existingTags: string[] = Array.isArray(point.payload.tags) ? point.payload.tags : [];
      const project = point.payload.project || '?';

      console.log(`[${total}] ${id} [${project}]`);
      console.log(`  Text: ${text.slice(0, 80).replace(/\n/g, ' ')}...`);

      try {
        const entityTags = await extractEntities(text);
        const merged = [...new Set([...existingTags, ...entityTags])];

        console.log(`  Entities: ${entityTags.join(', ') || '(none)'}`);
        console.log(`  Tags: ${existingTags.length} existing + ${entityTags.length} new = ${merged.length} total`);

        if (entityTags.length === 0) {
          skipped++;
          continue;
        }

        if (isDryRun) {
          console.log(`  [DRY RUN] skipping write`);
          updated++;
          continue;
        }

        // CRITICAL: POST merges, PUT replaces. Always POST.
        const setRes = await fetch(`${qdrantUrl}/collections/${COLLECTION}/points/payload`, {
          method: 'POST',
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: { tags: merged }, points: [id] }),
        });

        if (setRes.ok) {
          console.log(`  OK`);
          updated++;
        } else {
          const err = await setRes.text();
          console.error(`  FAILED: ${setRes.status} ${err}`);
          failed++;
        }
      } catch (err) {
        console.error(`  ERROR: ${err}`);
        failed++;
      }
    }
  } while (offset);

  console.log(`\n=== Done: ${total} total, ${updated} updated, ${skipped} skipped, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
