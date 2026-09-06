/**
 * Cloudflare Turnstile: "is this a person?" for the two doors that can be
 * abused — creating an event and sending feedback. Guests never see it.
 *
 * The widget script is the one external script this app loads; it comes from
 * Cloudflare, who already host the site. Loaded on demand, so the home screen
 * and the game screens never fetch it.
 *
 * Usage:
 *   const ts = await mountTurnstile(container, "create-event");
 *   ...
 *   const token = ts.token();      // "" until the widget has passed
 *   ts.reset();                    // after the server consumed the token
 *
 * The token is single-use and expires after five minutes; the server verifies
 * it with siteverify (functions/_lib.js) and rejects a request without one.
 * With no site key configured (local dev without a widget) `mountTurnstile`
 * renders nothing and `token()` is "", and the server skips the check only
 * when it has no secret either.
 */

import { TURNSTILE_SITE_KEY } from "../config";
import { lang } from "../i18n";

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      reset(id?: string): void;
      remove(id: string): void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile script failed to load"));
    document.head.append(s);
  });
  return loading;
}

export interface TurnstileHandle {
  /** The current token, or "" if the widget has not passed (yet, or again after reset). */
  token(): string;
  /** Ask for a fresh token — tokens are single-use, so call this after every submit. */
  reset(): void;
  /** True when there is no widget at all (no site key configured). */
  disabled: boolean;
}

export async function mountTurnstile(container: HTMLElement, action: "create-event" | "feedback"): Promise<TurnstileHandle> {
  if (!TURNSTILE_SITE_KEY) {
    return { token: () => "", reset: () => {}, disabled: true };
  }
  await loadScript();
  const ts = window.turnstile;
  if (!ts) return { token: () => "", reset: () => {}, disabled: true };

  let current = "";
  const holder = document.createElement("div");
  holder.className = "turnstile";
  container.append(holder);
  const id = ts.render(holder, {
    sitekey: TURNSTILE_SITE_KEY,
    action,
    theme: "dark",
    language: lang(),
    size: "flexible",
    callback: (token: string) => {
      current = token;
    },
    "expired-callback": () => {
      current = "";
    },
    "error-callback": () => {
      current = "";
    },
  });
  return {
    token: () => current,
    reset: () => {
      current = "";
      try {
        ts.reset(id);
      } catch {
        /* widget gone */
      }
    },
    disabled: false,
  };
}
