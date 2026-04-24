import { describe, expect, it } from 'vitest';
import { normalizeClaudeCodeTranscript } from './claude-code.js';

describe('normalizeClaudeCodeTranscript', () => {
  it('normalizes text and tool events from Claude Code JSONL', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: 'Find the bug' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I will inspect it.' },
            { type: 'tool_use', name: 'Read' },
            { type: 'tool_result', is_error: false, content: 'file content' },
            { type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'missing file' }] },
          ],
        },
      }),
      JSON.stringify({ type: 'tool_use', name: 'Bash' }),
      JSON.stringify({ type: 'tool_result', is_error: true, content: 'command failed' }),
      JSON.stringify({ type: 'text', text: '<system-reminder>ignored</system-reminder>' }),
      'not json',
    ].join('\n');

    const normalized = normalizeClaudeCodeTranscript(jsonl);

    expect(normalized.text).toBe(
      [
        'USER: Find the bug',
        'ASSISTANT: I will inspect it.',
        'TOOL_USE: Read',
        'TOOL_ERROR: missing file',
        'TOOL_USE: Bash',
        'TOOL_ERROR: command failed',
      ].join('\n'),
    );
    expect(normalized.lineCount).toBe(6);
    expect(normalized.charCount).toBe(normalized.text.length);
  });

  it('skips local command and command-name transcript noise', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: '<local-command-stdout>ignored</local-command-stdout>' } }),
      JSON.stringify({ type: 'user', message: { content: '<command-name>ignored</command-name>' } }),
      JSON.stringify({ type: 'user', message: { content: 'Base directory: /tmp/project' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'Keep this decision.' } }),
    ].join('\n');

    expect(normalizeClaudeCodeTranscript(jsonl).text).toBe('ASSISTANT: Keep this decision.');
  });

  it('returns an empty transcript for malformed or empty input', () => {
    const normalized = normalizeClaudeCodeTranscript('\nnot json\n');

    expect(normalized).toEqual({ text: '', lineCount: 0, charCount: 0 });
  });
});
