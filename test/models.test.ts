import { describe, it, expect } from 'vitest';
import {
  GIB,
  MODEL_TIERS,
  formatGb,
  memoryAdvice,
  normalizeTag,
  recommendModel,
  sizingLines,
  tierIndexOf,
  tierTableLines,
} from '../src/models.js';

describe('recommendModel', () => {
  it('returns null when RAM cannot be detected', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(recommendModel(bad)).toBeNull();
    }
  });

  it('picks the smallest tier below 8 GB', () => {
    expect(recommendModel(4 * GIB)?.model).toBe('qwen3.5:2b');
    expect(recommendModel(7.4 * GIB)?.model).toBe('qwen3.5:2b');
  });

  it('picks the middle tier from 8 up to 24 GB', () => {
    // 7.5 rounds half-up to 8: a nominal 8 GB Linux box reports ~7.7 GiB
    // because MemTotal excludes reserved memory, and must not be demoted.
    expect(recommendModel(7.5 * GIB)?.model).toBe('qwen3.5:4b');
    expect(recommendModel(8 * GIB)?.model).toBe('qwen3.5:4b');
    expect(recommendModel(16 * GIB)?.model).toBe('qwen3.5:4b');
    expect(recommendModel(23 * GIB)?.model).toBe('qwen3.5:4b');
  });

  it('picks the largest tier from 24 GB up', () => {
    expect(recommendModel(23.5 * GIB)?.model).toBe('gemma4:12b');
    expect(recommendModel(24 * GIB)?.model).toBe('gemma4:12b');
    expect(recommendModel(64 * GIB)?.model).toBe('gemma4:12b');
  });
});

describe('formatGb', () => {
  it('prints one decimal with a GB suffix', () => {
    expect(formatGb(16 * GIB)).toBe('16.0 GB');
    expect(formatGb(8 * GIB)).toBe('8.0 GB');
  });

  it('formats the raw byte count os.totalmem() returns on a 16 GB machine', () => {
    expect(formatGb(17179869184)).toBe('16.0 GB');
  });
});

describe('normalizeTag / tierIndexOf', () => {
  it('treats a bare name as :latest', () => {
    expect(normalizeTag('gemma4')).toBe('gemma4:latest');
    expect(normalizeTag('gemma4:12b')).toBe('gemma4:12b');
  });

  it('locates tier models and rejects everything else', () => {
    expect(tierIndexOf('qwen3.5:2b')).toBe(0);
    expect(tierIndexOf('gemma4:12b')).toBe(2);
    expect(tierIndexOf('llava:13b')).toBe(-1);
  });
});

describe('memoryAdvice', () => {
  it('confirms a model that matches the machine', () => {
    const detail = memoryAdvice(16 * GIB, 'qwen3.5:4b');
    expect(detail).toContain('16.0 GB');
    expect(detail).toContain('right size');
  });

  it('names the lighter model when the configured one is too heavy', () => {
    const detail = memoryAdvice(8 * GIB, 'gemma4:12b');
    expect(detail).toContain('8.0 GB');
    expect(detail).toContain('qwen3.5:4b');
    expect(detail).toContain('3.4 GB download');
  });

  it('points out headroom when the configured model is smaller than needed', () => {
    const detail = memoryAdvice(64 * GIB, 'qwen3.5:2b');
    expect(detail).toContain('64.0 GB');
    expect(detail).toContain('can handle gemma4:12b');
  });

  it('still recommends a tier for a model that is not in the table', () => {
    const detail = memoryAdvice(16 * GIB, 'llava:13b');
    expect(detail).toContain('recommended vision model: qwen3.5:4b');
  });

  it('says so plainly when RAM is undetectable', () => {
    expect(memoryAdvice(0, 'qwen3.5:4b')).toContain('could not be detected');
  });
});

describe('sizingLines', () => {
  it('offers the pull command for the better-fitting model', () => {
    const text = sizingLines(8 * GIB, 'gemma4:12b').join('\n');
    expect(text).toContain('ollama pull qwen3.5:4b');
    expect(text).toContain('OFFGRID_MODEL=qwen3.5:4b');
  });

  it('does not tell the user to pull the model they already asked for', () => {
    const text = sizingLines(16 * GIB, 'qwen3.5:4b').join('\n');
    expect(text).toContain('right size');
    expect(text).not.toContain('ollama pull');
  });

  it('is empty when RAM is undetectable, so the caller drops the section', () => {
    expect(sizingLines(Number.NaN, 'qwen3.5:4b')).toEqual([]);
  });
});

describe('tierTableLines', () => {
  it('lists every tier with its pull command, aligned under the given indent', () => {
    const lines = tierTableLines('  ');
    expect(lines).toHaveLength(MODEL_TIERS.length);
    for (const tier of MODEL_TIERS) {
      expect(lines.join('\n')).toContain(`ollama pull ${tier.model}`);
    }
    expect(lines.every((line) => line.startsWith('  '))).toBe(true);
  });
});

describe('MODEL_TIERS', () => {
  it('starts at zero and ascends, so every RAM value maps to exactly one tier', () => {
    expect(MODEL_TIERS[0]?.minGib).toBe(0);
    for (let i = 1; i < MODEL_TIERS.length; i += 1) {
      expect(MODEL_TIERS[i]!.minGib).toBeGreaterThan(MODEL_TIERS[i - 1]!.minGib);
    }
  });

  it('holds unique, explicitly tagged models', () => {
    const tags = MODEL_TIERS.map((tier) => tier.model);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.every((tag) => tag.includes(':'))).toBe(true);
  });

  it('never recommends gemma4:4b, which is not a real Ollama tag', () => {
    // The gemma4 family ships e2b/e4b/12b/26b/31b. Earlier remediation text
    // told users to pull gemma4:4b, which always failed.
    expect(MODEL_TIERS.map((tier) => tier.model)).not.toContain('gemma4:4b');
  });
});
