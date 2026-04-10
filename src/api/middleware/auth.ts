import { createHash, timingSafeEqual } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface ApiKeyConfig {
  key: string;
  name: string;
  projects: string[] | null;
}

// Augment Fastify's FastifyRequest with apiKey
declare module 'fastify' {
  interface FastifyRequest {
    apiKey: ApiKeyConfig;
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Parses the API_KEYS env var JSON string into an array of ApiKeyConfig.
 * Throws on invalid JSON, non-array, or missing required fields.
 */
export function parseApiKeys(envValue: string): ApiKeyConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envValue);
  } catch {
    throw new Error('API_KEYS: invalid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('API_KEYS: must be a JSON array');
  }

  if (parsed.length === 0) {
    throw new Error('API_KEYS array must not be empty');
  }

  return parsed.map((entry: unknown, i: number) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`API_KEYS[${i}]: must be an object`);
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj['key'] !== 'string' || !obj['key']) {
      throw new Error(`API_KEYS[${i}]: "key" must be a non-empty string`);
    }
    if (typeof obj['name'] !== 'string' || !obj['name']) {
      throw new Error(`API_KEYS[${i}]: "name" must be a non-empty string`);
    }
    const projects = obj['projects'];
    if (projects !== null && projects !== undefined) {
      if (
        !Array.isArray(projects) ||
        !(projects as unknown[]).every((p) => typeof p === 'string')
      ) {
        throw new Error(`API_KEYS[${i}]: "projects" must be null or string[]`);
      }
    }
    return {
      key: obj['key'] as string,
      name: obj['name'] as string,
      projects: (projects ?? null) as string[] | null,
    };
  });
}

/**
 * Finds a matching ApiKeyConfig using constant-time comparison.
 * Both the bearer and each stored key are hashed with SHA-256 before comparing.
 * Returns the matching config or null.
 */
export function validateKey(bearer: string, keys: ApiKeyConfig[]): ApiKeyConfig | null {
  if (bearer === '') return null;

  const bearerHash = sha256(bearer);

  for (const config of keys) {
    const keyHash = sha256(config.key);
    if (timingSafeEqual(bearerHash, keyHash)) {
      return config;
    }
  }

  return null;
}

/**
 * Returns true if the key is allowed to access the given project.
 * - projects: null → full access (any project allowed)
 * - project: '*' → always allowed
 * - otherwise → project must be in the key's projects list
 */
export function checkProjectAccess(key: ApiKeyConfig, project: string): boolean {
  if (project === '*') return true;
  if (key.projects === null) return true;
  return key.projects.includes(project);
}

/**
 * Resolves the project parameter for storage queries:
 * - Specific project name → returns that string (exact filter)
 * - '*' with full-access key (projects: null) → returns undefined (no filter)
 * - '*' with restricted key → returns the key's project list as string[]
 *
 * IMPORTANT: Call checkProjectAccess first — this function does not
 * validate that the key has permission for the named project.
 */
export function resolveProject(
  key: ApiKeyConfig,
  project: string,
): string | string[] | undefined {
  if (project === '*') {
    if (key.projects === null) return undefined;
    return key.projects;
  }
  return project;
}

/**
 * Builds a Fastify preHandler hook that validates Bearer tokens.
 * Attaches the matched ApiKeyConfig to request.apiKey on success.
 * Returns 401 for missing/invalid auth.
 */
export function buildAuthHook(
  keys: ApiKeyConfig[],
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      reply.header('WWW-Authenticate', 'Bearer');
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const bearer = auth.slice('Bearer '.length);
    const matched = validateKey(bearer, keys);

    if (matched === null) {
      reply.header('WWW-Authenticate', 'Bearer');
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    request.apiKey = matched;
  };
}
