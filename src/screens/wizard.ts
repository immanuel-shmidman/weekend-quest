/**
 * The setup wizard, #/new: from nothing to a shareable event in six steps.
 *
 *   1 name + language   2 password   3 who is coming   4 activities
 *   ── create ──   5 chat quiz (optional)   6 your own questions (optional)   share
 *
 * The event is created after step 4, because the server mints the id and the
 * host code; steps 5 and 6 then edit the live event exactly the way the host
 * settings screen does later. The draft survives a reload (phones lock), except
 * the password, which is never written to storage before the event exists.
 *
 * Phone-first: one thing per screen, big buttons, no modals.
 */

import { h, clear, toast } from "../ui/dom";
import { field, textInput, progressDots, codeBox } from "../ui/controls";
import { participantsEditor, activitiesEditor, customQuestionsEditor, mergeCustom, isCustom } from "./editors";
import { quizSetup } from "./quizsetup";
import * as room from "../room";
import type { RoomConfig } from "../room";
import type { ChatStats, Question } from "../lib/quiz";
import { qrElement } from "../lib/qr";
import { mountTurnstile, type TurnstileHandle } from "../lib/turnstile";
import { strings, lang, setLang, LANG_LABEL, type Lang } from "../i18n";
import { go, refresh } from "../router";

const S = strings({
  he: {
    title: "אירוע חדש",
    cancel: "ביטול",
    back: "חזרה",
    next: "הבא",
    skip: "דלגו",
    create: "יוצרים את האירוע",
    creating: "רגע…",
    finish: "סיימנו",
    // 1
    nameLabel: "איך קוראים לאירוע?",
    namePlaceholder: "למשל: נופש משפחת כהן 2026",
    langLabel: "באיזו שפה משחקים?",
    langHint: "אפשר להחליף בכל רגע — לכל אחד בטלפון שלו.",
    needName: "צריך שם לאירוע.",
    // 2
    passLabel: "סיסמת האירוע",
    passHint: "מה שהאורחים מקלידים כדי להיכנס. וילון, לא כספת — משהו שכולם יזכרו. 2 עד 40 תווים.",
    passPlaceholder: "למשל: פיתות",
    needPass: "צריך סיסמה של 2 עד 40 תווים.",
    hostNote: "קוד המארגנים (שמקדם שלבים) ייווצר אוטומטית ויוצג בסוף.",
    // 3
    peopleTitle: "מי מגיע?",
    peopleSub: "לא חובה. מי שברשימה יופיע ב״מי הכי…״ גם אם לא נכנס לאפליקציה.",
    // 4
    activitiesTitle: "מה משחקים?",
    // create
    createFailed: (e: string) => `היצירה נכשלה (${e}). נסו שוב.`,
    humanWait: "רגע, בודקים שאתם לא רובוט…",
    humanFailed: "האימות לא עבר. נסו שוב.",
    created: "האירוע נוצר 🎉",
    // 5
    quizTitle: "חידון מקבוצת הוואטסאפ",
    quizSub: "ייצאו את הצ׳אט מוואטסאפ והעלו אותו כאן. הניתוח קורה בטלפון הזה בלבד.",
    // 6
    customTitle: "שאלות משלכם",
    customSub: "שאלות שרק אתם יודעים לשאול. נכנסות לחידון יחד עם השאלות מהצ׳אט.",
    saveFailed: (e: string) => `השמירה נכשלה (${e}).`,
    // share
    shareTitle: "מוכן לשליחה",
    link: "הקישור לאורחים",
    password: "הסיסמה",
    hostCode: "קוד המארגנים",
    hostWarn: "שמרו אותו. הוא מופיע פה ושמור בטלפון הזה — אין דרך לשחזר אותו. מי שיש לו את הקוד יכול לקדם שלבים ולסגור את מאגר הבינגו.",
    whatsapp: "שליחה בוואטסאפ",
    waText: (name: string, link: string, pass: string) => `${name} 🎉\n${link}\nסיסמה: ${pass}`,
    enter: "נכנסים לאירוע",
    settingsNote: "אפשר לשנות הכול אחר כך ב״מארגנים״ → ״הגדרות״.",
  },
  en: {
    title: "New event",
    cancel: "Cancel",
    back: "Back",
    next: "Next",
    skip: "Skip",
    create: "Create the event",
    creating: "One moment…",
    finish: "Done",
    nameLabel: "What's the event called?",
    namePlaceholder: "e.g. Cohen family getaway 2026",
    langLabel: "Which language do you play in?",
    langHint: "Anyone can switch at any time, on their own phone.",
    needName: "The event needs a name.",
    passLabel: "Event password",
    passHint: "What guests type to get in. A curtain, not a vault — something everyone will remember. 2 to 40 characters.",
    passPlaceholder: "e.g. pitas",
    needPass: "A password of 2 to 40 characters is needed.",
    hostNote: "The host code (which advances rounds) is generated for you and shown at the end.",
    peopleTitle: "Who's coming?",
    peopleSub: "Optional. Anyone listed shows up in “Who's most likely…” even if they never open the app.",
    activitiesTitle: "What are we playing?",
    createFailed: (e: string) => `Creating failed (${e}). Try again.`,
    humanWait: "One moment, checking you're not a robot…",
    humanFailed: "The check didn't pass. Try again.",
    created: "Event created 🎉",
    quizTitle: "Quiz from your WhatsApp group",
    quizSub: "Export the chat from WhatsApp and upload it here. The analysis runs on this phone only.",
    customTitle: "Your own questions",
    customSub: "Questions only you would know to ask. They join the quiz alongside the chat questions.",
    saveFailed: (e: string) => `Saving failed (${e}).`,
    shareTitle: "Ready to share",
    link: "Link for guests",
    password: "Password",
    hostCode: "Host code",
    hostWarn: "Keep it. It appears here and is saved on this phone — there is no way to recover it. Anyone with the code can advance rounds and close the bingo pool.",
    whatsapp: "Share on WhatsApp",
    waText: (name: string, link: string, pass: string) => `${name} 🎉\n${link}\nPassword: ${pass}`,
    enter: "Enter the event",
    settingsNote: "Everything can be changed later under “Hosts” → “Settings”.",
  },
});

