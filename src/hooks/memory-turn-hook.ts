import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_INTERVAL = 5;

export const MEMORY_CAPTURE_PROMPT = [
  "## Shared Memory Update",
  "",
  "Review the conversation so far and identify learnings worth preserving:",
  "",
  "1. Scan for memorable content:",
  "   - Workflows or processes discovered",
  "   - Troubleshooting steps that worked",
  "   - Codebase patterns or conventions",
  "   - Infrastructure details learned",
  "   - User preferences expressed",
  "   - Technical decisions made and their rationale",
  "",
  "2. Search existing memories for each topic to check for duplicates or outdated info.",
  "",
  "3. For each learning:",
  "   - If no existing memory exists: use store_memory with descriptive text for semantic search",
  "   - If an existing memory is outdated: use update_memory with corrected info",
  "   - If an existing memory is current: skip it",
  "",
  "One concept per memory. Prefer updating existing memories over creating duplicates. Store new memories for new architecture learnings, workflows, troubleshooting, codebase patterns, infrastructure details, and user preferences. Report a brief summary of what you stored or updated.",
].join("\n");

interface HookInput {
  session_id?: string;
  transcript_path?: string;
}

interface HookState {
  count: number;
  lastPromptTurn: number;
}

interface HookResult {
  continue: boolean;
  suppressOutput: boolean;
  systemMessage: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseHookInput(raw: string): HookInput {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return {
      session_id:
        typeof parsed["session_id"] === "string"
          ? parsed["session_id"]
          : undefined,
      transcript_path:
        typeof parsed["transcript_path"] === "string"
          ? parsed["transcript_path"]
          : undefined,
    };
  } catch {
    return {};
  }
}

function stateRoot(): string {
  return (
    process.env["SHARED_AGENT_MEMORY_PLUGIN_DATA"] ??
    process.env["PLUGIN_DATA"] ??
    process.env["CLAUDE_PLUGIN_DATA"] ??
    path.join(os.tmpdir(), "shared-agent-memory-hook-state")
  );
}

function safeStateName(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function statePath(sessionId: string): string {
  return path.join(stateRoot(), `${safeStateName(sessionId)}.json`);
}

function readState(sessionId: string): HookState {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(statePath(sessionId), "utf8"),
    );
    if (!isRecord(parsed)) return { count: 0, lastPromptTurn: 0 };
    return {
      count: typeof parsed["count"] === "number" ? parsed["count"] : 0,
      lastPromptTurn:
        typeof parsed["lastPromptTurn"] === "number"
          ? parsed["lastPromptTurn"]
          : 0,
    };
  } catch {
    return { count: 0, lastPromptTurn: 0 };
  }
}

function writeState(sessionId: string, state: HookState): void {
  fs.mkdirSync(stateRoot(), { recursive: true });
  fs.writeFileSync(statePath(sessionId), `${JSON.stringify(state, null, 2)}\n`);
}

function isAssistantLine(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) return false;
    if (parsed["type"] === "assistant") return true;
    const message = parsed["message"];
    return isRecord(message) && message["role"] === "assistant";
  } catch {
    return false;
  }
}

export function countAssistantTurns(transcriptPath: string): number | null {
  try {
    const text = fs.readFileSync(transcriptPath, "utf8");
    if (text.trim() === "") return 0;
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .filter(isAssistantLine).length;
  } catch {
    return null;
  }
}

function fallbackTurnCount(sessionId: string): {
  turn: number;
  state: HookState;
} {
  const state = readState(sessionId);
  state.count += 1;
  return { turn: state.count, state };
}

export function buildHookResult(
  input: HookInput,
  interval = DEFAULT_INTERVAL,
): HookResult | null {
  const sessionId = input.session_id ?? "unknown-session";
  const state = readState(sessionId);
  const transcriptCount = input.transcript_path
    ? countAssistantTurns(input.transcript_path)
    : null;
  const fallback =
    transcriptCount === null ? fallbackTurnCount(sessionId) : null;
  const turn = transcriptCount ?? fallback?.turn ?? 0;
  const nextState = fallback?.state ?? state;

  if (turn <= 0) {
    writeState(sessionId, nextState);
    return null;
  }

  if (turn % interval !== 0 || nextState.lastPromptTurn === turn) {
    writeState(sessionId, nextState);
    return null;
  }

  nextState.count = Math.max(nextState.count, turn);
  nextState.lastPromptTurn = turn;
  writeState(sessionId, nextState);

  return {
    continue: true,
    suppressOutput: true,
    systemMessage: MEMORY_CAPTURE_PROMPT,
  };
}

export function runMemoryTurnHook(rawInput = fs.readFileSync(0, "utf8")): void {
  const result = buildHookResult(parseHookInput(rawInput));
  if (!result) return;
  process.stdout.write(JSON.stringify(result));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runMemoryTurnHook();
}
