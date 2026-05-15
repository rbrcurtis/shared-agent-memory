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
  process.env["CLAUDE_PLUGIN_DATA"] = path.join(tempDir, "state");
});

afterEach(() => {
  if (originalPluginData === undefined) {
    delete process.env["CLAUDE_PLUGIN_DATA"];
  } else {
    process.env["CLAUDE_PLUGIN_DATA"] = originalPluginData;
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
});
