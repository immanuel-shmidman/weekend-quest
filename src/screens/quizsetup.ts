/**
 * Quiz setup: turn a WhatsApp export into questions, entirely in the browser.
 *
 *   pick file → (parse) → roster: merge / exclude names → questions: tick the
 *   ones you want, opt in to excerpts → save to the event
 *
 * The export never leaves the phone. `src/lib/chat` parses it here; only the
 * derived statistics and the chosen questions are uploaded — counts, names and
 * dates. Message text is uploaded only if the host turns on excerpts, and then
 * only the opening words of the longest and the funniest message. That is the
 * same guarantee the v1 CLI made, now enforced one step earlier.
 *
 * Mounted by the wizard (step 5) and by the host settings screen.
 */

import { h, clear, bdi, toast } from "../ui/dom";
import { switchRow, textInput } from "../ui/controls";
import * as room from "../room";
import type { ChatStats, Question } from "../lib/quiz";
import { isCustom } from "./editors";
import { strings, lang, fmt } from "../i18n";
/**
 * The analyzer is ~60 KB of the bundle and only hosts ever need it, so it is
 * loaded on demand the first time a file is chosen. Vite splits it into its
 * own chunk; guests never download it.
 */
type ChatLib = typeof import("../lib/chat/index.js");
type ChatBrowser = typeof import("../lib/chat/browser.js");
let libPromise: Promise<[ChatLib, ChatBrowser]> | null = null;
function loadLib(): Promise<[ChatLib, ChatBrowser]> {
  libPromise ??= Promise.all([import("../lib/chat/index.js"), import("../lib/chat/browser.js")]);
  return libPromise;
}

const S = strings({
  he: {
    privacyTitle: "מה קורה עם הצ׳אט?",
    privacy:
      "הקובץ מנותח בטלפון הזה בלבד ולא נשלח לשום מקום. מה שנשמר באירוע הוא רק מספרים, שמות ותאריכים — לא תוכן ההודעות. חריג אחד, כבוי כברירת מחדל: ״ציטוטים״ מוסיף את המילים הראשונות של ההודעה הארוכה ביותר והמצחיקה ביותר, כדי שאפשר יהיה לחפש אותן.",
    howTo: "בוואטסאפ: פתחו את הקבוצה → שלוש נקודות → עוד → ייצוא צ׳אט → ״ללא מדיה״. שלחו את הקובץ לעצמכם ופתחו אותו כאן.",
    pick: "בחרו את קובץ הייצוא",
    picking: "קוראים…",
    parsed: (n: number, people: number) => `${fmt(n)} הודעות · ${fmt(people)} שמות`,
    fatal: "לא הצלחנו לקרוא את הקובץ:",
    // roster
    rosterTitle: "מי זה מי?",
    rosterSub: "אותו אדם יכול להופיע בכמה שמות (החליף מספר, שם תצוגה). מזגו כפילויות, וכבו מי שלא אמור להופיע בחידון.",
    looksSame: (a: string, b: string) => `${a} ו-${b} נראים כמו אותו אדם`,
    merge: "מזגו",
    mergeInto: "מזגו לתוך…",
    mergeHint: (a: string) => `בחרו את מי למזג לתוך ${a}`,
    cancelMerge: "ביטול",
    split: "הפרידו",
    msgs: (n: number) => `${fmt(n)} הודעות`,
    fewMsgs: "מעט הודעות — כבוי כברירת מחדל",
    analyze: "בנו שאלות",
    analyzing: "מנתחים…",
    analyzeFailed: "הניתוח נכשל:",
    // questions
    questionsTitle: "השאלות",
    questionsSub: "סמנו את מה שנכנס לחידון. אפשר לחזור ולשנות בהגדרות.",
    excerpts: "ציטוטים",
    excerptsSub: "המילים הראשונות של ההודעה הארוכה והמצחיקה ביותר. תוכן הודעות — רק אם תפעילו.",
    warnings: "בדיקות שפיות",
    warningsOk: "הכול נראה תקין.",
    answer: (a: string) => `תשובה: ${a}`,
    selected: (n: number) => `${fmt(n)} נבחרו`,
    save: "שמרו לחידון",
    saving: "שומרים…",
    saved: "החידון נשמר ✓",
    saveFailed: (e: string) => `השמירה נכשלה (${e}).`,
    startOver: "קובץ אחר",
    people: "משתתפים בחידון",
  },
  en: {
    privacyTitle: "What happens to the chat?",
    privacy:
      "The file is analysed on this phone only and is not sent anywhere. What gets saved to the event is numbers, names and dates — never message text. One exception, off by default: “Excerpts” adds the opening words of the longest and the funniest message, so people can search for them.",
    howTo: "In WhatsApp: open the group → ⋮ → More → Export chat → “Without media”. Send the file to yourself and open it here.",
    pick: "Choose the export file",
    picking: "Reading…",
    parsed: (n: number, people: number) => `${fmt(n)} messages · ${fmt(people)} names`,
    fatal: "Couldn't read the file:",
    rosterTitle: "Who is who?",
    rosterSub: "The same person can appear under several names (new number, display name). Merge duplicates, and switch off anyone who shouldn't be in the quiz.",
    looksSame: (a: string, b: string) => `${a} and ${b} look like the same person`,
    merge: "Merge",
    mergeInto: "Merge into…",
    mergeHint: (a: string) => `Pick who to merge into ${a}`,
    cancelMerge: "Cancel",
    split: "Split",
    msgs: (n: number) => `${fmt(n)} messages`,
    fewMsgs: "Few messages — off by default",
    analyze: "Build questions",
    analyzing: "Analysing…",
    analyzeFailed: "Analysis failed:",
    questionsTitle: "The questions",
    questionsSub: "Tick what goes into the quiz. You can come back and change this in settings.",
    excerpts: "Excerpts",
    excerptsSub: "Opening words of the longest and funniest message. Message text — only if you turn this on.",
    warnings: "Sanity checks",
    warningsOk: "Everything looks fine.",
    answer: (a: string) => `Answer: ${a}`,
    selected: (n: number) => `${fmt(n)} selected`,
    save: "Save to quiz",
    saving: "Saving…",
    saved: "Quiz saved ✓",
    saveFailed: (e: string) => `Saving failed (${e}).`,
    startOver: "Another file",
    people: "People in the quiz",
  },
});

