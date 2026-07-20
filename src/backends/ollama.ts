import { BackendUnavailableError } from '../errors.js';
import { TimeoutError, type Backend, type ChatMessage, type ChatOptions } from './backend.js';

/** Short deadline for liveness probes — a healthy local daemon answers instantly. */
const PROBE_TIMEOUT_MS = 5000;

function remediationFor(host: string): string {
  return [
    `Could not reach an Ollama server at ${host}.`,
    '',
    'To fix this:',
    '  1. Install Ollama from https://ollama.com/download',
    '  2. Start it (the desktop app, or run `ollama serve`)',
    '  3. Pull a vision model:  ollama pull gemma3:12b',
    '',
    'On a machine with less than 16 GB of RAM, use the smaller model instead:',
    '  ollama pull gemma3:4b   &&   offgrid-vision analyze <file> --model gemma3:4b',
    '',
    'If Ollama runs on another host or port, set OLLAMA_HOST or pass --host.',
  ].join('\n');
}

interface TagsResponse {
  models?: Array<{ name?: unknown }>;
}

interface ChatResponse {
  message?: { content?: unknown };
}

export function createOllamaBackend(host: string): Backend {
  const base = host.replace(/\/+$/, '');

  async function request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
        throw new TimeoutError(`Request to ${base}${path} exceeded ${timeoutMs} ms`);
      }
      throw new BackendUnavailableError(
        `Cannot connect to Ollama at ${base}`,
        remediationFor(base),
      );
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new BackendUnavailableError(
        `Ollama returned HTTP ${response.status} for ${path}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        remediationFor(base),
      );
    }
    return response;
  }

  async function readJson<T>(response: Response, path: string): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new BackendUnavailableError(
        `Ollama returned a non-JSON response for ${path}`,
        remediationFor(base),
      );
    }
  }

  return {
    name: 'ollama',
    host: base,

    async ping(): Promise<void> {
      await request('/api/tags', { method: 'GET' }, PROBE_TIMEOUT_MS);
    },

    async listModels(): Promise<string[]> {
      const response = await request('/api/tags', { method: 'GET' }, PROBE_TIMEOUT_MS);
      const payload = await readJson<TagsResponse>(response, '/api/tags');
      return (payload.models ?? [])
        .map((entry) => entry.name)
        .filter((name): name is string => typeof name === 'string');
    },

    async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
      const response = await request(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            messages,
            stream: false,
            // Ask Ollama to constrain decoding to JSON; the parser in schema.ts
            // still runs defensively because not every model honors this.
            format: 'json',
            options: { temperature: 0.2 },
          }),
        },
        opts.timeoutMs,
      );
      const payload = await readJson<ChatResponse>(response, '/api/chat');
      const content = payload.message?.content;
      return typeof content === 'string' ? content : '';
    },
  };
}
