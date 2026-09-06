/**
 * Statistics over parsed messages and a resolved roster. Pure functions, no
 * IO, no environment: everything here runs unchanged in Node and the browser.
 *
 * `computeStats` is the whole build; the smaller functions it is made of are
 * exported too so the CLI's inspection commands (longest, funniest, fandom,
 * mentions) and a future results screen can reuse them.
 */

import { EXCLAIM_RE, LAUGH_RE, countWords, emojiOf, firstWords, graphemes } from "./text.js";
import { idResolver, namesById } from "./roster.js";
import { stringsFor } from "./strings.js";
import { compareToWorks } from "./works.js";

/* =========================================================================
 * Laughter
 * ====================================================================== */

/**
 * "The group laughed" signals, counted in the messages that FOLLOW a message.
 *
 * Nobody reacts to their own joke, so only other people's replies count, and a
 * single reply contributes at most REACTION_CAP - otherwise one person sending
 * thirty crying-laughing faces decides the whole question.
 *
 * 🙈 and 😭 are deliberately absent: 🙈 is self-deprecation by the *sender*
 * rather than a reaction, and 😭 is used for genuine upset as often as for
 * laughing.
 */
export const LAUGH_EMOJI = new Set(["😂", "🤣", "😆", "😹", "😅"]);
export const REACTION_CAP = 3;
export const REACTION_WINDOW_MS = 20 * 60 * 1000;
export const REACTION_LOOKAHEAD = 10;
/** Consecutive messages from one person count as a single joke, not several. */
export const TURN_GAP_MS = 10 * 60 * 1000;

/**
 * Rate statistics need a sample floor.
 *
 * Somebody who sent two messages in eight years, one of which had four
 * exclamation marks, "wins" at 200 per 100 messages — a true number and a
 * worthless question. Only people with a real message history can win a rate
 * ranking; they stay in the raw-count rankings regardless.
 */
export const MIN_MESSAGES_FOR_RATE = 200;

/** A gap of 6h+ ends a conversation. */
export const CONVERSATION_GAP_MS = 6 * 3600 * 1000;

/**
 * How much one reply signals laughter, capped so a spammer cannot dominate.
 * @param {string} text
 */
export function laughSignal(text) {
  let n = 0;
  for (const g of graphemes(text)) {
    if (LAUGH_EMOJI.has(g.segment)) n++;
  }
  n += (text.match(LAUGH_RE) ?? []).length;
  n += (text.match(EXCLAIM_RE) ?? []).length;
  return Math.min(REACTION_CAP, n);
}

/**
 * @typedef {object} TimelineEntry
 * @property {string} id
 * @property {number} time
 * @property {string} date  YYYY-MM-DD
 * @property {string} text
 * @property {import("./parse.js").PlaceholderId | null} placeholder
 * @property {number} words
 * @property {number} signal
 */

/**
 * Included messages in order, with the per-message numbers scoreTurns needs.
 * @param {import("./parse.js").Parsed} parsed
 * @param {(author: string) => string | null} idOf
 * @returns {TimelineEntry[]}
 */
export function buildTimeline(parsed, idOf) {
  const timeline = [];
  for (const m of parsed.messages) {
    const id = idOf(m.author);
    if (id === null) continue;
    timeline.push({
      id,
      time: m.time,
      date: m.day,
      text: m.text,
      placeholder: m.placeholder,
      words: m.placeholder ? 0 : countWords(m.text),
      signal: m.placeholder ? 0 : laughSignal(m.text),
    });
  }
  return timeline;
}

/**
 * @typedef {object} ScoredTurn
 * @property {string} id
 * @property {string} date
 * @property {string} text       the representative message
 * @property {string} fullText   every message of the turn, newline-joined
 * @property {number} messageCount
 * @property {number} words
 * @property {number} laughers   distinct people who laughed
 * @property {number} tokens     total laugh signal
 */

/**
 * Group a timeline into turns and score each by the laughter that follows it.
 *
 * Grouping matters: people tell a story across four or five messages and the
 * group laughs at the end, so scoring each message separately produces four
 * near-identical entries and can crown a fragment instead of the story. A turn
 * is represented by where it STARTS - that is the text someone would search
 * for - and scored by what follows where it ENDS.
 *
 * @param {TimelineEntry[]} timeline
 * @returns {ScoredTurn[]}  best first
 */