/* Types come from the library's JSDoc; only the analysis result is narrowed to what this screen reads. */
type Parsed = ReturnType<ChatLib["parseChat"]>;
type RosterPerson = ReturnType<ChatLib["suggestRoster"]>[number];
interface Analysis {
  stats: ChatStats;
  report: { warnings: string[]; ok: boolean };
  suppressed: string[];
}

export function quizSetup(root: HTMLElement, onSaved: () => void): void {
  let parsed: Parsed | null = null;
  let people: RosterPerson[] = [];
  let analysis: Analysis | null = null;
  let excerpts = false;
  let chosen = new Set<string>();
  let mergeSource: string | null = null; // canonical being merged into
  let lib: ChatLib | null = null; // set once the analyzer chunk has loaded

  const body = h("div");
  root.append(body);

  // --- 1: pick a file ---------------------------------------------------------

  function renderPick(): void {
    clear(body);
    const err = h("div.gate-err");
    const input = h("input", { type: "file", accept: ".zip,.txt,application/zip,text/plain", style: "display:none" }) as HTMLInputElement;
    const btn = h("button.btn.btn-primary.btn-block", { onclick: () => input.click() }, S.pick);
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      btn.textContent = S.picking;
      btn.setAttribute("disabled", "");
      try {
        const [chat, browser] = await loadLib();
        lib = chat;
        const { text } = await browser.readExportFile(file);
        const p = chat.parseChat(text);
        const problems = chat.parseProblems(p);
        if (problems.fatal.length) {
          err.textContent = `${S.fatal} ${problems.fatal.join(" · ")}`;
          btn.textContent = S.pick;
          btn.removeAttribute("disabled");
          return;
        }
        parsed = p;
        people = chat.suggestRoster(p).map((x) => ({ ...x, include: x.include ?? false }));
        renderRoster();
      } catch (e) {
        err.textContent = `${S.fatal} ${(e as Error).message}`;
        btn.textContent = S.pick;
        btn.removeAttribute("disabled");
      }
    });
    body.append(
      h("div.panel", null, h("h2", null, S.privacyTitle), h("p", { style: "line-height:1.5" }, S.privacy)),
      h("div.panel", null, h("div.muted", { style: "line-height:1.5;margin-block-end:10px" }, S.howTo), btn, input, err)
    );
  }

  // --- 2: roster ---------------------------------------------------------------

  /** Groups by canonical name, most messages first. */
  function groups(): { canonical: string; members: RosterPerson[]; messages: number; include: boolean }[] {
    const map = new Map<string, RosterPerson[]>();
    for (const p of people) {
      const list = map.get(p.canonical) ?? [];
      list.push(p);
      map.set(p.canonical, list);
    }
    return [...map.entries()]
      .map(([canonical, members]) => ({
        canonical,
        members,
        messages: members.reduce((n, m) => n + m.messages, 0),
        include: members.some((m) => m.include === true),
      }))
      .sort((a, b) => b.messages - a.messages);
  }

  function setInclude(canonical: string, on: boolean): void {
    for (const p of people) if (p.canonical === canonical) p.include = on;
  }

  function mergeInto(target: string, victim: string): void {
    if (target === victim) return;
    for (const p of people) if (p.canonical === victim) p.canonical = target;
    setInclude(target, true);
  }

  function rename(oldName: string, newName: string): void {
    const name = newName.trim();
    if (!name || name === oldName) return;
    for (const p of people) if (p.canonical === oldName) p.canonical = name;
  }

  function renderRoster(): void {
    clear(body);
    if (!parsed) return renderPick();
    const err = h("div.gate-err");
    const list = h("div");

    const paintList = () => {
      clear(list);
      const gs = groups();

      // "These two look like the same person" — from the library's edit-distance pass.
      const pairs = (lib?.aliasSuggestions(people) ?? []).filter(
        (pr) => pr.a !== pr.b && gs.some((g) => g.canonical === pr.a) && gs.some((g) => g.canonical === pr.b)
      );
      for (const pr of pairs.slice(0, 6)) {
        list.append(
          h(
            "div.pill.warn",
            { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-block-end:6px" },
            h("span", { dir: "auto" }, S.looksSame(pr.a, pr.b)),
            h("button.btn.btn-sm", { onclick: () => { mergeInto(pr.a, pr.b); paintList(); } }, S.merge)
          )
        );
      }

      if (mergeSource) {
        list.append(
          h(
            "div.pill",
            { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-block:6px" },
            h("span", { dir: "auto" }, S.mergeHint(mergeSource)),
            h("button.btn.btn-sm", { onclick: () => { mergeSource = null; paintList(); } }, S.cancelMerge)
          )
        );
      }

      for (const g of gs) {
        const nameInput = textInput({ value: g.canonical, maxlength: "40", style: "padding:6px 10px;font-size:15px" });
        nameInput.addEventListener("change", () => { rename(g.canonical, nameInput.value); paintList(); });
        const sub = h(
          "div.row-sub",
          null,
          S.msgs(g.messages),
          g.members.length > 1 ? " · " + g.members.map((m) => m.raw).join(", ") : "",
          !g.include && g.messages < 10 ? " · " + S.fewMsgs : ""
        );
        const row = switchRow(g.canonical, g.include, (on) => setInclude(g.canonical, on), "");
        // Replace the plain title with an editable one and the subtitle with ours.
        const main = row.querySelector(".row-main")!;
        clear(main as HTMLElement);
        main.append(nameInput, sub);

        const actions = h("div", { style: "display:flex;gap:4px;margin-inline-start:6px" });
        if (mergeSource && mergeSource !== g.canonical) {
          actions.append(h("button.btn.btn-sm.btn-primary", { onclick: () => { mergeInto(mergeSource!, g.canonical); mergeSource = null; paintList(); } }, S.merge));
        } else if (!mergeSource) {
          actions.append(h("button.btn.btn-sm", { onclick: () => { mergeSource = g.canonical; paintList(); } }, S.mergeInto));
          if (g.members.length > 1) {
            actions.append(
              h("button.btn.btn-sm", {
                onclick: () => {
                  for (const m of g.members) m.canonical = m.raw;
                  paintList();
                },
              }, S.split)
            );
          }
        }
        row.append(actions);
        list.append(row);
      }
    };
    paintList();

    const analyzeBtn = h("button.btn.btn-primary.btn-block", { style: "margin-block-start:12px" }, S.analyze);
    analyzeBtn.addEventListener("click", () => {
      err.textContent = "";
      analyzeBtn.textContent = S.analyzing;
      analyzeBtn.setAttribute("disabled", "");
      // Let the button repaint before the (synchronous) analysis.
      setTimeout(() => {
        try {
          runAnalysis();
          renderQuestions();
        } catch (e) {
          err.textContent = `${S.analyzeFailed} ${(e as Error).message}`;
          analyzeBtn.textContent = S.analyze;
          analyzeBtn.removeAttribute("disabled");
        }
      }, 30);
    });

    body.append(
      h(
        "div.panel",
        null,
        h("h2", null, S.rosterTitle),
        h("div.muted", { style: "margin-block-end:8px" }, S.parsed(parsed.messages.length, people.length)),
        h("div.muted", { style: "margin-block-end:10px;line-height:1.5" }, S.rosterSub),
        list,
        err,
        analyzeBtn
      ),
      h("button.btn.btn-sm", { onclick: () => { parsed = null; analysis = null; renderPick(); } }, S.startOver)
    );
  }

  function runAnalysis(): void {
    if (!parsed || !lib) return;
    const roster = people.map((p) => ({ ...p, include: p.include === true }));
    analysis = lib.analyzeParsed(parsed, { lang: lang(), roster, excerpts }) as unknown as Analysis;
    // Keep an existing selection across an excerpts toggle; default to all.
    const ids = new Set(analysis.stats.questions.map((q) => q.id));
    chosen = chosen.size ? new Set([...chosen].filter((id) => ids.has(id))) : ids;
    if (!chosen.size) chosen = ids;
  }

  // --- 3: questions --------------------------------------------------------------

  function renderQuestions(): void {
    clear(body);
    if (!analysis) return renderRoster();
    const a = analysis;
    const err = h("div.gate-err");

    const warnPanel = h("div.panel", null, h("h2", null, S.warnings));
    if (!a.report.warnings.length) warnPanel.append(h("div.muted", null, S.warningsOk));
    for (const w of a.report.warnings) warnPanel.append(h("div.pill.warn", { style: "display:block;margin-block-end:6px", dir: "auto" }, w));

    const peoplePanel = h(
      "div.panel",
      null,
      h("h2", null, S.people),
      h("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, ...(a.stats.people ?? []).map((p) => h("span.chip", { dir: "auto" }, p.name, " ", bdi(p.messages))))
    );

    const count = h("div.muted", null, S.selected(chosen.size));
    const qList = h("div");
    for (const q of a.stats.questions) {
      const box = h("input", { type: "checkbox", style: "inline-size:auto;min-block-size:0" }) as HTMLInputElement;
      box.checked = chosen.has(q.id);
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(q.id);
        else chosen.delete(q.id);
        count.textContent = S.selected(chosen.size);
      });
      qList.append(
        h(
          "label.row",
          { style: "cursor:pointer" },
          box,
          h(
            "div.row-main",
            null,
            h("div", { dir: "auto" }, q.q),
            h("div.row-sub", { dir: "auto" }, S.answer(q.type === "choice" ? q.answer : fmt(q.answer)))
          )
        )
      );
    }

    const saveBtn = h("button.btn.btn-primary.btn-block", { style: "margin-block-start:12px" }, S.save);
    saveBtn.addEventListener("click", async () => {
      err.textContent = "";
      saveBtn.textContent = S.saving;
      saveBtn.setAttribute("disabled", "");
      const live = room.getRoom();
      const custom: Question[] = (live.quiz?.questions ?? []).filter(isCustom);
      const quiz: ChatStats = { ...a.stats, questions: [...a.stats.questions.filter((q) => chosen.has(q.id)), ...custom] };
      const result = await room.updateRoom({
        quiz,
        config: { ...live.config, activities: { ...live.config.activities, quiz: true } },
      });
      saveBtn.textContent = S.save;
      saveBtn.removeAttribute("disabled");
      if (!result.ok) {
        err.textContent = S.saveFailed(result.error);
        return;
      }
      toast(S.saved);
      onSaved();
    });

    body.append(
      h(
        "div.panel",
        null,
        h("h2", null, S.questionsTitle),
        h("div.muted", { style: "margin-block-end:8px" }, S.questionsSub),
        switchRow(S.excerpts, excerpts, (on) => {
          excerpts = on;
          try {
            runAnalysis();
            renderQuestions();
          } catch (e) {
            err.textContent = `${S.analyzeFailed} ${(e as Error).message}`;
          }
        }, S.excerptsSub),
        count,
        qList,
        err,
        saveBtn
      ),
      warnPanel,
      peoplePanel,
      h("button.btn.btn-sm", { onclick: () => { analysis = null; renderRoster(); } }, S.rosterTitle)
    );
  }

  renderPick();
}
