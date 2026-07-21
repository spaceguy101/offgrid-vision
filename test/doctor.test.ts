import { describe, it, expect, afterEach } from 'vitest';
import { runChecks, preflight } from '../src/commands/doctor.js';
import { createOllamaBackend } from '../src/backends/ollama.js';
import { BackendUnavailableError } from '../src/errors.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';

let mock: MockOllama | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const config = (host: string, model = 'gemma3:12b') => ({ model, host, timeoutMs: 120000 });

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
