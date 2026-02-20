export interface SecretDetection {
  rule: string;
  position: number;
  snippet: string;
}

export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of s) {
    freq.set(c, (freq.get(c) || 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function detectSecrets(text: string): SecretDetection | null {
  return null; // stub -- layers added in subsequent tasks
}
