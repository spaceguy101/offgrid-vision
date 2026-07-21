import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSkill, uninstallSkill } from '../src/skill/install.js';

let root: string;
let skillDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-install-'));
  skillDir = path.join(root, '.claude', 'skills', 'offgrid-vision');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('installSkill', () => {
  it('creates SKILL.md and references/schema.md, making parent directories', async () => {
    const result = await installSkill(skillDir, '1.2.3');

    expect(result.dir).toBe(skillDir);
    expect(result.updated).toBe(false);
    expect(existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(skillDir, 'references', 'schema.md'))).toBe(true);
    expect(result.files.map((f) => path.relative(skillDir, f)).sort())
      .toEqual([path.join('references', 'schema.md'), 'SKILL.md'].sort());
  });

  it('stamps the installing version into both files', async () => {
    await installSkill(skillDir, '1.2.3');
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toContain('1.2.3');
    expect(await readFile(path.join(skillDir, 'references', 'schema.md'), 'utf8')).toContain('1.2.3');
  });

  it('is idempotent and reports the second run as an update', async () => {
    await installSkill(skillDir, '1.0.0');
    const second = await installSkill(skillDir, '2.0.0');

    expect(second.updated).toBe(true);
    const skill = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(skill).toContain('2.0.0');
    expect(skill).not.toContain('1.0.0');
  });

  it('overwrites a stale file left in the skill directory', async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), 'stale content', 'utf8');
    await installSkill(skillDir, '1.2.3');
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).not.toBe('stale content');
  });
});

describe('uninstallSkill', () => {
  it('removes exactly the skill directory and leaves siblings alone', async () => {
    const sibling = path.join(root, '.claude', 'skills', 'other-skill');
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(sibling, 'SKILL.md'), 'someone else', 'utf8');
    await installSkill(skillDir, '1.2.3');

    const result = await uninstallSkill(skillDir);

    expect(result).toEqual({ dir: skillDir, removed: true });
    expect(existsSync(skillDir)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
    expect(await readdir(path.join(root, '.claude', 'skills'))).toEqual(['other-skill']);
  });

  it('reports removed: false when nothing is installed', async () => {
    expect(await uninstallSkill(skillDir)).toEqual({ dir: skillDir, removed: false });
  });

  it('refuses to remove a directory that is not our skill', async () => {
    const foreign = path.join(root, 'important-data');
    await mkdir(foreign, { recursive: true });
    await writeFile(path.join(foreign, 'notes.txt'), 'precious', 'utf8');

    await expect(uninstallSkill(foreign)).rejects.toThrow(/offgrid-vision/);
    expect(existsSync(foreign)).toBe(true);
  });
});
