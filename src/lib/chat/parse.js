/**
 * WhatsApp export text -> parsed entries.
 *
 * Handles Android and iOS exports, in English and Hebrew locales, day-first or
 * month-first. The ONLY discriminator between entries is the timestamp prefix;
 * a message body containing " - " or ": " cannot produce a false entry.
 *
 * Every hard-won detail below produced plausible-looking wrong output before
 * it was fixed. Read the sanity report (report.js) — the failures are silent.
 */

import { BIDI_RE, decodeEntities, pad2 } from "./text.js";

/* =========================================================================
 * Timestamp formats
 * ====================================================================== */

// Date: 1-2 digit fields separated by / . or -, year 2 or 4 digits.
// Time: HH:MM, optional :SS, optional AM/PM (iOS writes U+202F before it).
const DATE = "(\\d{1,2})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{2,4})";
const TIME = "(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:[ \\u202f]*([AaPp])\\.?[Mm]\\.?)?";
const SEP = ",?[ \\u202f]+";

/** Android export: `DD/MM/YYYY, HH:MM - ` (also `D.M.YYYY, HH:MM - ` in Hebrew locales, `M/D/YY, h:mm AM - ` in US ones). */
export const TS_RE = new RegExp(`^${DATE}${SEP}${TIME}[ \\u202f]+- `);
/** iOS export: `[DD/MM/YYYY, HH:MM:SS] ` (a leading U+200E is stripped first). */
export const TS_RE_IOS = new RegExp(`^\\[${DATE}${SEP}${TIME}\\]\\s*`);
/** Pre-2017 iOS export: `DD/MM/YYYY, HH:MM:SS: Name: body`. */
export const TS_RE_IOS_LEGACY = new RegExp(`^${DATE}${SEP}${TIME}: `);

/** @typedef {"android" | "ios" | "ios-legacy"} Platform */

/** @type {{ platform: Platform, re: RegExp }[]} */
const FORMATS = [
  { platform: "android", re: TS_RE },
  { platform: "ios", re: TS_RE_IOS },
  { platform: "ios-legacy", re: TS_RE_IOS_LEGACY },
];

/** A message line is `Name: body`; no system line contains ": ". */
export const NAME_RE = /^([^:\n]{1,60}?): /;

/**
 * Bodies that are placeholders, not prose. Counted as messages, not words.
 *
 * One table for every locale and platform; each entry says where it comes
 * from. An unknown placeholder is not fatal — the sanity report surfaces any
 * repeated <...>-shaped body — but it would silently be counted as prose.
 *
 * @type {{ id: "media" | "deleted" | "waiting" | "poll" | "null", re: RegExp }[]}
 */
