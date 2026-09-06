/**
 * fold(events) -> World.
 *
 * The whole app is a pure function of the event log. Nothing is stored
 * derived; every screen reads from here. That means scores self-heal, a
 * refresh is free, and a player who joins on Sunday sees exactly the same world
 * as everyone else.
 *
 * One rule to hold on to while reading this: everything must render sensibly
 * for someone who MISSED a phase. Someone who never submitted a trio still
 * gets to guess; someone who joins after the bingo freeze still gets a board.
 * Both fall out for free, as long as we never write "if not submitted, block".
 */

import type { Ev } from "./sync";
import { POINTS } from "./config";
import { bingoSide, getRoom } from "./room";
import { strings } from "./i18n";

const S = strings({
  he: { guest: "אורח", someone: "מישהו" },
  en: { guest: "Guest", someone: "someone" },
});
import { buildBoard, completedLines } from "./lib/bingo";

export interface Player {
  id: string;
  name: string;
  firstSeen: number;
}

export interface Proposal {
  id: string; // the propose event's own id — free, unique, stable
  text: string;
  by: string;
}

export interface Mark {
  by: string;
  ts: number;
}

export interface Trio {
  statements: [string, string, string];
  lie: number;
}

export interface Superlative {
  id: string; // the s.ask event id
  text: string;
  by: string;
}

export interface WallPost {
  id: string; // the w.post event id
  text: string;
  said: string; // who said it (free text — may not be a player)
  by: string; // who logged it
  ts: number;
}

export type BingoPhase = "propose" | "play";
export type TruthsPhase = "submit" | "guess" | "reveal";

export interface World {
  players: Map<string, Player>;
  order: string[]; // player ids, join order — stable for rendering

  bingoPhase: BingoPhase;
  truthsPhase: TruthsPhase;

  /** Set by the freeze event. Boards depend on BOTH of these, never on the live pool. */
  freeze: { id: number; poolIds: string[]; side: number | null } | null;
  proposals: Proposal[];
  marks: Map<string, Mark>;
  /** playerId -> event id of their first BINGO. Lowest id wins. */
  bingos: Map<string, number>;

  trios: Map<string, Trio>;
  /** guesser -> (target -> index guessed) */
  guesses: Map<string, Map<string, number>>;

  /** playerId -> (qid -> points) */
  quiz: Map<string, Map<string, number>>;

  superlatives: Superlative[];
  /** superlative id -> (voter -> target) */
  votes: Map<string, Map<string, string>>;

  wall: WallPost[];
  /** post id -> (reactor -> emoji) */
  reactions: Map<string, Map<string, string>>;

  scores: Map<string, number>;
}

function ensurePlayer(w: World, id: string, ts: number): Player {
  let p = w.players.get(id);
  if (!p) {
    p = { id, name: S.guest, firstSeen: ts };
    w.players.set(id, p);
    w.order.push(id);
  }
  return p;
}

