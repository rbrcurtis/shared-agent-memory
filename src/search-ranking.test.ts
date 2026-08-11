import { describe, expect, it } from 'vitest';
import { relevanceMultiplier } from './search-ranking.js';
import type { SearchResult } from './types.js';

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: 'memory-id',
    score: 0.5,
    text: '',
    title: '',
    agent: 'local-dev',
    project: 'other',
    tags: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('relevanceMultiplier', () => {
  it('prefers project, identifier, and broad query matches over generic terms', () => {
    const query = 'Accordyx production database query users event access level big-berks-2027';
    const useful = result({
      project: 'accordyx',
      title: 'Big Berks prod role assignments',
      tags: ['production', 'events', 'users'],
      text: 'Event big-berks-2027 access roles and user setup.',
    });
    const generic = result({
      project: 'okkanti',
      title: 'Production database access',
      text: 'Query users in the production database.',
    });

    expect(relevanceMultiplier(query, useful)).toBeGreaterThan(
      relevanceMultiplier(query, generic),
    );
  });

  it('does not treat a project name inside another word as a project match', () => {
    const query = 'accordyx event access';
    const exact = result({ project: 'accordyx' });
    const partial = result({ project: 'accordyx-archive' });

    expect(relevanceMultiplier(query, exact)).toBeGreaterThan(
      relevanceMultiplier(query, partial),
    );
  });
});
