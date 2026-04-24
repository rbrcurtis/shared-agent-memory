import { afterEach, describe, expect, it, vi } from 'vitest';
import { ingestClaudeCodeTranscript } from './index.js';

vi.mock('../client.js', () => ({
  loadMemories: vi.fn(),
  searchMemory: vi.fn(),
  storeMemory: vi.fn(),
  updateMemory: vi.fn(),
}));

vi.mock('./claude-code.js', () => ({
  normalizeClaudeCodeTranscriptFile: vi.fn(),
}));

vi.mock('./extract.js', () => ({
  extractCandidateLearnings: vi.fn(),
}));

const client = await import('../client.js');
const claudeCode = await import('./claude-code.js');
const extract = await import('./extract.js');

const candidate = {
  title: 'Test command',
  text: 'Run npm test before committing.',
  tags: ['workflow'],
};

const transcript = {
  text: 'USER: Run tests',
  lineCount: 1,
  charCount: 15,
};

describe('ingestClaudeCodeTranscript', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('creates memories when no similar memory exists', async () => {
    vi.mocked(claudeCode.normalizeClaudeCodeTranscriptFile).mockResolvedValue(transcript);
    vi.mocked(extract.extractCandidateLearnings).mockResolvedValue([candidate]);
    vi.mocked(client.searchMemory).mockResolvedValue({ results: [] });
    vi.mocked(client.storeMemory).mockResolvedValue({ id: 'new-id' });

    await expect(
      ingestClaudeCodeTranscript({ file: '/tmp/transcript.jsonl', project: 'memory-mcp' }),
    ).resolves.toMatchObject({
      project: 'memory-mcp',
      dryRun: false,
      candidates: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      decisions: [{ action: 'create', id: 'new-id' }],
    });

    expect(client.storeMemory).toHaveBeenCalledWith({
      title: candidate.title,
      text: candidate.text,
      project: 'memory-mcp',
      agent: 'claude-code-ingest',
      tags: candidate.tags,
    });
  });

  it('updates a similar memory with different text', async () => {
    vi.mocked(claudeCode.normalizeClaudeCodeTranscriptFile).mockResolvedValue(transcript);
    vi.mocked(extract.extractCandidateLearnings).mockResolvedValue([candidate]);
    vi.mocked(client.searchMemory).mockResolvedValue({
      results: [{ id: 'existing-id', score: 0.84, title: 'Tests', text: 'Old text' }],
    });
    vi.mocked(client.loadMemories).mockResolvedValue({
      results: [{ id: 'existing-id', score: 1, title: 'Tests', text: 'Old text' }],
    });
    vi.mocked(client.updateMemory).mockResolvedValue({ success: true });

    const result = await ingestClaudeCodeTranscript({ file: '/tmp/transcript.jsonl', project: 'memory-mcp' });

    expect(result.updated).toBe(1);
    expect(result.decisions[0]).toMatchObject({ action: 'update', id: 'existing-id' });
    expect(client.updateMemory).toHaveBeenCalledWith({
      id: 'existing-id',
      title: candidate.title,
      text: candidate.text,
      project: 'memory-mcp',
    });
  });

  it('skips duplicate memories', async () => {
    vi.mocked(claudeCode.normalizeClaudeCodeTranscriptFile).mockResolvedValue(transcript);
    vi.mocked(extract.extractCandidateLearnings).mockResolvedValue([candidate]);
    vi.mocked(client.searchMemory).mockResolvedValue({
      results: [{ id: 'existing-id', score: 0.95, title: candidate.title, text: candidate.text }],
    });

    const result = await ingestClaudeCodeTranscript({ file: '/tmp/transcript.jsonl', project: 'memory-mcp' });

    expect(result.skipped).toBe(1);
    expect(result.decisions[0]).toMatchObject({ action: 'skip', id: 'existing-id' });
    expect(client.storeMemory).not.toHaveBeenCalled();
    expect(client.updateMemory).not.toHaveBeenCalled();
  });

  it('does not write memories during dry runs', async () => {
    vi.mocked(claudeCode.normalizeClaudeCodeTranscriptFile).mockResolvedValue(transcript);
    vi.mocked(extract.extractCandidateLearnings).mockResolvedValue([candidate]);
    vi.mocked(client.searchMemory).mockResolvedValue({ results: [] });

    const result = await ingestClaudeCodeTranscript({ file: '/tmp/transcript.jsonl', dryRun: true });

    expect(result).toMatchObject({ project: 'default', dryRun: true, created: 1 });
    expect(client.storeMemory).not.toHaveBeenCalled();
  });
});
