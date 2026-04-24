import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractCandidateLearnings } from './extract.js';
import type { NormalizedTranscript } from './types.js';

const transcript: NormalizedTranscript = {
  text: 'USER: Always run npm test before committing.\nASSISTANT: I will follow that.',
  lineCount: 2,
  charCount: 72,
};

describe('extractCandidateLearnings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts and normalizes candidate learnings from Ollama JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          learnings: [
            {
              title: ' Test Command ',
              text: '  Run npm test before committing.  ',
              tags: [' TEST ', 'test', 'workflow'],
            },
            { title: '', text: 'ignored' },
          ],
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractCandidateLearnings(transcript, 'test-model')).resolves.toEqual([
      {
        title: 'Test Command',
        text: 'Run npm test before committing.',
        tags: ['test', 'workflow'],
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('test-model'),
      }),
    );
  });

  it('skips blank transcripts without calling the model', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      extractCandidateLearnings({ text: '   ', lineCount: 0, charCount: 3 }),
    ).resolves.toEqual([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when Ollama returns an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(extractCandidateLearnings(transcript)).rejects.toThrow(
      'Ollama extraction failed: HTTP 500',
    );
  });
});
