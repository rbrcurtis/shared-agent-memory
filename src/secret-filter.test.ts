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
