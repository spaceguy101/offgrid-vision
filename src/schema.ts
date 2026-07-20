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
