/**
 * The landing page: what weekend-quest.pages.dev shows with no event in the
 * URL and none remembered on this phone. Two doors — make an event, or enter
 * a code / paste a link someone sent you.
 *
 * Deliberately tiny. This is a favour to a few families, not a product page.
 */

import { h } from "../ui/dom";
import { textInput } from "../ui/controls";
import { go, refresh } from "../router";
import { normaliseRoomId, shareUrlFor } from "../room";
import { strings, lang, setLang, LANG_LABEL } from "../i18n";

const S = strings({
  he: {
    title: "Weekend Quest",
    blurb: "בינגו חי, שתי אמיתות ושקר, חידון על קבוצת הוואטסאפ ועוד — לסוף שבוע עם חברים או משפחה. כולם משחקים מהטלפון, בקישור אחד.",
    create: "יוצרים אירוע חדש",
    createSub: "כמה דקות של הגדרות, ואפשר לשלוח קישור.",
    haveCode: "קיבלתם קישור או קוד?",
    codePlaceholder: "קוד האירוע או הקישור",
    open: "פתחו",
    badCode: "זה לא נראה כמו קוד אירוע.",
    footer: "אין הרשמה, אין אימייל. אירוע נמחק 30 יום אחרי הפעילות האחרונה בו.",
    copyright: "© 2026 Immanuel Shmidman · קוד פתוח ברישיון MIT",
  },
  en: {
    title: "Weekend Quest",
    blurb: "Live bingo, two truths and a lie, a quiz built from your WhatsApp group and more — for a weekend with friends or family. Everyone plays from their phone, one link.",
    create: "Create an event",
    createSub: "A few minutes of setup, then send the link.",
    haveCode: "Got a link or a code?",
    codePlaceholder: "Event code or link",
    open: "Open",
    badCode: "That doesn't look like an event code.",
    footer: "No sign-up, no email. An event is deleted 30 days after its last activity.",
    copyright: "© 2026 Immanuel Shmidman · open source, MIT license",
  },
});

export function landingScreen(root: HTMLElement): void {
  const other = lang() === "he" ? "en" : "he";
  const input = textInput({ placeholder: S.codePlaceholder, autocapitalize: "characters" });
  const err = h("div.gate-err");

  const open = () => {
    const id = normaliseRoomId(input.value);
    if (!id) {
      err.textContent = S.badCode;
      return;
    }
    location.href = shareUrlFor(id) + "#/";
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") open();
  });

  root.append(
    h(
      "div.landing",
      null,
      h("h1.landing-title", null, S.title),
      h("p.landing-blurb", null, S.blurb),
      h(
        "button.card",
        { onclick: () => go("#/new") },
        h("div.card-head", null, h("span.card-emoji", null, "🎉"), h("span.card-title", null, S.create)),
        h("div.card-blurb", null, S.createSub)
      ),
      h(
        "div.panel",
        null,
        h("h2", null, S.haveCode),
        h("div.inline-form", null, input, h("button.btn.btn-primary", { onclick: open }, S.open)),
        err
      ),
      h("div.muted.center", { style: "margin-block-start:20px" }, S.footer),
      h("div.muted.center", { style: "margin-block-start:8px;font-size:12px" }, S.copyright),
      h(
        "div.center",
        { style: "margin-block-start:12px" },
        h(
          "button.link",
          {
            onclick: () => {
              setLang(other);
              refresh();
            },
          },
          LANG_LABEL[other]
        )
      )
    )
  );
}
