# Requirements Document: `offgrid-vision` — Local Media Analysis Tool

**Version:** 1.0
**Status:** Draft — ready for implementation
**Target implementer:** Claude Code
**Reference project:** https://github.com/Siddhant-K-code/gemma-vision (Go CLI, Ollama-backed image intelligence — use as inspiration for UX, not architecture)

---

## 1. Objective

Reduce cloud LLM token consumption and operating costs by offloading static media analysis (images, documents-as-images, etc.) to a locally hosted multimodal model. The deliverable is a Node.js CLI tool, invocable via `npx`, that any application or AI agent harness can call. The tool must also be able to install an **Agent Skill** into a harness (e.g., Claude Code) so the harness knows when and how to invoke the CLI instead of consuming its own multimodal tokens.

## 2. Background

Media analysis currently flows through cloud-based multimodal LLMs, which is expensive (token cost per image is high), slower (network round trips), and less private. Modern local multimodal models (e.g., Gemma 3 12B via Ollama) are now capable of image description, object detection, and OCR at acceptable quality on consumer hardware. Agent harnesses can delegate this work: instead of attaching an image to a cloud LLM request, the agent runs the CLI locally and receives compact structured text back — dramatically cheaper in tokens.

## 3. Scope

**In scope (v1):**
- Static images: PNG, JPEG/JPG, WebP, GIF (first frame), BMP, TIFF. PDF pages are a stretch goal (see §11).
- Local inference via **Ollama** as the default backend (HTTP API at `http://localhost:11434`), with the backend abstracted so others (LM Studio / any OpenAI-compatible endpoint) can be added later.
- CLI interface (npx-invocable) with structured JSON output.
- Skill installation subcommand that installs a SKILL.md-based Agent Skill into supported harnesses.

**Out of scope (v1):**
- Video analysis.
- Audio analysis.
- Model management beyond checking availability and suggesting `ollama pull`.
- A long-running HTTP server (stretch goal, §11 — the CLI itself is the v1 interface).

## 4. Technology Requirements

| Item | Requirement |
|---|---|
| Runtime | Node.js ≥ 20 (LTS). Pure ESM. |
| Distribution | Published as an npm package with a `bin` entry so `npx offgrid-vision <cmd>` works with zero install. |
| Dependencies | Minimal. Prefer built-ins (`fetch`, `fs`, `path`, `util.parseArgs` or a tiny arg parser like `commander`). No heavyweight ML deps — inference happens in Ollama, not in Node. |
| Default model | `gemma3:12b`. Overridable via `--model` flag and `OFFGRID_MODEL` env var. |
| Backend host | `--host` flag / `OLLAMA_HOST` env var, default `http://localhost:11434`. |
| Platforms | macOS, Linux, Windows. No shell-specific assumptions in code (skill installer must handle Windows paths). |

## 5. Functional Requirements

### FR-1: Analyze command (core)

`npx offgrid-vision analyze <path...> [options]`

