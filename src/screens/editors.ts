/**
 * Reusable editors for an event's configuration: who is coming, which
 * activities are on, and the host's own quiz questions.
 *
 * Each takes the current value and reports every change through a callback.
 * The wizard (#/new) drives them to build a fresh event, and the host settings
 * screen (#/settings) drives the same editors against a live one — setup is
 * rarely finished in one sitting, and the two must not drift apart.
 */

import { h, clear, toast } from "../ui/dom";
import { field, textInput, switchRow, segmented, stepper } from "../ui/controls";
import { ACTIVITY_KEYS, activities, type ActivityKey } from "../config";
import type { Participant, RoomConfig } from "../room";
import type { Question, ChoiceQuestion, NumberQuestion } from "../lib/quiz";
import { strings, fmt } from "../i18n";

const S = strings({
  he: {
    // participants
    peopleHint: "מי שלא משחק — ילדים, מי שלא יגיע — עדיין מופיע כאפשרות ב״מי הכי…״, בלי לוח ובלי ניקוד.",
    namePlaceholder: "שם",
    add: "הוסיפו",
    playing: "משחק/ת",
    notPlaying: "לא משחק/ת",
    remove: "הסרה",
    noPeople: "עוד לא הוספתם אף אחד. אפשר גם לדלג — כל מי שנכנס עם הקישור נרשם לבד.",
    peopleCount: (n: number) => `${fmt(n)} אנשים`,
    // activities
    gridSize: "גודל הלוח",
    gridHint: (cells: number) => `${fmt(cells)} משבצות — המאגר צריך לפחות כמה שיש בלוח.`,
    minProposals: "כל אחד מציע לפחות",
    minProposalsHint: "מינימום, לא מכסה — מי שיש לו עוד רעיונות מוסיף.",
    quizHint: "נדלק כשמעלים שאלות בשלב החידון.",
    // custom questions
    yourQuestions: "השאלות שלכם",
    noQuestions: "עוד אין שאלות משלכם.",
    typeChoice: "בחירה",
    typeNumber: "מספר",
    question: "השאלה",
    questionPlaceholder: "למשל: מי הראשון שנרדם בכל טיול?",
    answer: "התשובה הנכונה",
    wrong: (i: number) => `תשובה שגויה ${fmt(i)}`,
    numAnswer: "התשובה (מספר)",
    numMin: "מינימום בסרגל",
    numMax: "מקסימום בסרגל",
    reveal: "מה מספרים אחרי התשובה (לא חובה)",
    revealPlaceholder: "למשל: קרה כבר בשלושה טיולים ברצף.",
    addQuestion: "הוסיפו שאלה",
    needQuestion: "צריך שאלה ותשובה.",
    needWrong: "צריך לפחות תשובה שגויה אחת.",
    badRange: "המינימום צריך להיות קטן מהתשובה, והמקסימום גדול ממנה.",
    added: "השאלה נוספה",
    answerIs: (a: string) => `תשובה: ${a}`,
  },
  en: {
    peopleHint: "Non-players — kids, people who can't make it — still show up as options in “Who's most likely…”, with no board and no score.",
    namePlaceholder: "Name",
    add: "Add",
    playing: "Playing",
    notPlaying: "Not playing",
    remove: "Remove",
    noPeople: "Nobody added yet. You can skip this — anyone who opens the link signs themselves in.",
    peopleCount: (n: number) => `${fmt(n)} people`,
    gridSize: "Board size",
    gridHint: (cells: number) => `${fmt(cells)} squares — the pool needs at least as many as the board.`,
    minProposals: "Everyone suggests at least",
    minProposalsHint: "A minimum, not a quota — people with more ideas add more.",
    quizHint: "Turns on when you upload questions in the quiz step.",
    yourQuestions: "Your questions",
    noQuestions: "No questions of your own yet.",
    typeChoice: "Multiple choice",
    typeNumber: "Number",
    question: "The question",
    questionPlaceholder: "e.g. Who falls asleep first on every trip?",
    answer: "Correct answer",
    wrong: (i: number) => `Wrong answer ${fmt(i)}`,
    numAnswer: "The answer (a number)",
    numMin: "Slider minimum",
    numMax: "Slider maximum",
    reveal: "What to tell them after (optional)",
    revealPlaceholder: "e.g. Three trips in a row now.",
    addQuestion: "Add question",
    needQuestion: "A question and an answer are needed.",
    needWrong: "At least one wrong answer is needed.",
    badRange: "Minimum must be below the answer and maximum above it.",
    added: "Question added",
    answerIs: (a: string) => `Answer: ${a}`,
  },
});

