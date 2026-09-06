import { h, bdi, outOf, toast, buzz, clear } from "../ui/dom";
import { confirmSheet, openSheet } from "../ui/sheet";
import { minProposals } from "../room";
import { me } from "../identity";
import * as sync from "../sync";
import { getWorld, onWorld } from "../world";
import { boardFor, nameOf, proposalById, sideOf, type World } from "../store";
import { cellsOnCompletedLines, completedLines, similarity } from "../lib/bingo";
import { go } from "../router";
import { strings } from "../i18n";

const S = strings({
  he: {
    proposeTitle: "🎯 בינגו",
    back: "חזרה",
    introA: "הציעו דברים שמישהו יגיד או שיקרו בנופש. כל אחד מציע ",
    introB: ". בסוף כולם יקבלו לוח משלהם מתוך המאגר המשותף.",
    sentTitle: "שלחתם ✅",
    sentSub: "אפשר להמתין למארגנים שיסגרו את המאגר ויחלקו לוחות — או להוסיף עוד רעיון.",
    addMore: "הוסיפו עוד אחת",
    yours: "ההצעות שלכם",
    placeholderFirst: "למשל: מישהו שורף את הפיתות",
    placeholderMore: "עוד אחת…",
    send: "שלחו למאגר",
    similarTo: "דומה למשהו שכבר הוצע: ",
    tooSimilar: "שתי ההצעות שלכם דומות מדי זו לזו.",
    confirmTitle: (n: number) => `לשלוח ${n === 1 ? "הצעה אחת" : n + " הצעות"} למאגר?`,
    confirmSend: "שלחו",
    armed: "בטוחים? לחצו שוב",
    sentToast: "ההצעות נשלחו 🎯",
    alreadyProposed: "מה כבר הוצע ",
    alreadySub: "כדי שלא תציעו את אותו הדבר פעמיים.",
    noneYet: "עדיין אין הצעות — תהיו הראשונים.",
    playTitle: "🎯 בינגו",
    boardView: "לוח",
    listView: "רשימה",
    notFrozen: "המאגר עדיין לא נסגר.",
    notFrozenSub: "ברגע שהמארגנים יחלקו לוחות, הלוח שלכם יופיע כאן.",
    bingoToast: "בינגו! 🎉",
    markedSuffix: " סומנו",
    bingoLinesA: "בינגו! ",
    bingoLinesB: " שורות",
    noBingo: "אין בינגו עדיין",
    firstBingo: "🏆 הבינגו הראשון: ",
    shortBoardA: "המאגר קטן מ-",
    shortBoardB: " משבצות, אז הלוח חלקי.",
    markedBy: (name: string) => `סומן על ידי ${name}`,
    unmarkedToast: "הסימון בוטל",
    unmark: "בטלו סימון",
    close: "סגירה",
    markBody: "סימון משפיע על הלוחות של כולם.",
    markConfirm: "קרה! 🎉",
    markArmed: "לסמן לכולם?",
    squareMarked: "משבצת סומנה",
  },
  en: {
    proposeTitle: "🎯 Bingo",
    back: "Back",
    introA: "Suggest things someone will say or that will happen this weekend. Everyone suggests ",
    introB: ". In the end everyone gets their own board from the shared pool.",
    sentTitle: "Sent ✅",
    sentSub: "Now wait for the hosts to close the pool and deal the boards — or add another idea.",
    addMore: "Add another",
    yours: "Your suggestions",
    placeholderFirst: "e.g. someone burns the pitas",
    placeholderMore: "Another one…",
    send: "Send to the pool",
    similarTo: "Looks like something already suggested: ",
    tooSimilar: "Your two suggestions are too alike.",
    confirmTitle: (n: number) => `Send ${n === 1 ? "one suggestion" : n + " suggestions"} to the pool?`,
    confirmSend: "Send",
    armed: "Sure? Tap again",
    sentToast: "Suggestions sent 🎯",
    alreadyProposed: "Already suggested ",
    alreadySub: "So nobody suggests the same thing twice.",
    noneYet: "No suggestions yet — be the first.",
    playTitle: "🎯 Bingo",
    boardView: "Board",
    listView: "List",
    notFrozen: "The pool isn't closed yet.",
    notFrozenSub: "As soon as the hosts deal the boards, yours will show up here.",
    bingoToast: "Bingo! 🎉",
    markedSuffix: " marked",
    bingoLinesA: "Bingo! ",
    bingoLinesB: " lines",
    noBingo: "No bingo yet",
    firstBingo: "🏆 First bingo: ",
    shortBoardA: "The pool has fewer than ",
    shortBoardB: " squares, so the board is partial.",
    markedBy: (name: string) => `Marked by ${name}`,
    unmarkedToast: "Mark removed",
    unmark: "Remove mark",
    close: "Close",
    markBody: "Marking affects everyone's boards.",
    markConfirm: "It happened! 🎉",
    markArmed: "Mark it for everyone?",
    squareMarked: "a square was marked",
  },
});