export function fold(events: Ev[]): World {
  const w: World = {
    players: new Map(),
    order: [],
    bingoPhase: "propose",
    truthsPhase: "submit",
    freeze: null,
    proposals: [],
    marks: new Map(),
    bingos: new Map(),
    trios: new Map(),
    guesses: new Map(),
    quiz: new Map(),
    superlatives: [],
    votes: new Map(),
    wall: [],
    reactions: new Map(),
    scores: new Map(),
  };

  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.kind) {
      case "join": {
        // Re-posted whenever someone renames, so last-write-wins gives
        // rename-for-free.
        const player = ensurePlayer(w, e.player, e.ts);
        if (typeof p.name === "string" && p.name.trim()) {
          player.name = p.name.trim().slice(0, 20);
        }
        break;
      }

      case "rename": {
        // Host fixes a typo. Server-gated on the host code. Ordinary
        // last-write-wins with the player's own `join`, and the player's phone
        // adopts the folded name (main.ts), so a re-announce carries the fix.
        const target = String(p.target ?? "");
        if (!target || typeof p.name !== "string" || !p.name.trim()) break;
        ensurePlayer(w, target, e.ts).name = p.name.trim().slice(0, 20);
        break;
      }

      case "phase": {
        if (p.activity === "bingo") {
          if (p.phase === "propose" || p.phase === "play") w.bingoPhase = p.phase;
          // The freeze carries an explicit ordered pool. Without this, adding a
          // proposal would silently reshuffle all 14 boards and every mark would
          // appear to move to a different cell.
          if (p.phase === "play" && Array.isArray(p.poolIds)) {
            // v2 freezes also carry the grid side, so a later config edit can
            // never resize boards under people mid-game. Older freezes lack
            // it and fall back to the room's current setting (sideOf).
            const side = Number(p.side);
            w.freeze = {
              id: e.id,
              poolIds: p.poolIds.map(String),
              side: Number.isInteger(side) && side >= 3 && side <= 5 ? side : null,
            };
          }
          if (p.phase === "propose") w.freeze = null;
        } else if (p.activity === "truths") {
          if (p.phase === "submit" || p.phase === "guess" || p.phase === "reveal") {
            w.truthsPhase = p.phase;
          }
        }
        break;
      }

      case "b.propose": {
        ensurePlayer(w, e.player, e.ts);
        const text = String(p.text ?? "").trim();
        if (text) w.proposals.push({ id: String(e.id), text, by: e.player });
        break;
      }

      case "b.mark": {
        ensurePlayer(w, e.player, e.ts);
        const square = String(p.square ?? "");
        if (!square) break;
        if (p.on === false) w.marks.delete(square);
        else w.marks.set(square, { by: e.player, ts: e.ts });
        break;
      }

      case "b.bingo": {
        ensurePlayer(w, e.player, e.ts);
        // Lowest event id wins; server-assigned ids resolve ties for free.
        if (!w.bingos.has(e.player)) w.bingos.set(e.player, e.id);
        break;
      }

      case "t.submit": {
        ensurePlayer(w, e.player, e.ts);
        const s = p.statements;
        if (Array.isArray(s) && s.length === 3 && typeof p.lie === "number") {
          w.trios.set(e.player, {
            statements: [String(s[0]), String(s[1]), String(s[2])],
            lie: Math.min(2, Math.max(0, Math.round(p.lie))),
          });
        }
        break;
      }

      case "t.guess": {
        ensurePlayer(w, e.player, e.ts);
        const target = String(p.target ?? "");
        const index = Math.round(Number(p.index));
        if (!target || !Number.isFinite(index)) break;
        let mine = w.guesses.get(e.player);
        if (!mine) w.guesses.set(e.player, (mine = new Map()));
        mine.set(target, index); // last guess wins
        break;
      }

      case "s.ask": {
        ensurePlayer(w, e.player, e.ts);
        const text = String(p.text ?? "").trim();
        if (text) w.superlatives.push({ id: String(e.id), text, by: e.player });
        break;
      }

      case "s.vote": {
        ensurePlayer(w, e.player, e.ts);
        const ask = String(p.ask ?? "");
        const target = String(p.target ?? "");
        if (!ask) break;
        let forAsk = w.votes.get(ask);
        if (!forAsk) w.votes.set(ask, (forAsk = new Map()));
        // An empty target retracts the vote, which is how "change my vote"
        // gets you back to the candidate list.
        if (!target) forAsk.delete(e.player);
        else forAsk.set(e.player, target); // one vote each, last wins
        break;
      }

      case "w.post": {
        ensurePlayer(w, e.player, e.ts);
        const text = String(p.text ?? "").trim();
        if (text) {
          w.wall.push({
            id: String(e.id),
            text,
            said: String(p.said ?? "").trim(),
            by: e.player,
            ts: e.ts,
          });
        }
        break;
      }

      case "w.react": {
        ensurePlayer(w, e.player, e.ts);
        const post = String(p.post ?? "");
        const emoji = String(p.emoji ?? "");
        if (!post) break;
        let forPost = w.reactions.get(post);
        if (!forPost) w.reactions.set(post, (forPost = new Map()));
        // Re-reacting with the same emoji removes it; a different one replaces.
        if (!emoji || forPost.get(e.player) === emoji) forPost.delete(e.player);
        else forPost.set(e.player, emoji);
        break;
      }

      case "q.answer": {
        ensurePlayer(w, e.player, e.ts);
        const qid = String(p.qid ?? "");
        const points = Math.round(Number(p.points));
        if (!qid || !Number.isFinite(points)) break;
        let mine = w.quiz.get(e.player);
        if (!mine) w.quiz.set(e.player, (mine = new Map()));
        // First answer stands — no retrying a question for a better score.
        if (!mine.has(qid)) mine.set(qid, Math.min(POINTS.quizChoice, Math.max(0, points)));
        break;
      }
    }
  }

  computeScores(w);
  return w;
}

