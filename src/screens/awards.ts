import { h, bdi, clear, heCountText } from "../ui/dom";
import { me } from "../identity";
import { getWorld, onWorld } from "../world";
import { boardFor, nameOf, standings, type World } from "../store";
import { completedLines } from "../lib/bingo";
import { sideOf } from "../store";
import { go } from "../router";
import { strings } from "../i18n";

const S = strings({
  he: {
    title: "🏆 טקס הפרסים",
    back: "חזרה",
    champion: "אלוף הנופש · ",
    points: " נקודות",
    notEnough: "עוד אין מספיק נתונים לפרסים.",
    notEnoughSub: "שחקו קצת ותחזרו לכאן בסוף הנופש.",
    sharpEye: "העין החדה",
    sharpEyeDetail: (n: number) => `סימן ${heCountText(n, "משבצת אחת", "משבצות")} בבינגו`,
    firstBingo: "הבינגו הראשון",
    firstBingoDetail: "השלים שורה לפני כולם",
    bestBoard: "הלוח הכי מוצלח",
    bestBoardDetail: (n: number) => `${heCountText(n, "שורה אחת שהושלמה", "שורות שהושלמו")}`,
    liar: "השקרן הגדול",
    liarDetail: (n: number) => `רימה ${heCountText(n, "אדם אחד", "אנשים")}`,
    detective: "הבלש",
    detectiveDetail: (n: number) => `זיהה ${heCountText(n, "שקר אחד", "שקרים")}`,
    gullible: "הכי מאמין לכולם",
    gullibleDetail: (n: number) => (n === 1 ? "נפל בשקר אחד" : `נפל ב-${n} שקרים`),
    quizKing: "מומחה הקבוצה",
    quizKingDetail: (n: number) => `${n} נקודות בחידון הוואטסאפ`,
    quote: "משפט הנופש",
    quoteWrap: (text: string) => "״" + text + "״",
    anonymous: "אלמוני",
    quoteDetail: (said: string, n: number) => `${said} · ${heCountText(n, "תגובה אחת", "תגובות")}`,
    scribe: "הכתב של הנופש",
    scribeDetail: (n: number) => `הנציח ${heCountText(n, "ציטוט אחד", "ציטוטים")}`,
    mostMost: "הכי ״הכי״",
    mostMostDetail: (n: number) => (n === 1 ? "ניצח בקטגוריה אחת" : `ניצח ב-${n} קטגוריות`),
  },
  en: {
    title: "🏆 Awards Ceremony",
    back: "Back",
    champion: "Weekend champion · ",
    points: " points",
    notEnough: "Not enough data for awards yet.",
    notEnoughSub: "Play a bit and come back at the end of the weekend.",
    sharpEye: "Sharp Eye",
    sharpEyeDetail: (n: number) => `Marked ${heCountText(n, "one square", "squares")} in bingo`,
    firstBingo: "First Bingo",
    firstBingoDetail: "Completed a line before anyone else",
    bestBoard: "Best Board",
    bestBoardDetail: (n: number) => `${heCountText(n, "one line completed", "lines completed")}`,
    liar: "The Big Liar",
    liarDetail: (n: number) => `Fooled ${heCountText(n, "one person", "people")}`,
    detective: "The Detective",
    detectiveDetail: (n: number) => `Spotted ${heCountText(n, "one lie", "lies")}`,
    gullible: "Most Trusting",
    gullibleDetail: (n: number) => (n === 1 ? "Fell for one lie" : `Fell for ${n} lies`),
    quizKing: "Group Expert",
    quizKingDetail: (n: number) => `${n} points in the WhatsApp quiz`,
    quote: "Quote of the Weekend",
    quoteWrap: (text: string) => "“" + text + "”",
    anonymous: "Anonymous",
    quoteDetail: (said: string, n: number) => `${said} · ${heCountText(n, "one reaction", "reactions")}`,
    scribe: "Weekend Scribe",
    scribeDetail: (n: number) => `Captured ${heCountText(n, "one quote", "quotes")}`,
    mostMost: "The Most “Most”",
    mostMostDetail: (n: number) => (n === 1 ? "Won one category" : `Won ${n} categories`),
  },
});

