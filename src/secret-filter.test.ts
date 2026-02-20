import { describe, it, expect } from 'vitest';
import { detectSecrets, shannonEntropy } from './secret-filter.js';

describe('shannonEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 for single repeated char', () => {
    expect(shannonEntropy('aaaaaaa')).toBe(0);
  });

  it('returns 1.0 for two equally distributed chars', () => {
    expect(shannonEntropy('abababab')).toBeCloseTo(1.0, 1);
  });

  it('returns high entropy for random-looking string', () => {
    expect(shannonEntropy('aB3kL9mQ2xR7')).toBeGreaterThan(3.0);
  });
});

describe('detectSecrets -- Layer 1: known prefixes', () => {
  it('detects GitHub PAT', () => {
    const r = detectSecrets('use token ghp_ABCDEFghijklmnop1234567890abcdefghijklmn');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('github-pat');
  });

  it('detects GitHub fine-grained PAT', () => {
    const r = detectSecrets('github_pat_11ABCDEF0123456789_abcdefghijklmnopqrstuvwxyz');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('github-fine-grained-pat');
  });

  it('detects AWS access key', () => {
    const r = detectSecrets('key is AKIAIOSFODNN7EXAMPLE');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('aws-access-key');
  });

  it('detects Slack bot token', () => {
    const r = detectSecrets('xoxb-fake-slack-token-for-testing');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('slack-token');
  });

  it('detects Anthropic API key', () => {
    const r = detectSecrets('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('anthropic-api-key');
  });

  it('detects OpenAI API key', () => {
    const r = detectSecrets('sk-proj-abcdefghijklmnopqrst1234');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('openai-api-key');
  });

  it('detects JWT', () => {
    const r = detectSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('jwt');
  });

  it('detects private key block', () => {
    const r = detectSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('private-key');
  });

  it('detects Discord webhook', () => {
    const r = detectSecrets('https://discord.com/api/webhooks/123456/abcdef');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('discord-webhook');
  });

  it('detects Slack webhook', () => {
    const r = detectSecrets('https://hooks.slack.com/services/T00/B00/xxxx');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('slack-webhook');
  });

  it('detects Cloudflare API key', () => {
    const r = detectSecrets('v1.0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('cloudflare-api-key');
  });

  it('detects GitLab PAT', () => {
    const r = detectSecrets('glpat-ABCDeFgHiJkLmNoPqRsT');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('gitlab-pat');
  });

  it('detects npm token', () => {
    const r = detectSecrets('npm_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('npm-token');
  });

  it('detects SendGrid key', () => {
    const r = detectSecrets('SG.abcdefghijklmnopqrstuv.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrst');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('sendgrid-api-key');
  });

  it('does not flag normal prose', () => {
    const r = detectSecrets('The GitHub integration uses OAuth for authentication. Set up a new app in settings.');
    expect(r).toBeNull();
  });
});

describe('detectSecrets -- Layer 2: long high-entropy strings', () => {
  it('detects long base64 string (>16 chars)', () => {
    const r = detectSecrets('the key is wzomliRqoAu7jpJZfzBqdzHX9VQPNowdAOdvxDIOxXk=');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('high-entropy-base64');
  });

  it('detects long hex string (>32 chars)', () => {
    const r = detectSecrets('hash: 6e5d4ed279ad196540f2f0b322642be5abcdef01');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('high-entropy-hex');
  });

  it('does not flag short git SHA (7 chars)', () => {
    const r = detectSecrets('fixed in commit a3f2b91');
    expect(r).toBeNull();
  });

  it('does not flag short base64 (<=16 chars)', () => {
    const r = detectSecrets('the id is abc123def456==');
    expect(r).toBeNull();
  });

  it('does not flag low-entropy long string', () => {
    const r = detectSecrets('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(r).toBeNull();
  });

  it('does not flag common English words that happen to be long', () => {
    const r = detectSecrets('The authentication system uses role-based access control for authorization.');
    expect(r).toBeNull();
  });

  it('detects base64 with plus and slash chars', () => {
    const r = detectSecrets('secret: 9l/vD27d9W20zA0If1/k798wx4dGOrHU7oBHhNdaWlA=');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('high-entropy-base64');
  });
});

describe('detectSecrets -- Layer 3: entropy + keyword proximity', () => {
  it('detects short secret near "api key" keyword', () => {
    const r = detectSecrets('the API key is xK9mQ2bR7pL4');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('keyword-proximity');
  });

  it('detects secret near "token" keyword', () => {
    const r = detectSecrets('token: dR4kL9mQ2x');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('keyword-proximity');
  });

  it('detects secret near "password" keyword', () => {
    const r = detectSecrets('password is Xt7bQ9kL2m');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('keyword-proximity');
  });

  it('detects secret near "secret" keyword', () => {
    const r = detectSecrets('client secret: mN8pR3kL7x');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('keyword-proximity');
  });

  it('does not flag low-entropy string near keyword', () => {
    const r = detectSecrets('the api key is abcabcabc');
    expect(r).toBeNull();
  });

  it('does not flag high-entropy string far from keyword', () => {
    const r = detectSecrets('The system uses advanced encryption. Many other things happen in between that push the distance well beyond fifty characters. xK9mQ2bR7pL4');
    expect(r).toBeNull();
  });

  it('detects with underscore keyword variant api_key', () => {
    const r = detectSecrets('api_key=xK9mQ2bR7pL4');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('keyword-proximity');
  });

  it('detects with bearer keyword', () => {
    const r = detectSecrets('Bearer xK9mQ2bR7pL4nZ');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('keyword-proximity');
  });

  it('is case-insensitive on keywords', () => {
    const r = detectSecrets('API_KEY=xK9mQ2bR7pL4');
    expect(r).not.toBeNull();
    expect(r!.rule).toBe('keyword-proximity');
  });
});