export const PLACEHOLDERS = [
  // Android, English: "<Media omitted>", "<Video note omitted>", and whatever
  // WhatsApp adds later. A real 8-year export has the first ~4,000 times.
  { id: "media", re: /^<[^>\n]{2,40}omitted>$/i },
  // Android, Hebrew: media omitted.
  { id: "media", re: /^<המדיה לא נכללה>$/ },
  // iOS, English, export WITH media: "<attached: 00000012-PHOTO-2020-01-01-12-00-00.jpg>".
  { id: "media", re: /^<attached: .+>$/ },
  // iOS, Hebrew, export WITH media.
  { id: "media", re: /^<מצורף: .+>$/ },
  // iOS, English, export WITHOUT media: "image omitted", "video omitted",
  // "audio omitted", "sticker omitted", "GIF omitted", "document omitted",
  // "Contact card omitted", "video note omitted".
  { id: "media", re: /^(image|video|audio|sticker|document|GIF|Contact card|video note) omitted$/i },
  // iOS, Hebrew, export WITHOUT media: "תמונה הושמטה", "סרטון הושמט",
  // "הודעה קולית הושמטה", "מדבקה הושמטה", "GIF הושמט", "מסמך הושמט",
  // "כרטיס איש קשר הושמט", "הודעת וידאו הושמטה".
  { id: "media", re: /^(תמונה|סרטון|וידאו|הודעה קולית|שמע|אודיו|מדבקה|סטיקר|מסמך|GIF|כרטיס איש קשר|איש קשר|הודעת וידאו) (הושמט|הושמטה|הושמטו)$/ },
  // Android/iOS, English: "This message was deleted" (iOS adds a period),
  // "You deleted this message", "This message was deleted by admin".
  { id: "deleted", re: /^This message was deleted/ },
  { id: "deleted", re: /^You deleted this message\.?$/ },
  // Hebrew: "הודעה זו נמחקה" (current), "ההודעה הזו נמחקה" (older Android),
  // "מחקת הודעה זו" (you deleted), "הודעה זו נמחקה על ידי מנהל".
  { id: "deleted", re: /^ה?הודעה (זו|הזו) נמחקה/ },
  { id: "deleted", re: /^מחקת (את )?ה?הודעה (זו|הזו)\.?$/ },
  // "Waiting for this message. This may take a while." / Hebrew equivalents.
  { id: "waiting", re: /^Waiting for this message/ },
  { id: "waiting", re: /^(ממתין|ממתינה|מחכה|בהמתנה) להודעה/ },
  // Polls: "POLL:" then "OPTION: ..." continuation lines. The Hebrew form
  // ("סקר:" / "אפשרות:") must show an option line: "סקר:" is also how a
  // person opens a message asking the group a question, and one such message
  // in the reference export was silently swallowed before this required it.
  { id: "poll", re: /^POLL:/ },
  { id: "poll", re: /^סקר:[\s\S]*\n(אפשרות|OPTION): /u },
  // Android, export WITH media: "IMG-20240101-WA0001.jpg (file attached)",
  // Hebrew "(הקובץ מצורף)". Thousands of unique filenames in a big export,
  // which the repeated-body detector in the sanity report cannot catch.
  { id: "media", re: /^.{1,120} \((file attached|הקובץ מצורף)\)$/ },
  // A shared location: "location: https://maps.google.com/?q=..." — a link,
  // not prose.
  { id: "media", re: /^location: https?:\/\//i },
  // A literal "null" body: a WhatsApp export bug for some message types.
  { id: "null", re: /^null$/ },
];

/**
 * Edited-message marker, appended to the body: Android English
 * "<This message was edited>", Hebrew "<הודעה זו נערכה>".
 */
export const EDITED_SUFFIX = /\s*<(This message was edited|הודעה זו נערכה)>$/;

/**
 * Fragments that appear in system lines (joins, renames, ...), English and
 * Hebrew. Used ONLY to cross-check the `Name: ` classifier — the count of
 * disagreements is reported, nothing is decided by this.
 */
export const SYSTEM_RE = new RegExp(
  [
    "Messages and calls are end-to-end encrypted",
    "now secured with end-to-end encryption",
    " created group ",
    " created this group",
    " added ",
    " removed ",
    " left$",
    " joined using this group",
    " joined from the community",
    " changed the group description",
    " changed the subject ",
    " changed the group name",
    " changed this group's icon",
    " changed their phone number",
    " turned on ",
    " turned off ",
    " is now an admin",
    " no longer an admin",
    " deleted this group's icon",
    " pinned a message",
    " changed the settings",
    "You joined",
    // Hebrew
    "מוצפנות מקצה לקצה",
    "יצר[הת]? את הקבוצה",
    "הוסיפ[הת]? את ",
    "הסיר[הת]? את ",
    "יצא[הת]?$",
    "עזב[הת]?( את הקבוצה)?$",
    "הצטרפ[הת]? ",
    "שינ[הת]{1,2} את ",
    "למנהל",
    "הצמיד[הת]? הודעה",
    "מספר הטלפון",
  ].join("|"),
  "u"
);

/**
 * Bodies that are system notices even when they carry a `Name: ` prefix.
 * iOS writes the encryption notice as `[ts] Group Name: ‎Messages and calls...`,
 * which would otherwise mint a one-message person named after the group.
 */
const SYSTEM_BODY_RE =
  /^(Messages and calls are end-to-end encrypted|Messages to this (group|chat) are now secured with end-to-end encryption|ההודעות והשיחות מוצפנות מקצה לקצה|הודעות ושיחות מוצפנות מקצה לקצה)/;

/* =========================================================================
 * Entries
 * ====================================================================== */

/**
 * @typedef {object} RawEntry
 * @property {number} d
 * @property {number} mo
 * @property {number} y
 * @property {number} h
 * @property {number} mi
 * @property {number} s
 * @property {string} body
 * @property {number} lineNo
 */

/**
 * @typedef {object} ExportFormat
 * @property {Platform} platform
 * @property {"dmy" | "mdy"} dateOrder
 * @property {boolean} dateOrderCertain  false when no field ever exceeded 12 and day-first was assumed
 * @property {Record<Platform, number>} hits
 */

/**
 * Decide the format ONCE for the whole file, not per line.
 *
 * A real export is one format or the other, never a mix. Choosing per line
 * means a message whose *body* contains a pasted chat log gets mistaken for a
 * new entry — the reference export has 11 such lines, where someone pasted a
 * US-format transcript ("[9/30/2018, 10:47] ...") into the group in 2018.
 * Those tripped the day-first guard with a month field of 30.
 *
 * Day-first vs month-first is decided the same way: if any first field in the
 * file exceeds 12 the export is day-first; if any second field does, it is
 * month-first; if neither (a chat under two weeks old) day-first is assumed
 * and the report says so.
 *
 * @param {string[]} lines
 * @returns {ExportFormat}
 */
export function detectFormat(lines) {
  /** @type {Record<Platform, number>} */
  const hits = { android: 0, ios: 0, "ios-legacy": 0 };
  /** @type {Record<Platform, [number, number]>} */
  const maxFields = { android: [0, 0], ios: [0, 0], "ios-legacy": [0, 0] };
  for (const line of lines) {
    const l = line.replace(BIDI_RE, "");
    for (const f of FORMATS) {
      const m = f.re.exec(l);
      if (!m) continue;
      hits[f.platform]++;
      const mf = maxFields[f.platform];
      mf[0] = Math.max(mf[0], +m[1]);
      mf[1] = Math.max(mf[1], +m[2]);
      break;
    }
  }
  /** @type {Platform} */
  let platform = "android";
  for (const f of FORMATS) if (hits[f.platform] > hits[platform]) platform = f.platform;

  const [maxFirst, maxSecond] = maxFields[platform];
  /** @type {"dmy" | "mdy"} */
  let dateOrder = "dmy";
  let dateOrderCertain = true;
  if (maxFirst > 12) dateOrder = "dmy";
  else if (maxSecond > 12) dateOrder = "mdy";
  else dateOrderCertain = false;
  return { platform, dateOrder, dateOrderCertain, hits };
}

/**
 * Split into entries.
 *
 * Any line that does not start with THIS file's timestamp format is a
 * continuation of the previous message — about 10% of a long export, and
 * dropping them would quietly cost ~10% of every word count, concentrated on
 * whoever writes long messages.
 *
 * @param {string} text
 */
export function splitEntries(text) {
  const lines = text.split(/\r?\n/);
  const format = detectFormat(lines);
  const TS = FORMATS.find((f) => f.platform === format.platform)?.re ?? TS_RE;
  const others = FORMATS.filter((f) => f.platform !== format.platform).map((f) => f.re);

  /** @type {RawEntry[]} */
  const raw = [];
  /** @type {RawEntry | null} */
  let cur = null;
  let continuationLines = 0;
  let orphanPreamble = 0;
  let foreignFormatLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(BIDI_RE, "");
    const m = TS.exec(line);
    if (m) {
      if (cur) raw.push(cur);
      const a = +m[1];
      const b = +m[2];
      let y = +m[3];
      if (y < 100) y += 2000;
      let h = +m[4];
      const ampm = m[7];
      if (ampm) {
        h = h % 12;
        if (ampm.toLowerCase() === "p") h += 12;
      }
      cur = {
        d: format.dateOrder === "mdy" ? b : a,
        mo: format.dateOrder === "mdy" ? a : b,
        y,
        h,
        mi: +m[5],
        s: m[6] ? +m[6] : 0,
        body: line.slice(m[0].length),
        lineNo: i + 1,
      };
    } else if (cur) {
      // Anything that is not this file's timestamp format is body text,
      // including a pasted transcript in the *other* format.
      if (others.some((re) => re.test(line))) foreignFormatLines++;
      cur.body += "\n" + line;
      continuationLines++;
    } else if (line.trim() !== "") {
      orphanPreamble++;
    }
  }
  if (cur) raw.push(cur);
  return {
    raw,
    physicalLines: lines.length,
    continuationLines,
    orphanPreamble,
    format,
    foreignFormatLines,
  };
}

