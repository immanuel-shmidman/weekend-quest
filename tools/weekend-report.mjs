/**
 * Turn a finished event's log into a keepsake: a full text report plus SVG
 * summary cards, one overall and one per person.
 *
 *   node tools/weekend-report.mjs --in tools/private/weekend-export.json
 *
 * Zero dependencies, same as every other tool here. SVG rather than PNG because
 * these are almost entirely Hebrew text, and hand-rasterising Hebrew glyphs
 * without a font library is not a thing worth attempting — an SVG renders with
 * the system font and opens in any browser.
 *
 * Everything it reads and writes stays under tools/private/, which is
 * gitignored: this is people's chat, quotes and votes.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep as SEP } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "tools", "private", "report");

const POINTS = {
  quizChoice: 100,
  truthsCorrectGuess: 10,
  truthsFooledEach: 10,
  bingoDeclare: 5,
  bingoLine: 50,
};
const BINGO_SIDE = 4;
const BINGO_CELLS = BINGO_SIDE * BINGO_SIDE;

/* ---------------------------------------------------------------- seeded rng
 * Copied from src/lib/rng.ts so boards reproduce exactly as they appeared on
 * people's phones. If these drift apart the report becomes fiction.
 * ------------------------------------------------------------------------- */

function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const out = items.slice();
  const rand = mulberry32(hash32(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const LINES = (() => {
  const n = BINGO_SIDE;
  const lines = [];
  for (let r = 0; r < n; r++) lines.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) lines.push(Array.from({ length: n }, (_, r) => r * n + c));
  lines.push(Array.from({ length: n }, (_, i) => i * n + i));
  lines.push(Array.from({ length: n }, (_, i) => i * n + (n - 1 - i)));
  return lines;
})();

const buildBoard = (playerId, freezeId, poolIds) =>
  shuffled(poolIds, `${playerId}:${freezeId}`).slice(0, BINGO_CELLS);

const completedLines = (board, marked) =>
  LINES.map((line, i) => (line.every((idx) => board[idx] && marked.has(board[idx])) ? i : -1)).filter(
    (i) => i >= 0
  );

/* --------------------------------------------------------------------- fold */

function fold(events) {
  const w = {
    players: new Map(),
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

  const ensure = (id, ts) => {
    let p = w.players.get(id);
    if (!p) w.players.set(id, (p = { id, name: "אורח", firstSeen: ts }));
    return p;
  };

  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.kind) {
      case "join": {
        const player = ensure(e.player, e.ts);
        if (typeof p.name === "string" && p.name.trim()) player.name = p.name.trim().slice(0, 20);
        break;
      }
      case "rename": {
        const target = String(p.target ?? "");
        if (target && typeof p.name === "string" && p.name.trim()) ensure(target, e.ts).name = p.name.trim().slice(0, 20);
        break;
      }
      case "phase":
        if (p.activity === "bingo") {
          if (p.phase === "propose" || p.phase === "play") w.bingoPhase = p.phase;
          if (p.phase === "play" && Array.isArray(p.poolIds)) {
            w.freeze = { id: e.id, poolIds: p.poolIds.map(String) };
          }
          if (p.phase === "propose") w.freeze = null;
        } else if (p.activity === "truths") {
          if (["submit", "guess", "reveal"].includes(p.phase)) w.truthsPhase = p.phase;
        }
        break;
      case "b.propose": {
        ensure(e.player, e.ts);
        const text = String(p.text ?? "").trim();
        if (text) w.proposals.push({ id: String(e.id), text, by: e.player });
        break;
      }
      case "b.mark": {
        ensure(e.player, e.ts);
        const square = String(p.square ?? "");
        if (!square) break;
        if (p.on === false) w.marks.delete(square);
        else w.marks.set(square, { by: e.player, ts: e.ts });
        break;
      }
      case "b.bingo":
        ensure(e.player, e.ts);
        if (!w.bingos.has(e.player)) w.bingos.set(e.player, e.id);
        break;
      case "t.submit": {
        ensure(e.player, e.ts);
        const s = p.statements;
        if (Array.isArray(s) && s.length === 3 && typeof p.lie === "number") {
          w.trios.set(e.player, {
            statements: s.map(String),
            lie: Math.min(2, Math.max(0, Math.round(p.lie))),
          });
        }
        break;
      }
      case "t.guess": {
        ensure(e.player, e.ts);
        const target = String(p.target ?? "");
        const index = Math.round(Number(p.index));
        if (!target || !Number.isFinite(index)) break;
        let mine = w.guesses.get(e.player);
        if (!mine) w.guesses.set(e.player, (mine = new Map()));
        mine.set(target, index);
        break;
      }
      case "q.answer": {
        ensure(e.player, e.ts);
        const qid = String(p.qid ?? "");
        const points = Math.round(Number(p.points));
        if (!qid || !Number.isFinite(points)) break;
        let mine = w.quiz.get(e.player);
        if (!mine) w.quiz.set(e.player, (mine = new Map()));
        if (!mine.has(qid)) mine.set(qid, { points, value: p.value });
        break;
      }
      case "s.ask": {
        ensure(e.player, e.ts);
        const text = String(p.text ?? "").trim();
        if (text) w.superlatives.push({ id: String(e.id), text, by: e.player });
        break;
      }
      case "s.vote": {
        ensure(e.player, e.ts);
        const ask = String(p.ask ?? "");
        const target = String(p.target ?? "");
        if (!ask) break;
        let forAsk = w.votes.get(ask);
        if (!forAsk) w.votes.set(ask, (forAsk = new Map()));
        if (!target) forAsk.delete(e.player);
        else forAsk.set(e.player, target);
        break;
      }
      case "w.post": {
        ensure(e.player, e.ts);
        const text = String(p.text ?? "").trim();
        if (text) {
          w.wall.push({ id: String(e.id), text, said: String(p.said ?? "").trim(), by: e.player, ts: e.ts });
        }
        break;
      }
      case "w.react": {
        ensure(e.player, e.ts);
        const post = String(p.post ?? "");
        const emoji = String(p.emoji ?? "");
        if (!post) break;
        let forPost = w.reactions.get(post);
        if (!forPost) w.reactions.set(post, (forPost = new Map()));
        if (!emoji || forPost.get(e.player) === emoji) forPost.delete(e.player);
        else forPost.set(e.player, emoji);
        break;
      }
    }
  }

  // --- scores, mirroring src/store.ts -------------------------------------
  for (const id of w.players.keys()) w.scores.set(id, 0);
  const add = (id, n) => {
    if (w.players.has(id)) w.scores.set(id, (w.scores.get(id) ?? 0) + n);
  };
  for (const [id, answers] of w.quiz) for (const a of answers.values()) add(id, a.points);
  for (const mark of w.marks.values()) add(mark.by, POINTS.bingoDeclare);
  if (w.freeze) {
    const marked = new Set(w.marks.keys());
    for (const id of w.players.keys()) {
      const board = buildBoard(id, w.freeze.id, w.freeze.poolIds);
      add(id, completedLines(board, marked).length * POINTS.bingoLine);
    }
  }
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
  return w;
}

