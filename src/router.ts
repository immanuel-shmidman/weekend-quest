/**
 * A ~50-line hash router.
 *
 * Hash, not path: Cloudflare Pages would need a _redirects SPA fallback for
 * path routing, which interacts awkwardly with vite's `base: "./"`. Hash also
 * means the back button works for free and a refresh always lands on the same
 * screen — which matters when phones lock and reload all weekend.
 *
 * The router is also the single place the polling policy is enforced: every
 * route declares how often it needs fresh data, and switching screens retunes
 * the sync loop. See config.POLL_MS for why that matters.
 */

import * as sync from "./sync";

/** A screen renders into `root` and returns an optional teardown. */
export type Screen = (root: HTMLElement) => (() => void) | void;

interface Route {
  screen: Screen;
  pollMs: number | null;
}

const routes = new Map<string, Route>();
let current: (() => void) | void;
let root: HTMLElement;
let onNavigate: ((path: string) => void) | null = null;

export function register(path: string, screen: Screen, pollMs: number | null): void {
  routes.set(path, { screen, pollMs });
}

export function path(): string {
  const raw = location.hash.replace(/^#/, "");
  return raw.startsWith("/") ? raw : "/";
}

export function go(to: string): void {
  const next = to.startsWith("#") ? to : "#" + to;
  if (location.hash === next) render();
  else location.hash = next;
}

function render(): void {
  const p = path();
  // Unknown routes fall back home rather than showing a blank screen.
  const route = routes.get(p) ?? routes.get("/")!;

  if (typeof current === "function") current();
  current = undefined;

  root.replaceChildren();
  sync.setPollInterval(route.pollMs);
  current = route.screen(root);
  window.scrollTo(0, 0);
  onNavigate?.(p);
}

export function start(mount: HTMLElement, opts: { onNavigate?: (p: string) => void } = {}): void {
  root = mount;
  onNavigate = opts.onNavigate ?? null;
  window.addEventListener("hashchange", render);
  if (!location.hash) location.hash = "#/";
  render();
}

/** Re-render the current screen in place (used when the world changes shape). */
export function refresh(): void {
  render();
}
