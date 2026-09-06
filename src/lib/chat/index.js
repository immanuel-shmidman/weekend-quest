/**
 * WhatsApp chat analyzer — the environment-free library.
 *
 *   text  --parseChat-->  Parsed  --suggestRoster / a human-->  roster
 *   (Parsed, roster)  --analyzeParsed-->  { stats: ChatStats, report, ... }
 *
 * Runs unchanged in Node (tools/chat-analyze.mjs) and in the browser (the
 * setup wizard). Nothing here does IO; bytes come in through zip.js with an
 * injected inflate, and the caller decides what to do with the result.
 *
 * PRIVACY: the output is counts, names and dates. Message text is included
 * ONLY when `excerpts: true` is passed — the opening words of the longest
 * message, and the funniest turn as a quote — and the caller must make that an
 * explicit choice by the host.
 */

import { parseChat } from "./parse.js";
import { generateQuestions } from "./questions.js";
import { buildReport } from "./report.js";
import { aliasSuggestions, resolveRoster, suggestRoster, unknownAuthors } from "./roster.js";
import { computeStats } from "./stats.js";
import { firstWords } from "./text.js";

export { parseChat, parseProblems, splitEntries, detectFormat, PLACEHOLDERS } from "./parse.js";
export { decodeExport, readExportZip, isZip } from "./zip.js";
export {
  suggestRoster,
  aliasSuggestions,
  resolveRoster,
  rosterProblems,
  unknownAuthors,
  idResolver,
  namesById,
} from "./roster.js";
export {
  computeStats,
  buildTimeline,
  scoreTurns,
  rankLongest,
  fandomMentions,
  nameMentions,
  laughSignal,
  FANDOMS,
  AMBIGUOUS_NAMES,
  MENTION_EXCLUDE,
} from "./stats.js";
export { generateQuestions } from "./questions.js";
export { buildReport, formatReport } from "./report.js";
export { STRINGS, stringsFor } from "./strings.js";
export { WORKS, compareToWorks } from "./works.js";
export { firstWords, formatDay, countWords, emojiOf, BIDI_RE } from "./text.js";

export const SCHEMA_VERSION = 1;

/**
 * @typedef {object} AnalyzeOptions
 * @property {"he" | "en"} [lang]                 language of every emitted string. Default "he".
 * @property {import("./roster.js").RosterPerson[]} [roster]  decided roster. Default: every display name is its own included person.
 * @property {boolean} [excerpts]                 include message text (see file header). Default false.
 * @property {number} [longestRank]               1-based rank in the longest-message list to call "the" longest. Default 1.
 * @property {number} [funniestRank]              1-based rank in the funniest list. Default 1.
 * @property {Record<string, string | { he: string, en: string }>} [dayNotes]  context for specific YYYY-MM-DD dates, appended to reveals.
 * @property {number} [expectPeople]              assert the roster resolves to this many people. Default 0 (no assertion).
 * @property {Date} [now]                         for `generatedAt`. Default: now.
 */

/**
 * The roster step: names with counts, plus "these two look like the same
 * person" pairs. `previous` preserves a hand-edited roster's decisions.
 *
 * @param {import("./parse.js").Parsed} parsed
 * @param {import("./roster.js").RosterPerson[]} [previous]
 * @returns {{ people: import("./roster.js").RosterPerson[], aliases: { a: string, b: string, dist: number }[] }}
 */
export function rosterSuggestions(parsed, previous = []) {
  const people = suggestRoster(parsed, previous);
  return { people, aliases: aliasSuggestions(people) };
}

/**
 * @typedef {object} AnalyzeResult
 * @property {any} stats                                       the ChatStats object (the shape src/lib/quiz.ts calls ChatStats)
 * @property {import("./report.js").ReportData} report
 * @property {string[]} suppressed                             questions dropped, with reasons
 * @property {import("./roster.js").ResolvedRoster} roster
 * @property {import("./stats.js").StatsBundle} bundle          everything computed, for screens that want more than the JSON
 */

/**
 * The build step, on an already-parsed export.
 *
 * Throws if the roster is undecided, if a display name in the export is
 * missing from it, or if nothing parsed.
 *
 * @param {import("./parse.js").Parsed} parsed
 * @param {AnalyzeOptions} [opts]
 * @returns {AnalyzeResult}
 */
