import { describe, it, expect, afterEach } from 'vitest';
import { runChecks, preflight, runDoctorCommand, type CommandIO } from '../src/commands/doctor.js';
import { createOllamaBackend } from '../src/backends/ollama.js';
import { BackendUnavailableError, EXIT } from '../src/errors.js';
import { DEFAULT_MODEL } from '../src/config.js';
import { GIB } from '../src/models.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';

let mock: MockOllama | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const config = (host: string, model = 'gemma3:12b') => ({ model, host, timeoutMs: 120000, numCtx: 16384 });

/** Machine facts for the checks. 16 GB unless a test is about sizing. */
const sys = (totalMemBytes = 16 * GIB, nodeVersion = 'v20.11.0') => ({ nodeVersion, totalMemBytes });

/** Fake CommandIO that captures stdout/stderr into separate arrays for independent assertions. */
function fakeIO(): CommandIO & { stdoutLines: string[]; stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stderrLines,
    stdout: (text: string) => stdoutLines.push(text),
    stderr: (text: string) => stderrLines.push(text),
    env: {},
    cwd: '/tmp',
    isTTY: false,
  };
}

describe('runChecks', () => {
  it('reports healthy when node, host, and model all check out', async () => {
    mock = await startMockOllama({ models: ['gemma3:12b'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url), sys());

    expect(report.ok).toBe(true);
    expect(report.remediation).toBeNull();
    // Assert names alongside the flags: a positional [true, true, true] silently
    // mis-reports which check passed the moment a row is added.
    expect(report.checks.map((c) => [c.name, c.ok])).toEqual([
      ['Node.js version', true],
      ['System memory', true],
      ['Ollama reachable', true],
      ['Model available', true],
    ]);
  });

  it('fails the node check below version 20', async () => {
    mock = await startMockOllama();
    const report = await runChecks(
      createOllamaBackend(mock.url),
      config(mock.url),
      sys(16 * GIB, 'v18.19.0'),
    );

    expect(report.ok).toBe(false);
    const nodeCheck = report.checks.find((c) => c.name === 'Node.js version');
    expect(nodeCheck?.ok).toBe(false);
    expect(nodeCheck?.detail).toContain('20');
  });

  it('detects a missing model and names the exact pull command', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url), sys());

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(false);
    expect(report.remediation).toContain('ollama pull gemma3:12b');
    // The RAM-appropriate alternative, not the old invented gemma4:4b tag.
    expect(report.remediation).toContain('ollama pull qwen3.5:4b');
    expect(report.remediation).not.toContain('gemma4:4b');
  });

  it('matches a model whose tag is implicitly :latest', async () => {
    mock = await startMockOllama({ models: ['gemma3:latest'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url, 'gemma3'), sys());
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(true);
  });

  it('matches a bare requested model against an installed tag that is implicitly :latest (reverse direction)', async () => {
    mock = await startMockOllama({ models: ['gemma3'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url, 'gemma3:latest'), sys());
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(true);
  });

  it('does not match the same base model name with a different explicit tag', async () => {
    mock = await startMockOllama({ models: ['gemma3:4b'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url, 'gemma3:12b'), sys());
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(false);
  });

  it('detects an unreachable Ollama and skips the model check', async () => {
    const report = await runChecks(
      createOllamaBackend('http://127.0.0.1:1'),
      config('http://127.0.0.1:1'),
      sys(),
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Ollama reachable')?.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Model available')?.detail).toMatch(/skipped/i);
    expect(report.remediation).toMatch(/ollama\.com\/download/);
  });

  it('still reports memory when the server is unreachable — RAM detection is local', async () => {
    const report = await runChecks(
      createOllamaBackend('http://127.0.0.1:1'),
      config('http://127.0.0.1:1'),
      sys(),
    );

    const memory = report.checks.find((c) => c.name === 'System memory');
    expect(memory?.ok).toBe(true);
    expect(memory?.detail).toContain('16.0 GB');
    expect(report.checks).toHaveLength(4);
  });
});

