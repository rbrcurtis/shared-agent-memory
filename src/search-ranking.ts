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

export function relevanceBonus(query: string, result: SearchResult): number {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return 0;

  const project = normalize(result.project ?? '');
  const title = normalize(result.title ?? '');
  const tags = normalize((result.tags ?? []).join(' '));
  const text = normalize(result.text ?? '');

  const projectBonus = queryTerms.includes(project) ? 0.3 : 0;
  const coverage = queryTerms.reduce((total, term) => {
    if (title.includes(term) || tags.includes(term)) return total + 1;
    if (project.includes(term)) return total + 0.75;
    if (text.includes(term)) return total + 0.25;
    return total;
  }, 0) / queryTerms.length;
  const coverageBonus = Math.min(coverage * 0.4, 0.4);
  const identifierMatches = identifiers(query).filter(identifier =>
    title.includes(identifier)
    || tags.includes(identifier)
    || text.includes(identifier),
  ).length;
  const identifierBonus = Math.min(identifierMatches * 0.05, 0.1);

  return projectBonus + coverageBonus + identifierBonus;
}
