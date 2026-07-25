import { SKILL_NAME } from './paths.js';

/**
 * FR-3.3: the description is the entire trigger surface. It must say what the
 * skill does AND when to reach for it, assertively, on one line of valid YAML.
 */
const SKILL_DESCRIPTION =
  'Analyze images, screenshots, photos, diagrams, charts, and scanned documents locally with an on-device model, without consuming multimodal tokens. Use this whenever the user provides or references an image file, screenshot, photo, chart, diagram, or scanned document and its content needs to be understood, described, transcribed, or have text extracted — even if they do not explicitly ask for "image analysis".';

export function renderSkillMd(version: string): string {
  return `---
name: ${SKILL_NAME}
description: ${SKILL_DESCRIPTION}
---

# Local image analysis with offgrid-vision

Analyzing an image with your own vision capability costs thousands of tokens per
image. This CLI runs a multimodal model on the user's machine and hands back a
compact JSON summary instead — typically a few hundred tokens, and the image
never leaves the machine.

Installed by offgrid-vision v${version}.

## Before the first use in a session

Run the preflight check once per session, before your first analysis:

\`\`\`bash
npx offgrid-vision doctor
\`\`\`

Exit code 0 means you are good for the rest of the session — do not run it again.
A non-zero exit prints exactly what the user needs to do (install Ollama, or pull
the model). Show that remediation to the user rather than silently falling back.

## Analyzing images

Always pass \`--json\` and read **stdout**. Progress and warnings go to stderr;
stdout is exclusively the JSON payload.

\`\`\`bash
npx offgrid-vision analyze path/to/image.png --json
\`\`\`

**Batch every image into one invocation.** Each call pays process startup and
model load; one call with five paths is far cheaper than five calls.

\`\`\`bash
npx offgrid-vision analyze shot-1.png shot-2.png diagram.jpg --json
\`\`\`

A directory works too, and is walked recursively:

\`\`\`bash
npx offgrid-vision analyze ./screenshots --json
\`\`\`

## Choosing a mode

\`--mode\` tunes the analysis. Pick by what the user actually needs:

| Mode | Use when |
|---|---|
| \`general\` | Default. "What's in this image?", general description, unknown content. |
| \`ocr\` | The user wants the text: receipts, scanned documents, code screenshots, error messages. Transcribes verbatim. |
| \`alt-text\` | Writing accessibility alt text. Returns one short sentence. |
| \`ui\` | Screenshots of applications or websites: layout, visible controls, error and empty states. |

\`\`\`bash
npx offgrid-vision analyze receipt.jpg --json --mode ocr
\`\`\`

## Narrowing the analysis

Add \`--prompt\` when the user cares about something specific. The standard
schema still comes back — the instruction only shifts the model's focus.

\`\`\`bash
npx offgrid-vision analyze bug.png --json --mode ui --prompt "focus on the error message and the stack trace"
\`\`\`

Do not use \`--prompt\` to ask for a different output shape; the schema is fixed.

## Reading the output

One file returns a single object; multiple files return an array of them. The
full contract is in \`references/schema.md\` — read it if you need field-level
detail. The short version:

- \`analysis.description\` — the natural-language summary
- \`analysis.text\` — text found in the image, \`""\` when there is none
- \`analysis.objects\` — \`{ name, confidence }\` entries
- \`analysis.tags\` — keywords
- \`error\` — \`null\` on success, otherwise \`{ code, message }\`

Check \`error\` on **every** element. A batch run continues past individual
failures, so a successful exit for the run does not mean every file succeeded.

If \`analysis.parse_error\` is true, the local model returned something that was
not valid JSON; the unparsed reply is in \`analysis.raw\`. Use it if it is
readable, and say that the output was unstructured.

## Useful flags

| Flag | Effect |
|---|---|
| \`--model <name>\` | Override the model, e.g. \`qwen3.5:2b\` on a low-memory machine; \`offgrid-vision doctor\` names the size that fits |
| \`--timeout <ms>\` | Per-file deadline, default 120000 |
| \`--concurrency <n>\` | Up to 4 files in flight; helps on large batches |
| \`--no-recursive\` | Do not descend into subdirectories |

## Fallback rule

If the tool is unavailable — Ollama not installed, model missing, repeated
errors — you may fall back to your own vision capability, but **inform the user**
you did so and pass along the remediation from \`doctor\`. Never fail the user's
request just because the local path did not work, and never silently burn
multimodal tokens when they installed this skill specifically to avoid that.
`;
}

export function renderSchemaMd(version: string): string {
  return `# offgrid-vision output schema

The contract emitted by \`offgrid-vision analyze --json\`, as of v${version}.
Changes to it are semver-major.

## Envelope

One input file produces one object. A single path yields that object directly;
multiple paths yield an array of them, in sorted path order.

\`\`\`json
{
  "file": "/home/user/screenshots/error.png",
  "model": "qwen3.5:4b",
  "duration_ms": 8421,
  "analysis": {
    "description": "A desktop application showing a modal error dialog.",
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
    "sha256": "9f2c...",
    "analyzed_at": "2026-07-21T10:15:00.000Z"
  },
  "error": null
}
\`\`\`

## Fields

| Field | Type | Notes |
|---|---|---|
| \`file\` | string | Absolute path to the analyzed file |
| \`model\` | string | Model that produced the analysis |
| \`duration_ms\` | number | Wall-clock time for this file |
| \`analysis\` | object \\| null | \`null\` when the file failed |
| \`analysis.description\` | string | One-paragraph natural-language description |
| \`analysis.objects\` | array | \`{ name: string, confidence: "high" \\| "medium" \\| "low" }\` |
| \`analysis.text\` | string | Text found in the image; \`""\` when there is none |
| \`analysis.tags\` | string[] | 5–15 short keywords |
| \`analysis.raw\` | string? | Present only when parsing failed |
| \`analysis.parse_error\` | boolean? | \`true\` only when parsing failed |
| \`metadata\` | object \\| null | Computed by the tool, not the model |
| \`metadata.bytes\` | number | File size |
| \`metadata.format\` | string | \`png\`, \`jpeg\`, \`webp\`, \`gif\`, \`bmp\`, or \`tiff\` — detected from content |
| \`metadata.width\` | number \\| null | \`null\` when not cheaply readable (e.g. TIFF) |
| \`metadata.height\` | number \\| null | Same |
| \`metadata.sha256\` | string | Hex digest of the file bytes |
| \`metadata.analyzed_at\` | string | ISO 8601 timestamp |
| \`error\` | object \\| null | \`null\` on success |

## Error codes

| Code | Meaning |
|---|---|
| \`TIMEOUT\` | Inference exceeded the per-file deadline |
| \`PARSE_ERROR\` | Model output was not valid JSON even after a repair attempt; see \`analysis.raw\` |
| \`BACKEND_UNAVAILABLE\` | Ollama unreachable, or the model is not installed |
| \`UNSUPPORTED_FORMAT\` | The file is not a supported image, judged by content |
| \`IO_ERROR\` | The file could not be read |

## With --out

\`--out <file>\` writes a report rather than a bare array:

\`\`\`
{ "results": [ ...envelopes... ], "summary": { "total", "ok", "failed", "model", "duration_ms" } }
\`\`\`

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | One or more files failed |
| 2 | Usage error — bad flags or arguments |
| 3 | Backend unavailable: Ollama down or the model is missing |
`;
}
