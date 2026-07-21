import { parseArgs } from 'node:util';
import { BackendUnavailableError, EXIT } from '../errors.js';
import { isLocalHost, resolveConfig, type ResolvedConfig } from '../config.js';
import { createOllamaBackend } from '../backends/ollama.js';
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

function modelRemediation(model: string, host: string, available: string[]): string {
  return [
    `The model "${model}" is not present on the Ollama server at ${host}.`,
    '',
    'Pull it:',
    `  ollama pull ${model}`,
    '',
    'On a machine with less than 16 GB of RAM, prefer the smaller model:',
    '  ollama pull gemma4:4b',
    `  offgrid-vision analyze <file> --model gemma4:4b   (or set OFFGRID_MODEL=gemma4:4b)`,
    '',
    available.length
      ? `Models currently installed: ${available.join(', ')}`
      : 'No models are currently installed on that server.',
  ].join('\n');
}

/** Ollama reports untagged models as "name:latest"; treat a bare name as that. */
function modelMatches(requested: string, installed: string): boolean {
  const normalize = (name: string): string => (name.includes(':') ? name : `${name}:latest`);
  return normalize(requested) === normalize(installed);
}

export async function runChecks(
  backend: Backend,
  config: ResolvedConfig,
  nodeVersion: string,
): Promise<DoctorReport> {
  const checks: CheckResult[] = [];
  let remediation: string | null = null;

  const major = Number.parseInt(nodeVersion.replace(/^v/, '').split('.')[0] ?? '0', 10);
  const nodeOk = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  checks.push({
    name: 'Node.js version',
    ok: nodeOk,
    detail: nodeOk
      ? `${nodeVersion} (minimum ${MIN_NODE_MAJOR})`
      : `${nodeVersion} is too old — offgrid-vision requires Node.js ${MIN_NODE_MAJOR} or newer`,
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
    if (!present) remediation = modelRemediation(config.model, config.host, installed);
  }

  return { ok: checks.every((check) => check.ok), checks, remediation };
}

/**
 * FR-2.4: the fast preflight `analyze` runs before touching any file. Throws the
 * same actionable error the doctor command prints.
 */
export async function preflight(backend: Backend, config: ResolvedConfig): Promise<void> {
  const installed = await backend.listModels();
  if (!installed.some((name) => modelMatches(config.model, name))) {
    throw new BackendUnavailableError(
      `Model "${config.model}" is not available on ${config.host}`,
      modelRemediation(config.model, config.host, installed),
    );
  }
}

export const DOCTOR_HELP = `Usage: offgrid-vision doctor [options]

Check that this machine can run local image analysis.

Options:
  --model <name>   Model to check for       (env OFFGRID_MODEL, default gemma4:12b)
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
  const report = await runChecks(backend, config, process.version);

  if (values.json) {
    io.stdout(`${JSON.stringify({ ...report, host: config.host, model: config.model }, null, 2)}\n`);
  } else {
    const lines = report.checks.map((check) => `${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
    io.stdout(`${lines.join('\n')}\n`);
    if (report.remediation) io.stdout(`\n${report.remediation}\n`);
  }

  return report.ok ? EXIT.SUCCESS : EXIT.BACKEND;
}
