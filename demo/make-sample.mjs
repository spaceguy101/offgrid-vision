// One-shot generator for demo/screenshot.png — a valid 480x300 RGB PNG.
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

writeFileSync(new URL('./screenshot.png', import.meta.url), png);
console.log(`wrote screenshot.png (${png.length} bytes)`);
