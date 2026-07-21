import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { EXIT, UsageError } from '../errors.js';
import { getVersion } from '../version.js';
import { resolveTarget, type SkillTarget } from '../skill/paths.js';
import { installSkill, uninstallSkill } from '../skill/install.js';
import type { CommandIO } from './doctor.js';

const TARGET_FLAGS = `Options:
  --harness <name>   claude-code | generic   (default: auto-detect, else claude-code)
  --scope <name>     user | project          (default: auto-detect, else user)
  --dir <path>       Skills directory; required with --harness generic
  -h, --help         Show this help`;

export const INSTALL_SKILL_HELP = `Usage: offgrid-vision install-skill [options]

Install the offgrid-vision Agent Skill so a harness delegates image analysis
to this CLI instead of spending its own multimodal tokens.

${TARGET_FLAGS}

Targets:
  --harness claude-code --scope user      ~/.claude/skills/offgrid-vision/
  --harness claude-code --scope project   ./.claude/skills/offgrid-vision/
  --harness generic --dir <path>          <path>/offgrid-vision/

Re-running updates the skill in place.`;

export const UNINSTALL_SKILL_HELP = `Usage: offgrid-vision uninstall-skill [options]

Remove the offgrid-vision Agent Skill. Takes the same targeting flags as
install-skill and removes exactly the directory the installer created.

${TARGET_FLAGS}`;

interface TargetFlags {
  harness?: string;
  scope?: string;
  dir?: string;
  help: boolean;
}

function parseTargetFlags(argv: string[]): TargetFlags {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        harness: { type: 'string' },
        scope: { type: 'string' },
        dir: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    });
    return {
      harness: values.harness,
      scope: values.scope,
      dir: values.dir,
      help: values.help ?? false,
    };
  } catch (cause) {
    throw new UsageError(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Honor HOME/USERPROFILE when present so tests can point at a scratch home. */
function resolveHome(io: CommandIO): string {
  return io.env.HOME ?? io.env.USERPROFILE ?? homedir();
}

function resolve(argv: string[], io: CommandIO): SkillTarget {
  const flags = parseTargetFlags(argv);
  if (flags.help) throw new UsageError('__help__');
  return resolveTarget({
    harness: flags.harness,
    scope: flags.scope,
    dir: flags.dir,
    homedir: resolveHome(io),
    cwd: io.cwd,
    isTTY: io.isTTY,
  });
}

function handleUsageError(cause: unknown, io: CommandIO, help: string): number {
  if (cause instanceof UsageError && cause.message === '__help__') {
    io.stdout(`${help}\n`);
    return EXIT.SUCCESS;
  }
  io.stderr(`${cause instanceof Error ? cause.message : String(cause)}\n\n${help}\n`);
  return EXIT.USAGE;
}

export async function runInstallSkillCommand(argv: string[], io: CommandIO): Promise<number> {
  let target: SkillTarget;
  try {
    target = resolve(argv, io);
  } catch (cause) {
    return handleUsageError(cause, io, INSTALL_SKILL_HELP);
  }

  if (target.detected) {
    io.stdout(`Detected harness "${target.harness}" with ${target.scope} scope.\n`);
  }

  try {
    const result = await installSkill(target.dir, getVersion());
    io.stdout(`${result.updated ? 'Updated' : 'Installed'} the offgrid-vision skill:\n`);
    for (const file of result.files) io.stdout(`  ${file}\n`);
    io.stdout('\nStart a new session in that harness for the skill to be picked up.\n');
    return EXIT.SUCCESS;
  } catch (cause) {
    io.stderr(`Failed to install the skill: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return EXIT.RUNTIME;
  }
}

export async function runUninstallSkillCommand(argv: string[], io: CommandIO): Promise<number> {
  let target: SkillTarget;
  try {
    target = resolve(argv, io);
  } catch (cause) {
    return handleUsageError(cause, io, UNINSTALL_SKILL_HELP);
  }

  if (target.detected) {
    io.stdout(`Detected harness "${target.harness}" with ${target.scope} scope.\n`);
  }

  try {
    const result = await uninstallSkill(target.dir);
    io.stdout(
      result.removed
        ? `Removed the offgrid-vision skill from ${result.dir}\n`
        : `Nothing to do — no skill is installed at ${result.dir}\n`,
    );
    return EXIT.SUCCESS;
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.stderr(`${cause.message}\n`);
      return EXIT.USAGE;
    }
    io.stderr(`Failed to remove the skill: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return EXIT.RUNTIME;
  }
}
