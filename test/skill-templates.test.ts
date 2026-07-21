import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { renderSkillMd, renderSchemaMd } from '../src/skill/templates.js';

describe('renderSkillMd', () => {
  const skill = renderSkillMd('1.2.3');

  it('opens with YAML frontmatter carrying name and description', () => {
    expect(skill.startsWith('---\n')).toBe(true);
    const frontmatter = skill.split('---')[1] ?? '';
    expect(frontmatter).toContain('name: offgrid-vision');
    expect(frontmatter).toMatch(/^description: .+/m);
  });

  it('keeps the description on a single line so the YAML stays valid', () => {
    const description = /^description: (.*)$/m.exec(skill)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(80);
    expect(description).not.toContain('\n');
  });

  it('writes a trigger-oriented description naming the media it handles', () => {
    const description = /^description: (.*)$/m.exec(skill)?.[1]?.toLowerCase() ?? '';
    for (const cue of ['image', 'screenshot', 'photo', 'diagram', 'use this']) {
      expect(description).toContain(cue);
    }
  });

  it('instructs the harness to run doctor once per session', () => {
    expect(skill).toContain('npx offgrid-vision doctor');
    expect(skill.toLowerCase()).toContain('once per session');
  });

  it('mandates --json and stdout', () => {
    expect(skill).toContain('--json');
    expect(skill.toLowerCase()).toContain('stdout');
  });

  it('documents every mode preset', () => {
    for (const mode of ['general', 'ocr', 'alt-text', 'ui']) {
      expect(skill).toContain(mode);
    }
  });

  it('tells the harness to batch images into one invocation', () => {
    expect(skill.toLowerCase()).toContain('batch');
    expect(skill).toMatch(/analyze .*\.png .*\.png/);
  });

  it('states the fallback rule', () => {
    expect(skill.toLowerCase()).toContain('fallback');
    expect(skill.toLowerCase()).toContain('inform the user');
  });

  it('points at the bundled schema reference and stamps the version', () => {
    expect(skill).toContain('references/schema.md');
    expect(skill).toContain('1.2.3');
  });
});

describe('renderSchemaMd', () => {
  const schema = renderSchemaMd('1.2.3');

  it('documents every contract field', () => {
    for (const field of [
      'file', 'model', 'duration_ms', 'analysis', 'metadata', 'error',
      'description', 'objects', 'text', 'tags',
      'bytes', 'format', 'width', 'height', 'sha256', 'analyzed_at',
    ]) {
      expect(schema).toContain(field);
    }
  });

  it('lists every error code', () => {
    for (const code of ['TIMEOUT', 'PARSE_ERROR', 'BACKEND_UNAVAILABLE', 'UNSUPPORTED_FORMAT', 'IO_ERROR']) {
      expect(schema).toContain(code);
    }
  });

  it('documents the exit codes', () => {
    expect(schema).toContain('Exit codes');
    expect(schema).toMatch(/\b3\b/);
  });

  it('contains a valid JSON example', () => {
    const example = /```json\n([\s\S]*?)\n```/.exec(schema)?.[1];
    expect(example).toBeDefined();
    expect(() => JSON.parse(example as string)).not.toThrow();
  });

  it('shows an absolute file path in the example, matching the documented field type', () => {
    const example = /```json\n([\s\S]*?)\n```/.exec(schema)?.[1] as string;
    const parsed = JSON.parse(example) as { file: string };
    expect(path.isAbsolute(parsed.file)).toBe(true);
  });
});
