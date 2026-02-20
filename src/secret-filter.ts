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

const KEYWORD_PATTERNS = [
  'key', 'token', 'password', 'passwd', 'secret', 'credential',
  'auth', 'bearer', 'api_key', 'apikey', 'api-key', 'access_key',
  'private_key', 'kubeconfig',
].map(kw => new RegExp(`\\b${kw}\\b`, 'i'));

const PROXIMITY = 50;
const MIN_ENTROPY = 3.2;
const MIN_LENGTH = 9;

const PREFIX_RULES: Array<{ id: string; pattern: RegExp }> = [
  { id: 'github-pat', pattern: /ghp_[a-zA-Z0-9]{36,}/ },
  { id: 'github-oauth', pattern: /gho_[a-zA-Z0-9]{36,}/ },
  { id: 'github-user-token', pattern: /ghu_[a-zA-Z0-9]{36,}/ },
  { id: 'github-server-token', pattern: /ghs_[a-zA-Z0-9]{36,}/ },
  { id: 'github-fine-grained-pat', pattern: /github_pat_[a-zA-Z0-9_]{22,}/ },
  { id: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/ },
  { id: 'slack-token', pattern: /xox[bpaosr]-[a-zA-Z0-9-]{10,}/ },
  { id: 'anthropic-api-key', pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { id: 'openai-api-key', pattern: /sk-(?!ant-)[a-zA-Z0-9-]{20,}/ },
  { id: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}/ },
  { id: 'private-key', pattern: /-----BEGIN\s(?:RSA\s|EC\s|DSA\s|OPENSSH\s)?PRIVATE\sKEY-----/ },
  { id: 'discord-webhook', pattern: /discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[a-zA-Z0-9_-]+/ },
  { id: 'slack-webhook', pattern: /hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/ },
  { id: 'cloudflare-api-key', pattern: /v1\.[a-f0-9]{38,}/ },
  { id: 'gitlab-pat', pattern: /glpat-[a-zA-Z0-9_-]{20,}/ },
  { id: 'gitlab-deploy-token', pattern: /gldt-[a-zA-Z0-9_-]{20,}/ },
  { id: 'npm-token', pattern: /npm_[a-zA-Z0-9]{36,}/ },
  { id: 'pypi-token', pattern: /pypi-[a-zA-Z0-9]{16,}/ },
  { id: 'sendgrid-api-key', pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/ },
  { id: 'square-token', pattern: /sq0[a-z]{3}-[a-zA-Z0-9_-]{22,}/ },
  { id: 'stripe-key', pattern: /[sr]k_live_[a-zA-Z0-9]{24,}/ },
  { id: 'twilio-api-key', pattern: /SK[a-f0-9]{32}/ },
  { id: 'mailgun-api-key', pattern: /key-[a-f0-9]{32}/ },
  { id: 'telegram-bot-token', pattern: /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/ },
];

// Skip base64 matches that look like code identifiers or file paths
function looksLikeCode(s: string): boolean {
  let lowerCount = 0;
  for (const c of s) {
    if (c >= 'a' && c <= 'z') lowerCount++;
  }
  const lowerPct = lowerCount / s.length;
  // camelCase/PascalCase: 5+ lowercase then uppercase, AND predominantly lowercase (>75%)
  // Real secrets have more balanced character distribution (~40-50% lowercase)
  if (/[a-z]{5,}[A-Z]/.test(s) && lowerPct > 0.75) return true;
  // File path: slash followed by 3+ lowercase (real path segment, not random base64 like /v)
  if (/\/[a-z]{3,}/.test(s)) return true;
  return false;
}

function maskSnippet(text: string, pos: number, len: number): string {
  const start = Math.max(0, pos - 20);
  const end = Math.min(text.length, pos + len + 20);
  const before = text.slice(start, pos);
  const after = text.slice(pos + len, end);
  return `${start > 0 ? '...' : ''}${before}***${after}${end < text.length ? '...' : ''}`;
}

export function detectSecrets(text: string): SecretDetection | null {
  // Layer 1: known prefixes
  for (const rule of PREFIX_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      return {
        rule: rule.id,
        position: match.index,
        snippet: maskSnippet(text, match.index, match[0].length),
      };
    }
  }

  // Layer 2: long high-entropy strings
  let m: RegExpExecArray | null;

  // Hex: 32+ contiguous hex chars (checked before base64 since hex is a subset of base64 charset)
  const hexRe = /[a-fA-F0-9]{32,}/g;
  while ((m = hexRe.exec(text)) !== null) {
    if (shannonEntropy(m[0]) > 3.0) {
      return {
        rule: 'high-entropy-hex',
        position: m.index,
        snippet: maskSnippet(text, m.index, m[0].length),
      };
    }
  }

  // Base64: 17+ chars of [A-Za-z0-9+/] with optional = padding
  // Skip matches that look like code identifiers (camelCase) or file paths
  const base64Re = /[A-Za-z0-9+/]{17,}={0,2}/g;
  while ((m = base64Re.exec(text)) !== null) {
    if (looksLikeCode(m[0])) continue;
    if (shannonEntropy(m[0]) > 3.0) {
      return {
        rule: 'high-entropy-base64',
        position: m.index,
        snippet: maskSnippet(text, m.index, m[0].length),
      };
    }
  }

  // Layer 3: entropy + keyword proximity (word-boundary matching)
  const candidateRe = /[a-zA-Z0-9_+/=-]{9,}/g;
  while ((m = candidateRe.exec(text)) !== null) {
    if (shannonEntropy(m[0]) < MIN_ENTROPY) continue;
    const windowStart = Math.max(0, m.index - PROXIMITY);
    const windowEnd = Math.min(text.length, m.index + m[0].length + PROXIMITY);
    const window = text.slice(windowStart, windowEnd);
    for (const kwRe of KEYWORD_PATTERNS) {
      if (kwRe.test(window)) {
        return {
          rule: 'keyword-proximity',
          position: m.index,
          snippet: maskSnippet(text, m.index, m[0].length),
        };
      }
    }
  }

  return null;
}
