import { describe, expect, it } from 'vitest';
import { relevanceBonus } from './search-ranking.js';
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

describe('relevanceBonus', () => {
  it('prefers project and role intent over a generic exact slug match', () => {
    const query = 'Accordyx user access level big-berks-2027 event roles';
    const permissions = result({
      project: 'accordyx',
      title: 'Rubric and track roles permissions matrix',
      tags: ['big-berks-2027', 'permissions', 'roles', 'track-chairs'],
      text: 'Event access for owners, admins, chairs, and committee members.',
    });
    const slugError = result({
      project: 'accordyx',
      title: 'Malformed event slug causes ES 400',
      text: 'The big-berks-2027 event slug caused an Elasticsearch error.',
    });

    expect(relevanceBonus(query, permissions)).toBeGreaterThan(
      relevanceBonus(query, slugError),
    );
  });

  it('weights title and tag coverage above body-only coverage', () => {
    const query = 'event roles permissions';
    const metadataMatch = result({ title: 'Event roles', tags: ['permissions'] });
    const bodyMatch = result({ text: 'Event roles and permissions.' });

    expect(relevanceBonus(query, metadataMatch)).toBeGreaterThan(
      relevanceBonus(query, bodyMatch),
    );
  });

  it('does not treat a project name inside another word as a project match', () => {
    const query = 'accordyx event access';
    const exact = result({ project: 'accordyx' });
    const partial = result({ project: 'accordyx-archive' });

    expect(relevanceBonus(query, exact)).toBeGreaterThan(
      relevanceBonus(query, partial),
    );
  });
});
