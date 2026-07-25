import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeFile } from '../src/analyzer.js';
import { createOllamaBackend } from '../src/backends/ollama.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';
import { pngFixture, textFixture } from './helpers/fixtures.js';

let root: string;
let pngPath: string;
let txtPath: string;
let mock: MockOllama | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-analyze-'));
  pngPath = path.join(root, 'shot.png');
  txtPath = path.join(root, 'notes.txt');
  await writeFile(pngPath, pngFixture(1280, 800));
  await writeFile(txtPath, textFixture());
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

function backendFor(url: string) {
  return createOllamaBackend(url);
}

const baseOpts = { model: 'gemma3:12b', timeoutMs: 5000, numCtx: 16384, mode: 'general' as const };

describe('analyzeFile', () => {
  it('returns a fully populated envelope on the happy path', async () => {
    mock = await startMockOllama({
      chatReplies: [JSON.stringify({
        description: 'A desktop error dialog.',
        objects: [{ name: 'error dialog', confidence: 'high' }],
        text: 'Error: connection refused',
        tags: ['screenshot', 'error'],
      })],
    });
    const result = await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error).toBeNull();
    expect(result.file).toBe(pngPath);
    expect(result.model).toBe('gemma3:12b');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.analysis?.description).toBe('A desktop error dialog.');
    expect(result.analysis?.objects).toEqual([{ name: 'error dialog', confidence: 'high' }]);
    expect(result.metadata).toMatchObject({
      bytes: 33,
      format: 'png',
      width: 1280,
      height: 800,
    });
    expect(result.metadata?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metadata?.analyzed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sends the image as base64 with no data: prefix', async () => {
    mock = await startMockOllama();
    await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });
    const body = mock.requests.find((r) => r.path === '/api/chat')?.body as Record<string, unknown>;
    const images = (body.messages as Array<Record<string, unknown>>)[0]?.images as string[];
    expect(images[0]).not.toMatch(/^data:/);
    expect(images[0]).toBe(pngFixture(1280, 800).toString('base64'));
  });

  it('includes the custom prompt in the outgoing message', async () => {
    mock = await startMockOllama();
    await analyzeFile(pngPath, {
      ...baseOpts,
      backend: backendFor(mock.url),
      customPrompt: 'focus on error messages',
    });
    const body = mock.requests.find((r) => r.path === '/api/chat')?.body as Record<string, unknown>;
    const content = (body.messages as Array<Record<string, unknown>>)[0]?.content as string;
    expect(content).toContain('focus on error messages');
  });

  it('retries once with a repair prompt and succeeds', async () => {
    mock = await startMockOllama({
      chatReplies: [
        'Sure! I looked at your image and I think it shows a cat.',
        '{"description":"A cat.","objects":[],"text":"","tags":["cat"]}',
      ],
    });
    const result = await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error).toBeNull();
    expect(result.analysis?.description).toBe('A cat.');
    expect(result.analysis?.parse_error).toBeUndefined();
    expect(mock.requests.filter((r) => r.path === '/api/chat')).toHaveLength(2);
  });

  it('sends the repair prompt as a third message carrying prior context', async () => {
    mock = await startMockOllama({ chatReplies: ['nope', 'still nope'] });
    await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });
    const second = mock.requests.filter((r) => r.path === '/api/chat')[1];
    const messages = (second?.body as Record<string, unknown>).messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(3);
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[1]?.content).toBe('nope');
    expect(messages[2]?.role).toBe('user');
  });

  it('falls back to raw text with parse_error rather than crashing', async () => {
    mock = await startMockOllama({ chatReplies: ['nope', 'still nope'] });
    const result = await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error).toEqual({
      code: 'PARSE_ERROR',
      message: expect.stringContaining('JSON') as unknown as string,
    });
    expect(result.analysis).toEqual({
      description: '', objects: [], text: '', tags: [],
      raw: 'still nope', parse_error: true,
    });
    expect(result.metadata?.format).toBe('png');
  });

  it('reports UNSUPPORTED_FORMAT without calling the backend', async () => {
    mock = await startMockOllama();
    const result = await analyzeFile(txtPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error?.code).toBe('UNSUPPORTED_FORMAT');
    expect(result.analysis).toBeNull();
    expect(result.metadata).toBeNull();
    expect(mock.requests.filter((r) => r.path === '/api/chat')).toHaveLength(0);
  });

  it('reports IO_ERROR for a missing file', async () => {
    mock = await startMockOllama();
    const result = await analyzeFile(path.join(root, 'ghost.png'), {
      ...baseOpts,
      backend: backendFor(mock.url),
    });
    expect(result.error?.code).toBe('IO_ERROR');
    expect(result.analysis).toBeNull();
  });

  it('reports TIMEOUT and keeps metadata when inference stalls', async () => {
    mock = await startMockOllama({ chatDelayMs: 300 });
    const result = await analyzeFile(pngPath, {
      ...baseOpts,
      backend: backendFor(mock.url),
      timeoutMs: 50,
    });
    expect(result.error?.code).toBe('TIMEOUT');
    expect(result.analysis).toBeNull();
    expect(result.metadata?.format).toBe('png');
  });

  it('reports BACKEND_UNAVAILABLE when the host is down', async () => {
    const result = await analyzeFile(pngPath, {
      ...baseOpts,
      backend: backendFor('http://127.0.0.1:1'),
    });
    expect(result.error?.code).toBe('BACKEND_UNAVAILABLE');
    expect(result.analysis).toBeNull();
  });

  it('reports TIMEOUT (not PARSE_ERROR) when the repair call itself stalls', async () => {
    mock = await startMockOllama({
      chatReplies: ['nope'],
      // First call answers immediately; only the repair call stalls.
      chatDelayMs: [0, 300],
    });
    const result = await analyzeFile(pngPath, {
      ...baseOpts,
      backend: backendFor(mock.url),
      timeoutMs: 50,
    });

    expect(result.error?.code).toBe('TIMEOUT');
    expect(result.analysis).toBeNull();
    expect(result.metadata?.format).toBe('png');
    expect(mock.requests.filter((r) => r.path === '/api/chat')).toHaveLength(2);
  });

  it('reports BACKEND_UNAVAILABLE (not PARSE_ERROR) when the repair call gets an HTTP error', async () => {
    mock = await startMockOllama({
      chatReplies: ['nope'],
      // First call succeeds normally; only the repair call fails at the HTTP level.
      chatStatus: [200, 500],
    });
    const result = await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error?.code).toBe('BACKEND_UNAVAILABLE');
    expect(result.analysis).toBeNull();
    expect(result.metadata?.format).toBe('png');
    expect(mock.requests.filter((r) => r.path === '/api/chat')).toHaveLength(2);
  });
});
