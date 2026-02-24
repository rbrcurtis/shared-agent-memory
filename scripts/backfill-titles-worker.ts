// Backfill titles for untitled memories
// Uses ollama for title generation, Qdrant POST (merge) to set titles safely
// CRITICAL: POST merges payload fields. NEVER use PUT which replaces entire payload.

const COLLECTION = 'shared_agent_memory';
const MODEL = 'llama3.1:8b';

const [qdrantUrl, apiKey, dryRun] = process.argv.slice(2);
if (!qdrantUrl || !apiKey) {
  console.error('Usage: backfill-titles-worker.ts <qdrant_url> <api_key> [true|false]');
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
  };
}

async function qdrantFetch(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${qdrantUrl}${path}`, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Qdrant ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function generateTitle(text: string): Promise<string> {
  const truncated = text.slice(0, 500);
  const prompt = `Generate a short descriptive title (max 10 words) for this memory note. Reply with ONLY the title, no quotes, no explanation.\n\nMemory:\n${truncated}`;

  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama: ${res.status} ${await res.text()}`);
  const data = await res.json() as { response: string };
  return data.response.trim().replace(/^["']|["']$/g, '').trim();
}

async function main(): Promise<void> {
  console.log(`=== Backfill titles ===`);
  console.log(`Qdrant: ${qdrantUrl}`);
  console.log(`Dry run: ${isDryRun}`);

  // Fetch untitled memories
  const scrollResult = await qdrantFetch(`/collections/${COLLECTION}/points/scroll`, {
    limit: 500,
    with_payload: true,
    filter: {
      should: [
        { is_empty: { key: 'title' } },
        { key: 'title', match: { value: '' } },
      ],
    },
  }) as { result: { points: QdrantPoint[] } };

  const points = scrollResult.result.points;
  console.log(`Found ${points.length} untitled memories\n`);

  if (points.length === 0) {
    console.log('Nothing to do');
    return;
  }

  let ok = 0;
  let failed = 0;

  for (const point of points) {
    const id = point.payload.id || String(point.id);
    const text = point.payload.text || '';
    const project = point.payload.project || '?';

    console.log(`--- ${id} [${project}] ---`);
    console.log(`Text: ${text.slice(0, 100).replace(/\n/g, ' ')}...`);

    const title = await generateTitle(text);
    console.log(`Title: ${title}`);

    if (isDryRun) {
      console.log('[DRY RUN] skipping write\n');
      ok++;
      continue;
    }

    // CRITICAL: POST merges, PUT replaces. Always POST.
    const setRes = await fetch(`${qdrantUrl}/collections/${COLLECTION}/points/payload`, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { title }, points: [id] }),
    });

    if (setRes.ok) {
      console.log(`OK\n`);
      ok++;
    } else {
      const err = await setRes.text();
      console.error(`FAILED: ${setRes.status} ${err}\n`);
      failed++;
    }
  }

  console.log(`\n=== Done: ${ok} ok, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
