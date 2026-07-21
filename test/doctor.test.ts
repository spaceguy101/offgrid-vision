import { describe, it, expect, afterEach } from 'vitest';
import { runChecks, preflight, runDoctorCommand, type CommandIO } from '../src/commands/doctor.js';
import { createOllamaBackend } from '../src/backends/ollama.js';
import { BackendUnavailableError, EXIT } from '../src/errors.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';

let mock: MockOllama | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const config = (host: string, model = 'gemma3:12b') => ({ model, host, timeoutMs: 120000 });

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
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url), 'v20.11.0');

    expect(report.ok).toBe(true);
    expect(report.remediation).toBeNull();
    expect(report.checks.map((c) => c.ok)).toEqual([true, true, true]);
  });

  it('fails the node check below version 20', async () => {
    mock = await startMockOllama();
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url), 'v18.19.0');

    expect(report.ok).toBe(false);
    const nodeCheck = report.checks.find((c) => c.name === 'Node.js version');
    expect(nodeCheck?.ok).toBe(false);
    expect(nodeCheck?.detail).toContain('20');
  });

  it('detects a missing model and names the exact pull command', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url), 'v20.11.0');

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(false);
    expect(report.remediation).toContain('ollama pull gemma3:12b');
    expect(report.remediation).toContain('gemma3:4b');
  });

  it('matches a model whose tag is implicitly :latest', async () => {
    mock = await startMockOllama({ models: ['gemma3:latest'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url, 'gemma3'), 'v20.11.0');
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(true);
  });

  it('matches a bare requested model against an installed tag that is implicitly :latest (reverse direction)', async () => {
    mock = await startMockOllama({ models: ['gemma3'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url, 'gemma3:latest'), 'v20.11.0');
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(true);
  });

  it('does not match the same base model name with a different explicit tag', async () => {
    mock = await startMockOllama({ models: ['gemma3:4b'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url, 'gemma3:12b'), 'v20.11.0');
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(false);
  });

  it('detects an unreachable Ollama and skips the model check', async () => {
    const report = await runChecks(
      createOllamaBackend('http://127.0.0.1:1'),
      config('http://127.0.0.1:1'),
      'v20.11.0',
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Ollama reachable')?.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Model available')?.detail).toMatch(/skipped/i);
    expect(report.remediation).toMatch(/ollama\.com\/download/);
  });
});

describe('preflight', () => {
  it('resolves silently when everything is healthy', async () => {
    mock = await startMockOllama({ models: ['gemma3:12b'] });
    await expect(preflight(createOllamaBackend(mock.url), config(mock.url))).resolves.toBeUndefined();
  });

  it('throws BackendUnavailableError carrying remediation when the model is missing', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const error = await preflight(createOllamaBackend(mock.url), config(mock.url)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect((error as BackendUnavailableError).remediation).toContain('ollama pull gemma3:12b');
  });

  it('throws when the host is unreachable', async () => {
    await expect(
      preflight(createOllamaBackend('http://127.0.0.1:1'), config('http://127.0.0.1:1')),
    ).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

describe('runDoctorCommand', () => {
  it('healthy --json: exits 0 and stdout is nothing but the parseable JSON report', async () => {
    mock = await startMockOllama({ models: ['gemma3:12b'] });
    const io = fakeIO();

    const exitCode = await runDoctorCommand(['--json', '--host', mock.url], io);

    expect(exitCode).toBe(EXIT.SUCCESS);
    const stdout = io.stdoutLines.join('');
    const parsed = JSON.parse(stdout) as { ok: boolean; host: string; model: string; checks: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.host).toBe(mock.url);
    expect(parsed.model).toBe('gemma3:12b');
    expect(Array.isArray(parsed.checks)).toBe(true);
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
    expect(stdout).toContain('ollama pull gemma3:12b');
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
});
