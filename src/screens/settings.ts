/**
 * Host settings, #/settings: the wizard's editors against the live event.
 *
 * Setup is rarely finished in one sitting — people get added, the quiz gets
 * built on the train, the bingo grid gets shrunk when only eight show up. So
 * everything the wizard can set is editable here, by whoever holds the host
 * code, and saved with one PUT.
 */

import { h, toast } from "../ui/dom";
import { field, textInput, codeBox } from "../ui/controls";
import { participantsEditor, activitiesEditor, customQuestionsEditor, mergeCustom, isCustom } from "./editors";
import { quizSetup } from "./quizsetup";
import * as room from "../room";
import type { RoomConfig } from "../room";
import type { ChatStats, Question } from "../lib/quiz";
import { qrElement } from "../lib/qr";
import { me } from "../identity";
import { go } from "../router";
import { strings } from "../i18n";

const S = strings({
  he: {
    title: "⚙️ הגדרות האירוע",
    back: "חזרה",
    notHost: "רק מארגנים. פתחו קודם את מסך המארגנים עם הקוד.",
    toHost: "למסך המארגנים",
    name: "שם האירוע",
    people: "מי מגיע",
    activities: "פעילויות",
    quiz: "חידון מקבוצת הוואטסאפ",
    quizHave: (n: number) => `יש ${n} שאלות מהצ׳אט.`,
    quizNone: "עוד לא הועלה חידון.",
    custom: "שאלות משלכם",
    share: "שיתוף",
    link: "הקישור לאורחים",
    password: "הסיסמה",
    hostCode: "קוד המארגנים",
    save: "שמרו שינויים",
    saving: "שומרים…",
    saved: "נשמר ✓",
    failed: (e: string) => `השמירה נכשלה (${e}).`,
    bingoFrozenNote: "המאגר של הבינגו כבר נסגר — שינוי גודל הלוח ישפיע רק אם תפתחו אותו מחדש.",
  },
  en: {
    title: "⚙️ Event settings",
    back: "Back",
    notHost: "Hosts only. Unlock the hosts screen with the code first.",
    toHost: "To the hosts screen",
    name: "Event name",
    people: "Who's coming",
    activities: "Activities",
    quiz: "Quiz from your WhatsApp group",
    quizHave: (n: number) => `${n} questions from the chat.`,
    quizNone: "No quiz uploaded yet.",
    custom: "Your own questions",
    share: "Share",
    link: "Link for guests",
    password: "Password",
    hostCode: "Host code",
    save: "Save changes",
    saving: "Saving…",
    saved: "Saved ✓",
    failed: (e: string) => `Saving failed (${e}).`,
    bingoFrozenNote: "The bingo pool is already closed — a board-size change only applies if you reopen it.",
  },
});

export function settingsScreen(root: HTMLElement): void {
  root.append(
    h("div.screen-head", null, h("h1", null, S.title), h("button.btn.btn-sm", { onclick: () => go("#/host") }, S.back))
  );
  if (!me.isHost) {
    root.append(h("div.panel.center", null, h("p", null, S.notHost), h("button.btn.btn-block", { onclick: () => go("#/host") }, S.toHost)));
    return;
  }

  const current = room.getRoom();
  let name = current.name;
  let config: RoomConfig = {
    participants: current.config.participants,
    activities: { ...current.config.activities },
    bingo: { ...current.config.bingo },
  };
  let custom: Question[] = (current.quiz?.questions ?? []).filter(isCustom);

  const nameInput = textInput({ value: name, maxlength: "60" });
  nameInput.addEventListener("input", () => (name = nameInput.value));

  const quizMount = h("div");
  const quizStatus = h("div.muted", { style: "margin-block-end:8px" });
  const paintQuizStatus = () => {
    const n = (room.getRoom().quiz?.questions ?? []).filter((q) => !isCustom(q)).length;
    quizStatus.textContent = n ? S.quizHave(n) : S.quizNone;
  };
  paintQuizStatus();
  quizSetup(quizMount, () => {
    paintQuizStatus();
    toast(S.saved);
  });

  const err = h("div.gate-err");
  const saveBtn = h("button.btn.btn-primary.btn-block", null, S.save);
  saveBtn.addEventListener("click", async () => {
    saveBtn.setAttribute("disabled", "");
    saveBtn.textContent = S.saving;
    err.textContent = "";
    const live = room.getRoom();
    const generated = (live.quiz?.questions ?? []).filter((q) => !isCustom(q));
    const hasQuiz = generated.length + custom.length > 0;
    const quiz: ChatStats | null = hasQuiz
      ? { ...(live.quiz ?? { schemaVersion: 2, generatedAt: new Date().toISOString() }), questions: mergeCustom(generated, custom) }
      : null;
    const result = await room.updateRoom({
      name: name.trim() || live.name,
      config: { ...config, activities: { ...config.activities, quiz: hasQuiz && config.activities.quiz !== false } },
      quiz,
    });
    saveBtn.removeAttribute("disabled");
    saveBtn.textContent = S.save;
    if (!result.ok) {
      err.textContent = S.failed(result.error);
      return;
    }
    toast(S.saved);
    paintQuizStatus();
  });

  const link = room.shareUrl();
  root.append(
    h("div.panel", null, field(S.name, nameInput)),
    h("div.panel", null, h("h2", null, S.people), participantsEditor(config.participants, (list) => (config.participants = list))),
    h("div.panel", null, h("h2", null, S.activities), activitiesEditor(config, (c) => (config = c))),
    h("div.panel", null, h("h2", null, S.quiz), quizStatus, quizMount),
    h("div.panel", null, h("h2", null, S.custom), customQuestionsEditor(current.quiz?.questions ?? [], (qs) => (custom = qs))),
    err,
    saveBtn,
    h(
      "div.panel",
      { style: "margin-block-start:16px" },
      h("h2", null, S.share),
      codeBox(() => link, { label: S.link }),
      codeBox(() => room.password(), { label: S.password }),
      codeBox(() => room.hostCode(), { label: S.hostCode }),
      h("div.center", { style: "margin-block-start:10px" }, h("div.qr", null, qrElement(link, { size: 200 })))
    )
  );
}
