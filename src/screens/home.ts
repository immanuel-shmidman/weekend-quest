import { h, bdi, outOf, heCount } from "../ui/dom";
import { activities } from "../config";
import { go, refresh } from "../router";
import { getWorld } from "../world";
import { standings, type World } from "../store";
import { me } from "../identity";
import { installBanner } from "../ui/install";
import { getRoom, activityOn } from "../room";
import { strings, lang, setLang, LANG_LABEL } from "../i18n";
import { updateScorebar } from "../ui/scorebar";
import { confirmSheet } from "../ui/sheet";
import * as sync from "../sync";

const S = strings({
  he: {
    fallbackTitle: "נופש",
    hello: (name: string) => `שלום, ${name}`,
    guest: "אורח",
    none: "עוד לא נפתחו פעילויות.",
    noneSub: "המארגנים עובדים על זה 🛠️",
    standings: "טבלת האירוע",
    fullTable: "כל הטבלה",
    bingoPropose: "שלב ההצעות · ",
    bingoProposed: " משבצות הוצעו",
    bingoWon: "יש בינגו! 🎉",
    bingoMarked: " משבצות סומנו",
    truthsSent: " שלחו שלשות",
    truthsGuessed: "ניחשתם ",
    truthsRevealed: "התוצאות פורסמו",
    quizAnswered: "עניתם על ",
    oneQuestion: "שאלה אחת",
    questions: "שאלות",
    quizNone: "עוד לא התחלתם",
    supNone: "עוד אין שאלות — הוסיפו אחת",
    supVoted: " · הצבעתם ב-",
    wallEmpty: "הקיר עוד ריק",
    oneQuote: "ציטוט אחד",
    quotes: "ציטוטים",
    oneReaction: "תגובה אחת",
    reactions: "תגובות",
    awards: "מחושב מכל מה שקרה עד עכשיו",
    makeYourOwn: "רוצים כזה לאירוע שלכם? יוצרים אירוע חדש",
    feedback: "🐞 מצאתם באג? יש רעיון? ספרו לנו",
    hosts: "מארגנים",
    leave: "יציאה מהאירוע",
    leaveTitle: "לצאת מהאירוע?",
    leaveBody: "הכינוי, הלוח והניקוד שלכם נשמרים. כדי לחזור צריך את הקישור או הקוד ואת הסיסמה — והשם שלכם יחכה לכם.",
    leavePending: "שימו לב: יש שינויים שעוד לא נשלחו לשרת. עדיף לחכות רגע לחיבור.",
    leaveConfirm: "יוצאים",
    leaveArmed: "בטוחים? לחצו שוב",
  },
  en: {
    fallbackTitle: "Weekend",
    hello: (name: string) => `Hi, ${name}`,
    guest: "Guest",
    none: "No activities are open yet.",
    noneSub: "The hosts are working on it 🛠️",
    standings: "Standings",
    fullTable: "Full table",
    bingoPropose: "Proposing · ",
    bingoProposed: " squares suggested",
    bingoWon: "Bingo! 🎉",
    bingoMarked: " squares marked",
    truthsSent: " sent their trio",
    truthsGuessed: "You guessed ",
    truthsRevealed: "Results are out",
    quizAnswered: "Answered ",
    oneQuestion: "one question",
    questions: "questions",
    quizNone: "Not started yet",
    supNone: "No questions yet — add one",
    supVoted: " · you voted in ",
    wallEmpty: "The wall is still empty",
    oneQuote: "one quote",
    quotes: "quotes",
    oneReaction: "one reaction",
    reactions: "reactions",
    awards: "Computed from everything so far",
    makeYourOwn: "Want one for your own event? Create a new event",
    feedback: "🐞 Found a bug? Got an idea? Tell us",
    hosts: "Hosts",
    leave: "Leave this event",
    leaveTitle: "Leave the event?",
    leaveBody: "Your nickname, board and score are kept. To come back you need the link or code and the password — your name will be waiting.",
    leavePending: "Note: some changes haven't reached the server yet. Better to wait a moment for a connection.",
    leaveConfirm: "Leave",
    leaveArmed: "Sure? Tap again",
  },
});

/**
 * Home: the three activity cards, each with a live status line folded from the
 * world, then a compact standings strip. Activities with `built: false` are
 * simply absent — the mechanism (from birthday-quest's src/levels.ts) by which
 * an unfinished activity never looks broken.
 */
