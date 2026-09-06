/**
 * Roster: display names -> people.
 *
 * Eight years of WhatsApp produces more display names than there are people
 * (renames, aliases), and guessing which are the same human would silently
 * corrupt every per-person statistic. So the library SUGGESTS a roster and a
 * human decides — in the CLI by editing tools/private/names.json, in the
 * browser on the roster screen. `resolveRoster` then turns the decided list
 * into lookups the statistics use.
 */

import { BIDI_RE } from "./text.js";

/**
 * @typedef {object} RosterPerson
 * @property {string} raw          display name exactly as exported
 * @property {string} canonical    the person's name; aliases share one canonical
 * @property {string} id           stable id; the highest-count alias's id wins for the group
 * @property {boolean | null} include  null = undecided (a suggestion only)
 * @property {number} messages
 * @property {string} firstSeen    YYYY-MM-DD
 * @property {string} lastSeen     YYYY-MM-DD
 * @property {[number, number, number]} sampleLengths  10th/50th/90th percentile message length
 */

/**
 * @typedef {object} ResolvedRoster
 * @property {Map<string, RosterPerson>} byRaw
 * @property {Map<string, string>} canonById  canonical name -> id
 * @property {Map<string, { canonical: string, id: string, messages: number }>} groups  keyed by canonical
 */

/**
 * URL-safe id from a display name; falls back to p1, p2, ... for Hebrew names.
 * @param {string} name
 * @param {Set<string>} taken
 */
export function slugify(name, taken) {
  const translit = name
    .replace(BIDI_RE, "")
    .replace(/[\p{Extended_Pictographic}]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]+/g, "-")
    .replace(/^-|-$/g, "");
  let base = /^[a-z0-9-]+$/.test(translit) && translit ? translit : "p";
  if (base === "p" || !base) base = "p" + (taken.size + 1);
  let id = base.slice(0, 24);
  let n = 2;
  while (taken.has(id)) id = `${base.slice(0, 20)}-${n++}`;
  taken.add(id);
  return id;
}

/** Normalised key for duplicate suggestions: letters only, no emoji or marks. */
export function normKey(name) {
  return name
    .replace(BIDI_RE, "")
    .replace(/[\p{Extended_Pictographic}]/gu, "")
    .replace(/[^\p{Letter}\p{Number}]/gu, "")
    .toLowerCase();
}

/**
 * @param {string} a
 * @param {string} b
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur.slice();
  }
  return prev[n];
}

/**
 * Suggest a roster from the parsed messages, one row per distinct display
 * name, most messages first. Names with 10+ messages are pre-included; the
 * rest are left undecided. Rows in `previous` (an earlier, hand-edited
 * roster) keep their canonical/id/include, matched on `raw`.
 *
 * @param {import("./parse.js").Parsed} parsed
 * @param {RosterPerson[]} [previous]
 * @returns {RosterPerson[]}
 */
export function suggestRoster(parsed, previous = []) {
  const byName = new Map();
  for (const msg of parsed.messages) {
    let rec = byName.get(msg.author);
    if (!rec) {
      byName.set(msg.author, (rec = { raw: msg.author, messages: 0, first: msg.date, last: msg.date, lens: [] }));
    }
    rec.messages++;
    rec.last = msg.date;
    if (rec.lens.length < 5000) rec.lens.push(msg.text.length);
  }
  const sorted = [...byName.values()].sort((a, b) => b.messages - a.messages);

  const existing = new Map();
  for (const p of previous) existing.set(p.raw, p);

  const taken = new Set();
  return sorted.map((rec) => {
    const prev = existing.get(rec.raw);
    const sortedLens = rec.lens.slice().sort((a, b) => a - b);
    const pct = (n) => sortedLens[Math.floor(sortedLens.length * n)] ?? 0;
    return {
      raw: rec.raw,
      canonical: prev?.canonical ?? rec.raw,
      id: prev?.id ?? slugify(rec.raw, taken),
      include: prev ? prev.include : rec.messages >= 10 ? true : null,
      messages: rec.messages,
      firstSeen: rec.first.slice(0, 10),
      lastSeen: rec.last.slice(0, 10),
      sampleLengths: [pct(0.1), pct(0.5), pct(0.9)],
    };
  });
}

