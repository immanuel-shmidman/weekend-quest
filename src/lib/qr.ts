/**
 * QR code encoder — ISO/IEC 18004, byte mode (UTF-8), versions 1–40, all four
 * error-correction levels, all eight masks scored by the standard penalties.
 *
 * Exists so one phone can show the room's share link as something another
 * phone's camera can read. The pipeline is the standard one (and the same
 * shape as the well-known Nayuki generator): text → bit stream → data
 * codewords → Reed–Solomon blocks, interleaved → placed in the matrix around
 * the fixed function patterns → masked → format/version bits written last.
 *
 * Zero dependencies. Coordinates are `modules[y][x]`, `true` = dark.
 */

export type Ecl = "L" | "M" | "Q" | "H";

export interface QrOptions {
  /** Rendered width/height in CSS px. Omitted → the SVG scales to its box. */
  size?: number;
  /** Quiet zone in modules. The standard asks for 4; cameras want it. */
  margin?: number;
  dark?: string;
  light?: string;
  ecl?: Ecl;
}

const MAX_VERSION = 40;

/* ------------------------------------------------------------------ tables */

/** Row into the per-level tables below, and the two bits sent in format info. */
const ECL_INDEX: Record<Ecl, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECL_FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** Error-correction codewords per block, [level][version]. Index 0 unused. */
const ECC_PER_BLOCK: number[][] = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

/** Number of Reed–Solomon blocks, [level][version]. Index 0 unused. */
const NUM_BLOCKS: number[][] = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Mask penalty weights, ISO 18004 §7.8.3.1. */
const N1 = 3, N2 = 3, N3 = 40, N4 = 10;

/* ---------------------------------------------------------------- capacity */

/** Modules left for data + ECC after every function pattern is drawn. */
function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55; // alignment patterns, minus timing overlap
    if (ver >= 7) n -= 36; // two copies of version information
  }
  return n;
}

function numDataCodewords(ver: number, ecl: Ecl): number {
  const e = ECL_INDEX[ecl];
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
}

/** Byte-mode character-count field width. */
const charCountBits = (ver: number): number => (ver <= 9 ? 8 : 16);

/* ------------------------------------------------------- reed–solomon GF(256) */

/** Multiply in GF(2^8) with the QR reduction polynomial x^8+x^4+x^3+x^2+1. */
function gfMul(a: number, b: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d); // shift, reduce if bit 8 came on
    z ^= ((b >>> i) & 1) * a;
  }
  return z;
}

/**
 * Generator polynomial ∏(x − α^i), i = 0..degree−1, as its `degree` lower
 * coefficients (the leading x^degree coefficient is 1 and left implicit).
 */
function rsGenerator(degree: number): number[] {
  const g = new Array<number>(degree).fill(0);
  g[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      g[j] = gfMul(g[j], root);
      if (j + 1 < degree) g[j] ^= g[j + 1];
    }
    root = gfMul(root, 2);
  }
  return g;
}

/** Polynomial remainder of `data · x^degree` by the generator — the ECC bytes. */
function rsRemainder(data: number[], gen: number[]): number[] {
  const r = new Array<number>(gen.length).fill(0);
  for (const b of data) {
    const factor = b ^ (r.shift() as number);
    r.push(0);
    for (let i = 0; i < gen.length; i++) r[i] ^= gfMul(gen[i], factor);
  }
  return r;
}

/* ------------------------------------------------------------ bit stream */

/** Data codewords: mode, count, bytes, terminator, then the 0xEC/0x11 pad. */
function encodeData(bytes: Uint8Array, ver: number, ecl: Ecl): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, charCountBits(ver));
  for (const b of bytes) push(b, 8);

  const capacity = numDataCodewords(ver, ecl) * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminator, truncated if full
  push(0, (8 - (bits.length % 8)) % 8); // to a byte boundary
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  return out;
}