/* ---------------------------------------------------------------- people */

export function participantsEditor(
  initial: Participant[],
  onChange: (list: Participant[]) => void
): HTMLElement {
  let list = initial.map((p) => ({ ...p }));
  const wrap = h("div");
  const listEl = h("div", { style: "margin-block-start:10px" });
  const input = textInput({ placeholder: S.namePlaceholder, maxlength: "24" });
  const addBtn = h("button.btn.btn-sm.btn-primary", null, S.add);

  const emit = () => onChange(list.map((p) => ({ ...p })));

  function add(): void {
    const name = input.value.trim().slice(0, 24);
    if (!name) return;
    if (list.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      input.value = "";
      return;
    }
    list.push({ name, playing: true });
    input.value = "";
    input.focus();
    render();
    emit();
  }

  addBtn.addEventListener("click", add);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  });

  function render(): void {
    clear(listEl);
    if (!list.length) {
      listEl.append(h("div.muted", null, S.noPeople));
      return;
    }
    listEl.append(h("div.muted", { style: "margin-block-end:6px" }, S.peopleCount(list.length)));
    list.forEach((p, i) => {
      const row = switchRow(
        p.name,
        p.playing,
        (on) => {
          list[i] = { ...list[i], playing: on };
          emit();
        },
        p.playing ? S.playing : S.notPlaying
      );
      // Refresh the subtitle on toggle without rebuilding the whole list.
      row.querySelector(".switch")?.addEventListener("click", () => {
        const sub = row.querySelector(".row-sub");
        if (sub) sub.textContent = list[i].playing ? S.playing : S.notPlaying;
      });
      row.append(
        h(
          "button.btn.btn-sm",
          {
            "aria-label": S.remove,
            style: "margin-inline-start:6px",
            onclick: () => {
              list.splice(i, 1);
              render();
              emit();
            },
          },
          "×"
        )
      );
      listEl.append(row);
    });
  }

  wrap.append(
    h("div.muted", { style: "margin-block-end:10px" }, S.peopleHint),
    h("div.inline-form", null, input, addBtn),
    listEl
  );
  render();
  return wrap;
}

/* ------------------------------------------------------------ activities */

export function activitiesEditor(initial: RoomConfig, onChange: (c: RoomConfig) => void): HTMLElement {
  const cfg: RoomConfig = {
    participants: initial.participants,
    activities: { ...initial.activities },
    bingo: { ...initial.bingo },
  };
  const wrap = h("div");
  const bingoExtra = h("div", { style: "margin-block-start:8px;padding-inline-start:8px" });
  const emit = () => onChange({ ...cfg, activities: { ...cfg.activities }, bingo: { ...cfg.bingo } });

  const meta = new Map(activities().map((a) => [a.key, a]));
  for (const key of ACTIVITY_KEYS as ActivityKey[]) {
    const a = meta.get(key)!;
    const on = cfg.activities[key] !== false && (key !== "quiz" || cfg.activities.quiz === true);
    wrap.append(
      switchRow(
        `${a.emoji} ${a.title}`,
        on,
        (v) => {
          cfg.activities[key] = v;
          if (key === "bingo") bingoExtra.classList.toggle("hidden", !v);
          emit();
        },
        key === "quiz" ? S.quizHint : a.blurb
      )
    );
    if (key === "bingo") {
      bingoExtra.classList.toggle("hidden", !on);
      wrap.append(bingoExtra);
    }
  }

  const gridHint = h("div.field-hint", null, S.gridHint(cfg.bingo.side ** 2));
  bingoExtra.append(
    field(
      S.gridSize,
      segmented(
        [3, 4, 5].map((n) => ({ value: n, label: `${n}×${n}` })),
        cfg.bingo.side,
        (side) => {
          cfg.bingo.side = side;
          gridHint.textContent = S.gridHint(side * side);
          emit();
        }
      )
    ),
    gridHint,
    field(
      S.minProposals,
      stepper(cfg.bingo.minProposals, 1, 10, (n) => {
        cfg.bingo.minProposals = n;
        emit();
      }),
      S.minProposalsHint
    )
  );
  return wrap;
}

/* ------------------------------------------------------- custom questions */

export const CUSTOM_PREFIX = "custom_";

export function isCustom(q: Question): boolean {
  return q.id.startsWith(CUSTOM_PREFIX);
}

