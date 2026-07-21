// Deterministic, instant stand-in for a local Ollama server, used only by the
// VHS demo (demo/demo.tape) so the recording needs no real model. Answers the
// two endpoints offgrid-vision calls: /api/tags (doctor's model check) and
// /api/chat (analyze). Logs to stderr only, so a backgrounded start does not
// pollute the recorded terminal. Run: node demo/mock-ollama.mjs
import { createServer } from 'node:http';

const PORT = 11499;
const MODEL = 'gemma4:12b';

// One canned, schema-valid analysis. Rich enough that the rendered output
// looks real; valid enough that the analyzer does not issue a repair call.
const ANALYSIS = JSON.stringify({
  description:
    'A desktop analytics dashboard: a left sidebar of navigation links beside a ' +
    'central panel with a revenue line chart and summary stat cards.',
  objects: [
    { name: 'sidebar', confidence: 'high' },
    { name: 'line chart', confidence: 'high' },
    { name: 'stat card', confidence: 'medium' },
    { name: 'export button', confidence: 'medium' },
  ],
  text: 'Overview   Revenue   Customers   Settings   Export CSV',
  tags: ['ui', 'dashboard', 'screenshot', 'analytics', 'chart'],
});

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: MODEL, size: 1 }] }));
      return;
    }
    if (req.url === '/api/chat') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: MODEL,
        message: { role: 'assistant', content: ANALYSIS },
        done: true,
      }));
      return;
    }
    res.writeHead(404).end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`mock-ollama listening on http://127.0.0.1:${PORT}\n`);
});
