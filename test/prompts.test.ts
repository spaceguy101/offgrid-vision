import { describe, it, expect } from 'vitest';
import { MODES, isMode, buildPrompt, REPAIR_PROMPT } from '../src/prompts/index.js';

describe('MODES', () => {
  it('exposes exactly the four v1 presets', () => {
    expect([...MODES]).toEqual(['general', 'ocr', 'alt-text', 'ui']);
  });
});

describe('isMode', () => {
  it('accepts known modes and rejects others', () => {
    expect(isMode('ocr')).toBe(true);
    expect(isMode('alt-text')).toBe(true);
    expect(isMode('OCR')).toBe(false);
    expect(isMode('video')).toBe(false);
  });
});

describe('buildPrompt', () => {
  it('always states the required schema keys', () => {
    for (const mode of MODES) {
      const prompt = buildPrompt(mode);
      for (const key of ['description', 'objects', 'text', 'tags', 'confidence']) {
        expect(prompt).toContain(key);
      }
    }
  });

  it('produces a distinct prompt per mode', () => {
    const prompts = MODES.map((mode) => buildPrompt(mode));
    expect(new Set(prompts).size).toBe(MODES.length);
  });

  it('emphasizes verbatim text in ocr mode', () => {
    expect(buildPrompt('ocr').toLowerCase()).toContain('verbatim');
  });

  it('appends the caller instruction under a clear heading', () => {
    const prompt = buildPrompt('general', 'focus on visible error messages');
    expect(prompt).toContain('focus on visible error messages');
    expect(prompt).toContain('Additional instruction from the caller');
  });

  it('ignores a blank custom prompt', () => {
    expect(buildPrompt('general', '   ')).toBe(buildPrompt('general'));
  });
});

describe('REPAIR_PROMPT', () => {
  it('demands bare JSON with no commentary', () => {
    expect(REPAIR_PROMPT.toLowerCase()).toContain('json');
    expect(REPAIR_PROMPT.toLowerCase()).toMatch(/no (commentary|prose|explanation)/);
  });
});
