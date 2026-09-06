/**
 * Language: Hebrew or English, switchable at runtime.
 *
 * There is no central string file. Each module declares its own table with
 * `strings({ he: {...}, en: {...} })` and reads `S.someKey`; the proxy resolves
 * the current language on every access, so a switch needs no re-import and a
 * screen re-render picks up the new text. Keeping translations next to the
 * code that uses them is what made extracting ~330 strings tractable, and it is
 * what keeps them from rotting: you cannot add a Hebrew string without the
 * TypeScript shape demanding the English one.
 *
 * Resolution: an explicit choice on this phone (the toggle) wins; otherwise the
 * event's language; otherwise Hebrew.
 *
 * Direction follows language. The whole stylesheet uses logical properties, so
 * flipping `dir` on <html> is the entire RTL/LTR switch.
 */

import { getRoom, roomId } from "./room";

export type Lang = "he" | "en";

const K_LANG = "wq-lang";

let override: Lang | null = readOverride();

function readOverride(): Lang | null {
  try {
    const v = localStorage.getItem(K_LANG);
    return v === "he" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function lang(): Lang {
  if (override) return override;
  if (roomId()) return getRoom().lang ?? "he";
  // No event yet (landing page, wizard): the phone's own language decides.
  return typeof navigator !== "undefined" && /^he\b/i.test(navigator.language) ? "he" : "en";
}

export function isRtl(): boolean {
  return lang() === "he";
}

/** BCP-47 tag for number and date formatting. */
export function locale(): string {
  return lang() === "he" ? "he-IL" : "en-US";
}

/**
 * Pick a language on this phone. `null` clears the choice and follows the
 * event again. Callers re-render; this only stores and flips the document.
 */
export function setLang(next: Lang | null): void {
  override = next;
  try {
    if (next) localStorage.setItem(K_LANG, next);
    else localStorage.removeItem(K_LANG);
  } catch {
    /* fine — the choice just does not persist */
  }
  applyDocumentLang();
}

/** Set <html lang dir> to match. Call at boot and after every switch. */
export function applyDocumentLang(): void {
  const l = lang();
  document.documentElement.lang = l;
  document.documentElement.dir = l === "he" ? "rtl" : "ltr";
}

/**
 * Declare a module's strings in both languages and get back an object that
 * reads as the current language.
 *
 *   const S = strings({
 *     he: { title: "בינגו", sent: (n: number) => `${n} נשלחו` },
 *     en: { title: "Bingo",  sent: (n: number) => `${n} sent` },
 *   });
 *   S.title          // "בינגו" or "Bingo", depending on lang() right now
 *   S.sent(3)
 *
 * Values may be strings or functions; keep any HTML building in the caller.
 */
export function strings<T extends Record<string, string | ((...args: any[]) => string)>>(tables: {
  he: T;
  en: T;
}): T {
  return new Proxy(tables.he, {
    get(_target, key) {
      const table = tables[lang()] ?? tables.he;
      return (table as Record<PropertyKey, unknown>)[key];
    },
  });
}

/** Number as text in the current locale, e.g. 1,234. */
export function fmt(n: number): string {
  return n.toLocaleString(locale());
}

/**
 * "one X" / "N Xs" in either language. Pass the full singular phrase and the
 * plural noun: `plural(n, "שאלה אחת", "שאלות")` or `plural(n, "one question", "questions")`.
 * A bare numeral next to a Hebrew singular ("1 שאלות") is exactly what this avoids.
 */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${fmt(n)} ${many}`;
}

/** The names people see on the toggle. Always in their own language. */
export const LANG_LABEL: Record<Lang, string> = { he: "עברית", en: "English" };
