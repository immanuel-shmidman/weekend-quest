/**
 * Form controls for the setup screens: labelled fields, switches, segmented
 * pickers, steppers, copy buttons. Plain DOM like everything else; each returns
 * an element and reports changes through a callback.
 *
 * The game screens never needed these — they are forms, lists and a grid. The
 * wizard is a form, so it gets a small kit rather than ad-hoc markup per step.
 */

import { h, clear, bdi } from "./dom";
import { strings } from "../i18n";

const S = strings({
  he: { copy: "העתקה", copied: "הועתק ✓", on: "פעיל", off: "כבוי" },
  en: { copy: "Copy", copied: "Copied ✓", on: "On", off: "Off" },
});

/** A label above a control, with an optional muted hint under it. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    "div.field",
    null,
    h("label.field-label", null, label),
    control,
    hint ? h("div.field-hint", null, hint) : null
  );
}

export function textInput(attrs: Record<string, unknown> = {}): HTMLInputElement {
  return h("input", { type: "text", dir: "auto", autocomplete: "off", ...attrs }) as HTMLInputElement;
}

/** A row with a title, optional subtitle and a switch on the end. */
export function switchRow(
  label: string,
  on: boolean,
  onChange: (on: boolean) => void,
  sub?: string
): HTMLElement {
  const sw = h("button.switch", {
    role: "switch",
    "aria-checked": String(on),
    "aria-label": label,
    class: on ? "on" : "",
  });
  const state = h("span.switch-state", null, on ? S.on : S.off);
  let value = on;
  sw.addEventListener("click", () => {
    value = !value;
    sw.classList.toggle("on", value);
    sw.setAttribute("aria-checked", String(value));
    state.textContent = value ? S.on : S.off;
    onChange(value);
  });
  return h(
    "div.row",
    null,
    h("div.row-main", null, h("div", { dir: "auto" }, label), sub ? h("div.row-sub", null, sub) : null),
    h("div.switch-wrap", null, state, sw)
  );
}

/** Mutually exclusive options in one strip. */
export function segmented<T extends string | number>(
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void
): HTMLElement {
  const strip = h("div.seg", { role: "radiogroup" });
  const paint = (current: T) => {
    clear(strip);
    for (const o of options) {
      strip.append(
        h(
          "button.seg-btn",
          {
            role: "radio",
            "aria-checked": String(o.value === current),
            class: o.value === current ? "on" : "",
            onclick: () => {
              if (o.value === current) return;
              paint(o.value);
              onChange(o.value);
            },
          },
          o.label
        )
      );
    }
  };
  paint(value);
  return strip;
}

/** − N + with bounds. */
export function stepper(
  value: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
  format: (v: number) => string = String
): HTMLElement {
  let current = value;
  const show = h("span.stepper-value", null, bdi(format(current)));
  const minus = h("button.btn.btn-sm", { "aria-label": "−" }, "−");
  const plus = h("button.btn.btn-sm", { "aria-label": "+" }, "+");
  const set = (v: number) => {
    current = Math.min(max, Math.max(min, v));
    clear(show);
    show.append(bdi(format(current)));
    minus.toggleAttribute("disabled", current <= min);
    plus.toggleAttribute("disabled", current >= max);
    onChange(current);
  };
  minus.addEventListener("click", () => set(current - 1));
  plus.addEventListener("click", () => set(current + 1));
  set(current);
  return h("div.stepper", null, minus, show, plus);
}

/** Copies `text` to the clipboard; the label flips briefly to confirm. */
export function copyButton(text: () => string, label = S.copy): HTMLElement {
  const btn = h("button.btn.btn-sm", null, label);
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text());
      btn.textContent = S.copied;
      setTimeout(() => (btn.textContent = label), 1600);
    } catch {
      // No clipboard (old iOS, insecure context): select the text instead.
      const ta = h("textarea", { style: "position:fixed;opacity:0" }) as HTMLTextAreaElement;
      ta.value = text();
      document.body.append(ta);
      ta.select();
      try {
        document.execCommand("copy");
        btn.textContent = S.copied;
        setTimeout(() => (btn.textContent = label), 1600);
      } catch {
        /* give up quietly; the text is visible on screen anyway */
      }
      ta.remove();
    }
  });
  return btn;
}

/** A value people need to read or copy: monospace, LTR, with a copy button. */
export function codeBox(value: () => string, opts: { label?: string; big?: boolean } = {}): HTMLElement {
  return h(
    "div.codebox",
    null,
    opts.label ? h("div.field-label", null, opts.label) : null,
    h(
      "div.codebox-row",
      null,
      h("code.codebox-value", { class: opts.big ? "big" : "", dir: "ltr" }, value()),
      copyButton(value)
    )
  );
}

/** Step dots for a wizard: filled up to `current`. */
export function progressDots(total: number, current: number): HTMLElement {
  const wrap = h("div.dots", { "aria-hidden": "true" });
  for (let i = 0; i < total; i++) wrap.append(h("span.dot", { class: i <= current ? "on" : "" }));
  return wrap;
}