/**
 * @param {RawEntry} entry
 * @returns {{ kind: "message", author: string, text: string } | { kind: "system", text: string }}
 */
export function classify(entry) {
  const body = entry.body;
  const m = NAME_RE.exec(body);
  if (m) {
    const text = body.slice(m[0].length);
    if (!SYSTEM_BODY_RE.test(text)) return { kind: "message", author: m[1].trim(), text };
  }
  return { kind: "system", text: decodeEntities(body) };
}

/**
 * @param {string} text
 * @returns {PlaceholderId | null}
 */
export function placeholderOf(text) {
  for (const p of PLACEHOLDERS) if (p.re.test(text)) return p.id;
  return null;
}

/** @typedef {"media" | "deleted" | "waiting" | "poll" | "null"} PlaceholderId */

/**
 * @typedef {object} Message
 * @property {string} author   display name exactly as exported
 * @property {string} text     body with the edited marker removed
 * @property {PlaceholderId | null} placeholder
 * @property {boolean} edited
 * @property {number} time     epoch ms, local time
 * @property {string} date     `YYYY-MM-DDTHH:MM`
 * @property {string} day      `YYYY-MM-DD`
 * @property {string} year
 * @property {number} hour
 * @property {number} weekday  0 = Sunday
 */

/**
 * @typedef {object} Parsed
 * @property {RawEntry[]} raw
 * @property {Message[]} messages
 * @property {number} systemCount
 * @property {number} physicalLines
 * @property {number} continuationLines
 * @property {number} orphanPreamble
 * @property {ExportFormat} format
 * @property {number} foreignFormatLines
 * @property {number} disagreements
 * @property {number} invalidDates
 * @property {number} maxMonth
 * @property {{ text: string, n: number }[]} unknownPlaceholders
 */