export function homeScreen(root: HTMLElement): void {
  const w = getWorld();

  // The language toggle lives here, in the header, because home is the one
  // screen everybody passes through. Switching re-renders in place.
  const other = lang() === "he" ? "en" : "he";
  const toggle = h(
    "button.link",
    {
      onclick: () => {
        setLang(other);
        updateScorebar(getWorld());
        refresh();
      },
    },
    LANG_LABEL[other]
  );
  root.append(
    h(
      "div.screen-head",
      null,
      h(
        "div",
        null,
        h("h1", { dir: "auto" }, getRoom().name || S.fallbackTitle),
        h("div.muted", { dir: "auto" }, S.hello(me.name || S.guest), " · ", toggle)
      )
    )
  );

  root.append(installBanner());

  // `built` hides what the code cannot do yet; `activityOn` hides what this
  // event's host switched off. Both look identical to a guest: simply absent.
  const shown = activities().filter((a) => a.built && activityOn(a.key));
  for (const a of shown) {
    root.append(
      h(
        "button.card",
        { onclick: () => go(a.route) },
        h(
          "div.card-head",
          null,
          h("span.card-emoji", null, a.emoji),
          h("span.card-title", null, a.title)
        ),
        h("div.card-blurb", null, a.blurb),
        h("div.card-status", null, statusLine(w, a.key))
      )
    );
  }

  if (!shown.length) {
    root.append(
      h(
        "div.panel.center",
        null,
        h("p", null, S.none),
        h("div.muted", null, S.noneSub)
      )
    );
  }

  root.append(
    h(
      "div.center",
      { style: "margin-block:6px 14px" },
      h("button.link", { onclick: () => go("#/host") }, S.hosts),
      " · ",
      h("button.link", { onclick: leaveEvent }, S.leave)
    )
  );

  // Top of the standings, inline. The full table is always one tap away via
  // the bar at the bottom of the screen.
  const rows = standings(w);
  if (rows.length) {
    const table = h("table.standings");
    for (const r of rows.slice(0, 5)) {
      const tr = h("tr", { class: r.id === me.id ? "me" : "" });
      tr.append(
        h("td.col-rank", null, bdi(r.rank)),
        h("td", { dir: "auto" }, r.name),
        h("td.col-score", null, bdi(r.score))
      );
      table.append(tr);
    }
    root.append(
      h(
        "div.panel",
        null,
        h("h2", null, S.standings),
        table,
        rows.length > 5
          ? h(
              "button.btn.btn-sm.btn-block",
              { onclick: () => go("#/scores"), style: "margin-block-start:10px" },
              S.fullTable
            )
          : null
      )
    );
  }

  root.append(
    h("div.center", { style: "margin-block-start:18px" }, h("button.link", { onclick: () => go("#/feedback") }, S.feedback)),
    h("div.center", { style: "margin-block-start:10px" }, h("button.link", { onclick: () => go("#/new") }, S.makeYourOwn))
  );
}

function leaveEvent(): void {
  confirmSheet({
    title: S.leaveTitle,
    body: h("div", null, h("div.muted", null, S.leaveBody), sync.pendingCount() ? h("div.pill.warn", { style: "display:block;margin-block-start:8px" }, S.leavePending) : null),
    confirmLabel: S.leaveConfirm,
    armedLabel: S.leaveArmed,
    onConfirm: () => {
      me.leaveRoom();
      // A real navigation to the room-less URL: no ?r=, landing page.
      const url = new URL(location.href);
      url.search = "";
      url.hash = "#/start";
      location.href = url.toString();
    },
  });
}

function statusLine(w: World, key: string): HTMLElement | string {
  switch (key) {
    case "bingo": {
      if (w.bingoPhase === "propose") {
        return h("span", null, S.bingoPropose, bdi(w.proposals.length), S.bingoProposed);
      }
      const total = w.freeze?.poolIds.length ?? 0;
      const winner = [...w.bingos.keys()][0];
      if (winner) return S.bingoWon;
      return h("span", null, outOf(w.marks.size, total), S.bingoMarked);
    }
    case "truths": {
      if (w.truthsPhase === "submit") {
        return h("span", null, outOf(w.trios.size, w.players.size), S.truthsSent);
      }
      if (w.truthsPhase === "guess") {
        const mine = w.guesses.get(me.id)?.size ?? 0;
        const targets = Math.max(0, w.trios.size - (w.trios.has(me.id) ? 1 : 0));
        return h("span", null, S.truthsGuessed, outOf(mine, targets));
      }
      return S.truthsRevealed;
    }
    case "quiz": {
      const answered = w.quiz.get(me.id)?.size ?? 0;
      return answered ? h("span", null, S.quizAnswered, heCount(answered, S.oneQuestion, S.questions)) : S.quizNone;
    }
    case "superlatives": {
      if (!w.superlatives.length) return S.supNone;
      const voted = [...w.votes.values()].filter((v) => v.has(me.id)).length;
      return h("span", null, heCount(w.superlatives.length, S.oneQuestion, S.questions), S.supVoted, bdi(voted));
    }
    case "wall": {
      if (!w.wall.length) return S.wallEmpty;
      let reactions = 0;
      for (const r of w.reactions.values()) reactions += r.size;
      return h("span", null, heCount(w.wall.length, S.oneQuote, S.quotes), " · ", heCount(reactions, S.oneReaction, S.reactions));
    }
    case "awards":
      return S.awards;
    default:
      return "";
  }
}