export function scoreTurns(timeline) {
  const turns = [];
  for (let i = 0; i < timeline.length; i++) {
    const m = timeline[i];
    const prev = turns[turns.length - 1];
    if (prev && prev.id === m.id && m.time - prev.lastTime <= TURN_GAP_MS) {
      prev.lastTime = m.time;
      prev.endIndex = i;
      prev.words += m.words;
      if (!m.placeholder) prev.msgs.push(m);
    } else {
      turns.push({
        id: m.id,
        date: m.date,
        time: m.time,
        lastTime: m.time,
        endIndex: i,
        words: m.words,
        msgs: m.placeholder ? [] : [m],
      });
    }
  }

  const scored = [];
  for (const t of turns) {
    if (!t.msgs.length) continue;

    // Represent the turn by its first substantial message, falling back to its
    // longest. Taking the literal first message crowns fragments: a turn can
    // open with a reaction to someone else and then continue into the story.
    const rep = t.msgs.find((m) => m.words >= 5) ?? t.msgs.reduce((a, b) => (b.words > a.words ? b : a));

    // The representative must be substantial enough to be worth quoting and
    // searchable, and must not itself be a bare laugh.
    if (rep.words < 4) continue;
    if (rep.signal > 0 && rep.words <= 3) continue;

    const laughers = new Set();
    let tokens = 0;
    for (let j = t.endIndex + 1; j < timeline.length && j <= t.endIndex + REACTION_LOOKAHEAD; j++) {
      const r = timeline[j];
      if (r.time - t.lastTime > REACTION_WINDOW_MS) break;
      if (r.id === t.id || r.signal === 0) continue;
      laughers.add(r.id);
      tokens += r.signal;
    }
    // Two people or it is one friend being polite, not the group laughing.
    if (laughers.size >= 2) {
      scored.push({
        id: t.id,
        date: t.date,
        text: rep.text,
        fullText: t.msgs.map((m) => m.text).join("\n"),
        messageCount: t.msgs.length,
        words: t.words,
        laughers: laughers.size,
        tokens,
      });
    }
  }
  // Distinct laughers first - that is what "the group laughed" means - with
  // total signal only as a tie-break.
  scored.sort((a, b) => b.laughers - a.laughers || b.tokens - a.tokens);
  return scored;
}

/**
 * Every real message of `minWords`+ words, longest first, so a caller can
 * point at the longest one somebody actually wrote rather than the longest one
 * anybody pasted.
 *
 * @param {import("./parse.js").Parsed} parsed
 * @param {(author: string) => string | null} idOf
 * @param {number} [minWords]
 * @returns {{ words: number, id: string, date: string, text: string }[]}
 */
export function rankLongest(parsed, idOf, minWords = 40) {
  const ranked = [];
  for (const m of parsed.messages) {
    if (m.placeholder) continue;
    const id = idOf(m.author);
    if (id === null) continue;
    const words = countWords(m.text);
    if (words >= minWords) ranked.push({ words, id, date: m.day, text: m.text });
  }
  ranked.sort((a, b) => b.words - a.words);
  return ranked;
}

/* =========================================================================
 * Fandoms and mentions
 * ====================================================================== */

/**
 * Fandoms, by distinctive terms only.
 *
 * Deliberately no bare common words: "חברים" would match every mention of
 * friends rather than the sitcom, and "מלחמה" is a card game in some groups.
 * Character and place names carry the signal with almost no false positives.
 *
 * Two terms were removed after reading samples: "השיר" for the Shire is simply
 * "the song" and matched dozens of unrelated messages, and "דובי" for Dobby is
 * a common Hebrew nickname. Both quietly inflated their fandom.
 *
 * Matching allows the Hebrew prefix letters ו/ה/ב/ל/מ/ש/כ and is
 * case-insensitive for the Latin terms.
 *
 * `minTotal` is the mention floor below which no question is asked (default
 * 15); `questionId` overrides the generated `who_<key>` id.
 *
 * @type {{ key: string, he: string, en: string, terms: string[], minTotal?: number, questionId?: string }[]}
 */