describe('runChecks — memory sizing', () => {
  it('names the right model at each tier', async () => {
    mock = await startMockOllama({ models: ['gemma3:12b'] });
    const backend = createOllamaBackend(mock.url);

    const cases: Array<[number, string]> = [
      [4 * GIB, 'qwen3.5:2b'],
      [16 * GIB, 'qwen3.5:4b'],
      [64 * GIB, 'gemma4:12b'],
    ];
    for (const [bytes, expected] of cases) {
      const report = await runChecks(backend, config(mock.url, 'llava:13b'), sys(bytes));
      expect(report.checks.find((c) => c.name === 'System memory')?.detail).toContain(expected);
    }
  });

  it('stays healthy when the configured model is heavier than the machine warrants', async () => {
    mock = await startMockOllama({ models: ['gemma4:12b'] });
    const report = await runChecks(
      createOllamaBackend(mock.url),
      config(mock.url, 'gemma4:12b'),
      sys(8 * GIB),
    );

    // Advice only: a heavy model on a small machine runs, just slower. Failing
    // here would exit 3 on a working setup and break `doctor && analyze`.
    expect(report.ok).toBe(true);
    const memory = report.checks.find((c) => c.name === 'System memory');
    expect(memory?.ok).toBe(true);
    expect(memory?.detail).toContain('qwen3.5:4b');
  });

  it('mentions the headroom when the configured model is smaller than needed', async () => {
    mock = await startMockOllama({ models: ['qwen3.5:2b'] });
    const report = await runChecks(
      createOllamaBackend(mock.url),
      config(mock.url, 'qwen3.5:2b'),
      sys(64 * GIB),
    );

    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'System memory')?.detail).toContain(
      'can handle gemma4:12b',
    );
  });
});

describe('preflight', () => {
  it('resolves silently when everything is healthy', async () => {
    mock = await startMockOllama({ models: ['gemma3:12b'] });
    await expect(
      preflight(createOllamaBackend(mock.url), config(mock.url), 16 * GIB),
    ).resolves.toBeUndefined();
  });

  it('throws BackendUnavailableError carrying remediation when the model is missing', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const error = await preflight(createOllamaBackend(mock.url), config(mock.url), 16 * GIB).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect((error as BackendUnavailableError).remediation).toContain('ollama pull gemma3:12b');
    expect((error as BackendUnavailableError).remediation).toContain('16.0 GB');
  });

  it('throws when the host is unreachable', async () => {
    await expect(
      preflight(createOllamaBackend('http://127.0.0.1:1'), config('http://127.0.0.1:1'), 16 * GIB),
    ).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('runDoctorCommand', () => {
  it('healthy --json: exits 0 and stdout is nothing but the parseable JSON report', async () => {
    mock = await startMockOllama({ models: [DEFAULT_MODEL] });
    const io = fakeIO();

    const exitCode = await runDoctorCommand(['--json', '--host', mock.url], io);

    expect(exitCode).toBe(EXIT.SUCCESS);
    const stdout = io.stdoutLines.join('');
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      host: string;
      model: string;
      checks: Array<{ name: string; ok: boolean }>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.host).toBe(mock.url);
    expect(parsed.model).toBe(DEFAULT_MODEL);
    // This path reads the real machine, so assert on shape only — never on a
    // RAM figure, which differs per CI runner.
    expect(parsed.checks).toHaveLength(4);
    expect(parsed.checks.find((c) => c.name === 'System memory')?.ok).toBe(true);
  });

  it('a non-local --host prints the privacy warning to stderr, never to stdout', async () => {
    const io = fakeIO();

    // 10.0.0.5 is unreachable, which is fine: the warning fires before any
    // network call, and the report will simply mark the backend unhealthy.
    await runDoctorCommand(['--json', '--host', 'http://10.0.0.5:11434'], io);

    const stdout = io.stdoutLines.join('');
    const stderr = io.stderrLines.join('');
    expect(stderr).toMatch(/not a local address/i);
    expect(stdout).not.toMatch(/not a local address/i);
    // stdout must still be nothing but the JSON report.
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('unhealthy: exits 3 and (non-JSON) stdout names the ollama pull remediation', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const io = fakeIO();

    const exitCode = await runDoctorCommand(['--host', mock.url], io);

    expect(exitCode).toBe(EXIT.BACKEND);
    const stdout = io.stdoutLines.join('');
    expect(stdout).toContain(`ollama pull ${DEFAULT_MODEL}`);
  });

  it('-h/--help prints usage to stdout and exits 0', async () => {
    const io = fakeIO();

    const exitCode = await runDoctorCommand(['--help'], io);

    expect(exitCode).toBe(EXIT.SUCCESS);
    expect(io.stdoutLines.join('')).toContain('Usage: offgrid-vision doctor');
    expect(io.stderrLines).toEqual([]);

    const io2 = fakeIO();
    const exitCode2 = await runDoctorCommand(['-h'], io2);
    expect(exitCode2).toBe(EXIT.SUCCESS);
    expect(io2.stdoutLines.join('')).toContain('Usage: offgrid-vision doctor');
  });

  it('an unknown flag is a usage error: exits 2, stdout stays empty', async () => {
    const io = fakeIO();

    const exitCode = await runDoctorCommand(['--bogus-flag'], io);

    expect(exitCode).toBe(EXIT.USAGE);
    expect(io.stdoutLines.join('')).toBe('');
    expect(io.stderrLines.join('').length).toBeGreaterThan(0);
  });
});
