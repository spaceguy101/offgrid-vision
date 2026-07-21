import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAnalyzeCommand } from '../src/commands/analyze.js';
import type { CommandIO } from '../src/commands/doctor.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';
import { pngFixture, textFixture } from './helpers/fixtures.js';

let root: string;
let mock: MockOllama | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-cmd-'));
  await mkdir(path.join(root, 'sub'), { recursive: true });
  await writeFile(path.join(root, 'a.png'), pngFixture());
  await writeFile(path.join(root, 'b.png'), pngFixture());
  await writeFile(path.join(root, 'sub', 'c.png'), pngFixture());
  await writeFile(path.join(root, 'notes.txt'), textFixture());
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

interface Captured {
  io: CommandIO;
  out: () => string;
  err: () => string;
}

function makeIO(env: NodeJS.ProcessEnv = {}): Captured {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    io: {
      stdout: (text) => outChunks.push(text),
      stderr: (text) => errChunks.push(text),
      env,
      cwd: root,
      isTTY: false,
    },
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

describe('runAnalyzeCommand', () => {
  it('emits a bare JSON object for a single file and exits 0', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    const code = await runAnalyzeCommand(
      [path.join(root, 'a.png'), '--json', '--host', mock.url],
      cap.io,
    );

    expect(code).toBe(0);
    const payload = JSON.parse(cap.out()) as Record<string, unknown>;
    expect(Array.isArray(payload)).toBe(false);
    expect(payload.file).toBe(path.join(root, 'a.png'));
    expect(payload.error).toBeNull();
  });

  it('emits a JSON array for multiple files', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    // Walking the directory discovers the three supported images (a.png, b.png,
    // sub/c.png); notes.txt is filtered out because directory walks skip
    // unsupported extensions (see discoverFiles). An explicitly-named unsupported
    // file is covered separately below.
    await runAnalyzeCommand([root, '--json', '--host', mock.url], cap.io);

    const payload = JSON.parse(cap.out()) as unknown[];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(3);
  });

  it('keeps stdout free of progress output in json mode', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([root, '--json', '--host', mock.url], cap.io);

    expect(() => JSON.parse(cap.out())).not.toThrow();
    expect(cap.err()).toMatch(/a\.png/);
  });

  it('honors --no-recursive', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([root, '--json', '--no-recursive', '--host', mock.url], cap.io);

    const payload = JSON.parse(cap.out()) as Array<{ file: string }>;
    expect(payload.every((r) => !r.file.includes(`${path.sep}sub${path.sep}`))).toBe(true);
  });

  it('continues past a failing file and exits 1', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    // notes.txt is named explicitly so it reaches the analyzer (explicit files
    // bypass the directory-walk extension filter) and fails with UNSUPPORTED_FORMAT,
    // while the three real images succeed.
    const code = await runAnalyzeCommand(
      [
        path.join(root, 'a.png'),
        path.join(root, 'b.png'),
        path.join(root, 'sub', 'c.png'),
        path.join(root, 'notes.txt'),
        '--json',
        '--host',
        mock.url,
      ],
      cap.io,
    );

    const payload = JSON.parse(cap.out()) as Array<{ file: string; error: { code: string } | null }>;
    expect(code).toBe(1);
    expect(payload.filter((r) => r.error === null)).toHaveLength(3);
    expect(payload.find((r) => r.file.endsWith('notes.txt'))?.error?.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('writes a report with results and summary to --out', async () => {
    mock = await startMockOllama();
    const outFile = path.join(root, 'report.json');
    const cap = makeIO();
    await runAnalyzeCommand(
      [path.join(root, 'a.png'), '--out', outFile, '--host', mock.url],
      cap.io,
    );

    const report = JSON.parse(await readFile(outFile, 'utf8')) as {
      results: unknown[];
      summary: { total: number; ok: number; failed: number; model: string };
    };
    expect(report.results).toHaveLength(1);
    expect(report.summary).toMatchObject({ total: 1, ok: 1, failed: 0, model: 'gemma3:12b' });
    await rm(outFile, { force: true });
  });

  it('renders human-readable output by default', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([path.join(root, 'a.png'), '--host', mock.url], cap.io);

    expect(cap.out()).toContain('a.png');
    expect(() => JSON.parse(cap.out())).toThrow();
  });

  it('passes --mode and --prompt through to the model', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand(
      [path.join(root, 'a.png'), '--json', '--mode', 'ocr', '--prompt', 'read the receipt total', '--host', mock.url],
      cap.io,
    );

    const body = mock.requests.find((r) => r.path === '/api/chat')?.body as Record<string, unknown>;
    const content = (body.messages as Array<Record<string, unknown>>)[0]?.content as string;
    expect(content.toLowerCase()).toContain('verbatim');
    expect(content).toContain('read the receipt total');
  });

  it('rejects an unknown mode with exit code 2', async () => {
    const cap = makeIO();
    const code = await runAnalyzeCommand([path.join(root, 'a.png'), '--mode', 'video'], cap.io);
    expect(code).toBe(2);
    expect(cap.err()).toContain('general, ocr, alt-text, ui');
  });

  it('rejects a concurrency above the maximum with exit code 2', async () => {
    const cap = makeIO();
    expect(await runAnalyzeCommand([path.join(root, 'a.png'), '--concurrency', '9'], cap.io)).toBe(2);
    expect(await runAnalyzeCommand([path.join(root, 'a.png'), '--concurrency', '0'], cap.io)).toBe(2);
  });

  it('requires at least one path', async () => {
    const cap = makeIO();
    expect(await runAnalyzeCommand(['--json'], cap.io)).toBe(2);
  });

  it('processes files with --concurrency 4 and still returns every result', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    const code = await runAnalyzeCommand(
      [path.join(root, 'a.png'), path.join(root, 'b.png'), path.join(root, 'sub', 'c.png'),
       '--json', '--concurrency', '4', '--host', mock.url],
      cap.io,
    );

    expect(code).toBe(0);
    expect(JSON.parse(cap.out())).toHaveLength(3);
  });

  it('preserves input order in the output regardless of concurrency', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([root, '--json', '--concurrency', '4', '--host', mock.url], cap.io);

    const files = (JSON.parse(cap.out()) as Array<{ file: string }>).map((r) => r.file);
    expect([...files].sort()).toEqual(files);
  });

  it('fails preflight with exit code 3 and remediation on stderr', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const cap = makeIO();
    const code = await runAnalyzeCommand([path.join(root, 'a.png'), '--host', mock.url], cap.io);

    expect(code).toBe(3);
    expect(cap.err()).toContain('ollama pull gemma3:12b');
  });

  it('embeds the preflight failure in stdout JSON when --json is set', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const cap = makeIO();
    const code = await runAnalyzeCommand([path.join(root, 'a.png'), '--json', '--host', mock.url], cap.io);

    expect(code).toBe(3);
    const payload = JSON.parse(cap.out()) as { error: { code: string; message: string; remediation: string } };
    expect(payload.error.code).toBe('BACKEND_UNAVAILABLE');
    expect(payload.error.remediation).toContain('ollama pull gemma3:12b');
  });

  it('reads configuration from env vars', async () => {
    mock = await startMockOllama({ models: ['gemma3:4b'] });
    const cap = makeIO({ OLLAMA_HOST: mock.url, OFFGRID_MODEL: 'gemma3:4b' });
    const code = await runAnalyzeCommand([path.join(root, 'a.png'), '--json'], cap.io);

    expect(code).toBe(0);
    expect((JSON.parse(cap.out()) as { model: string }).model).toBe('gemma3:4b');
  });

  it('warns on stderr when the host is not local', async () => {
    const cap = makeIO();
    await runAnalyzeCommand([path.join(root, 'a.png'), '--host', 'http://10.0.0.5:11434'], cap.io);
    expect(cap.err()).toMatch(/not a local address/);
  });

  it('reports a missing path as an IO error with exit code 1', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    const code = await runAnalyzeCommand(
      [path.join(root, 'ghost.png'), '--json', '--host', mock.url],
      cap.io,
    );
    expect(code).toBe(1);
    expect((JSON.parse(cap.out()) as { error: { code: string } }).error.code).toBe('IO_ERROR');
  });
});
