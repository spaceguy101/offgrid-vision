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
