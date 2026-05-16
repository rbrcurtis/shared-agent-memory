import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMORY_CAPTURE_PROMPT,
  buildHookResult,
  countAssistantTurns,
  parseHookInput,
} from "./memory-turn-hook.js";

let tempDir = "";
let originalPluginData: string | undefined;
let originalCodexPluginData: string | undefined;
let originalCursorPluginData: string | undefined;

function writeTranscript(roles: string[]): string {
  const file = path.join(tempDir, "transcript.jsonl");
  const lines = roles.map((role, i) =>
    JSON.stringify({ type: role, message: { role }, uuid: `msg-${i}` }),
  );
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-memory-hook-"));
  originalPluginData = process.env["CLAUDE_PLUGIN_DATA"];
  originalCodexPluginData = process.env["PLUGIN_DATA"];
  originalCursorPluginData = process.env["CURSOR_PLUGIN_DATA"];
  process.env["CLAUDE_PLUGIN_DATA"] = path.join(tempDir, "state");
  delete process.env["PLUGIN_DATA"];
  delete process.env["CURSOR_PLUGIN_DATA"];
});

afterEach(() => {
  if (originalPluginData === undefined) {
    delete process.env["CLAUDE_PLUGIN_DATA"];
  } else {
    process.env["CLAUDE_PLUGIN_DATA"] = originalPluginData;
  }
  if (originalCodexPluginData === undefined) {
    delete process.env["PLUGIN_DATA"];
  } else {
    process.env["PLUGIN_DATA"] = originalCodexPluginData;
  }
  if (originalCursorPluginData === undefined) {
    delete process.env["CURSOR_PLUGIN_DATA"];
  } else {
    process.env["CURSOR_PLUGIN_DATA"] = originalCursorPluginData;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("memory turn hook", () => {
  it("parses Claude hook input defensively", () => {
    expect(parseHookInput("not json")).toEqual({});
    expect(
      parseHookInput(
        JSON.stringify({
          session_id: "session-1",
          transcript_path: "/tmp/transcript.jsonl",
          ignored: true,
        }),
      ),
    ).toEqual({
      session_id: "session-1",
      transcript_path: "/tmp/transcript.jsonl",
    });
  });

  it("counts assistant turns from transcript JSONL", () => {
    const transcript = writeTranscript([
      "user",
      "assistant",
      "assistant",
      "tool",
    ]);

    expect(countAssistantTurns(transcript)).toBe(2);
  });

  it("emits the memory capture prompt every fifth assistant turn", () => {
    const transcript = writeTranscript([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    const result = buildHookResult({
      session_id: "session-1",
      transcript_path: transcript,
    });

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
      systemMessage: MEMORY_CAPTURE_PROMPT,
    });
  });

  it("does not emit twice for the same fifth turn", () => {
    const transcript = writeTranscript([
      "assistant",
      "assistant",
      "assistant",
      "assistant",
      "assistant",
    ]);
    const input = { session_id: "session-1", transcript_path: transcript };

    expect(buildHookResult(input)).not.toBeNull();
    expect(buildHookResult(input)).toBeNull();
  });

  it("falls back to session state when no transcript is available", () => {
    const input = { session_id: "session-1" };

    expect(buildHookResult(input)).toBeNull();
    expect(buildHookResult(input)).toBeNull();
    expect(buildHookResult(input)).toBeNull();
    expect(buildHookResult(input)).toBeNull();
    expect(buildHookResult(input)?.systemMessage).toBe(MEMORY_CAPTURE_PROMPT);
  });

  it("uses Codex plugin data for fallback state", () => {
    delete process.env["CLAUDE_PLUGIN_DATA"];
    process.env["PLUGIN_DATA"] = path.join(tempDir, "codex-state");

    const input = { session_id: "codex-session" };

    expect(buildHookResult(input)).toBeNull();
    expect(
      fs.existsSync(path.join(tempDir, "codex-state", "codex-session.json")),
    ).toBe(true);
  });

  it("uses Cursor plugin data for fallback state", () => {
    delete process.env["CLAUDE_PLUGIN_DATA"];
    process.env["CURSOR_PLUGIN_DATA"] = path.join(tempDir, "cursor-state");

    const input = { session_id: "cursor-session" };

    expect(buildHookResult(input)).toBeNull();
    expect(
      fs.existsSync(path.join(tempDir, "cursor-state", "cursor-session.json")),
    ).toBe(true);
  });
});
