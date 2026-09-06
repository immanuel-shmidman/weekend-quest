import { h, bdi, outOf, toast, clear } from "../ui/dom";
import { confirmSheet, openSheet } from "../ui/sheet";
import { hostCode, bingoCells, bingoSide, unlockHost } from "../room";
import { me } from "../identity";
import * as sync from "../sync";
import { getWorld, onWorld } from "../world";
import { nameOf, type World } from "../store";
import { similarity } from "../lib/bingo";
import { go } from "../router";
import { strings } from "../i18n";

const S = strings({
  he: {
    title: "🎛️ מארגנים",
    back: "חזרה",
    unlockTitle: "מארגנים",
    codePlaceholder: "קוד מארגן",
    wrongCode: "קוד שגוי",
    offline: "אין חיבור — נסו שוב",
    unlock: "פתחו",
    readiness: "מצב הקבוצה",
    settings: "⚙️ הגדרות",
    players: "👥 שחקנים",
    playersSub: "לחצו על שם כדי לתקן אותו — למשל טעות הקלדה שנתקעה. השינוי מגיע גם לטלפון של אותו אדם.",
    renameTitle: (name: string) => `שם חדש ל-${name}`,
    renameSave: "שמרו",
    renamed: "השם עודכן",
    noPlayers: "עוד אף אחד לא נרשם.",
    joined: "נרשמו",
    bingoProposals: "הצעות בינגו",
    sentTrios: "שלחו שלשות",
    startedQuiz: "התחילו חידון",
    bingoTitle: "🎯 בינגו",
    phase: "שלב: ",
    phasePropose: "הצעות",
    phasePlay: "משחק",
    frozenA: "המאגר סגור על ",
    frozenB: " משבצות.",
    reopenTitle: "לפתוח מחדש את שלב ההצעות?",
    reopenBody: "הלוחות ייעלמו עד שתסגרו את המאגר שוב. הסימונים הקיימים נשמרים.",
    reopenConfirm: "פתחו מחדש",
    armed: "בטוחים? לחצו שוב",
    reopenedToast: "שלב ההצעות נפתח מחדש",
    reopenBtn: "פתחו מחדש הצעות",
    freezeBtn: "סגרו את המאגר וחלקו לוחות",
    selectedSuffix: " משבצות נבחרו",
    needA: "צריך לפחות ",
    needB: " כדי לחלק לוחות.",
    dupNote: " · דומה להצעה אחרת",
    freezeTitle: "לסגור את המאגר?",
    freezeBody: (n: number) => `${n} משבצות ייכנסו, וכל אחד יקבל לוח משלו. אפשר לפתוח מחדש אחר כך.`,
    freezeConfirm: "סגרו וחלקו",
    dealtToast: "הלוחות חולקו 🎯",
    truthsSubmit: "שליחה",
    truthsGuess: "ניחושים",
    truthsReveal: "חשיפה",
    truthsTitle: "🤥 שתי אמיתות ושקר",
    phaseToast: "השלב עודכן",
    sentSuffix: " שלחו",
    toGuessTitle: "לעבור לניחושים?",
    toGuessBody: (n: number) => `${n} שלשות נשלחו. מי שלא שלח עדיין יוכל לנחש, אבל לא יופיע בסבב.`,
    toGuessLabel: "פתחו ניחושים",
    guessedSuffix: " ניחשו",
    revealTitle: "לחשוף את התשובות?",
    revealBody: "אחרי החשיפה הניקוד נקבע ואי אפשר לשנות ניחושים.",
    revealLabel: "חשפו תשובות",
    backToSubmitTitle: "לחזור לשלב השליחה?",
    backToSubmitBody: "מי שעוד לא שלח שלשה יוכל לשלוח.",
    backToSubmitLabel: "חזרה לשליחה",
    backToGuessTitle: "לחזור לניחושים?",
    backToGuessBody: "החשיפה תיסגר והניקוד יחושב מחדש בסוף.",
    backToGuessLabel: "חזרה לניחושים",
  },
  en: {
    title: "🎛️ Hosts",
    back: "Back",
    unlockTitle: "Hosts",
    codePlaceholder: "Host code",
    wrongCode: "Wrong code",
    offline: "No connection — try again",
    unlock: "Unlock",
    readiness: "Group status",
    settings: "⚙️ Settings",
    players: "👥 Players",
    playersSub: "Tap a name to fix it — a typo that stuck, say. The change reaches that person's phone too.",
    renameTitle: (name: string) => `New name for ${name}`,
    renameSave: "Save",
    renamed: "Name updated",
    noPlayers: "Nobody has joined yet.",
    joined: "Joined",
    bingoProposals: "Bingo suggestions",
    sentTrios: "Sent trios",
    startedQuiz: "Started the quiz",
    bingoTitle: "🎯 Bingo",
    phase: "Phase: ",
    phasePropose: "proposing",
    phasePlay: "playing",
    frozenA: "Pool closed with ",
    frozenB: " squares.",
    reopenTitle: "Reopen suggestions?",
    reopenBody: "Boards disappear until you close the pool again. Existing marks are kept.",
    reopenConfirm: "Reopen",
    armed: "Sure? Tap again",
    reopenedToast: "Suggestions reopened",
    reopenBtn: "Reopen suggestions",
    freezeBtn: "Close the pool and deal boards",
    selectedSuffix: " squares selected",
    needA: "Need at least ",
    needB: " to deal boards.",
    dupNote: " · similar to another suggestion",
    freezeTitle: "Close the pool?",
    freezeBody: (n: number) => `${n} squares go in, and everyone gets their own board. You can reopen later.`,
    freezeConfirm: "Close and deal",
    dealtToast: "Boards dealt 🎯",
    truthsSubmit: "submitting",
    truthsGuess: "guessing",
    truthsReveal: "reveal",
    truthsTitle: "🤥 Two Truths and a Lie",
    phaseToast: "Phase updated",
    sentSuffix: " sent",
    toGuessTitle: "Move to guessing?",
    toGuessBody: (n: number) => `${n} trios are in. Anyone who hasn't sent one can still guess, but won't be in the round.`,
    toGuessLabel: "Open guessing",
    guessedSuffix: " guessed",
    revealTitle: "Reveal the answers?",
    revealBody: "After the reveal, scores are final and guesses can't be changed.",
    revealLabel: "Reveal answers",
    backToSubmitTitle: "Back to submitting?",
    backToSubmitBody: "Anyone who hasn't sent a trio yet can send one.",
    backToSubmitLabel: "Back to submitting",
    backToGuessTitle: "Back to guessing?",
    backToGuessBody: "The reveal closes and scores are recomputed at the end.",
    backToGuessLabel: "Back to guessing",
  },
});

