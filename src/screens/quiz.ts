import { h, bdi, outOf, toast, buzz, clear } from "../ui/dom";
import { me } from "../identity";
import * as sync from "../sync";
import { getWorld } from "../world";
import { go } from "../router";
import { getRoom } from "../room";
import { strings, lang } from "../i18n";
import {
  optionsFor,
  scoreChoice,
  scoreNumber,
  type ChatStats,
  hasChatStats,
  type ChoiceQuestion,
  type NumberQuestion,
} from "../lib/quiz";

const S = strings({
  he: {
    title: "💬 החידון של הקבוצה",
    back: "חזרה",
    intro: "הקבוצה, במספרים. שאלות על מי כתב מה, מתי, וכמה.",
    answered: "ענית על ",
    points: " נקודות",
    notReady: "החידון עדיין לא מוכן.",
    notReadySub: "המארגנים עוד לא העלו שאלות.",
    finished: "סיימתם את כל השאלות 🎉",
    toTable: "לטבלה",
    continueBtn: "המשיכו",
    start: "מתחילים!",
    facts: "כמה מספרים",
    totalMessages: "הודעות בסך הכול",
    words: "מילים",
    daysSinceFirst: "ימים מאז ההודעה הראשונה",
    silentDays: "ימים בלי אף הודעה",
    topEmoji: (emoji: string) => `האימוג׳י הכי נפוץ ${emoji}`,
    torahBefore: "כתבתם יחד פי ",
    torahAfter: " מכל התורה כולה.",
    beats: (title: string) => `עברתם את "${title}".`,
    shortOf: (title: string) => `רק "${title}" עדיין מנצח אתכם.`,
    question: "שאלה ",
    of: " מתוך ",
    myAnswer: "זו התשובה שלי",
    next: "השאלה הבאה",
    done: "סיימנו",
  },
  en: {
    title: "💬 The Group Quiz",
    back: "Back",
    intro: "The group, in numbers. Who wrote what, when, and how much.",
    answered: "Answered ",
    points: " points",
    notReady: "The quiz isn't ready yet.",
    notReadySub: "The hosts haven't uploaded any questions.",
    finished: "You finished every question 🎉",
    toTable: "Standings",
    continueBtn: "Continue",
    start: "Let's go!",
    facts: "Some numbers",
    totalMessages: "Total messages",
    words: "Words",
    daysSinceFirst: "Days since the first message",
    silentDays: "Days with no messages at all",
    topEmoji: (emoji: string) => `Most used emoji ${emoji}`,
    torahBefore: "Together you've written ",
    torahAfter: " times the entire Torah.",
    beats: (title: string) => `You've passed "${title}".`,
    shortOf: (title: string) => `Only "${title}" still beats you.`,
    question: "Question ",
    of: " of ",
    myAnswer: "That's my answer",
    next: "Next question",
    done: "Done",
  },
});

/**
 * The WhatsApp quiz.
 *
 * Self-paced and solo — no phases, no host, playable at any point all weekend.
 * That absence of coordination is deliberate: two of the three core activities
 * need phases, and the third not needing them is a real simplification.
 *
 * An answer is posted once and stands; the fold ignores repeats, so nobody can
 * retry a question for a better score.
 */
