/**
 * WhatsApp export analyser — the Node command line. Zero dependencies.
 *
 *   node tools/chat-analyze.mjs roster   --in "<path to .zip or .txt>" [--names <roster.json>]
 *   node tools/chat-analyze.mjs build    --in "<path>" [--expect-people 14] [--out <file>] [--lang he|en] [--no-excerpts] [--names <roster.json>]
 *   node tools/chat-analyze.mjs longest  --in "<path>" [--top 12]
 *   node tools/chat-analyze.mjs funniest --in "<path>" [--top 15] [--full <rank>]
 *   node tools/chat-analyze.mjs fandom   --in "<path>"
 *   node tools/chat-analyze.mjs mentions --in "<path>"
 *
 * All the parsing, statistics and question generation live in
 * src/lib/chat/ (environment-free, shared with the browser). This file is the
 * thin Node adapter: file IO, zlib, the repo-location guard, the private
 * intermediates in tools/private/, and the console.
 *
 * PRIVACY IS THE POINT. The raw export never leaves this machine: this script
 * reads it in place, and the only thing it writes into the repo is
 * tools/private/chat-stats.json, which contains counts and names and — by the
 * host's explicit choice, on by default here — two short excerpts (see
 * `excerpts` in src/lib/chat/index.js). Everything intermediate lands in
 * tools/private/, which is gitignored. The script refuses to run if the export
 * is inside the repo working tree.
 *
 * Two passes, because 8 years of WhatsApp produces more display names than
 * there are people (renames, aliases), and guessing which are the same human
 * would silently corrupt every per-person statistic. Pass 1 emits a roster for
 * a human to edit; pass 2 consumes it.
 *
 * Read the sanity report it prints. A parser that mis-reads this file produces
 * output that looks entirely reasonable, so the report is the only defence.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeExport,
  parseChat,
  parseProblems,
  rosterSuggestions,
  analyzeParsed,
  formatReport,
  resolveRoster,
  idResolver,
  namesById,
  buildTimeline,
  scoreTurns,
  rankLongest,
  fandomMentions,
  nameMentions,
  FANDOMS,
  firstWords,
  formatDay,
} from "../src/lib/chat/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = join(ROOT, "tools", "private");
/** Roster file; `--names <file>` points at another one (a second chat, a test). */
let NAMES_FILE = join(PRIVATE, "names.json");
const REVIEW_FILE = join(PRIVATE, "questions-review.json");
const REPORT_FILE = join(PRIVATE, "parse-report.txt");
const OUT_FILE = join(PRIVATE, "chat-stats.json");

/* =========================================================================
 * Knobs for THIS group's chat. Generic defaults live in the library.
 * ====================================================================== */

/**
 * Which entry in the longest-message ranking the quiz should point at.
 *
 * Rank 1 in this chat is a 2,795-word article somebody pasted in - four and a
 * half times longer than anything a person actually typed, which is the tell.
 * Rank 7 is the first one that is unmistakably original: a story about two
 * members' wedding. Run `node tools/chat-analyze.mjs longest --in <export>` to
 * see the list and re-pick.
 */
const LONGEST_MESSAGE_RANK = 7;

/**
 * Which entry in the funniest-message ranking the quiz points at. Same idea:
 * run `node tools/chat-analyze.mjs funniest --in <export>` to see the list,
 * then re-pick if rank 1 is a fluke.
 */
const FUNNIEST_RANK = 1;

/**
 * Hand-written context for specific dates. The count is the question; the
 * story is the payoff, and only a human knows it.
 */
const DAY_NOTES = {
  "2019-07-13": {
    he: "באותו יום אדר ואפרת החליפו טלפונים וכתבו הודעות בשם אחד השני — אף אחד לא הבין מה קורה, ובדיעבד זה היה מצחיק.",
    en: "That day Adar and Efrat swapped phones and wrote messages as each other — nobody understood what was going on, and in hindsight it was hilarious.",
  },
};

