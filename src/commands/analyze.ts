import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { BackendUnavailableError, EXIT, UsageError } from '../errors.js';
import { isLocalHost, resolveConfig } from '../config.js';
import { createOllamaBackend } from '../backends/ollama.js';
import { discoverFiles } from '../media.js';
import { analyzeFile } from '../analyzer.js';
import { isMode, MODES, type Mode } from '../prompts/index.js';
import { summarize, type AnalysisResult, type RunReport } from '../schema.js';
import { renderHuman } from '../render.js';
import { preflight, type CommandIO } from './doctor.js';

export const MAX_CONCURRENCY = 4;

export const ANALYZE_HELP = `Usage: offgrid-vision analyze <path...> [options]

Analyze images locally with Ollama. Paths may be files or directories.

Options:
  --json                 Emit JSON on stdout (object for one file, array for many)
  --out <file>           Write { results, summary } JSON to a file
  --mode <preset>        general | ocr | alt-text | ui           (default general)
  --prompt <text>        Extra focus instruction for the model
  --model <name>         Model to use        (env OFFGRID_MODEL, default gemma4:12b)
  --host <url>           Ollama host         (env OLLAMA_HOST, default http://localhost:11434)
  --timeout <ms>         Per-file timeout    (env OFFGRID_TIMEOUT, default 120000)
  --concurrency <n>      Files in flight at once, 1-${MAX_CONCURRENCY}          (default 1)
  --no-recursive         Do not descend into subdirectories
  -h, --help             Show this help

Exit codes: 0 success, 1 one or more files failed, 2 usage error, 3 backend unavailable.`;

interface AnalyzeArgs {
  paths: string[];
  json: boolean;
  out?: string;
  mode: Mode;
  prompt?: string;
  model?: string;
  host?: string;
  timeout?: number;
  concurrency: number;
  recursive: boolean;
}

function parseAnalyzeArgs(argv: string[]): AnalyzeArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        json: { type: 'boolean', default: false },
        out: { type: 'string' },
        mode: { type: 'string', default: 'general' },
        prompt: { type: 'string' },
        model: { type: 'string' },
        host: { type: 'string' },
        timeout: { type: 'string' },
        concurrency: { type: 'string', default: '1' },
        'no-recursive': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });
  } catch (cause) {
    throw new UsageError(cause instanceof Error ? cause.message : String(cause));
  }

  const { values, positionals } = parsed;
  if (values.help) throw new UsageError('__help__');
  if (positionals.length === 0) {
    throw new UsageError('At least one file or directory path is required.');
  }

  const mode = values.mode ?? 'general';
  if (!isMode(mode)) {
    throw new UsageError(`Unknown --mode "${mode}". Valid modes: ${MODES.join(', ')}`);
  }

  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new UsageError(`--concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
  }

  let timeout: number | undefined;
  if (values.timeout !== undefined) {
    timeout = Number(values.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new UsageError('--timeout must be a positive number of milliseconds');
    }
  }

  return {
    paths: positionals,
    json: values.json ?? false,
    out: values.out,
    mode,
    prompt: values.prompt,
    model: values.model,
    host: values.host,
    timeout,
    concurrency,
    recursive: !values['no-recursive'],
  };
}

/**
 * Run `worker` over every item with at most `limit` in flight, writing each
 * result back to its original index so output order always matches input order.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function drain(): Promise<void> {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return results;
}

export async function runAnalyzeCommand(argv: string[], io: CommandIO): Promise<number> {
  let args: AnalyzeArgs;
  try {
    args = parseAnalyzeArgs(argv);
  } catch (cause) {
    if (cause instanceof UsageError && cause.message === '__help__') {
      io.stdout(`${ANALYZE_HELP}\n`);
      return EXIT.SUCCESS;
    }
    io.stderr(`${cause instanceof Error ? cause.message : String(cause)}\n\n${ANALYZE_HELP}\n`);
    return EXIT.USAGE;
  }

  const config = resolveConfig(
    { model: args.model, host: args.host, timeout: args.timeout },
    io.env,
  );
  if (!isLocalHost(config.host)) {
    io.stderr(`warning: ${config.host} is not a local address — image data will leave this machine\n`);
  }

  const backend = createOllamaBackend(config.host);

  // FR-2.4: fail fast with the doctor's remediation before touching any file.
  try {
    await preflight(backend, config);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const remediation = cause instanceof BackendUnavailableError ? cause.remediation : '';
    if (args.json) {
      const result: AnalysisResult = {
        file: args.paths.join(', '),
        model: config.model,
        duration_ms: 0,
        analysis: null,
        metadata: null,
        error: {
          code: 'BACKEND_UNAVAILABLE',
          message: remediation ? `${message}\n\n${remediation}` : message,
        },
      };
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    }
    io.stderr(`${message}\n\n${remediation}\n`);
    return EXIT.BACKEND;
  }

  // Discover each input path independently so one bad path (e.g. a typo) does
  // not collapse the entire batch — a per-path stat failure becomes a single
  // IO_ERROR envelope for that path while every other path is still analyzed.
  const discovered = new Set<string>();
  const discoveryErrors: AnalysisResult[] = [];
  for (const input of args.paths) {
    try {
      const found = await discoverFiles([input], { recursive: args.recursive });
      for (const file of found) discovered.add(file);
    } catch (cause) {
      discoveryErrors.push({
        file: input,
        model: config.model,
        duration_ms: 0,
        analysis: null,
        metadata: null,
        error: { code: 'IO_ERROR', message: cause instanceof Error ? cause.message : String(cause) },
      });
    }
  }
  const files = [...discovered].sort();

  if (files.length === 0 && discoveryErrors.length === 0) {
    io.stderr('No supported image files were found.\n');
    if (args.json) io.stdout('[]\n');
    return EXIT.SUCCESS;
  }

  const startedAt = Date.now();
  let completed = 0;
  const analyzed = await mapWithConcurrency(files, args.concurrency, async (file) => {
    io.stderr(`[${++completed}/${files.length}] analyzing ${file}\n`);
    return analyzeFile(file, {
      backend,
      model: config.model,
      timeoutMs: config.timeoutMs,
      mode: args.mode,
      customPrompt: args.prompt,
    });
  });
  const durationMs = Date.now() - startedAt;
  // Discovery-error envelopes (bad input paths) are appended after the
  // analyzed results; both orderings are deterministic, this one keeps the
  // successfully-discovered, sorted file list contiguous at the front.
  const results = [...analyzed, ...discoveryErrors];

  if (args.out) {
    const report: RunReport = {
      results,
      summary: summarize(results, config.model, durationMs),
    };
    await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    io.stderr(`wrote ${args.out}\n`);
  }

  if (args.json) {
    const payload = results.length === 1 ? results[0] : results;
    io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (!args.out) {
    io.stdout(renderHuman(results));
  }

  const failed = results.filter((result) => result.error !== null);
  if (failed.length === 0) return EXIT.SUCCESS;
  if (failed.every((result) => result.error?.code === 'BACKEND_UNAVAILABLE')) return EXIT.BACKEND;
  return EXIT.RUNTIME;
}
