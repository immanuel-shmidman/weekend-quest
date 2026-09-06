import { h, bdi, toast, buzz, clear } from "../ui/dom";
import { me } from "../identity";
import * as sync from "../sync";
import { getWorld, onWorld } from "../world";
import { nameOf, voteTargets, type World } from "../store";
import { go } from "../router";
import { strings } from "../i18n";

const S = strings({
  he: {
    title: "🏅 מי הכי…",
    back: "חזרה",
    placeholder: "מי הכי סביר ש…",
    addQuestion: "הוסיפו שאלה",
    toastAdded: "נוספה שאלה 🏅",
    add: "הוסיפו",
    empty: "עוד אין שאלות.",
    example: "למשל: מי הכי סביר שיאבד את הטלפון?",
    voted: " הצביעו",
    toastRepick: "בחרו מחדש",
    changeVote: "שינוי הצבעה",
  },
  en: {
    title: "🏅 Who's most likely…",
    back: "Back",
    placeholder: "Who's most likely to…",
    addQuestion: "Add a question",
    toastAdded: "Question added 🏅",
    add: "Add",
    empty: "No questions yet.",
    example: "For example: who's most likely to lose their phone?",
    voted: " voted",
    toastRepick: "Pick again",
    changeVote: "Change vote",
  },
});

/**
 * "מי הכי…" — superlatives.
 *
 * Anyone adds a question, everyone votes on a person, results show live as
 * bars. No phases and no host involvement: it is playable from the moment the
 * first question exists, and it stays playable all weekend. That absence of
 * ceremony is the whole point — it fills the five minutes before dinner.
 *
 * Deliberately unscored. Winning "most likely to lose their phone" should be
 * funny, not worth points; attaching a score would make people vote
 * strategically instead of honestly.
 */
export function superlativesScreen(root: HTMLElement): () => void {
  const head = h("div.screen-head");
  const form = h("div.panel");
  const list = h("div");
  root.append(head, form, list);

  function renderHead(): void {
    clear(head);
    head.append(
      h("h1", null, S.title),
      h("button.btn.btn-sm", { onclick: () => go("#/") }, S.back)
    );
  }

  function renderForm(): void {
    clear(form);
    const input = h("input", {
      type: "text",
      maxlength: "80",
      dir: "auto",
      placeholder: S.placeholder,
    }) as HTMLInputElement;

    form.append(
      h("h2", null, S.addQuestion),
      input,
      h(
        "button.btn.btn-primary.btn-block",
        {
          style: "margin-block-start:10px",
          onclick: () => {
            const text = input.value.trim();
            if (!text) return;
            sync.post("s.ask", { text });
            input.value = "";
            toast(S.toastAdded);
            buzz();
          },
        },
        S.add
      )
    );
  }

  function renderList(): void {
    const w = getWorld();
    clear(list);

    if (!w.superlatives.length) {
      list.append(
        h(
          "div.panel.center",
          null,
          h("p", null, S.empty),
          h("div.muted", null, S.example)
        )
      );
      return;
    }

    // Newest first — a question someone just added is the one being played.
    for (const s of [...w.superlatives].reverse()) {
      list.append(questionPanel(w, s.id, s.text));
    }
  }

  function questionPanel(w: World, askId: string, text: string): HTMLElement {
    const votes = w.votes.get(askId) ?? new Map<string, string>();
    const myVote = votes.get(me.id);
    const total = votes.size;

    // Tally per target.
    const tally = new Map<string, number>();
    for (const target of votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);

    const panel = h("div.panel");
    panel.append(
      h("h2", { dir: "auto" }, text),
      h("div.muted", { style: "margin-block-end:10px" }, bdi(total), S.voted)
    );

    if (!myVote) {
      // Before voting: pick a person. Everyone in the room is a candidate,
      // plus anyone the host listed who never signed in (the kids, mostly).
      const grid = h("div", { style: "display:flex;flex-wrap:wrap;gap:8px" });
      for (const p of voteTargets(w)) {
        grid.append(
          h(
            "button.chip",
            {
              dir: "auto",
              onclick: () => {
                sync.post("s.vote", { ask: askId, target: p.id });
                buzz();
              },
            },
            p.name
          )
        );
      }
      panel.append(grid);
      return panel;
    }

    // After voting: live results as bars.
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const max = ranked[0]?.[1] ?? 1;
    for (const [targetId, n] of ranked) {
      const pct = Math.round((n / total) * 100);
      panel.append(
        h(
          "div",
          { style: "margin-block-end:9px" },
          h(
            "div",
            { style: "display:flex;justify-content:space-between;font-size:14px;margin-block-end:3px" },
            h("span", { dir: "auto" }, nameOf(w, targetId), targetId === myVote ? " ✓" : ""),
            h("span", null, bdi(n))
          ),
          h("div", {
            style:
              `block-size:9px;border-radius:999px;background:${targetId === myVote ? "var(--accent)" : "var(--accent-dim)"};` +
              `inline-size:${Math.max(4, Math.round((n / max) * 100))}%`,
            title: `${pct}%`,
          })
        )
      );
    }
    panel.append(
      h(
        "button.btn.btn-sm",
        {
          style: "margin-block-start:6px;background:transparent",
          onclick: () => {
            sync.post("s.vote", { ask: askId, target: "" });
            // An empty target is ignored by the fold, so re-vote by picking again.
            toast(S.toastRepick);
          },
        },
        S.changeVote
      )
    );
    return panel;
  }

  renderHead();
  renderForm();
  renderList();

  // Only the list refreshes on world changes — re-rendering the form would
  // steal focus from someone mid-question.
  return onWorld(renderList);
}
