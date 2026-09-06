/**
 * Tiny DOM helpers. No framework — the whole app is a few hundred lines of
 * createElement, and a dependency would cost more than it saves here.
 */

import { fmt, strings } from "../i18n";

const S = strings({
  he: { outOf: " מתוך " },
  en: { outOf: " of " },
});

type Attrs = Record<string, unknown>;
type Child = Node | string | number | null | undefined | false;

/**
 * h("div.card", {onclick}, "text", child, ...)
 *
 * The tag accepts a CSS-ish shorthand: "button.btn.btn-primary" or "span#id".
 * Attribute keys starting with "on" become listeners; everything else is set
 * with setAttribute, except `dataset`-style keys and boolean false/null/undefined
 * which are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: string,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] extends never ? HTMLElement : HTMLElement {
  const idMatch = tag.match(/#([\w-]+)/);
  const classes = [...tag.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const name = tag.match(/^[\w-]+/)?.[0] ?? "div";

  const el = document.createElement(name);
  if (idMatch) el.id = idMatch[1];
  if (classes.length) el.className = classes.join(" ");

  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "class") {
      el.className = [el.className, String(v)].filter(Boolean).join(" ");
    } else if (k === "text") {
      el.textContent = String(v);
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }

  append(el, children);
  return el;
}

export function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

/**
 * Wrap a number or Latin string so bidi leaves it alone.
 *
 * This is not optional decoration. In an RTL document "11/14" next to Hebrew
 * renders as "14/11", and an English title like "War and Peace" gets its
 * punctuation flung to the wrong end. Every number the user reads goes through
 * here.
 */
export function bdi(value: string | number): HTMLElement {
  const el = document.createElement("bdi");
  el.textContent = typeof value === "number" ? fmt(value) : value;
  return el;
}

/** "X מתוך Y" / "X of Y" — numerals kept between words, never "X/Y", which bidi flips. */
export function outOf(a: number, b: number): HTMLElement {
  return h("span", null, bdi(a), S.outOf, bdi(b));
}

let toastWrap: HTMLElement | null = null;

/** Transient message at the top of the screen. Auto-dismisses. */
export function toast(message: string, ms = 3200): void {
  if (!toastWrap) {
    toastWrap = h("div.toast-wrap");
    document.body.append(toastWrap);
  }
  const t = h("div.toast", { dir: "auto" }, message);
  toastWrap.append(t);
  setTimeout(() => t.remove(), ms);
}

/** A short buzz, where the browser allows it. Silently absent on iOS. */
export function buzz(ms = 50): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported — ignore */
  }
}

/**
 * Counts read badly with a bare numeral at one: "1 שאלות" is wrong, and a whole
 * UI full of it feels machine-made. Pass the singular phrase and the plural
 * noun; the number is only rendered when it is not one. Language-neutral — the
 * caller passes phrases from its own string table.
 *
 *   heCount(1, "שאלה אחת", "שאלות")  ->  שאלה אחת
 *   heCount(5, "one question", "questions")  ->  5 questions
 */
export function heCount(n: number, one: string, many: string): HTMLElement {
  if (n === 1) return h("span", null, one);
  return h("span", null, bdi(n), " ", many);
}

/** String form of heCount, for template literals. */
export function heCountText(n: number, one: string, many: string): string {
  return n === 1 ? one : `${fmt(n)} ${many}`;
}
