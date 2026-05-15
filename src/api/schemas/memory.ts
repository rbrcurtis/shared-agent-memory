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
    project: { type: "string", description: "required project to store in; use a concrete project name, not *" },
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
  required: ["query"],
  properties: {
    query: { type: "string" },
    limit: { type: "integer", default: 10 },
    agent: { type: "string" },
    project: { type: "string", description: "optional project filter; omit or use * for all accessible projects" },
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
          project: { type: "string" },
          score: { type: "number" },
        },
        required: ["id", "title", "project", "score"],
      },
    },
  },
  required: ["data"],
} as const;

export const loadQuerystring = {
  type: "object",
  required: ["ids"],
  properties: {
    ids: { type: "string", description: "comma-separated UUIDs" },
    project: { type: "string", description: "ignored; access is checked against each loaded memory" },
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
    updated_at: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    createdBy: { type: "string" },
    updatedBy: { type: "string" },
    last_accessed: { type: "string", format: "date-time" },
    access_count: { type: "integer" },
  },
} as const;

export const auditEvent = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    memoryId: { type: "string", format: "uuid" },
    action: { type: "string", enum: ["create", "update", "delete"] },
    actor: { type: "string" },
    project: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    title: { type: "string" },
  },
  required: ["id", "memoryId", "action", "actor", "project", "timestamp"],
} as const;

export const auditResponse = {
  type: "object",
  properties: {
    data: {
      type: "array",
      items: auditEvent,
    },
  },
  required: ["data"],
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
  properties: {
    limit: { type: "integer", default: 10 },
    days: { type: "integer", default: 30 },
    project: { type: "string", description: "optional project filter; omit or use * for all accessible projects" },
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
          project: { type: "string" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          createdBy: { type: "string" },
          updatedBy: { type: "string" },
        },
        required: ["id", "title", "project", "created_at"],
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
