/**
 * The sanity report — the only defence against a silently wrong parse.
 *
 * A parser that mis-reads an export produces output that looks entirely
 * reasonable, so every check here exists because that exact failure happened.
 * `buildReport` returns structured data (a screen can render it); `formatReport`
 * renders the same data as text (the CLI prints it).
 */

import { fmtInt } from "./text.js";

/**
 * @typedef {object} ReportRow
 * @property {string} text
 * @property {boolean | null} ok  null = informational
 */

/**
 * @typedef {object} ReportSection
 * @property {string} key
 * @property {string} title
 * @property {ReportRow[]} rows
 */

/**
 * @typedef {object} ReportData
 * @property {ReportSection[]} sections
 * @property {string[]} warnings   every failed check, in one list
 * @property {boolean} ok          no failed checks
 */

/**
 * @param {object} args
 * @param {import("./parse.js").Parsed} args.parsed
 * @param {any} args.out                 the ChatStats object being emitted
 * @param {import("./stats.js").StatsBundle} args.bundle
 * @param {string[]} args.suppressed
 * @param {import("./roster.js").ResolvedRoster} args.roster
 * @returns {ReportData}
 */
export function buildReport({ parsed, out, bundle, suppressed, roster }) {
  /** @type {ReportSection[]} */
  const sections = [];
  const section = (key, title) => {
    /** @type {ReportSection} */
    const s = { key, title, rows: [] };
    sections.push(s);
    /** @param {string} text @param {boolean | null} [ok] */
    return (text, ok = null) => s.rows.push({ text, ok });
  };

  const f = parsed.format;
  const fmt = section("format", "format");
  fmt(
    `${f.platform} · ${f.dateOrder === "mdy" ? "month-first (MM/DD)" : "day-first (DD/MM)"}${
      f.dateOrderCertain ? "" : " (assumed — no field ever exceeded 12)"
    }`,
    f.dateOrderCertain
  );
  fmt(
    `timestamp hits: android ${fmtInt(f.hits.android)} · ios ${fmtInt(f.hits.ios)} · ios-legacy ${fmtInt(f.hits["ios-legacy"])}` +
      (parsed.foreignFormatLines ? ` · ${parsed.foreignFormatLines} body lines in another format (pasted transcripts)` : "")
  );

  const sum = parsed.raw.length + parsed.continuationLines;
  const lines = section("lines", "lines");
  lines(
    `${fmtInt(parsed.physicalLines)} physical = ${fmtInt(parsed.raw.length)} timestamped + ${fmtInt(parsed.continuationLines)} continuation`,
    sum === parsed.physicalLines || sum === parsed.physicalLines - 1
  );
  lines(
    `continuation share: ${((parsed.continuationLines / Math.max(1, parsed.physicalLines)) * 100).toFixed(1)}%`,
    parsed.continuationLines > 0 || parsed.messages.length < 50
  );
  lines(`orphan preamble lines: ${parsed.orphanPreamble}`, parsed.orphanPreamble === 0);

  const dates = section("dates", "dates");
  dates(`${out.source.firstMessage} .. ${out.source.lastMessage}   span ${fmtInt(out.source.spanDays)} d`);
  dates(
    `invalid: ${parsed.invalidDates}   max month field: ${parsed.maxMonth}`,
    parsed.invalidDates === 0 && parsed.maxMonth <= 12
  );
  dates(`active ${fmtInt(out.source.activeDays)} d · silent ${fmtInt(out.source.silentDays)} d`);

  const entries = section("entries", "entries");
  entries(`${fmtInt(out.source.messages)} messages + ${out.source.systemEvents} system events`);
  entries(
    `media ${fmtInt(out.group.mediaMessages)} | deleted ${out.group.deletedMessages} | edited ${out.group.editedMessages} | polls ${out.group.polls}`
  );
  entries(
    `unknown <...>-shaped placeholders: ${
      parsed.unknownPlaceholders.length ? parsed.unknownPlaceholders.map((u) => `${u.text} x${u.n}`).join(", ") : "(none)"
    }`,
    parsed.unknownPlaceholders.length === 0
  );
  entries(`classifier disagreements: ${parsed.disagreements}`, parsed.disagreements < 20);

  const ro = section("roster", "roster");
  ro(`${roster.byRaw.size} raw names -> ${roster.groups.size} people`);
  for (const p of bundle.people.slice(0, 5)) {
    ro(`${p.name.slice(0, 30).padEnd(32)} ${fmtInt(p.messages).padStart(8)}`);
  }
  if (bundle.people.length > 5) {
    const tail = bundle.people[bundle.people.length - 1];
    ro(`... tail: ${tail.name.slice(0, 30)} ${fmtInt(tail.messages)}   <- verify this is a real person`);
  }

  const content = section("content", "content");
  content(`${fmtInt(out.group.totalWords)} words | ${fmtInt(out.group.totalEmoji)} emoji`);
  // A long-running chat without a single 100-word message means the parser is
  // splitting messages; a chat of a few hundred messages may simply not have one.
  content(
    `longest message ${fmtInt(out.group.longestMessage?.words ?? 0)} words`,
    (out.group.longestMessage?.words ?? 0) > 100 || parsed.messages.length < 2000
  );
  content(`top emoji: ${bundle.topEmoji.slice(0, 6).map((e) => `${e.emoji} ${fmtInt(e.n)}`).join("  ")}`);
  const shredded = bundle.topEmoji
    .slice(0, 20)
    .some((e) => /[\u{1F3FB}-\u{1F3FF}♀♂️]/u.test(e.emoji) && [...e.emoji].length === 1);
  content(`grapheme segmentation: ${shredded ? "BROKEN — modifiers appearing as emoji" : "OK"}`, !shredded);

  const cmp = section("comparison", "comparison");
  cmp(`${out.wordComparison.torahMultiple}x the Torah · nearest: ${out.wordComparison.nearest.he} / ${out.wordComparison.nearest.en} (${out.wordComparison.nearest.ratio})`);
  cmp(`chat language detected: ${bundle.chatLang}`);

  const qs = section("questions", "questions");
  qs(`${out.questions.length} emitted`);
  for (const s of suppressed) qs(`suppressed: ${s}`);

  const warnings = [];
  for (const s of sections) for (const r of s.rows) if (r.ok === false) warnings.push(`${s.title}: ${r.text}`);
  return { sections, warnings, ok: warnings.length === 0 };
}

/**
 * Render the report as the fixed-width text the CLI prints.
 * @param {ReportData} data
 */
export function formatReport(data) {
  const L = [];
  const mark = (ok) => (ok === null ? "" : ok ? "   OK" : "   *** CHECK ***");
  L.push("=== WhatsApp export parse report " + "=".repeat(36));
  L.push("");
  for (const s of data.sections) {
    s.rows.forEach((r, i) => {
      L.push(`${(i === 0 ? s.title : "").padEnd(14)}${r.text}${mark(r.ok)}`);
    });
    L.push("");
  }
  L.push("=".repeat(70));
  return L.join("\n");
}
