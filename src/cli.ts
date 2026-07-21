#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EXIT } from './errors.js';
import { getVersion } from './version.js';
import { runAnalyzeCommand } from './commands/analyze.js';
import { runDoctorCommand, type CommandIO } from './commands/doctor.js';
import { runInstallSkillCommand, runUninstallSkillCommand } from './commands/install-skill.js';

export const ROOT_HELP = `offgrid-vision — analyze images locally instead of spending cloud multimodal tokens.

Usage: offgrid-vision <command> [options]

Commands:
  analyze <path...>    Analyze images or directories of images
  doctor               Check that Ollama and the model are ready
  install-skill        Install the Agent Skill into a harness
  uninstall-skill      Remove the Agent Skill

Global:
  -h, --help           Show help (also works per command)
  -v, --version        Print the version

Environment:
  OFFGRID_MODEL        Model name          (default gemma3:12b)
  OLLAMA_HOST          Backend host        (default http://localhost:11434)
  OFFGRID_TIMEOUT      Per-file timeout ms (default 120000)

Examples:
  npx offgrid-vision doctor
  npx offgrid-vision analyze screenshot.png --json
  npx offgrid-vision analyze ./shots --json --mode ui --concurrency 4
  npx offgrid-vision install-skill --harness claude-code --scope project

Exit codes: 0 success, 1 runtime error, 2 usage error, 3 backend unavailable.`;

type CommandHandler = (argv: string[], io: CommandIO) => Promise<number>;

const COMMANDS: Record<string, CommandHandler> = {
  analyze: runAnalyzeCommand,
  doctor: runDoctorCommand,
  'install-skill': runInstallSkillCommand,
  'uninstall-skill': runUninstallSkillCommand,
};

export async function run(argv: string[], io: CommandIO): Promise<number> {
  const [first, ...rest] = argv;

  if (first === undefined) {
    io.stderr(`${ROOT_HELP}\n`);
    return EXIT.USAGE;
  }
  if (first === '--help' || first === '-h' || first === 'help') {
    io.stdout(`${ROOT_HELP}\n`);
    return EXIT.SUCCESS;
  }
  if (first === '--version' || first === '-v') {
    io.stdout(`${getVersion()}\n`);
    return EXIT.SUCCESS;
  }

  const handler = COMMANDS[first];
  if (!handler) {
    io.stderr(`Unknown command "${first}".\n\n${ROOT_HELP}\n`);
    return EXIT.USAGE;
  }

  try {
    return await handler(rest, io);
  } catch (cause) {
    io.stderr(`offgrid-vision: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return EXIT.RUNTIME;
  }
}

/** Only reached when executed as a binary, never when imported by tests. */
async function main(): Promise<void> {
  const io: CommandIO = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  };
  process.exitCode = await run(process.argv.slice(2), io);
}

// Vitest imports this module for `run`; only the real binary should execute main().
// npm installs the bin as a symlink; Node resolves import.meta.url to the
// realpath while process.argv[1] stays the symlink path, so compare realpaths.
const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(realpathSync(entryPath)).href) {
  await main();
}