/** Split into RS blocks, append ECC to each, then interleave column-wise. */
function addEccAndInterleave(data: number[], ver: number, ecl: Ecl): number[] {
  const e = ECL_INDEX[ecl];
  const blocks = NUM_BLOCKS[e][ver];
  const eccLen = ECC_PER_BLOCK[e][ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = blocks - (rawCodewords % blocks);
  const shortLen = Math.floor(rawCodewords / blocks);
  const gen = rsGenerator(eccLen);

  // Long blocks carry one more data byte; short ones get a placeholder so
  // every block has the same length and interleaving can skip that slot.
  const rows: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, gen);
    if (i < shortBlocks) dat.push(0);
    rows.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < rows[0].length; i++) {
    for (let j = 0; j < rows.length; j++) {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(rows[j][i]);
    }
  }
  return out;
}

/* ------------------------------------------------------------- the matrix */

interface Matrix {
  size: number;
  modules: boolean[][];
  /** Function-pattern cells: never masked, never hold data. */
  isFunction: boolean[][];
}

function setFn(m: Matrix, x: number, y: number, dark: boolean): void {
  m.modules[y][x] = dark;
  m.isFunction[y][x] = true;
}

/** Concentric square rings around (cx, cy): rings in `light` are light, the rest dark. */
function stampRings(m: Matrix, cx: number, cy: number, radius: number, light: number[]): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < m.size && y < m.size) {
        setFn(m, x, y, !light.includes(Math.max(Math.abs(dx), Math.abs(dy))));
      }
    }
  }
}

/** Centre coordinates of alignment patterns, used along both axes. */
function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((size - 13) / (count * 2 - 2)) * 2;
  const pos = [6];
  for (let p = size - 7; pos.length < count; p -= step) pos.splice(1, 0, p);
  return pos;
}

/** Finder, separators, timing, alignment, plus the reserved format/version cells. */
function drawFunctionPatterns(m: Matrix, ver: number): void {
  const n = m.size;
  for (let i = 0; i < n; i++) {
    setFn(m, 6, i, i % 2 === 0); // timing patterns
    setFn(m, i, 6, i % 2 === 0);
  }
  // Finder patterns (rings 2 and 4 light — ring 4 is the separator, clipped at the edge).
  stampRings(m, 3, 3, 4, [2, 4]);
  stampRings(m, n - 4, 3, 4, [2, 4]);
  stampRings(m, 3, n - 4, 4, [2, 4]);
  // Alignment patterns (ring 1 light) everywhere except the three finder corners.
  const pos = alignmentPositions(ver);
  const last = pos.length - 1;
  pos.forEach((cx, i) => {
    pos.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      stampRings(m, cx, cy, 2, [1]);
    });
  });
  drawFormatBits(m, "M", 0); // reserve; real values are written after masking
  drawVersion(m, ver);
}

