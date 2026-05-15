import type { FastifyInstance } from "fastify";
import { healthResponse, configResponse } from "../schemas/memory.js";

export interface ConfigRouteDeps {
  collectionName: string;
  isModelReady: () => boolean;
}

export async function configRoutes(
  app: FastifyInstance,
  deps: ConfigRouteDeps,
): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Liveness/readiness probe",
        response: {
          200: healthResponse,
          503: healthResponse,
        },
      },
    },
    async (_request, reply) => {
      const modelReady = deps.isModelReady();
      if (modelReady) {
        return reply.code(200).send({ status: "ok", modelReady: true });
      }
      return reply.code(503).send({ status: "starting", modelReady: false });
    },
  );

  app.get(
    "/api/v1/config",
    {
      schema: {
        tags: ["config"],
        summary: "Server configuration and status",
        security: [{ bearerAuth: [] }],
        response: {
          200: configResponse,
        },
      },
    },
    async (_request, reply) => {
      return reply.code(200).send({
        data: {
          collectionName: deps.collectionName,
          modelReady: deps.isModelReady(),
        },
      });
    },
  );
}