/**
 * "These two look like the same person" pairs, by normalised edit distance.
 * Never applied automatically — a suggestion for a human.
 *
 * @param {RosterPerson[]} people
 * @returns {{ a: string, b: string, dist: number }[]}
 */
export function aliasSuggestions(people) {
  const out = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      if (a.messages > 2000 && b.messages > 2000) continue; // both prolific: distinct people
      const ka = normKey(a.raw);
      const kb = normKey(b.raw);
      if (!ka || !kb) continue;
      const dist = levenshtein(ka, kb) / Math.max(ka.length, kb.length);
      if (dist <= 0.35) out.push({ a: a.raw, b: b.raw, dist: Number(dist.toFixed(2)) });
    }
  }
  return out;
}

/**
 * Why a roster cannot be used yet. Empty means it can.
 * @param {RosterPerson[]} people
 * @returns {string[]}
 */
export function rosterProblems(people) {
  const problems = [];
  for (const p of people) {
    if (p.include === null || p.include === undefined) {
      problems.push(`"${p.raw}" still has include:null — decide include true/false for every name.`);
    } else if (p.include && !String(p.canonical ?? "").trim()) {
      problems.push(`"${p.raw}" is included but has an empty canonical.`);
    }
  }
  return problems;
}

/**
 * Turn a decided roster into lookups. Aliases are grouped by canonical; the
 * highest-count member supplies the group's id.
 *
 * @param {RosterPerson[]} people
 * @param {{ expect?: number }} [opts]  expect: assert this many resolved people (0 = don't)
 * @returns {ResolvedRoster}
 */
export function resolveRoster(people, { expect = 0 } = {}) {
  const problems = rosterProblems(people);
  if (problems.length) throw new Error(problems[0]);

  const byRaw = new Map();
  for (const p of people) byRaw.set(p.raw, p);

  const groups = new Map();
  for (const p of byRaw.values()) {
    if (!p.include) continue;
    const key = p.canonical;
    const g = groups.get(key) ?? { canonical: key, id: p.id, messages: 0 };
    if (p.messages > g.messages) {
      g.id = p.id;
      g.messages = p.messages;
    }
    groups.set(key, g);
  }
  const canonById = new Map();
  for (const g of groups.values()) canonById.set(g.canonical, g.id);

  if (expect && groups.size !== expect) {
    throw new Error(
      `roster resolves to ${groups.size} people, expected ${expect}.\n` +
        `  Merge aliases (same canonical) or set include:false, then re-run.\n` +
        `  Currently included: ${[...groups.keys()].join(", ")}`
    );
  }
  return { byRaw, canonById, groups };
}

/**
 * Display names present in the messages but absent from the roster. A stale
 * roster would otherwise silently drop a person after a fresh export.
 *
 * @param {import("./parse.js").Parsed} parsed
 * @param {ResolvedRoster} roster
 * @returns {string[]}
 */
export function unknownAuthors(parsed, roster) {
  const unknown = new Set();
  for (const m of parsed.messages) if (!roster.byRaw.has(m.author)) unknown.add(m.author);
  return [...unknown];
}

/**
 * `author -> person id`, or null for excluded/unknown names.
 * @param {ResolvedRoster} roster
 * @returns {(author: string) => string | null}
 */
export function idResolver(roster) {
  return (author) => {
    const p = roster.byRaw.get(author);
    if (!p || !p.include) return null;
    return roster.canonById.get(p.canonical) ?? null;
  };
}

/**
 * `person id -> canonical name`.
 * @param {ResolvedRoster} roster
 * @returns {Map<string, string>}
 */
export function namesById(roster) {
  const nameOfId = new Map();
  for (const [canonical, id] of roster.canonById) nameOfId.set(id, canonical);
  return nameOfId;
}
