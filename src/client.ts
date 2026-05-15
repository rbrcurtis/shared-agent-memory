const DEFAULT_API_BASE_URL = "http://localhost:3100";

function getApiBaseUrl(): string {
  return (
    process.env.MEMORY_API_BASE_URL ||
    process.env.MEMORY_API_URL ||
    process.env.SHARED_MEMORY_API_URL ||
    DEFAULT_API_BASE_URL
  ).replace(/\/+$/, "");
}

function getApiKey(): string {
  return (
    process.env.MEMORY_API_KEY ||
    process.env.SHARED_MEMORY_API_KEY ||
    process.env.SHARED_MEMORY_API_TOKEN ||
    ""
  );
}

function encodeQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) qs.set(key, value.join(","));
      continue;
    }
    qs.set(key, String(value));
  }
  return qs.toString();
}

async function request<T>(
  method: string,
  path: string,
  options: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("MEMORY_API_KEY or SHARED_MEMORY_API_KEY is required");
  }

  const query = options.query ? encodeQuery(options.query) : "";
  const url = `${getApiBaseUrl()}${path}${query ? `?${query}` : ""}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  const body = options.body ? JSON.stringify(options.body) : undefined;
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const message =
      typeof json?.error?.message === "string"
        ? json.error.message
        : typeof json?.error === "string"
          ? json.error
          : res.statusText;
    throw new Error(`Memory API ${res.status}: ${message}`);
  }

  return json as T;
}

export async function storeMemory(params: {
  text: string;
  title: string;
  agent?: string;
  project: string;
  tags?: string[];
}): Promise<{ id: string }> {
  const result = await request<{ data: { id: string } }>(
    "POST",
    "/api/v1/memories",
    {
      body: params,
    },
  );
  return result.data;
}

export async function searchMemory(params: {
  query: string;
  limit?: number;
  agent?: string;
  project?: string;
  tags?: string[];
}): Promise<{ results: unknown[] }> {
  const result = await request<{ data: unknown[] }>(
    "GET",
    "/api/v1/memories/search",
    {
      query: {
        query: params.query,
        limit: params.limit,
        agent: params.agent,
        project: params.project,
        tags: params.tags,
      },
    },
  );
  return { results: result.data };
}

export async function listRecent(params: {
  limit?: number;
  days?: number;
  project?: string;
}): Promise<{ results: unknown[] }> {
  const result = await request<{ data: unknown[] }>(
    "GET",
    "/api/v1/memories/recent",
    {
      query: params,
    },
  );
  return { results: result.data };
}

export async function updateMemory(params: {
  id: string;
  text: string;
  title?: string;
}): Promise<{ success: boolean }> {
  const result = await request<{ data: { success: boolean } }>(
    "PUT",
    `/api/v1/memories/${params.id}`,
    {
      body: {
        text: params.text,
        title: params.title,
      },
    },
  );
  return result.data;
}

export async function loadMemories(
  ids: string[],
): Promise<{ results: unknown[] }> {
  const result = await request<{ data: unknown[] }>(
    "GET",
    "/api/v1/memories/load",
    {
      query: { ids },
    },
  );
  return { results: result.data };
}

export async function deleteMemory(id: string): Promise<{ success: boolean }> {
  const result = await request<{ data: { success: boolean } }>(
    "DELETE",
    `/api/v1/memories/${id}`,
  );
  return result.data;
}

export async function getConfig(): Promise<{
  apiBaseUrl: string;
  collectionName?: string;
  modelReady?: boolean;
}> {
  const result = await request<{
    data: { collectionName?: string; modelReady?: boolean };
  }>("GET", "/api/v1/config");
  return {
    apiBaseUrl: getApiBaseUrl(),
    collectionName: result.data.collectionName,
    modelReady: result.data.modelReady,
  };
}

export async function ping(): Promise<{ pong: boolean; modelReady: boolean }> {
  const res = await fetch(`${getApiBaseUrl()}/health`);
  const body = (await res.json()) as { modelReady?: boolean };
  return { pong: res.ok, modelReady: Boolean(body.modelReady) };
}
