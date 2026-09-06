import { h, bdi, outOf, toast, buzz, clear } from "../ui/dom";
import { confirmSheet } from "../ui/sheet";
import { POINTS } from "../config";
import { me } from "../identity";
import * as sync from "../sync";
import { getWorld, onWorld } from "../world";
import { nameOf, type World } from "../store";
import { go } from "../router";
import { strings, fmt } from "../i18n";

const S = strings({
  he: {
    title: "🤥 שתי אמיתות ושקר",
    back: "חזרה",
    toastGuess: "מנחשים! 🕵️",
    toastReveal: "התשובות נחשפו 🎭",
    toastSubmit: "חזרנו לשלב השליחה",
    alreadySent: " כבר שלחו",
    submitIntro: "כתבו שלוש עובדות על עצמכם — שתיים נכונות ואחת שקר. סמנו איזו היא השקר.",
    sent: "שלחתם ✅",
    theLie: "השקר",
    truth: "אמת",
    editAgain: "לערוך מחדש",
    threeFacts: "שלוש עובדות עליכם",
    factN: (n: number) => `עובדה ${fmt(n)}`,
    thisIsLie: "זה השקר ✓",
    markLie: "סמנו כשקר",
    fillAll: "צריך למלא את שלושתן.",
    confirmTitle: "לשלוח את השלשה?",
    send: "שלחו",
    armed: "בטוחים? לחצו שוב",
    toastSent: "נשלח 🤥",
    guessIntro: "לכל אחד — נחשו איזו משלוש האמירות היא השקר.",
    youGuessed: "ניחשתם ",
    noTrios: "עדיין אין שלשות לנחש עליהן.",
    guessedPill: "ניחשתם",
    yourPick: "הבחירה שלכם",
    yourResults: "התוצאות שלכם",
    resultsSpotted: "זיהיתם ",
    resultsLies: " שקרים · הצלחתם לרמות ",
    resultsPeople: " אנשים",
    pointsFrom: " נקודות מהפעילות הזו",
    gotIt: "צדקתם ✓",
    missed: "פספסתם",
    noGuess: "לא ניחשתם",
    liePill: "שקר 🤥",
    youPicked: "בחרתם",
    fooledCount: " רומו",
    topLiars: "🎭 השקרנים הגדולים",
  },
  en: {
    title: "🤥 Two Truths and a Lie",
    back: "Back",
    toastGuess: "Time to guess! 🕵️",
    toastReveal: "The answers are out 🎭",
    toastSubmit: "Back to the submit round",
    alreadySent: " have sent theirs",
    submitIntro: "Write three facts about yourself — two true, one a lie. Mark which one is the lie.",
    sent: "Sent ✅",
    theLie: "The lie",
    truth: "Truth",
    editAgain: "Edit",
    threeFacts: "Three facts about you",
    factN: (n: number) => `Fact ${fmt(n)}`,
    thisIsLie: "This is the lie ✓",
    markLie: "Mark as the lie",
    fillAll: "Fill in all three.",
    confirmTitle: "Send your trio?",
    send: "Send",
    armed: "Sure? Tap again",
    toastSent: "Sent 🤥",
    guessIntro: "For each person, guess which of the three is the lie.",
    youGuessed: "You guessed ",
    noTrios: "No trios to guess on yet.",
    guessedPill: "Guessed",
    yourPick: "Your pick",
    yourResults: "Your results",
    resultsSpotted: "You spotted ",
    resultsLies: " lies · fooled ",
    resultsPeople: " people",
    pointsFrom: " points from this activity",
    gotIt: "Got it ✓",
    missed: "Missed",
    noGuess: "No guess",
    liePill: "Lie 🤥",
    youPicked: "Picked",
    fooledCount: " fooled",
    topLiars: "🎭 Biggest liars",
  },
});

/**
 * Two truths and a lie, in three host-advanced phases.
 *
 * The statements are shuffled ONCE, at submit time, and stored already-shuffled
 * in the event. Not per-client from a shared seed — that would mean "statement
 * number 2" could denote different things on different phones, which is a whole
 * class of bug for no benefit. Cheat protection was explicitly waived, so
 * there is no reason to hide the lie index from the payload.
 */
