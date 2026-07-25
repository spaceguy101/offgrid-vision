import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

export interface MockOllamaOptions {
  /** Model names returned from /api/tags. */
  models?: string[];
  /** Successive /api/chat reply bodies. The last one repeats once exhausted. */
  chatReplies?: string[];
  /**
   * Milliseconds to stall before answering /api/chat, to exercise timeouts.
   * A single number applies to every call; an array applies per call by
   * index (0-based), repeating the last entry once exhausted — mirrors
   * chatReplies, so e.g. [0, 300] keeps the first call fast and stalls only
   * the second (the repair round-trip).
   */
  chatDelayMs?: number | number[];
  /**
   * HTTP status for /api/chat. Defaults to 200. A single number applies to
   * every call; an array applies per call by index, repeating the last
   * entry once exhausted (mirrors chatReplies/chatDelayMs).
   */
  chatStatus?: number | number[];
  /** Return malformed HTTP-level JSON from /api/chat. */
  malformedEnvelope?: boolean;
  /**
   * Milliseconds to stall after writing the response head but before writing
   * the body, to exercise a stall mid-body-read (headers flush immediately,
   * body arrives late) as distinct from chatDelayMs (nothing flushes until
   * the whole response is ready).
   */
  bodyDelayMs?: number;
}

export interface MockOllama {
  url: string;
  /** Every request path the server received, in order. */
  requests: Array<{ path: string; body: unknown }>;
  close(): Promise<void>;
}

/**
 * Resolves a per-call option that may be a single value (applies to every
 * call) or an array indexed by call number, repeating the last entry once
 * exhausted — same convention as chatReplies.
 */
function perCall<T>(opt: T | T[] | undefined, index: number, fallback: T): T {
  if (opt === undefined) return fallback;
  if (Array.isArray(opt)) {
    if (opt.length === 0) return fallback;
    return opt[Math.min(index, opt.length - 1)] as T;
  }
  return opt;
}

export async function startMockOllama(opts: MockOllamaOptions = {}): Promise<MockOllama> {
  const models = opts.models ?? ['qwen3.5:4b'];
  const chatReplies = opts.chatReplies ?? ['{"description":"a test image","objects":[],"text":"","tags":["test"]}'];
  const requests: Array<{ path: string; body: unknown }> = [];
  let chatCount = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body: unknown = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = rawBody;
      }
      requests.push({ path: req.url ?? '', body });

      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: models.map((name) => ({ name, size: 1 })) }));
        return;
      }

      if (req.url === '/api/chat') {
        // Capture this call's index before incrementing so per-call options
        // (chatReplies/chatDelayMs/chatStatus) all line up on the same call,
        // regardless of how long a prior call's timers took to fire.
        const callIndex = chatCount;
        chatCount += 1;
        const reply = chatReplies[Math.min(callIndex, chatReplies.length - 1)] ?? '';
        const writeBody = (): void => {
          if (opts.malformedEnvelope) {
            res.end('this is not json at all');
            return;
          }
          res.end(JSON.stringify({
            model: models[0],
            message: { role: 'assistant', content: reply },
            done: true,
          }));
        };
        const send = (): void => {
          const status = perCall(opts.chatStatus, callIndex, 200);
          res.writeHead(status, { 'content-type': 'application/json' });
          if (opts.bodyDelayMs) {
            // Force headers onto the wire now, before stalling the body —
            // writeHead() alone buffers until the first write()/end().
            res.flushHeaders();
            setTimeout(writeBody, opts.bodyDelayMs).unref();
          } else {
            writeBody();
          }
        };
        const delayMs = perCall(opts.chatDelayMs, callIndex, 0);
        if (delayMs) setTimeout(send, delayMs).unref();
        else send();
        return;
      }

      res.writeHead(404).end();
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}
