/**
 * Feedback, #/feedback: a friendly place to report a bug or suggest something.
 *
 * Goes to the developer, not the host — the host is a guest too. Posted to
 * /api/feedback with a Turnstile token; the Function stores it in D1 and
 * forwards it to the Formspree endpoint (an email).
 */

import { h, toast } from "../ui/dom";
import { field, textInput } from "../ui/controls";
import { go } from "../router";
import { me } from "../identity";
import * as room from "../room";
import { strings, lang } from "../i18n";
import { mountTurnstile, type TurnstileHandle } from "../lib/turnstile";

const S = strings({
  he: {
    title: "🐞 באג? רעיון?",
    back: "חזרה",
    prompt:
      "משהו לא עבד? כפתור שלא הגיב, מסך שנתקע, טקסט שנראה מוזר? או שחשבתם על משהו שהיה שווה להוסיף? ספרו למפתח — כל הודעה נקראת, ואת רוב הבאגים אפשר לתקן תוך כמה דקות גם באמצע האירוע.",
    placeholder: "מה קרה, ואיפה? (למשל: ״בבינגו, כשלחצתי על משבצת…״)",
    emailLabel: "אימייל (לא חובה)",
    emailHint: "רק אם תרצו תשובה.",
    emailPlaceholder: "you@example.com",
    badEmail: "זה לא נראה כמו כתובת אימייל.",
    hint: "נשלח עם הכינוי שלכם ושם האירוע, כדי שאפשר יהיה להבין את ההקשר. בלי פרטים אחרים.",
    send: "שלחו",
    sending: "שולחים…",
    empty: "כתבו משהו קודם 🙂",
    thanks: "תודה! נקרא בקרוב 🙏",
    failed: "השליחה נכשלה — נסו שוב בעוד רגע.",
    humanWait: "רגע, בודקים שאתם לא רובוט…",
    humanFailed: "האימות לא עבר. נסו שוב.",
    another: "עוד אחד",
    home: "למסך הראשי",
  },
  en: {
    title: "🐞 Bug? Idea?",
    back: "Back",
    prompt:
      "Something not working? A button that didn't respond, a screen that got stuck, text that looked off? Or thought of something worth adding? Tell the developer — every note is read, and most bugs can be fixed in a few minutes, even mid-event.",
    placeholder: "What happened, and where? (e.g. “In bingo, when I tapped a square…”)",
    emailLabel: "Email (optional)",
    emailHint: "Only if you'd like a reply.",
    emailPlaceholder: "you@example.com",
    badEmail: "That doesn't look like an email address.",
    hint: "Sent with your nickname and the event's name, for context. Nothing else.",
    send: "Send",
    sending: "Sending…",
    empty: "Write something first 🙂",
    thanks: "Thanks! Reading it soon 🙏",
    failed: "Sending failed — try again in a moment.",
    humanWait: "One moment, checking you're not a robot…",
    humanFailed: "The check didn't pass. Try again.",
    another: "Another one",
    home: "Home",
  },
});

export function feedbackScreen(root: HTMLElement): void {
  root.append(
    h("div.screen-head", null, h("h1", null, S.title), h("button.btn.btn-sm", { onclick: () => history.back() }, S.back))
  );

  const ta = h("textarea", { placeholder: S.placeholder, maxlength: "2000", dir: "auto", rows: "5" }) as HTMLTextAreaElement;
  const err = h("div.gate-err");
  const send = h("button.btn.btn-primary.btn-block", { style: "margin-block-start:10px" }, S.send);
  const humanBox = h("div.center", { style: "margin-block-start:10px" });
  const emailInput = textInput({ inputmode: "email", autocapitalize: "off", placeholder: S.emailPlaceholder, maxlength: "120", dir: "ltr" });
  const panel = h(
    "div.panel",
    null,
    h("p", { style: "line-height:1.55" }, S.prompt),
    ta,
    h("div.field-hint", { style: "margin-block-end:10px" }, S.hint),
    field(S.emailLabel, emailInput, S.emailHint),
    humanBox,
    err,
    send
  );
  let human: TurnstileHandle | null = null;
  void mountTurnstile(humanBox, "feedback").then((handle) => {
    human = handle;
    if (handle.disabled) humanBox.remove();
  });

  send.addEventListener("click", async () => {
    const text = ta.value.trim();
    if (!text) {
      err.textContent = S.empty;
      ta.focus();
      return;
    }
    const email = emailInput.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = S.badEmail;
      emailInput.focus();
      return;
    }
    if (human && !human.disabled && !human.token()) {
      err.textContent = S.humanWait;
      return;
    }
    err.textContent = "";
    send.textContent = S.sending;
    send.setAttribute("disabled", "");
    try {
      const res = await fetch("./api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", "x-party": room.partyHeader() },
        body: JSON.stringify({ room: room.roomId(), text, name: me.name, email, lang: lang(), turnstile: human?.token() ?? "" }),
      });
      human?.reset();
      if (res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "human check failed") throw new Error("human");
      }
      if (!res.ok) throw new Error(String(res.status));
      toast(S.thanks);
      panel.replaceChildren(
        h("h2", null, S.thanks),
        h("div", { style: "display:flex;gap:8px;margin-block-start:10px" },
          h("button.btn", { onclick: () => { root.replaceChildren(); feedbackScreen(root); } }, S.another),
          h("button.btn.btn-primary", { onclick: () => go("#/"), style: "flex:1" }, S.home))
      );
    } catch (e) {
      err.textContent = (e as Error).message === "human" ? S.humanFailed : S.failed;
      send.textContent = S.send;
      send.removeAttribute("disabled");
    }
  });

  root.append(panel);
  setTimeout(() => ta.focus(), 0);
}