/**
 * The host screen: phase control and bingo pool curation.
 *
 * Unlocking here is a convenience — the real gate is server-side, where a phase
 * event is rejected unless it carries the room's host code (see
 * functions/api/events.js). Without that, anyone with devtools could shove an
 * activity into its next phase while half the group is still typing. The code
 * is still verified with the server at unlock time, so a typo is refused here
 * rather than surfacing as silently rejected writes later.
 */
export function hostScreen(root: HTMLElement): (() => void) | void {
  if (!me.isHost) return unlockForm(root);

  const head = h("div.screen-head");
  const body = h("div");
  root.append(head, body);

  function render(): void {
    const w = getWorld();
    clear(head);
    head.append(
      h("h1", null, S.title),
      h(
        "div",
        { style: "display:flex;gap:6px" },
        h("button.btn.btn-sm", { onclick: () => go("#/settings") }, S.settings),
        h("button.btn.btn-sm", { onclick: () => go("#/") }, S.back)
      )
    );

    clear(body);
    body.append(readiness(w), playersPanel(w), bingoControls(w, render), truthsControls(w));
  }

  render();
  return onWorld(render);
}

function unlockForm(root: HTMLElement): void {
  root.append(
    h("div.screen-head", null, h("h1", null, S.unlockTitle), h("button.btn.btn-sm", { onclick: () => go("#/") }, S.back))
  );
  const input = h("input", { type: "text", placeholder: S.codePlaceholder, dir: "auto", autocapitalize: "characters" }) as HTMLInputElement;
  const err = h("div.gate-err");
  let busy = false;
  root.append(
    h(
      "div.panel",
      null,
      input,
      h(
        "button.btn.btn-primary.btn-block",
        {
          style: "margin-block-start:10px",
          onclick: async () => {
            if (busy) return;
            busy = true;
            err.textContent = "";
            const result = await unlockHost(input.value.trim());
            busy = false;
            if (result === "ok") {
              location.reload();
              return;
            }
            err.textContent = result === "wrong" ? S.wrongCode : S.offline;
          },
        },
        S.unlock
      ),
      err
    )
  );
}