export const FANDOMS = [
  {
    key: "hp",
    he: "הארי פוטר",
    en: "Harry Potter",
    minTotal: 25,
    questionId: "who_harry_potter",
    terms: [
      "הארי פוטר", "הוגוורטס", "וולדמורט", "דמבלדור", "הרמיוני", "גריפינדור",
      "סליתרין", "הפלפאף", "רייבנקלו", "קווידיץ", "דמנטור", "סנייפ", "הגריד",
      "מוגל", "מוגלגים", "סיריוס בלאק", "אבן החכמים",
      "harry potter", "hogwarts", "voldemort", "dumbledore", "hermione",
      "gryffindor", "slytherin", "quidditch", "dementor", "snape", "hagrid",
    ],
  },
  {
    key: "lotr",
    he: "שר הטבעות",
    en: "The Lord of the Rings",
    terms: [
      "שר הטבעות", "ההוביט", "פרודו", "גנדלף", "גולום", "מורדור", "אראגורן",
      "לגולאס", "גימלי", "סאורון", "סמיאגול", "טולקין", "בילבו",
      "lord of the rings", "lotr", "hobbit", "frodo", "gandalf", "gollum",
      "mordor", "aragorn", "legolas", "sauron", "tolkien", "middle earth",
    ],
  },
  {
    key: "starwars",
    he: "מלחמת הכוכבים",
    en: "Star Wars",
    terms: [
      "מלחמת הכוכבים", "דארת ויידר", "וויידר", "יודה", "סקייווקר", "ג'דיי",
      "האן סולו", "צ'ובקה", "הכוח איתך",
      "star wars", "darth vader", "yoda", "skywalker", "jedi", "sith",
      "han solo", "chewbacca", "obi wan",
    ],
  },
  {
    key: "got",
    he: "משחקי הכס",
    en: "Game of Thrones",
    terms: [
      "משחקי הכס", "וסטרוס", "דיינריס", "ג'ון סנואו", "לאניסטר", "טארגריאן",
      "טיריון", "וינטרפל",
      "game of thrones", "westeros", "daenerys", "jon snow", "lannister",
      "targaryen", "tyrion", "winterfell",
    ],
  },
  {
    key: "marvel",
    he: "מארוול",
    en: "Marvel",
    terms: [
      "מארוול", "הנוקמים", "איירון מן", "ספיידרמן", "האלק", "קפטן אמריקה",
      "תאנוס", "לוקי",
      "marvel", "avengers", "iron man", "spiderman", "spider man", "hulk",
      "captain america", "thanos",
    ],
  },
  {
    key: "disney",
    he: "דיסני",
    en: "Disney",
    terms: ["דיסני", "סימבה", "מלך האריות", "אלזה", "מואנה", "פיקסאר", "disney", "pixar", "simba"],
  },
  {
    key: "percy",
    he: "פרסי ג'קסון",
    en: "Percy Jackson",
    terms: ["פרסי ג'קסון", "percy jackson", "אולימפוס", "ריק ריירדן"],
  },
  { key: "narnia", he: "נרניה", en: "Narnia", terms: ["נרניה", "narnia", "אסלן", "aslan"] },
  { key: "pokemon", he: "פוקימון", en: "Pokémon", terms: ["פוקימון", "pokemon", "פיקאצו", "pikachu"] },
  { key: "seinfeld", he: "סיינפלד", en: "Seinfeld", terms: ["סיינפלד", "seinfeld", "קרמר", "ג'ורג' קוסטנזה"] },
];

/**
 * Names that are also ordinary Hebrew words, so a raw mention count for them
 * is mostly noise. They are never used as mention targets; the CLI reports on
 * them separately rather than pretending.
 * @type {Record<string, string>}
 */
export const AMBIGUOUS_NAMES = {
  אור: "also means 'light'",
  אביב: "also means 'spring', and תל אביב",
  שחר: "also means 'dawn'",
  אדר: "also the Hebrew month",
  רות: "also 'roger/copy that'",
  יעל: "also an ibex, and the verb יעל",
  נעמה: "also an adjective",
};

/** Hebrew prefixes that can attach to a word without changing it. */
const HE_PREFIX = "[והבלמשכ]?";

/**
 * Phrases that look like a name but are not the person.
 *
 * Without these, "תל אביב" alone gives אביב more mentions than anyone in the
 * group actually has, and the whole ranking is fiction.
 * @type {Record<string, RegExp>}
 */
