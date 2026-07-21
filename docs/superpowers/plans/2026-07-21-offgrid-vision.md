# offgrid-vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `offgrid-vision`, an npx-invocable Node.js CLI that analyzes images with a local Ollama multimodal model and installs an Agent Skill so harnesses delegate image work to it instead of burning cloud multimodal tokens.

**Architecture:** Pure-ESM TypeScript compiled to `dist/`. A thin `cli.ts` router dispatches to three commands (`analyze`, `doctor`, `install-skill`/`uninstall-skill`). All I/O-free logic lives in small single-responsibility modules (`config`, `media`, `schema`, `prompts`, `render`, `skill/paths`, `skill/templates`) that are trivially unit-testable; the only network boundary is a `Backend` interface with one implementation (`backends/ollama.ts`), which tests replace with a real local `node:http` server serving canned responses. No ML dependencies — inference happens inside Ollama.

**Tech Stack:** Node.js ≥ 20, TypeScript 5 (strict, ESM), `node:util.parseArgs` for flags, built-in `fetch`, `node:crypto`, `node:fs/promises`. Vitest for unit + integration tests. Zero runtime dependencies.

## Global Constraints

Every task's requirements implicitly include this section.

- **Node.js ≥ 20**, pure ESM. `"type": "module"` in package.json. No CommonJS, no `require()` except `createRequire` for reading `package.json`.
- **Zero runtime dependencies.** devDependencies limited to `typescript`, `vitest`, `@types/node`. Adding any other dependency is a plan violation.
- **TypeScript strict mode.** `"strict": true`, `"noUncheckedIndexedAccess": true`. No `any` in exported signatures.
- **Package name:** `offgrid-vision`. Bin name: `offgrid-vision`. Starting version: `0.1.0`.
- **Default model:** `gemma3:12b`. **Default host:** `http://localhost:11434`. **Default timeout:** `120000` ms.
- **Env vars, exact names:** `OFFGRID_MODEL`, `OLLAMA_HOST`, `OFFGRID_TIMEOUT`.
- **Config precedence:** flags > env vars > defaults. Always, everywhere.
- **Exit codes:** `0` success, `1` runtime error, `2` usage error, `3` backend unavailable.
- **Error codes (string literals):** `TIMEOUT`, `PARSE_ERROR`, `BACKEND_UNAVAILABLE`, `UNSUPPORTED_FORMAT`, `IO_ERROR`.
- **Supported formats (string literals):** `png`, `jpeg`, `webp`, `gif`, `bmp`, `tiff`.
- **Modes (string literals):** `general`, `ocr`, `alt-text`, `ui`.
- **In `--json` mode stdout carries the payload and nothing else.** Every log, warning, and progress line goes to stderr. This is non-negotiable — agents parse stdout.
- **Never send media anywhere but the configured backend host.** No telemetry, ever.
- **Paths:** always `node:path` joins; resolve `~` via `os.homedir()`. Never concatenate path strings. Code must run unchanged on Windows.
- **Tests must never require a live model or a real Ollama install.**
- **The §6 output schema in the requirements doc is a public contract.** Field names are exact: `file`, `model`, `duration_ms`, `analysis`, `metadata`, `error`, and within them `description`, `objects[].name`, `objects[].confidence`, `text`, `tags`, `bytes`, `format`, `width`, `height`, `sha256`, `analyzed_at`.

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Package manifest, `bin` entry, scripts |
| `tsconfig.json` | Strict TS config for editor + vitest |
| `tsconfig.build.json` | Emit-only config producing `dist/` |
| `vitest.config.ts` | Test runner config |
| `src/version.ts` | Reads own version from package.json |
| `src/errors.ts` | Exit codes, error-code union, typed error classes |
| `src/config.ts` | Flag/env/default resolution, localhost detection |
| `src/media.ts` | Magic-byte sniffing, dimension parsing, sha256, file discovery |
| `src/schema.ts` | Output types + defensive parsing/normalization of model JSON |
| `src/prompts/index.ts` | Mode presets, JSON-output instruction, repair prompt |
| `src/backends/backend.ts` | `Backend` interface + shared message types |
| `src/backends/ollama.ts` | Ollama HTTP implementation |
| `src/analyzer.ts` | Orchestrates one file → `AnalysisResult` (read, sniff, call, parse, repair) |
| `src/render.ts` | Human-readable stdout rendering |
| `src/commands/analyze.ts` | `analyze` command: discovery, concurrency, output modes, exit code |
| `src/commands/doctor.ts` | `doctor` command + reusable fast preflight |
| `src/commands/install-skill.ts` | `install-skill` / `uninstall-skill` commands |
| `src/skill/paths.ts` | Harness/scope → directory resolution, auto-detection |
| `src/skill/templates.ts` | SKILL.md + references/schema.md content generators |
| `src/skill/install.ts` | Write/remove the skill directory idempotently |
| `src/cli.ts` | Shebang, arg routing, `--help`, `--version`, top-level error handling |
| `test/helpers/fixtures.ts` | Synthetic image buffers for each format |
| `test/helpers/mock-ollama.ts` | Local HTTP server impersonating Ollama |

Tasks build strictly bottom-up: leaf modules with no imports first, then the backend, then orchestration, then commands, then the CLI shell, then docs.

---

### Task 1: Project scaffolding, errors, and config resolution

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/version.ts`, `src/errors.ts`, `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `EXIT: { SUCCESS: 0; RUNTIME: 1; USAGE: 2; BACKEND: 3 }`
  - `type ErrorCode = 'TIMEOUT' | 'PARSE_ERROR' | 'BACKEND_UNAVAILABLE' | 'UNSUPPORTED_FORMAT' | 'IO_ERROR'`
  - `class UsageError extends Error`, `class BackendUnavailableError extends Error`
  - `interface ConfigFlags { model?: string; host?: string; timeout?: number }`
  - `interface ResolvedConfig { model: string; host: string; timeoutMs: number }`
  - `resolveConfig(flags: ConfigFlags, env: NodeJS.ProcessEnv): ResolvedConfig`
  - `isLocalHost(host: string): boolean`
  - `getVersion(): string`

- [ ] **Step 1: Initialize the repo and install devDependencies**

```bash
cd /Users/shreyas/Desktop/Code/offgrid-vision
git init
npm install --save-dev typescript@^5.6.0 vitest@^2.1.0 @types/node@^20.16.0
```

- [ ] **Step 2: Write `package.json`**

Replace the generated file entirely with this. Note `files` limits the published tarball to `dist` + docs; `bin` points at the compiled entry.

```json
{
  "name": "offgrid-vision",
  "version": "0.1.0",
  "description": "Analyze images locally with Ollama instead of spending cloud multimodal tokens.",
  "type": "module",
  "license": "MIT",
  "bin": {
    "offgrid-vision": "dist/cli.js"
  },
  "engines": {
    "node": ">=20"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "keywords": [
    "ollama",
    "image-analysis",
    "ocr",
    "local-llm",
    "agent-skill",
    "cli"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Write `tsconfig.build.json`**

The build must emit only `src/`, so it narrows `include` and drops the test tree.

```json
{
  "extends": "./tsconfig.json",
  "include": ["src/**/*.ts"],
  "exclude": ["test/**/*.ts"]
}
```

- [ ] **Step 5: Write `vitest.config.ts` and `.gitignore`**

`vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
  },
});
```

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 6: Write the failing test for config resolution**

Create `test/config.test.ts`. Note the timeout env var is a string and must be coerced; a non-numeric or non-positive value falls back to the default rather than producing `NaN`.

```typescript
import { describe, it, expect } from 'vitest';
import { resolveConfig, isLocalHost } from '../src/config.js';

describe('resolveConfig', () => {
  it('uses defaults when nothing is provided', () => {
    expect(resolveConfig({}, {})).toEqual({
      model: 'gemma3:12b',
      host: 'http://localhost:11434',
      timeoutMs: 120000,
    });
  });

  it('prefers env vars over defaults', () => {
    const cfg = resolveConfig({}, {
      OFFGRID_MODEL: 'gemma3:4b',
      OLLAMA_HOST: 'http://10.0.0.5:11434',
      OFFGRID_TIMEOUT: '30000',
    });
    expect(cfg).toEqual({
      model: 'gemma3:4b',
      host: 'http://10.0.0.5:11434',
      timeoutMs: 30000,
    });
  });

  it('prefers flags over env vars', () => {
    const cfg = resolveConfig(
      { model: 'llava:13b', host: 'http://192.168.1.9:1234', timeout: 5000 },
      { OFFGRID_MODEL: 'gemma3:4b', OLLAMA_HOST: 'http://10.0.0.5:11434', OFFGRID_TIMEOUT: '30000' },
    );
    expect(cfg).toEqual({
      model: 'llava:13b',
      host: 'http://192.168.1.9:1234',
      timeoutMs: 5000,
    });
  });

  it('normalizes a host without a scheme and strips trailing slashes', () => {
    expect(resolveConfig({ host: 'localhost:11434/' }, {}).host).toBe('http://localhost:11434');
  });

  it('falls back to the default timeout for garbage values', () => {
    expect(resolveConfig({}, { OFFGRID_TIMEOUT: 'soon' }).timeoutMs).toBe(120000);
    expect(resolveConfig({}, { OFFGRID_TIMEOUT: '-5' }).timeoutMs).toBe(120000);
    expect(resolveConfig({}, { OFFGRID_TIMEOUT: '0' }).timeoutMs).toBe(120000);
  });
});

