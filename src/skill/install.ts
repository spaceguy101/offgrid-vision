import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { SKILL_NAME } from './paths.js';
import { renderSkillMd, renderSchemaMd } from './templates.js';

export interface InstallResult {
  dir: string;
  files: string[];
  updated: boolean;
}

export interface UninstallResult {
  dir: string;
  removed: boolean;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * FR-3.5: writing over our own skill directory is the expected update path, so
 * no --force is required. Parent directories are created as needed.
 */
export async function installSkill(dir: string, version: string): Promise<InstallResult> {
  const updated = await exists(path.join(dir, 'SKILL.md'));

  await mkdir(path.join(dir, 'references'), { recursive: true });

  const skillPath = path.join(dir, 'SKILL.md');
  const schemaPath = path.join(dir, 'references', 'schema.md');
  await writeFile(skillPath, renderSkillMd(version), 'utf8');
  await writeFile(schemaPath, renderSchemaMd(version), 'utf8');

  return { dir, files: [skillPath, schemaPath], updated };
}

/**
 * FR-3.6: remove exactly what we installed. The basename guard is the safety
 * net that keeps a mistyped --dir from deleting an unrelated tree.
 */
export async function uninstallSkill(dir: string): Promise<UninstallResult> {
  if (path.basename(dir) !== SKILL_NAME) {
    throw new UsageError(
      `Refusing to remove ${dir}: an offgrid-vision skill directory must be named "${SKILL_NAME}".`,
    );
  }
  if (!(await exists(dir))) return { dir, removed: false };

  await rm(dir, { recursive: true, force: true });
  return { dir, removed: true };
}
