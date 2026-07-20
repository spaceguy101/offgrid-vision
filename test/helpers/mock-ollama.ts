import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

export interface MockOllamaOptions {
  /** Model names returned from /api/tags. */
  models?: string[];
  /** Successive /api/chat reply bodies. The last one repeats once exhausted. */
  chatReplies?: string[];
  /** Milliseconds to stall before answering /api/chat, to exercise timeouts. */
  chatDelayMs?: number;
  /** HTTP status for /api/chat. Defaults to 200. */
  chatStatus?: number;
  /** Return malformed HTTP-level JSON from /api/chat. */
  malformedEnvelope?: boolean;
}

export interface MockOllama {
  url: string;
  /** Every request path the server received, in order. */
  requests: Array<{ path: string; body: unknown }>;
  close(): Promise<void>;
}

export async function startMockOllama(opts: MockOllamaOptions = {}): Promise<MockOllama> {
  const models = opts.models ?? ['gemma3:12b'];
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
        const reply = chatReplies[Math.min(chatCount, chatReplies.length - 1)] ?? '';
        chatCount += 1;
        const send = (): void => {
          const status = opts.chatStatus ?? 200;
          res.writeHead(status, { 'content-type': 'application/json' });
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
        if (opts.chatDelayMs) setTimeout(send, opts.chatDelayMs).unref();
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