describe('isLocalHost', () => {
  it('recognizes loopback hosts', () => {
    expect(isLocalHost('http://localhost:11434')).toBe(true);
    expect(isLocalHost('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalHost('http://[::1]:11434')).toBe(true);
  });

  it('rejects remote hosts', () => {
    expect(isLocalHost('http://10.0.0.5:11434')).toBe(false);
    expect(isLocalHost('https://ollama.example.com')).toBe(false);
  });

  it('returns false for unparseable hosts', () => {
    expect(isLocalHost('::::')).toBe(false);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `Failed to resolve import "../src/config.js"`.

- [ ] **Step 8: Write `src/errors.ts`**

```typescript
export const EXIT = {
  SUCCESS: 0,
  RUNTIME: 1,
  USAGE: 2,
  BACKEND: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type ErrorCode =
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'BACKEND_UNAVAILABLE'
  | 'UNSUPPORTED_FORMAT'
  | 'IO_ERROR';

/** Bad flags or arguments. Exits with code 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/** Ollama unreachable or the model is missing. Exits with code 3. */
export class BackendUnavailableError extends Error {
  override readonly name = 'BackendUnavailableError';

  /** Multi-line, actionable remediation shown to the user verbatim. */
  readonly remediation: string;

  constructor(message: string, remediation: string) {
    super(message);
    this.remediation = remediation;
  }
}
```

- [ ] **Step 9: Write `src/version.ts`**

`createRequire` is the only sanctioned `require` in the codebase — it reads the manifest one level above both `src/` and `dist/`, so the same relative path works in tests and in the published package.

```typescript
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface Manifest {
  version: string;
}

const manifest = require('../package.json') as Manifest;

export function getVersion(): string {
  return manifest.version;
}
```

- [ ] **Step 10: Write `src/config.ts`**

```typescript
export const DEFAULT_MODEL = 'gemma3:12b';
export const DEFAULT_HOST = 'http://localhost:11434';
export const DEFAULT_TIMEOUT_MS = 120000;

export interface ConfigFlags {
  model?: string;
  host?: string;
  timeout?: number;
}

export interface ResolvedConfig {
  model: string;
  host: string;
  timeoutMs: number;
}

function normalizeHost(host: string): string {
  const withScheme = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  return withScheme.replace(/\/+$/, '');
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

export function resolveConfig(flags: ConfigFlags, env: NodeJS.ProcessEnv): ResolvedConfig {
  const host = flags.host ?? env.OLLAMA_HOST ?? DEFAULT_HOST;
  const timeoutMs =
    (flags.timeout !== undefined && flags.timeout > 0 ? Math.floor(flags.timeout) : undefined) ??
    positiveInt(env.OFFGRID_TIMEOUT) ??
    DEFAULT_TIMEOUT_MS;

  return {
    model: flags.model ?? env.OFFGRID_MODEL ?? DEFAULT_MODEL,
    host: normalizeHost(host),
    timeoutMs,
  };
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLocalHost(host: string): boolean {
  try {
    const { hostname } = new URL(normalizeHost(host));
    return LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: PASS — 8 tests passing.

- [ ] **Step 12: Verify typecheck and build both work**

Run: `npm run typecheck && npm run build && ls dist`
Expected: no errors; `dist` contains `config.js`, `errors.js`, `version.js` plus `.d.ts` and `.map` files.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold offgrid-vision with config and error primitives"
```

---

### Task 2: Media format sniffing and dimension parsing

**Files:**
- Create: `src/media.ts`
- Create: `test/helpers/fixtures.ts`
- Test: `test/media-sniff.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'tiff'`
  - `SUPPORTED_FORMATS: readonly ImageFormat[]`
  - `SUPPORTED_EXTENSIONS: ReadonlySet<string>` (lowercase, dot-prefixed)
  - `sniffFormat(buf: Buffer): ImageFormat | null`
  - `readDimensions(buf: Buffer, format: ImageFormat): { width: number; height: number } | null`

- [ ] **Step 1: Write the fixture helper**

Create `test/helpers/fixtures.ts`. These are hand-built minimal headers — enough bytes for sniffing and dimension parsing, which is all the code under test reads. Building them by hand keeps binary blobs out of the repo.

```typescript
import { Buffer } from 'node:buffer';

/** 1280x800 PNG: 8-byte signature + IHDR length/type + width/height. */
export function pngFixture(width = 1280, height = 800): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** JPEG: SOI, a skippable APP0 segment, then an SOF0 carrying the dimensions. */
export function jpegFixture(width = 640, height = 480): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0xff, 0xd8]));

  const app0 = Buffer.alloc(4 + 12);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(14, 2);
  app0.write('JFIF\0', 4, 'ascii');
  parts.push(app0);

  const sof0 = Buffer.alloc(11);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(9, 2);
  sof0.writeUInt8(8, 4);
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  parts.push(sof0);

  return Buffer.concat(parts);
}

/** GIF89a with little-endian logical screen dimensions at offset 6. */
export function gifFixture(width = 100, height = 50): Buffer {
  const buf = Buffer.alloc(13);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

/** BMP: 'BM' signature, DIB header with signed LE int32 dimensions. Negative height means top-down. */
export function bmpFixture(width = 32, height = 16): Buffer {
  const buf = Buffer.alloc(26);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  return buf;
}

/** Lossy WebP: RIFF container wrapping a VP8 chunk. */
export function webpVp8Fixture(width = 200, height = 150): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(buf, 23);
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

/** Extended WebP: VP8X chunk with 24-bit little-endian (dimension - 1) values. */
export function webpVp8xFixture(width = 1024, height = 768): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

/** Little-endian TIFF header. Dimensions live in IFD tags we deliberately do not parse. */
export function tiffFixture(): Buffer {
  return Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
}

/** Not an image: plain UTF-8 text. */
export function textFixture(): Buffer {
  return Buffer.from('this is definitely not an image, it is prose\n', 'utf8');
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/media-sniff.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { sniffFormat, readDimensions, SUPPORTED_EXTENSIONS } from '../src/media.js';
import {
  pngFixture, jpegFixture, gifFixture, bmpFixture,
  webpVp8Fixture, webpVp8xFixture, tiffFixture, textFixture,
} from './helpers/fixtures.js';

describe('sniffFormat', () => {
  it('identifies every supported format from magic bytes', () => {
    expect(sniffFormat(pngFixture())).toBe('png');
    expect(sniffFormat(jpegFixture())).toBe('jpeg');
    expect(sniffFormat(gifFixture())).toBe('gif');
    expect(sniffFormat(bmpFixture())).toBe('bmp');
    expect(sniffFormat(webpVp8Fixture())).toBe('webp');
    expect(sniffFormat(webpVp8xFixture())).toBe('webp');
    expect(sniffFormat(tiffFixture())).toBe('tiff');
  });

  it('returns null for non-image content', () => {
    expect(sniffFormat(textFixture())).toBeNull();
  });

  it('returns null for buffers too short to identify', () => {
    expect(sniffFormat(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffFormat(Buffer.alloc(0))).toBeNull();
  });

  it('does not mistake a bare RIFF container for WebP', () => {
    const riff = Buffer.alloc(16);
    riff.write('RIFF', 0, 'ascii');
    riff.write('WAVE', 8, 'ascii');
    expect(sniffFormat(riff)).toBeNull();
  });
});

describe('readDimensions', () => {
  it('reads PNG dimensions from IHDR', () => {
    expect(readDimensions(pngFixture(1280, 800), 'png')).toEqual({ width: 1280, height: 800 });
  });

  it('reads JPEG dimensions by walking to SOF0', () => {
    expect(readDimensions(jpegFixture(640, 480), 'jpeg')).toEqual({ width: 640, height: 480 });
  });

  it('reads GIF dimensions little-endian', () => {
    expect(readDimensions(gifFixture(100, 50), 'gif')).toEqual({ width: 100, height: 50 });
  });

  it('reads BMP dimensions and normalizes negative (top-down) height', () => {
    expect(readDimensions(bmpFixture(32, 16), 'bmp')).toEqual({ width: 32, height: 16 });
    expect(readDimensions(bmpFixture(32, -16), 'bmp')).toEqual({ width: 32, height: 16 });
  });

  it('reads both WebP chunk layouts', () => {
    expect(readDimensions(webpVp8Fixture(200, 150), 'webp')).toEqual({ width: 200, height: 150 });
    expect(readDimensions(webpVp8xFixture(1024, 768), 'webp')).toEqual({ width: 1024, height: 768 });
  });

  it('returns null for TIFF, which we do not parse', () => {
    expect(readDimensions(tiffFixture(), 'tiff')).toBeNull();
  });

  it('returns null instead of throwing on truncated data', () => {
    expect(readDimensions(pngFixture().subarray(0, 12), 'png')).toBeNull();
    expect(readDimensions(Buffer.from([0xff, 0xd8]), 'jpeg')).toBeNull();
  });
});

describe('SUPPORTED_EXTENSIONS', () => {
  it('contains lowercase dot-prefixed extensions including both jpeg spellings', () => {
    expect(SUPPORTED_EXTENSIONS.has('.png')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.jpg')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.jpeg')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.tif')).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.pdf')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/media-sniff.test.ts`
Expected: FAIL — `Failed to resolve import "../src/media.js"`.

- [ ] **Step 4: Write the sniffing and dimension half of `src/media.ts`**

Every reader is bounds-checked and returns `null` rather than throwing — a truncated file must produce a structured result, never a crash.

```typescript
import { Buffer } from 'node:buffer';

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'tiff';

export const SUPPORTED_FORMATS: readonly ImageFormat[] = [
  'png', 'jpeg', 'webp', 'gif', 'bmp', 'tiff',
];

export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff',
]);

export interface Dimensions {
  width: number;
  height: number;
}

function startsWith(buf: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buf[offset + i] === byte);
}

function asciiAt(buf: Buffer, offset: number, length: number): string {
  if (buf.length < offset + length) return '';
  return buf.toString('ascii', offset, offset + length);
}

/**
 * Identify an image format from its leading bytes. Extensions are never trusted.
 * Returns null when the content is not a supported image.
 */
export function sniffFormat(buf: Buffer): ImageFormat | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (asciiAt(buf, 0, 4) === 'RIFF' && asciiAt(buf, 8, 4) === 'WEBP') return 'webp';
  if (asciiAt(buf, 0, 6) === 'GIF87a' || asciiAt(buf, 0, 6) === 'GIF89a') return 'gif';
  if (asciiAt(buf, 0, 2) === 'BM' && buf.length >= 26) return 'bmp';
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00])) return 'tiff';
  if (startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  return null;
}

function pngDimensions(buf: Buffer): Dimensions | null {
  if (buf.length < 24 || asciiAt(buf, 12, 4) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Walk JPEG marker segments until a Start-Of-Frame carries the dimensions. */
function jpegDimensions(buf: Buffer): Dimensions | null {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === undefined) return null;
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const isSof =
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function gifDimensions(buf: Buffer): Dimensions | null {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/** BMP height is signed: negative means the rows are stored top-down. */
function bmpDimensions(buf: Buffer): Dimensions | null {
  if (buf.length < 26) return null;
  // Only BITMAPINFOHEADER (40) and its supersets put signed 32-bit dimensions
  // at offsets 18/22. The OS/2 BITMAPCOREHEADER (12) uses a different layout,
  // and reading it as if it were a 40-byte header yields plausible garbage.
  if (buf.readUInt32LE(14) < 40) return null;
  return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) };
}

function webpDimensions(buf: Buffer): Dimensions | null {
  const chunk = asciiAt(buf, 12, 4);
  if (chunk === 'VP8 ') {
    if (buf.length < 30) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8X') {
    if (buf.length < 30) return null;
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (chunk === 'VP8L') {
    if (buf.length < 25) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * Best-effort dimension extraction from headers only. TIFF requires walking IFD
 * tags for little payoff, so it intentionally reports null.
 */
export function readDimensions(buf: Buffer, format: ImageFormat): Dimensions | null {
  try {
    switch (format) {
      case 'png': return pngDimensions(buf);
      case 'jpeg': return jpegDimensions(buf);
      case 'gif': return gifDimensions(buf);
      case 'bmp': return bmpDimensions(buf);
      case 'webp': return webpDimensions(buf);
      case 'tiff': return null;
    }
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/media-sniff.test.ts`
Expected: PASS — 12 tests passing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: sniff image formats and parse dimensions from headers"
```

---

### Task 3: File discovery and hashing

**Files:**
- Modify: `src/media.ts` (append; do not alter Task 2's exports)
- Test: `test/media-discover.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_EXTENSIONS` from Task 2.
- Produces:
  - `sha256(buf: Buffer): string`
  - `interface DiscoverOptions { recursive: boolean }`
  - `discoverFiles(inputPaths: string[], opts: DiscoverOptions): Promise<string[]>`

`discoverFiles` returns absolute paths, sorted, de-duplicated. Explicitly-named files are always included regardless of extension — the caller sniffs them and reports `UNSUPPORTED_FORMAT` per file, which is what Acceptance Criterion 6 requires. Directory *walks* filter by extension, because scanning every byte of every unrelated file in a tree would be wasteful.

- [ ] **Step 1: Write the failing tests**

Create `test/media-discover.test.ts`.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { sha256, discoverFiles } from '../src/media.js';
import { pngFixture } from './helpers/fixtures.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-discover-'));
  await mkdir(path.join(root, 'nested', 'deep'), { recursive: true });
  await writeFile(path.join(root, 'a.png'), pngFixture());
  await writeFile(path.join(root, 'b.JPG'), pngFixture());
  await writeFile(path.join(root, 'notes.txt'), 'ignore me');
  await writeFile(path.join(root, 'nested', 'c.webp'), pngFixture());
  await writeFile(path.join(root, 'nested', 'deep', 'd.gif'), pngFixture());
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('sha256', () => {
  it('hashes buffer contents', () => {
    expect(sha256(Buffer.from('hello', 'utf8'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});

describe('discoverFiles', () => {
  it('walks a directory recursively and skips unsupported extensions', async () => {
    const found = await discoverFiles([root], { recursive: true });
    expect(found.map((f) => path.basename(f))).toEqual(['a.png', 'b.JPG', 'c.webp', 'd.gif']);
  });

  it('stays at the top level when recursion is disabled', async () => {
    const found = await discoverFiles([root], { recursive: false });
    expect(found.map((f) => path.basename(f))).toEqual(['a.png', 'b.JPG']);
  });

  it('includes explicitly named files even with an unsupported extension', async () => {
    const found = await discoverFiles([path.join(root, 'notes.txt')], { recursive: true });
    expect(found.map((f) => path.basename(f))).toEqual(['notes.txt']);
  });

  it('returns absolute, sorted, de-duplicated paths', async () => {
    const target = path.join(root, 'a.png');
    const found = await discoverFiles([target, target, root], { recursive: false });
    expect(found.filter((f) => f.endsWith('a.png'))).toHaveLength(1);
    expect(found.every((f) => path.isAbsolute(f))).toBe(true);
    expect([...found].sort()).toEqual(found);
  });

  it('throws a helpful error when a path does not exist', async () => {
    await expect(discoverFiles([path.join(root, 'nope.png')], { recursive: true }))
      .rejects.toThrow(/no such file or directory|not found/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/media-discover.test.ts`
Expected: FAIL — `sha256 is not a function` / `discoverFiles is not a function`.

- [ ] **Step 3: Append discovery and hashing to `src/media.ts`**

Add these imports to the top of the existing file, alongside the `node:buffer` import:

```typescript
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
```

Then append to the end of the file:

```typescript
export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export interface DiscoverOptions {
  recursive: boolean;
}

async function walkDirectory(dir: string, recursive: boolean, out: Set<string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip dot-directories: node_modules, .git, and friends are never image sources.
      if (recursive && !entry.name.startsWith('.')) {
        await walkDirectory(full, recursive, out);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.add(full);
    }
  }
}

/**
 * Expand caller-supplied paths into a concrete file list.
 *
 * Directories are walked and filtered by extension. Files named explicitly are
 * always kept, even with an unknown extension, so the caller can sniff them and
 * emit a structured UNSUPPORTED_FORMAT result rather than silently dropping them.
 */
export async function discoverFiles(
  inputPaths: string[],
  opts: DiscoverOptions,
): Promise<string[]> {
  const found = new Set<string>();
  for (const input of inputPaths) {
    const absolute = path.resolve(input);
    const stats = await stat(absolute);
    if (stats.isDirectory()) {
      await walkDirectory(absolute, opts.recursive, found);
    } else {
      found.add(absolute);
    }
  }
  return [...found].sort();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/media-discover.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: discover image files recursively and hash contents"
```

---

### Task 4: Output schema types and defensive model-JSON parsing

**Files:**
- Create: `src/schema.ts`
- Test: `test/schema.test.ts`

**Interfaces:**
- Consumes: `ErrorCode` from `src/errors.ts` (Task 1), `ImageFormat` from `src/media.ts` (Task 2).
- Produces:
  - `interface DetectedObject { name: string; confidence: Confidence }`, `type Confidence = 'high' | 'medium' | 'low'`
  - `interface Analysis { description: string; objects: DetectedObject[]; text: string; tags: string[]; raw?: string; parse_error?: boolean }`
  - `interface FileMetadata { bytes: number; format: ImageFormat; width: number | null; height: number | null; sha256: string; analyzed_at: string }`
  - `interface ResultError { code: ErrorCode; message: string }`
  - `interface AnalysisResult { file: string; model: string; duration_ms: number; analysis: Analysis | null; metadata: FileMetadata | null; error: ResultError | null }`
  - `interface RunSummary { total: number; ok: number; failed: number; model: string; duration_ms: number }`
  - `interface RunReport { results: AnalysisResult[]; summary: RunSummary }`
  - `stripCodeFences(text: string): string`
  - `parseAnalysis(rawText: string): Analysis | null`
  - `unparsedAnalysis(rawText: string): Analysis`
  - `summarize(results: AnalysisResult[], model: string, durationMs: number): RunSummary`

This is the module that makes FR-1.4 real. `parseAnalysis` returns `null` on failure so the caller can decide whether to spend a repair round-trip; `unparsedAnalysis` builds the never-crash fallback envelope.

- [ ] **Step 1: Write the failing tests**

Create `test/schema.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { stripCodeFences, parseAnalysis, unparsedAnalysis, summarize } from '../src/schema.js';
import type { AnalysisResult } from '../src/schema.js';

describe('stripCodeFences', () => {
  it('unwraps a ```json fenced block', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('unwraps an unlabeled fenced block', () => {
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('leaves unfenced text alone', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });

  it('trims prose surrounding a fence', () => {
    expect(stripCodeFences('Sure! Here you go:\n```json\n{"a":1}\n```\nHope that helps.'))
      .toBe('{"a":1}');
  });
});

describe('parseAnalysis', () => {
  it('parses a well-formed response', () => {
    const analysis = parseAnalysis(JSON.stringify({
      description: 'A modal error dialog.',
      objects: [{ name: 'error dialog', confidence: 'high' }],
      text: 'Error: connection refused',
      tags: ['screenshot', 'error-dialog'],
    }));
    expect(analysis).toEqual({
      description: 'A modal error dialog.',
      objects: [{ name: 'error dialog', confidence: 'high' }],
      text: 'Error: connection refused',
      tags: ['screenshot', 'error-dialog'],
    });
  });

  it('recovers a JSON object embedded in prose', () => {
    const analysis = parseAnalysis('Here is the analysis: {"description":"A cat.","objects":[],"text":"","tags":["cat"]} Done.');
    expect(analysis?.description).toBe('A cat.');
  });

  it('coerces objects given as bare strings', () => {
    const analysis = parseAnalysis('{"description":"x","objects":["cat","hat"],"text":"","tags":[]}');
    expect(analysis?.objects).toEqual([
      { name: 'cat', confidence: 'medium' },
      { name: 'hat', confidence: 'medium' },
    ]);
  });

  it('normalizes unknown confidence values to medium', () => {
    const analysis = parseAnalysis('{"description":"x","objects":[{"name":"cat","confidence":0.92}],"text":"","tags":[]}');
    expect(analysis?.objects[0]).toEqual({ name: 'cat', confidence: 'medium' });
  });

  it('fills in missing optional fields', () => {
    const analysis = parseAnalysis('{"description":"only this"}');
    expect(analysis).toEqual({ description: 'only this', objects: [], text: '', tags: [] });
  });

  it('coerces a non-string text field', () => {
    const analysis = parseAnalysis('{"description":"x","text":["line one","line two"]}');
    expect(analysis?.text).toBe('line one\nline two');
  });

  it('drops non-string and empty tags and caps the list at 15', () => {
    const tags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    const analysis = parseAnalysis(JSON.stringify({ description: 'x', tags: [...tags, '', 42] }));
    expect(analysis?.tags).toHaveLength(15);
    expect(analysis?.tags[0]).toBe('tag0');
  });

  it('returns null for unparseable text', () => {
    expect(parseAnalysis('I am afraid I cannot help with that.')).toBeNull();
    expect(parseAnalysis('')).toBeNull();
  });

  it('returns null when the payload is valid JSON but not an object', () => {
    expect(parseAnalysis('[1,2,3]')).toBeNull();
    expect(parseAnalysis('"just a string"')).toBeNull();
  });

  it('returns null when the object has no usable description', () => {
    expect(parseAnalysis('{"unrelated":true}')).toBeNull();
  });
});

describe('unparsedAnalysis', () => {
  it('preserves the raw text and flags the parse failure', () => {
    const analysis = unparsedAnalysis('total gibberish');
    expect(analysis).toEqual({
      description: '',
      objects: [],
      text: '',
      tags: [],
      raw: 'total gibberish',
      parse_error: true,
    });
  });
});

describe('summarize', () => {
  it('counts successes and failures', () => {
    const results = [
      { error: null },
      { error: { code: 'TIMEOUT', message: 'timed out' } },
      { error: null },
    ] as AnalysisResult[];
    expect(summarize(results, 'gemma3:12b', 900)).toEqual({
      total: 3, ok: 2, failed: 1, model: 'gemma3:12b', duration_ms: 900,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL — `Failed to resolve import "../src/schema.js"`.

- [ ] **Step 3: Write `src/schema.ts`**

```typescript
import type { ErrorCode } from './errors.js';
import type { ImageFormat } from './media.js';

export type Confidence = 'high' | 'medium' | 'low';

export interface DetectedObject {
  name: string;
  confidence: Confidence;
}

export interface Analysis {
  description: string;
  objects: DetectedObject[];
  text: string;
  tags: string[];
  /** Present only when the model output could not be parsed as JSON. */
  raw?: string;
  parse_error?: boolean;
}

export interface FileMetadata {
  bytes: number;
  format: ImageFormat;
  width: number | null;
  height: number | null;
  sha256: string;
  analyzed_at: string;
}

export interface ResultError {
  code: ErrorCode;
  message: string;
}

export interface AnalysisResult {
  file: string;
  model: string;
  duration_ms: number;
  analysis: Analysis | null;
  metadata: FileMetadata | null;
  error: ResultError | null;
}

export interface RunSummary {
  total: number;
  ok: number;
  failed: number;
  model: string;
  duration_ms: number;
}

export interface RunReport {
  results: AnalysisResult[];
  summary: RunSummary;
}

export const MAX_TAGS = 15;

/** Remove markdown code fences and any prose the model wrapped around them. */
export function stripCodeFences(text: string): string {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)\n?```/i.exec(text);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  return text.trim();
}

/** Last-resort recovery: grab the outermost {...} span from surrounding prose. */
function extractObjectSpan(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

const CONFIDENCES: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

function toConfidence(value: unknown): Confidence {
  if (typeof value === 'string' && CONFIDENCES.has(value.toLowerCase())) {
    return value.toLowerCase() as Confidence;
  }
  return 'medium';
}

function toObjects(value: unknown): DetectedObject[] {
  if (!Array.isArray(value)) return [];
  const objects: DetectedObject[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) objects.push({ name: entry.trim(), confidence: 'medium' });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (name) objects.push({ name, confidence: toConfidence(record.confidence) });
    }
  }
  return objects;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join('\n');
  return '';
}

function toTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    .map((tag) => tag.trim())
    .slice(0, MAX_TAGS);
}

/**
 * Parse a model response into an Analysis, tolerating fences, prose wrappers,
 * and loose field types. Returns null when nothing usable can be recovered —
 * the caller then decides whether to retry with a repair prompt.
 */
export function parseAnalysis(rawText: string): Analysis | null {
  const candidates = [stripCodeFences(rawText)];
  const span = extractObjectSpan(candidates[0] ?? '');
  if (span) candidates.push(span);

  for (const candidate of candidates) {
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

    const record = parsed as Record<string, unknown>;
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    // A response with no description is not an analysis, whatever else it holds.
    if (!description) continue;

    return {
      description,
      objects: toObjects(record.objects),
      text: toText(record.text),
      tags: toTags(record.tags),
    };
  }
  return null;
}

/** The FR-1.4 fallback: never crash, hand the caller the raw text instead. */
export function unparsedAnalysis(rawText: string): Analysis {
  return {
    description: '',
    objects: [],
    text: '',
    tags: [],
    raw: rawText,
    parse_error: true,
  };
}

export function summarize(
  results: AnalysisResult[],
  model: string,
  durationMs: number,
): RunSummary {
  const failed = results.filter((result) => result.error !== null).length;
  return {
    total: results.length,
    ok: results.length - failed,
    failed,
    model,
    duration_ms: durationMs,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/schema.test.ts`
Expected: PASS — 17 tests passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add output schema types and defensive model-JSON parsing"
```

---

### Task 5: Prompt presets

**Files:**
- Create: `src/prompts/index.ts`
- Test: `test/prompts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Mode = 'general' | 'ocr' | 'alt-text' | 'ui'`
  - `MODES: readonly Mode[]`
  - `isMode(value: string): value is Mode`
  - `buildPrompt(mode: Mode, customPrompt?: string): string`
  - `REPAIR_PROMPT: string`

Per Implementation Note §10, every prompt is a plain exported string so they are trivial to iterate on. All four modes return the **same** schema (FR-1.6 requires the standard schema even with a custom prompt) — the presets only shift emphasis.

- [ ] **Step 1: Write the failing tests**

Create `test/prompts.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { MODES, isMode, buildPrompt, REPAIR_PROMPT } from '../src/prompts/index.js';

describe('MODES', () => {
  it('exposes exactly the four v1 presets', () => {
    expect([...MODES]).toEqual(['general', 'ocr', 'alt-text', 'ui']);
  });
});

describe('isMode', () => {
  it('accepts known modes and rejects others', () => {
    expect(isMode('ocr')).toBe(true);
    expect(isMode('alt-text')).toBe(true);
    expect(isMode('OCR')).toBe(false);
    expect(isMode('video')).toBe(false);
  });
});

describe('buildPrompt', () => {
  it('always states the required schema keys', () => {
    for (const mode of MODES) {
      const prompt = buildPrompt(mode);
      for (const key of ['description', 'objects', 'text', 'tags', 'confidence']) {
        expect(prompt).toContain(key);
      }
    }
  });

  it('produces a distinct prompt per mode', () => {
    const prompts = MODES.map((mode) => buildPrompt(mode));
    expect(new Set(prompts).size).toBe(MODES.length);
  });

  it('emphasizes verbatim text in ocr mode', () => {
    expect(buildPrompt('ocr').toLowerCase()).toContain('verbatim');
  });

  it('appends the caller instruction under a clear heading', () => {
    const prompt = buildPrompt('general', 'focus on visible error messages');
    expect(prompt).toContain('focus on visible error messages');
    expect(prompt).toContain('Additional instruction from the caller');
  });

  it('ignores a blank custom prompt', () => {
    expect(buildPrompt('general', '   ')).toBe(buildPrompt('general'));
  });
});

describe('REPAIR_PROMPT', () => {
  it('demands bare JSON with no commentary', () => {
    expect(REPAIR_PROMPT.toLowerCase()).toContain('json');
    expect(REPAIR_PROMPT.toLowerCase()).toMatch(/no (commentary|prose|explanation)/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/prompts.test.ts`
Expected: FAIL — `Failed to resolve import "../src/prompts/index.js"`.

- [ ] **Step 3: Write `src/prompts/index.ts`**

```typescript
export type Mode = 'general' | 'ocr' | 'alt-text' | 'ui';

export const MODES: readonly Mode[] = ['general', 'ocr', 'alt-text', 'ui'];

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

/** The output contract, restated to the model on every call. */
export const SCHEMA_INSTRUCTION = `Respond with a single JSON object and nothing else. It must have exactly these keys:

{
  "description": string  — one paragraph of natural language describing the image,
  "objects": array of { "name": string, "confidence": "high" | "medium" | "low" } — the notable objects, entities, or UI elements you can see,
  "text": string — every piece of text visible in the image, transcribed verbatim, or "" if there is none,
  "tags": array of 5 to 15 short lowercase keyword strings
}

Do not wrap the JSON in markdown code fences. Do not add commentary before or after it.`;

const MODE_INSTRUCTIONS: Record<Mode, string> = {
  general: `You are an image analysis engine. Examine the image and report what it contains: the setting, the subjects, notable details, and any text.`,

  ocr: `You are an OCR engine. Your priority is text extraction. Transcribe every piece of text in the image verbatim into the "text" field — preserve line breaks, spelling, casing, punctuation, numbers, and error codes exactly as they appear, and do not paraphrase or correct anything. Keep "description" to one or two sentences about where the text appears and what kind of document or screen it is.`,

  'alt-text': `You are writing accessibility alt text. Keep "description" to a single sentence under 125 characters that conveys what a sighted user would take away from the image — no "image of" or "picture of" preamble. Keep "objects" to the few things that matter for comprehension, and keep "tags" short.`,

  ui: `You are analyzing a screenshot of a software interface. In "description", cover the overall layout, what screen or application this appears to be, and the current state. In "objects", list the visible interactive controls — buttons, inputs, menus, tabs, dialogs — by their visible labels. Call out any error, warning, empty, or loading state explicitly in the description. In "text", transcribe visible labels, messages, and error codes verbatim.`,
};

export function buildPrompt(mode: Mode, customPrompt?: string): string {
  const sections = [MODE_INSTRUCTIONS[mode], SCHEMA_INSTRUCTION];
  const custom = customPrompt?.trim();
  if (custom) {
    sections.splice(1, 0, `Additional instruction from the caller — honor it, but still return the schema below exactly as specified:\n${custom}`);
  }
  return sections.join('\n\n');
}

/** Sent as a follow-up turn when the first response could not be parsed (FR-1.4). */
export const REPAIR_PROMPT = `That response could not be parsed as JSON. Reply again with only the JSON object described earlier — no prose, no commentary, no markdown code fences. Start your reply with { and end it with }.`;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/prompts.test.ts`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add mode-specific analysis prompts and JSON repair prompt"
```

---

### Task 6: Backend interface and the Ollama implementation

**Files:**
- Create: `src/backends/backend.ts`, `src/backends/ollama.ts`
- Create: `test/helpers/mock-ollama.ts`
- Test: `test/ollama.test.ts`

**Interfaces:**
- Consumes: `BackendUnavailableError` from `src/errors.ts` (Task 1).
- Produces:
  - `interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; images?: string[] }`
  - `interface ChatOptions { model: string; timeoutMs: number }`
  - `class TimeoutError extends Error`
  - `interface Backend { readonly name: string; readonly host: string; ping(): Promise<void>; listModels(): Promise<string[]>; chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> }`
  - `createOllamaBackend(host: string): Backend`

`ping()` and `listModels()` throw `BackendUnavailableError` with populated `remediation`. `chat()` throws `TimeoutError` on timeout and `BackendUnavailableError` on connection failure, so `analyzer.ts` (Task 7) can map them to `TIMEOUT` / `BACKEND_UNAVAILABLE` result codes.

- [ ] **Step 1: Write the mock Ollama server helper**

Create `test/helpers/mock-ollama.ts`. This is the fixture that satisfies NFR-5 — every network test in this project runs against it, never against a real model.

```typescript
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
```

- [ ] **Step 2: Write the failing tests**

Create `test/ollama.test.ts`.

```typescript
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/ollama.test.ts`
Expected: FAIL — `Failed to resolve import "../src/backends/ollama.js"`.

- [ ] **Step 4: Write `src/backends/backend.ts`**

```typescript
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Base64-encoded image payloads, no data: URI prefix. */
  images?: string[];
}

export interface ChatOptions {
  model: string;
  timeoutMs: number;
}

/** The per-file deadline elapsed (FR-1.9). Maps to the TIMEOUT result code. */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

/**
 * A local multimodal inference backend. v1 ships only Ollama, but analyze/doctor
 * depend on this interface alone so LM Studio or an OpenAI-compatible endpoint
 * can be added without touching the command layer.
 */
export interface Backend {
  readonly name: string;
  readonly host: string;
  /** Resolves if reachable; throws BackendUnavailableError otherwise. */
  ping(): Promise<void>;
  listModels(): Promise<string[]>;
  /** Returns the assistant's raw reply text. */
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<string>;
}
```

- [ ] **Step 5: Write `src/backends/ollama.ts`**

```typescript
import { BackendUnavailableError } from '../errors.js';
import { TimeoutError, type Backend, type ChatMessage, type ChatOptions } from './backend.js';

/** Short deadline for liveness probes — a healthy local daemon answers instantly. */
const PROBE_TIMEOUT_MS = 5000;

/** AbortSignal.timeout() rejects with a DOMException named 'TimeoutError', not our class. */
function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
}

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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/ollama.test.ts`
Expected: PASS — 9 tests passing.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add backend interface and Ollama HTTP implementation"
```

---

### Task 7: Single-file analyzer orchestration

**Files:**
- Create: `src/analyzer.ts`
- Test: `test/analyzer.test.ts`

**Interfaces:**
- Consumes: `Backend`, `ChatMessage`, `TimeoutError` (Task 6); `sniffFormat`, `readDimensions`, `sha256` (Tasks 2–3); `parseAnalysis`, `unparsedAnalysis`, `AnalysisResult` (Task 4); `buildPrompt`, `REPAIR_PROMPT`, `Mode` (Task 5); `BackendUnavailableError` (Task 1).
- Produces:
  - `interface AnalyzeFileOptions { backend: Backend; model: string; timeoutMs: number; mode: Mode; customPrompt?: string }`
  - `analyzeFile(filePath: string, opts: AnalyzeFileOptions): Promise<AnalysisResult>`

This is the FR-1.2 / FR-1.3 / FR-1.4 pipeline for one file: read → sniff → hash + dimensions → base64 → chat → parse → repair once → fall back to `raw`. It **never throws** — every failure becomes an `error` entry in the returned envelope, which is what lets FR-1.8 continue past individual failures.

- [ ] **Step 1: Write the failing tests**

Create `test/analyzer.test.ts`.

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeFile } from '../src/analyzer.js';
import { createOllamaBackend } from '../src/backends/ollama.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';
import { pngFixture, textFixture } from './helpers/fixtures.js';

let root: string;
let pngPath: string;
let txtPath: string;
let mock: MockOllama | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-analyze-'));
  pngPath = path.join(root, 'shot.png');
  txtPath = path.join(root, 'notes.txt');
  await writeFile(pngPath, pngFixture(1280, 800));
  await writeFile(txtPath, textFixture());
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

function backendFor(url: string) {
  return createOllamaBackend(url);
}

const baseOpts = { model: 'gemma3:12b', timeoutMs: 5000, mode: 'general' as const };

describe('analyzeFile', () => {
  it('returns a fully populated envelope on the happy path', async () => {
    mock = await startMockOllama({
      chatReplies: [JSON.stringify({
        description: 'A desktop error dialog.',
        objects: [{ name: 'error dialog', confidence: 'high' }],
        text: 'Error: connection refused',
        tags: ['screenshot', 'error'],
      })],
    });
    const result = await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error).toBeNull();
    expect(result.file).toBe(pngPath);
    expect(result.model).toBe('gemma3:12b');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.analysis?.description).toBe('A desktop error dialog.');
    expect(result.analysis?.objects).toEqual([{ name: 'error dialog', confidence: 'high' }]);
    expect(result.metadata).toMatchObject({
      bytes: 33,
      format: 'png',
      width: 1280,
      height: 800,
    });
    expect(result.metadata?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metadata?.analyzed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sends the image as base64 with no data: prefix', async () => {
    mock = await startMockOllama();
    await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });
    const body = mock.requests.find((r) => r.path === '/api/chat')?.body as Record<string, unknown>;
    const images = (body.messages as Array<Record<string, unknown>>)[0]?.images as string[];
    expect(images[0]).not.toMatch(/^data:/);
    expect(images[0]).toBe(pngFixture(1280, 800).toString('base64'));
  });

  it('includes the custom prompt in the outgoing message', async () => {
    mock = await startMockOllama();
    await analyzeFile(pngPath, {
      ...baseOpts,
      backend: backendFor(mock.url),
      customPrompt: 'focus on error messages',
    });
    const body = mock.requests.find((r) => r.path === '/api/chat')?.body as Record<string, unknown>;
    const content = (body.messages as Array<Record<string, unknown>>)[0]?.content as string;
    expect(content).toContain('focus on error messages');
  });

  it('retries once with a repair prompt and succeeds', async () => {
    mock = await startMockOllama({
      chatReplies: [
        'Sure! I looked at your image and I think it shows a cat.',
        '{"description":"A cat.","objects":[],"text":"","tags":["cat"]}',
      ],
    });
    const result = await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error).toBeNull();
    expect(result.analysis?.description).toBe('A cat.');
    expect(result.analysis?.parse_error).toBeUndefined();
    expect(mock.requests.filter((r) => r.path === '/api/chat')).toHaveLength(2);
  });

  it('sends the repair prompt as a third message carrying prior context', async () => {
    mock = await startMockOllama({ chatReplies: ['nope', 'still nope'] });
    await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });
    const second = mock.requests.filter((r) => r.path === '/api/chat')[1];
    const messages = (second?.body as Record<string, unknown>).messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(3);
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[1]?.content).toBe('nope');
    expect(messages[2]?.role).toBe('user');
  });

  it('falls back to raw text with parse_error rather than crashing', async () => {
    mock = await startMockOllama({ chatReplies: ['nope', 'still nope'] });
    const result = await analyzeFile(pngPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error).toEqual({
      code: 'PARSE_ERROR',
      message: expect.stringContaining('JSON') as unknown as string,
    });
    expect(result.analysis).toEqual({
      description: '', objects: [], text: '', tags: [],
      raw: 'still nope', parse_error: true,
    });
    expect(result.metadata?.format).toBe('png');
  });

  it('reports UNSUPPORTED_FORMAT without calling the backend', async () => {
    mock = await startMockOllama();
    const result = await analyzeFile(txtPath, { ...baseOpts, backend: backendFor(mock.url) });

    expect(result.error?.code).toBe('UNSUPPORTED_FORMAT');
    expect(result.analysis).toBeNull();
    expect(result.metadata).toBeNull();
    expect(mock.requests.filter((r) => r.path === '/api/chat')).toHaveLength(0);
  });

  it('reports IO_ERROR for a missing file', async () => {
    mock = await startMockOllama();
    const result = await analyzeFile(path.join(root, 'ghost.png'), {
      ...baseOpts,
      backend: backendFor(mock.url),
    });
    expect(result.error?.code).toBe('IO_ERROR');
    expect(result.analysis).toBeNull();
  });

  it('reports TIMEOUT and keeps metadata when inference stalls', async () => {
    mock = await startMockOllama({ chatDelayMs: 300 });
    const result = await analyzeFile(pngPath, {
      ...baseOpts,
      backend: backendFor(mock.url),
      timeoutMs: 50,
    });
    expect(result.error?.code).toBe('TIMEOUT');
    expect(result.analysis).toBeNull();
    expect(result.metadata?.format).toBe('png');
  });

  it('reports BACKEND_UNAVAILABLE when the host is down', async () => {
    const result = await analyzeFile(pngPath, {
      ...baseOpts,
      backend: backendFor('http://127.0.0.1:1'),
    });
    expect(result.error?.code).toBe('BACKEND_UNAVAILABLE');
    expect(result.analysis).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/analyzer.test.ts`
Expected: FAIL — `Failed to resolve import "../src/analyzer.js"`.

- [ ] **Step 3: Write `src/analyzer.ts`**

```typescript
import { readFile } from 'node:fs/promises';
import { BackendUnavailableError } from './errors.js';
import { TimeoutError, type Backend, type ChatMessage } from './backends/backend.js';
import { sniffFormat, readDimensions, sha256 } from './media.js';
import { buildPrompt, REPAIR_PROMPT, type Mode } from './prompts/index.js';
import {
  parseAnalysis,
  unparsedAnalysis,
  type AnalysisResult,
  type FileMetadata,
} from './schema.js';

export interface AnalyzeFileOptions {
  backend: Backend;
  model: string;
  timeoutMs: number;
  mode: Mode;
  customPrompt?: string;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Analyze one file end to end.
 *
 * Never throws: every failure mode is reported as a structured `error` on the
 * returned envelope so multi-file runs can continue past bad inputs (FR-1.8).
 */
export async function analyzeFile(
  filePath: string,
  opts: AnalyzeFileOptions,
): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const envelope = (
    partial: Partial<AnalysisResult> & Pick<AnalysisResult, 'analysis' | 'metadata' | 'error'>,
  ): AnalysisResult => ({
    file: filePath,
    model: opts.model,
    duration_ms: Date.now() - startedAt,
    ...partial,
  });

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (cause) {
    return envelope({
      analysis: null,
      metadata: null,
      error: { code: 'IO_ERROR', message: `Cannot read ${filePath}: ${errorMessage(cause)}` },
    });
  }

  const format = sniffFormat(buffer);
  if (format === null) {
    return envelope({
      analysis: null,
      metadata: null,
      error: {
        code: 'UNSUPPORTED_FORMAT',
        message: `${filePath} is not a supported image (expected png, jpeg, webp, gif, bmp, or tiff based on file contents)`,
      },
    });
  }

  const dimensions = readDimensions(buffer, format);
  const metadata: FileMetadata = {
    bytes: buffer.byteLength,
    format,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    sha256: sha256(buffer),
    analyzed_at: new Date().toISOString(),
  };

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: buildPrompt(opts.mode, opts.customPrompt),
      images: [buffer.toString('base64')],
    },
  ];
  const chatOptions = { model: opts.model, timeoutMs: opts.timeoutMs };

  let reply: string;
  try {
    reply = await opts.backend.chat(messages, chatOptions);
  } catch (cause) {
    if (cause instanceof TimeoutError) {
      return envelope({
        analysis: null,
        metadata,
        error: { code: 'TIMEOUT', message: `Analysis exceeded ${opts.timeoutMs} ms` },
      });
    }
    if (cause instanceof BackendUnavailableError) {
      return envelope({
        analysis: null,
        metadata,
        error: { code: 'BACKEND_UNAVAILABLE', message: cause.message },
      });
    }
    return envelope({
      analysis: null,
      metadata,
      error: { code: 'IO_ERROR', message: errorMessage(cause) },
    });
  }

  const parsed = parseAnalysis(reply);
  if (parsed) return envelope({ analysis: parsed, metadata, error: null });

  // FR-1.4: one repair round-trip, with the failed reply in context.
  let repaired: string;
  try {
    repaired = await opts.backend.chat(
      [...messages, { role: 'assistant', content: reply }, { role: 'user', content: REPAIR_PROMPT }],
      chatOptions,
    );
  } catch {
    return envelope({
      analysis: unparsedAnalysis(reply),
      metadata,
      error: {
        code: 'PARSE_ERROR',
        message: 'Model did not return valid JSON and the repair attempt failed',
      },
    });
  }

  const reparsed = parseAnalysis(repaired);
  if (reparsed) return envelope({ analysis: reparsed, metadata, error: null });

  return envelope({
    analysis: unparsedAnalysis(repaired),
    metadata,
    error: {
      code: 'PARSE_ERROR',
      message: 'Model did not return valid JSON after a repair attempt; raw output preserved in analysis.raw',
    },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/analyzer.test.ts`
Expected: PASS — 10 tests passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: orchestrate single-file analysis with JSON repair fallback"
```

---

### Task 8: Doctor command and shared preflight

**Files:**
- Create: `src/commands/doctor.ts`
- Test: `test/doctor.test.ts`

**Interfaces:**
- Consumes: `Backend` (Task 6), `ResolvedConfig` (Task 1), `BackendUnavailableError`, `EXIT` (Task 1).
- Produces:
  - `interface CheckResult { name: string; ok: boolean; detail: string }`
  - `interface DoctorReport { ok: boolean; checks: CheckResult[]; remediation: string | null }`
  - `runChecks(backend: Backend, config: ResolvedConfig, nodeVersion: string): Promise<DoctorReport>`
  - `preflight(backend: Backend, config: ResolvedConfig): Promise<void>` — throws `BackendUnavailableError` with remediation (this is FR-2.4, reused by `analyze`)
  - `runDoctorCommand(argv: string[], io: CommandIO): Promise<number>`

`CommandIO` is a tiny injection point that makes commands testable without spawning processes; define it here and reuse it in Tasks 9 and 12.

- [ ] **Step 1: Write the failing tests**

Create `test/doctor.test.ts`.

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { runChecks, preflight } from '../src/commands/doctor.js';
import { createOllamaBackend } from '../src/backends/ollama.js';
import { BackendUnavailableError } from '../src/errors.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';

let mock: MockOllama | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const config = (host: string, model = 'gemma3:12b') => ({ model, host, timeoutMs: 120000 });

describe('runChecks', () => {
  it('reports healthy when node, host, and model all check out', async () => {
    mock = await startMockOllama({ models: ['gemma3:12b'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url), 'v20.11.0');

    expect(report.ok).toBe(true);
    expect(report.remediation).toBeNull();
    expect(report.checks.map((c) => c.ok)).toEqual([true, true, true]);
  });

  it('fails the node check below version 20', async () => {
    mock = await startMockOllama();
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url), 'v18.19.0');

    expect(report.ok).toBe(false);
    const nodeCheck = report.checks.find((c) => c.name === 'Node.js version');
    expect(nodeCheck?.ok).toBe(false);
    expect(nodeCheck?.detail).toContain('20');
  });

  it('detects a missing model and names the exact pull command', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url), 'v20.11.0');

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(false);
    expect(report.remediation).toContain('ollama pull gemma3:12b');
    expect(report.remediation).toContain('gemma3:4b');
  });

  it('matches a model whose tag is implicitly :latest', async () => {
    mock = await startMockOllama({ models: ['gemma3:latest'] });
    const report = await runChecks(createOllamaBackend(mock.url), config(mock.url, 'gemma3'), 'v20.11.0');
    expect(report.checks.find((c) => c.name === 'Model available')?.ok).toBe(true);
  });

  it('detects an unreachable Ollama and skips the model check', async () => {
    const report = await runChecks(
      createOllamaBackend('http://127.0.0.1:1'),
      config('http://127.0.0.1:1'),
      'v20.11.0',
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Ollama reachable')?.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'Model available')?.detail).toMatch(/skipped/i);
    expect(report.remediation).toMatch(/ollama\.com\/download/);
  });
});

