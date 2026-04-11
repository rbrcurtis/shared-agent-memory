export const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "integer" },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
  },
  required: ["error"],
} as const;

export const storeMemoryBody = {
  type: "object",
  required: ["text", "title", "project"],
  properties: {
    text: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1, description: "max 10 words" },
    agent: { type: "string", default: "unknown" },
    project: { type: "string", description: "required, use * for unscoped" },
    tags: { type: "array", items: { type: "string" }, default: [] },
  },
} as const;

export const storeMemoryResponse = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
      },
      required: ["id"],
    },
  },
  required: ["data"],
} as const;

export const searchQuerystring = {
  type: "object",
  required: ["query", "project"],
  properties: {
    query: { type: "string" },
    limit: { type: "integer", default: 10 },
    agent: { type: "string" },
    project: { type: "string" },
    tags: { type: "string", description: "comma-separated" },
  },
} as const;

export const searchResponse = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          score: { type: "number" },
        },
        required: ["id", "title", "score"],
      },
    },
  },
  required: ["data"],
} as const;

export const loadQuerystring = {
  type: "object",
  required: ["ids", "project"],
  properties: {
    ids: { type: "string", description: "comma-separated UUIDs" },
    project: { type: "string" },
  },
} as const;

export const memoryDetail = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string" },
    text: { type: "string" },
    agent: { type: "string" },
    project: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    created_at: { type: "string", format: "date-time" },
    last_accessed: { type: "string", format: "date-time" },
    access_count: { type: "integer" },
  },
} as const;

export const loadResponse = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: memoryDetail,
    },
  },
  required: ["data"],
} as const;

export const recentQuerystring = {
  type: "object",
  required: ["project"],
  properties: {
    limit: { type: "integer", default: 10 },
    days: { type: "integer", default: 30 },
    project: { type: "string" },
  },
} as const;

export const recentResponse = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          created_at: { type: "string", format: "date-time" },
        },
        required: ["id", "title", "created_at"],
      },
    },
  },
  required: ["data"],
} as const;

export const updateMemoryBody = {
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string", minLength: 1 },
    title: { type: "string", description: "preserves existing if omitted" },
  },
} as const;

export const memoryIdParams = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" },
  },
} as const;

export const successResponse = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        success: { type: "boolean" },
      },
      required: ["success"],
    },
  },
  required: ["data"],
} as const;

export const healthResponse = {
  type: "object",
  properties: {
    status: { type: "string" },
    modelReady: { type: "boolean" },
  },
  required: ["status", "modelReady"],
} as const;

export const configResponse = {
  type: "object",
  properties: {
    data: {
      type: "object",
      properties: {
        qdrantUrl: { type: "string" },
        collectionName: { type: "string" },
        modelReady: { type: "boolean" },
      },
      required: ["qdrantUrl", "collectionName", "modelReady"],
    },
  },
  required: ["data"],
} as const;