export function quizScreen(root: HTMLElement): void {
  // Uploaded by the host at setup (or by the v1 migration); null means this
  // event simply has no quiz, which the home screen already hides.
  const DATA = getRoom().quiz;
  const questions = DATA?.questions ?? [];
  const answered = getWorld().quiz.get(me.id) ?? new Map<string, number>();
  const remaining = questions.filter((q) => !answered.has(q.id));

  const head = h("div.screen-head");
  const body = h("div");
  root.append(head, body);

  function renderHead(): void {
    clear(head);
    head.append(
      h("h1", null, S.title),
      h("button.btn.btn-sm", { onclick: () => go("#/") }, S.back)
    );
  }

  function renderIntro(): void {
    clear(body);
    const total = questions.length;
    const done = total - remaining.length;
    let myScore = 0;
    for (const p of answered.values()) myScore += p;

    body.append(
      h(
        "div.panel",
        null,
        h("p", null, S.intro),
        h("div.muted", null, S.answered, outOf(done, total), " · ", bdi(myScore), S.points)
      )
    );

    if (!total) {
      body.append(
        h(
          "div.panel.center",
          null,
          h("p", null, S.notReady),
          h("div.muted", null, S.notReadySub)
        )
      );
      return;
    }

    if (!remaining.length) {
      body.append(
        h(
          "div.panel.center",
          null,
          h("h2", null, S.finished),
          h("p", null, bdi(myScore), S.points),
          h("button.btn.btn-block", { onclick: () => go("#/scores") }, S.toTable)
        )
      );
      if (hasChatStats(DATA)) body.append(factsPanel(DATA));
      return;
    }

    body.append(
      h(
        "button.btn.btn-primary.btn-block",
        { onclick: () => ask(0) },
        done ? S.continueBtn : S.start
      )
    );
  }

  /**
   * The headline numbers.
   *
   * Only rendered once every question is answered - the totals here (messages,
   * words, silent days, top-emoji count) are literally the answers to several
   * of the numeric questions, so showing this up front hands the quiz away.
   */
  function factsPanel(d: ChatStats & Required<Pick<ChatStats, "source" | "group" | "wordComparison">>): HTMLElement {
    const wc = d.wordComparison;
    // Book titles carry both languages when generated by v2; v1 data has Hebrew only.
    const title = (b: { he: string; en?: string }) => (lang() === "en" && b.en ? b.en : b.he);
    const panel = h("div.panel");
    panel.append(h("h2", null, S.facts));
    const row = (label: string, value: Node | string) =>
      h("div.row", null, h("div.row-main", null, label), h("div", null, value));

    panel.append(
      row(S.totalMessages, bdi(d.source.messages)),
      row(S.words, bdi(wc.totalWords)),
      row(S.daysSinceFirst, bdi(d.source.spanDays)),
      row(S.silentDays, bdi(d.source.silentDays))
    );
    if (d.group.topEmoji?.[0]) {
      panel.append(
        row(
          S.topEmoji(d.group.topEmoji[0].emoji),
          bdi(d.group.topEmoji[0].n)
        )
      );
    }
    panel.append(
      h(
        "div",
        { style: "margin-block-start:12px;line-height:1.6" },
        S.torahBefore,
        bdi(wc.torahMultiple),
        S.torahAfter,
        wc.beats[0] ? h("div.muted", { dir: "auto" }, S.beats(title(wc.beats[0]))) : null,
        wc.shortOf[0]
          ? h("div.muted", { dir: "auto" }, S.shortOf(title(wc.shortOf[0])))
          : null
      )
    );
    return panel;
  }

  function ask(i: number): void {
    const q = remaining[i];
    if (!q) {
      renderIntro();
      return;
    }
    clear(body);
    body.append(
      h(
        "div.muted.center",
        { style: "margin-block-end:10px" },
        S.question,
        bdi(i + 1),
        S.of,
        bdi(remaining.length)
      )
    );
    body.append(q.type === "choice" ? choiceCard(q, i) : numberCard(q, i));
  }

  function choiceCard(q: ChoiceQuestion, i: number): HTMLElement {
    const panel = h("div.panel");
    panel.append(h("h2", { dir: "auto" }, q.q));
    let locked = false;

    for (const option of optionsFor(q)) {
      const btn = h(
        "button.card",
        {
          dir: "auto",
          onclick: () => {
            if (locked) return;
            locked = true;
            const points = scoreChoice(q, option);
            const right = option === q.answer;
            btn.style.borderColor = right ? "var(--good)" : "var(--bad)";
            if (!right) {
              // Reveal the truth on a miss — the reveal line is the payoff.
              for (const other of panel.querySelectorAll("button.card")) {
                if (other.textContent?.trim() === q.answer) {
                  (other as HTMLElement).style.borderColor = "var(--good)";
                }
              }
            }
            buzz(right ? 60 : 25);
            sync.post("q.answer", { qid: q.id, value: option, points });
            showReveal(panel, q.reveal, points, i, q.quote);
          },
        },
        option
      );
      panel.append(btn);
    }
    return panel;
  }

  function numberCard(q: NumberQuestion, i: number): HTMLElement {
    const panel = h("div.panel");
    panel.append(h("h2", { dir: "auto" }, q.q));

    const value = h("div.center", {
      style: "font-size:30px;font-weight:700;margin-block:10px",
    });
    const slider = h("input", {
      type: "range",
      min: String(q.min),
      max: String(q.max),
      step: String(q.step),
      value: String(Math.round((q.min + q.max) / 2 / q.step) * q.step),
      // Pinned LTR: numeric magnitude ascends rightwards everywhere, and an
      // RTL track put the maximum on the left while the labels said otherwise.
      style: "inline-size:100%;direction:ltr",
    }) as HTMLInputElement;

    const paint = () => {
      clear(value);
      value.append(bdi(Number(slider.value)));
    };
    slider.addEventListener("input", paint);
    paint();

    const submit = h(
      "button.btn.btn-primary.btn-block",
      {
        style: "margin-block-start:12px",
        onclick: () => {
          const guess = Number(slider.value);
          const points = scoreNumber(q, guess);
          slider.disabled = true;
          submit.setAttribute("disabled", "");
          buzz(points > q.points / 2 ? 60 : 25);
          sync.post("q.answer", { qid: q.id, value: guess, points });
          showReveal(panel, q.reveal, points, i);
        },
      },
      S.myAnswer
    );

    panel.append(
      value,
      slider,
      h(
        "div",
        {
          // LTR too, so min sits under the left end of the track and max under
          // the right end - matching the control above it.
          style:
            "display:flex;justify-content:space-between;font-size:12px;" +
            "color:var(--muted);direction:ltr",
        },
        h("span", null, bdi(q.min)),
        h("span", null, bdi(q.max))
      ),
      submit
    );
    return panel;
  }

  function showReveal(
    panel: HTMLElement,
    reveal: string,
    points: number,
    i: number,
    quote?: string
  ): void {
    panel.append(
      h(
        "div",
        { style: "margin-block-start:14px;padding-block-start:12px;border-block-start:1px solid var(--panel-2)" },
        h("div", { dir: "auto" }, reveal),
        // Some reveals carry the message itself. Rendered as a block rather
        // than inlined so the story is readable and newlines survive.
        quote ? h("div.quote", { dir: "auto" }, quote) : null,
        h(
          "div",
          { style: "margin-block-start:8px;color:" + (points > 0 ? "var(--good)" : "var(--muted)") },
          "+",
          bdi(points),
          S.points
        )
      ),
      h(
        "button.btn.btn-block",
        { style: "margin-block-start:12px", onclick: () => ask(i + 1) },
        i + 1 < remaining.length ? S.next : S.done
      )
    );
    if (points > 0) toast(`+${points}`);
  }

  renderHead();
  renderIntro();
}
