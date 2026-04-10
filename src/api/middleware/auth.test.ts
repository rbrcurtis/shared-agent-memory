import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  parseApiKeys,
  validateKey,
  checkProjectAccess,
  resolveProject,
  buildAuthHook,
  type ApiKeyConfig,
} from './auth.js';

// --- parseApiKeys ---

describe('parseApiKeys', () => {
  it('parses valid JSON array with a single full-access key', () => {
    const input = JSON.stringify([{ key: 'abc123', name: 'admin', projects: null }]);
    const result = parseApiKeys(input);
    expect(result).toEqual([{ key: 'abc123', name: 'admin', projects: null }]);
  });

  it('parses restricted key with projects array', () => {
    const input = JSON.stringify([{ key: 'xyz789', name: 'reader', projects: ['proj-a', 'proj-b'] }]);
    const result = parseApiKeys(input);
    expect(result).toEqual([{ key: 'xyz789', name: 'reader', projects: ['proj-a', 'proj-b'] }]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseApiKeys('not-json')).toThrow();
  });

  it('throws on non-array JSON', () => {
    expect(() => parseApiKeys(JSON.stringify({ key: 'x', name: 'y', projects: null }))).toThrow();
  });

  it('throws on missing required field: key', () => {
    const input = JSON.stringify([{ name: 'admin', projects: null }]);
    expect(() => parseApiKeys(input)).toThrow();
  });

  it('throws on missing required field: name', () => {
    const input = JSON.stringify([{ key: 'abc123', projects: null }]);
    expect(() => parseApiKeys(input)).toThrow();
  });

  it('throws on empty array', () => {
    expect(() => parseApiKeys('[]')).toThrow('API_KEYS array must not be empty');
  });

  it('throws on empty key string', () => {
    const input = JSON.stringify([{ key: '', name: 'admin', projects: null }]);
    expect(() => parseApiKeys(input)).toThrow(/"key"/);
  });

  it('throws on empty name string', () => {
    const input = JSON.stringify([{ key: 'abc123', name: '', projects: null }]);
    expect(() => parseApiKeys(input)).toThrow(/"name"/);
  });
});

// --- validateKey ---

describe('validateKey', () => {
  const keys: ApiKeyConfig[] = [
    { key: 'secret-key-1', name: 'admin', projects: null },
    { key: 'secret-key-2', name: 'reader', projects: ['proj-a'] },
  ];

  it('returns the matching config for a valid key', () => {
    const result = validateKey('secret-key-1', keys);
    expect(result).toEqual(keys[0]);
  });

  it('returns the second key config for a valid second key', () => {
    const result = validateKey('secret-key-2', keys);
    expect(result).toEqual(keys[1]);
  });

  it('returns null for an invalid key', () => {
    const result = validateKey('wrong-key', keys);
    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    const result = validateKey('', keys);
    expect(result).toBeNull();
  });
});

// --- checkProjectAccess ---

describe('checkProjectAccess', () => {
  const fullAccess: ApiKeyConfig = { key: 'k1', name: 'admin', projects: null };
  const restricted: ApiKeyConfig = { key: 'k2', name: 'reader', projects: ['proj-a', 'proj-b'] };

  it('full-access key allows any project', () => {
    expect(checkProjectAccess(fullAccess, 'any-project')).toBe(true);
    expect(checkProjectAccess(fullAccess, 'another-project')).toBe(true);
  });

  it('restricted key allows a listed project', () => {
    expect(checkProjectAccess(restricted, 'proj-a')).toBe(true);
  });

  it('restricted key rejects an unlisted project', () => {
    expect(checkProjectAccess(restricted, 'proj-c')).toBe(false);
  });

  it("restricted key allows wildcard '*'", () => {
    expect(checkProjectAccess(restricted, '*')).toBe(true);
  });

  it("full-access key allows wildcard '*'", () => {
    expect(checkProjectAccess(fullAccess, '*')).toBe(true);
  });
});

// --- resolveProject ---

describe('resolveProject', () => {
  const fullAccess: ApiKeyConfig = { key: 'k1', name: 'admin', projects: null };
  const restricted: ApiKeyConfig = { key: 'k2', name: 'reader', projects: ['proj-a', 'proj-b'] };

  it("returns undefined for '*' with a full-access key", () => {
    expect(resolveProject(fullAccess, '*')).toBeUndefined();
  });

  it("returns the key's project list for '*' with a restricted key", () => {
    expect(resolveProject(restricted, '*')).toEqual(['proj-a', 'proj-b']);
  });

  it('returns the specific project string for a named project', () => {
    expect(resolveProject(fullAccess, 'proj-x')).toBe('proj-x');
    expect(resolveProject(restricted, 'proj-a')).toBe('proj-a');
  });
});

// --- buildAuthHook ---

describe('buildAuthHook', () => {
  const keys: ApiKeyConfig[] = [
    { key: 'valid-key', name: 'admin', projects: null },
  ];

  function makeReply() {
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };
    return reply as unknown as FastifyReply;
  }

  it('attaches apiKey to request for valid Bearer token', async () => {
    const hook = buildAuthHook(keys);
    const request = {
      headers: { authorization: 'Bearer valid-key' },
    } as unknown as FastifyRequest;
    const reply = makeReply();

    await hook(request, reply);

    expect((request as FastifyRequest & { apiKey: ApiKeyConfig }).apiKey).toEqual(keys[0]);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid Bearer token', async () => {
    const hook = buildAuthHook(keys);
    const request = {
      headers: { authorization: 'Bearer bad-key' },
    } as unknown as FastifyRequest;
    const reply = makeReply();

    await hook(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });

  it('returns 401 when Authorization header is missing', async () => {
    const hook = buildAuthHook(keys);
    const request = {
      headers: {},
    } as unknown as FastifyRequest;
    const reply = makeReply();

    await hook(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const hook = buildAuthHook(keys);
    const request = {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    } as unknown as FastifyRequest;
    const reply = makeReply();

    await hook(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
  });
});
