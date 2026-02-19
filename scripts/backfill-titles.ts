#!/usr/bin/env npx tsx
import arg from 'arg';

const args = arg({
  '--qdrant-url': String,
  '--api-key': String,
  '--collection': String,
  '--ollama-url': String,
  '--model': String,
  '--dry-run': Boolean,
});

const QDRANT_URL = args['--qdrant-url'] || 'http://localhost:6333';
const API_KEY = args['--api-key'] || '';
const COLLECTION = args['--collection'] || 'shared_agent_memory';
const OLLAMA_URL = args['--ollama-url'] || 'http://localhost:11434';
const MODEL = args['--model'] || 'llama3.1:8b';
const DRY_RUN = args['--dry-run'] || false;

interface QdrantPoint {
  id: string;
  payload: Record<string, unknown>;
}

async function qdrantPost(path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['api-key'] = API_KEY;

  const res = await fetch(`${QDRANT_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Qdrant ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function qdrantPut(path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['api-key'] = API_KEY;

  const res = await fetch(`${QDRANT_URL}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Qdrant ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function generateTitle(text: string): Promise<string> {
  const prompt = `Generate a short title (max 10 words) for this memory note. Return ONLY the title, nothing else. No quotes, no punctuation at the end.\n\n${text.slice(0, 2000)}`;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama: ${res.status} ${await res.text()}`);
  const data = await res.json() as { response: string };
  return data.response.trim().replace(/^["']|["']$/g, '').replace(/\.+$/, '');
}

async function scrollAll(): Promise<QdrantPoint[]> {
  const points: QdrantPoint[] = [];
  let offset: string | undefined;

  while (true) {
    const body: Record<string, unknown> = {
      limit: 100,
      with_payload: true,
      with_vector: false,
      filter: { must: [{ is_empty: { key: 'tombstoned_at' } }] },
    };
    if (offset) body.offset = offset;

    const result = await qdrantPost(`/collections/${COLLECTION}/points/scroll`, body) as {
      result: { points: QdrantPoint[]; next_page_offset?: string };
    };

    points.push(...result.result.points);
    offset = result.result.next_page_offset;
    if (!offset || result.result.points.length === 0) break;
  }

  return points;
}

async function main() {
  console.log(`Qdrant: ${QDRANT_URL}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log('');

  const allPoints = await scrollAll();
  const needsTitle = allPoints.filter(p => !p.payload.title);

  console.log(`Total points: ${allPoints.length}`);
  console.log(`Need titles: ${needsTitle.length}`);
  console.log('');

  let done = 0;
  let errors = 0;

  for (const point of needsTitle) {
    const text = point.payload.text as string;
    try {
      const title = await generateTitle(text);
      done++;

      if (DRY_RUN) {
        console.log(`[${done}/${needsTitle.length}] ${point.id}: ${title}`);
      } else {
        await qdrantPut(`/collections/${COLLECTION}/points/payload`, {
          payload: { title },
          points: [point.id],
        });
        console.log(`[${done}/${needsTitle.length}] ${title}`);
      }
    } catch (err) {
      errors++;
      console.error(`[ERROR] ${point.id}: ${err}`);
    }
  }

  console.log(`\nDone. Updated: ${done}, Errors: ${errors}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
