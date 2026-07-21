# VHS README Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast, reproducible VHS-recorded terminal GIF to the README that shows `offgrid-vision doctor` and two `analyze` invocations, backed by a local mock Ollama server so no real model inference runs.

**Architecture:** A committed `demo/` directory holds a dependency-free mock Ollama HTTP server, a valid sample PNG, and a VHS `.tape` script. The tape uses a `Hide`/`Show` block to start the mock, point the CLI at it via `OLLAMA_HOST`, and alias the binary — none of which is recorded — then records three clean `offgrid-vision …` commands. The real CLI runs unmodified; only inference is faked.

**Tech Stack:** Node.js ≥20 (built-in `http`, `zlib`, `crypto`), VHS 0.11.0, the existing compiled CLI at `dist/cli.js`.

## Global Constraints

- Zero runtime dependencies — the mock server and PNG generator use only Node built-ins (matches the project's zero-dependency stance).
- Node.js ≥20.
- The model named in mock responses and CLI output is `gemma4:12b` (the README's documented default).
- The analysis JSON the mock returns MUST be schema-valid (`{ description, objects, text, tags }`, where each `objects` entry is `{ name, confidence }` with `confidence` ∈ `high|medium|low`) so the analyzer does not issue a repair round-trip. Verified against `src/schema.ts` and `src/analyzer.ts`.
- The CLI reads the backend host from `OLLAMA_HOST` (confirmed in `src/backends/ollama.ts` remediation text and `src/config.ts`).
- The `dist/` build must exist before recording (`npm run build`). It is already present in this repo.

---

## Task 1: Sample PNG

Produce a small, valid PNG the demo can analyze. The image is never displayed (terminal-only recording), so its pixels are irrelevant — it only needs to pass `sniffFormat`/`readDimensions` in `src/media.ts` (PNG signature `89 50 4E 47 0D 0A 1A 0A` + `IHDR`). We commit both a one-shot generator (for reproducibility) and its output.

**Files:**
- Create: `demo/make-sample.mjs` (one-shot PNG generator)
- Create: `demo/sample.png` (generated output, committed)

**Interfaces:**
- Produces: `demo/sample.png` — a valid 480×300 8-bit RGB PNG consumed by the tape in Task 3.

- [ ] **Step 1: Write the PNG generator**

Create `demo/make-sample.mjs`:

```js
// One-shot generator for demo/sample.png — a valid 480x300 RGB PNG.
// The demo records a terminal only, so the pixels never appear on screen;
// this exists solely to give `analyze` a real, sniffable image file.
// Run once with: node demo/make-sample.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const WIDTH = 480;
const HEIGHT = 300;

// CRC-32 (PNG uses the standard IEEE polynomial).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type 2 = truecolor RGB
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// Raw scanlines: each row is a filter byte (0) followed by WIDTH*3 RGB bytes.
const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
for (let y = 0; y < HEIGHT; y++) {
  const rowStart = y * (1 + WIDTH * 3);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < WIDTH; x++) {
    const p = rowStart + 1 + x * 3;
    raw[p] = 32;       // R
    raw[p + 1] = 122;  // G
    raw[p + 2] = 140;  // B  (a muted teal)
  }
}

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(new URL('./sample.png', import.meta.url), png);
console.log(`wrote sample.png (${png.length} bytes)`);
```

- [ ] **Step 2: Generate the PNG**

Run: `node demo/make-sample.mjs`
Expected: prints `wrote sample.png (…bytes)` and creates `demo/sample.png`.

- [ ] **Step 3: Verify the PNG is accepted by the CLI's sniffer**

Run:
```bash
node -e "import('./dist/media.js').then(async m => { const { readFile } = await import('node:fs/promises'); const b = await readFile('demo/sample.png'); const f = m.sniffFormat(b); console.log(f, JSON.stringify(m.readDimensions(b, f))); })"
```
Expected: `png {"width":480,"height":300}`

(If `dist/media.js` does not exist, run `npm run build` first.)

- [ ] **Step 4: Commit**

```bash
git add demo/make-sample.mjs demo/sample.png
git commit -m "feat(demo): add sample PNG and one-shot generator"
```

---

## Task 2: Mock Ollama server

A standalone HTTP server that answers exactly the two endpoints the CLI calls, with deterministic, instant responses. Modeled on `test/helpers/mock-ollama.ts` but self-contained and fixed-port.

**Files:**
- Create: `demo/mock-ollama.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: an HTTP server on `127.0.0.1:11499` answering `GET /api/tags` and `POST /api/chat`. The tape in Task 3 starts it and sets `OLLAMA_HOST=http://127.0.0.1:11499`.

- [ ] **Step 1: Write the mock server**

Create `demo/mock-ollama.mjs`:

```js
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
```

- [ ] **Step 2: Start the mock and probe `/api/tags`**

Run:
```bash
node demo/mock-ollama.mjs & MOCK=$!
sleep 1
curl -s http://127.0.0.1:11499/api/tags
```
Expected: `{"models":[{"name":"gemma4:12b","size":1}]}`

- [ ] **Step 3: Probe `/api/chat` and confirm valid schema content**

Run:
```bash
curl -s -X POST http://127.0.0.1:11499/api/chat -d '{}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s).message.content;const a=JSON.parse(c);console.log('desc:',a.description.slice(0,20),'| objects:',a.objects.length,'| tags:',a.tags.length);})"
```
Expected: `desc: A desktop analytics  | objects: 4 | tags: 5`

- [ ] **Step 4: Run the real CLI against the mock end to end**

Run:
```bash
OLLAMA_HOST=http://127.0.0.1:11499 node dist/cli.js analyze demo/sample.png --json
```
Expected: a single JSON object on stdout with `analysis.description` starting "A desktop analytics dashboard", `analysis.objects` length 4, and `error: null`. No repair/retry noise on stderr.

- [ ] **Step 5: Stop the mock**

Run: `kill $MOCK`
Expected: the background process exits.

- [ ] **Step 6: Commit**

```bash
git add demo/mock-ollama.mjs
git commit -m "feat(demo): add mock Ollama server for the VHS demo"
```

---

## Task 3: Tape, recorded GIF, and README embed

Write the VHS script, record the GIF, and reference it in the README. Run all commands from the repo root so `Output` and `dist/` paths resolve.

**Files:**
- Create: `demo/demo.tape`
- Create: `demo/offgrid-vision.gif` (recorded output, committed)
- Modify: `README.md` (embed the GIF under the intro paragraph)

**Interfaces:**
- Consumes: `demo/sample.png` (Task 1), `demo/mock-ollama.mjs` (Task 2), `dist/cli.js`.
- Produces: `demo/offgrid-vision.gif`.

- [ ] **Step 1: Write the tape**

Create `demo/demo.tape`:

```tape
# Record with:  vhs demo/demo.tape   (run from the repo root)
# Setup (mock server, OLLAMA_HOST, alias) runs inside Hide/Show so it is not
# recorded; the visible GIF shows only the offgrid-vision commands.
Output demo/offgrid-vision.gif

Set Shell "bash"
Set FontSize 18
Set Width 1100
Set Height 720
Set Padding 24
Set TypingSpeed 55ms

Hide
Type 'export OGV_ROOT="$PWD"'
Enter
Type 'node "$OGV_ROOT/demo/mock-ollama.mjs" 2>/dev/null &'
Enter
Type 'export OLLAMA_HOST=http://127.0.0.1:11499'
Enter
Type 'alias offgrid-vision="node $OGV_ROOT/dist/cli.js"'
Enter
Type 'cd "$OGV_ROOT/demo"'
Enter
Sleep 1s
Type 'clear'
Enter
Show

Sleep 1s
Type "offgrid-vision doctor"
Enter
Sleep 3s

Type "offgrid-vision analyze sample.png"
Enter
Sleep 4s

Type "offgrid-vision analyze sample.png --json"
Enter
Sleep 4s

Hide
Type 'pkill -f mock-ollama.mjs'
Enter
Show
```

- [ ] **Step 2: Ensure the build exists**

Run: `npm run build`
Expected: `dist/cli.js` present, no TypeScript errors.

- [ ] **Step 3: Record the GIF**

Run (from repo root): `vhs demo/demo.tape`
Expected: exits 0 and writes `demo/offgrid-vision.gif`.

- [ ] **Step 4: Verify no leftover mock process**

Run: `pgrep -f mock-ollama.mjs && echo LEFTOVER || echo clean`
Expected: `clean`. (If `LEFTOVER`, run `pkill -f mock-ollama.mjs`.)

- [ ] **Step 5: Visually confirm the GIF**

Open `demo/offgrid-vision.gif` (Read tool renders it). Confirm:
- The setup commands (export/alias/mock) are NOT visible.
- `offgrid-vision doctor` shows passing checks naming `gemma4:12b`.
- `analyze sample.png` shows the human-readable summary (description, objects, tags).
- `analyze sample.png --json` shows the compact JSON.
- No error, timeout, or repair output appears.

If anything is off (timing too fast to read, output clipped by `Height`, setup leaking), adjust `Sleep`/`Set` values in `demo/demo.tape` and re-run Step 3.

- [ ] **Step 6: Embed in the README**

In `README.md`, immediately after the opening description paragraph (the block ending "…reach for it automatically.") and before the `## Why local` heading, insert:

```markdown

![offgrid-vision analyzing an image from the terminal](demo/offgrid-vision.gif)
```

- [ ] **Step 7: Commit**

```bash
git add demo/demo.tape demo/offgrid-vision.gif README.md
git commit -m "feat(demo): record VHS demo GIF and embed in README"
```

---

## Self-Review notes

- **Spec coverage:** `demo/mock-ollama.mjs` (Task 2) ✓, `demo/sample.png` (Task 1) ✓, `demo/demo.tape` with Hide/Show setup and 3 beats (Task 3) ✓, `demo/offgrid-vision.gif` + README embed (Task 3) ✓. Non-goals honored: no `record.sh` (re-record note lives as a comment atop the tape), no extra beats, single canned reply.
- **Model naming:** `gemma4:12b` used consistently in the mock and asserted in the doctor beat.
- **Schema validity:** mock reply uses `objects: [{name, confidence}]`, `description`/`text` strings, `tags` string array — matches `src/schema.ts`; asserted end-to-end in Task 2 Step 4.
- **Paths:** every command runs from the repo root; the tape captures `$OGV_ROOT="$PWD"` before `cd`-ing into `demo/`, so the alias and mock path stay valid and `Output` resolves to `demo/offgrid-vision.gif`.
- **File extension note:** generator and mock use `.mjs` so they run as ESM regardless of any local `package.json` context and are unambiguous one-shot scripts, distinct from the compiled `dist/*.js`.
