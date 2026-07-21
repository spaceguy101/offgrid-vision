import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInstallSkillCommand, runUninstallSkillCommand } from '../src/commands/install-skill.js';
import type { CommandIO } from '../src/commands/doctor.js';

let root: string;
let home: string;
let project: string;

function makeIO(cwd: string, overrides: Partial<CommandIO> = {}) {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const io: CommandIO = {
    stdout: (text) => outChunks.push(text),
    stderr: (text) => errChunks.push(text),
    env: { HOME: home, USERPROFILE: home },
    cwd,
    isTTY: false,
    ...overrides,
  };
  return { io, out: () => outChunks.join(''), err: () => errChunks.join('') };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-install-cmd-'));
  home = path.join(root, 'home');
  project = path.join(root, 'project');
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runInstallSkillCommand', () => {
  it('installs into the project scope and reports the path', async () => {
    const cap = makeIO(project);
    const code = await runInstallSkillCommand(['--harness', 'claude-code', '--scope', 'project'], cap.io);

    const expected = path.join(project, '.claude', 'skills', 'offgrid-vision', 'SKILL.md');
    expect(code).toBe(0);
    expect(existsSync(expected)).toBe(true);
    expect(cap.out()).toContain(expected);
  });

  it('installs into the user scope under the resolved home directory', async () => {
    const cap = makeIO(project);
    await runInstallSkillCommand(['--harness', 'claude-code', '--scope', 'user'], cap.io);
    expect(existsSync(path.join(home, '.claude', 'skills', 'offgrid-vision', 'SKILL.md'))).toBe(true);
  });

  it('installs into an arbitrary directory for the generic harness', async () => {
    const target = path.join(root, 'other-harness', 'skills');
    const cap = makeIO(project);
    await runInstallSkillCommand(['--harness', 'generic', '--dir', target], cap.io);
    expect(existsSync(path.join(target, 'offgrid-vision', 'SKILL.md'))).toBe(true);
  });

  it('auto-detects a project .claude directory when no flags are given', async () => {
    await mkdir(path.join(project, '.claude'), { recursive: true });
    const cap = makeIO(project);
    await runInstallSkillCommand([], cap.io);

    expect(existsSync(path.join(project, '.claude', 'skills', 'offgrid-vision', 'SKILL.md'))).toBe(true);
    expect(cap.out().toLowerCase()).toContain('detected');
  });

  it('reports an update rather than a fresh install on re-run', async () => {
    const args = ['--harness', 'claude-code', '--scope', 'project'];
    await runInstallSkillCommand(args, makeIO(project).io);
    const cap = makeIO(project);
    const code = await runInstallSkillCommand(args, cap.io);

    expect(code).toBe(0);
    expect(cap.out().toLowerCase()).toContain('updated');
  });

  it('writes a SKILL.md stamped with the package version', async () => {
    const cap = makeIO(project);
    await runInstallSkillCommand(['--harness', 'claude-code', '--scope', 'project'], cap.io);

    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const skill = await readFile(path.join(project, '.claude', 'skills', 'offgrid-vision', 'SKILL.md'), 'utf8');
    expect(skill).toContain(manifest.version);
  });

  it('rejects an unknown harness with exit code 2', async () => {
    const cap = makeIO(project);
    expect(await runInstallSkillCommand(['--harness', 'cursor'], cap.io)).toBe(2);
    expect(cap.err()).toContain('claude-code, generic');
  });

  it('rejects generic without --dir', async () => {
    const cap = makeIO(project);
    expect(await runInstallSkillCommand(['--harness', 'generic'], cap.io)).toBe(2);
    expect(cap.err()).toContain('--dir');
  });

  it('prints help for --help without installing anything', async () => {
    const cap = makeIO(project);
    expect(await runInstallSkillCommand(['--help'], cap.io)).toBe(0);
    expect(cap.out()).toContain('Usage: offgrid-vision install-skill');
    expect(existsSync(path.join(project, '.claude', 'skills'))).toBe(false);
  });
});

describe('runUninstallSkillCommand', () => {
  it('removes an installed skill and reports the path', async () => {
    const args = ['--harness', 'claude-code', '--scope', 'project'];
    await runInstallSkillCommand(args, makeIO(project).io);

    const cap = makeIO(project);
    const code = await runUninstallSkillCommand(args, cap.io);

    expect(code).toBe(0);
    expect(existsSync(path.join(project, '.claude', 'skills', 'offgrid-vision'))).toBe(false);
    expect(cap.out().toLowerCase()).toContain('removed');
  });

  it('leaves neighboring skills untouched', async () => {
    const args = ['--harness', 'claude-code', '--scope', 'project'];
    await runInstallSkillCommand(args, makeIO(project).io);
    const sibling = path.join(project, '.claude', 'skills', 'other-skill');
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(sibling, 'SKILL.md'), 'someone else', 'utf8');

    await runUninstallSkillCommand(args, makeIO(project).io);

    expect(existsSync(sibling)).toBe(true);
  });

  it('exits 0 with a note when nothing is installed', async () => {
    const cap = makeIO(project);
    const code = await runUninstallSkillCommand(['--harness', 'claude-code', '--scope', 'project'], cap.io);
    expect(code).toBe(0);
    expect(cap.out().toLowerCase()).toMatch(/not installed|nothing/);
  });

  it('prints the "Detected" line before removing an auto-detected skill', async () => {
    await mkdir(path.join(project, '.claude'), { recursive: true });
    await runInstallSkillCommand([], makeIO(project).io);

    const cap = makeIO(project);
    const code = await runUninstallSkillCommand([], cap.io);

    expect(code).toBe(0);
    expect(cap.out().toLowerCase()).toContain('detected');
    expect(existsSync(path.join(project, '.claude', 'skills', 'offgrid-vision'))).toBe(false);
  });
});