export const MENTION_EXCLUDE = {
  אביב: /תל\s*אביב/gu,
  אדר: /(?:ראש\s*)?חודש\s*אדר|אדר\s*[אב]['׳]?|['׳]?\s*ב?אדר\s*ה?תש/gu,
  אור: /אור\s*(?:אדום|ירוק|שמש|יום|נר|ראשון)|(?:קרן|מאור|כיבוי|הדלקת)\s*אור/gu,
  שחר: /עלות\s*השחר|לפנות\s*שחר|שחר\s*של\s*יום/gu,
};

/**
 * Name matcher, deliberately stricter than termRegex.
 *
 * The ש prefix is excluded: it turns רות into שרות ("singing"), which is how
 * that name picked up most of its count. ה is excluded too - האור is far more
 * often "the light" than the person.
 */
const NAME_PREFIX = "[ולמבכ]?";

/** @param {string} name */
export function nameRegex(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![א-תa-zA-Z])${NAME_PREFIX}${esc}(?![א-תa-zA-Z])`, "giu");
}

/** @param {string[]} terms */
export function termRegex(terms) {
  const parts = terms.map((t) =>
    t
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/ /g, "\\s+")
      // People type the geresh as ' or ׳, or leave it out entirely.
      .replace(/'/g, "['׳]?")
  );
  return new RegExp(`(?<![א-תa-zA-Z])${HE_PREFIX}(?:${parts.join("|")})(?![א-תa-zA-Z])`, "giu");
}

/**
 * @typedef {object} Tally
 * @property {number} total
 * @property {Map<string, number>} perPerson  person id -> hits
 * @property {string[]} samples  opening words of matching messages (only when `samples` > 0)
 */

/**
 * Who talks about which universe.
 * @param {import("./parse.js").Parsed} parsed
 * @param {(author: string) => string | null} idOf
 * @param {{ samples?: number }} [opts]
 * @returns {Map<string, Tally>}  fandom key -> tally (only fandoms with hits)
 */
export function fandomMentions(parsed, idOf, { samples = 0 } = {}) {
  const compiled = FANDOMS.map((f) => ({ key: f.key, re: termRegex(f.terms) }));
  const out = new Map();
  for (const m of parsed.messages) {
    if (m.placeholder) continue;
    const author = idOf(m.author);
    if (author === null) continue;
    for (const f of compiled) {
      const hits = m.text.match(f.re);
      if (!hits) continue;
      let t = out.get(f.key);
      if (!t) out.set(f.key, (t = { total: 0, perPerson: new Map(), samples: [] }));
      t.total += hits.length;
      t.perPerson.set(author, (t.perPerson.get(author) ?? 0) + hits.length);
      if (t.samples.length < samples) t.samples.push(`${hits[0]} | ${firstWords(m.text, 12, 90)}`);
    }
  }
  return out;
}

/**
 * Who gets talked about, counting each person's name in OTHER people's
 * messages only. Ambiguous names (see AMBIGUOUS_NAMES) are skipped unless
 * `includeAmbiguous`.
 *
 * @param {import("./parse.js").Parsed} parsed
 * @param {(author: string) => string | null} idOf
 * @param {Map<string, string>} nameOfId
 * @param {{ samples?: number, includeAmbiguous?: boolean }} [opts]
 * @returns {Map<string, Tally & { name: string, ambiguous: string | null }>}  target id -> tally
 */
export function nameMentions(parsed, idOf, nameOfId, { samples = 0, includeAmbiguous = false } = {}) {
  const targets = [...nameOfId.entries()]
    .filter(([, name]) => includeAmbiguous || !AMBIGUOUS_NAMES[name])
    .map(([id, name]) => ({
      id,
      name,
      re: nameRegex(name),
      exclude: MENTION_EXCLUDE[name] ?? null,
      ambiguous: AMBIGUOUS_NAMES[name] ?? null,
    }));
  const out = new Map();
  for (const t of targets) {
    out.set(t.id, { name: t.name, ambiguous: t.ambiguous, total: 0, perPerson: new Map(), samples: [] });
  }
  for (const m of parsed.messages) {
    if (m.placeholder) continue;
    const author = idOf(m.author);
    if (author === null) continue;
    for (const t of targets) {
      if (t.id === author) continue; // only what OTHERS say about you
      const hits = m.text.match(t.re);
      if (!hits) continue;
      // Subtract the known false contexts rather than counting them.
      const bogus = t.exclude ? (m.text.match(t.exclude) ?? []).length : 0;
      const real = hits.length - bogus;
      if (real <= 0) continue;
      const tally = out.get(t.id);
      tally.total += real;
      tally.perPerson.set(author, (tally.perPerson.get(author) ?? 0) + real);
      if (tally.samples.length < samples) tally.samples.push(firstWords(m.text, 14, 95));
    }
  }
  return out;
}

/* =========================================================================
 * The build
 * ====================================================================== */

/**
 * @typedef {object} PersonAcc
 * @property {string} id
 * @property {string} name
 * @property {number} messages
 * @property {number} words
 * @property {number} chars
 * @property {number} media
 * @property {number} emoji
 * @property {number} laughs
 * @property {number} questions
 * @property {number} exclamations
 * @property {number} exclaimMsgs
 * @property {number} night
 * @property {number} starts
 * @property {number} lastWords
 * @property {number} longest
 * @property {string} longestDate
 * @property {number} monologue
 * @property {number} responseSum
 * @property {number} responseN
 * @property {Map<string, number>} emojiCounts
 */

/**
 * @typedef {object} GroupAcc
 * @property {number} totalWords
 * @property {number} totalChars
 * @property {number} totalEmoji
 * @property {number} media
 * @property {number} deleted
 * @property {number} edited
 * @property {number} polls
 * @property {Record<string, number>} byYear
 * @property {number[]} byHour
 * @property {Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", number>} byWeekday
 * @property {Map<string, number>} byDay
 * @property {Map<string, number>} emojiCounts
 */

/** @typedef {{ ms: number, endedAt: string | null, brokenBy: string | null }} Silence */

/** @typedef {{ personId: string, value: number }} RankRow */
/** @typedef {{ label: string, kind: "ranking", unit: string, note?: string, ranking: RankRow[] }} StatTable */

/**
 * @typedef {object} StatsBundle
 * @property {"he" | "en"} chatLang                     detected from the letters people typed
 * @property {PersonAcc[]} people                       most messages first
 * @property {number} totalMessages
 * @property {Record<string, StatTable>} stats           full rankings (not truncated)
 * @property {GroupAcc} group
 * @property {{ date: string, count: number }[]} busiestDays
 * @property {{ emoji: string, n: number }[]} topEmoji
 * @property {Silence} longestSilence
 * @property {ReturnType<typeof rankLongest>} rankedMessages
 * @property {ScoredTurn[]} funniest
 * @property {Map<string, Tally>} fandomTally
 * @property {Map<string, Tally & { name: string, ambiguous: string | null }>} mentionTally
 * @property {Map<string, string>} nameOfId
 * @property {(author: string) => string | null} idOf
 * @property {import("./works.js").WordComparison} wordComparison
 * @property {import("./parse.js").Message} first
 * @property {import("./parse.js").Message} last
 * @property {number} spanDays
 * @property {number} activeDays
 */

/**
 * Everything the output and the question generator need, computed once.
 *
 * @param {import("./parse.js").Parsed} parsed
 * @param {import("./roster.js").ResolvedRoster} roster
 * @param {{ lang?: "he" | "en" }} [opts]
 * @returns {StatsBundle}
 */
export function computeStats(parsed, roster, { lang = "he" } = {}) {
  const S = stringsFor(lang);
  const idOf = idResolver(roster);
  const nameOfId = namesById(roster);

  /** @type {Map<string, PersonAcc>} */
  const P = new Map();
  /** @param {string} id */
  const person = (id) => {
    let p = P.get(id);
    if (!p) {
      P.set(
        id,
        (p = {
          id,
          name: nameOfId.get(id) ?? id,
          messages: 0,
          words: 0,
          chars: 0,
          media: 0,
          emoji: 0,
          laughs: 0,
          questions: 0,
          exclamations: 0,
          exclaimMsgs: 0,
          night: 0,
          starts: 0,
          lastWords: 0,
          longest: 0,
          longestDate: "",
          monologue: 0,
          responseSum: 0,
          responseN: 0,
          emojiCounts: new Map(),
        })
      );
    }
    return p;
  };

  /** @type {GroupAcc} */
  const group = {
    totalWords: 0,
    totalChars: 0,
    totalEmoji: 0,
    media: 0,
    deleted: 0,
    edited: 0,
    polls: 0,
    byYear: {},
    byHour: new Array(24).fill(0),
    byWeekday: { sun: 0, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 },
    byDay: new Map(),
    emojiCounts: new Map(),
  };
  /** @type {(keyof GroupAcc["byWeekday"])[]} */
  const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  /** @type {{ id: string, time: number } | null} */
  let prev = null; // previous included message
  /** @type {string | null} */
  let runAuthor = null;
  let runLength = 0;
  /** @type {Silence} */
  let longestSilence = { ms: 0, endedAt: null, brokenBy: null };
  let hebrewLetters = 0;
  let latinLetters = 0;

  for (const m of parsed.messages) {
    const id = idOf(m.author);
    if (id === null) continue; // excluded person: skipped from every stat
    const p = person(id);
    const t = m.time;

    p.messages++;
    group.byYear[m.year] = (group.byYear[m.year] ?? 0) + 1;
    group.byHour[m.hour]++;
    group.byWeekday[WD[m.weekday]]++;
    group.byDay.set(m.day, (group.byDay.get(m.day) ?? 0) + 1);
    if (m.hour >= 2 && m.hour < 5) p.night++;

    if (m.placeholder === "media") {
      p.media++;
      group.media++;
    } else if (m.placeholder === "deleted") {
      group.deleted++;
    } else if (m.placeholder === "poll") {
      group.polls++;
    } else if (!m.placeholder) {
      // Only real prose contributes to word and character counts, or
      // "<Media omitted>" would inject two fake words 4,000 times over.
      const words = countWords(m.text);
      p.words += words;
      p.chars += m.text.length;
      group.totalWords += words;
      group.totalChars += m.text.length;
      if (words > p.longest) {
        p.longest = words;
        p.longestDate = m.day;
      }
      hebrewLetters += (m.text.match(/[א-ת]/g) ?? []).length;
      latinLetters += (m.text.match(/[a-zA-Z]/g) ?? []).length;
      p.questions += (m.text.match(/\?/g) ?? []).length;
      p.exclamations += (m.text.match(/!/g) ?? []).length;
      if (m.text.includes("!")) p.exclaimMsgs++;
      p.laughs += (m.text.match(LAUGH_RE) ?? []).length;
      for (const e of emojiOf(m.text)) {
        p.emoji++;
        group.totalEmoji++;
        p.emojiCounts.set(e, (p.emojiCounts.get(e) ?? 0) + 1);
        group.emojiCounts.set(e, (group.emojiCounts.get(e) ?? 0) + 1);
      }
    }
    if (m.edited) group.edited++;

    // Conversation structure: a gap of 6h+ ends a conversation.
    if (prev) {
      const gap = t - prev.time;
      if (gap >= CONVERSATION_GAP_MS) {
        p.starts++;
        person(prev.id).lastWords++;
        if (gap > longestSilence.ms) {
          longestSilence = { ms: gap, endedAt: m.date, brokenBy: id };
        }
      } else if (prev.id !== id) {
        p.responseSum += gap;
        p.responseN++;
      }
    } else {
      p.starts++;
    }

    if (runAuthor === id) {
      runLength++;
    } else {
      if (runAuthor !== null && runLength > person(runAuthor).monologue) {
        person(runAuthor).monologue = runLength;
      }
      runAuthor = id;
      runLength = 1;
    }

    prev = { id, time: t };
  }
  if (runAuthor !== null && runLength > person(runAuthor).monologue) {
    person(runAuthor).monologue = runLength;
  }
  // The chat's span is the chat's, excluded people included.
  const first = parsed.messages[0];
  const last = parsed.messages[parsed.messages.length - 1];
  if (!first || !last) throw new Error("no messages parsed");
  if (!P.size) throw new Error("no messages from any included person");
  /** @type {"he" | "en"} */
  const chatLang = hebrewLetters >= latinLetters ? "he" : "en";

  const people = [...P.values()].sort((a, b) => b.messages - a.messages);
  const totalMessages = people.reduce((s, p) => s + p.messages, 0);

  /* --- stats, as rankings ------------------------------------------------ */
  /** @param {(p: PersonAcc) => number} fn */
  const rank = (fn) =>
    people
      .map((p) => ({ personId: p.id, value: Number(fn(p).toFixed(2)) }))
      .filter((r) => Number.isFinite(r.value))
      .sort((a, b) => b.value - a.value);
  /** @param {(p: PersonAcc) => number} fn */
  const per100 = (fn) =>
    people
      .filter((p) => p.messages >= MIN_MESSAGES_FOR_RATE)
      .map((p) => ({ personId: p.id, value: Number(((fn(p) / p.messages) * 100).toFixed(2)) }))
      .filter((r) => Number.isFinite(r.value))
      .sort((a, b) => b.value - a.value);
  const L = S.statLabels;

  /** @type {Record<string, StatTable>} */
  const stats = {
    messages: { label: L.messages, kind: "ranking", unit: "count", ranking: rank((p) => p.messages) },
    words: { label: L.words, kind: "ranking", unit: "count", ranking: rank((p) => p.words) },
    nightMessages: { label: L.nightMessages, kind: "ranking", unit: "count", ranking: rank((p) => p.night) },
    media: { label: L.media, kind: "ranking", unit: "count", ranking: rank((p) => p.media) },
    conversationStarts: { label: L.conversationStarts, kind: "ranking", unit: "count", ranking: rank((p) => p.starts) },
    lastWord: { label: L.lastWord, kind: "ranking", unit: "count", ranking: rank((p) => p.lastWords) },
    monologue: { label: L.monologue, kind: "ranking", unit: "count", ranking: rank((p) => p.monologue) },
    longestMessage: { label: L.longestMessage, kind: "ranking", unit: "words", ranking: rank((p) => p.longest) },
    // Rate-normalised: raw counts of these correlate ~0.95 with message volume,
    // so asking them raw makes the answer "the top talker" every single time.
    emojiRate: { label: L.emojiRate, kind: "ranking", unit: "rate", ranking: per100((p) => p.emoji) },
    laughRate: { label: L.laughRate, kind: "ranking", unit: "rate", ranking: per100((p) => p.laughs) },
    questionRate: { label: L.questionRate, kind: "ranking", unit: "rate", ranking: per100((p) => p.questions) },
    exclamationRate: { label: L.exclamationRate, kind: "ranking", unit: "rate", ranking: per100((p) => p.exclamations) },
    // Share of messages containing at least one "!" - less gameable than the
    // raw count, which one "!!!!!" inflates.
    exclaimShare: { label: L.exclaimShare, kind: "ranking", unit: "percent", ranking: per100((p) => p.exclaimMsgs) },
    meanResponseSec: {
      label: L.meanResponseSec,
      kind: "ranking",
      unit: "seconds",
      note: "median is unusable: timestamps have no seconds, so it floors to 60 for nearly everyone",
      ranking: people
        .map((p) => ({ personId: p.id, value: p.responseN ? Math.round(p.responseSum / p.responseN / 1000) : Infinity }))
        .filter((r) => Number.isFinite(r.value))
        .sort((a, b) => a.value - b.value),
    },
  };

  const busiestDays = [...group.byDay.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([date, count]) => ({ date, count }));

  const topEmoji = [...group.emojiCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([emoji, n]) => ({ emoji, n }));

  const rankedMessages = rankLongest(parsed, idOf, 40);
  const funniest = scoreTurns(buildTimeline(parsed, idOf));
  const fandomTally = fandomMentions(parsed, idOf);
  const mentionTally = nameMentions(parsed, idOf, nameOfId);

  const spanDays = Math.round((last.time - first.time) / 86400000);
  const activeDays = group.byDay.size;
  const wordComparison = compareToWorks(group.totalWords, chatLang);

  return {
    chatLang,
    people,
    totalMessages,
    stats,
    group,
    busiestDays,
    topEmoji,
    longestSilence,
    rankedMessages,
    funniest,
    fandomTally,
    mentionTally,
    nameOfId,
    idOf,
    wordComparison,
    first,
    last,
    spanDays,
    activeDays,
  };
}
