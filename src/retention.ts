export const BASE_HALF_LIFE = 27; // days (~6 months to tombstone at stability=1.0)
export const OVER_FETCH_MULTIPLIER = 3;
export const TOMBSTONE_THRESHOLD = 0.01;

export const DENSE_VECTOR_NAME = 'dense';
export const BM25_VECTOR_NAME = 'text-bm25';
export const BM25_MODEL = 'Qdrant/bm25';

/**
 * stability = 1.0 + ln(1 + access_count)
 * Diminishing returns: 0->1.0, 1->1.69, 5->2.79, 20->4.04
 */
export function computeStability(accessCount: number): number {
  return 1.0 + Math.log(1 + accessCount);
}

/**
 * retention = e^(-t / (BASE_HALF_LIFE * stability / ln(2)))
 * Returns 0.5 at t = BASE_HALF_LIFE * stability
 */
export function computeRetention(daysSinceAccess: number, stability: number): number {
  const lambda = (BASE_HALF_LIFE * stability) / Math.LN2;
  return Math.exp(-daysSinceAccess / lambda);
}