/**
 * The unified weekend score. A pure function of the world, recomputed on every
 * fold — there is no score table to drift out of sync.
 */
function computeScores(w: World): void {
  for (const id of w.players.keys()) w.scores.set(id, 0);

  const add = (id: string, n: number) => {
    if (!w.players.has(id)) return;
    w.scores.set(id, (w.scores.get(id) ?? 0) + n);
  };

  // Quiz: whatever each answer earned.
  for (const [id, answers] of w.quiz) {
    for (const points of answers.values()) add(id, points);
  }

  // Bingo: credit for calling a square, plus a bonus for completing a line.
  for (const mark of w.marks.values()) add(mark.by, POINTS.bingoDeclare);
  if (w.freeze) {
    const marked = new Set(w.marks.keys());
    for (const id of w.players.keys()) {
      const board = boardFor(w, id);
      if (!board) continue;
      const lines = completedLines(board, marked, sideOf(w));
      add(id, lines.length * POINTS.bingoLine);
    }
  }

  // Two truths: a point for spotting a lie, and a point per person you fooled.
  if (w.truthsPhase === "reveal") {
    for (const [guesser, picks] of w.guesses) {
      for (const [target, index] of picks) {
        const trio = w.trios.get(target);
        if (!trio || target === guesser) continue;
        if (index === trio.lie) add(guesser, POINTS.truthsCorrectGuess);
        else add(target, POINTS.truthsFooledEach);
      }
    }
  }
}

/** Grid side for this world's boards: what the freeze recorded, else the room setting. */
export function sideOf(w: World): number {
  return w.freeze?.side ?? bingoSide();
}

/** Deterministic board for a player, or null before the pool is frozen. */
export function boardFor(w: World, playerId: string): string[] | null {
  if (!w.freeze) return null;
  const side = sideOf(w);
  return buildBoardCached(playerId, w.freeze.id, w.freeze.poolIds, side * side);
}

// Boards are pure but not free (a shuffle per player); memoise per fold input.
const boardCache = new Map<string, string[]>();
function buildBoardCached(playerId: string, freezeId: number, poolIds: string[], cells: number): string[] {
  const key = `${playerId}:${freezeId}:${poolIds.length}:${cells}`;
  let board = boardCache.get(key);
  if (!board) {
    board = buildBoard(playerId, freezeId, poolIds, cells);
    boardCache.set(key, board);
  }
  return board;
}

export function proposalById(w: World, id: string): Proposal | undefined {
  return w.proposals.find((p) => p.id === id);
}

export function nameOf(w: World, id: string): string {
  if (id.startsWith(PARTICIPANT_PREFIX)) return id.slice(PARTICIPANT_PREFIX.length);
  return w.players.get(id)?.name ?? S.someone;
}

/**
 * Ids for people who are in the event's participant list but have not signed
 * in (children, someone who could not come). They can be voted for in "who is
 * most likely…" but never have a board, a score or a row in the standings.
 * Encoded as the name itself, so a vote survives even if the list changes.
 */
const PARTICIPANT_PREFIX = "p:";

export interface Person {
  id: string;
  name: string;
  /** true for a signed-in player, false for a listed-only participant. */
  player: boolean;
}

/**
 * Everyone who can be the answer to "who is most likely…": signed-in players
 * first (join order), then listed participants whose name does not match a
 * player's. Matching is by trimmed, case-folded name — the wizard has no
 * other handle on a person than what the host typed.
 */
export function voteTargets(w: World): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const p of w.players.values()) {
    out.push({ id: p.id, name: p.name, player: true });
    seen.add(p.name.trim().toLowerCase());
  }
  for (const p of getRoom().config.participants ?? []) {
    const key = p.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: PARTICIPANT_PREFIX + p.name.trim(), name: p.name.trim(), player: false });
  }
  return out;
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  rank: number;
}

/** Standings, best first, with ties sharing a rank. */
export function standings(w: World): Standing[] {
  const rows = [...w.players.values()]
    .map((p) => ({ id: p.id, name: p.name, score: w.scores.get(p.id) ?? 0, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "he"));

  let lastScore = Number.NaN;
  let lastRank = 0;
  rows.forEach((row, i) => {
    if (row.score !== lastScore) {
      lastRank = i + 1;
      lastScore = row.score;
    }
    row.rank = lastRank;
  });
  return rows;
}