1. **FR-1.1** Accept one or more file paths, or a directory (recursively discover supported image types; provide `--no-recursive` to disable recursion).
2. **FR-1.2** For each file: validate it exists and is a supported format (sniff magic bytes, don't trust extensions alone); base64-encode and send to the Ollama `/api/chat` (or `/api/generate`) endpoint with an analysis prompt.
3. **FR-1.3** Produce a **structured analysis** per file containing at minimum:
   - `description` — one-paragraph natural-language description
   - `objects` — array of detected objects/entities with a confidence qualifier (model-reported, best-effort)
   - `text` — OCR/extracted text found in the image (empty string if none)
   - `tags` — 5–15 short keyword tags
   - `metadata` — file-level facts computed by the tool itself (filename, byte size, dimensions if cheaply obtainable, format, sha256 hash, analysis timestamp, model used, inference duration ms)
4. **FR-1.4** Achieve structured output by instructing the model to respond in strict JSON and parsing defensively (strip code fences, retry once with a repair prompt on parse failure; if it still fails, return the raw text under a `raw` field with `parse_error: true` rather than crashing).
5. **FR-1.5** Output modes:
   - Default: human-readable summary to stdout.
   - `--json`: machine-readable JSON to stdout (single object for one file, array for many). **This is the mode agents will use — it must be the most robust path.** All logs/progress go to stderr so stdout stays clean JSON.
   - `--out <file>`: write JSON to a file.
6. **FR-1.6** `--prompt "<custom instruction>"`: append a caller-supplied focus instruction (e.g., "focus on any error messages visible in this screenshot") while still returning the standard schema.
7. **FR-1.7** `--mode <preset>`: presets that tune the analysis prompt — at minimum `general` (default), `ocr` (prioritize verbatim text extraction), `alt-text` (short accessibility description), `ui` (screenshot analysis: layout, visible controls, error states).
8. **FR-1.8** Process multiple files sequentially by default; `--concurrency <n>` (default 1, max 4) for parallelism. Emit per-file progress on stderr.
9. **FR-1.9** Timeout per file (default 120 s, `--timeout` flag). On timeout, record an error entry for that file and continue with the rest.

### FR-2: Preflight / doctor command

`npx offgrid-vision doctor`

1. **FR-2.1** Check: Ollama reachable at configured host; configured model is pulled (query `/api/tags`); Node version adequate.
2. **FR-2.2** On failure, print actionable remediation (e.g., install link for Ollama, exact `ollama pull gemma3:12b` command, RAM guidance suggesting a smaller model like `gemma3:4b` for low-memory machines).
3. **FR-2.3** Exit code 0 when healthy, non-zero otherwise, so scripts/agents can gate on it.
4. **FR-2.4** The `analyze` command runs a fast version of this preflight automatically and fails with the same actionable messages (also embedded in JSON error output when `--json` is set).

### FR-3: Skill installation command

`npx offgrid-vision install-skill [--harness <name>] [--scope user|project] [--dir <path>]`

The purpose: after installation, an agent harness will automatically know to delegate image analysis to this CLI instead of spending cloud multimodal tokens.

1. **FR-3.1** Generate and install an Agent Skill — a directory containing a `SKILL.md` with YAML frontmatter (`name`, `description`) followed by markdown instructions. Skill name: `offgrid-vision`.
2. **FR-3.2** Supported install targets in v1:
   - `--harness claude-code --scope user` → `~/.claude/skills/offgrid-vision/`
   - `--harness claude-code --scope project` → `<cwd>/.claude/skills/offgrid-vision/`
   - `--harness generic --dir <path>` → any directory the user specifies (for other harnesses that consume SKILL.md-style skills).
   - With no flags: interactively detect (does `~/.claude` or `./.claude` exist?) and prompt; in non-TTY environments default to `claude-code`/`user` scope.
3. **FR-3.3** The generated SKILL.md `description` frontmatter must be written for reliable triggering: it should state what the skill does AND when to use it, phrased assertively (e.g., "Analyze images, screenshots, photos, and diagrams locally without consuming multimodal tokens. Use this whenever the user provides or references an image file, screenshot, photo, chart, or scanned document and its content needs to be understood, described, or have text extracted — even if they don't explicitly ask for 'image analysis'.").
4. **FR-3.4** The SKILL.md body must teach the harness to use the CLI efficiently:
   - Run `npx offgrid-vision doctor` once per session before first use; if it fails, surface the remediation to the user rather than silently falling back.
   - Always invoke with `--json` and read stdout.
   - How to choose `--mode` presets and when to pass `--prompt`.
   - Batch multiple images in one invocation rather than one call per image.
   - Interpret the output schema (include the schema in the skill body or a bundled `references/schema.md`).
   - Fallback rule: if the local tool is unavailable or errors, the harness may proceed with its own capabilities and inform the user.
5. **FR-3.5** Idempotent installs: re-running overwrites the skill in place (with a note that it updated); `--force` not required for overwrite of our own skill, but never touch other directories.
6. **FR-3.6** `uninstall-skill` with the same targeting flags removes exactly the directory the installer created.
7. **FR-3.7** Skill content is generated from templates bundled in the npm package so the installed skill always references the CLI version that installed it.

### FR-4: General CLI behavior

1. **FR-4.1** `--help` per command, `--version`, sensible exit codes (0 success, 1 runtime error, 2 usage error, 3 backend unavailable).
2. **FR-4.2** All configuration resolvable via flags > env vars > defaults. Env vars: `OFFGRID_MODEL`, `OLLAMA_HOST`, `OFFGRID_TIMEOUT`.
3. **FR-4.3** Never upload media anywhere except the configured local backend host. If the host is not localhost/127.0.0.1, print a one-line warning to stderr (privacy is a core selling point).

## 6. Output Schema (contract)

```json
{
  "file": "screenshots/error.png",
  "model": "gemma3:12b",
  "duration_ms": 8421,
  "analysis": {
    "description": "A desktop application showing a modal error dialog...",
    "objects": [
      { "name": "error dialog", "confidence": "high" },
      { "name": "close button", "confidence": "medium" }
    ],
    "text": "Error: connection refused (code 111)",
    "tags": ["screenshot", "error-dialog", "desktop-app"]
  },
  "metadata": {
    "bytes": 148223,
    "format": "png",
    "width": 1280,
    "height": 800,
    "sha256": "…",
    "analyzed_at": "2026-07-21T10:15:00Z"
  },
  "error": null
}
```

Failed files use the same envelope with `analysis: null` and `error: { "code": "TIMEOUT" | "PARSE_ERROR" | "BACKEND_UNAVAILABLE" | "UNSUPPORTED_FORMAT" | "IO_ERROR", "message": "…" }`. Multi-file runs return an array plus a top-level summary when `--out` is used. **This schema is the public contract — document it in the README and the installed skill, and treat changes as semver-major.**

## 7. Non-Functional Requirements

1. **NFR-1 Privacy:** No telemetry, no network calls other than the configured backend and npm itself during npx bootstrap.
2. **NFR-2 Cold-start UX:** From a machine with Ollama + model already present, `npx offgrid-vision analyze pic.png --json` must work with zero configuration.
3. **NFR-3 Robustness for agents:** stdout is exclusively the requested payload in `--json` mode; deterministic exit codes; no interactive prompts unless a TTY is present.
4. **NFR-4 Performance:** Tool overhead (excluding model inference) under ~500 ms per file. Stream nothing into memory unnecessarily; encode files as streams/buffers per file, not all at once.
5. **NFR-5 Code quality:** TypeScript, strict mode, compiled to ESM for publish. Unit tests for arg parsing, format sniffing, JSON repair/parsing, and skill-file generation; integration test against a mocked Ollama HTTP server (do not require a real model in CI).
6. **NFR-6 Docs:** README covering install, prerequisites, all commands/flags, the output schema, agent-integration guidance, and a "why local" cost/privacy rationale.

## 8. Suggested Project Structure

```
offgrid-vision/
├── src/
│   ├── cli.ts               # entry, command routing
│   ├── commands/
│   │   ├── analyze.ts
│   │   ├── doctor.ts
│   │   └── install-skill.ts
│   ├── backends/
│   │   ├── backend.ts       # interface: analyzeImage(buffer, opts) -> Analysis
│   │   └── ollama.ts
│   ├── prompts/             # mode presets + JSON-output instruction
│   ├── schema.ts            # output types + zod (or hand-rolled) validation
│   ├── media.ts             # discovery, magic-byte sniffing, hashing, dimensions
│   └── skill/
│       ├── templates/       # SKILL.md + references templates
│       └── install.ts       # path resolution per harness/scope/OS
├── test/
├── package.json             # "bin": { "offgrid-vision": "dist/cli.js" }
└── README.md
```

## 9. Acceptance Criteria

1. `npx offgrid-vision analyze sample.png --json` on a machine with Ollama + gemma3:12b returns valid JSON matching §6 within the timeout.
2. `analyze ./folder --json` processes all supported images, continues past individual failures, and returns an array with per-file error entries where applicable.
3. `doctor` correctly detects and explains: Ollama down, model missing, all-healthy — with matching exit codes.
4. `install-skill --harness claude-code --scope project` creates `.claude/skills/offgrid-vision/SKILL.md`; a Claude Code session in that project subsequently uses the CLI when asked "what's in screenshot.png" (manual verification acceptable).
5. `uninstall-skill` removes exactly what was installed.
6. Piping an unsupported file yields a structured `UNSUPPORTED_FORMAT` error, not a crash.
7. All unit/integration tests pass without a live model.

## 10. Implementation Notes for Claude Code

- Build incrementally in this order: schema + Ollama backend + `analyze` (single file) → multi-file/directory → `doctor` → output modes/presets → `install-skill`/`uninstall-skill` → tests → README.
- Mock the Ollama API in tests with a local HTTP server returning canned `/api/tags` and `/api/chat` responses, including a malformed-JSON response to exercise the repair path.
- Keep every prompt template in `src/prompts/` as plain exported strings so they're easy to iterate on.
- Windows: resolve `~` via `os.homedir()`; never assemble paths with string concatenation.

## 11. Stretch Goals (do not block v1)

- `serve` command: long-running local HTTP server exposing `POST /analyze` with the same schema, for non-CLI consumers.
- PDF support by rasterizing pages (behind an optional dependency).
- Additional backends: LM Studio / generic OpenAI-compatible `/v1/chat/completions`.
- Response caching keyed on `sha256 + model + mode + prompt` to make repeat agent calls free.
- Skill installer targets for additional harnesses as their skill conventions stabilize.