export function bingoScreen(root: HTMLElement): () => void {
  const w = getWorld();
  return w.bingoPhase === "propose" ? proposeStage(root) : playStage(root);
}

/* -------------------------------------------------------------------------
 * Propose stage
 *
 * People independently suggest the same joke, so this is deliberately a
 * two-step flow: you draft your squares while watching everyone else's
 * proposals arrive live, and a near-duplicate is flagged before you commit.
 * Nothing is written to the log until you press send.
 * ---------------------------------------------------------------------- */

function proposeStage(root: HTMLElement): () => void {
  const drafts: string[] = Array.from({ length: minProposals() }, () => "");

  root.append(
    h(
      "div.screen-head",
      null,
      h("h1", null, S.proposeTitle),
      h("button.btn.btn-sm", { onclick: () => go("#/") }, S.back)
    )
  );

  const mineCount = () => getWorld().proposals.filter((p) => p.by === me.id).length;

  const intro = h("div.panel");
  const form = h("div.panel");
  const listPanel = h("div.panel");
  root.append(intro, form, listPanel);

  function renderIntro(): void {
    clear(intro);
    intro.append(
      h(
        "p",
        null,
        S.introA,
        bdi(minProposals()),
        S.introB
      )
    );
  }

  function renderForm(): void {
    const already = mineCount();
    clear(form);

    // Past the minimum, the form stays open with a single field: ideas are not
    // evenly distributed, and the person with ten of them should not be capped
    // at two while someone else struggles for one.
    const extra = already >= minProposals();
    if (extra) {
      // The previous round's drafts were sent; a fresh field must not inherit
      // them, or the duplicate check flags the person's own square.
      drafts.fill("");
      form.append(h("h2", null, S.sentTitle), h("div.muted", { style: "margin-block-end:8px" }, S.sentSub));
    } else {
      form.append(h("h2", null, S.yours));
    }
    const inputs: HTMLInputElement[] = [];
    const warn = h("div", { style: "margin-block-start:6px" });

    const count = extra ? 1 : minProposals() - already;
    for (let i = 0; i < count; i++) {
      const input = h("input", {
        type: "text",
        maxlength: "90",
        dir: "auto",
        placeholder: i === 0 ? S.placeholderFirst : S.placeholderMore,
        style: "margin-block-end:8px",
        oninput: (e: Event) => {
          drafts[i] = (e.target as HTMLInputElement).value;
          renderWarnings();
        },
      }) as HTMLInputElement;
      input.value = drafts[i] ?? "";
      inputs.push(input);
      form.append(input);
    }

    const send = h("button.btn.btn-block" + (extra ? "" : ".btn-primary"), { onclick: commit }, extra ? S.addMore : S.send);
    form.append(warn, send);

    /** Flag anything close to an existing proposal, before it reaches the pool. */
    function renderWarnings(): void {
      clear(warn);
      const existing = getWorld().proposals;
      const texts = inputs.map((inp) => inp.value.trim()).filter(Boolean);

      for (const text of texts) {
        const near = existing.find((p) => similarity(p.text, text) >= 0.6);
        if (near) {
          warn.append(
            h(
              "div.pill.warn",
              { style: "display:block;margin-block-end:6px", dir: "auto" },
              S.similarTo,
              near.text
            )
          );
        }
      }
      const dupWithinDraft =
        texts.length === 2 && similarity(texts[0], texts[1]) >= 0.6;
      if (dupWithinDraft) {
        warn.append(
          h("div.pill.warn", { style: "display:block;margin-block-end:6px" }, S.tooSimilar)
        );
      }
      send.toggleAttribute("disabled", texts.length === 0);
    }

    function commit(): void {
      const texts = inputs.map((inp) => inp.value.trim()).filter(Boolean);
      if (!texts.length) return;

      confirmSheet({
        title: S.confirmTitle(texts.length),
        body: h(
          "div",
          null,
          ...texts.map((t) => h("div.row-sub", { dir: "auto" }, "• " + t))
        ),
        confirmLabel: S.confirmSend,
        armedLabel: S.armed,
        onConfirm: () => {
          for (const text of texts) sync.post("b.propose", { text });
          toast(S.sentToast);
          buzz();
        },
      });
    }

    renderWarnings();
  }

  function renderList(): void {
    const w = getWorld();
    clear(listPanel);
    listPanel.append(
      h(
        "h2",
        null,
        S.alreadyProposed,
        h("span.pill", null, bdi(w.proposals.length))
      ),
      h("div.muted", { style: "margin-block-end:8px" }, S.alreadySub)
    );

    if (!w.proposals.length) {
      listPanel.append(h("div.muted", null, S.noneYet));
      return;
    }
    for (const p of [...w.proposals].reverse()) {
      listPanel.append(
        h(
          "div.row",
          null,
          h(
            "div.row-main",
            null,
            h("div", { dir: "auto" }, p.text),
            h("div.row-sub", { dir: "auto" }, nameOf(w, p.by))
          )
        )
      );
    }
  }

  renderIntro();
  renderForm();
  renderList();

  // Subscribe rather than letting the router re-render: this screen has text
  // inputs, and a blanket re-render would steal focus mid-typing.
  //
  // Rebuilding the form is only safe when OUR OWN proposal count changes —
  // that is our own action. Someone else proposing a square must refresh the
  // list without touching the inputs, or with 14 people typing at once
  // everybody loses their cursor every few seconds.
  let mine = mineCount();
  return onWorld(() => {
    const now = mineCount();
    if (now !== mine) {
      mine = now;
      renderForm();
    }
    renderList();
  });
}

