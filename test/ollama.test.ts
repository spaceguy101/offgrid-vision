import { describe, it, expect, afterEach } from 'vitest';
import { createOllamaBackend } from '../src/backends/ollama.js';
import { TimeoutError } from '../src/backends/backend.js';
import { BackendUnavailableError } from '../src/errors.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';

let mock: MockOllama | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('createOllamaBackend', () => {
  it('lists models from /api/tags', async () => {
    mock = await startMockOllama({ models: ['gemma3:12b', 'llava:13b'] });
    const backend = createOllamaBackend(mock.url);
    expect(await backend.listModels()).toEqual(['gemma3:12b', 'llava:13b']);
  });

  it('resolves ping when the host answers', async () => {
    mock = await startMockOllama();
    await expect(createOllamaBackend(mock.url).ping()).resolves.toBeUndefined();
  });

  it('throws BackendUnavailableError with remediation when the host is down', async () => {
    const backend = createOllamaBackend('http://127.0.0.1:1');
    const error = await backend.ping().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect((error as BackendUnavailableError).remediation).toMatch(/ollama/i);
  });

  it('returns the assistant message content from /api/chat', async () => {
    mock = await startMockOllama({ chatReplies: ['hello from the model'] });
    const backend = createOllamaBackend(mock.url);
    const reply = await backend.chat(
      [{ role: 'user', content: 'describe this', images: ['aGVsbG8='] }],
      { model: 'gemma3:12b', timeoutMs: 5000 },
    );
    expect(reply).toBe('hello from the model');
  });

  it('sends a non-streaming request carrying the model, prompt, and base64 image', async () => {
    mock = await startMockOllama();
    const backend = createOllamaBackend(mock.url);
    await backend.chat(
      [{ role: 'user', content: 'describe this', images: ['aGVsbG8='] }],
      { model: 'gemma3:12b', timeoutMs: 5000 },
    );
    const request = mock.requests.find((r) => r.path === '/api/chat');
    const body = request?.body as Record<string, unknown>;
    expect(body.model).toBe('gemma3:12b');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.content).toBe('describe this');
    expect(messages[0]?.images).toEqual(['aGVsbG8=']);
  });

  it('carries multi-turn history so the repair prompt has context', async () => {
    mock = await startMockOllama();
    const backend = createOllamaBackend(mock.url);
    await backend.chat(
      [
        { role: 'user', content: 'first', images: ['aGVsbG8='] },
        { role: 'assistant', content: 'garbage' },
        { role: 'user', content: 'try again' },
      ],
      { model: 'gemma3:12b', timeoutMs: 5000 },
    );
    const body = mock.requests.find((r) => r.path === '/api/chat')?.body as Record<string, unknown>;
    expect((body.messages as unknown[]).length).toBe(3);
  });

  it('throws TimeoutError when the model exceeds the deadline', async () => {
    mock = await startMockOllama({ chatDelayMs: 300 });
    const backend = createOllamaBackend(mock.url);
    await expect(
      backend.chat([{ role: 'user', content: 'x' }], { model: 'gemma3:12b', timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('throws BackendUnavailableError on a non-2xx chat response', async () => {
    mock = await startMockOllama({ chatStatus: 500 });
    const backend = createOllamaBackend(mock.url);
    await expect(
      backend.chat([{ role: 'user', content: 'x' }], { model: 'gemma3:12b', timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('throws BackendUnavailableError when the envelope is not JSON', async () => {
    mock = await startMockOllama({ malformedEnvelope: true });
    const backend = createOllamaBackend(mock.url);
    await expect(
      backend.chat([{ role: 'user', content: 'x' }], { model: 'gemma3:12b', timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
