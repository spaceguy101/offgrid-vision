import { describe, it, expect } from 'vitest';
import { renderHuman } from '../src/render.js';
import type { AnalysisResult } from '../src/schema.js';

const ok: AnalysisResult = {
  file: '/tmp/shot.png',
  model: 'gemma3:12b',
  duration_ms: 8421,
  analysis: {
    description: 'A desktop application showing a modal error dialog.',
    objects: [
      { name: 'error dialog', confidence: 'high' },
      { name: 'close button', confidence: 'medium' },
    ],
    text: 'Error: connection refused (code 111)',
    tags: ['screenshot', 'error-dialog'],
  },
  metadata: {
    bytes: 148223, format: 'png', width: 1280, height: 800,
    sha256: 'abc123', analyzed_at: '2026-07-21T10:15:00.000Z',
  },
  error: null,
};

const failed: AnalysisResult = {
  file: '/tmp/notes.txt',
  model: 'gemma3:12b',
  duration_ms: 3,
  analysis: null,
  metadata: null,
  error: { code: 'UNSUPPORTED_FORMAT', message: 'not a supported image' },
};

describe('renderHuman', () => {
  it('renders the file, description, objects, text, and tags', () => {
    const out = renderHuman([ok]);
    expect(out).toContain('/tmp/shot.png');
    expect(out).toContain('A desktop application showing a modal error dialog.');
    expect(out).toContain('error dialog (high)');
    expect(out).toContain('Error: connection refused (code 111)');
    expect(out).toContain('screenshot, error-dialog');
    expect(out).toContain('1280x800');
    expect(out).toContain('8421 ms');
  });

  it('omits the text section when no text was found', () => {
    const noText = { ...ok, analysis: { ...ok.analysis!, text: '' } };
    expect(renderHuman([noText])).not.toContain('Text:');
  });

  it('renders errors with their code', () => {
    const out = renderHuman([failed]);
    expect(out).toContain('UNSUPPORTED_FORMAT');
    expect(out).toContain('not a supported image');
  });

  it('flags unparsed output and shows the raw reply', () => {
    const unparsed: AnalysisResult = {
      ...ok,
      analysis: { description: '', objects: [], text: '', tags: [], raw: 'gibberish', parse_error: true },
      error: { code: 'PARSE_ERROR', message: 'no valid JSON' },
    };
    const out = renderHuman([unparsed]);
    expect(out).toContain('gibberish');
    expect(out).toContain('PARSE_ERROR');
  });

  it('appends a summary line only for multi-file runs', () => {
    expect(renderHuman([ok])).not.toContain('2 files');
    const out = renderHuman([ok, failed]);
    expect(out).toContain('2 files');
    expect(out).toContain('1 succeeded');
    expect(out).toContain('1 failed');
  });

  it('handles an empty result set', () => {
    expect(renderHuman([])).toContain('No files');
  });
});
