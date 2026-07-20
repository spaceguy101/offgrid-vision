import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { sniffFormat, readDimensions, SUPPORTED_EXTENSIONS } from '../src/media.js';
import {
  pngFixture, jpegFixture, gifFixture, bmpFixture, bmpOs2Fixture,
  webpVp8Fixture, webpVp8xFixture, webpVp8lFixture, tiffFixture, textFixture,
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

  it('reads lossless WebP (VP8L) dimensions from the packed bitstream', () => {
    expect(readDimensions(webpVp8lFixture(6000, 1337), 'webp')).toEqual({ width: 6000, height: 1337 });
  });

  it('returns null for a legacy OS/2 BMP (BITMAPCOREHEADER) instead of misreading it', () => {
    expect(readDimensions(bmpOs2Fixture(320, 200), 'bmp')).toBeNull();
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
