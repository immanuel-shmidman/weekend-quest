/**
 * Generates the PWA / add-to-home-screen icons.
 *
 * Zero dependencies — writes valid PNGs by hand using core zlib, following the
 * tools/crossword-solver.mjs precedent of offline scripts with no npm install.
 * A PNG is just a signature plus length-tag-data-CRC chunks, and the pixel data
 * is deflate-compressed scanlines each prefixed with a filter byte.
 *
 *   node tools/make-icons.mjs
 *
 * The art is the Fantastic Four mark — a blue disc with a white 4 — because
 * the group is המופלאים and it is a running joke. It also happens to match the
 * 4x4 bingo board, which is a nicer coincidence than it deserves to be.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BG = [0x1a, 0x11, 0x30]; // app background, so the icon sits on-brand
const BLUE = [0x1d, 0x5f, 0xc4]; // Fantastic Four blue
const BLUE_DK = [0x12, 0x3f, 0x8a];
const WHITE = [0xf5, 0xf3, 0xff];

/** Supersampled coverage: 3x3 samples per pixel, so edges are not jagged. */
const SS = 3;

function iconPixels(size) {
  const px = Buffer.alloc(size * size * 3);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.44;
  const rInner = size * 0.375;

  // Geometry of the numeral 4, in units of the icon size.
  const strokeW = size * 0.085;
  const top = size * 0.27;
  const bottom = size * 0.735;
  const apexX = size * 0.605; // top of the diagonal
  const baseX = size * 0.335; // where the diagonal meets the crossbar
  const stemX = size * 0.575; // the vertical stroke
  const barY = size * 0.585; // the horizontal crossbar
  const barRight = size * 0.70;

  const inFour = (x, y) => {
    // Vertical stem.
    if (x >= stemX && x <= stemX + strokeW && y >= top && y <= bottom) return true;
    // Horizontal crossbar.
    if (y >= barY && y <= barY + strokeW && x >= baseX && x <= barRight) return true;
    // Diagonal, as distance to the segment (apexX, top) -> (baseX, barY + strokeW).
    return distToSegment(x, y, apexX, top, baseX, barY + strokeW) <= strokeW / 2;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let disc = 0;
      let ring = 0;
      let four = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px_ = x + (sx + 0.5) / SS;
          const py_ = y + (sy + 0.5) / SS;
          const d = Math.hypot(px_ - cx, py_ - cy);
          if (d <= rOuter) ring++;
          if (d <= rInner) disc++;
          if (d <= rInner && inFour(px_, py_)) four++;
        }
      }
      const n = SS * SS;
      // Composite back to front: background, outer ring, inner disc, numeral.
      let color = BG;
      color = mix(color, BLUE_DK, ring / n);
      color = mix(color, BLUE, disc / n);
      color = mix(color, WHITE, four / n);
      const i = (y * size + x) * 3;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
    }
  }
  return px;
}

function mix(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte (0 = None).
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const src = y * size * 3;
    const dst = y * (size * 3 + 1);
    raw[dst] = 0;
    rgb.copy(raw, dst + 1, src, src + size * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, iconPixels(size)));
  console.log(`wrote ${file}`);
}