/**
 * Parse a whole export.
 * @param {string} text  the decoded chat .txt
 * @returns {Parsed}
 */
export function parseChat(text) {
  const { raw, physicalLines, continuationLines, orphanPreamble, format, foreignFormatLines } = splitEntries(text);

  /** @type {Message[]} */
  const messages = [];
  let systemCount = 0;
  let disagreements = 0;
  let invalidDates = 0;
  let maxMonth = 0;
  const bodyCounts = new Map();
  const bracketShaped = new Map();

  for (const e of raw) {
    maxMonth = Math.max(maxMonth, e.mo);
    // Building from parts avoids Date's string parsing entirely —
    // new Date("30/09/2018") is Invalid, but new Date(2018, 30, 9) is *valid*
    // and silently lands in July 2021. Hence the round-trip check.
    const dt = new Date(e.y, e.mo - 1, e.d, e.h, e.mi, e.s, 0);
    if (!Number.isFinite(dt.getTime()) || dt.getMonth() !== e.mo - 1 || dt.getDate() !== e.d) {
      invalidDates++;
      continue;
    }

    const c = classify(e);
    const looksSystem = SYSTEM_RE.test(e.body);
    if (c.kind === "system") {
      systemCount++;
      if (!looksSystem) disagreements++;
      continue;
    }
    if (looksSystem && !NAME_RE.test(e.body)) disagreements++;

    let text2 = c.text;
    const edited = EDITED_SUFFIX.test(text2);
    if (edited) text2 = text2.replace(EDITED_SUFFIX, "");
    const placeholder = placeholderOf(text2);

    // Surface any unrecognised <...>-shaped body: that is what every locale's
    // media placeholder looks like, and an unknown one would silently be
    // counted as a two-word message thousands of times.
    if (!placeholder && /^<[^\n>]{2,60}>$/.test(text2.trim())) {
      bracketShaped.set(text2.trim(), (bracketShaped.get(text2.trim()) ?? 0) + 1);
    }
    if (!placeholder) bodyCounts.set(text2, (bodyCounts.get(text2) ?? 0) + 1);

    messages.push({
      author: c.author,
      text: text2,
      placeholder,
      edited,
      time: dt.getTime(),
      date: `${e.y}-${pad2(e.mo)}-${pad2(e.d)}T${pad2(e.h)}:${pad2(e.mi)}`,
      day: `${e.y}-${pad2(e.mo)}-${pad2(e.d)}`,
      year: String(e.y),
      hour: e.h,
      weekday: dt.getDay(),
    });
  }

  const unknownPlaceholders = [...bracketShaped.entries()].map(([text, n]) => ({ text, n }));
  // A frequently repeated body is only suspicious if it *looks* like a
  // placeholder. Real people send "כן" and "😂😂" thousands of times, and
  // flagging those would make this check cry wolf and get ignored — which is
  // exactly when it would matter.
  const PLACEHOLDER_SHAPED = /^[<‎]|omitted|deleted|נמחקה|לא נכללה|הושמט/i;
  for (const [text, n] of bodyCounts) {
    const t = text.trim();
    if (n > 300 && t.length < 60 && PLACEHOLDER_SHAPED.test(t) && !unknownPlaceholders.some((u) => u.text === t)) {
      unknownPlaceholders.push({ text: t.slice(0, 40), n });
    }
  }

  return {
    raw,
    messages,
    systemCount,
    physicalLines,
    continuationLines,
    orphanPreamble,
    format,
    foreignFormatLines,
    disagreements,
    invalidDates,
    maxMonth,
    unknownPlaceholders: unknownPlaceholders.sort((a, b) => b.n - a.n).slice(0, 10),
  };
}