/* -------------------------------------------------------------------------
 * Play stage
 * ---------------------------------------------------------------------- */

function playStage(root: HTMLElement): () => void {
  let listView = false;
  let lastMarkCount = getWorld().marks.size;
  let announced = getWorld().bingos.has(me.id);

  const head = h("div.screen-head");
  const body = h("div");
  root.append(head, body);

  function render(): void {
    const w = getWorld();
    const board = boardFor(w, me.id);

    clear(head);
    head.append(
      h("h1", null, S.playTitle),
      h(
        "div",
        { style: "display:flex;gap:8px" },
        h(
          "button.btn.btn-sm",
          { onclick: () => ((listView = !listView), render()) },
          listView ? S.boardView : S.listView
        ),
        h("button.btn.btn-sm", { onclick: () => go("#/") }, S.back)
      )
    );

    clear(body);

    if (!board) {
      body.append(
        h(
          "div.panel.center",
          null,
          h("p", null, S.notFrozen),
          h("div.muted", null, S.notFrozenSub)
        )
      );
      return;
    }

    const marked = new Set(w.marks.keys());
    const side = sideOf(w);
    const done = completedLines(board, marked, side);
    const onLine = cellsOnCompletedLines(board, marked, side);

    if (done.length && !announced) {
      announced = true;
      sync.post("b.bingo", { line: [...onLine] });
      toast(S.bingoToast);
      buzz(180);
    }

    body.append(
      h(
        "div.panel",
        null,
        h(
          "div",
          { style: "display:flex;justify-content:space-between;align-items:center" },
          h("span", null, outOf(marked.size, w.freeze?.poolIds.length ?? 0), S.markedSuffix),
          done.length
            ? h("span.pill.warn", null, S.bingoLinesA, bdi(done.length), S.bingoLinesB)
            : h("span.pill", null, S.noBingo)
        )
      )
    );

    const winnerId = firstBingo(w);
    if (winnerId) {
      body.append(
        h(
          "div.panel.center",
          null,
          h("div", { dir: "auto" }, S.firstBingo, h("strong", null, nameOf(w, winnerId)))
        )
      );
    }

    body.append(listView ? renderList(w, board, marked) : renderBoard(w, board, marked, onLine));
  }

  function renderBoard(
    w: World,
    board: string[],
    marked: Set<string>,
    onLine: Set<number>
  ): HTMLElement {
    // Column count follows the event's grid side; the stylesheet's repeat(4)
    // is only the default.
    const side = sideOf(w);
    const grid = h("div.board", { style: `grid-template-columns:repeat(${side}, 1fr)` });
    board.forEach((squareId, idx) => {
      const prop = proposalById(w, squareId);
      const isMarked = marked.has(squareId);
      const cell = h(
        "button.cell",
        {
          class: [isMarked ? "marked" : "", onLine.has(idx) ? "on-line" : ""].join(" "),
          onclick: () => openSquare(squareId),
        },
        h("span", { dir: "auto" }, prop?.text ?? "—")
      );
      grid.append(cell);
    });
    // A short board means the pool was smaller than the grid; say so rather
    // than rendering a silently broken grid.
    const cells = sideOf(w) ** 2;
    if (board.length < cells) {
      const note = h(
        "div.muted.center",
        null,
        S.shortBoardA,
        bdi(cells),
        S.shortBoardB
      );
      return h("div", null, grid, note);
    }
    return grid;
  }

  function renderList(w: World, board: string[], marked: Set<string>): HTMLElement {
    const panel = h("div.panel");
    // Full text is unreadable at ~85px, so this view is where people actually
    // read their squares.
    board.forEach((squareId) => {
      const prop = proposalById(w, squareId);
      const isMarked = marked.has(squareId);
      panel.append(
        h(
          "div.row",
          { onclick: () => openSquare(squareId) },
          h(
            "div.row-main",
            null,
            h("div", { dir: "auto", class: isMarked ? "struck" : "" }, prop?.text ?? "—"),
            isMarked
              ? h("div.row-sub", { dir: "auto" }, S.markedBy(nameOf(w, w.marks.get(squareId)!.by)))
              : null
          ),
          h("span.pill", null, isMarked ? "✓" : "")
        )
      );
    });
    return panel;
  }

  function openSquare(squareId: string): void {
    const w = getWorld();
    const prop = proposalById(w, squareId);
    const mark = w.marks.get(squareId);
    if (!prop) return;

    if (mark) {
      openSheet({
        content: (close) => [
          h("div.sheet-text", { dir: "auto" }, prop.text),
          h("div.muted", { dir: "auto" }, S.markedBy(nameOf(w, mark.by))),
          h(
            "button.btn.btn-danger.btn-block",
            {
              style: "margin-block-start:14px",
              onclick: () => {
                sync.post("b.mark", { square: squareId, on: false });
                toast(S.unmarkedToast);
                close();
              },
            },
            S.unmark
          ),
          h(
            "button.btn.btn-sm.btn-block",
            { onclick: close, style: "margin-block-start:8px;background:transparent" },
            S.close
          ),
        ],
      });
      return;
    }

    confirmSheet({
      title: prop.text,
      body: S.markBody,
      confirmLabel: S.markConfirm,
      armedLabel: S.markArmed,
      onConfirm: () => {
        sync.post("b.mark", { square: squareId, on: true });
        buzz();
      },
    });
  }

  render();

  return onWorld(() => {
    const w = getWorld();
    // Someone else called a square: the ambient signal that keeps a
    // background game feeling alive.
    if (w.marks.size > lastMarkCount) {
      const newest = [...w.marks.entries()].sort((a, b) => b[1].ts - a[1].ts)[0];
      if (newest && newest[1].by !== me.id) {
        const prop = proposalById(w, newest[0]);
        toast(`${nameOf(w, newest[1].by)}: ${prop?.text ?? S.squareMarked} ✓`);
        buzz();
      }
    }
    lastMarkCount = w.marks.size;
    render();
  });
}

function firstBingo(w: World): string | null {
  let best: { id: string; eventId: number } | null = null;
  for (const [player, eventId] of w.bingos) {
    if (!best || eventId < best.eventId) best = { id: player, eventId };
  }
  return best?.id ?? null;
}
