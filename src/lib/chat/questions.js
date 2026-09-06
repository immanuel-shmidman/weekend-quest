/**
 * Question generation, in Hebrew or English.
 *
 * Every candidate passes an ambiguity guard (top two within 15% = a parse
 * artifact, not a fact about anyone) and an answer-distribution cap (one
 * person may be the answer to at most MAX_ANSWERS_PER_PERSON questions, or the
 * quiz degenerates into "always pick the loudest one").
 *
 * Message text reaches a question ONLY when `excerpts` is on: the longest
 * message's opening words in two reveals, and the funniest turn as `quote`.
 */

import { FANDOMS } from "./stats.js";
import { stringsFor } from "./strings.js";
import { firstWords, fmtInt, formatDay } from "./text.js";

export const MAX_ANSWERS_PER_PERSON = 3;
/** Top two must be at least this far apart for a "who" question to be asked. */
export const MIN_GAP_RATIO = 1.15;

/**
 * @typedef {object} ChoiceQuestion
 * @property {string} id
 * @property {"choice"} type
 * @property {string} [statId]
 * @property {string} q
 * @property {string} answer
 * @property {string[]} wrong
 * @property {string} reveal
 * @property {string} [quote]
 * @property {number} points
 */

/**
 * @typedef {object} NumberQuestion
 * @property {string} id
 * @property {"number"} type
 * @property {string} [statId]
 * @property {string} q
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {number} answer
 * @property {number} falloff
 * @property {string} reveal
 * @property {number} points
 */

/** @typedef {ChoiceQuestion | NumberQuestion} Question */

/**
 * @typedef {object} QuestionOptions
 * @property {"he" | "en"} [lang]
 * @property {boolean} [excerpts]        include message text (opening words, funniest quote). Default false.
 * @property {number} [longestRank]      which entry of the longest-message ranking to treat as "the" longest (1-based)
 * @property {number} [funniestRank]     same for the funniest ranking
 * @property {Record<string, string | { he: string, en: string }>} [dayNotes]  hand-written context for specific YYYY-MM-DD dates
 */

/**
 * @param {import("./stats.js").StatsBundle} b
 * @param {QuestionOptions} [opts]
 * @param {"dmy" | "mdy"} [dateOrder]  how dates are rendered in reveals; follow the export
 * @returns {{ questions: Question[], suppressed: string[], chosenLongest: { id: string, words: number, date: string, text: string } | null, pastedLongest: { id: string, words: number, date: string, text: string } | null, chosenFunniest: import("./stats.js").ScoredTurn | null }}
 */
