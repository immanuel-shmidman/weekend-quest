/**
 * "Add to home screen" prompt.
 *
 * The site is meant to be opened dozens of times over a weekend, so digging the
 * link out of the group chat every time is the wrong experience. Installed, it
 * launches fullscreen from an icon like an app.
 *
 * Two paths, because the platforms differ:
 *  - Chrome/Android fires `beforeinstallprompt`, which we capture and replay
 *    behind a real button.
 *  - iOS Safari has no such event and never will, so it gets instructions
 *    instead. It also only honours the Share > Add to Home Screen route.
 */

import { h } from "./dom";
import { strings } from "../i18n";

const S = strings({
  he: {
    noThanks: "לא תודה",
    pitch: "📲 הוסיפו את האירוע למסך הבית — פתיחה בלחיצה אחת, בלי לחפש בקבוצה.",
    add: "הוסיפו למסך הבית",
    howIos: "לחצו על כפתור השיתוף למטה ואז על ״הוספה למסך הבית״.",
    howOther: "פתחו את תפריט הדפדפן ובחרו ״הוספה למסך הבית״.",
  },
  en: {
    noThanks: "No thanks",
    pitch: "📲 Add this to your home screen — one tap to open, no digging through the group chat.",
    add: "Add to home screen",
    howIos: "Tap the Share button below, then “Add to Home Screen”.",
    howOther: "Open the browser menu and choose “Add to Home screen”.",
  },
});

const K_DISMISSED = "wq-install-dismissed";

let deferred: any = null;

export function watchInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
  });
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(K_DISMISSED) === "1";
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(K_DISMISSED, "1");
  } catch {
    /* ignore */
  }
}

/** A dismissible banner, or an empty node when there is nothing useful to say. */
export function installBanner(): HTMLElement {
  if (isStandalone() || dismissed()) return h("span.hidden");

  const close = h(
    "button.btn.btn-sm",
    {
      onclick: (e: Event) => {
        e.stopPropagation();
        dismiss();
        (e.currentTarget as HTMLElement).closest(".panel")?.remove();
      },
    },
    S.noThanks
  );

  if (deferred) {
    return h(
      "div.panel",
      null,
      h("div", null, S.pitch),
      h(
        "div",
        { style: "display:flex;gap:8px;margin-block-start:10px" },
        h(
          "button.btn.btn-sm.btn-primary",
          {
            onclick: async () => {
              const prompt = deferred;
              deferred = null;
              try {
                await prompt.prompt();
              } catch {
                /* user dismissed */
              }
              dismiss();
            },
          },
          S.add
        ),
        close
      )
    );
  }

  const how = isIos() ? S.howIos : S.howOther;

  return h(
    "div.panel",
    null,
    h("div", null, S.pitch),
    h("div.muted", { style: "margin-block-start:6px" }, how),
    h("div", { style: "margin-block-start:10px" }, close)
  );
}
