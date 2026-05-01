import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StorageService } from '../../storage.js';
import { EmbeddingService } from '../../embeddings.js';
import { detectSecrets } from '../../secret-filter.js';
import { computeRetention, OVER_FETCH_MULTIPLIER, TOMBSTONE_THRESHOLD } from '../../retention.js';
import { checkProjectAccess, resolveProject } from '../middleware/auth.js';
import type { ApiKeyConfig } from '../middleware/auth.js';
import type { SearchResult } from '../../types.js';
import { extractEntities } from '../../entity-extraction.js';
import {
  storeMemoryBody,
  storeMemoryResponse,
  searchQuerystring,
  searchResponse,
  loadQuerystring,
  loadResponse,
  recentQuerystring,
  recentResponse,
  updateMemoryBody,
  memoryIdParams,
  successResponse,
  errorResponse,
} from '../schemas/memory.js';

export interface MemoryRouteDeps {
  storage: StorageService;
  embeddings: EmbeddingService;
  log: (msg: string) => void;
}

function sendError(reply: FastifyReply, code: number, message: string): void {
  reply.code(code).send({ error: { code, message } });
}

export async function memoryRoutes(app: FastifyInstance, deps: MemoryRouteDeps): Promise<void> {
  const { storage, embeddings, log } = deps;

  // POST /api/v1/memories — Store a memory
  app.post('/api/v1/memories', {
    schema: {
      tags: ['memories'],
      summary: 'Store a new memory',
      security: [{ bearerAuth: [] }],
      body: storeMemoryBody,
      response: {
        201: storeMemoryResponse,
        400: errorResponse,
        403: errorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{
      Body: {
        text: string;
        title: string;
        agent?: string;
        project: string;
        tags?: string[];
      };
    }>,
    reply: FastifyReply,
  ) => {
    const key: ApiKeyConfig = request.apiKey;
    const { text, title, agent, project, tags } = request.body;

    if (!checkProjectAccess(key, project)) {
      return sendError(reply, 403, 'Access denied for project');
    }

    if (project === '*') {
      return sendError(reply, 400, 'project must be a specific name, not *');
    }

    const secretInText = detectSecrets(text);
    if (secretInText) {
      return sendError(reply, 400, `Secret detected in text: ${secretInText.rule}`);
    }

    const secretInTitle = detectSecrets(title);
    if (secretInTitle) {
      return sendError(reply, 400, `Secret detected in title: ${secretInTitle.rule}`);
    }

    const resolved = resolveProject(key, project);
    // resolved will be a string (since project !== '*')
    const resolvedProject = resolved as string;

    const vector = await embeddings.generateEmbedding(text);
    const userTags = tags || [];
    const id = await storage.store({
      text,
      title,
      vector,
      agent: agent || 'unknown',
      project: resolvedProject,
      tags: userTags,
    });

    // Fire-and-forget: extract entities and merge into tags
    extractEntities(text).then(entityTags => {
      if (entityTags.length > 0) {
        const merged = [...new Set([...userTags, ...entityTags])];
        storage.setPayload(id, { tags: merged }).catch((err: unknown) => {
          log(`Failed to set entity tags for ${id}: ${err}`);
        });
      }
    }).catch((err: unknown) => {
      log(`Entity extraction failed for ${id}: ${err}`);
    });

    return reply.code(201).send({ data: { id } });
  });

  // GET /api/v1/memories/search — Search with retention pipeline
  app.get('/api/v1/memories/search', {
    schema: {
      tags: ['memories'],
      summary: 'Search memories with retention-based re-ranking',
      security: [{ bearerAuth: [] }],
      querystring: searchQuerystring,
      response: {
        200: searchResponse,
        400: errorResponse,
        403: errorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{
      Querystring: {
        query: string;
        limit?: number;
        agent?: string;
        project?: string;
        tags?: string;
      };
    }>,
    reply: FastifyReply,
  ) => {
    const key: ApiKeyConfig = request.apiKey;
    const { query, limit = 10, agent, tags } = request.query;
    const project = request.query.project || '*';

    if (!checkProjectAccess(key, project)) {
      return sendError(reply, 403, 'Access denied for project');
    }

    const resolved = resolveProject(key, project);
    const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined;

    const vector = await embeddings.generateEmbedding(query);
    const fetchLimit = limit * OVER_FETCH_MULTIPLIER;

    let rawResults: SearchResult[];

    if (Array.isArray(resolved)) {
      // Restricted key with '*' — search each project and merge
      const allResults: SearchResult[] = [];
      for (const proj of resolved) {
        const results = await storage.search({
          vector,
          queryText: query,
          limit: fetchLimit,
          agent,
          project: proj,
          tags: parsedTags,
        });
        allResults.push(...results);
      }
      rawResults = allResults;
    } else {
      rawResults = await storage.search({
        vector,
        queryText: query,
        limit: fetchLimit,
        agent,
        project: resolved,
        tags: parsedTags,
      });
    }

    const now = Date.now();
    const toTombstone: string[] = [];
    const scored: Array<SearchResult & { adjustedScore: number }> = [];

    for (const r of rawResults) {
      const lastAccessed = r.last_accessed || r.created_at;
      const daysSince = (now - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
      const stability = r.stability ?? 1.0;
      const retention = computeRetention(daysSince, stability);

      if (retention < TOMBSTONE_THRESHOLD) {
        toTombstone.push(r.id);
      } else {
        scored.push({ ...r, adjustedScore: r.score * retention });
      }
    }

    scored.sort((a, b) => b.adjustedScore - a.adjustedScore);

    // Second-pass: find related memories via shared entity tags
    const firstPassIds = new Set(rawResults.map(r => r.id));
    const entityTags = new Set<string>();
    for (const r of scored) {
      for (const tag of (r.tags || [])) {
        entityTags.add(tag);
      }
    }

    if (entityTags.size > 0) {
      try {
        let secondPass: SearchResult[];
        if (Array.isArray(resolved)) {
          secondPass = [];
          for (const proj of resolved) {
            const results = await storage.searchByTags({
              tags: [...entityTags],
              excludeIds: [...firstPassIds],
              limit,
              project: proj,
            });
            secondPass.push(...results);
          }
        } else {
          secondPass = await storage.searchByTags({
            tags: [...entityTags],
            excludeIds: [...firstPassIds],
            limit,
            project: resolved,
          });
        }

        const minScore = scored.length > 0
          ? scored[scored.length - 1].adjustedScore
          : 0.01;

        for (const r of secondPass) {
          const lastAccessed = r.last_accessed || r.created_at;
          const daysSince = (now - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
          const stability = r.stability ?? 1.0;
          const retention = computeRetention(daysSince, stability);

          if (retention < TOMBSTONE_THRESHOLD) {
            toTombstone.push(r.id);
          } else {
            scored.push({ ...r, adjustedScore: minScore * retention * 0.9 });
          }
        }

        scored.sort((a, b) => b.adjustedScore - a.adjustedScore);
      } catch (err: unknown) {
        log(`Second-pass tag search failed: ${err}`);
      }
    }

    const final = scored.slice(0, limit);

    if (toTombstone.length > 0) {
      storage.tombstoneMemories(toTombstone).catch((err: unknown) => {
        log(`Failed to tombstone memories: ${err}`);
      });
    }

    return reply.code(200).send({
      data: final.map(r => ({
        id: r.id,
        title: r.title,
        project: r.project,
        score: r.adjustedScore,
      })),
    });
  });

  // GET /api/v1/memories/load — Load with reinforcement
  app.get('/api/v1/memories/load', {
    schema: {
      tags: ['memories'],
      summary: 'Load memories by ID and reinforce access',
      security: [{ bearerAuth: [] }],
      querystring: loadQuerystring,
      response: {
        200: loadResponse,
        403: errorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{
      Querystring: {
        ids: string;
        project?: string;
      };
    }>,
    reply: FastifyReply,
  ) => {
    const key: ApiKeyConfig = request.apiKey;
    const { ids: idsParam } = request.query;

    const ids = idsParam.split(',').map(id => id.trim()).filter(Boolean);
    const results = await storage.getByIds(ids);

    const filtered = results.filter(r => checkProjectAccess(key, r.project));

    if (filtered.length > 0) {
      storage.reinforceMemories(
        filtered.map(r => ({ id: r.id, accessCount: r.access_count ?? 0 })),
      ).catch((err: unknown) => {
        log(`Failed to reinforce memories: ${err}`);
      });
    }

    return reply.code(200).send({
      data: filtered.map(r => ({
        id: r.id,
        title: r.title,
        text: r.text,
        agent: r.agent,
        project: r.project,
        tags: r.tags,
        created_at: r.created_at,
        last_accessed: r.last_accessed,
        access_count: r.access_count,
      })),
    });
  });

  // GET /api/v1/memories/recent — List recent
  app.get('/api/v1/memories/recent', {
    schema: {
      tags: ['memories'],
      summary: 'List recently created memories',
      security: [{ bearerAuth: [] }],
      querystring: recentQuerystring,
      response: {
        200: recentResponse,
        403: errorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{
      Querystring: {
        limit?: number;
        days?: number;
        project?: string;
      };
    }>,
    reply: FastifyReply,
  ) => {
    const key: ApiKeyConfig = request.apiKey;
    const { limit = 10, days = 30 } = request.query;
    const project = request.query.project || '*';

    if (!checkProjectAccess(key, project)) {
      return sendError(reply, 403, 'Access denied for project');
    }

    const resolved = resolveProject(key, project);

    let results: SearchResult[];

    if (Array.isArray(resolved)) {
      // Restricted key with '*' — query each project and merge/sort/truncate
      const allResults: SearchResult[] = [];
      for (const proj of resolved) {
        const r = await storage.listRecent(limit, days, proj);
        allResults.push(...r);
      }
      allResults.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      results = allResults.slice(0, limit);
    } else {
      results = await storage.listRecent(limit, days, resolved);
    }

    return reply.code(200).send({
      data: results.map(r => ({
        id: r.id,
        title: r.title,
        project: r.project,
        created_at: r.created_at,
      })),
    });
  });

  // PUT /api/v1/memories/:id — Update with fetch-then-check
  app.put('/api/v1/memories/:id', {
    schema: {
      tags: ['memories'],
      summary: 'Update an existing memory',
      security: [{ bearerAuth: [] }],
      params: memoryIdParams,
      body: updateMemoryBody,
      response: {
        200: successResponse,
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: { text: string; title?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const key: ApiKeyConfig = request.apiKey;
    const { id } = request.params;
    const { text, title: newTitle } = request.body;

    const existing = await storage.getByIds([id]);
    if (existing.length === 0) {
      return sendError(reply, 404, 'Memory not found');
    }

    const mem = existing[0];

    if (!checkProjectAccess(key, mem.project)) {
      return sendError(reply, 403, 'Access denied for project');
    }

    const title = newTitle !== undefined ? newTitle : mem.title;
    const existingTags = mem.tags || [];

    const secretInText = detectSecrets(text);
    if (secretInText) {
      return sendError(reply, 400, `Secret detected in text: ${secretInText.rule}`);
    }

    const secretInTitle = detectSecrets(title);
    if (secretInTitle) {
      return sendError(reply, 400, `Secret detected in title: ${secretInTitle.rule}`);
    }

    const vector = await embeddings.generateEmbedding(text);
    await storage.update(id, {
      text,
      title,
      vector,
      agent: mem.agent,
      project: mem.project,
      tags: existingTags,
    });

    // Fire-and-forget: re-extract entities and merge into tags
    extractEntities(text).then(entityTags => {
      if (entityTags.length > 0) {
        const merged = [...new Set([...existingTags, ...entityTags])];
        storage.setPayload(id, { tags: merged }).catch((err: unknown) => {
          log(`Failed to set entity tags for ${id}: ${err}`);
        });
      }
    }).catch((err: unknown) => {
      log(`Entity extraction failed for ${id}: ${err}`);
    });

    return reply.code(200).send({ data: { success: true } });
  });

  // DELETE /api/v1/memories/:id — Delete with fetch-then-check
  app.delete('/api/v1/memories/:id', {
    schema: {
      tags: ['memories'],
      summary: 'Delete a memory',
      security: [{ bearerAuth: [] }],
      params: memoryIdParams,
      response: {
        200: successResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply,
  ) => {
    const key: ApiKeyConfig = request.apiKey;
    const { id } = request.params;

    const existing = await storage.getByIds([id]);
    if (existing.length === 0) {
      return sendError(reply, 404, 'Memory not found');
    }

    const mem = existing[0];

    if (!checkProjectAccess(key, mem.project)) {
      return sendError(reply, 403, 'Access denied for project');
    }

    await storage.delete(id);

    return reply.code(200).send({ data: { success: true } });
  });
}