/* ------------------------------------------------------------------- report */

function buildReport(events, quizData) {
  const w = fold(events);
  const name = (id) => w.players.get(id)?.name ?? "מישהו";
  const qById = new Map((quizData?.questions ?? []).map((q) => [q.id, q]));

  const standings = [...w.players.values()]
    .map((p) => ({ id: p.id, name: p.name, score: w.scores.get(p.id) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "he"));
  let lastScore = NaN, lastRank = 0;
  standings.forEach((r, i) => {
    if (r.score !== lastScore) { lastRank = i + 1; lastScore = r.score; }
    r.rank = lastRank;
  });

  // --- quiz ---------------------------------------------------------------
  const quiz = [];
  for (const [qid, q] of qById) {
    const responses = [];
    for (const [pid, answers] of w.quiz) {
      const a = answers.get(qid);
      if (a) responses.push({ id: pid, name: name(pid), value: a.value, points: a.points });
    }
    if (!responses.length) continue;
    quiz.push({
      id: qid,
      type: q.type,
      question: q.q,
      answer: q.type === "choice" ? q.answer : q.answer,
      reveal: q.reveal,
      quote: q.quote ?? null,
      responses,
      correct: responses.filter((r) => (q.type === "choice" ? r.value === q.answer : r.points >= q.points * 0.8)).length,
    });
  }

  // --- truths -------------------------------------------------------------
  const truths = [];
  for (const [pid, trio] of w.trios) {
    const guessers = [];
    for (const [guesser, picks] of w.guesses) {
      const pick = picks.get(pid);
      if (pick === undefined || guesser === pid) continue;
      guessers.push({ id: guesser, name: name(guesser), pick, right: pick === trio.lie });
    }
    truths.push({
      id: pid,
      name: name(pid),
      statements: trio.statements,
      lie: trio.lie,
      guessers,
      fooled: guessers.filter((g) => !g.right).length,
      spotted: guessers.filter((g) => g.right).length,
    });
  }
  truths.sort((a, b) => b.fooled - a.fooled);

  // --- bingo --------------------------------------------------------------
  const proposalById = new Map(w.proposals.map((p) => [p.id, p]));
  const bingo = {
    phase: w.bingoPhase,
    frozen: !!w.freeze,
    poolSize: w.freeze?.poolIds.length ?? w.proposals.length,
    proposals: w.proposals.map((p) => ({
      id: p.id,
      text: p.text,
      by: name(p.by),
      marked: w.marks.has(p.id),
      markedBy: w.marks.has(p.id) ? name(w.marks.get(p.id).by) : null,
      inPool: w.freeze ? w.freeze.poolIds.includes(p.id) : true,
    })),
    marks: [...w.marks.entries()].map(([sq, m]) => ({
      text: proposalById.get(sq)?.text ?? "(?)",
      by: name(m.by),
      ts: m.ts,
    })).sort((a, b) => a.ts - b.ts),
    boards: [],
  };
  if (w.freeze) {
    const marked = new Set(w.marks.keys());
    for (const p of w.players.values()) {
      const board = buildBoard(p.id, w.freeze.id, w.freeze.poolIds);
      bingo.boards.push({
        id: p.id,
        name: p.name,
        squares: board.map((sq) => ({ text: proposalById.get(sq)?.text ?? "(?)", marked: marked.has(sq) })),
        lines: completedLines(board, marked).length,
        markedCount: board.filter((sq) => marked.has(sq)).length,
      });
    }
    bingo.boards.sort((a, b) => b.lines - a.lines || b.markedCount - a.markedCount);
  }

  // --- superlatives -------------------------------------------------------
  const superlatives = w.superlatives.map((s) => {
    const votes = w.votes.get(s.id) ?? new Map();
    const tally = new Map();
    for (const target of votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
    const ranked = [...tally.entries()]
      .map(([id, n]) => ({ id, name: name(id), n }))
      .sort((a, b) => b.n - a.n);
    return {
      id: s.id,
      text: s.text,
      by: name(s.by),
      total: votes.size,
      ranked,
      voters: [...votes.entries()].map(([voter, target]) => ({ voter: name(voter), target: name(target) })),
    };
  });

  // --- wall ---------------------------------------------------------------
  const wall = w.wall.map((p) => {
    const r = w.reactions.get(p.id) ?? new Map();
    const counts = new Map();
    for (const emoji of r.values()) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    return {
      text: p.text,
      said: p.said,
      by: name(p.by),
      reactions: [...counts.entries()].map(([emoji, n]) => ({ emoji, n })),
      total: r.size,
    };
  }).sort((a, b) => b.total - a.total);

  // --- per person ---------------------------------------------------------
  const people = standings.map((s) => {
    const answers = w.quiz.get(s.id) ?? new Map();
    let qRight = 0, qWrong = 0, qPoints = 0;
    const perQuestion = [];
    for (const [qid, a] of answers) {
      const q = qById.get(qid);
      qPoints += a.points;
      const right = q ? (q.type === "choice" ? a.value === q.answer : a.points >= q.points * 0.8) : a.points > 0;
      if (right) qRight++; else qWrong++;
      perQuestion.push({ question: q?.q ?? qid, mine: a.value, correct: q?.answer, points: a.points, right });
    }

    const myGuesses = w.guesses.get(s.id) ?? new Map();
    let tRight = 0, tWrong = 0;
    const guessDetail = [];
    for (const [target, index] of myGuesses) {
      const trio = w.trios.get(target);
      if (!trio || target === s.id) continue;
      const right = index === trio.lie;
      if (right) tRight++; else tWrong++;
      guessDetail.push({ target: name(target), picked: trio.statements[index], truth: trio.statements[trio.lie], right });
    }

    const mine = truths.find((t) => t.id === s.id) ?? null;
    const board = bingo.boards.find((b) => b.id === s.id) ?? null;
    const declared = bingo.marks.filter((m) => m.by === s.name).length;

    const votedFor = superlatives
      .map((sup) => ({ text: sup.text, n: sup.ranked.find((r) => r.id === s.id)?.n ?? 0, won: sup.ranked[0]?.id === s.id }))
      .filter((v) => v.n > 0)
      .sort((a, b) => b.n - a.n);

    const myVotes = superlatives
      .map((sup) => {
        const v = sup.voters.find((x) => x.voter === s.name);
        return v ? { text: sup.text, chose: v.target } : null;
      })
      .filter(Boolean);

    return {
      ...s,
      quiz: { right: qRight, wrong: qWrong, points: qPoints, answered: answers.size, detail: perQuestion },
      truths: {
        guessedRight: tRight,
        guessedWrong: tWrong,
        fooled: mine?.fooled ?? 0,
        spotted: mine?.spotted ?? 0,
        submitted: !!mine,
        statements: mine?.statements ?? null,
        lie: mine?.lie ?? null,
        guessDetail,
      },
      bingo: { lines: board?.lines ?? 0, marked: board?.markedCount ?? 0, declared, proposed: w.proposals.filter((p) => p.by === s.id).length },
      votedFor,
      myVotes,
      quotes: wall.filter((q) => q.by === s.name).length,
    };
  });

  const span = { from: events[0]?.ts, to: events[events.length - 1]?.ts };
  return { standings, quiz, truths, bingo, superlatives, wall, people, span, eventCount: events.length };
}

/* --------------------------------------------------------------------- text */

const he = (n) => Number(n).toLocaleString("he-IL");
const dt = (ts) => new Date(ts).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
const rule = (c = "=") => c.repeat(74);

function renderText(r) {
  const L = [];
  const push = (...xs) => L.push(...xs);

  push(rule(), "  נופש מופלאים — סיכום מלא", rule(), "");
  push(`  ${he(r.eventCount)} אירועים · ${dt(r.span.from)} עד ${dt(r.span.to)}`, "");

  push(rule("-"), "  טבלת הניקוד הסופית", rule("-"));
  for (const s of r.standings) push(`  ${String(s.rank).padStart(2)}. ${s.name.padEnd(22)} ${String(he(s.score)).padStart(6)} נק׳`);
  push("");

  push(rule("-"), `  החידון — ${r.quiz.length} שאלות שנענו`, rule("-"), "");
  for (const q of r.quiz) {
    push(`  ${q.question}`);
    push(`     תשובה נכונה: ${q.answer}`);
    push(`     ${q.reveal}`);
    if (q.quote) push(...q.quote.split("\n").map((l) => `     ״${l}״`));
    push(`     ענו נכון: ${q.correct} מתוך ${q.responses.length}`);
    for (const resp of q.responses) {
      const mark = q.type === "choice" ? (resp.value === q.answer ? "✓" : "✗") : `${resp.points} נק׳`;
      push(`       ${String(mark).padEnd(7)} ${resp.name.padEnd(20)} ${resp.value}`);
    }
    push("");
  }

  push(rule("-"), "  שתי אמיתות ושקר", rule("-"), "");
  for (const t of r.truths) {
    push(`  ${t.name} — רימה ${t.fooled}, נתפס על ידי ${t.spotted}`);
    t.statements.forEach((s, i) => push(`     ${i === t.lie ? "🤥 שקר" : "✅ אמת"}  ${s}`));
    for (const g of t.guessers) push(`       ${g.right ? "✓" : "✗"} ${g.name.padEnd(20)} בחר: ${t.statements[g.pick]}`);
    push("");
  }

  push(rule("-"), `  בינגו — ${r.bingo.proposals.length} הצעות, ${r.bingo.marks.length} סומנו`, rule("-"), "");
  push("  כל ההצעות:");
  for (const p of r.bingo.proposals) {
    const flags = [p.inPool ? null : "מחוץ למאגר", p.marked ? `סומן ע״י ${p.markedBy}` : null].filter(Boolean);
    push(`     ${p.marked ? "✓" : "·"} ${p.text}  (${p.by})${flags.length ? "  [" + flags.join(", ") + "]" : ""}`);
  }
  if (r.bingo.marks.length) {
    push("", "  לפי סדר הסימון:");
    r.bingo.marks.forEach((m, i) => push(`     ${String(i + 1).padStart(2)}. ${dt(m.ts)}  ${m.text}  — ${m.by}`));
  }
  if (r.bingo.boards.length) {
    push("", "  לוחות:");
    for (const b of r.bingo.boards) push(`     ${b.name.padEnd(22)} ${b.markedCount}/${BINGO_CELLS} משבצות · ${b.lines} שורות`);
  }
  push("");

  push(rule("-"), `  מי הכי… — ${r.superlatives.length} שאלות`, rule("-"), "");
  for (const s of r.superlatives) {
    push(`  ${s.text}   (שאל: ${s.by}, ${s.total} הצביעו)`);
    for (const rk of s.ranked) push(`     ${String(rk.n).padStart(2)} קולות  ${rk.name}`);
    if (s.voters.length) push(`     מי בחר במי: ${s.voters.map((v) => `${v.voter}→${v.target}`).join(", ")}`);
    push("");
  }

  push(rule("-"), `  קיר הציטוטים — ${r.wall.length} ציטוטים`, rule("-"), "");
  for (const q of r.wall) {
    push(`  ״${q.text}״`);
    push(`     — ${q.said || "אלמוני"} · העלה ${q.by} · ${q.reactions.map((x) => x.emoji + x.n).join(" ") || "בלי תגובות"}`);
    push("");
  }

  push(rule(), "  לפי אדם", rule(), "");
  for (const p of r.people) {
    push(rule("-"));
    push(`  ${p.name}   —   מקום ${p.rank}, ${he(p.score)} נקודות`);
    push(rule("-"));
    push(`  חידון:  ${p.quiz.right} נכון · ${p.quiz.wrong} טעות · ${he(p.quiz.points)} נקודות (מתוך ${p.quiz.answered} שאלות)`);
    push(`  אמיתות: ניחש נכון ${p.truths.guessedRight}, טעה ${p.truths.guessedWrong} · רימה ${p.truths.fooled}, נתפס ${p.truths.spotted}`);
    push(`  בינגו:  ${p.bingo.marked}/${BINGO_CELLS} על הלוח · ${p.bingo.lines} שורות · סימן ${p.bingo.declared} · הציע ${p.bingo.proposed}`);
    push(`  ציטוטים שהעלה: ${p.quotes}`);

    if (p.truths.submitted) {
      push("", "  השלשה שלו/ה:");
      p.truths.statements.forEach((s, i) => push(`     ${i === p.truths.lie ? "🤥" : "✅"} ${s}`));
    }
    if (p.votedFor.length) {
      push("", "  נבחר בקטגוריות:");
      for (const v of p.votedFor) push(`     ${v.won ? "🏅" : "  "} ${v.n} קולות — ${v.text}`);
    }
    if (p.myVotes.length) {
      push("", "  הצביע:");
      for (const v of p.myVotes) push(`     ${v.text} → ${v.chose}`);
    }
    if (p.quiz.detail.length) {
      push("", "  תשובות בחידון:");
      for (const d of p.quiz.detail) {
        push(`     ${d.right ? "✓" : "✗"} ${d.question}`);
        push(`        ענה: ${d.mine}${d.right ? "" : `   (נכון: ${d.correct})`}   ${d.points} נק׳`);
      }
    }
    if (p.truths.guessDetail.length) {
      push("", "  ניחושים:");
      for (const g of p.truths.guessDetail) {
        push(`     ${g.right ? "✓" : "✗"} על ${g.target}: בחר ״${g.picked}״${g.right ? "" : `   (השקר היה ״${g.truth}״)`}`);
      }
    }
    push("");
  }
  return L.join("\n");
}

/**
 * The version that actually gets pasted into WhatsApp. The full report is
 * ~100 KB; a chat message wants a few screens at most. So: the scoreboard, the
 * quiz as bare question + answer, and each trio with only the fooled/spotted
 * counts — who guessed what about whom is left to the full report.
 *
 * WhatsApp markup: *bold*, _italic_. No rules — a 74-char line wraps into
 * noise on a phone.
 */
function renderMessage(r) {
  const L = [];
  const push = (...xs) => L.push(...xs);

  push("*נופש מופלאים — סיכום* 🎉", "");

  push("*טבלת הניקוד*");
  for (const s of r.standings) {
    const medal = s.rank === 1 ? "🥇" : s.rank === 2 ? "🥈" : s.rank === 3 ? "🥉" : `${s.rank}.`;
    push(`${medal} ${s.name} — ${he(s.score)}`);
  }
  push("");

  push("*החידון*", "");
  for (const q of r.quiz) {
    push(`❓ ${q.question}`);
    push(`✅ ${q.answer} _(${q.correct}/${q.responses.length} ענו נכון)_`, "");
  }

  push("*שתי אמיתות ושקר*", "");
  for (const t of r.truths) {
    push(`*${t.name}* — רימה ${t.fooled}, נתפס ${t.spotted}`);
    t.statements.forEach((s, i) => push(`${i === t.lie ? "🤥" : "✅"} ${s}`));
    push("");
  }

  return L.join("\n").trimEnd() + "\n";
}

/* ---------------------------------------------------------------------- svg */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

/** SVG has no text wrapping. Estimate by character count and break on words. */
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const word of words) {
    if (!cur.length) cur = word;
    else if ((cur + " " + word).length <= maxChars) cur += " " + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const C = {
  bg: "#1a1130", panel: "#2a1a4a", panel2: "#34215c",
  text: "#f3e9ff", muted: "#b9a9d6", accent: "#8b5cf6",
  good: "#4ade80", bad: "#ff6b8a", gold: "#ffd166",
};
const FONT = "Segoe UI, Arial, Helvetica, sans-serif";
const W = 1000;

/**
 * Text, positioned by where it should VISUALLY sit.
 *
 * SVG's text-anchor is relative to the inline base direction, so under
 * direction="rtl" "start" is the RIGHT edge and "end" is the left — the exact
 * opposite of the LTR intuition. Anchoring right-aligned Hebrew with "end" put
 * the anchor at the left of the string and ran every heading off the canvas.
 * Callers say "right"/"left"/"middle" and this maps it.
 */
const ANCHOR = { right: "start", left: "end", middle: "middle" };

function t(x, y, str, { size = 18, fill = C.text, weight = 400, align = "right", opacity = 1 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${ANCHOR[align] ?? "start"}" opacity="${opacity}" direction="rtl">${esc(str)}</text>`;
}

function card(x, y, w, h, fill = C.panel) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}"/>`;
}

function svgDoc(height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">
<rect width="${W}" height="${height}" fill="${C.bg}"/>
${body}
</svg>`;
}

function renderSummarySvg(r) {
  const parts = [];
  let y = 70;
  const R = W - 50; // right margin: text is anchored here

  parts.push(t(R, y, "נופש מופלאים", { size: 46, weight: 800 }));
  y += 34;
  parts.push(t(R, y, `${he(r.eventCount)} אירועים · ${r.standings.length} משתתפים · ${dt(r.span.from).split(",")[0]}`, { size: 17, fill: C.muted }));
  y += 40;

  // standings
  const rows = r.standings.slice(0, 12);
  const boxH = 56 + rows.length * 34;
  parts.push(card(50, y, W - 100, boxH));
  parts.push(t(R - 20, y + 36, "טבלת הניקוד", { size: 24, weight: 700, fill: C.gold }));
  let ry = y + 74;
  for (const s of rows) {
    const medal = s.rank === 1 ? "🥇" : s.rank === 2 ? "🥈" : s.rank === 3 ? "🥉" : `${s.rank}.`;
    parts.push(t(R - 20, ry, `${medal}  ${s.name}`, { size: 19, weight: s.rank <= 3 ? 700 : 400 }));
    parts.push(t(120, ry, `${he(s.score)}`, { size: 19, align: "left", fill: s.rank === 1 ? C.gold : C.muted, weight: 700 }));
    ry += 34;
  }
  y += boxH + 24;

  // headline numbers
  const stats = [
    ["שאלות חידון", r.quiz.length],
    ["שלשות", r.truths.length],
    ["הצעות בינגו", r.bingo.proposals.length],
    ["משבצות סומנו", r.bingo.marks.length],
    ["שאלות מי הכי", r.superlatives.length],
    ["ציטוטים", r.wall.length],
  ];
  const cols = 3, cw = (W - 100 - 20 * (cols - 1)) / cols, ch = 84;
  stats.forEach((s, i) => {
    const cx = 50 + (cols - 1 - (i % cols)) * (cw + 20);
    const cy = y + Math.floor(i / cols) * (ch + 16);
    parts.push(card(cx, cy, cw, ch, C.panel2));
    parts.push(t(cx + cw - 18, cy + 40, String(he(s[1])), { size: 30, weight: 800, fill: C.accent }));
    parts.push(t(cx + cw - 18, cy + 66, s[0], { size: 15, fill: C.muted }));
  });
  y += Math.ceil(stats.length / cols) * (ch + 16) + 16;

  // superlative winners
  const winners = r.superlatives.filter((s) => s.ranked.length).slice(0, 8);
  if (winners.length) {
    const bh = 56 + winners.length * 30;
    parts.push(card(50, y, W - 100, bh));
    parts.push(t(R - 20, y + 36, "מי הכי… — הזוכים", { size: 24, weight: 700, fill: C.gold }));
    let wy = y + 72;
    for (const s of winners) {
      const label = wrap(s.text, 46)[0];
      parts.push(t(R - 20, wy, label, { size: 16, fill: C.muted }));
      parts.push(t(300, wy, `${s.ranked[0].name} (${s.ranked[0].n})`, { size: 16, align: "left", weight: 700 }));
      wy += 30;
    }
    y += bh + 24;
  }

  // biggest liar / best detective
  const liar = r.truths[0];
  const detective = r.people.slice().sort((a, b) => b.truths.guessedRight - a.truths.guessedRight)[0];
  const quizKing = r.people.slice().sort((a, b) => b.quiz.points - a.quiz.points)[0];
  const awards = [
    liar ? ["🤥 השקרן הגדול", `${liar.name} — רימה ${liar.fooled}`] : null,
    detective ? ["🕵️ הבלש", `${detective.name} — זיהה ${detective.truths.guessedRight}`] : null,
    quizKing ? ["💬 מומחה הקבוצה", `${quizKing.name} — ${he(quizKing.quiz.points)} נק׳`] : null,
  ].filter(Boolean);
  if (awards.length) {
    const bh = 56 + awards.length * 34;
    parts.push(card(50, y, W - 100, bh));
    parts.push(t(R - 20, y + 36, "פרסים", { size: 24, weight: 700, fill: C.gold }));
    let ay = y + 74;
    for (const a of awards) {
      parts.push(t(R - 20, ay, a[0], { size: 18 }));
      parts.push(t(360, ay, a[1], { size: 18, align: "left", fill: C.muted }));
      ay += 34;
    }
    y += bh + 24;
  }

  return svgDoc(y + 20, parts.join("\n"));
}

function renderPersonSvg(r, p) {
  const parts = [];
  const R = W - 50;
  let y = 70;

  parts.push(t(R, y, p.name, { size: 42, weight: 800 }));
  y += 32;
  parts.push(t(R, y, `מקום ${p.rank} מתוך ${r.standings.length} · ${he(p.score)} נקודות`, { size: 19, fill: C.gold }));
  y += 36;

  const tiles = [
    ["חידון", `${p.quiz.right}/${p.quiz.answered}`, C.good],
    ["ניחושים נכונים", `${p.truths.guessedRight}`, C.accent],
    ["רימה אנשים", `${p.truths.fooled}`, C.bad],
    ["שורות בינגו", `${p.bingo.lines}`, C.gold],
  ];
  const cols = 4, cw = (W - 100 - 14 * (cols - 1)) / cols, ch = 92;
  tiles.forEach((s, i) => {
    const cx = 50 + (cols - 1 - i) * (cw + 14);
    parts.push(card(cx, y, cw, ch, C.panel2));
    parts.push(t(cx + cw / 2, y + 46, String(s[1]), { size: 32, weight: 800, fill: s[2], align: "middle" }));
    parts.push(t(cx + cw / 2, y + 72, s[0], { size: 14, fill: C.muted, align: "middle" }));
  });
  y += ch + 22;

  const block = (title, lines, colour = C.text) => {
    if (!lines.length) return;
    const bh = 52 + lines.length * 28;
    parts.push(card(50, y, W - 100, bh));
    parts.push(t(R - 20, y + 34, title, { size: 21, weight: 700, fill: C.gold }));
    let by = y + 68;
    for (const line of lines) {
      parts.push(t(R - 20, by, line, { size: 16, fill: colour }));
      by += 28;
    }
    y += bh + 18;
  };

  if (p.truths.submitted) {
    block("השלשה שלו/ה", p.truths.statements.map((s, i) =>
      `${i === p.truths.lie ? "🤥" : "✅"}  ${wrap(s, 60)[0]}${s.length > 60 ? "…" : ""}`));
  }
  if (p.votedFor.length) {
    block("נבחר בקטגוריות", p.votedFor.slice(0, 6).map((v) =>
      `${v.won ? "🏅" : "•"} ${v.n} קולות — ${wrap(v.text, 50)[0]}`));
  }

  const quizLines = [
    `ענה על ${p.quiz.answered} שאלות · ${p.quiz.right} נכון · ${p.quiz.wrong} טעות`,
    `${he(p.quiz.points)} נקודות מהחידון`,
  ];
  const bingoLines = [
    `${p.bingo.marked} מתוך ${BINGO_CELLS} משבצות סומנו על הלוח`,
    `הציע ${p.bingo.proposed} משבצות · סימן ${p.bingo.declared}`,
  ];
  block("חידון", quizLines, C.muted);
  block("בינגו", bingoLines, C.muted);

  return svgDoc(y + 20, parts.join("\n"));
}

/* ---------------------------------------------------------------- svg -> png
 * WhatsApp will not render SVG, so sharing means PNG.
 *
 * Driven over the DevTools Protocol rather than Chromium's --screenshot flag.
 * On Windows, launching msedge.exe while Edge is already open gets relayed to
 * the running instance, which exits immediately having rendered nothing — even
 * --screenshot of about:blank silently produces no file. Asking for a debugging
 * port forces a genuinely separate instance, so this works whether or not the
 * user has their browser open.
 *
 * Node 22+ has a global WebSocket, so this still needs no dependencies.
 * ------------------------------------------------------------------------- */

const BROWSERS = [
  `${process.env["ProgramFiles(x86)"] ?? ""}${SEP}Microsoft${SEP}Edge${SEP}Application${SEP}msedge.exe`,
  `${process.env.ProgramFiles ?? ""}${SEP}Microsoft${SEP}Edge${SEP}Application${SEP}msedge.exe`,
  `${process.env.ProgramFiles ?? ""}${SEP}Google${SEP}Chrome${SEP}Application${SEP}chrome.exe`,
  `${process.env["ProgramFiles(x86)"] ?? ""}${SEP}Google${SEP}Chrome${SEP}Application${SEP}chrome.exe`,
  `${process.env.LOCALAPPDATA ?? ""}${SEP}Google${SEP}Chrome${SEP}Application${SEP}chrome.exe`,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findBrowser() {
  for (const b of BROWSERS) if (b && existsSync(b)) return b;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start headless Chromium with a debugging port and connect to it. */
async function startBrowser(browser) {
  const profile = join(tmpdir(), `wq-cdp-${Math.random().toString(36).slice(2, 9)}`);
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  // Chromium writes the port it actually chose into the profile directory.
  const portFile = join(profile, "DevToolsActivePort");
  let port = null;
  for (let i = 0; i < 80; i++) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, "utf8").split("\n")[0].trim();
      if (first) { port = Number(first); break; }
    }
    await sleep(250);
  }
  if (!port) {
    child.kill();
    throw new Error("browser never opened a debugging port");
  }

  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = targets.find((x) => x.type === "page");
  if (!page) { child.kill(); throw new Error("no page target"); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("devtools socket failed")); });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

  await send("Page.enable");
  return {
    send,
    close() {
      try { ws.close(); } catch { /* closing */ }
      try { child.kill(); } catch { /* gone */ }
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
    },
  };
}

/**
 * Render one card to PNG at 2x, so text survives WhatsApp's recompression.
 *
 * The SVG is inlined into the wrapper rather than linked, so there is no second
 * fetch that could lose the race with the capture.
 */
async function renderPng(session, dir, svgName, pngPath, width, height, scale = 2) {
  const wrapper = join(dir, "_render.html");
  writeFileSync(
    wrapper,
    `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#1a1130;overflow:hidden}
svg{display:block}
</style></head><body>${readFileSync(join(dir, svgName), "utf8")}</body></html>`,
    "utf8"
  );

  await session.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: scale, mobile: false,
  });
  await session.send("Page.navigate", { url: "file:///" + wrapper.replace(/\\/g, "/") });
  await sleep(700); // let fonts settle before capturing

  const shot = await session.send("Page.captureScreenshot", { format: "png" });
  const data = shot.result?.data;
  if (!data) return false;
  writeFileSync(pngPath, Buffer.from(data, "base64"));
  return true;
}

/** A card is dense text; one that compresses this small is blank or broken. */
function looksBlank(pngPath) {
  try { return statSync(pngPath).size < 12000; } catch { return true; }
}

/* -------------------------------------------------------------------- driver */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const n = argv[i + 1];
      if (n && !n.startsWith("--")) { out[k] = n; i++; } else out[k] = true;
    } else out._.push(argv[i]);
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const inPath = argv.in ? resolve(process.cwd(), argv.in) : join(ROOT, "tools", "private", "weekend-export.json");
if (!existsSync(inPath)) {
  console.error(`no export at ${inPath}\n  run the exporter first`);
  process.exit(1);
}

const events = JSON.parse(readFileSync(inPath, "utf8"));
const quizPath = join(ROOT, "tools", "private", "chat-stats.json");
const quizData = existsSync(quizPath) ? JSON.parse(readFileSync(quizPath, "utf8")) : { questions: [] };

const report = buildReport(events, quizData);

mkdirSync(OUT_DIR, { recursive: true });
const text = renderText(report);
writeFileSync(join(OUT_DIR, "summary.txt"), text, "utf8");
const message = renderMessage(report);
writeFileSync(join(OUT_DIR, "message.txt"), message, "utf8");

/** Pull the declared size back out, so the PNG matches the SVG exactly. */
const sizeOf = (svg) => {
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  return { width: Number(m?.[1] ?? 1000), height: Number(m?.[2] ?? 1000) };
};

const cards = [];
const summarySvg = renderSummarySvg(report);
writeFileSync(join(OUT_DIR, "summary.svg"), summarySvg, "utf8");
cards.push({ base: "summary", label: "סיכום כללי", ...sizeOf(summarySvg) });

report.people.forEach((p, i) => {
  const base = `person-${String(i + 1).padStart(2, "0")}`;
  const svg = renderPersonSvg(report, p);
  writeFileSync(join(OUT_DIR, `${base}.svg`), svg, "utf8");
  cards.push({ base, label: p.name, ...sizeOf(svg) });
});

const files = cards.map((c) => `${c.base}.svg`);

// A viewer, so the SVGs can be looked at, printed or screenshotted in one go.
writeFileSync(
  join(OUT_DIR, "index.html"),
  `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>נופש מופלאים — סיכום</title>
<style>body{margin:0;background:#120c22;font-family:system-ui,sans-serif;padding:24px}
img{display:block;width:100%;max-width:1000px;margin:0 auto 28px;border-radius:16px}</style>
</head><body>
${files.map((f) => `<img src="${f}" alt="${f}">`).join("\n")}
</body></html>`,
  "utf8"
);

// --- PNGs, for sharing --------------------------------------------------
let pngCount = 0;
if (argv["no-png"] !== true) {
  const browser = findBrowser();
  if (!browser) {
    console.log("\n  no Edge or Chrome found — skipping PNG conversion (SVGs are still written)");
  } else {
    console.log(`\n  rendering PNGs with ${browser.split(/[\\/]/).pop()}…`);
    let session = null;
    try {
      session = await startBrowser(browser);
      for (const c of cards) {
        const pngPath = join(OUT_DIR, `${c.base}.png`);
        try {
          const ok = await renderPng(session, OUT_DIR, `${c.base}.svg`, pngPath, c.width, c.height);
          if (!ok) console.log(`    FAILED  ${c.base}.png — no image returned`);
          else if (looksBlank(pngPath)) console.log(`    SUSPECT ${c.base}.png is nearly empty`);
          else {
            pngCount++;
            console.log(`    ${c.base}.png  ${c.width * 2}x${c.height * 2}  (${c.label})`);
          }
        } catch (err) {
          console.log(`    FAILED  ${c.base}.png — ${String(err.message).split("\n")[0]}`);
        }
      }
    } catch (err) {
      console.log(`  could not start a headless browser: ${err.message}`);
    } finally {
      session?.close();
      try { rmSync(join(OUT_DIR, "_render.html"), { force: true }); } catch { /* fine */ }
    }
  }
}

console.log(`\n  wrote ${files.length + 3} files to tools/private/report/`);
console.log(`    summary.txt   ${(text.length / 1024).toFixed(1)} KB, ${text.split("\n").length} lines  (full report)`);
console.log(`    message.txt   ${(message.length / 1024).toFixed(1)} KB, ${message.split("\n").length} lines  (paste into WhatsApp)`);
console.log(`    summary.svg   overall card`);
console.log(`    person-*.svg  ${report.people.length} personal cards`);
console.log(`    index.html    viewer for all of them`);
if (pngCount) console.log(`    ${pngCount} PNGs at 2x, ready to send\n`);
else console.log("");