/* =========================================================================
 * Roster file
 * ====================================================================== */

function readNamesFile() {
  if (!existsSync(NAMES_FILE)) return null;
  try {
    return JSON.parse(readFileSync(NAMES_FILE, "utf8"));
  } catch {
    return null;
  }
}

function loadRosterPeople() {
  const data = readNamesFile();
  if (!data) {
    throw new Error(
      `no roster yet.\n  Run:  npm run roster -- --in "<path to export>"\n  then hand-edit ${relative(ROOT, NAMES_FILE)}`
    );
  }
  return data.people ?? [];
}

/** Resolved roster plus the two lookups every inspection command wants. */
function loadRoster(expect = 0) {
  const roster = resolveRoster(loadRosterPeople(), { expect });
  return { roster, idOf: idResolver(roster), nameOfId: namesById(roster) };
}

/* =========================================================================
 * Pass 1: roster
 * ====================================================================== */

function doRoster(parsed, argv) {
  const prev = readNamesFile();
  if (existsSync(NAMES_FILE) && !prev) console.log("  (existing names.json unreadable — starting fresh)");
  const { people, aliases } = rosterSuggestions(parsed, prev?.people ?? []);

  mkdirSync(PRIVATE, { recursive: true });
  writeFileSync(
    NAMES_FILE,
    JSON.stringify(
      {
        _comment:
          "Hand-edit `canonical` and `include`. Aliases of one person share the same `canonical`. " +
          "include:false drops that name from all per-person stats. Re-running `roster` preserves your edits (matched on `raw`).",
        _generatedAt: new Date().toISOString(),
        _totalMessages: parsed.messages.length,
        people,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\n  wrote ${relative(ROOT, NAMES_FILE)} — ${people.length} distinct display names\n`);
  console.log("  name                                          messages   include");
  console.log("  " + "-".repeat(70));
  for (const p of people) {
    const nm = p.raw.length > 42 ? p.raw.slice(0, 41) + "…" : p.raw;
    console.log("  " + nm.padEnd(44) + String(p.messages).padStart(8) + "   " + (p.include === null ? "?" : p.include));
  }

  if (aliases.length) {
    console.log("\n  possible aliases (NOT applied — decide yourself):");
    for (const s of aliases) console.log(`    "${s.a}"  ~  "${s.b}"   (distance ${s.dist.toFixed(2)})`);
  }

  console.log(
    `\n  next: edit ${relative(ROOT, NAMES_FILE)} set include for every name,\n` +
      "        with aliases sharing one `canonical`, then run:\n" +
      `        npm run stats -- --in "${argv.in}"\n`
  );
}

/* =========================================================================
 * Pass 2: build
 * ====================================================================== */

function doBuild(parsed, argv) {
  // No default head-count assertion: not everyone on the trip is in the
  // chat, so a smaller roster is a legitimate answer. Pass --expect-people N
  // to assert a specific count.
  const expectPeople = argv["expect-people"] ? Number(argv["expect-people"]) : 0;
  const lang = argv.lang === "en" ? "en" : "he";
  const outFile = argv.out ? (isAbsolute(argv.out) ? argv.out : resolve(process.cwd(), argv.out)) : OUT_FILE;

  const { stats, report, suppressed } = analyzeParsed(parsed, {
    lang,
    roster: loadRosterPeople(),
    // The CLI is run by the host, on the host's machine, for the host's own
    // group: excerpts on unless told otherwise.
    excerpts: !argv["no-excerpts"],
    longestRank: LONGEST_MESSAGE_RANK,
    funniestRank: FUNNIEST_RANK,
    dayNotes: DAY_NOTES,
    expectPeople,
  });

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(stats, null, 2), "utf8");
  mkdirSync(PRIVATE, { recursive: true });
  writeFileSync(
    REVIEW_FILE,
    JSON.stringify(
      { _comment: "Read these, edit, and paste any you like into the quiz via the settings screen.", questions: [] },
      null,
      2
    ),
    "utf8"
  );
  const text = formatReport(report);
  writeFileSync(REPORT_FILE, text, "utf8");

  console.log("\n" + text);
  void suppressed;
  console.log(`\n  wrote ${relative(ROOT, outFile) || outFile}  (${(JSON.stringify(stats).length / 1024).toFixed(0)} KB)`);
  console.log(`  wrote ${relative(ROOT, REVIEW_FILE)}`);
  console.log(`  wrote ${relative(ROOT, REPORT_FILE)}`);
  if (outFile === OUT_FILE) console.log(`\n  Set built:true for the quiz in src/config.ts when you are happy with it.\n`);
}

/* =========================================================================
 * `fandom` - who talks about which universe
 * ====================================================================== */

function doFandom(parsed) {
  const { idOf, nameOfId } = loadRoster();
  const tallies = fandomMentions(parsed, idOf, { samples: 3 });

  console.log("\n  Fandom mentions across the whole chat\n");
  const ordered = FANDOMS.slice().sort((a, b) => (tallies.get(b.key)?.total ?? 0) - (tallies.get(a.key)?.total ?? 0));
  for (const f of ordered) {
    const t = tallies.get(f.key);
    const total = t?.total ?? 0;
    console.log(`  ${f.he.padEnd(16)} ${String(total).padStart(5)} mentions`);
    if (!t) continue;
    const pp = [...t.perPerson.entries()].sort((a, b) => b[1] - a[1]);
    const top = pp.slice(0, 4).map(([id, n]) => `${nameOfId.get(id) ?? "?"} ${n}`).join("  ·  ");
    console.log(`  ${" ".repeat(16)} ${top}`);
    const gap = pp.length > 1 && pp[1][1] > 0 ? (pp[0][1] / pp[1][1]).toFixed(2) : "-";
    console.log(`  ${" ".repeat(16)} leader gap ${gap}x   distinct people: ${pp.length}`);
    for (const sm of t.samples) console.log(`  ${" ".repeat(16)} "${sm}"`);
    console.log("");
  }
  console.log("  A fandom needs a decent total (minTotal in FANDOMS, default 15), four");
  console.log("  people, and a leader gap above 1.15x to become a question.\n");
}

/* =========================================================================
 * `mentions` - who gets talked about
 *
 * Counts each person's name in OTHER people's messages. Several names may be
 * ordinary Hebrew words, so the report separates the safe names from the ones
 * whose counts are mostly noise instead of quietly averaging them together.
 * ====================================================================== */

function doMentions(parsed) {
  const { idOf, nameOfId } = loadRoster();
  const tallies = nameMentions(parsed, idOf, nameOfId, { samples: 3, includeAmbiguous: true });
  const rows = [...tallies.entries()].map(([id, t]) => ({ id, ...t })).sort((a, b) => b.total - a.total);

  const show = (list, title) => {
    console.log(`\n  ${title}\n`);
    console.log("  mentions  name       mentioned most by");
    console.log("  " + "-".repeat(70));
    for (const r of list) {
      const w = [...r.perPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const who = w.map(([id, n]) => `${nameOfId.get(id) ?? "?"} ${n}`).join(", ");
      console.log(`  ${String(r.total).padStart(8)}  ${r.name.padEnd(9)}  ${who}`);
      for (const sm of r.samples) console.log(`            "${sm}"`);
    }
  };

  show(rows.filter((r) => !r.ambiguous), "SAFE names (distinctive, counts are trustworthy)");

  // The inverse question has no ambiguity problem at all: count only how often
  // each person mentions the SAFE names. The targets are unambiguous, so the
  // ranking is clean even though "who gets mentioned most" is not.
  const talkers = new Map();
  for (const r of rows) {
    if (r.ambiguous) continue;
    for (const [author, n] of r.perPerson) talkers.set(author, (talkers.get(author) ?? 0) + n);
  }
  const talkerRows = [...talkers.entries()].sort((a, b) => b[1] - a[1]);
  console.log("\n  WHO TALKS ABOUT OTHERS MOST (safe-name targets only - clean metric)\n");
  console.log("  mentions  name       per 100 of their own messages");
  console.log("  " + "-".repeat(70));
  const msgCount = new Map();
  for (const m of parsed.messages) {
    const id = idOf(m.author);
    if (id !== null) msgCount.set(id, (msgCount.get(id) ?? 0) + 1);
  }
  for (const [id, n] of talkerRows) {
    const own = msgCount.get(id) ?? 0;
    const rate = own ? ((n / own) * 100).toFixed(2) : "-";
    console.log(
      `  ${String(n).padStart(8)}  ${(nameOfId.get(id) ?? "?").padEnd(9)}  ${String(rate).padStart(6)}   (${own.toLocaleString("en-US")} messages)`
    );
  }
  if (talkerRows.length > 1) console.log(`\n  leader gap ${(talkerRows[0][1] / talkerRows[1][1]).toFixed(2)}x`);

  console.log("\n  AMBIGUOUS names - these are ordinary Hebrew words, so the counts");
  console.log("  below are inflated by unrelated usage. Do not build a question on");
  console.log("  them without reading the samples.\n");
  console.log("  mentions  name       also means");
  console.log("  " + "-".repeat(70));
  for (const r of rows.filter((r) => r.ambiguous)) {
    console.log(`  ${String(r.total).padStart(8)}  ${r.name.padEnd(9)}  ${r.ambiguous}`);
    for (const sm of r.samples) console.log(`            "${sm}"`);
  }
  console.log("");
}

/* =========================================================================
 * `funniest` - inspect the biggest laughs by eye
 *
 * The metric is a heuristic, so rank 1 may be a fluke or an in-joke that needs
 * context. This prints the top candidates. Console only.
 * ====================================================================== */

function doFunniest(parsed, argv) {
  const top = Number(argv.top ?? 15);
  const { idOf, nameOfId } = loadRoster();
  const out = scoreTurns(buildTimeline(parsed, idOf));
  const order = parsed.format.dateOrder;

  console.log(`\n  Top ${top} biggest laughs (of ${out.length} candidates)\n`);
  console.log("  rank  laughed  signal  date         who");
  console.log("  " + "-".repeat(74));
  out.slice(0, top).forEach((m, i) => {
    console.log(
      `  ${String(i + 1).padStart(4)}  ${String(m.laughers).padStart(7)}  ${String(m.tokens).padStart(6)}  ` +
        `${formatDay(m.date, order)}   ${(nameOfId.get(m.id) ?? "?").slice(0, 14)}`
    );
    console.log(`        "${firstWords(m.text, 20, 160)}"`);
    console.log("");
  });
  console.log("  Set FUNNIEST_RANK near the top of this file, then re-run `npm run stats`.\n");
  if (argv.full) {
    const pick = out[Number(argv.full) - 1];
    if (pick) {
      console.log(`\n  --- full text of rank ${argv.full} (${pick.messageCount} messages, ${pick.words} words) ---\n`);
      console.log(pick.fullText.split("\n").map((l) => "  " + l).join("\n"));
      console.log("");
    }
  }
}

/* =========================================================================
 * `longest` - inspect the longest messages by eye
 *
 * The single longest message in a chat this old is very often a forwarded
 * article rather than something a person actually wrote, which makes it a poor
 * quiz answer. This prints the top candidates with their opening words so a
 * human can pick a genuine one. Console only - it writes nothing.
 * ====================================================================== */

function doLongest(parsed, argv) {
  const top = Number(argv.top ?? 12);
  const { idOf, nameOfId } = loadRoster();
  const scored = rankLongest(parsed, idOf, 40);
  const order = parsed.format.dateOrder;

  console.log(`\n  Top ${top} longest messages (of ${scored.length} over 40 words)\n`);
  console.log("  rank   words  date         who");
  console.log("  " + "-".repeat(72));
  scored.slice(0, top).forEach((m, i) => {
    const who = (nameOfId.get(m.id) ?? "?").slice(0, 14);
    console.log(`  ${String(i + 1).padStart(4)}  ${String(m.words).padStart(6)}  ${formatDay(m.date, order)}   ${who}`);
    console.log(`         "${firstWords(m.text, 18, 150)}"`);
    console.log("");
  });
  console.log(
    "  A forwarded article usually opens like a headline and runs to thousands of\n" +
      "  words. Pick a rank that reads like a person talking, then set\n" +
      "  LONGEST_MESSAGE_RANK near the top of this file and re-run `npm run stats`.\n"
  );
}

/* =========================================================================
 * Driver
 * ====================================================================== */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(argv[i]);
  }
  return out;
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const cmd = argv._[0];
  if (!cmd || !["roster", "build", "longest", "funniest", "fandom", "mentions"].includes(cmd)) {
    console.log(
      "usage:\n" +
        '  node tools/chat-analyze.mjs roster   --in "<export .zip or .txt>"\n' +
        '  node tools/chat-analyze.mjs build    --in "<export .zip or .txt>" [--expect-people 14] [--out <file>] [--lang he|en] [--no-excerpts]\n' +
        '  node tools/chat-analyze.mjs longest  --in "<export .zip or .txt>" [--top 12]\n' +
        '  node tools/chat-analyze.mjs funniest --in "<export .zip or .txt>" [--top 15] [--full <rank>]\n' +
        '  node tools/chat-analyze.mjs fandom   --in "<export .zip or .txt>"\n' +
        '  node tools/chat-analyze.mjs mentions --in "<export .zip or .txt>"\n'
    );
    process.exit(1);
  }
  if (!argv.in) {
    console.error("error: --in <path to the WhatsApp export> is required");
    process.exit(1);
  }
  if (typeof argv.names === "string") {
    NAMES_FILE = isAbsolute(argv.names) ? argv.names : resolve(process.cwd(), argv.names);
  }

  const inPath = isAbsolute(argv.in) ? argv.in : resolve(process.cwd(), argv.in);
  // Structural guard against ever committing 11 MB of the group's history.
  const rel = relative(ROOT, inPath);
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    console.error(
      `error: the export is inside the repo (${rel}).\n` + "       Keep it outside the working tree — it must never be committed."
    );
    process.exit(1);
  }
  if (!existsSync(inPath)) {
    console.error(`error: no such file: ${inPath}`);
    process.exit(1);
  }

  console.log(`\n  reading ${inPath}`);
  const decoded = await decodeExport(new Uint8Array(readFileSync(inPath)), inflateRawSync);
  if (decoded.entryName) {
    console.log(`  reading "${decoded.entryName}" from the zip (${decoded.bytes.toLocaleString("en-US")} bytes uncompressed)`);
  }
  console.log(`  decoded ${decoded.text.length.toLocaleString("en-US")} characters`);
  const parsed = parseChat(decoded.text);
  console.log(`  format: ${parsed.format.platform}, ${parsed.format.dateOrder === "mdy" ? "month-first" : "day-first"}`);

  // Hard stops: these mean the parse is wrong in a way that would otherwise
  // produce perfectly plausible-looking nonsense.
  const problems = parseProblems(parsed);
  for (const w of problems.warnings) console.error(`\nWARNING: ${w}`);
  if (problems.fatal.length) {
    for (const f of problems.fatal) console.error(`\nFATAL: ${f}`);
    process.exit(2);
  }

  try {
    if (cmd === "roster") doRoster(parsed, argv);
    else if (cmd === "longest") doLongest(parsed, argv);
    else if (cmd === "funniest") doFunniest(parsed, argv);
    else if (cmd === "fandom") doFandom(parsed);
    else if (cmd === "mentions") doMentions(parsed);
    else doBuild(parsed, argv);
  } catch (err) {
    console.error("\nerror: " + err.message + "\n");
    process.exit(1);
  }
}

main();