interface Draft {
  step: number;
  name: string;
  lang: Lang;
  config: RoomConfig;
  createdId: string | null;
}

const K_DRAFT = "wq-wizard-draft";

const DEFAULT_CONFIG = (): RoomConfig => ({
  participants: [],
  activities: { bingo: true, truths: true, quiz: false, superlatives: true, wall: true, awards: true },
  bingo: { side: 4, minProposals: 2 },
});

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(K_DRAFT);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Draft>;
      return {
        step: Number(d.step) || 0,
        name: String(d.name ?? ""),
        lang: d.lang === "en" ? "en" : d.lang === "he" ? "he" : lang(),
        config: { ...DEFAULT_CONFIG(), ...(d.config ?? {}) },
        createdId: typeof d.createdId === "string" ? d.createdId : null,
      };
    }
  } catch {
    /* start fresh */
  }
  return { step: 0, name: "", lang: lang(), config: DEFAULT_CONFIG(), createdId: null };
}

function saveDraft(d: Draft): void {
  try {
    localStorage.setItem(K_DRAFT, JSON.stringify(d));
  } catch {
    /* fine */
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(K_DRAFT);
  } catch {
    /* fine */
  }
}

const STEPS = 7; // 0..3 before create, 4 quiz, 5 custom, 6 share