/**
 * The closing ceremony.
 *
 * Every award here is a pure fold over the event log — nobody enters anything,
 * nothing needs collecting on Sunday morning, and it costs nothing to leave
 * running all weekend. Its job is to give the weekend an ending instead of
 * letting it peter out.
 *
 * Awards with no data simply do not render, so this screen is never
 * embarrassing early on.
 */
interface Award {
  emoji: string;
  title: string;
  winner: string;
  detail: string;
  winnerId?: string;
}

export function awardsScreen(root: HTMLElement): () => void {
  const body = h("div");
  root.append(body);

  function render(): void {
    const w = getWorld();
    clear(body);

    body.append(
      h(
        "div.screen-head",
        null,
        h("h1", null, S.title),
        h("button.btn.btn-sm", { onclick: () => go("#/") }, S.back)
      )
    );

    const table = standings(w);
    const champion = table[0];
    if (champion && champion.score > 0) {
      body.append(
        h(
          "div.panel.center",
          null,
          h("div", { style: "font-size:44px" }, "👑"),
          h("h2", { dir: "auto" }, champion.name),
          h("div.muted", null, S.champion, bdi(champion.score), S.points)
        )
      );
    }

    const awards = computeAwards(w);
    if (!awards.length) {
      body.append(
        h(
          "div.panel.center",
          null,
          h("p", null, S.notEnough),
          h("div.muted", null, S.notEnoughSub)
        )
      );
      return;
    }

    for (const a of awards) {
      body.append(
        h(
          "div.panel",
          null,
          h(
            "div.card-head",
            null,
            h("span.card-emoji", null, a.emoji),
            h(
              "div",
              null,
              h("div.card-title", null, a.title),
              h(
                "div",
                { dir: "auto", style: a.winnerId === me.id ? "color:var(--gold);font-weight:700" : "" },
                a.winner
              ),
              h("div.row-sub", null, a.detail)
            )
          )
        )
      );
    }
  }

  render();
  return onWorld(render);
}

