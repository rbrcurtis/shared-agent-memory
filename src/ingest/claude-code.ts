import { readFile } from 'node:fs/promises';
import type { NormalizedTranscript } from './types.js';

const SKIP_PREFIXES = ['<local-command', '<command-name', 'Base directory', '<system-reminder'];

interface TranscriptEntry {
  type?: string;
  text?: unknown;
  name?: unknown;
  is_error?: unknown;
  content?: unknown;
  message?: {
    content?: unknown;
  };
}

interface TranscriptBlock {
  type?: string;
  text?: unknown;
  name?: unknown;
  is_error?: unknown;
  content?: unknown;
}

export async function normalizeClaudeCodeTranscriptFile(file: string): Promise<NormalizedTranscript> {
  return normalizeClaudeCodeTranscript(await readFile(file, 'utf8'));
}

export function normalizeClaudeCodeTranscript(jsonl: string): NormalizedTranscript {
  const linesOut: string[] = [];

  for (const rawLine of jsonl.split('\n')) {
    const raw = rawLine.trim();
    if (!raw) continue;

    const entry = parseEntry(raw);
    if (!entry) continue;

    const entryType = entry.type ?? '';

    if (entryType === 'user' || entryType === 'assistant') {
      appendRoleContent(linesOut, entryType.toUpperCase(), entry.message?.content ?? '');
    } else if (entryType === 'text') {
      appendText(linesOut, 'TEXT', entry.text);
    } else if (entryType === 'tool_use') {
      appendToolUse(linesOut, entry.name);
    } else if (entryType === 'tool_result') {
      appendToolResult(linesOut, entry);
    }
  }

  const text = linesOut.join('\n');

  return {
    text,
    lineCount: linesOut.length,
    charCount: text.length,
  };
}

function parseEntry(raw: string): TranscriptEntry | undefined {
  try {
    return JSON.parse(raw) as TranscriptEntry;
  } catch {
    return undefined;
  }
}

function appendRoleContent(linesOut: string[], role: string, content: unknown): void {
  if (typeof content === 'string') {
    appendText(linesOut, role, content);
    return;
  }

  if (!Array.isArray(content)) return;

  for (const block of content as TranscriptBlock[]) {
    if (block.type === 'text') {
      appendText(linesOut, role, block.text);
    } else if (block.type === 'tool_use') {
      appendToolUse(linesOut, block.name);
    } else if (block.type === 'tool_result') {
      appendToolResult(linesOut, block);
    }
  }
}

function appendText(linesOut: string[], prefix: string, content: unknown): void {
  if (typeof content !== 'string') return;

  const text = content.trim();
  if (!text || shouldSkipText(text)) return;

  linesOut.push(`${prefix}: ${text}`);
}

function appendToolUse(linesOut: string[], name: unknown): void {
  linesOut.push(`TOOL_USE: ${typeof name === 'string' ? name : '?'}`);
}

function appendToolResult(linesOut: string[], block: TranscriptBlock): void {
  if (!block.is_error) return;

  linesOut.push(`TOOL_ERROR: ${stringifyToolResultContent(block.content).trim().slice(0, 500)}`);
}

function stringifyToolResultContent(content: unknown): string {
  if (Array.isArray(content)) {
    return (content as TranscriptBlock[])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join(' ');
  }

  return String(content ?? '');
}

function shouldSkipText(text: string): boolean {
  return SKIP_PREFIXES.some((prefix) => text.startsWith(prefix));
}
