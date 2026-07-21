# VHS README demo — design

## Goal

Add a terminal-recording GIF to the README that shows `offgrid-vision` in
action, so a reader immediately sees what the tool does. The demo must be
reproducible and fast, and it must not depend on a live Ollama model (real
`gemma4:12b` inference is slow and non-deterministic, which makes for a long,
unrepeatable GIF).

## Approach

Record a scripted demo with [VHS](https://github.com/charmbracelet/vhs). The
CLI runs for real; only the inference backend is faked, by pointing the CLI at
a tiny local mock Ollama server via `OLLAMA_HOST`. Setup (starting the mock,
setting the env var, aliasing the binary) happens inside a VHS `Hide`/`Show`
block so it runs but is not recorded — the visible GIF shows only clean
`offgrid-vision …` commands.

## Components

All new files live in a committed `demo/` directory.

### `demo/mock-ollama.js`

A standalone, dependency-free Node HTTP server (Node's built-in `http`),
mirroring the shape the CLI expects:

- `GET/POST /api/tags` → `{ models: [{ name: "gemma4:12b", size: 1 }] }`, so
  `doctor`'s model-pulled check passes.
- `POST /api/chat` → `{ model, message: { role: "assistant", content }, done: true }`
  where `content` is a single canned, **schema-valid** analysis JSON string of
  the form `{ description, objects, text, tags }`. Returning valid schema
  avoids the analyzer's repair round-trip, keeping the demo to one clean call
  per image.
- Binds to a fixed loopback port (e.g. `127.0.0.1:11499`) so the tape can set
  `OLLAMA_HOST` to a known value. Prints nothing on stdout (or logs to stderr
  only) so background startup doesn't pollute the recording.

The canned reply is intentionally richer than the test default so the rendered
output looks real, e.g. a plausible screenshot description with a couple of
objects, some text, and tags.

### `demo/sample.png`

A small, valid PNG committed to the repo. The CLI detects format from file
contents, so the bytes must be a real PNG. The image is never displayed (the
recording is terminal-only), so its visual content is irrelevant; it exists
only to give `analyze` a real file to read and hash. Generated once (a small
solid/patterned PNG) and committed.

### `demo/demo.tape`

The VHS script.

- `Output demo/offgrid-vision.gif`
- `Set` sensible terminal dimensions/theme/typing speed for a README GIF
  (width ~1000, a readable font size, a moderate `TypingSpeed`).
- **Hidden setup** (`Hide` … `Show`):
  - `cd` to the repo root.
  - Start the mock: `node demo/mock-ollama.js &`
  - `export OLLAMA_HOST=http://127.0.0.1:11499`
  - `alias offgrid-vision="node dist/cli.js"` (so the visible commands read as
    the published name, no `npx`, no absolute paths).
  - `clear`.
- **Recorded story (3 beats)**, each: `Type` the command, `Enter`,
  `Sleep` long enough to read the output:
  1. `offgrid-vision doctor` — green health checks (Node, Ollama reachable,
     model pulled).
  2. `offgrid-vision analyze sample.png` — human-readable summary.
  3. `offgrid-vision analyze sample.png --json` — compact agent JSON.

Beats 2 and 3 render the same mock reply two ways, which is exactly the CLI's
real human-vs-`--json` behavior. The recorded commands use `sample.png`
(the tape `cd`s into `demo/` for the analyze beats, or references
`demo/sample.png`) — final path form chosen during implementation so the
visible command stays short and clean.

### README change

Embed the GIF high in the README, directly under the opening description
paragraph: `![offgrid-vision demo](demo/offgrid-vision.gif)`.

## Non-goals (YAGNI)

- No `record.sh` wrapper — the tape's `Hide` block starts the mock itself, so
  `vhs demo/demo.tape` is the entire record command. A one-line "how to
  re-record" note can live as a comment at the top of the tape.
- No extra beats (`--mode ocr`, directory batch, `install-skill`) — three
  beats keeps the GIF short and focused on the core loop.
- The mock does not need to inspect the request or vary replies per mode; one
  canned schema-valid reply serves every call.

## Model shown

The mock advertises and the output names `gemma4:12b`, matching the README's
documented default, for consistency.

## Testing / verification

- `node demo/mock-ollama.js` starts and answers `curl`s to `/api/tags` and
  `/api/chat` with the expected shapes.
- `vhs demo/demo.tape` runs end to end and produces `demo/offgrid-vision.gif`.
- Visually confirm the GIF: setup is not visible, all three beats render, and
  no error/repair output appears.
- Confirm the mock process is not left running after recording.