export function analyzeParsed(parsed, opts = {}) {
  const { lang = "he", excerpts = false, longestRank = 1, funniestRank = 1, dayNotes = {}, expectPeople = 0 } = opts;
  const now = opts.now ?? new Date();

  const rosterPeople =
    opts.roster ?? suggestRoster(parsed).map((p) => ({ ...p, include: p.include ?? true }));
  const roster = resolveRoster(rosterPeople, { expect: expectPeople });

  // Any name in the file but missing from the roster is a hard error: a stale
  // roster would otherwise silently drop a person after a fresh export.
  const unknown = unknownAuthors(parsed, roster);
  if (unknown.length) {
    throw new Error(
      `these display names are not in the roster:\n    ${unknown.join("\n    ")}\n` +
        `  Re-run the roster step (your edits are preserved) and classify them.`
    );
  }

  const bundle = computeStats(parsed, roster, { lang });
  const { questions, suppressed, chosenLongest, pastedLongest, chosenFunniest } = generateQuestions(
    bundle,
    { lang, excerpts, longestRank, funniestRank, dayNotes },
    parsed.format.dateOrder
  );
  const { group, people, first, last, longestSilence } = bundle;

  const stats = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    source: {
      messages: bundle.totalMessages,
      systemEvents: parsed.systemCount,
      firstMessage: first.date,
      lastMessage: last.date,
      spanDays: bundle.spanDays,
      activeDays: bundle.activeDays,
      silentDays: bundle.spanDays - bundle.activeDays,
    },
    people: people.map((p) => ({ id: p.id, name: p.name, messages: p.messages })),
    group: {
      totalWords: group.totalWords,
      totalChars: group.totalChars,
      totalEmoji: group.totalEmoji,
      mediaMessages: group.media,
      deletedMessages: group.deleted,
      editedMessages: group.edited,
      polls: group.polls,
      byYear: group.byYear,
      byHour: group.byHour,
      byWeekday: group.byWeekday,
      busiestDays: bundle.busiestDays,
      topEmoji: bundle.topEmoji,
      longestSilence: {
        days: Math.floor(longestSilence.ms / 86400000),
        hours: Math.floor((longestSilence.ms % 86400000) / 3600000),
        endedAt: longestSilence.endedAt,
        brokenBy: longestSilence.brokenBy,
      },
      // The longest message anyone actually WROTE — see `longestRank`.
      longestMessage: chosenLongest
        ? {
            personId: chosenLongest.id,
            words: chosenLongest.words,
            date: chosenLongest.date,
            ...(excerpts ? { excerpt: firstWords(chosenLongest.text) } : {}),
          }
        : null,
      funniestMessage: chosenFunniest
        ? {
            personId: chosenFunniest.id,
            date: chosenFunniest.date,
            laughers: chosenFunniest.laughers,
            // Message text: only with the host's explicit opt-in.
            ...(excerpts ? { excerpt: firstWords(chosenFunniest.text, 10), fullText: chosenFunniest.fullText } : {}),
          }
        : null,
      // The longest message in the log at all, when it is a paste. No excerpt:
      // it is referenced only as a number.
      longestPasted:
        pastedLongest && chosenLongest && pastedLongest !== chosenLongest
          ? { personId: pastedLongest.id, words: pastedLongest.words, date: pastedLongest.date }
          : null,
      firstEver: { personId: bundle.idOf(first.author), date: first.date },
    },
    stats: Object.fromEntries(
      Object.entries(bundle.stats).map(([k, v]) => [k, { ...v, ranking: v.ranking.slice(0, 20) }])
    ),
    wordComparison: bundle.wordComparison,
    questions,
    integrity: {
      physicalLines: parsed.physicalLines,
      timestampLines: parsed.raw.length,
      continuationLines: parsed.continuationLines,
      orphanPreamble: parsed.orphanPreamble,
      unknownPlaceholders: parsed.unknownPlaceholders,
      classifierDisagreements: parsed.disagreements,
    },
  };

  const report = buildReport({ parsed, out: stats, bundle, suppressed, roster });
  return { stats, report, suppressed, roster, bundle };
}

/**
 * One call from export text to the ChatStats object.
 *
 * @param {string} text
 * @param {AnalyzeOptions} [opts]
 */
export function analyzeExport(text, opts = {}) {
  return analyzeParsed(parseChat(text), opts).stats;
}
