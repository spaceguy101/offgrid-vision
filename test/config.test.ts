import { describe, it, expect } from 'vitest';
import { resolveConfig, isLocalHost } from '../src/config.js';

describe('resolveConfig', () => {
  it('uses defaults when nothing is provided', () => {
    expect(resolveConfig({}, {})).toEqual({
      model: 'gemma3:12b',
      host: 'http://localhost:11434',
      timeoutMs: 120000,
    });
  });

  it('prefers env vars over defaults', () => {
    const cfg = resolveConfig({}, {
      OFFGRID_MODEL: 'gemma3:4b',
      OLLAMA_HOST: 'http://10.0.0.5:11434',
      OFFGRID_TIMEOUT: '30000',
    });
    expect(cfg).toEqual({
      model: 'gemma3:4b',
      host: 'http://10.0.0.5:11434',
      timeoutMs: 30000,
    });
  });

  it('prefers flags over env vars', () => {
    const cfg = resolveConfig(
      { model: 'llava:13b', host: 'http://192.168.1.9:1234', timeout: 5000 },
      { OFFGRID_MODEL: 'gemma3:4b', OLLAMA_HOST: 'http://10.0.0.5:11434', OFFGRID_TIMEOUT: '30000' },
    );
    expect(cfg).toEqual({
      model: 'llava:13b',
      host: 'http://192.168.1.9:1234',
      timeoutMs: 5000,
    });
  });

  it('normalizes a host without a scheme and strips trailing slashes', () => {
    expect(resolveConfig({ host: 'localhost:11434/' }, {}).host).toBe('http://localhost:11434');
  });

  it('falls back to the default timeout for garbage values', () => {
    expect(resolveConfig({}, { OFFGRID_TIMEOUT: 'soon' }).timeoutMs).toBe(120000);
    expect(resolveConfig({}, { OFFGRID_TIMEOUT: '-5' }).timeoutMs).toBe(120000);
    expect(resolveConfig({}, { OFFGRID_TIMEOUT: '0' }).timeoutMs).toBe(120000);
  });
});

describe('isLocalHost', () => {
  it('recognizes loopback hosts', () => {
    expect(isLocalHost('http://localhost:11434')).toBe(true);
    expect(isLocalHost('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalHost('http://[::1]:11434')).toBe(true);
  });

  it('rejects remote hosts', () => {
    expect(isLocalHost('http://10.0.0.5:11434')).toBe(false);
    expect(isLocalHost('https://ollama.example.com')).toBe(false);
  });

  it('returns false for unparseable hosts', () => {
    expect(isLocalHost('::::')).toBe(false);
  });
});