export function truthsScreen(root: HTMLElement): () => void {
  const head = h("div.screen-head");
  const body = h("div");
  root.append(head, body);

  let lastPhase = getWorld().truthsPhase;
  let iSubmitted = getWorld().trios.has(me.id);

  function render(): void {
    const w = getWorld();
    clear(head);
    head.append(
      h("h1", null, S.title),
      h("button.btn.btn-sm", { onclick: () => go("#/") }, S.back)
    );

    clear(body);
    if (w.truthsPhase === "submit") submitPhase(w, body);
    else if (w.truthsPhase === "guess") guessPhase(w, body);
    else revealPhase(w, body);
  }

  render();

  return onWorld(() => {
    const w = getWorld();
    // A phase change is the one thing worth interrupting someone for.
    if (w.truthsPhase !== lastPhase) {
      lastPhase = w.truthsPhase;
      buzz(120);
      toast(
        w.truthsPhase === "guess"
          ? S.toastGuess
          : w.truthsPhase === "reveal"
            ? S.toastReveal
            : S.toastSubmit
      );
      render();
      return;
    }
    if (w.truthsPhase !== "submit") {
      render();
      return;
    }

    // In the submit phase the screen owns three text inputs, so a blanket
    // re-render on every world change would clobber someone mid-sentence
    // whenever anyone else submitted. Re-render only when OUR OWN submission
    // state flips — our own action, so there is no typing to lose — and
    // otherwise just refresh the "how many have sent" counter in place.
    const nowSubmitted = w.trios.has(me.id);
    if (nowSubmitted !== iSubmitted) {
      iSubmitted = nowSubmitted;
      render();
      return;
    }
    const counter = body.querySelector(".js-trio-count");
    if (counter) {
      counter.replaceChildren(outOf(w.trios.size, w.players.size), S.alreadySent);
    }
  });
}

/* --- Phase 1: submit ---------------------------------------------------- */

function submitPhase(w: World, body: HTMLElement): void {
  const mine = w.trios.get(me.id);

  body.append(
    h(
      "div.panel",
      null,
      h("p", null, S.submitIntro),
      h("div.muted.js-trio-count", null, outOf(w.trios.size, w.players.size), S.alreadySent)
    )
  );

  if (mine) {
    const panel = h("div.panel", null, h("h2", null, S.sent));
    mine.statements.forEach((st, i) => {
      panel.append(
        h(
          "div.row",
          null,
          h("div.row-main", { dir: "auto" }, st),
          i === mine.lie ? h("span.pill.warn", null, S.theLie) : h("span.pill", null, S.truth)
        )
      );
    });
    panel.append(
      h(
        "button.btn.btn-sm.btn-block",
        { style: "margin-block-start:10px", onclick: () => showForm(panel) },
        S.editAgain
      )
    );
    body.append(panel);
    return;
  }

  const formPanel = h("div.panel");
  body.append(formPanel);
  showForm(formPanel);

  function showForm(target: HTMLElement): void {
    clear(target);
    target.append(h("h2", null, S.threeFacts));

    const inputs: HTMLInputElement[] = [];
    let lie = 0;
    const radios: HTMLElement[] = [];

    for (let i = 0; i < 3; i++) {
      const input = h("input", {
        type: "text",
        maxlength: "120",
        dir: "auto",
        placeholder: S.factN(i + 1),
      }) as HTMLInputElement;
      if (mine) input.value = mine.statements[i];
      inputs.push(input);

      const radio = h(
        "button.btn.btn-sm",
        {
          onclick: () => {
            lie = i;
            radios.forEach((r, j) => {
              r.classList.toggle("btn-primary", j === i);
              r.textContent = j === i ? S.thisIsLie : S.markLie;
            });
          },
        },
        S.markLie
      );
      radios.push(radio);

      target.append(
        h("div", { style: "margin-block-end:12px" }, input, h("div", { style: "margin-block-start:6px" }, radio))
      );
    }
    if (mine) {
      lie = mine.lie;
      radios[lie].classList.add("btn-primary");
      radios[lie].textContent = S.thisIsLie;
    } else {
      radios[0].classList.add("btn-primary");
      radios[0].textContent = S.thisIsLie;
    }

    const err = h("div.gate-err");
    target.append(
      err,
      h(
        "button.btn.btn-primary.btn-block",
        {
          onclick: () => {
            const statements = inputs.map((i) => i.value.trim());
            if (statements.some((s) => !s)) {
              err.textContent = S.fillAll;
              return;
            }
            confirmSheet({
              title: S.confirmTitle,
              body: h(
                "div",
                null,
                ...statements.map((st, i) =>
                  h("div.row-sub", { dir: "auto" }, (i === lie ? "🤥 " : "✅ ") + st)
                )
              ),
              confirmLabel: S.send,
              armedLabel: S.armed,
              onConfirm: () => {
                sync.post("t.submit", { statements, lie });
                toast(S.toastSent);
                buzz();
              },
            });
          },
        },
        S.send
      )
    );
  }
}

