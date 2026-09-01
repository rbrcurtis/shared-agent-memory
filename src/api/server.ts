import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { StorageService } from "../storage.js";
import { EmbeddingService } from "../embeddings.js";
import { ServerConfig } from "../types.js";
import { parseApiKeys, buildAuthHook } from "./middleware/auth.js";
import { memoryRoutes } from "./routes/memories.js";
import { configRoutes } from "./routes/config.js";
import type {
  FastifyError,
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";

export interface AppConfig {
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName: string;
  apiKeysJson: string;
  port: number;
}

function log(msg: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${msg}`);
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  // Fastify's pino logger emits one line per request with method, path,
  // status, and duration — the visibility that was missing when 500s happened.
  // Disabled under vitest (NODE_ENV=test) so test output stays quiet.
  const app = Fastify({ logger: process.env["NODE_ENV"] === "test" ? false : true });

  // Register Swagger (OpenAPI spec)
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Shared Memory API",
        description: "REST API for shared AI agent memory backed by Qdrant",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
          },
        },
      },
    },
  });

  // Register Swagger UI
  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  // Register CORS
  await app.register(cors);

  // Parse API keys
  const apiKeys = parseApiKeys(config.apiKeysJson);
  const authHook = buildAuthHook(apiKeys);

  // Global auth hook — skip /health and /docs*
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path === "/health" || path.startsWith("/docs")) {
      return;
    }
    await authHook(request, reply);
    if (reply.statusCode === 401) {
      request.log.warn(`Auth rejected: ${request.method} ${path} from ${request.ip}`);
    }
  });

  // Global error handler. Previously errors were returned to the client but
  // never logged, so outages (e.g. Qdrant unreachable surfacing as
  // "fetch failed") were invisible in k8s logs. Log 5xx with stack and the
  // underlying fetch cause; log 4xx with the reason only.
  app.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      const code = error.statusCode ?? 500;
      const message = error.message || "Internal server error";
      if (code >= 500) {
        const cause =
          error.cause instanceof Error
            ? `${error.cause.name}: ${error.cause.message}`
            : error.cause !== undefined
              ? String(error.cause)
              : undefined;
        request.log.error(
          { err: error, cause },
          `${request.method} ${request.url} failed with ${code}: ${message}`,
        );
      } else {
        request.log.warn(
          `${request.method} ${request.url} rejected with ${code}: ${message}`,
        );
      }
      reply.code(code).send({ error: { code, message } });
    },
  );

  // Initialize services
  const serverConfig: ServerConfig = {
    qdrantUrl: config.qdrantUrl,
    qdrantApiKey: config.qdrantApiKey,
    collectionName: config.collectionName,
    defaultAgent: "unknown",
    defaultProject: "default",
  };

  const storage = new StorageService(serverConfig);
  await storage.initialize();

  const embeddings = EmbeddingService.getInstance();
  log("Loading embedding model...");
  await embeddings.initialize();
  const modelReady = true;
  log("Embedding model ready");

  // Register routes
  await configRoutes(app, {
    collectionName: config.collectionName,
    isModelReady: () => modelReady,
  });

  await memoryRoutes(app, { storage, embeddings, log });

  return app;
}

export async function startServer(): Promise<void> {
  const qdrantUrl = process.env["QDRANT_URL"];
  const qdrantApiKey = process.env["QDRANT_API_KEY"];
  const collectionName =
    process.env["COLLECTION_NAME"] ?? "shared_agent_memory";
  const apiKeysJson = process.env["API_KEYS"] ?? "";
  const port = parseInt(process.env["PORT"] ?? "3100", 10);

  if (!qdrantUrl) {
    console.error("QDRANT_URL environment variable is required");
    process.exit(1);
  }

  if (!apiKeysJson) {
    log(
      "WARNING: API_KEYS is empty — all authenticated routes will reject requests",
    );
  }

  const config: AppConfig = {
    qdrantUrl,
    qdrantApiKey,
    collectionName,
    apiKeysJson: apiKeysJson || "[]",
    port,
  };

  const app = await buildApp(config);
  await app.listen({ host: "0.0.0.0", port });

  log(`Server listening on 0.0.0.0:${port}`);
  log(`Swagger UI: http://localhost:${port}/docs`);
  log(`Qdrant: ${qdrantUrl}`);
  log(`Collection: ${collectionName}`);
}

const isMain =
  process.argv[1]?.endsWith("api/server.js") ||
  process.argv[1]?.endsWith("api/server.ts");

if (isMain) {
  startServer().catch((err: unknown) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