export function customQuestionsEditor(initial: Question[], onChange: (qs: Question[]) => void): HTMLElement {
  let list = initial.filter(isCustom);
  const wrap = h("div");
  const listEl = h("div");
  const formEl = h("div.panel", { style: "margin-block-start:12px" });
  let type: "choice" | "number" = "choice";

  const emit = () => onChange(list.slice());

  function renderList(): void {
    clear(listEl);
    listEl.append(h("h2", null, S.yourQuestions));
    if (!list.length) {
      listEl.append(h("div.muted", null, S.noQuestions));
      return;
    }
    list.forEach((q, i) => {
      listEl.append(
        h(
          "div.row",
          null,
          h(
            "div.row-main",
            null,
            h("div", { dir: "auto" }, q.q),
            h("div.row-sub", { dir: "auto" }, S.answerIs(q.type === "choice" ? q.answer : fmt(q.answer)))
          ),
          h(
            "button.btn.btn-sm",
            {
              "aria-label": S.remove,
              onclick: () => {
                list.splice(i, 1);
                renderList();
                emit();
              },
            },
            "×"
          )
        )
      );
    });
  }

  function renderForm(): void {
    clear(formEl);
    const qInput = textInput({ placeholder: S.questionPlaceholder, maxlength: "140" });
    const revealInput = textInput({ placeholder: S.revealPlaceholder, maxlength: "200" });
    const err = h("div.gate-err");

    const choiceFields = h("div");
    const answerInput = textInput({ maxlength: "60" });
    const wrongInputs = [1, 2, 3].map(() => textInput({ maxlength: "60" }));
    choiceFields.append(field(S.answer, answerInput));
    wrongInputs.forEach((w, i) => choiceFields.append(field(S.wrong(i + 1), w)));

    const numberFields = h("div.hidden");
    const numAnswer = textInput({ inputmode: "numeric", pattern: "[0-9]*" });
    const numMin = textInput({ inputmode: "numeric", pattern: "[0-9]*", value: "0" });
    const numMax = textInput({ inputmode: "numeric", pattern: "[0-9]*" });
    numberFields.append(field(S.numAnswer, numAnswer), field(S.numMin, numMin), field(S.numMax, numMax));

    const typePick = segmented(
      [
        { value: "choice" as const, label: S.typeChoice },
        { value: "number" as const, label: S.typeNumber },
      ],
      type,
      (t) => {
        type = t;
        choiceFields.classList.toggle("hidden", t !== "choice");
        numberFields.classList.toggle("hidden", t !== "number");
      }
    );

    const addBtn = h("button.btn.btn-primary.btn-block", { style: "margin-block-start:10px" }, S.addQuestion);
    addBtn.addEventListener("click", () => {
      err.textContent = "";
      const q = qInput.value.trim();
      const reveal = revealInput.value.trim();
      const id = `${CUSTOM_PREFIX}${Date.now().toString(36)}`;
      if (type === "choice") {
        const answer = answerInput.value.trim();
        const wrong = wrongInputs.map((w) => w.value.trim()).filter(Boolean);
        if (!q || !answer) return void (err.textContent = S.needQuestion);
        if (!wrong.length) return void (err.textContent = S.needWrong);
        const item: ChoiceQuestion = { id, type: "choice", q, answer, wrong, reveal, points: 100 };
        list.push(item);
      } else {
        const answer = Number(numAnswer.value.trim());
        const min = Number(numMin.value.trim());
        const max = Number(numMax.value.trim());
        if (!q || !Number.isFinite(answer) || numAnswer.value.trim() === "") return void (err.textContent = S.needQuestion);
        if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < answer && answer < max)) {
          return void (err.textContent = S.badRange);
        }
        const span = max - min;
        const step = span <= 50 ? 1 : span <= 500 ? 5 : span <= 5000 ? 10 : Math.pow(10, Math.floor(Math.log10(span)) - 2);
        // Relative falloff (~70% of the answer), same rule as the generated questions.
        const falloff = Math.max(1, Math.round(Math.abs(answer) * 0.7));
        const item: NumberQuestion = { id, type: "number", q, min, max, step, answer, falloff, reveal, points: 100 };
        list.push(item);
      }
      toast(S.added);
      renderList();
      renderForm();
      emit();
    });

    formEl.append(
      h("div.field", null, typePick),
      field(S.question, qInput),
      choiceFields,
      numberFields,
      field(S.reveal, revealInput),
      err,
      addBtn
    );
  }

  wrap.append(listEl, formEl);
  renderList();
  renderForm();
  return wrap;
}

/** Merge the host's questions into whatever generated quiz exists. */
export function mergeCustom(existing: Question[], custom: Question[]): Question[] {
  return [...existing.filter((q) => !isCustom(q)), ...custom];
}