function computeAwards(w: World): Award[] {
  const out: Award[] = [];
  const name = (id: string) => nameOf(w, id);

  /** Highest value wins; ties and empties are skipped rather than faked. */
  const top = (counts: Map<string, number>): { id: string; n: number } | null => {
    let best: { id: string; n: number } | null = null;
    for (const [id, n] of counts) {
      if (n > 0 && (!best || n > best.n)) best = { id, n };
    }
    return best;
  };

  // --- Bingo -------------------------------------------------------------
  const called = new Map<string, number>();
  for (const mark of w.marks.values()) called.set(mark.by, (called.get(mark.by) ?? 0) + 1);
  const caller = top(called);
  if (caller) {
    out.push({
      emoji: "👀",
      title: S.sharpEye,
      winner: name(caller.id),
      detail: S.sharpEyeDetail(caller.n),
      winnerId: caller.id,
    });
  }

  // First bingo — the lowest b.bingo event id.
  let firstBingo: { id: string; eventId: number } | null = null;
  for (const [player, eventId] of w.bingos) {
    if (!firstBingo || eventId < firstBingo.eventId) firstBingo = { id: player, eventId };
  }
  if (firstBingo) {
    out.push({
      emoji: "🎯",
      title: S.firstBingo,
      winner: name(firstBingo.id),
      detail: S.firstBingoDetail,
      winnerId: firstBingo.id,
    });
  }

  // Most completed lines overall.
  if (w.freeze) {
    const marked = new Set(w.marks.keys());
    const lines = new Map<string, number>();
    for (const id of w.players.keys()) {
      const board = boardFor(w, id);
      if (board) lines.set(id, completedLines(board, marked, sideOf(w)).length);
    }
    const best = top(lines);
    if (best) {
      out.push({
        emoji: "📋",
        title: S.bestBoard,
        winner: name(best.id),
        detail: S.bestBoardDetail(best.n),
        winnerId: best.id,
      });
    }
  }

  // --- Two truths --------------------------------------------------------
  if (w.trios.size) {
    const fooled = new Map<string, number>();
    const spotted = new Map<string, number>();
    for (const [guesser, picks] of w.guesses) {
      for (const [target, index] of picks) {
        const trio = w.trios.get(target);
        if (!trio || target === guesser) continue;
        if (index === trio.lie) spotted.set(guesser, (spotted.get(guesser) ?? 0) + 1);
        else fooled.set(target, (fooled.get(target) ?? 0) + 1);
      }
    }
    const liar = top(fooled);
    if (liar) {
      out.push({
        emoji: "🤥",
        title: S.liar,
        winner: name(liar.id),
        detail: S.liarDetail(liar.n),
        winnerId: liar.id,
      });
    }
    const detective = top(spotted);
    if (detective) {
      out.push({
        emoji: "🕵️",
        title: S.detective,
        winner: name(detective.id),
        detail: S.detectiveDetail(detective.n),
        winnerId: detective.id,
      });
    }
    // Most gullible: guessed the most times and got the fewest right.
    const wrong = new Map<string, number>();
    for (const [guesser, picks] of w.guesses) {
      let n = 0;
      for (const [target, index] of picks) {
        const trio = w.trios.get(target);
        if (trio && target !== guesser && index !== trio.lie) n++;
      }
      if (n) wrong.set(guesser, n);
    }
    const gullible = top(wrong);
    if (gullible) {
      out.push({
        emoji: "🐑",
        title: S.gullible,
        winner: name(gullible.id),
        detail: S.gullibleDetail(gullible.n),
        winnerId: gullible.id,
      });
    }
  }

  // --- Quiz --------------------------------------------------------------
  const quizScores = new Map<string, number>();
  for (const [id, answers] of w.quiz) {
    let total = 0;
    for (const points of answers.values()) total += points;
    if (total) quizScores.set(id, total);
  }
  const quizKing = top(quizScores);
  if (quizKing) {
    out.push({
      emoji: "💬",
      title: S.quizKing,
      winner: name(quizKing.id),
      detail: S.quizKingDetail(quizKing.n),
      winnerId: quizKing.id,
    });
  }

  // --- Quote wall --------------------------------------------------------
  if (w.wall.length) {
    let bestPost: { text: string; by: string; said: string; n: number } | null = null;
    for (const post of w.wall) {
      const n = w.reactions.get(post.id)?.size ?? 0;
      if (!bestPost || n > bestPost.n) bestPost = { text: post.text, by: post.by, said: post.said, n };
    }
    if (bestPost && bestPost.n > 0) {
      out.push({
        emoji: "🗣️",
        title: S.quote,
        winner: S.quoteWrap(bestPost.text),
        detail: S.quoteDetail(bestPost.said || S.anonymous, bestPost.n),
      });
    }
    const posters = new Map<string, number>();
    for (const post of w.wall) posters.set(post.by, (posters.get(post.by) ?? 0) + 1);
    const scribe = top(posters);
    if (scribe) {
      out.push({
        emoji: "✍️",
        title: S.scribe,
        winner: name(scribe.id),
        detail: S.scribeDetail(scribe.n),
        winnerId: scribe.id,
      });
    }
  }

  // --- Superlatives ------------------------------------------------------
  if (w.superlatives.length) {
    const crowned = new Map<string, number>();
    for (const s of w.superlatives) {
      const votes = w.votes.get(s.id);
      if (!votes || !votes.size) continue;
      const tally = new Map<string, number>();
      for (const target of votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
      const winner = top(tally);
      if (winner) crowned.set(winner.id, (crowned.get(winner.id) ?? 0) + 1);
    }
    const most = top(crowned);
    if (most) {
      out.push({
        emoji: "🏅",
        title: S.mostMost,
        winner: name(most.id),
        detail: S.mostMostDetail(most.n),
        winnerId: most.id,
      });
    }
  }

  return out;
}
