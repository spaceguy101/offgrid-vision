import { existsSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';

export type Harness = 'claude-code' | 'generic';
export type Scope = 'user' | 'project';

export const HARNESSES: readonly Harness[] = ['claude-code', 'generic'];
export const SCOPES: readonly Scope[] = ['user', 'project'];

export const SKILL_NAME = 'offgrid-vision';

export function isHarness(value: string): value is Harness {
  return (HARNESSES as readonly string[]).includes(value);
}

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

export interface TargetInput {
  harness?: string;
  scope?: string;
  dir?: string;
  homedir: string;
  cwd: string;
  isTTY: boolean;
}

export interface SkillTarget {
  harness: Harness;
  scope: Scope;
  /** Absolute path of the skill directory itself, not its parent. */
  dir: string;
  /** True when the harness/scope came from auto-detection rather than flags. */
  detected: boolean;
}

/**
 * Decide where the skill directory belongs.
 *
 * With no flags, prefer a project-local .claude over the user's, then fall back
 * to claude-code/user — the documented non-TTY default (FR-3.2).
 */
export function resolveTarget(input: TargetInput): SkillTarget {
  if (input.harness !== undefined && !isHarness(input.harness)) {
    throw new UsageError(`Unknown --harness "${input.harness}". Supported: ${HARNESSES.join(', ')}`);
  }
  if (input.scope !== undefined && !isScope(input.scope)) {
    throw new UsageError(`Unknown --scope "${input.scope}". Supported: ${SCOPES.join(', ')}`);
  }

  const harness = input.harness as Harness | undefined;
  const scope = input.scope as Scope | undefined;

  if (harness === 'generic') {
    if (!input.dir) {
      throw new UsageError('--harness generic requires --dir <path> naming the skills directory.');
    }
    return {
      harness: 'generic',
      scope: scope ?? 'project',
      dir: path.join(path.resolve(input.cwd, input.dir), SKILL_NAME),
      detected: false,
    };
  }

  const scopeExplicit = scope !== undefined;
  let effectiveScope: Scope;
  let detected = false;

  if (scope !== undefined) {
    effectiveScope = scope;
  } else if (existsSync(path.join(input.cwd, '.claude'))) {
    effectiveScope = 'project';
    detected = !scopeExplicit;
  } else if (existsSync(path.join(input.homedir, '.claude'))) {
    effectiveScope = 'user';
    detected = !scopeExplicit;
  } else {
    effectiveScope = 'user';
  }

  const base = effectiveScope === 'user' ? input.homedir : input.cwd;
  return {
    harness: 'claude-code',
    scope: effectiveScope,
    dir: path.join(base, '.claude', 'skills', SKILL_NAME),
    detected,
  };
}