/* --- Phase 2: guess ----------------------------------------------------- */

function guessPhase(w: World, body: HTMLElement): void {
  // Everyone guesses about everyone else — including people who never
  // submitted, who simply have no trio of their own to be guessed on.
  const targets = [...w.trios.keys()].filter((id) => id !== me.id);
  const mine = w.guesses.get(me.id) ?? new Map<string, number>();

  body.append(
    h(
      "div.panel",
      null,
      h("p", null, S.guessIntro),
      h("div.muted", null, S.youGuessed, outOf(mine.size, targets.length))
    )
  );

  if (!targets.length) {
    body.append(h("div.panel.center", null, h("p", null, S.noTrios)));
    return;
  }

  for (const targetId of targets) {
    const trio = w.trios.get(targetId)!;
    const guessed = mine.get(targetId);
    const panel = h("div.panel");
    panel.append(
      h(
        "h2",
        { dir: "auto" },
        nameOf(w, targetId),
        guessed !== undefined ? h("span.pill", { style: "margin-inline-start:8px" }, S.guessedPill) : ""
      )
    );

    trio.statements.forEach((st, i) => {
      panel.append(
        h(
          "button.card",
          {
            class: guessed === i ? "" : "",
            style:
              guessed === i
                ? "border-color:var(--accent);background:var(--panel-2)"
                : "",
            onclick: () => {
              sync.post("t.guess", { target: targetId, index: i });
              buzz();
            },
          },
          h("div", { dir: "auto" }, st),
          guessed === i ? h("div.card-status", null, S.yourPick) : null
        )
      );
    });
    body.append(panel);
  }
}

/* --- Phase 3: reveal ---------------------------------------------------- */

function revealPhase(w: World, body: HTMLElement): void {
  const myGuesses = w.guesses.get(me.id) ?? new Map<string, number>();
  let correct = 0;
  let fooled = 0;

  for (const [target, index] of myGuesses) {
    const trio = w.trios.get(target);
    if (trio && index === trio.lie) correct++;
  }
  for (const [guesser, picks] of w.guesses) {
    if (guesser === me.id) continue;
    const pick = picks.get(me.id);
    const mine = w.trios.get(me.id);
    if (mine && pick !== undefined && pick !== mine.lie) fooled++;
  }

  body.append(
    h(
      "div.panel.center",
      null,
      h("h2", null, S.yourResults),
      h("p", null, S.resultsSpotted, bdi(correct), S.resultsLies, bdi(fooled), S.resultsPeople),
      h(
        "div.muted",
        null,
        bdi(correct * POINTS.truthsCorrectGuess + fooled * POINTS.truthsFooledEach),
        S.pointsFrom
      )
    )
  );

  for (const [targetId, trio] of w.trios) {
    if (targetId === me.id) continue;
    const myPick = myGuesses.get(targetId);
    const panel = h("div.panel");
    panel.append(
      h(
        "h2",
        { dir: "auto" },
        nameOf(w, targetId),
        myPick === trio.lie
          ? h("span.pill.warn", { style: "margin-inline-start:8px" }, S.gotIt)
          : myPick !== undefined
            ? h("span.pill", { style: "margin-inline-start:8px" }, S.missed)
            : h("span.pill", { style: "margin-inline-start:8px" }, S.noGuess)
      )
    );
    trio.statements.forEach((st, i) => {
      const isLie = i === trio.lie;
      panel.append(
        h(
          "div.row",
          null,
          h("div.row-main", { dir: "auto", class: isLie ? "" : "muted" }, st),
          isLie ? h("span.pill.warn", null, S.liePill) : h("span.pill", null, S.truth),
          myPick === i ? h("span.pill", null, S.youPicked) : null
        )
      );
    });
    body.append(panel);
  }

  // Who fooled the most people — the fun ranking, shown to everyone.
  const liars = [...w.trios.keys()]
    .map((id) => {
      let n = 0;
      for (const [guesser, picks] of w.guesses) {
        if (guesser === id) continue;
        const pick = picks.get(id);
        if (pick !== undefined && pick !== w.trios.get(id)!.lie) n++;
      }
      return { id, n };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  if (liars.length) {
    const table = h("table.standings");
    for (const l of liars) {
      table.append(
        h(
          "tr",
          { class: l.id === me.id ? "me" : "" },
          h("td", { dir: "auto" }, nameOf(w, l.id)),
          h("td.col-score", null, bdi(l.n), S.fooledCount)
        )
      );
    }
    body.append(h("div.panel", null, h("h2", null, S.topLiars), table));
  }
}