/** 15 format bits: 2 ECL + 3 mask, BCH(15,5) protected, XOR-masked. Two copies. */
function drawFormatBits(m: Matrix, ecl: Ecl, mask: number): void {
  const data = (ECL_FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const n = m.size;
  // Copy 1: around the top-left finder.
  for (let i = 0; i <= 5; i++) setFn(m, 8, i, bit(i));
  setFn(m, 8, 7, bit(6));
  setFn(m, 8, 8, bit(7));
  setFn(m, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFn(m, 14 - i, 8, bit(i));
  // Copy 2: below the top-right finder and beside the bottom-left one.
  for (let i = 0; i < 8; i++) setFn(m, n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFn(m, 8, n - 15 + i, bit(i));
  setFn(m, 8, n - 8, true); // the always-dark module
}

/** 18 version bits (BCH(18,6)), versions 7 and up only. Two copies. */
function drawVersion(m: Matrix, ver: number): void {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = m.size - 11 + (i % 3), b = Math.floor(i / 3);
    setFn(m, a, b, dark);
    setFn(m, b, a, dark);
  }
}

/** Zig-zag placement: two-column strips, alternating up and down, skipping column 6. */
function drawCodewords(m: Matrix, data: number[]): void {
  const n = m.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < n; v++) {
      const y = upward ? n - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (!m.isFunction[y][x] && i < data.length * 8) {
          m.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

/** The eight mask conditions (Table 10); a true result flips the module. */
const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** XOR a mask over the data region. Applying it twice undoes it. */
function applyMask(m: Matrix, mask: number): void {
  const test = MASKS[mask];
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.isFunction[y][x] && test(x, y)) m.modules[y][x] = !m.modules[y][x];
    }
  }
}

/** Rules 1 and 3 along one row or column. Beyond the edge counts as light. */
function linePenalty(line: boolean[]): number {
  const n = line.length;
  let score = 0;
  let run = 1;
  for (let i = 1; i <= n; i++) {
    if (i < n && line[i] === line[i - 1]) run++;
    else {
      if (run >= 5) score += N1 + run - 5; // rule 1: runs of five or more
      run = 1;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 with four light modules on either side.
  const at = (i: number) => i >= 0 && i < n && line[i];
  for (let s = 0; s + 7 <= n; s++) {
    if (!(at(s) && !at(s + 1) && at(s + 2) && at(s + 3) && at(s + 4) && !at(s + 5) && at(s + 6))) continue;
    if (!at(s - 1) && !at(s - 2) && !at(s - 3) && !at(s - 4)) score += N3;
    if (!at(s + 7) && !at(s + 8) && !at(s + 9) && !at(s + 10)) score += N3;
  }
  return score;
}

/** Total penalty for the current (masked) matrix; lower reads better. */
function penalty(m: Matrix): number {
  const n = m.size, g = m.modules;
  let score = 0;
  const col: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    score += linePenalty(g[i]);
    for (let y = 0; y < n; y++) col[y] = g[y][i];
    score += linePenalty(col);
  }
  let dark = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (g[y][x]) dark++;
      if (y + 1 < n && x + 1 < n && g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) {
        score += N2; // rule 2: 2x2 blocks of one colour
      }
    }
  }
  // Rule 4: deviation of the dark proportion from 50%, in 5% steps.
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * N4;
  return score;
}

/* ------------------------------------------------------------ public API */

/** Encode `text` and return the module matrix, `true` = dark. */
export function qrModules(text: string, ecl: Ecl = "M"): boolean[][] {
  const bytes = new TextEncoder().encode(text);

  // 1. Smallest version whose data capacity holds the segment.
  let ver = 1;
  for (;; ver++) {
    if (ver > MAX_VERSION) throw new Error("qr: text too long");
    const needed = 4 + charCountBits(ver) + bytes.length * 8;
    if (needed <= numDataCodewords(ver, ecl) * 8) break;
  }

  // 2. Data codewords, then ECC and interleaving.
  const codewords = addEccAndInterleave(encodeData(bytes, ver, ecl), ver, ecl);

  // 3. Fixed patterns, then data placed in the gaps.
  const size = ver * 4 + 17;
  const m: Matrix = {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    isFunction: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
  drawFunctionPatterns(m, ver);
  drawCodewords(m, codewords);

  // 4. Try every mask (each with its own format bits), keep the lowest penalty.
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(m, mask);
    drawFormatBits(m, ecl, mask);
    const score = penalty(m);
    if (score < bestScore) { best = mask; bestScore = score; }
    applyMask(m, mask); // undo
  }
  applyMask(m, best);
  drawFormatBits(m, ecl, best);
  return m.modules;
}

/** An SVG string: viewBox in modules, one path for the dark cells, quiet zone included. */
export function qrSvg(text: string, opts: QrOptions = {}): string {
  const modules = qrModules(text, opts.ecl);
  const margin = opts.margin ?? 4;
  const n = modules.length;
  const total = n + margin * 2;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules[y][x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }
  const dims = opts.size !== undefined ? ` width="${opts.size}" height="${opts.size}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"${dims} shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${opts.light ?? "#fff"}"/>` +
    `<path d="${d}" fill="${opts.dark ?? "#000"}"/></svg>`
  );
}

/** The SVG wrapped in a labelled `div`, ready to append. */
export function qrElement(text: string, opts: QrOptions = {}): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", text);
  el.innerHTML = qrSvg(text, opts); // our own markup, nothing user-supplied reaches it
  return el;
}