/* --- Players: fix a nickname ----------------------------------------------- */

function playersPanel(w: World): HTMLElement {
  const panel = h("div.panel", null, h("h2", null, S.players), h("div.muted", { style: "margin-block-end:8px" }, S.playersSub));
  if (!w.players.size) {
    panel.append(h("div.muted", null, S.noPlayers));
    return panel;
  }
  for (const p of w.players.values()) {
    panel.append(
      h(
        "button.row",
        {
          style: "inline-size:100%;background:none;border:0;color:inherit;font:inherit;cursor:pointer;text-align:start",
          onclick: () => renameSheet(p.id, p.name),
        },
        h("div.row-main", null, h("div", { dir: "auto" }, p.name)),
        h("div.muted", null, "✏️")
      )
    );
  }
  return panel;
}

function renameSheet(playerId: string, current: string): void {
  openSheet({
    content: (close) => {
      const input = h("input", { type: "text", maxlength: "20", dir: "auto", value: current }) as HTMLInputElement;
      const save = () => {
        const name = input.value.trim().slice(0, 20);
        if (!name || name === current) return close();
        sync.post("rename", { target: playerId, name, hostCode: hostCode() });
        toast(S.renamed);
        close();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
      });
      setTimeout(() => input.select(), 0);
      return [
        h("div.sheet-text", { dir: "auto" }, S.renameTitle(current)),
        h("div", { style: "margin-block-start:10px" }, input),
        h("button.btn.btn-primary.btn-block", { style: "margin-block-start:12px", onclick: save }, S.renameSave),
      ];
    },
  });
}

function readiness(w: World): HTMLElement {
  const answered = [...w.quiz.values()].filter((m) => m.size > 0).length;
  return h(
    "div.panel",
    null,
    h("h2", null, S.readiness),
    stat(S.joined, String(w.players.size)),
    stat(S.bingoProposals, String(w.proposals.length)),
    stat(S.sentTrios, `${w.trios.size} / ${w.players.size}`),
    stat(S.startedQuiz, String(answered))
  );
}

function stat(label: string, value: string): HTMLElement {
  return h(
    "div.row",
    null,
    h("div.row-main", null, label),
    h("div", null, h("bdi", null, value))
  );
}

/* --- Bingo: curate the pool, then freeze ------------------------------- */