describe('preflight', () => {
  it('resolves silently when everything is healthy', async () => {
    mock = await startMockOllama({ models: ['gemma3:12b'] });
    await expect(preflight(createOllamaBackend(mock.url), config(mock.url))).resolves.toBeUndefined();
  });

  it('throws BackendUnavailableError carrying remediation when the model is missing', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const error = await preflight(createOllamaBackend(mock.url), config(mock.url)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect((error as BackendUnavailableError).remediation).toContain('ollama pull gemma3:12b');
  });

  it('throws when the host is unreachable', async () => {
    await expect(
      preflight(createOllamaBackend('http://127.0.0.1:1'), config('http://127.0.0.1:1')),
    ).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/doctor.test.ts`
Expected: FAIL — `Failed to resolve import "../src/commands/doctor.js"`.

- [ ] **Step 3: Write `src/commands/doctor.ts`**

```typescript
import { parseArgs } from 'node:util';
import { BackendUnavailableError, EXIT } from '../errors.js';
import { isLocalHost, resolveConfig, type ResolvedConfig } from '../config.js';
import { createOllamaBackend } from '../backends/ollama.js';
import type { Backend } from '../backends/backend.js';

/** Injection point so commands can be exercised without spawning a process. */
export interface CommandIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  isTTY: boolean;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: CheckResult[];
  remediation: string | null;
}

export const MIN_NODE_MAJOR = 20;

function modelRemediation(model: string, host: string, available: string[]): string {
  return [
    `The model "${model}" is not present on the Ollama server at ${host}.`,
    '',
    'Pull it:',
    `  ollama pull ${model}`,
    '',
    'On a machine with less than 16 GB of RAM, prefer the smaller model:',
    '  ollama pull gemma3:4b',
    `  offgrid-vision analyze <file> --model gemma3:4b   (or set OFFGRID_MODEL=gemma3:4b)`,
    '',
    available.length
      ? `Models currently installed: ${available.join(', ')}`
      : 'No models are currently installed on that server.',
  ].join('\n');
}

/** Ollama reports untagged models as "name:latest"; treat a bare name as that. */
function modelMatches(requested: string, installed: string): boolean {
  const normalize = (name: string): string => (name.includes(':') ? name : `${name}:latest`);
  return normalize(requested) === normalize(installed);
}

export async function runChecks(
  backend: Backend,
  config: ResolvedConfig,
  nodeVersion: string,
): Promise<DoctorReport> {
  const checks: CheckResult[] = [];
  let remediation: string | null = null;

  const major = Number.parseInt(nodeVersion.replace(/^v/, '').split('.')[0] ?? '0', 10);
  const nodeOk = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  checks.push({
    name: 'Node.js version',
    ok: nodeOk,
    detail: nodeOk
      ? `${nodeVersion} (minimum ${MIN_NODE_MAJOR})`
      : `${nodeVersion} is too old — offgrid-vision requires Node.js ${MIN_NODE_MAJOR} or newer`,
  });

  let installed: string[] = [];
  let reachable = true;
  try {
    installed = await backend.listModels();
    checks.push({ name: 'Ollama reachable', ok: true, detail: `responding at ${config.host}` });
  } catch (cause) {
    reachable = false;
    checks.push({
      name: 'Ollama reachable',
      ok: false,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
    if (cause instanceof BackendUnavailableError) remediation = cause.remediation;
  }

  if (!reachable) {
    checks.push({
      name: 'Model available',
      ok: false,
      detail: 'skipped — the server could not be reached',
    });
  } else {
    const present = installed.some((name) => modelMatches(config.model, name));
    checks.push({
      name: 'Model available',
      ok: present,
      detail: present
        ? `${config.model} is installed`
        : `${config.model} is not installed`,
    });
    if (!present) remediation = modelRemediation(config.model, config.host, installed);
  }

  return { ok: checks.every((check) => check.ok), checks, remediation };
}

/**
 * FR-2.4: the fast preflight `analyze` runs before touching any file. Throws the
 * same actionable error the doctor command prints.
 */
export async function preflight(backend: Backend, config: ResolvedConfig): Promise<void> {
  const installed = await backend.listModels();
  if (!installed.some((name) => modelMatches(config.model, name))) {
    throw new BackendUnavailableError(
      `Model "${config.model}" is not available on ${config.host}`,
      modelRemediation(config.model, config.host, installed),
    );
  }
}

export const DOCTOR_HELP = `Usage: offgrid-vision doctor [options]

Check that this machine can run local image analysis.

Options:
  --model <name>   Model to check for       (env OFFGRID_MODEL, default gemma3:12b)
  --host <url>     Ollama host              (env OLLAMA_HOST, default http://localhost:11434)
  --json           Emit the report as JSON on stdout
  -h, --help       Show this help

Exit codes: 0 healthy, 3 backend unavailable or model missing.`;

export async function runDoctorCommand(argv: string[], io: CommandIO): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: 'string' },
      host: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    io.stdout(`${DOCTOR_HELP}\n`);
    return EXIT.SUCCESS;
  }

  const config = resolveConfig({ model: values.model, host: values.host }, io.env);
  if (!isLocalHost(config.host)) {
    io.stderr(`warning: ${config.host} is not a local address — image data will leave this machine\n`);
  }

  const backend = createOllamaBackend(config.host);
  const report = await runChecks(backend, config, process.version);

  if (values.json) {
    io.stdout(`${JSON.stringify({ ...report, host: config.host, model: config.model }, null, 2)}\n`);
  } else {
    const lines = report.checks.map((check) => `${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
    io.stdout(`${lines.join('\n')}\n`);
    if (report.remediation) io.stdout(`\n${report.remediation}\n`);
  }

  return report.ok ? EXIT.SUCCESS : EXIT.BACKEND;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/doctor.test.ts`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add doctor command and shared analyze preflight"
```

---

### Task 9: Human-readable renderer

**Files:**
- Create: `src/render.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `AnalysisResult` (Task 4).
- Produces: `renderHuman(results: AnalysisResult[]): string`

The default (non-`--json`) stdout format. Plain text, no colors — output may be piped or captured, and ANSI codes would only get in the way.

- [ ] **Step 1: Write the failing tests**

Create `test/render.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { renderHuman } from '../src/render.js';
import type { AnalysisResult } from '../src/schema.js';

const ok: AnalysisResult = {
  file: '/tmp/shot.png',
  model: 'gemma3:12b',
  duration_ms: 8421,
  analysis: {
    description: 'A desktop application showing a modal error dialog.',
    objects: [
      { name: 'error dialog', confidence: 'high' },
      { name: 'close button', confidence: 'medium' },
    ],
    text: 'Error: connection refused (code 111)',
    tags: ['screenshot', 'error-dialog'],
  },
  metadata: {
    bytes: 148223, format: 'png', width: 1280, height: 800,
    sha256: 'abc123', analyzed_at: '2026-07-21T10:15:00.000Z',
  },
  error: null,
};

const failed: AnalysisResult = {
  file: '/tmp/notes.txt',
  model: 'gemma3:12b',
  duration_ms: 3,
  analysis: null,
  metadata: null,
  error: { code: 'UNSUPPORTED_FORMAT', message: 'not a supported image' },
};

describe('renderHuman', () => {
  it('renders the file, description, objects, text, and tags', () => {
    const out = renderHuman([ok]);
    expect(out).toContain('/tmp/shot.png');
    expect(out).toContain('A desktop application showing a modal error dialog.');
    expect(out).toContain('error dialog (high)');
    expect(out).toContain('Error: connection refused (code 111)');
    expect(out).toContain('screenshot, error-dialog');
    expect(out).toContain('1280x800');
    expect(out).toContain('8421 ms');
  });

  it('omits the text section when no text was found', () => {
    const noText = { ...ok, analysis: { ...ok.analysis!, text: '' } };
    expect(renderHuman([noText])).not.toContain('Text:');
  });

  it('renders errors with their code', () => {
    const out = renderHuman([failed]);
    expect(out).toContain('UNSUPPORTED_FORMAT');
    expect(out).toContain('not a supported image');
  });

  it('flags unparsed output and shows the raw reply', () => {
    const unparsed: AnalysisResult = {
      ...ok,
      analysis: { description: '', objects: [], text: '', tags: [], raw: 'gibberish', parse_error: true },
      error: { code: 'PARSE_ERROR', message: 'no valid JSON' },
    };
    const out = renderHuman([unparsed]);
    expect(out).toContain('gibberish');
    expect(out).toContain('PARSE_ERROR');
  });

  it('appends a summary line only for multi-file runs', () => {
    expect(renderHuman([ok])).not.toContain('2 files');
    const out = renderHuman([ok, failed]);
    expect(out).toContain('2 files');
    expect(out).toContain('1 succeeded');
    expect(out).toContain('1 failed');
  });

  it('handles an empty result set', () => {
    expect(renderHuman([])).toContain('No files');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — `Failed to resolve import "../src/render.js"`.

- [ ] **Step 3: Write `src/render.ts`**

```typescript
import type { AnalysisResult } from './schema.js';

function renderOne(result: AnalysisResult): string {
  const lines: string[] = [result.file];

  if (result.metadata) {
    const { format, width, height, bytes } = result.metadata;
    const size = width !== null && height !== null ? `${width}x${height}` : 'unknown size';
    lines.push(`  ${format}, ${size}, ${bytes} bytes, ${result.duration_ms} ms`);
  }

  if (result.error) {
    lines.push(`  ERROR [${result.error.code}] ${result.error.message}`);
  }

  const analysis = result.analysis;
  if (analysis) {
    if (analysis.parse_error && analysis.raw) {
      lines.push('  Raw model output (could not be parsed):');
      lines.push(`    ${analysis.raw.split('\n').join('\n    ')}`);
    } else {
      lines.push(`  ${analysis.description}`);
      if (analysis.objects.length) {
        const objects = analysis.objects.map((o) => `${o.name} (${o.confidence})`).join(', ');
        lines.push(`  Objects: ${objects}`);
      }
      if (analysis.text) {
        lines.push('  Text:');
        lines.push(`    ${analysis.text.split('\n').join('\n    ')}`);
      }
      if (analysis.tags.length) {
        lines.push(`  Tags: ${analysis.tags.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

export function renderHuman(results: AnalysisResult[]): string {
  if (results.length === 0) return 'No files were analyzed.\n';

  const body = results.map(renderOne).join('\n\n');
  if (results.length === 1) return `${body}\n`;

  const failed = results.filter((result) => result.error !== null).length;
  const summary = `${results.length} files — ${results.length - failed} succeeded, ${failed} failed`;
  return `${body}\n\n${summary}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/render.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: render human-readable analysis output"
```

---

### Task 10: Analyze command — flags, concurrency, output modes, exit codes

**Files:**
- Create: `src/commands/analyze.ts`
- Test: `test/analyze-command.test.ts`

**Interfaces:**
- Consumes: `CommandIO`, `preflight` (Task 8); `analyzeFile` (Task 7); `discoverFiles` (Task 3); `renderHuman` (Task 9); `summarize`, `RunReport` (Task 4); `isMode`, `MODES` (Task 5); `resolveConfig`, `isLocalHost` (Task 1); `createOllamaBackend` (Task 6); `EXIT`, `UsageError`, `BackendUnavailableError` (Task 1).
- Produces:
  - `ANALYZE_HELP: string`
  - `runAnalyzeCommand(argv: string[], io: CommandIO): Promise<number>`

Covers FR-1.1, FR-1.5–FR-1.9, FR-2.4, FR-4.3. The two rules that matter most: **stdout is payload-only in `--json` mode** (all progress to stderr), and **exit code is deterministic** — 3 if the backend is unavailable, 1 if any file failed, 0 otherwise.

- [ ] **Step 1: Write the failing tests**

Create `test/analyze-command.test.ts`.

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAnalyzeCommand } from '../src/commands/analyze.js';
import type { CommandIO } from '../src/commands/doctor.js';
import { startMockOllama, type MockOllama } from './helpers/mock-ollama.js';
import { pngFixture, textFixture } from './helpers/fixtures.js';

let root: string;
let mock: MockOllama | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-cmd-'));
  await mkdir(path.join(root, 'sub'), { recursive: true });
  await writeFile(path.join(root, 'a.png'), pngFixture());
  await writeFile(path.join(root, 'b.png'), pngFixture());
  await writeFile(path.join(root, 'sub', 'c.png'), pngFixture());
  await writeFile(path.join(root, 'notes.txt'), textFixture());
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

interface Captured {
  io: CommandIO;
  out: () => string;
  err: () => string;
}

function makeIO(env: NodeJS.ProcessEnv = {}): Captured {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    io: {
      stdout: (text) => outChunks.push(text),
      stderr: (text) => errChunks.push(text),
      env,
      cwd: root,
      isTTY: false,
    },
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

describe('runAnalyzeCommand', () => {
  it('emits a bare JSON object for a single file and exits 0', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    const code = await runAnalyzeCommand(
      [path.join(root, 'a.png'), '--json', '--host', mock.url],
      cap.io,
    );

    expect(code).toBe(0);
    const payload = JSON.parse(cap.out()) as Record<string, unknown>;
    expect(Array.isArray(payload)).toBe(false);
    expect(payload.file).toBe(path.join(root, 'a.png'));
    expect(payload.error).toBeNull();
  });

  it('emits a JSON array for multiple files', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([root, '--json', '--host', mock.url], cap.io);

    const payload = JSON.parse(cap.out()) as unknown[];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(4);
  });

  it('keeps stdout free of progress output in json mode', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([root, '--json', '--host', mock.url], cap.io);

    expect(() => JSON.parse(cap.out())).not.toThrow();
    expect(cap.err()).toMatch(/a\.png/);
  });

  it('honors --no-recursive', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([root, '--json', '--no-recursive', '--host', mock.url], cap.io);

    const payload = JSON.parse(cap.out()) as Array<{ file: string }>;
    expect(payload.every((r) => !r.file.includes(`${path.sep}sub${path.sep}`))).toBe(true);
  });

  it('continues past a failing file and exits 1', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    const code = await runAnalyzeCommand([root, '--json', '--host', mock.url], cap.io);

    const payload = JSON.parse(cap.out()) as Array<{ file: string; error: { code: string } | null }>;
    expect(code).toBe(1);
    expect(payload.filter((r) => r.error === null)).toHaveLength(3);
    expect(payload.find((r) => r.file.endsWith('notes.txt'))?.error?.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('writes a report with results and summary to --out', async () => {
    mock = await startMockOllama();
    const outFile = path.join(root, 'report.json');
    const cap = makeIO();
    await runAnalyzeCommand(
      [path.join(root, 'a.png'), '--out', outFile, '--host', mock.url],
      cap.io,
    );

    const report = JSON.parse(await readFile(outFile, 'utf8')) as {
      results: unknown[];
      summary: { total: number; ok: number; failed: number; model: string };
    };
    expect(report.results).toHaveLength(1);
    expect(report.summary).toMatchObject({ total: 1, ok: 1, failed: 0, model: 'gemma3:12b' });
    await rm(outFile, { force: true });
  });

  it('renders human-readable output by default', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([path.join(root, 'a.png'), '--host', mock.url], cap.io);

    expect(cap.out()).toContain('a.png');
    expect(() => JSON.parse(cap.out())).toThrow();
  });

  it('passes --mode and --prompt through to the model', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand(
      [path.join(root, 'a.png'), '--json', '--mode', 'ocr', '--prompt', 'read the receipt total', '--host', mock.url],
      cap.io,
    );

    const body = mock.requests.find((r) => r.path === '/api/chat')?.body as Record<string, unknown>;
    const content = (body.messages as Array<Record<string, unknown>>)[0]?.content as string;
    expect(content.toLowerCase()).toContain('verbatim');
    expect(content).toContain('read the receipt total');
  });

  it('rejects an unknown mode with exit code 2', async () => {
    const cap = makeIO();
    const code = await runAnalyzeCommand([path.join(root, 'a.png'), '--mode', 'video'], cap.io);
    expect(code).toBe(2);
    expect(cap.err()).toContain('general, ocr, alt-text, ui');
  });

  it('rejects a concurrency above the maximum with exit code 2', async () => {
    const cap = makeIO();
    expect(await runAnalyzeCommand([path.join(root, 'a.png'), '--concurrency', '9'], cap.io)).toBe(2);
    expect(await runAnalyzeCommand([path.join(root, 'a.png'), '--concurrency', '0'], cap.io)).toBe(2);
  });

  it('requires at least one path', async () => {
    const cap = makeIO();
    expect(await runAnalyzeCommand(['--json'], cap.io)).toBe(2);
  });

  it('processes files with --concurrency 4 and still returns every result', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    const code = await runAnalyzeCommand(
      [path.join(root, 'a.png'), path.join(root, 'b.png'), path.join(root, 'sub', 'c.png'),
       '--json', '--concurrency', '4', '--host', mock.url],
      cap.io,
    );

    expect(code).toBe(0);
    expect(JSON.parse(cap.out())).toHaveLength(3);
  });

  it('preserves input order in the output regardless of concurrency', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    await runAnalyzeCommand([root, '--json', '--concurrency', '4', '--host', mock.url], cap.io);

    const files = (JSON.parse(cap.out()) as Array<{ file: string }>).map((r) => r.file);
    expect([...files].sort()).toEqual(files);
  });

  it('fails preflight with exit code 3 and remediation on stderr', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const cap = makeIO();
    const code = await runAnalyzeCommand([path.join(root, 'a.png'), '--host', mock.url], cap.io);

    expect(code).toBe(3);
    expect(cap.err()).toContain('ollama pull gemma3:12b');
  });

  it('embeds the preflight failure in stdout JSON when --json is set', async () => {
    mock = await startMockOllama({ models: ['llama3:8b'] });
    const cap = makeIO();
    const code = await runAnalyzeCommand([path.join(root, 'a.png'), '--json', '--host', mock.url], cap.io);

    expect(code).toBe(3);
    const payload = JSON.parse(cap.out()) as { error: { code: string; message: string; remediation: string } };
    expect(payload.error.code).toBe('BACKEND_UNAVAILABLE');
    expect(payload.error.remediation).toContain('ollama pull gemma3:12b');
  });

  it('reads configuration from env vars', async () => {
    mock = await startMockOllama({ models: ['gemma3:4b'] });
    const cap = makeIO({ OLLAMA_HOST: mock.url, OFFGRID_MODEL: 'gemma3:4b' });
    const code = await runAnalyzeCommand([path.join(root, 'a.png'), '--json'], cap.io);

    expect(code).toBe(0);
    expect((JSON.parse(cap.out()) as { model: string }).model).toBe('gemma3:4b');
  });

  it('warns on stderr when the host is not local', async () => {
    const cap = makeIO();
    await runAnalyzeCommand([path.join(root, 'a.png'), '--host', 'http://10.0.0.5:11434'], cap.io);
    expect(cap.err()).toMatch(/not a local address/);
  });

  it('reports a missing path as an IO error with exit code 1', async () => {
    mock = await startMockOllama();
    const cap = makeIO();
    const code = await runAnalyzeCommand(
      [path.join(root, 'ghost.png'), '--json', '--host', mock.url],
      cap.io,
    );
    expect(code).toBe(1);
    expect((JSON.parse(cap.out()) as { error: { code: string } }).error.code).toBe('IO_ERROR');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/analyze-command.test.ts`
Expected: FAIL — `Failed to resolve import "../src/commands/analyze.js"`.

- [ ] **Step 3: Write `src/commands/analyze.ts`**

```typescript
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { BackendUnavailableError, EXIT, UsageError } from '../errors.js';
import { isLocalHost, resolveConfig } from '../config.js';
import { createOllamaBackend } from '../backends/ollama.js';
import { discoverFiles } from '../media.js';
import { analyzeFile } from '../analyzer.js';
import { isMode, MODES, type Mode } from '../prompts/index.js';
import { summarize, type AnalysisResult, type RunReport } from '../schema.js';
import { renderHuman } from '../render.js';
import { preflight, type CommandIO } from './doctor.js';

export const MAX_CONCURRENCY = 4;

export const ANALYZE_HELP = `Usage: offgrid-vision analyze <path...> [options]

Analyze images locally with Ollama. Paths may be files or directories.

Options:
  --json                 Emit JSON on stdout (object for one file, array for many)
  --out <file>           Write { results, summary } JSON to a file
  --mode <preset>        general | ocr | alt-text | ui           (default general)
  --prompt <text>        Extra focus instruction for the model
  --model <name>         Model to use        (env OFFGRID_MODEL, default gemma3:12b)
  --host <url>           Ollama host         (env OLLAMA_HOST, default http://localhost:11434)
  --timeout <ms>         Per-file timeout    (env OFFGRID_TIMEOUT, default 120000)
  --concurrency <n>      Files in flight at once, 1-${MAX_CONCURRENCY}          (default 1)
  --no-recursive         Do not descend into subdirectories
  -h, --help             Show this help

Exit codes: 0 success, 1 one or more files failed, 2 usage error, 3 backend unavailable.`;

interface AnalyzeArgs {
  paths: string[];
  json: boolean;
  out?: string;
  mode: Mode;
  prompt?: string;
  model?: string;
  host?: string;
  timeout?: number;
  concurrency: number;
  recursive: boolean;
}

function parseAnalyzeArgs(argv: string[]): AnalyzeArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        json: { type: 'boolean', default: false },
        out: { type: 'string' },
        mode: { type: 'string', default: 'general' },
        prompt: { type: 'string' },
        model: { type: 'string' },
        host: { type: 'string' },
        timeout: { type: 'string' },
        concurrency: { type: 'string', default: '1' },
        recursive: { type: 'boolean', default: true },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
      allowNegative: true,
    });
  } catch (cause) {
    throw new UsageError(cause instanceof Error ? cause.message : String(cause));
  }

  const { values, positionals } = parsed;
  if (values.help) throw new UsageError('__help__');
  if (positionals.length === 0) {
    throw new UsageError('At least one file or directory path is required.');
  }

  const mode = values.mode ?? 'general';
  if (!isMode(mode)) {
    throw new UsageError(`Unknown --mode "${mode}". Valid modes: ${MODES.join(', ')}`);
  }

  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new UsageError(`--concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
  }

  let timeout: number | undefined;
  if (values.timeout !== undefined) {
    timeout = Number(values.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new UsageError('--timeout must be a positive number of milliseconds');
    }
  }

  return {
    paths: positionals,
    json: values.json ?? false,
    out: values.out,
    mode,
    prompt: values.prompt,
    model: values.model,
    host: values.host,
    timeout,
    concurrency,
    recursive: values.recursive ?? true,
  };
}

/**
 * Run `worker` over every item with at most `limit` in flight, writing each
 * result back to its original index so output order always matches input order.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function drain(): Promise<void> {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return results;
}

export async function runAnalyzeCommand(argv: string[], io: CommandIO): Promise<number> {
  let args: AnalyzeArgs;
  try {
    args = parseAnalyzeArgs(argv);
  } catch (cause) {
    if (cause instanceof UsageError && cause.message === '__help__') {
      io.stdout(`${ANALYZE_HELP}\n`);
      return EXIT.SUCCESS;
    }
    io.stderr(`${cause instanceof Error ? cause.message : String(cause)}\n\n${ANALYZE_HELP}\n`);
    return EXIT.USAGE;
  }

  const config = resolveConfig(
    { model: args.model, host: args.host, timeout: args.timeout },
    io.env,
  );
  if (!isLocalHost(config.host)) {
    io.stderr(`warning: ${config.host} is not a local address — image data will leave this machine\n`);
  }

  const backend = createOllamaBackend(config.host);

  // FR-2.4: fail fast with the doctor's remediation before touching any file.
  try {
    await preflight(backend, config);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const remediation = cause instanceof BackendUnavailableError ? cause.remediation : '';
    if (args.json) {
      io.stdout(`${JSON.stringify({
        results: [],
        error: { code: 'BACKEND_UNAVAILABLE', message, remediation },
      }, null, 2)}\n`);
    }
    io.stderr(`${message}\n\n${remediation}\n`);
    return EXIT.BACKEND;
  }

  let files: string[];
  try {
    files = await discoverFiles(args.paths, { recursive: args.recursive });
  } catch (cause) {
    // A bad path is a per-file IO error, not a crash — report it in the contract shape.
    const result: AnalysisResult = {
      file: args.paths.join(', '),
      model: config.model,
      duration_ms: 0,
      analysis: null,
      metadata: null,
      error: { code: 'IO_ERROR', message: cause instanceof Error ? cause.message : String(cause) },
    };
    if (args.json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    else io.stdout(renderHuman([result]));
    return EXIT.RUNTIME;
  }

  if (files.length === 0) {
    io.stderr('No supported image files were found.\n');
    if (args.json) io.stdout('[]\n');
    return EXIT.SUCCESS;
  }

  const startedAt = Date.now();
  let completed = 0;
  const results = await mapWithConcurrency(files, args.concurrency, async (file) => {
    io.stderr(`[${++completed}/${files.length}] analyzing ${file}\n`);
    return analyzeFile(file, {
      backend,
      model: config.model,
      timeoutMs: config.timeoutMs,
      mode: args.mode,
      customPrompt: args.prompt,
    });
  });
  const durationMs = Date.now() - startedAt;

  if (args.out) {
    const report: RunReport = {
      results,
      summary: summarize(results, config.model, durationMs),
    };
    await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    io.stderr(`wrote ${args.out}\n`);
  }

  if (args.json) {
    const payload = results.length === 1 ? results[0] : results;
    io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (!args.out) {
    io.stdout(renderHuman(results));
  }

  const failed = results.filter((result) => result.error !== null);
  if (failed.length === 0) return EXIT.SUCCESS;
  if (failed.every((result) => result.error?.code === 'BACKEND_UNAVAILABLE')) return EXIT.BACKEND;
  return EXIT.RUNTIME;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/analyze-command.test.ts`
Expected: PASS — 17 tests passing.

If `allowNegative` is rejected by the installed Node version, `--no-recursive` will not toggle the `recursive` boolean. `allowNegative` landed in Node 22.4; on Node 20 replace the option with an explicit `'no-recursive': { type: 'boolean', default: false }` entry, drop `allowNegative`, and compute `recursive: !values['no-recursive']`. Verify with `node -e "console.log(process.version)"` before choosing.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add analyze command with concurrency, output modes, and preflight"
```

---

### Task 11: Skill target path resolution

**Files:**
- Create: `src/skill/paths.ts`
- Test: `test/skill-paths.test.ts`

**Interfaces:**
- Consumes: `UsageError` (Task 1).
- Produces:
  - `type Harness = 'claude-code' | 'generic'`, `type Scope = 'user' | 'project'`
  - `HARNESSES: readonly Harness[]`, `SCOPES: readonly Scope[]`
  - `SKILL_NAME = 'offgrid-vision'`
  - `isHarness(value: string): value is Harness`, `isScope(value: string): value is Scope`
  - `interface TargetInput { harness?: string; scope?: string; dir?: string; homedir: string; cwd: string; isTTY: boolean }`
  - `interface SkillTarget { harness: Harness; scope: Scope; dir: string; detected: boolean }`
  - `resolveTarget(input: TargetInput): SkillTarget`

FR-3.2's auto-detection lives here, isolated from all filesystem writes so it can be tested with plain string inputs on any OS. `dir` is always the **skill directory itself** (`.../skills/offgrid-vision`), never its parent — Task 13 deletes exactly this path, which is how FR-3.5's "never touch other directories" is guaranteed.

- [ ] **Step 1: Write the failing tests**

Create `test/skill-paths.test.ts`.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveTarget, isHarness, isScope, SKILL_NAME } from '../src/skill/paths.js';
import { UsageError } from '../src/errors.js';

let home: string;
let project: string;
let bare: string;

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'offgrid-paths-'));
  home = path.join(root, 'home');
  project = path.join(root, 'project');
  bare = path.join(root, 'bare');
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(path.join(project, '.claude'), { recursive: true });
  await mkdir(bare, { recursive: true });
});

afterAll(async () => {
  await rm(path.dirname(home), { recursive: true, force: true });
});

describe('isHarness / isScope', () => {
  it('validates known values', () => {
    expect(isHarness('claude-code')).toBe(true);
    expect(isHarness('generic')).toBe(true);
    expect(isHarness('cursor')).toBe(false);
    expect(isScope('user')).toBe(true);
    expect(isScope('project')).toBe(true);
    expect(isScope('global')).toBe(false);
  });
});

describe('resolveTarget', () => {
  it('resolves claude-code user scope under the home directory', () => {
    const target = resolveTarget({ harness: 'claude-code', scope: 'user', homedir: home, cwd: bare, isTTY: false });
    expect(target.dir).toBe(path.join(home, '.claude', 'skills', SKILL_NAME));
    expect(target.detected).toBe(false);
  });

  it('resolves claude-code project scope under the cwd', () => {
    const target = resolveTarget({ harness: 'claude-code', scope: 'project', homedir: home, cwd: project, isTTY: false });
    expect(target.dir).toBe(path.join(project, '.claude', 'skills', SKILL_NAME));
  });

  it('uses --dir verbatim for the generic harness', () => {
    const custom = path.join(bare, 'my-skills');
    const target = resolveTarget({ harness: 'generic', dir: custom, homedir: home, cwd: bare, isTTY: false });
    expect(target.dir).toBe(path.join(custom, SKILL_NAME));
  });

  it('resolves a relative --dir against the cwd', () => {
    const target = resolveTarget({ harness: 'generic', dir: './skills', homedir: home, cwd: bare, isTTY: false });
    expect(path.isAbsolute(target.dir)).toBe(true);
    expect(target.dir).toBe(path.join(bare, 'skills', SKILL_NAME));
  });

  it('requires --dir for the generic harness', () => {
    expect(() => resolveTarget({ harness: 'generic', homedir: home, cwd: bare, isTTY: false }))
      .toThrow(UsageError);
  });

  it('rejects an unknown harness or scope', () => {
    expect(() => resolveTarget({ harness: 'cursor', homedir: home, cwd: bare, isTTY: false })).toThrow(UsageError);
    expect(() => resolveTarget({ harness: 'claude-code', scope: 'global', homedir: home, cwd: bare, isTTY: false })).toThrow(UsageError);
  });

  it('prefers project scope when the cwd has a .claude directory', () => {
    const target = resolveTarget({ homedir: home, cwd: project, isTTY: false });
    expect(target).toMatchObject({ harness: 'claude-code', scope: 'project', detected: true });
    expect(target.dir).toBe(path.join(project, '.claude', 'skills', SKILL_NAME));
  });

  it('falls back to user scope when only the home directory has .claude', () => {
    const target = resolveTarget({ homedir: home, cwd: bare, isTTY: false });
    expect(target).toMatchObject({ harness: 'claude-code', scope: 'user', detected: true });
  });

  it('defaults to claude-code user scope in a non-TTY with nothing detected', () => {
    const target = resolveTarget({ homedir: bare, cwd: bare, isTTY: false });
    expect(target).toMatchObject({ harness: 'claude-code', scope: 'user' });
    expect(target.dir).toBe(path.join(bare, '.claude', 'skills', SKILL_NAME));
  });

  it('honors an explicit scope over detection', () => {
    const target = resolveTarget({ harness: 'claude-code', scope: 'user', homedir: home, cwd: project, isTTY: false });
    expect(target.scope).toBe('user');
    expect(target.detected).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/skill-paths.test.ts`
Expected: FAIL — `Failed to resolve import "../src/skill/paths.js"`.

- [ ] **Step 3: Write `src/skill/paths.ts`**

```typescript
import { existsSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';

export type Harness = 'claude-code' | 'generic';
export type Scope = 'user' | 'project';

export const HARNESSES: readonly Harness[] = ['claude-code', 'generic'];
export const SCOPES: readonly Scope[] = ['user', 'project'];

export const SKILL_NAME = 'offgrid-vision';

export function isHarness(value: string): value is Harness {
  return (HARNESSES as readonly string[]).includes(value);
}

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

export interface TargetInput {
  harness?: string;
  scope?: string;
  dir?: string;
  homedir: string;
  cwd: string;
  isTTY: boolean;
}

export interface SkillTarget {
  harness: Harness;
  scope: Scope;
  /** Absolute path of the skill directory itself, not its parent. */
  dir: string;
  /** True when the harness/scope came from auto-detection rather than flags. */
  detected: boolean;
}

/**
 * Decide where the skill directory belongs.
 *
 * With no flags, prefer a project-local .claude over the user's, then fall back
 * to claude-code/user — the documented non-TTY default (FR-3.2).
 */
export function resolveTarget(input: TargetInput): SkillTarget {
  if (input.harness !== undefined && !isHarness(input.harness)) {
    throw new UsageError(`Unknown --harness "${input.harness}". Supported: ${HARNESSES.join(', ')}`);
  }
  if (input.scope !== undefined && !isScope(input.scope)) {
    throw new UsageError(`Unknown --scope "${input.scope}". Supported: ${SCOPES.join(', ')}`);
  }

  const harness = input.harness as Harness | undefined;
  const scope = input.scope as Scope | undefined;

  if (harness === 'generic') {
    if (!input.dir) {
      throw new UsageError('--harness generic requires --dir <path> naming the skills directory.');
    }
    return {
      harness: 'generic',
      scope: scope ?? 'project',
      dir: path.join(path.resolve(input.cwd, input.dir), SKILL_NAME),
      detected: false,
    };
  }

  const explicit = harness !== undefined || scope !== undefined;
  let effectiveScope: Scope;
  let detected = false;

  if (scope !== undefined) {
    effectiveScope = scope;
  } else if (existsSync(path.join(input.cwd, '.claude'))) {
    effectiveScope = 'project';
    detected = !explicit;
  } else if (existsSync(path.join(input.homedir, '.claude'))) {
    effectiveScope = 'user';
    detected = !explicit;
  } else {
    effectiveScope = 'user';
  }

  const base = effectiveScope === 'user' ? input.homedir : input.cwd;
  return {
    harness: 'claude-code',
    scope: effectiveScope,
    dir: path.join(base, '.claude', 'skills', SKILL_NAME),
    detected,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/skill-paths.test.ts`
Expected: PASS — 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: resolve skill install targets per harness and scope"
```

---

### Task 12: Skill templates and idempotent install/uninstall

**Files:**
- Create: `src/skill/templates.ts`, `src/skill/install.ts`
- Test: `test/skill-templates.test.ts`, `test/skill-install.test.ts`

**Interfaces:**
- Consumes: `SKILL_NAME` (Task 11), `getVersion` (Task 1), `MODES` (Task 5).
- Produces:
  - `renderSkillMd(version: string): string`
  - `renderSchemaMd(version: string): string`
  - `interface InstallResult { dir: string; files: string[]; updated: boolean }`
  - `installSkill(dir: string, version: string): Promise<InstallResult>`
  - `interface UninstallResult { dir: string; removed: boolean }`
  - `uninstallSkill(dir: string): Promise<UninstallResult>`

Templates are TypeScript string builders rather than copied asset files: they compile into `dist/` automatically, so no build-time asset copying can go wrong, and FR-3.7's "always references the installing CLI version" falls out for free.

- [ ] **Step 1: Write the failing template tests**

Create `test/skill-templates.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { renderSkillMd, renderSchemaMd } from '../src/skill/templates.js';

describe('renderSkillMd', () => {
  const skill = renderSkillMd('1.2.3');

  it('opens with YAML frontmatter carrying name and description', () => {
    expect(skill.startsWith('---\n')).toBe(true);
    const frontmatter = skill.split('---')[1] ?? '';
    expect(frontmatter).toContain('name: offgrid-vision');
    expect(frontmatter).toMatch(/^description: .+/m);
  });

  it('keeps the description on a single line so the YAML stays valid', () => {
    const description = /^description: (.*)$/m.exec(skill)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(80);
    expect(description).not.toContain('\n');
  });

  it('writes a trigger-oriented description naming the media it handles', () => {
    const description = /^description: (.*)$/m.exec(skill)?.[1]?.toLowerCase() ?? '';
    for (const cue of ['image', 'screenshot', 'photo', 'diagram', 'use this']) {
      expect(description).toContain(cue);
    }
  });

  it('instructs the harness to run doctor once per session', () => {
    expect(skill).toContain('npx offgrid-vision doctor');
    expect(skill.toLowerCase()).toContain('once per session');
  });

  it('mandates --json and stdout', () => {
    expect(skill).toContain('--json');
    expect(skill.toLowerCase()).toContain('stdout');
  });

  it('documents every mode preset', () => {
    for (const mode of ['general', 'ocr', 'alt-text', 'ui']) {
      expect(skill).toContain(mode);
    }
  });

  it('tells the harness to batch images into one invocation', () => {
    expect(skill.toLowerCase()).toContain('batch');
    expect(skill).toMatch(/analyze .*\.png .*\.png/);
  });

  it('states the fallback rule', () => {
    expect(skill.toLowerCase()).toContain('fallback');
    expect(skill.toLowerCase()).toContain('inform the user');
  });

  it('points at the bundled schema reference and stamps the version', () => {
    expect(skill).toContain('references/schema.md');
    expect(skill).toContain('1.2.3');
  });
});

describe('renderSchemaMd', () => {
  const schema = renderSchemaMd('1.2.3');

  it('documents every contract field', () => {
    for (const field of [
      'file', 'model', 'duration_ms', 'analysis', 'metadata', 'error',
      'description', 'objects', 'text', 'tags',
      'bytes', 'format', 'width', 'height', 'sha256', 'analyzed_at',
    ]) {
      expect(schema).toContain(field);
    }
  });

  it('lists every error code', () => {
    for (const code of ['TIMEOUT', 'PARSE_ERROR', 'BACKEND_UNAVAILABLE', 'UNSUPPORTED_FORMAT', 'IO_ERROR']) {
      expect(schema).toContain(code);
    }
  });

  it('documents the exit codes', () => {
    expect(schema).toContain('Exit codes');
    expect(schema).toMatch(/\b3\b/);
  });

  it('contains a valid JSON example', () => {
    const example = /```json\n([\s\S]*?)\n```/.exec(schema)?.[1];
    expect(example).toBeDefined();
    expect(() => JSON.parse(example as string)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/skill-templates.test.ts`
Expected: FAIL — `Failed to resolve import "../src/skill/templates.js"`.

- [ ] **Step 3: Write `src/skill/templates.ts`**

```typescript
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
| \`--model <name>\` | Override the model, e.g. \`gemma3:4b\` on a low-memory machine |
| \`--timeout <ms>\` | Per-file deadline, default 120000 |
| \`--concurrency <n>\` | Up to 4 files in flight; helps on large batches |
| \`--no-recursive\` | Do not descend into subdirectories |

## Fallback rule

If the tool is unavailable — Ollama not installed, model missing, repeated
errors — you may fall back to your own vision capability, but **tell the user**
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
  "file": "screenshots/error.png",
  "model": "gemma3:12b",
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
```

- [ ] **Step 4: Run the template tests to verify they pass**

Run: `npx vitest run test/skill-templates.test.ts`
Expected: PASS — 13 tests passing.

- [ ] **Step 5: Write the failing install tests**

Create `test/skill-install.test.ts`.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSkill, uninstallSkill } from '../src/skill/install.js';

let root: string;
let skillDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-install-'));
  skillDir = path.join(root, '.claude', 'skills', 'offgrid-vision');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('installSkill', () => {
  it('creates SKILL.md and references/schema.md, making parent directories', async () => {
    const result = await installSkill(skillDir, '1.2.3');

    expect(result.dir).toBe(skillDir);
    expect(result.updated).toBe(false);
    expect(existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(skillDir, 'references', 'schema.md'))).toBe(true);
    expect(result.files.map((f) => path.relative(skillDir, f)).sort())
      .toEqual([path.join('references', 'schema.md'), 'SKILL.md'].sort());
  });

  it('stamps the installing version into both files', async () => {
    await installSkill(skillDir, '1.2.3');
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).toContain('1.2.3');
    expect(await readFile(path.join(skillDir, 'references', 'schema.md'), 'utf8')).toContain('1.2.3');
  });

  it('is idempotent and reports the second run as an update', async () => {
    await installSkill(skillDir, '1.0.0');
    const second = await installSkill(skillDir, '2.0.0');

    expect(second.updated).toBe(true);
    const skill = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(skill).toContain('2.0.0');
    expect(skill).not.toContain('1.0.0');
  });

  it('overwrites a stale file left in the skill directory', async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), 'stale content', 'utf8');
    await installSkill(skillDir, '1.2.3');
    expect(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).not.toBe('stale content');
  });
});

describe('uninstallSkill', () => {
  it('removes exactly the skill directory and leaves siblings alone', async () => {
    const sibling = path.join(root, '.claude', 'skills', 'other-skill');
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(sibling, 'SKILL.md'), 'someone else', 'utf8');
    await installSkill(skillDir, '1.2.3');

    const result = await uninstallSkill(skillDir);

    expect(result).toEqual({ dir: skillDir, removed: true });
    expect(existsSync(skillDir)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
    expect(await readdir(path.join(root, '.claude', 'skills'))).toEqual(['other-skill']);
  });

  it('reports removed: false when nothing is installed', async () => {
    expect(await uninstallSkill(skillDir)).toEqual({ dir: skillDir, removed: false });
  });

  it('refuses to remove a directory that is not our skill', async () => {
    const foreign = path.join(root, 'important-data');
    await mkdir(foreign, { recursive: true });
    await writeFile(path.join(foreign, 'notes.txt'), 'precious', 'utf8');

    await expect(uninstallSkill(foreign)).rejects.toThrow(/offgrid-vision/);
    expect(existsSync(foreign)).toBe(true);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run test/skill-install.test.ts`
Expected: FAIL — `Failed to resolve import "../src/skill/install.js"`.

- [ ] **Step 7: Write `src/skill/install.ts`**

```typescript
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from '../errors.js';
import { SKILL_NAME } from './paths.js';
import { renderSkillMd, renderSchemaMd } from './templates.js';

export interface InstallResult {
  dir: string;
  files: string[];
  updated: boolean;
}

export interface UninstallResult {
  dir: string;
  removed: boolean;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * FR-3.5: writing over our own skill directory is the expected update path, so
 * no --force is required. Parent directories are created as needed.
 */
export async function installSkill(dir: string, version: string): Promise<InstallResult> {
  const updated = await exists(path.join(dir, 'SKILL.md'));

  await mkdir(path.join(dir, 'references'), { recursive: true });

  const skillPath = path.join(dir, 'SKILL.md');
  const schemaPath = path.join(dir, 'references', 'schema.md');
  await writeFile(skillPath, renderSkillMd(version), 'utf8');
  await writeFile(schemaPath, renderSchemaMd(version), 'utf8');

  return { dir, files: [skillPath, schemaPath], updated };
}

/**
 * FR-3.6: remove exactly what we installed. The basename guard is the safety
 * net that keeps a mistyped --dir from deleting an unrelated tree.
 */
export async function uninstallSkill(dir: string): Promise<UninstallResult> {
  if (path.basename(dir) !== SKILL_NAME) {
    throw new UsageError(
      `Refusing to remove ${dir}: an offgrid-vision skill directory must be named "${SKILL_NAME}".`,
    );
  }
  if (!(await exists(dir))) return { dir, removed: false };

  await rm(dir, { recursive: true, force: true });
  return { dir, removed: true };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/skill-install.test.ts`
Expected: PASS — 7 tests passing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: generate and install the offgrid-vision agent skill"
```

---

### Task 13: install-skill and uninstall-skill commands

**Files:**
- Create: `src/commands/install-skill.ts`
- Test: `test/install-skill-command.test.ts`

**Interfaces:**
- Consumes: `CommandIO` (Task 8); `resolveTarget`, `HARNESSES`, `SCOPES` (Task 11); `installSkill`, `uninstallSkill` (Task 12); `getVersion` (Task 1); `EXIT`, `UsageError` (Task 1).
- Produces:
  - `INSTALL_SKILL_HELP: string`, `UNINSTALL_SKILL_HELP: string`
  - `runInstallSkillCommand(argv: string[], io: CommandIO): Promise<number>`
  - `runUninstallSkillCommand(argv: string[], io: CommandIO): Promise<number>`

Both accept the same targeting flags (FR-3.6). Per NFR-3, there are **no interactive prompts** — detection plus a printed statement of what was chosen covers the TTY case without blocking a script.

- [ ] **Step 1: Write the failing tests**

Create `test/install-skill-command.test.ts`.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInstallSkillCommand, runUninstallSkillCommand } from '../src/commands/install-skill.js';
import type { CommandIO } from '../src/commands/doctor.js';

let root: string;
let home: string;
let project: string;

function makeIO(cwd: string, overrides: Partial<CommandIO> = {}) {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const io: CommandIO = {
    stdout: (text) => outChunks.push(text),
    stderr: (text) => errChunks.push(text),
    env: { HOME: home, USERPROFILE: home },
    cwd,
    isTTY: false,
    ...overrides,
  };
  return { io, out: () => outChunks.join(''), err: () => errChunks.join('') };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'offgrid-install-cmd-'));
  home = path.join(root, 'home');
  project = path.join(root, 'project');
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runInstallSkillCommand', () => {
  it('installs into the project scope and reports the path', async () => {
    const cap = makeIO(project);
    const code = await runInstallSkillCommand(['--harness', 'claude-code', '--scope', 'project'], cap.io);

    const expected = path.join(project, '.claude', 'skills', 'offgrid-vision', 'SKILL.md');
    expect(code).toBe(0);
    expect(existsSync(expected)).toBe(true);
    expect(cap.out()).toContain(expected);
  });

  it('installs into the user scope under the resolved home directory', async () => {
    const cap = makeIO(project);
    await runInstallSkillCommand(['--harness', 'claude-code', '--scope', 'user'], cap.io);
    expect(existsSync(path.join(home, '.claude', 'skills', 'offgrid-vision', 'SKILL.md'))).toBe(true);
  });

  it('installs into an arbitrary directory for the generic harness', async () => {
    const target = path.join(root, 'other-harness', 'skills');
    const cap = makeIO(project);
    await runInstallSkillCommand(['--harness', 'generic', '--dir', target], cap.io);
    expect(existsSync(path.join(target, 'offgrid-vision', 'SKILL.md'))).toBe(true);
  });

  it('auto-detects a project .claude directory when no flags are given', async () => {
    await mkdir(path.join(project, '.claude'), { recursive: true });
    const cap = makeIO(project);
    await runInstallSkillCommand([], cap.io);

    expect(existsSync(path.join(project, '.claude', 'skills', 'offgrid-vision', 'SKILL.md'))).toBe(true);
    expect(cap.out().toLowerCase()).toContain('detected');
  });

  it('reports an update rather than a fresh install on re-run', async () => {
    const args = ['--harness', 'claude-code', '--scope', 'project'];
    await runInstallSkillCommand(args, makeIO(project).io);
    const cap = makeIO(project);
    const code = await runInstallSkillCommand(args, cap.io);

    expect(code).toBe(0);
    expect(cap.out().toLowerCase()).toContain('updated');
  });

  it('writes a SKILL.md stamped with the package version', async () => {
    const cap = makeIO(project);
    await runInstallSkillCommand(['--harness', 'claude-code', '--scope', 'project'], cap.io);

    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const skill = await readFile(path.join(project, '.claude', 'skills', 'offgrid-vision', 'SKILL.md'), 'utf8');
    expect(skill).toContain(manifest.version);
  });

  it('rejects an unknown harness with exit code 2', async () => {
    const cap = makeIO(project);
    expect(await runInstallSkillCommand(['--harness', 'cursor'], cap.io)).toBe(2);
    expect(cap.err()).toContain('claude-code, generic');
  });

  it('rejects generic without --dir', async () => {
    const cap = makeIO(project);
    expect(await runInstallSkillCommand(['--harness', 'generic'], cap.io)).toBe(2);
    expect(cap.err()).toContain('--dir');
  });

  it('prints help for --help without installing anything', async () => {
    const cap = makeIO(project);
    expect(await runInstallSkillCommand(['--help'], cap.io)).toBe(0);
    expect(cap.out()).toContain('Usage: offgrid-vision install-skill');
    expect(existsSync(path.join(project, '.claude', 'skills'))).toBe(false);
  });
});

describe('runUninstallSkillCommand', () => {
  it('removes an installed skill and reports the path', async () => {
    const args = ['--harness', 'claude-code', '--scope', 'project'];
    await runInstallSkillCommand(args, makeIO(project).io);

    const cap = makeIO(project);
    const code = await runUninstallSkillCommand(args, cap.io);

    expect(code).toBe(0);
    expect(existsSync(path.join(project, '.claude', 'skills', 'offgrid-vision'))).toBe(false);
    expect(cap.out().toLowerCase()).toContain('removed');
  });

  it('leaves neighboring skills untouched', async () => {
    const args = ['--harness', 'claude-code', '--scope', 'project'];
    await runInstallSkillCommand(args, makeIO(project).io);
    const sibling = path.join(project, '.claude', 'skills', 'other-skill');
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(sibling, 'SKILL.md'), 'someone else', 'utf8');

    await runUninstallSkillCommand(args, makeIO(project).io);

    expect(existsSync(sibling)).toBe(true);
  });

  it('exits 0 with a note when nothing is installed', async () => {
    const cap = makeIO(project);
    const code = await runUninstallSkillCommand(['--harness', 'claude-code', '--scope', 'project'], cap.io);
    expect(code).toBe(0);
    expect(cap.out().toLowerCase()).toMatch(/not installed|nothing/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/install-skill-command.test.ts`
Expected: FAIL — `Failed to resolve import "../src/commands/install-skill.js"`.

- [ ] **Step 3: Write `src/commands/install-skill.ts`**

```typescript
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { EXIT, UsageError } from '../errors.js';
import { getVersion } from '../version.js';
import { HARNESSES, SCOPES, resolveTarget, type SkillTarget } from '../skill/paths.js';
import { installSkill, uninstallSkill } from '../skill/install.js';
import type { CommandIO } from './doctor.js';

const TARGET_FLAGS = `Options:
  --harness <name>   claude-code | generic   (default: auto-detect, else claude-code)
  --scope <name>     user | project          (default: auto-detect, else user)
  --dir <path>       Skills directory; required with --harness generic
  -h, --help         Show this help`;

export const INSTALL_SKILL_HELP = `Usage: offgrid-vision install-skill [options]

Install the offgrid-vision Agent Skill so a harness delegates image analysis
to this CLI instead of spending its own multimodal tokens.

${TARGET_FLAGS}

Targets:
  --harness claude-code --scope user      ~/.claude/skills/offgrid-vision/
  --harness claude-code --scope project   ./.claude/skills/offgrid-vision/
  --harness generic --dir <path>          <path>/offgrid-vision/

Re-running updates the skill in place.`;

export const UNINSTALL_SKILL_HELP = `Usage: offgrid-vision uninstall-skill [options]

Remove the offgrid-vision Agent Skill. Takes the same targeting flags as
install-skill and removes exactly the directory the installer created.

${TARGET_FLAGS}`;

interface TargetFlags {
  harness?: string;
  scope?: string;
  dir?: string;
  help: boolean;
}

function parseTargetFlags(argv: string[]): TargetFlags {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        harness: { type: 'string' },
        scope: { type: 'string' },
        dir: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    });
    return {
      harness: values.harness,
      scope: values.scope,
      dir: values.dir,
      help: values.help ?? false,
    };
  } catch (cause) {
    throw new UsageError(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Honor HOME/USERPROFILE when present so tests can point at a scratch home. */
function resolveHome(io: CommandIO): string {
  return io.env.HOME ?? io.env.USERPROFILE ?? homedir();
}

function resolve(argv: string[], io: CommandIO): SkillTarget {
  const flags = parseTargetFlags(argv);
  if (flags.help) throw new UsageError('__help__');
  return resolveTarget({
    harness: flags.harness,
    scope: flags.scope,
    dir: flags.dir,
    homedir: resolveHome(io),
    cwd: io.cwd,
    isTTY: io.isTTY,
  });
}

function handleUsageError(cause: unknown, io: CommandIO, help: string): number {
  if (cause instanceof UsageError && cause.message === '__help__') {
    io.stdout(`${help}\n`);
    return EXIT.SUCCESS;
  }
  io.stderr(`${cause instanceof Error ? cause.message : String(cause)}\n\n${help}\n`);
  return EXIT.USAGE;
}

export async function runInstallSkillCommand(argv: string[], io: CommandIO): Promise<number> {
  let target: SkillTarget;
  try {
    target = resolve(argv, io);
  } catch (cause) {
    return handleUsageError(cause, io, INSTALL_SKILL_HELP);
  }

  if (target.detected) {
    io.stdout(`Detected harness "${target.harness}" with ${target.scope} scope.\n`);
  }

  try {
    const result = await installSkill(target.dir, getVersion());
    io.stdout(`${result.updated ? 'Updated' : 'Installed'} the offgrid-vision skill:\n`);
    for (const file of result.files) io.stdout(`  ${file}\n`);
    io.stdout('\nStart a new session in that harness for the skill to be picked up.\n');
    return EXIT.SUCCESS;
  } catch (cause) {
    io.stderr(`Failed to install the skill: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return EXIT.RUNTIME;
  }
}

export async function runUninstallSkillCommand(argv: string[], io: CommandIO): Promise<number> {
  let target: SkillTarget;
  try {
    target = resolve(argv, io);
  } catch (cause) {
    return handleUsageError(cause, io, UNINSTALL_SKILL_HELP);
  }

  try {
    const result = await uninstallSkill(target.dir);
    io.stdout(
      result.removed
        ? `Removed the offgrid-vision skill from ${result.dir}\n`
        : `Nothing to do — no skill is installed at ${result.dir}\n`,
    );
    return EXIT.SUCCESS;
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.stderr(`${cause.message}\n`);
      return EXIT.USAGE;
    }
    io.stderr(`Failed to remove the skill: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return EXIT.RUNTIME;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/install-skill-command.test.ts`
Expected: PASS — 12 tests passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add install-skill and uninstall-skill commands"
```

---

### Task 14: CLI entry point

**Files:**
- Create: `src/cli.ts`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: every `run*Command` from Tasks 8, 10, 13; `EXIT` (Task 1); `getVersion` (Task 1).
- Produces:
  - `ROOT_HELP: string`
  - `run(argv: string[], io: CommandIO): Promise<number>`

`src/cli.ts` is the only module that touches `process` — everything below it takes `CommandIO`. That is what makes the whole surface testable in-process, and it keeps a stray `console.log` from ever polluting `--json` stdout.

- [ ] **Step 1: Write the failing tests**

Create `test/cli.test.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { run } from '../src/cli.js';
import type { CommandIO } from '../src/commands/doctor.js';

function makeIO() {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const io: CommandIO = {
    stdout: (text) => outChunks.push(text),
    stderr: (text) => errChunks.push(text),
    env: {},
    cwd: process.cwd(),
    isTTY: false,
  };
  return { io, out: () => outChunks.join(''), err: () => errChunks.join('') };
}

describe('run', () => {
  it('prints root help with no arguments and exits 2', async () => {
    const cap = makeIO();
    expect(await run([], cap.io)).toBe(2);
    expect(cap.err()).toContain('Usage: offgrid-vision');
  });

  it('prints root help for --help and exits 0', async () => {
    const cap = makeIO();
    expect(await run(['--help'], cap.io)).toBe(0);
    expect(cap.out()).toContain('analyze');
    expect(cap.out()).toContain('doctor');
    expect(cap.out()).toContain('install-skill');
    expect(cap.out()).toContain('uninstall-skill');
  });

  it('prints the package version for --version', async () => {
    const cap = makeIO();
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(await run(['--version'], cap.io)).toBe(0);
    expect(cap.out().trim()).toBe(manifest.version);
  });

  it('rejects an unknown command with exit code 2', async () => {
    const cap = makeIO();
    expect(await run(['transcribe', 'video.mp4'], cap.io)).toBe(2);
    expect(cap.err()).toContain('transcribe');
  });

  it('routes to per-command help', async () => {
    const cap = makeIO();
    expect(await run(['analyze', '--help'], cap.io)).toBe(0);
    expect(cap.out()).toContain('Usage: offgrid-vision analyze');
  });

  it('routes install-skill help without installing', async () => {
    const cap = makeIO();
    expect(await run(['install-skill', '--help'], cap.io)).toBe(0);
    expect(cap.out()).toContain('Usage: offgrid-vision install-skill');
  });

  it('propagates a command usage error as exit code 2', async () => {
    const cap = makeIO();
    const code = await run(['analyze', '--concurrency', 'many', 'x.png'], cap.io);
    expect(code).toBe(2);
    expect(cap.err()).toContain('--concurrency');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL — `Failed to resolve import "../src/cli.js"`.

- [ ] **Step 3: Write `src/cli.ts`**

The shebang must be the first line of the file — `tsc` preserves it, and npm sets the executable bit when linking the `bin`.

```typescript
#!/usr/bin/env node
import { EXIT } from './errors.js';
import { getVersion } from './version.js';
import { runAnalyzeCommand } from './commands/analyze.js';
import { runDoctorCommand, type CommandIO } from './commands/doctor.js';
import { runInstallSkillCommand, runUninstallSkillCommand } from './commands/install-skill.js';

export const ROOT_HELP = `offgrid-vision — analyze images locally instead of spending cloud multimodal tokens.

Usage: offgrid-vision <command> [options]

Commands:
  analyze <path...>    Analyze images or directories of images
  doctor               Check that Ollama and the model are ready
  install-skill        Install the Agent Skill into a harness
  uninstall-skill      Remove the Agent Skill

Global:
  -h, --help           Show help (also works per command)
  -v, --version        Print the version

Environment:
  OFFGRID_MODEL        Model name          (default gemma3:12b)
  OLLAMA_HOST          Backend host        (default http://localhost:11434)
  OFFGRID_TIMEOUT      Per-file timeout ms (default 120000)

Examples:
  npx offgrid-vision doctor
  npx offgrid-vision analyze screenshot.png --json
  npx offgrid-vision analyze ./shots --json --mode ui --concurrency 4
  npx offgrid-vision install-skill --harness claude-code --scope project

Exit codes: 0 success, 1 runtime error, 2 usage error, 3 backend unavailable.`;

type CommandHandler = (argv: string[], io: CommandIO) => Promise<number>;

const COMMANDS: Record<string, CommandHandler> = {
  analyze: runAnalyzeCommand,
  doctor: runDoctorCommand,
  'install-skill': runInstallSkillCommand,
  'uninstall-skill': runUninstallSkillCommand,
};

export async function run(argv: string[], io: CommandIO): Promise<number> {
  const [first, ...rest] = argv;

  if (first === undefined) {
    io.stderr(`${ROOT_HELP}\n`);
    return EXIT.USAGE;
  }
  if (first === '--help' || first === '-h' || first === 'help') {
    io.stdout(`${ROOT_HELP}\n`);
    return EXIT.SUCCESS;
  }
  if (first === '--version' || first === '-v') {
    io.stdout(`${getVersion()}\n`);
    return EXIT.SUCCESS;
  }

  const handler = COMMANDS[first];
  if (!handler) {
    io.stderr(`Unknown command "${first}".\n\n${ROOT_HELP}\n`);
    return EXIT.USAGE;
  }

  try {
    return await handler(rest, io);
  } catch (cause) {
    io.stderr(`offgrid-vision: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return EXIT.RUNTIME;
  }
}

/** Only reached when executed as a binary, never when imported by tests. */
async function main(): Promise<void> {
  const io: CommandIO = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  };
  process.exitCode = await run(process.argv.slice(2), io);
}

// Vitest imports this module for `run`; only the real binary should execute main().
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
```

Note the entry guard: comparing `import.meta.url` against `process.argv[1]` keeps `main()` from firing during tests. On Windows the naive `file://` prefix is wrong for drive-letter paths — if the built binary misbehaves there, replace the guard with `pathToFileURL(process.argv[1]).href` imported from `node:url`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/cli.test.ts`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Build and smoke-test the real binary**

```bash
npm run build
node dist/cli.js --version
node dist/cli.js --help
node dist/cli.js doctor; echo "exit=$?"
```

Expected: the version prints; help prints; `doctor` prints check lines and exits 0 if Ollama is running with `gemma3:12b`, or 3 with remediation text if not. Both are correct outcomes — the point is that it does not crash.

- [ ] **Step 6: Verify the whole suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add CLI entry point with command routing and help"
```

---

### Task 15: README and end-to-end acceptance verification

**Files:**
- Create: `README.md`
- Test: manual acceptance run (§9 of the requirements)

**Interfaces:**
- Consumes: the complete CLI from Tasks 1–14.
- Produces: no code. NFR-6 documentation plus a signed-off acceptance pass.

- [ ] **Step 1: Write `README.md`**

Covers NFR-6: install, prerequisites, every command and flag, the output schema, agent-integration guidance, and the "why local" rationale.

````markdown
# offgrid-vision

Analyze images with a local multimodal model instead of spending cloud multimodal tokens.

`offgrid-vision` is a zero-dependency Node.js CLI that sends images to [Ollama](https://ollama.com)
running on your own machine and returns compact structured JSON. It is built to be
called by agent harnesses — and it can install an Agent Skill so a harness knows to
reach for it automatically.

## Why local

| | Cloud multimodal LLM | offgrid-vision |
|---|---|---|
| Cost per image | Thousands of tokens, billed | Free after the model download |
| Latency | Network round trip | Local inference |
| Privacy | The image leaves your machine | The image never leaves your machine |
| Offline | No | Yes |

An agent that reads ten screenshots in a session can spend tens of thousands of
multimodal tokens doing it. Delegating to a local model turns that into a few
hundred tokens of JSON.

## Prerequisites

- **Node.js 20 or newer**
- **[Ollama](https://ollama.com/download)** installed and running
- A vision model pulled:

  ```bash
  ollama pull gemma3:12b     # default; needs roughly 16 GB of RAM
  ollama pull gemma3:4b      # lighter alternative for smaller machines
  ```

Verify everything at once:

```bash
npx offgrid-vision doctor
```

## Quick start

```bash
# Human-readable
npx offgrid-vision analyze screenshot.png

# Machine-readable — this is what agents should use
npx offgrid-vision analyze screenshot.png --json

# A whole directory, four at a time
npx offgrid-vision analyze ./screenshots --json --concurrency 4

# Pull the text out of a receipt
npx offgrid-vision analyze receipt.jpg --json --mode ocr
```

Supported formats: PNG, JPEG, WebP, GIF (first frame), BMP, TIFF. Format is
detected from file contents, not the extension.

## Commands

### `analyze <path...>`

Analyze one or more images. Paths may be files or directories.

| Flag | Default | Description |
|---|---|---|
| `--json` | off | Emit JSON on stdout: an object for one file, an array for many |
| `--out <file>` | — | Write `{ results, summary }` JSON to a file |
| `--mode <preset>` | `general` | `general`, `ocr`, `alt-text`, or `ui` |
| `--prompt <text>` | — | Extra focus instruction; the schema is unchanged |
| `--model <name>` | `gemma3:12b` | Model to use |
| `--host <url>` | `http://localhost:11434` | Ollama host |
| `--timeout <ms>` | `120000` | Per-file deadline |
| `--concurrency <n>` | `1` | Files in flight at once, 1–4 |
| `--no-recursive` | off | Do not descend into subdirectories |

**Modes:**

- `general` — balanced description, objects, text, tags
- `ocr` — verbatim text extraction is the priority
- `alt-text` — one short accessibility sentence
- `ui` — screenshots: layout, controls, error and empty states

### `doctor`

Checks the Node version, Ollama reachability, and whether the model is pulled.
Prints exact remediation on failure. Exits 0 when healthy, 3 otherwise, so
scripts can gate on it.

```bash
npx offgrid-vision doctor && npx offgrid-vision analyze shot.png --json
```

### `install-skill` / `uninstall-skill`

Install the Agent Skill so a harness delegates image work to this CLI.

```bash
npx offgrid-vision install-skill --harness claude-code --scope project
npx offgrid-vision install-skill --harness claude-code --scope user
npx offgrid-vision install-skill --harness generic --dir ~/my-harness/skills
```

With no flags it detects an existing `.claude` directory — project-local first,
then your home directory — and installs there. Re-running updates in place.
`uninstall-skill` takes the same flags and removes exactly the directory the
installer created.

## Output schema

This schema is a public contract; changes to it are semver-major.

```json
{
  "file": "/abs/path/screenshots/error.png",
  "model": "gemma3:12b",
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
    "sha256": "9f2c…",
    "analyzed_at": "2026-07-21T10:15:00.000Z"
  },
  "error": null
}
```

A failed file uses the same envelope with `analysis: null` and a populated
`error`:

| Code | Meaning |
|---|---|
| `TIMEOUT` | Inference exceeded the per-file deadline |
| `PARSE_ERROR` | Model output was not valid JSON even after a repair attempt; the raw reply is in `analysis.raw` |
| `BACKEND_UNAVAILABLE` | Ollama unreachable, or the model is not installed |
| `UNSUPPORTED_FORMAT` | Not a supported image, judged by content |
| `IO_ERROR` | The file could not be read |

`--out` writes `{ "results": [...], "summary": { "total", "ok", "failed", "model", "duration_ms" } }`.

**Exit codes:** `0` success · `1` one or more files failed · `2` usage error · `3` backend unavailable.

## Using it from an agent

The installed skill teaches all of this, but the rules are short enough to state directly:

1. Run `doctor` once per session before the first analysis; surface its
   remediation to the user rather than silently falling back.
2. Always pass `--json` and read **stdout**. Progress goes to stderr; stdout is
   exclusively the payload.
3. Batch multiple images into one invocation rather than one call per image.
4. Check `error` on every element — a batch continues past individual failures.
5. If `analysis.parse_error` is true, the local model returned unstructured
   text; it is preserved in `analysis.raw`.

## Configuration

Flags beat environment variables, which beat defaults.

| Variable | Default |
|---|---|
| `OFFGRID_MODEL` | `gemma3:12b` |
| `OLLAMA_HOST` | `http://localhost:11434` |
| `OFFGRID_TIMEOUT` | `120000` |

## Privacy

No telemetry. The only network traffic is to the Ollama host you configure (and
to npm during `npx` bootstrap). If the host is not a loopback address, a warning
is printed to stderr, because at that point your images are leaving the machine.

## Development

```bash
npm install
npm test          # unit + integration, no live model needed
npm run typecheck
npm run build
```

Tests run against a mock Ollama HTTP server in `test/helpers/mock-ollama.ts`.

## License

MIT
````

- [ ] **Step 2: Run the full test suite and build**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: every test passes, no type errors, `dist/` populated. This is Acceptance Criterion 7.

- [ ] **Step 3: Verify Acceptance Criteria 3 and 6 without a live model**

```bash
node dist/cli.js doctor --host http://127.0.0.1:1; echo "exit=$?"
```
Expected: the Ollama check fails, remediation names `ollama.com/download`, `exit=3`.

```bash
printf 'not an image' > /tmp/offgrid-not-an-image.txt
node dist/cli.js analyze /tmp/offgrid-not-an-image.txt --json; echo "exit=$?"
```
Expected: with a healthy Ollama, structured JSON with `error.code` of `UNSUPPORTED_FORMAT` and `exit=1` — no stack trace. (Without Ollama running this exits 3 at preflight; start Ollama to check this criterion.)

- [ ] **Step 4: Verify Acceptance Criteria 1 and 2 against a live model**

Requires Ollama running with `gemma3:12b` pulled. Skip only if the model is genuinely unavailable, and say so rather than marking it passed.

```bash
node dist/cli.js doctor; echo "exit=$?"
mkdir -p /tmp/offgrid-e2e
# Put two or three real images in /tmp/offgrid-e2e, plus a non-image file.
node dist/cli.js analyze /tmp/offgrid-e2e --json | tee /tmp/offgrid-e2e-out.json | head -40
node -e "const r=require('/tmp/offgrid-e2e-out.json');console.log(Array.isArray(r), r.length, r.map(x=>x.error&&x.error.code))"
```

Expected: `doctor` exits 0; the payload is a JSON array with one entry per file;
image entries have `error: null` and a non-empty `analysis.description`; the
non-image entry has `error.code === 'UNSUPPORTED_FORMAT'`.

- [ ] **Step 5: Verify Acceptance Criteria 4 and 5 (skill round-trip)**

```bash
cd /tmp && mkdir -p offgrid-skill-test && cd offgrid-skill-test && mkdir -p .claude
node /Users/shreyas/Desktop/Code/offgrid-vision/dist/cli.js install-skill --harness claude-code --scope project
cat .claude/skills/offgrid-vision/SKILL.md | head -5
ls .claude/skills/offgrid-vision/references/
node /Users/shreyas/Desktop/Code/offgrid-vision/dist/cli.js uninstall-skill --harness claude-code --scope project
ls .claude/skills/ 2>/dev/null; echo "exit=$?"
```

Expected: `SKILL.md` exists with `name: offgrid-vision` in its frontmatter;
`references/schema.md` exists; after uninstall the `offgrid-vision` directory is gone.

Criterion 4's second half is manual: open a Claude Code session in a project with
the skill installed, drop in a screenshot, ask "what's in screenshot.png", and
confirm the session invokes `npx offgrid-vision`. Note the outcome — if the skill
does not trigger, the `description` frontmatter needs sharpening in
`src/skill/templates.ts`, not a code change elsewhere.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: add README covering commands, schema, and agent integration"
```

---

## Deferred to later versions

These are §11 stretch goals and must not be built as part of this plan: the
`serve` HTTP command, PDF rasterization, LM Studio / OpenAI-compatible backends,
response caching keyed on `sha256 + model + mode + prompt`, and skill installers
for additional harnesses. The `Backend` interface (Task 6) and the `sha256` in
every result's metadata (Task 7) exist so those land cleanly later.

## Self-Review

**Spec coverage.** Every functional requirement maps to a task: FR-1.1 → 3, 10 ·
FR-1.2 → 2, 7 · FR-1.3 → 4, 7 · FR-1.4 → 4, 7 · FR-1.5 → 9, 10 · FR-1.6 → 5, 10 ·
FR-1.7 → 5 · FR-1.8 → 10 · FR-1.9 → 6, 7 · FR-2.1–2.3 → 8 · FR-2.4 → 8, 10 ·
FR-3.1–3.4 → 12 · FR-3.5 → 12 · FR-3.6 → 12, 13 · FR-3.7 → 12 · FR-4.1 → 14 ·
FR-4.2 → 1 · FR-4.3 → 8, 10. NFR-1 → 6 (no outbound calls beyond the host) ·
NFR-2 → 1 defaults · NFR-3 → 10, 13 · NFR-4 → 7 (per-file buffers, never a
whole-batch read) · NFR-5 → every task · NFR-6 → 15. Acceptance criteria 1–7 are
executed in Task 15. No gaps.

**Type consistency.** `Analysis`, `AnalysisResult`, `FileMetadata`, `RunReport`
are defined once in Task 4 and imported unchanged thereafter. `Backend.chat`
keeps the same `(messages, opts)` signature in Tasks 6, 7, and 8. `CommandIO` is
defined in Task 8 and imported by Tasks 10, 13, and 14. `SkillTarget.dir` is the
skill directory itself in both Task 11 and Task 12, which is what makes the
uninstall basename guard correct.

**Known environment risk.** Task 10 Step 4 flags `parseArgs`'s `allowNegative`,
which requires Node 22.4+; this machine runs Node 24, but the fallback is
documented for anyone building on Node 20.

