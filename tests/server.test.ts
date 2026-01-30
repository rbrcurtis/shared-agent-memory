import { describe, it, expect } from 'vitest';

describe('MCP Server Tools', () => {
  it('exports SharedMemoryServer', async () => {
    const { SharedMemoryServer } = await import('../src/server.js');
    expect(SharedMemoryServer).toBeDefined();
  });
});
