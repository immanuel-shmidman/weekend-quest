/**
 * Bingo board generation and line detection.
 *
 * The grid side is a per-event setting (3x3 to 5x5, see room.ts), so every
 * function here takes it as an argument rather than reading a constant. There is
 * never a free space: a 4x4 grid has no centre cell, and for 3x3 and 5x5 the
 * middle square is just another square — one rule for all three sizes.
 */

import { shuffled } from "./rng";

/**
 * A player's board: an ordered list of square ids.
 *
 * `freezeId` is a REQUIRED argument rather than something read from global
 * state, and that is deliberate. Seeding only on playerId would mean every new
 * proposal reshuffled all 14 boards — marks would appear to teleport between
 * cells, and it is nearly invisible when testing with one phone. Taking the
 * freeze id explicitly makes the dependency impossible to forget.
 */
export function buildBoard(
  playerId: string,
  freezeId: number,
  poolIds: readonly string[],
  cells: number
): string[] {
  return shuffled(poolIds, `${playerId}:${freezeId}`).slice(0, cells);
}

const linesCache = new Map<number, readonly (readonly number[])[]>();

/** Every winning line for an n x n grid, as arrays of board indices: n rows, n columns, 2 diagonals. */
export function linesFor(n: number): readonly (readonly number[])[] {
  let lines = linesCache.get(n);
  if (lines) return lines;
  const out: number[][] = [];
  for (let r = 0; r < n; r++) {
    out.push(Array.from({ length: n }, (_, c) => r * n + c));
  }
  for (let c = 0; c < n; c++) {
    out.push(Array.from({ length: n }, (_, r) => r * n + c));
  }
  out.push(Array.from({ length: n }, (_, i) => i * n + i));
  out.push(Array.from({ length: n }, (_, i) => i * n + (n - 1 - i)));
  lines = out;
  linesCache.set(n, lines);
  return lines;
}

/** Indices into linesFor(side) that this board has completed. */
export function completedLines(
  board: readonly string[],
  marked: ReadonlySet<string>,
  side: number
): number[] {
  const out: number[] = [];
  linesFor(side).forEach((line, i) => {
    if (line.every((idx) => board[idx] !== undefined && marked.has(board[idx]))) {
      out.push(i);
    }
  });
  return out;
}

/** Board cells that sit on at least one completed line — used for the gold outline. */
export function cellsOnCompletedLines(
  board: readonly string[],
  marked: ReadonlySet<string>,
  side: number
): Set<number> {
  const cells = new Set<number>();
  const lines = linesFor(side);
  for (const i of completedLines(board, marked, side)) {
    for (const idx of lines[i]) cells.add(idx);
  }
  return cells;
}

/**
 * Near-duplicate detection for the propose stage: people independently suggest
 * the same joke, and 28 proposals with six duplicates makes a poor pool.
 * Cheap normalised-token overlap — no library, no cleverness needed at this size.
 */
export function similarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[֑-ׇ]/g, "") // Hebrew niqqud/cantillation
      .replace(/["'`.,!?;:()\-–—]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}