export function wizardScreen(root: HTMLElement): void {
  const draft = loadDraft();
  let password = ""; // never persisted before the event exists
  let customQuestions: Question[] = [];

  // A reload after creation: the room is remembered on this phone; re-attach.
  if (draft.createdId && !room.roomId()) {
    room.resolveRoomId();
  }
  if (draft.createdId && room.roomId() === draft.createdId && !room.isLoaded()) {
    void room.loadFull().then(() => render());
  }
  if (draft.createdId && room.roomId() !== draft.createdId) {
    // Something odd (another event opened since). Start over cleanly.
    draft.createdId = null;
    draft.step = Math.min(draft.step, 3);
  }

  const head = h("div.screen-head");
  const body = h("div");
  const nav = h("div.wizard-nav");
  root.append(head, body, nav);

  function render(): void {
    saveDraft(draft);
    window.scrollTo(0, 0);
    clear(head);
    head.append(
      h("div", null, h("h1", null, S.title), progressDots(STEPS, draft.step)),
      h(
        "button.btn.btn-sm",
        {
          onclick: () => {
            if (draft.createdId) {
              // Event exists: leaving is just "enter it".
              enter();
              return;
            }
            clearDraft();
            go("#/start");
          },
        },
        draft.createdId ? S.enter : S.cancel
      )
    );
    clear(body);
    clear(nav);
    [stepBasics, stepPassword, stepPeople, stepActivities, stepQuiz, stepCustom, stepShare][draft.step]();
  }

  function navButtons(opts: { back?: boolean; next?: { label: string; onClick: () => void; primary?: boolean }; skip?: () => void }): void {
    clear(nav);
    if (opts.back) {
      nav.append(
        h(
          "button.btn",
          {
            onclick: () => {
              draft.step = Math.max(0, draft.step - 1);
              render();
            },
          },
          S.back
        )
      );
    }
    if (opts.skip) nav.append(h("button.btn", { onclick: opts.skip }, S.skip));
    if (opts.next) {
      nav.append(h("button.btn" + (opts.next.primary === false ? "" : ".btn-primary"), { onclick: opts.next.onClick, style: "flex:1" }, opts.next.label));
    }
  }

  function advance(): void {
    draft.step = Math.min(STEPS - 1, draft.step + 1);
    render();
  }

  // --- 1: name + language --------------------------------------------------

  function stepBasics(): void {
    const nameInput = textInput({ placeholder: S.namePlaceholder, maxlength: "60", value: draft.name });
    nameInput.addEventListener("input", () => (draft.name = nameInput.value));
    const err = h("div.gate-err");

    const langPick = h("div.lang-pick");
    for (const l of ["he", "en"] as Lang[]) {
      langPick.append(
        h(
          "button.lang-btn",
          {
            class: draft.lang === l ? "on" : "",
            lang: l,
            dir: l === "he" ? "rtl" : "ltr",
            onclick: () => {
              draft.lang = l;
              // The wizard follows the event's language so the host sees what
              // guests will see; they can toggle back on the home screen.
              setLang(l);
              render();
            },
          },
          LANG_LABEL[l]
        )
      );
    }

    body.append(
      h("div.panel", null, field(S.nameLabel, nameInput), err),
      h("div.panel", null, field(S.langLabel, langPick, S.langHint))
    );
    setTimeout(() => nameInput.focus(), 0);
    navButtons({
      next: {
        label: S.next,
        onClick: () => {
          if (!draft.name.trim()) {
            err.textContent = S.needName;
            return;
          }
          advance();
        },
      },
    });
  }

  // --- 2: password ---------------------------------------------------------

  function stepPassword(): void {
    const input = textInput({ placeholder: S.passPlaceholder, maxlength: "40", value: password, autocapitalize: "off" });
    input.addEventListener("input", () => (password = input.value));
    const err = h("div.gate-err");
    const next = () => {
      const p = password.trim();
      if (p.length < 2 || p.length > 40) {
        err.textContent = S.needPass;
        return;
      }
      password = p;
      advance();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") next();
    });
    body.append(h("div.panel", null, field(S.passLabel, input, S.passHint), err), h("div.muted", null, S.hostNote));
    setTimeout(() => input.focus(), 0);
    navButtons({ back: true, next: { label: S.next, onClick: next } });
  }

  // --- 3: people -------------------------------------------------------------

  function stepPeople(): void {
    body.append(
      h("div.panel", null, h("h2", null, S.peopleTitle),
        participantsEditor(draft.config.participants, (list) => {
          draft.config.participants = list;
          saveDraft(draft);
        }))
    );
    navButtons({ back: true, next: { label: S.next, onClick: advance } });
  }

  // --- 4: activities → create --------------------------------------------------

  function stepActivities(): void {
    const err = h("div.gate-err");
    const humanBox = h("div.panel.center");
    body.append(
      h("div.panel", null, h("h2", null, S.activitiesTitle),
        activitiesEditor(draft.config, (c) => {
          draft.config = c;
          saveDraft(draft);
        })),
      humanBox,
      err
    );
    // The human check sits with the create button, not on step 1: the token
    // is single-use and short-lived, so it must be minted right before use.
    let human: TurnstileHandle | null = null;
    void mountTurnstile(humanBox, "create-event").then((handle) => {
      human = handle;
      if (handle.disabled) humanBox.remove();
    });
    let busy = false;
    navButtons({
      back: true,
      next: {
        label: S.create,
        onClick: async () => {
          if (busy) return;
          if (!password) {
            // Reload between steps 2 and 4 lost the password; go back for it.
            draft.step = 1;
            render();
            return;
          }
          if (human && !human.disabled && !human.token()) {
            err.textContent = S.humanWait;
            return;
          }
          busy = true;
          err.textContent = "";
          const btn = nav.querySelector(".btn-primary");
          if (btn) btn.textContent = S.creating;
          const result = await room.createRoom({
            name: draft.name.trim(),
            lang: draft.lang,
            password,
            config: draft.config,
            turnstile: human?.token() ?? "",
          });
          busy = false;
          human?.reset(); // the token was consumed either way
          if (!result.ok) {
            err.textContent = result.error === "human check failed" ? S.humanFailed : S.createFailed(result.error);
            if (btn) btn.textContent = S.create;
            return;
          }
          room.switchRoom(result.id, { password, hostCode: result.hostCode, room: result.room });
          draft.createdId = result.id;
          toast(S.created);
          advance();
        },
      },
    });
  }

  // --- 5: chat quiz (optional) ----------------------------------------------------

  function stepQuiz(): void {
    const mount = h("div");
    body.append(h("div.panel", null, h("h2", null, S.quizTitle), h("div.muted", null, S.quizSub)), mount);
    quizSetup(mount, () => advance());
    navButtons({ skip: advance });
  }

  // --- 6: custom questions (optional) -----------------------------------------------

  function stepCustom(): void {
    const existing = room.getRoom().quiz?.questions ?? [];
    customQuestions = existing.filter(isCustom);
    const err = h("div.gate-err");
    body.append(
      h("div.panel", null, h("h2", null, S.customTitle), h("div.muted", null, S.customSub)),
      customQuestionsEditor(existing, (qs) => (customQuestions = qs)),
      err
    );
    const save = async () => {
      const current = room.getRoom();
      const generated = (current.quiz?.questions ?? []).filter((q) => !isCustom(q));
      if (!customQuestions.length && !generated.length) {
        advance();
        return;
      }
      const quiz: ChatStats = {
        ...(current.quiz ?? { schemaVersion: 2, generatedAt: new Date().toISOString() }),
        questions: mergeCustom(generated, customQuestions),
      };
      const result = await room.updateRoom({
        quiz,
        config: { ...current.config, activities: { ...current.config.activities, quiz: true } },
      });
      if (!result.ok) {
        err.textContent = S.saveFailed(result.error);
        return;
      }
      advance();
    };
    navButtons({ skip: advance, next: { label: S.next, onClick: () => void save() } });
  }

  // --- share ------------------------------------------------------------------------

  function stepShare(): void {
    const link = room.shareUrl();
    const name = room.getRoom().name;
    const pass = room.password();
    const waHref = "https://wa.me/?text=" + encodeURIComponent(S.waText(name, link, pass));

    body.append(
      h("div.panel.center", null, h("h2", { dir: "auto" }, name), h("div.muted", null, S.shareTitle)),
      h("div.panel", null,
        codeBox(() => link, { label: S.link }),
        codeBox(() => pass, { label: S.password }),
        h("a.btn.btn-block.btn-good", { href: waHref, target: "_blank", rel: "noopener", style: "margin-block-start:10px;text-align:center;text-decoration:none" }, S.whatsapp)
      ),
      h("div.panel.center", null, h("div.qr", null, qrElement(link, { size: 220 }))),
      h("div.panel", null,
        codeBox(() => room.hostCode(), { label: S.hostCode, big: true }),
        h("div.pill.warn", { style: "display:block;margin-block-start:8px" }, S.hostWarn)
      ),
      h("div.muted.center", null, S.settingsNote)
    );
    navButtons({ next: { label: S.enter, onClick: enter } });
  }

  function enter(): void {
    clearDraft();
    // Full reload: boot now finds the room in the URL, the password on the
    // phone, and lands on the gate's nickname step. Setting location.href to a
    // URL that differs only in its hash would NOT reload — it would just fire
    // hashchange inside the room-less router — hence the explicit reload.
    history.replaceState(null, "", room.shareUrl() + "#/");
    location.reload();
  }

  render();
  // Keep the header/nav language in sync if the phone toggles elsewhere.
  void refresh;
}
