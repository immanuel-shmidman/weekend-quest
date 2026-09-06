/**
 * Quiz types and scoring.
 *
 * Questions are generated from a WhatsApp export by src/lib/chat (in the
 * browser, at setup) and/or written by the host, and stored in the event's
 * `quiz` column. The statistics blocks are optional: a quiz made only of the
 * host's own questions has none of them.
 */

export interface ChoiceQuestion {
  id: string;
  type: "choice";
  statId?: string;
  q: string;
  answer: string;
  wrong: string[];
  reveal: string;
  /** Optional verbatim message, rendered as a quote block under the reveal. */
  quote?: string;
  points: number;
}

export interface NumberQuestion {
  id: string;
  type: "number";
  statId?: string;
  q: string;
  min: number;
  max: number;
  step: number;
  answer: number;
  falloff: number;
  reveal: string;
  points: number;
}

export type Question = ChoiceQuestion | NumberQuestion;

export interface ChatSource {
  messages: number;
  firstMessage: string;
  lastMessage: string;
  spanDays: number;
  activeDays: number;
  silentDays: number;
}

export interface WordComparison {
  totalWords: number;
  torahMultiple: number;
  nearest: { he: string; en?: string; words: number; ratio: number };
  beats: { he: string; en?: string; ratio: number }[];
  shortOf: { he: string; en?: string; ratio: number }[];
}

export interface ChatStats {
  schemaVersion: number;
  generatedAt: string;
  /** Absent for a quiz made only of the host's own questions. */
  source?: ChatSource;
  people?: { id: string; name: string; messages: number }[];
  group?: Record<string, unknown> & {
    totalWords: number;
    totalEmoji: number;
    topEmoji: { emoji: string; n: number }[];
  };
  wordComparison?: WordComparison;
  questions: Question[];
}

/** A quiz with chat statistics behind it — the facts panel needs all three blocks. */
export function hasChatStats(d: ChatStats | null | undefined): d is ChatStats & Required<Pick<ChatStats, "source" | "group" | "wordComparison">> {
  return !!d && !!d.source && !!d.group && !!d.wordComparison;
}

/**
 * Points for a numeric guess.
 *
 * Relative falloff, not the fixed one birthday-quest's Level06HowMany used —
 * its answers were small and known, while these span three orders of magnitude
 * (30 days of silence vs 537,821 words). The generator sets falloff to ~70% of
 * the answer, so being in the right ballpark scores well and clairvoyance is
 * not required.
 */
export function scoreNumber(q: NumberQuestion, guess: number): number {
  const off = Math.abs(guess - q.answer);
  return Math.round(q.points * Math.max(0, 1 - off / q.falloff));
}

export function scoreChoice(q: ChoiceQuestion, picked: string): number {
  return picked === q.answer ? q.points : 0;
}

/** Options in a stable-but-shuffled order, seeded by the question id. */
export function optionsFor(q: ChoiceQuestion): string[] {
  const all = [q.answer, ...q.wrong];
  let h = 2166136261;
  for (let i = 0; i < q.id.length; i++) {
    h ^= q.id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = all.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