export function generateQuestions(b, opts = {}, dateOrder = "dmy") {
  const { lang = "he", excerpts = false, longestRank = 1, funniestRank = 1, dayNotes = {} } = opts;
  const S = stringsFor(lang);
  const { stats, nameOfId, group, busiestDays, longestSilence, wordComparison, topEmoji, totalMessages } = b;
  const { rankedMessages, funniest, fandomTally, mentionTally } = b;

  const pastedLongest = rankedMessages[0] ?? null;
  const chosenLongest = rankedMessages[longestRank - 1] ?? pastedLongest;
  const chosenFunniest = funniest[funniestRank - 1] ?? null;

  /** @type {Array<Question & { answerId?: string | null, gapRatio?: number | null }>} */
  const candidates = [];
  /** @type {string[]} */
  const suppressed = [];
  /** @param {string | null} id */
  const nm = (id) => (id && nameOfId.get(id)) ?? S.someone;
  /** @param {string} iso */
  const day = (iso) => formatDay(iso, dateOrder);
  /** @param {string} iso */
  const noteFor = (iso) => {
    const n = dayNotes[iso];
    if (!n) return "";
    const s = typeof n === "string" ? n : n[lang] ?? n.he ?? "";
    return s ? " " + s : "";
  };
  /** @param {{ he: string, en: string }} w */
  const title = (w) => (lang === "en" ? w.en : w.he);

  /**
   * Multiple choice over people, with distractors from ADJACENT ranks — a
   * random distractor from 14 names gives the answer away to anyone who knows
   * the group.
   * @param {string} id
   * @param {string} statId
   * @param {string} q
   * @param {(a: import("./stats.js").RankRow, b: import("./stats.js").RankRow) => string} reveal
   */
  const choice = (id, statId, q, reveal, { invert = false } = {}) => {
    const ranking = invert ? stats[statId].ranking.slice().reverse() : stats[statId].ranking;
    if (ranking.length < 4) return;
    const [first, second] = ranking;
    if (second.value === first.value) {
      suppressed.push(`${statId}: top two tied at ${first.value}`);
      return;
    }
    const gapRatio = second.value === 0 ? Infinity : first.value / second.value;
    if (Number.isFinite(gapRatio) && gapRatio < MIN_GAP_RATIO && !invert) {
      suppressed.push(`${statId}: gap ratio ${gapRatio.toFixed(2)} < ${MIN_GAP_RATIO}`);
      return;
    }
    const wrong = ranking.slice(1, 4).map((r) => nm(r.personId));
    if (new Set([nm(first.personId), ...wrong]).size !== 4) {
      suppressed.push(`${statId}: distractors collide`);
      return;
    }
    candidates.push({
      id,
      type: "choice",
      statId,
      q,
      answer: nm(first.personId),
      wrong,
      reveal: reveal(first, second),
      points: 100,
      answerId: first.personId,
      gapRatio: Number.isFinite(gapRatio) ? Number(gapRatio.toFixed(2)) : null,
    });
  };

  /**
   * @param {string} id
   * @param {string} q
   * @param {number} answer
   * @param {{ min?: number, max?: number, step?: number, reveal: string }} o
   */
  const number = (id, q, answer, o) => {
    if (!Number.isFinite(answer) || answer <= 0) return;
    const step = o.step ?? 1;
    candidates.push({
      id,
      type: "number",
      q,
      min: o.min ?? 0,
      max: o.max ?? Math.round(answer * 2.5),
      step,
      answer,
      // Relative falloff: answers span three orders of magnitude.
      falloff: Math.max(step * 2, Math.round(answer * 0.7)),
      reveal: o.reveal,
      points: 100,
    });
  };

  // --- who ------------------------------------------------------------------
  choice("who_most_messages", "messages", S.q.who_most_messages(), (a, b2) =>
    S.r.who_most_messages(nm(a.personId), fmtInt(a.value), nm(b2.personId), fmtInt(b2.value))
  );
  choice("who_night_owl", "nightMessages", S.q.who_night_owl(), (a) => S.r.who_night_owl(nm(a.personId), a.value));
  choice("who_starts", "conversationStarts", S.q.who_starts(), (a) => S.r.who_starts(nm(a.personId), a.value));
  choice("who_last_word", "lastWord", S.q.who_last_word(), (a) => S.r.who_last_word(nm(a.personId), a.value));
  // Share of messages rather than raw count: one "!!!!!" inflates the raw
  // number, and on the raw metric second and third place can sit inside the
  // ambiguity guard, so the question would vanish the moment the top scorer
  // was excluded.
  choice("who_exclaims", "exclaimShare", S.q.who_exclaims(), (a, b2) =>
    S.r.who_exclaims(nm(a.personId), a.value, nm(b2.personId), b2.value)
  );
  choice("who_asks", "questionRate", S.q.who_asks(), (a) => S.r.who_asks(nm(a.personId), a.value));
  choice("who_emoji", "emojiRate", S.q.who_emoji(), (a) => S.r.who_emoji(nm(a.personId), a.value));
  choice("who_media", "media", S.q.who_media(), (a) => S.r.who_media(nm(a.personId), fmtInt(a.value)));

  // Built by hand rather than from the per-person ranking: the ranking's top
  // entry may be a pasted article, and the interesting question is who wrote
  // the longest thing themselves.
  const isPasted = pastedLongest && chosenLongest && pastedLongest !== chosenLongest;
  if (chosenLongest) {
    const others = [];
    for (const m of rankedMessages) {
      if (m.id === chosenLongest.id || others.includes(m.id)) continue;
      others.push(m.id);
      if (others.length === 3) break;
    }
    if (others.length === 3) {
      candidates.push({
        id: "who_longest_msg",
        type: "choice",
        statId: "longestMessage",
        q: S.q.who_longest_msg(),
        answer: nm(chosenLongest.id),
        wrong: others.map(nm),
        reveal:
          S.r.who_longest_msg(nm(chosenLongest.id), fmtInt(chosenLongest.words), day(chosenLongest.date)) +
          (excerpts ? S.r.longest_opens_with(firstWords(chosenLongest.text)) : "") +
          (isPasted ? S.r.longest_pasted_note(fmtInt(pastedLongest.words)) : ""),
        points: 100,
        answerId: chosenLongest.id,
        gapRatio: null,
      });
    }
  }
  choice("who_monologue", "monologue", S.q.who_monologue(), (a) => S.r.who_monologue(nm(a.personId), a.value));

  if (longestSilence.brokenBy) {
    const wrong = stats.messages.ranking
      .filter((r) => r.personId !== longestSilence.brokenBy)
      .slice(0, 3)
      .map((r) => nm(r.personId));
    if (wrong.length === 3) {
      const days = Math.floor(longestSilence.ms / 86400000);
      candidates.push({
        id: "who_broke_silence",
        type: "choice",
        statId: "longestSilence",
        q: S.q.who_broke_silence(days),
        answer: nm(longestSilence.brokenBy),
        wrong,
        reveal: S.r.who_broke_silence(nm(longestSilence.brokenBy), day(longestSilence.endedAt)),
        points: 100,
        answerId: longestSilence.brokenBy,
        gapRatio: null,
      });
    }
  }

  if (chosenFunniest) {
    const others = [];
    for (const m of funniest) {
      if (m.id === chosenFunniest.id || others.includes(m.id)) continue;
      others.push(m.id);
      if (others.length === 3) break;
    }
    if (others.length === 3) {
      candidates.push({
        id: "who_funniest",
        type: "choice",
        statId: "funniestMessage",
        q: S.q.who_funniest(),
        answer: nm(chosenFunniest.id),
        wrong: others.map(nm),
        reveal: S.r.who_funniest(nm(chosenFunniest.id), day(chosenFunniest.date), chosenFunniest.laughers),
        // The whole turn, rendered as a quote block by the quiz screen. Message
        // text: only with the host's explicit opt-in.
        ...(excerpts ? { quote: chosenFunniest.fullText } : {}),
        points: 100,
        answerId: chosenFunniest.id,
        gapRatio: null,
      });
    }
  }

  /**
   * Build a choice question from a tally of personId -> count. Same ambiguity
   * guard as the ranked stats.
   * @param {string} id
   * @param {import("./stats.js").Tally | undefined} tally
   * @param {string} q
   * @param {(ranked: [string, number][], total: number) => string} reveal
   * @param {number} minTotal
   * @returns {boolean} whether a question was added
   */
  const fromTally = (id, tally, q, reveal, minTotal) => {
    if (!tally) return false;
    const ranked = [...tally.perPerson.entries()].sort((a, b2) => b2[1] - a[1]);
    const total = tally.total;
    if (total < minTotal || ranked.length < 4) {
      suppressed.push(`${id}: only ${total} mentions across ${ranked.length} people`);
      return false;
    }
    const gap = ranked[1][1] === 0 ? Infinity : ranked[0][1] / ranked[1][1];
    if (gap < MIN_GAP_RATIO) {
      suppressed.push(`${id}: gap ratio ${gap.toFixed(2)} < ${MIN_GAP_RATIO}`);
      return false;
    }
    const wrong = ranked.slice(1, 4).map(([pid]) => nm(pid));
    if (new Set([nm(ranked[0][0]), ...wrong]).size !== 4) return false;
    candidates.push({
      id,
      type: "choice",
      statId: id,
      q,
      answer: nm(ranked[0][0]),
      wrong,
      reveal: reveal(ranked, total),
      points: 100,
      answerId: ranked[0][0],
      gapRatio: Number.isFinite(gap) ? Number(gap.toFixed(2)) : null,
    });
    return true;
  };

  // The first fandom that makes it introduces the idea with the long reveal;
  // any later one gets the short form.
  let fandomAsked = false;
  for (const f of FANDOMS) {
    const added = fromTally(
      f.questionId ?? `who_${f.key}`,
      fandomTally.get(f.key),
      S.q.who_fandom(title(f)),
      (ranked, total) =>
        fandomAsked
          ? S.r.who_fandom(nm(ranked[0][0]), ranked[0][1], total)
          : S.r.who_fandom_first(nm(ranked[0][0]), ranked[0][1], title(f), total),
      f.minTotal ?? 15
    );
    if (added) fandomAsked = true;
  }

  // "Who gets mentioned most" is not answerable when half the names are also
  // ordinary words, so those counts are fiction. Flipping it to a single,
  // distinctively-named target removes the ambiguity entirely. Pick whichever
  // target has the cleanest leader.
  {
    let best = null;
    for (const [targetId, tally] of mentionTally) {
      const ranked = [...tally.perPerson.entries()].sort((a, b2) => b2[1] - a[1]);
      const total = tally.total;
      if (total < 120 || ranked.length < 4) continue;
      const gap = ranked[1][1] === 0 ? Infinity : ranked[0][1] / ranked[1][1];
      if (gap < MIN_GAP_RATIO) continue;
      if (!best || gap > best.gap) best = { targetId, ranked, total, gap };
    }
    if (best) {
      const target = nm(best.targetId);
      candidates.push({
        id: "who_mentions_most",
        type: "choice",
        statId: "mentions",
        q: S.q.who_mentions_most(target),
        answer: nm(best.ranked[0][0]),
        wrong: best.ranked.slice(1, 4).map(([pid]) => nm(pid)),
        reveal: S.r.who_mentions_most(nm(best.ranked[0][0]), target, best.ranked[0][1], nm(best.ranked[1][0]), best.ranked[1][1]),
        points: 100,
        answerId: best.ranked[0][0],
        gapRatio: Number(best.gap.toFixed(2)),
      });
    }
  }

  // --- when -----------------------------------------------------------------
  // Day of week — everyone knows this one, which makes it the right opener.
  const wd = Object.entries(group.byWeekday).sort((a, b2) => a[1] - b2[1]);
  if (wd.length >= 4 && wd[0][1] < wd[1][1]) {
    candidates.push({
      id: "quietest_day",
      type: "choice",
      statId: "byWeekday",
      q: S.q.quietest_day(),
      answer: S.weekday[wd[0][0]],
      wrong: [S.weekday[wd[1][0]], S.weekday[wd[2][0]], S.weekday[wd[3][0]]],
      reveal: S.r.quietest_day(S.weekday[wd[0][0]], fmtInt(wd[0][1]), fmtInt(wd[wd.length - 1][1])),
      points: 100,
      answerId: null,
      gapRatio: null,
    });
  }

  const years = Object.entries(group.byYear).sort((a, b2) => b2[1] - a[1]);
  if (years.length >= 4 && years[0][1] > years[1][1] * MIN_GAP_RATIO) {
    candidates.push({
      id: "peak_year",
      type: "choice",
      statId: "byYear",
      q: S.q.peak_year(),
      answer: years[0][0],
      wrong: [years[1][0], years[2][0], years[3][0]],
      reveal: S.r.peak_year(years[0][0], fmtInt(years[0][1])),
      points: 100,
      answerId: null,
      gapRatio: null,
    });
  }

  if (busiestDays.length >= 4) {
    const top = busiestDays[0];
    candidates.push({
      id: "busiest_day",
      type: "choice",
      statId: "busiestDays",
      q: S.q.busiest_day(),
      answer: day(top.date),
      wrong: busiestDays.slice(1, 4).map((d) => day(d.date)),
      reveal: S.r.busiest_day(day(top.date), top.count) + noteFor(top.date),
      points: 100,
      answerId: null,
      gapRatio: null,
    });
    number("how_many_busiest", S.q.how_many_busiest(), top.count, {
      min: 0,
      max: 1200,
      step: 10,
      reveal: S.r.how_many_busiest(top.count, day(top.date)) + noteFor(top.date),
    });
  }

  // --- how many -------------------------------------------------------------
  number("total_messages", S.q.total_messages(b.first.year), totalMessages, {
    min: 0,
    max: 250000,
    step: 1000,
    reveal: S.r.total_messages(fmtInt(totalMessages)),
  });

  number("total_words", S.q.total_words(), group.totalWords, {
    min: 0,
    max: 1500000,
    step: 10000,
    reveal:
      S.r.total_words_intro(fmtInt(group.totalWords), wordComparison.torahMultiple) +
      (wordComparison.beats[0] ? S.r.total_words_beat_one(title(wordComparison.beats[0])) : "") +
      (wordComparison.beats[1] ? S.r.total_words_beat_two(title(wordComparison.beats[1])) : ". ") +
      (wordComparison.shortOf[0] ? S.r.total_words_short_of(title(wordComparison.shortOf[0])) : ""),
  });

  if (topEmoji[0]) {
    number("top_emoji_count", S.q.top_emoji_count(topEmoji[0].emoji), topEmoji[0].n, {
      min: 0,
      max: Math.round(topEmoji[0].n * 3),
      step: 500,
      reveal: S.r.top_emoji_count(fmtInt(topEmoji[0].n), Math.round((topEmoji[0].n / group.totalEmoji) * 100)),
    });
  }

  const silenceDays = Math.floor(longestSilence.ms / 86400000);
  if (silenceDays > 1 && longestSilence.endedAt) {
    number("longest_silence", S.q.longest_silence(), silenceDays, {
      min: 0,
      max: Math.max(60, silenceDays * 2),
      step: 1,
      reveal: S.r.longest_silence(silenceDays, day(longestSilence.endedAt)),
    });
  }

  if (chosenLongest) {
    number("longest_message_words", S.q.longest_message_words(), chosenLongest.words, {
      min: 0,
      max: Math.round(chosenLongest.words * 2.5),
      step: 25,
      reveal:
        S.r.longest_message_words(fmtInt(chosenLongest.words), nm(chosenLongest.id), day(chosenLongest.date)) +
        (excerpts ? S.r.longest_opens_with(firstWords(chosenLongest.text)) : "") +
        (isPasted ? S.r.longest_message_words_pasted(fmtInt(pastedLongest.words)) : ""),
    });
  }

  number("media_count", S.q.media_count(), group.media, {
    min: 0,
    max: Math.round(group.media * 3),
    step: 100,
    reveal: S.r.media_count(fmtInt(group.media)),
  });

  // --- answer-distribution cap ---------------------------------------------
  const used = new Map();
  /** @type {Question[]} */
  const questions = [];
  for (const q of candidates) {
    if (q.type === "choice" && q.answerId) {
      const n = used.get(q.answerId) ?? 0;
      if (n >= MAX_ANSWERS_PER_PERSON) {
        suppressed.push(`${q.id}: ${nm(q.answerId)} already the answer ${n} times`);
        continue;
      }
      used.set(q.answerId, n + 1);
    }
    // answerId/gapRatio are provenance, not needed at runtime.
    const { answerId, gapRatio, ...clean } = q;
    void answerId;
    void gapRatio;
    questions.push(/** @type {Question} */ (clean));
  }

  return { questions, suppressed, chosenLongest, pastedLongest, chosenFunniest };
}
