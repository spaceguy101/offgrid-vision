import { parseArgs } from 'node:util';
import { totalmem } from 'node:os';
import { BackendUnavailableError, EXIT } from '../errors.js';
import { isLocalHost, resolveConfig, type ResolvedConfig } from '../config.js';
import { createOllamaBackend } from '../backends/ollama.js';
import { memoryAdvice, normalizeTag, sizingLines } from '../models.js';
import type { Backend } from '../backends/backend.js';

/** Injection point so commands can be exercised without spawning a process. */
export interface CommandIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  isTTY: boolean;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: CheckResult[];
  remediation: string | null;
}

export const MIN_NODE_MAJOR = 20;

/** Machine facts, injected so checks can be exercised for any hardware. */
export interface SystemInfo {
  nodeVersion: string;
  /** Total physical RAM in bytes, as os.totalmem() reports it. */
  totalMemBytes: number;
}

/** The only place in this file that reads real machine state. */
export function readSystemInfo(): SystemInfo {
  return { nodeVersion: process.version, totalMemBytes: totalmem() };
}

function modelRemediation(
  model: string,
  host: string,
  available: string[],
  totalMemBytes: number,
): string {
  return [
    `The model "${model}" is not present on the Ollama server at ${host}.`,
    '',
    'Pull it:',
    `  ollama pull ${model}`,
    ...sizingLines(totalMemBytes, model),
    '',
    available.length
      ? `Models currently installed: ${available.join(', ')}`
      : 'No models are currently installed on that server.',
  ].join('\n');
}

function modelMatches(requested: string, installed: string): boolean {
  return normalizeTag(requested) === normalizeTag(installed);
}

export async function runChecks(
  backend: Backend,
  config: ResolvedConfig,
  system: SystemInfo,
): Promise<DoctorReport> {
  const checks: CheckResult[] = [];
  let remediation: string | null = null;

  const { nodeVersion, totalMemBytes } = system;
  const major = Number.parseInt(nodeVersion.replace(/^v/, '').split('.')[0] ?? '0', 10);
  const nodeOk = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  checks.push({
    name: 'Node.js version',
    ok: nodeOk,
    detail: nodeOk
      ? `${nodeVersion} (minimum ${MIN_NODE_MAJOR})`
      : `${nodeVersion} is too old — offgrid-vision requires Node.js ${MIN_NODE_MAJOR} or newer`,
  });

  // Informational only: a small machine is not a broken machine, and a heavier
  // model than the tier still runs (slower). Never fails, so it cannot flip the
  // exit code that `doctor && analyze` gating depends on.
  checks.push({
    name: 'System memory',
    ok: true,
    detail: memoryAdvice(totalMemBytes, config.model),
  });

  let installed: string[] = [];
  let reachable = true;
  try {
    installed = await backend.listModels();
    checks.push({ name: 'Ollama reachable', ok: true, detail: `responding at ${config.host}` });
  } catch (cause) {
    reachable = false;
    checks.push({
      name: 'Ollama reachable',
      ok: false,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
    if (cause instanceof BackendUnavailableError) remediation = cause.remediation;
  }

  if (!reachable) {
    checks.push({
      name: 'Model available',
      ok: false,
      detail: 'skipped — the server could not be reached',
    });
  } else {
    const present = installed.some((name) => modelMatches(config.model, name));
    checks.push({
      name: 'Model available',
      ok: present,
      detail: present
        ? `${config.model} is installed`
        : `${config.model} is not installed`,
    });
    if (!present) {
      remediation = modelRemediation(config.model, config.host, installed, totalMemBytes);
    }
  }

  return { ok: checks.every((check) => check.ok), checks, remediation };
}

/**
 * FR-2.4: the fast preflight `analyze` runs before touching any file. Throws the
 * same actionable error the doctor command prints.
 */
export async function preflight(
  backend: Backend,
  config: ResolvedConfig,
  totalMemBytes: number,
): Promise<void> {
  const installed = await backend.listModels();
  if (!installed.some((name) => modelMatches(config.model, name))) {
    throw new BackendUnavailableError(
      `Model "${config.model}" is not available on ${config.host}`,
      modelRemediation(config.model, config.host, installed, totalMemBytes),
    );
  }
}

export const DOCTOR_HELP = `Usage: offgrid-vision doctor [options]

Check that this machine can run local image analysis. Reports total RAM and the
vision model sized for it.

Options:
  --model <name>   Model to check for       (env OFFGRID_MODEL, default qwen3.5:4b)
  --host <url>     Ollama host              (env OLLAMA_HOST, default http://localhost:11434)
  --json           Emit the report as JSON on stdout
  -h, --help       Show this help

Exit codes: 0 healthy, 3 backend unavailable or model missing.`;

export async function runDoctorCommand(argv: string[], io: CommandIO): Promise<number> {
  let values: { model?: string; host?: string; json: boolean; help: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        model: { type: 'string' },
        host: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    }));
  } catch (cause) {
    io.stderr(`${cause instanceof Error ? cause.message : String(cause)}\n\n${DOCTOR_HELP}\n`);
    return EXIT.USAGE;
  }

  if (values.help) {
    io.stdout(`${DOCTOR_HELP}\n`);
    return EXIT.SUCCESS;
  }

  const config = resolveConfig({ model: values.model, host: values.host }, io.env);
  if (!isLocalHost(config.host)) {
    io.stderr(`warning: ${config.host} is not a local address — image data will leave this machine\n`);
  }

  const backend = createOllamaBackend(config.host);
  const report = await runChecks(backend, config, readSystemInfo());

  if (values.json) {
    io.stdout(`${JSON.stringify({ ...report, host: config.host, model: config.model }, null, 2)}\n`);
  } else {
    const lines = report.checks.map((check) => `${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
    io.stdout(`${lines.join('\n')}\n`);
    if (report.remediation) io.stdout(`\n${report.remediation}\n`);
  }

  return report.ok ? EXIT.SUCCESS : EXIT.BACKEND;
}
