import { h, bdi, toast, buzz, clear } from "../ui/dom";
import { me } from "../identity";
import * as sync from "../sync";
import { getWorld, onWorld } from "../world";
import { nameOf, type World } from "../store";
import { go } from "../router";
import { strings } from "../i18n";

const S = strings({
  he: {
    title: "💬 ציטוטים",
    back: "חזרה",
    whatSaid: "מה נאמר?",
    whoSaid: "מי אמר?",
    addQuote: "הנציחו ציטוט",
    toastSaved: "נשמר לקיר 💬",
    add: "הוסיפו",
    empty: "הקיר עוד ריק.",
    emptyHint: "כשמישהו אומר משהו בלתי נשכח — תפסו אותו כאן.",
    quoted: (text: string) => "״" + text + "״",
    anonymous: "— אלמוני",
    postedBy: " · העלה ",
  },
  en: {
    title: "💬 Quotes",
    back: "Back",
    whatSaid: "What was said?",
    whoSaid: "Who said it?",
    addQuote: "Save a quote",
    toastSaved: "Saved to the wall 💬",
    add: "Add",
    empty: "The wall is still empty.",
    emptyHint: "When someone says something unforgettable — catch it here.",
    quoted: (text: string) => "“" + text + "”",
    anonymous: "— Anonymous",
    postedBy: " · posted by ",
  },
});

/** One tap each, not a rating scale — the friction has to be near zero. */
const EMOJI = ["😂", "❤️", "🔥", "😱", "🤦"];

/**
 * The quote wall.
 *
 * Anyone logs a line someone said; everyone can react with a single tap.
 * Deliberately NOT a ranked contest: scoring "best quote" would be homework on
 * Sunday and would reward whoever happened to be funny rather than anything
 * anyone can play well. The value here is the scrapbook — this is the only
 * part of the weekend that is worth anything on Monday.
 *
 * Text only. Photos would need blob storage, and D1 is the wrong place for it.
 */
export function wallScreen(root: HTMLElement): () => void {
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
    const quote = h("input", {
      type: "text",
      maxlength: "200",
      dir: "auto",
      placeholder: S.whatSaid,
    }) as HTMLInputElement;
    const who = h("input", {
      type: "text",
      maxlength: "30",
      dir: "auto",
      placeholder: S.whoSaid,
      style: "margin-block-start:8px",
    }) as HTMLInputElement;

    form.append(
      h("h2", null, S.addQuote),
      quote,
      who,
      h(
        "button.btn.btn-primary.btn-block",
        {
          style: "margin-block-start:10px",
          onclick: () => {
            const text = quote.value.trim();
            if (!text) return;
            sync.post("w.post", { text, said: who.value.trim() });
            quote.value = "";
            who.value = "";
            toast(S.toastSaved);
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

    if (!w.wall.length) {
      list.append(
        h(
          "div.panel.center",
          null,
          h("p", null, S.empty),
          h("div.muted", null, S.emptyHint)
        )
      );
      return;
    }

    for (const post of [...w.wall].reverse()) list.append(postPanel(w, post));
  }

  function postPanel(w: World, post: World["wall"][number]): HTMLElement {
    const reactions = w.reactions.get(post.id) ?? new Map<string, string>();
    const mine = reactions.get(me.id);

    const counts = new Map<string, number>();
    for (const emoji of reactions.values()) {
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    }

    const bar = h("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-block-start:10px" });
    for (const emoji of EMOJI) {
      const n = counts.get(emoji) ?? 0;
      bar.append(
        h(
          "button.chip",
          {
            style: mine === emoji ? "border-color:var(--accent);background:var(--panel-2)" : "",
            onclick: () => {
              sync.post("w.react", { post: post.id, emoji });
              buzz(30);
            },
          },
          emoji,
          n ? h("span", { style: "margin-inline-start:5px" }, bdi(n)) : ""
        )
      );
    }

    return h(
      "div.panel",
      null,
      h("div.sheet-text", { dir: "auto" }, S.quoted(post.text)),
      h(
        "div.muted",
        { dir: "auto" },
        post.said ? "— " + post.said : S.anonymous,
        h("span", { style: "opacity:.6" }, S.postedBy, nameOf(w, post.by))
      ),
      bar
    );
  }

  renderHead();
  renderForm();
  renderList();

  return onWorld(renderList);
}
