import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveTarget, isHarness, isScope, SKILL_NAME } from '../src/skill/paths.js';
import { UsageError } from '../src/errors.js';

let home: string;
let project: string;
let bare: string;

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'offgrid-paths-'));
  home = path.join(root, 'home');
  project = path.join(root, 'project');
  bare = path.join(root, 'bare');
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(path.join(project, '.claude'), { recursive: true });
  await mkdir(bare, { recursive: true });
});

afterAll(async () => {
  await rm(path.dirname(home), { recursive: true, force: true });
});

describe('isHarness / isScope', () => {
  it('validates known values', () => {
    expect(isHarness('claude-code')).toBe(true);
    expect(isHarness('generic')).toBe(true);
    expect(isHarness('cursor')).toBe(false);
    expect(isScope('user')).toBe(true);
    expect(isScope('project')).toBe(true);
    expect(isScope('global')).toBe(false);
  });
});

describe('resolveTarget', () => {
  it('resolves claude-code user scope under the home directory', () => {
    const target = resolveTarget({ harness: 'claude-code', scope: 'user', homedir: home, cwd: bare, isTTY: false });
    expect(target.dir).toBe(path.join(home, '.claude', 'skills', SKILL_NAME));
    expect(target.detected).toBe(false);
  });

  it('resolves claude-code project scope under the cwd', () => {
    const target = resolveTarget({ harness: 'claude-code', scope: 'project', homedir: home, cwd: project, isTTY: false });
    expect(target.dir).toBe(path.join(project, '.claude', 'skills', SKILL_NAME));
  });

  it('uses --dir verbatim for the generic harness', () => {
    const custom = path.join(bare, 'my-skills');
    const target = resolveTarget({ harness: 'generic', dir: custom, homedir: home, cwd: bare, isTTY: false });
    expect(target.dir).toBe(path.join(custom, SKILL_NAME));
  });

  it('resolves a relative --dir against the cwd', () => {
    const target = resolveTarget({ harness: 'generic', dir: './skills', homedir: home, cwd: bare, isTTY: false });
    expect(path.isAbsolute(target.dir)).toBe(true);
    expect(target.dir).toBe(path.join(bare, 'skills', SKILL_NAME));
  });

  it('requires --dir for the generic harness', () => {
    expect(() => resolveTarget({ harness: 'generic', homedir: home, cwd: bare, isTTY: false }))
      .toThrow(UsageError);
  });

  it('rejects an unknown harness or scope', () => {
    expect(() => resolveTarget({ harness: 'cursor', homedir: home, cwd: bare, isTTY: false })).toThrow(UsageError);
    expect(() => resolveTarget({ harness: 'claude-code', scope: 'global', homedir: home, cwd: bare, isTTY: false })).toThrow(UsageError);
  });

  it('prefers project scope when the cwd has a .claude directory', () => {
    const target = resolveTarget({ homedir: home, cwd: project, isTTY: false });
    expect(target).toMatchObject({ harness: 'claude-code', scope: 'project', detected: true });
    expect(target.dir).toBe(path.join(project, '.claude', 'skills', SKILL_NAME));
  });

  it('falls back to user scope when only the home directory has .claude', () => {
    const target = resolveTarget({ homedir: home, cwd: bare, isTTY: false });
    expect(target).toMatchObject({ harness: 'claude-code', scope: 'user', detected: true });
  });

  it('still detects scope when harness is explicit but scope is not', () => {
    const target = resolveTarget({ harness: 'claude-code', homedir: home, cwd: project, isTTY: false });
    expect(target).toMatchObject({ harness: 'claude-code', scope: 'project', detected: true });
    expect(target.dir).toBe(path.join(project, '.claude', 'skills', SKILL_NAME));
  });

  it('honors an explicit scope over detection even with harness present', () => {
    const target = resolveTarget({ harness: 'claude-code', scope: 'user', homedir: home, cwd: project, isTTY: false });
    expect(target).toMatchObject({ harness: 'claude-code', scope: 'user', detected: false });
  });

  it('defaults to claude-code user scope in a non-TTY with nothing detected', () => {
    const target = resolveTarget({ homedir: bare, cwd: bare, isTTY: false });
    expect(target).toMatchObject({ harness: 'claude-code', scope: 'user' });
    expect(target.dir).toBe(path.join(bare, '.claude', 'skills', SKILL_NAME));
  });

  it('honors an explicit scope over detection', () => {
    const target = resolveTarget({ harness: 'claude-code', scope: 'user', homedir: home, cwd: project, isTTY: false });
    expect(target.scope).toBe('user');
    expect(target.detected).toBe(false);
  });
});
