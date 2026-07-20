import { describe, it, expect } from 'vitest';
import { stripCodeFences, parseAnalysis, unparsedAnalysis, summarize } from '../src/schema.js';
import type { AnalysisResult } from '../src/schema.js';

describe('stripCodeFences', () => {
  it('unwraps a ```json fenced block', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('unwraps an unlabeled fenced block', () => {
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('leaves unfenced text alone', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it('trims prose surrounding a fence', () => {
    expect(stripCodeFences('Sure! Here you go:\n```json\n{"a":1}\n```\nHope that helps.'))
      .toBe('{"a":1}');
  });
});

describe('parseAnalysis', () => {
  it('parses a well-formed response', () => {
    const analysis = parseAnalysis(JSON.stringify({
      description: 'A modal error dialog.',
      objects: [{ name: 'error dialog', confidence: 'high' }],
      text: 'Error: connection refused',
      tags: ['screenshot', 'error-dialog'],
    }));
    expect(analysis).toEqual({
      description: 'A modal error dialog.',
      objects: [{ name: 'error dialog', confidence: 'high' }],
      text: 'Error: connection refused',
      tags: ['screenshot', 'error-dialog'],
    });
  });

  it('recovers a JSON object embedded in prose', () => {
    const analysis = parseAnalysis('Here is the analysis: {"description":"A cat.","objects":[],"text":"","tags":["cat"]} Done.');
    expect(analysis?.description).toBe('A cat.');
  });

  it('coerces objects given as bare strings', () => {
    const analysis = parseAnalysis('{"description":"x","objects":["cat","hat"],"text":"","tags":[]}');
    expect(analysis?.objects).toEqual([
      { name: 'cat', confidence: 'medium' },
      { name: 'hat', confidence: 'medium' },
    ]);
  });

  it('normalizes unknown confidence values to medium', () => {
    const analysis = parseAnalysis('{"description":"x","objects":[{"name":"cat","confidence":0.92}],"text":"","tags":[]}');
    expect(analysis?.objects[0]).toEqual({ name: 'cat', confidence: 'medium' });
  });

  it('fills in missing optional fields', () => {
    const analysis = parseAnalysis('{"description":"only this"}');
    expect(analysis).toEqual({ description: 'only this', objects: [], text: '', tags: [] });
  });

  it('coerces a non-string text field', () => {
    const analysis = parseAnalysis('{"description":"x","text":["line one","line two"]}');
    expect(analysis?.text).toBe('line one\nline two');
  });

  it('drops non-string and empty tags and caps the list at 15', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    const analysis = parseAnalysis(JSON.stringify({ description: 'x', tags: [...tags, '', 42] }));
    expect(analysis?.tags).toHaveLength(15);
    expect(analysis?.tags[0]).toBe('tag0');
  });

  it('returns null for unparseable text', () => {
    expect(parseAnalysis('I am afraid I cannot help with that.')).toBeNull();
    expect(parseAnalysis('')).toBeNull();
  });

  it('returns null when the payload is valid JSON but not an object', () => {
    expect(parseAnalysis('[1,2,3]')).toBeNull();
    expect(parseAnalysis('"just a string"')).toBeNull();
  });

  it('returns null when the object has no usable description', () => {
    expect(parseAnalysis('{"unrelated":true}')).toBeNull();
  });
});

describe('unparsedAnalysis', () => {
  it('preserves the raw text and flags the parse failure', () => {
    const analysis = unparsedAnalysis('total gibberish');
    expect(analysis).toEqual({
      description: '',
      objects: [],
      text: '',
      tags: [],
      raw: 'total gibberish',
      parse_error: true,
    });
  });
});

describe('summarize', () => {
  it('counts successes and failures', () => {
    const results = [
      { error: null },
      { error: { code: 'TIMEOUT', message: 'timed out' } },
      { error: null },
    ] as AnalysisResult[];
    expect(summarize(results, 'gemma3:12b', 900)).toEqual({
      total: 3, ok: 2, failed: 1, model: 'gemma3:12b', duration_ms: 900,
    });
  });
});
