#!/usr/bin/env node
import arg from 'arg';
import { QdrantClient } from '@qdrant/js-client-rest';
import { DENSE_VECTOR_NAME, BM25_VECTOR_NAME, BM25_MODEL } from '../src/retention.js';

const args = arg({
  '--url': String,
  '--api-key': String,
  '--collection': String,
  '--dry-run': Boolean,
});

const qdrantUrl = args['--url'] || 'http://localhost:6333';
const apiKey = args['--api-key'];
const collectionName = args['--collection'] || 'shared_agent_memory';
const dryRun = args['--dry-run'] || false;

async function main() {
  const url = new URL(qdrantUrl);
  const isHttps = url.protocol === 'https:';
  const port = url.port ? parseInt(url.port) : (isHttps ? 443 : 6333);

  const client = new QdrantClient({
    host: url.hostname,
    port,
    https: isHttps,
    apiKey,
  });

  console.log(`Migrating ${collectionName} on ${qdrantUrl}...`);
  if (dryRun) console.log('DRY RUN — no changes will be made');

  // Step 1: Snapshot for backup
  console.log('Creating snapshot...');
  const snapshot = await client.createSnapshot(collectionName);
  console.log(`Snapshot created: ${JSON.stringify(snapshot)}`);

  // Step 2: Scroll ALL points with vectors and payloads
  console.log('Scrolling all points...');
  const allPoints: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];
  let offset: string | number | undefined | null = undefined;

  while (true) {
    const batch = await client.scroll(collectionName, {
      limit: 100,
      with_payload: true,
      with_vector: true,
      offset: offset ?? undefined,
    });

    for (const point of batch.points) {
      const vector = point.vector as number[];
      allPoints.push({
        id: point.id as string,
        vector,
        payload: point.payload as Record<string, unknown>,
      });
    }

    if (!batch.next_page_offset) break;
    offset = batch.next_page_offset;
  }

  console.log(`Found ${allPoints.length} points`);

  if (dryRun) {
    console.log('DRY RUN complete. Would recreate collection and re-insert all points.');
    return;
  }

  // Step 3: Delete old collection
  console.log('Deleting old collection...');
  await client.deleteCollection(collectionName);

  // Step 4: Create new collection with named dense + sparse vectors
  console.log('Creating new collection with hybrid config...');
  await client.createCollection(collectionName, {
    vectors: {
      [DENSE_VECTOR_NAME]: { size: 384, distance: 'Cosine' },
    },
    sparse_vectors: {
      [BM25_VECTOR_NAME]: { modifier: 'idf' as unknown as any },
    },
  });

  // Step 5: Re-insert points in batches
  const batchSize = 50;
  for (let i = 0; i < allPoints.length; i += batchSize) {
    const batch = allPoints.slice(i, i + batchSize);
    const points = batch.map((p) => ({
      id: p.id,
      vector: {
        [DENSE_VECTOR_NAME]: p.vector,
        [BM25_VECTOR_NAME]: { text: (p.payload.text as string) || '', model: BM25_MODEL },
      },
      payload: p.payload,
    }));

    await client.upsert(collectionName, { wait: true, points });
    console.log(`Inserted ${Math.min(i + batchSize, allPoints.length)}/${allPoints.length}`);
  }

  // Step 6: Verify
  const info = await client.getCollection(collectionName);
  console.log(`Migration complete. Points: ${info.points_count}`);
  if (info.points_count !== allPoints.length) {
    console.error(`WARNING: Expected ${allPoints.length} points but got ${info.points_count}`);
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
