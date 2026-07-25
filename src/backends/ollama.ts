import { BackendUnavailableError } from '../errors.js';
import { tierTableLines } from '../models.js';
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
    '  3. Pull a vision model sized for this machine:',
    // This path knows a host but not the local RAM, so it prints the whole
    // table; `doctor` narrows it to one line once the server answers.
    ...tierTableLines('       '),
    '',
    'Then run `offgrid-vision doctor` — it detects this machine\'s RAM and names the model to use.',
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

/** AbortSignal.timeout() rejects with a DOMException named 'TimeoutError', not our class. */
function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
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
      if (isAbortError(cause)) {
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

  async function readJson<T>(response: Response, path: string, timeoutMs: number): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch (cause) {
      // Ollama can flush response headers before the body is ready, so a slow
      // or large body can stall past the deadline after fetch() has already
      // resolved. That must still surface as TimeoutError, not a generic
      // "non-JSON response" — the caller needs to know it was slow, not broken.
      if (isAbortError(cause)) {
        throw new TimeoutError(`Request to ${base}${path} exceeded ${timeoutMs} ms`);
      }
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
      const payload = await readJson<TagsResponse>(response, '/api/tags', PROBE_TIMEOUT_MS);
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
      const payload = await readJson<ChatResponse>(response, '/api/chat', opts.timeoutMs);
      const content = payload.message?.content;
      return typeof content === 'string' ? content : '';
    },
  };
}