/**
 * Hard stops and warnings a caller should show before doing anything else.
 * A fatal problem means the numbers would be plausible-looking nonsense.
 *
 * @param {Parsed} parsed
 * @returns {{ fatal: string[], warnings: string[] }}
 */
export function parseProblems(parsed) {
  const fatal = [];
  const warnings = [];
  if (parsed.maxMonth > 12) {
    fatal.push(`month field reaches ${parsed.maxMonth} — the date order was misdetected. Aborting.`);
  }
  if (!parsed.messages.length) {
    fatal.push("no messages parsed. The timestamp format does not match any known WhatsApp export.");
  }
  if (parsed.continuationLines === 0 && parsed.messages.length > 50) {
    warnings.push("zero continuation lines — multi-line buffering may not be engaging.");
  }
  if (!parsed.format.dateOrderCertain) {
    warnings.push("no date field ever exceeded 12 — assumed day-first (DD/MM). Check the first/last dates.");
  }
  if (parsed.invalidDates) {
    warnings.push(`${parsed.invalidDates} entries had impossible dates and were dropped.`);
  }
  if (parsed.unknownPlaceholders.length) {
    warnings.push(
      `unrecognised placeholder-like bodies: ${parsed.unknownPlaceholders.map((u) => `"${u.text}" x${u.n}`).join(", ")}`
    );
  }
  return { fatal, warnings };
}
