import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteMemory,
  getConfig,
  loadMemories,
  searchMemory,
  storeMemory,
  updateMemory,
} from "./client.js";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

const originalEnv = { ...process.env };
let calls: FetchCall[];

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  process.env = {
    ...originalEnv,
    MEMORY_API_URL: "http://memory.example.test/",
    MEMORY_API_KEY: "test-api-key",
  };

  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      calls.push({ url, init });

      if (url.endsWith("/api/v1/config")) {
        return jsonResponse({
          data: { collectionName: "shared_agent_memory", modelReady: true },
        });
      }

      if (url.includes("/api/v1/memories/search")) {
        return jsonResponse({
          data: [
            {
              id: "mem-1",
              title: "Memory One",
              project: "project-a",
              score: 0.9,
            },
          ],
        });
      }

      if (url.includes("/api/v1/memories/load")) {
        return jsonResponse({
          data: [
            {
              id: "mem-1",
              title: "Memory One",
              project: "project-a",
              score: 1,
            },
          ],
        });
      }

      if (url.includes("/api/v1/memories/recent")) {
        return jsonResponse({
          data: [
            {
              id: "mem-1",
              title: "Memory One",
              project: "project-a",
              created_at: "2026-05-01T00:00:00.000Z",
            },
          ],
        });
      }

      if (init?.method === "POST") {
        return jsonResponse({ data: { id: "stored-id" } }, { status: 201 });
      }

      if (init?.method === "PUT" || init?.method === "DELETE") {
        return jsonResponse({ data: { success: true } });
      }

      return jsonResponse(
        { error: { message: "unexpected request" } },
        { status: 500 },
      );
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = originalEnv;
});

describe("memory API client", () => {
  it("stores memories through the REST API with caller-provided project", async () => {
    const result = await storeMemory({
      title: "Stored",
      text: "Stored text",
      agent: "codex",
      project: "current-project",
      tags: ["tag-a"],
    });

    expect(result.id).toBe("stored-id");
    expect(calls[0].url).toBe("http://memory.example.test/api/v1/memories");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer test-api-key",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      title: "Stored",
      text: "Stored text",
      agent: "codex",
      project: "current-project",
      tags: ["tag-a"],
    });
  });

  it("omits project from search query when no filter is provided", async () => {
    const result = await searchMemory({ query: "needle", limit: 5 });

    expect(result.results).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/v1/memories/search");
    expect(url.searchParams.get("query")).toBe("needle");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.has("project")).toBe(false);
  });

  it("passes project filter through when search specifies one", async () => {
    await searchMemory({
      query: "needle",
      project: "project-a",
      tags: ["one", "two"],
    });

    const url = new URL(calls[0].url);
    expect(url.searchParams.get("project")).toBe("project-a");
    expect(url.searchParams.get("tags")).toBe("one,two");
  });

  it("loads memories without sending a project query", async () => {
    await loadMemories(["mem-1", "mem-2"]);

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/v1/memories/load");
    expect(url.searchParams.get("ids")).toBe("mem-1,mem-2");
    expect(url.searchParams.has("project")).toBe(false);
  });

  it("updates memories by id without changing project", async () => {
    await updateMemory({ id: "mem-1", title: "Updated", text: "Updated text" });

    expect(calls[0].url).toBe(
      "http://memory.example.test/api/v1/memories/mem-1",
    );
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      title: "Updated",
      text: "Updated text",
    });
  });

  it("deletes memories by id through the REST API", async () => {
    await deleteMemory("mem-1");

    expect(calls[0].url).toBe(
      "http://memory.example.test/api/v1/memories/mem-1",
    );
    expect(calls[0].init?.method).toBe("DELETE");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer test-api-key",
    });
    expect(calls[0].init?.headers).not.toHaveProperty("Content-Type");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("reports API config with resolved API base URL", async () => {
    const config = await getConfig();

    expect(config.apiBaseUrl).toBe("http://memory.example.test");
    expect(config.collectionName).toBe("shared_agent_memory");
    expect(config).not.toHaveProperty("qdrantUrl");
  });
});
