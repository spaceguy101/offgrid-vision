import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

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
  // at offsets 18/22. The OS/2 BITMAPCOREHEADER (12) uses a different layout.
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
