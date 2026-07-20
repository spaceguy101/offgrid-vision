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