function bingoControls(w: World, rerender: () => void): HTMLElement {
  const panel = h("div.panel");
  panel.append(h("h2", null, S.bingoTitle), h("div.muted", null, S.phase + (w.bingoPhase === "propose" ? S.phasePropose : S.phasePlay)));

  if (w.bingoPhase === "play") {
    panel.append(
      h("div", { style: "margin-block-start:10px" }, S.frozenA, bdi(w.freeze?.poolIds.length ?? 0), S.frozenB),
      h(
        "button.btn.btn-sm.btn-block",
        {
          style: "margin-block-start:10px",
          onclick: () =>
            confirmSheet({
              title: S.reopenTitle,
              body: S.reopenBody,
              confirmLabel: S.reopenConfirm,
              armedLabel: S.armed,
              onConfirm: () => {
                sync.post("phase", { activity: "bingo", phase: "propose", hostCode: hostCode() });
                toast(S.reopenedToast);
              },
            }),
        },
        S.reopenBtn
      )
    );
    return panel;
  }

  // Curation: everything checked by default; unchecking is how near-duplicates
  // and anything unkind leave the pool without needing a "hide" event kind.
  const keep = new Set(w.proposals.map((p) => p.id));
  const countLabel = h("div", { style: "margin-block-start:10px" });
  const freezeBtn = h("button.btn.btn-primary.btn-block", { style: "margin-block-start:10px" }, S.freezeBtn);

  const updateCount = () => {
    clear(countLabel);
    countLabel.append(outOf(keep.size, bingoCells()), S.selectedSuffix);
    const enough = keep.size >= bingoCells();
    freezeBtn.toggleAttribute("disabled", !enough);
    if (!enough) {
      countLabel.append(h("div.pill.warn", { style: "display:block;margin-block-start:6px" }, S.needA, bdi(bingoCells()), S.needB));
    }
  };

  const list = h("div", { style: "margin-block-start:10px" });
  for (const p of w.proposals) {
    // Flag likely duplicates so they are easy to spot and uncheck.
    const dup = w.proposals.find((o) => o.id !== p.id && similarity(o.text, p.text) >= 0.6);
    const box = h("input", { type: "checkbox", checked: true, style: "inline-size:auto;min-block-size:0" }) as HTMLInputElement;
    box.checked = true;
    box.addEventListener("change", () => {
      if (box.checked) keep.add(p.id);
      else keep.delete(p.id);
      updateCount();
    });
    list.append(
      h(
        "div.row",
        null,
        box,
        h(
          "div.row-main",
          null,
          h("div", { dir: "auto" }, p.text),
          h("div.row-sub", { dir: "auto" }, nameOf(w, p.by) + (dup ? S.dupNote : ""))
        )
      )
    );
  }

  freezeBtn.addEventListener("click", () => {
    confirmSheet({
      title: S.freezeTitle,
      body: S.freezeBody(keep.size),
      confirmLabel: S.freezeConfirm,
      armedLabel: S.armed,
      onConfirm: () => {
        // The ordered pool AND the grid side travel with the freeze event.
        // Boards derive from (playerId, freezeId, poolIds, side) and nothing
        // else, so they never reshuffle or resize under anyone.
        const poolIds = w.proposals.filter((p) => keep.has(p.id)).map((p) => p.id);
        sync.post("phase", { activity: "bingo", phase: "play", poolIds, side: bingoSide(), hostCode: hostCode() });
        toast(S.dealtToast);
        rerender();
      },
    });
  });

  panel.append(list, countLabel, freezeBtn);
  updateCount();
  return panel;
}

/* --- Two truths: advance the three phases ------------------------------ */

function truthsControls(w: World): HTMLElement {
  const panel = h("div.panel");
  const labels: Record<string, string> = { submit: S.truthsSubmit, guess: S.truthsGuess, reveal: S.truthsReveal };
  panel.append(h("h2", null, S.truthsTitle), h("div.muted", null, S.phase + labels[w.truthsPhase]));

  const advance = (phase: string, title: string, body: string, label: string) =>
    h(
      "button.btn.btn-block",
      {
        style: "margin-block-start:10px",
        onclick: () =>
          confirmSheet({
            title,
            body,
            confirmLabel: label,
            armedLabel: S.armed,
            onConfirm: () => {
              sync.post("phase", { activity: "truths", phase, hostCode: hostCode() });
              toast(S.phaseToast);
            },
          }),
      },
      label
    );

  if (w.truthsPhase === "submit") {
    panel.append(
      h("div", { style: "margin-block-start:8px" }, outOf(w.trios.size, w.players.size), S.sentSuffix),
      advance("guess", S.toGuessTitle, S.toGuessBody(w.trios.size), S.toGuessLabel)
    );
  } else if (w.truthsPhase === "guess") {
    const guessers = [...w.guesses.values()].filter((m) => m.size > 0).length;
    panel.append(
      h("div", { style: "margin-block-start:8px" }, outOf(guessers, w.players.size), S.guessedSuffix),
      advance("reveal", S.revealTitle, S.revealBody, S.revealLabel),
      advance("submit", S.backToSubmitTitle, S.backToSubmitBody, S.backToSubmitLabel)
    );
  } else {
    panel.append(advance("guess", S.backToGuessTitle, S.backToGuessBody, S.backToGuessLabel));
  }

  return panel;
}
