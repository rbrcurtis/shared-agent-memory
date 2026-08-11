import type { SearchResult } from './types.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'with',
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@._/+-]+/g, ' ').trim();
}

function terms(value: string): string[] {
  return [...new Set(
    normalize(value)
      .split(/\s+/)
      .filter(term => term.length > 1 && !STOP_WORDS.has(term)),
  )];
}

function identifiers(value: string): string[] {
  return terms(value).filter(term =>
    term.includes('@')
    || term.includes('/')
    || term.includes('_')
    || term.includes('.')
    || /[a-z0-9]+-[a-z0-9-]+/.test(term)
    || /\d/.test(term),
  );
}

export function relevanceMultiplier(query: string, result: SearchResult): number {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return 1;

  const project = normalize(result.project);
  const title = normalize(result.title);
  const tags = normalize(result.tags.join(' '));
  const text = normalize(result.text);
  const searchable = `${project} ${title} ${tags} ${text}`;

  const projectMatch = queryTerms.includes(project);
  const matchedTerms = queryTerms.filter(term => searchable.includes(term));
  const coverage = matchedTerms.length / queryTerms.length;
  const identifierMatches = identifiers(query).filter(identifier =>
    searchable.includes(identifier),
  ).length;

  const projectBoost = projectMatch ? 1.5 : 1;
  const coverageBoost = 1 + coverage * 0.75;
  const identifierBoost = 1 + Math.min(identifierMatches, 3) * 0.25;

  return projectBoost * coverageBoost * identifierBoost;
}
