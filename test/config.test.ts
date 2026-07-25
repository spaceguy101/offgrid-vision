import { describe, it, expect } from 'vitest';
import { resolveConfig, isLocalHost, DEFAULT_MODEL } from '../src/config.js';
import { MODEL_TIERS } from '../src/models.js';

describe('resolveConfig', () => {
  it('uses defaults when nothing is provided', () => {
    expect(resolveConfig({}, {})).toEqual({
      model: 'qwen3.5:4b',
      host: 'http://localhost:11434',
      timeoutMs: 120000,
    });
  });

  it('defaults to a model the sizing table knows about', () => {
    // Guards against the default drifting to a tag doctor cannot reason about,
    // or to one that does not exist at all.
    expect(MODEL_TIERS.map((tier) => tier.model)).toContain(DEFAULT_MODEL);
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

  it('treats an empty OFFGRID_MODEL as unset and falls back to the default', () => {
    expect(resolveConfig({}, { OFFGRID_MODEL: '' }).model).toBe('qwen3.5:4b');
    expect(resolveConfig({}, { OFFGRID_MODEL: '   ' }).model).toBe('qwen3.5:4b');
  });

  it('treats an empty OLLAMA_HOST as unset and falls back to the default', () => {
    expect(resolveConfig({}, { OLLAMA_HOST: '' }).host).toBe('http://localhost:11434');
    expect(resolveConfig({}, { OLLAMA_HOST: '   ' }).host).toBe('http://localhost:11434');
  });

  it('still lets a flag override a set env var when the env var is empty-checked', () => {
    const cfg = resolveConfig(
      { model: 'llava:13b', host: 'http://192.168.1.9:1234' },
      { OFFGRID_MODEL: 'gemma3:4b', OLLAMA_HOST: 'http://10.0.0.5:11434' },
    );
    expect(cfg.model).toBe('llava:13b');
    expect(cfg.host).toBe('http://192.168.1.9:1234');
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
