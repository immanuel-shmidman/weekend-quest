/**
 * The event-log client.
 *
 * Everything in this app — bingo marks, truth submissions, guesses, quiz
 * answers, phase changes — is an append-only event. This module owns fetching
 * them, sending them, and telling the app when the world changed.
 *
 * Design notes worth keeping:
 *
 *  - Reads are INCREMENTAL (`?since=<cursor>`). D1 bills rows *scanned*, and a
 *    full-table read on every poll from 14 phones is ~53M rows/day against a 5M
 *    free-tier budget. A cursor read that finds nothing scans about one row.
 *    Do not "simplify" this into fetching everything.
 *
 *  - Writes are OPTIMISTIC and idempotent. post() never awaits and never
 *    throws: it appends a pending event locally, tells the UI immediately, and
 *    queues the real write. Each carries a client-generated uid with a UNIQUE
 *    index behind it, so a phone on bad wifi that times out and retries cannot
 *    double-submit.
 *
 *  - Everything degrades to null rather than throwing, following the
 *    birthday-quest src/leaderboard.ts precedent. An offline phone still
 *    renders its board from cache.
 */

import { IDLE_STOP_MS } from "./config";
import { me } from "./identity";
import { roomId, roomKey, partyHeader } from "./room";

export interface Ev {
  id: number; // server-assigned, monotonic; negative while pending
  kind: string;
  player: string;
  payload: any;
  ts: number;
}

interface Pending {
  uid: string;
  kind: string;
  player: string;
  payload: unknown;
}

// Per room: a phone that has been to two events must never mix their logs.
const K_EVENTS = () => roomKey("wq-events");
const K_OUTBOX = () => roomKey("wq-outbox");
const API = "./api/events";

let served: Ev[] = []; // confirmed, from the server
let pending: Pending[] = []; // written locally, not yet acknowledged
let cursor = 0;
let listener: ((events: Ev[]) => void) | null = null;
let timer: number | null = null;
let intervalMs: number | null = null;
let inFlight = false;
let lastOk = 0;
let lastInteraction = Date.now();
let idleStopped = false;
let state: "live" | "syncing" | "offline" = "syncing";

// --- persistence -----------------------------------------------------------

function loadCache(): void {
  try {
    const rawEvents = localStorage.getItem(K_EVENTS());
    if (rawEvents) {
      const parsed = JSON.parse(rawEvents) as Ev[];
      if (Array.isArray(parsed)) {
        served = parsed;
        cursor = parsed.reduce((m, e) => Math.max(m, e.id), 0);
      }
    }
    const rawOutbox = localStorage.getItem(K_OUTBOX());
    if (rawOutbox) {
      const parsed = JSON.parse(rawOutbox) as Pending[];
      if (Array.isArray(parsed)) pending = parsed;
    }
  } catch {
    served = [];
    pending = [];
    cursor = 0;
  }
}

function saveCache(): void {
  try {
    localStorage.setItem(K_EVENTS(), JSON.stringify(served));
    localStorage.setItem(K_OUTBOX(), JSON.stringify(pending));
  } catch {
    /* quota or private mode — the app still works, it just starts cold */
  }
}

// --- public view -----------------------------------------------------------

/** Confirmed events plus anything still queued, in id order. */
export function events(): Ev[] {
  if (!pending.length) return served;
  const optimistic: Ev[] = pending.map((p, i) => ({
    id: -(i + 1),
    kind: p.kind,
    player: p.player,
    payload: p.payload,
    ts: Date.now(),
  }));
  return served.concat(optimistic);
}

export function status(): "live" | "syncing" | "offline" {
  return state;
}

export function pendingCount(): number {
  return pending.length;
}

function emit(): void {
  listener?.(events());
}

function setState(next: typeof state): void {
  if (state === next) return;
  state = next;
  emit();
}

// --- writing ---------------------------------------------------------------

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/**
 * Queue an event. Returns immediately — the UI updates on this frame, the
 * network catches up whenever it can.
 */
export function post(kind: string, payload: object): void {
  pending.push({ uid: uid(), kind, player: me.id, payload });
  saveCache();
  emit();
  markInteraction();
  void flush();
}

async function flush(): Promise<void> {
  if (inFlight || !pending.length) return;
  inFlight = true;
  const batch = pending.slice(0, 20);
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-party": partyHeader() },
      body: JSON.stringify({ room: roomId(), since: cursor, events: batch }),
    });
    const sent = new Set(batch.map((b) => b.uid));
    if (isPermanentRejection(res.status)) {
      // The server understood us and said no (bad payload, not host, wrong
      // password). Retrying cannot help, and leaving the batch in the outbox
      // would block every later write behind it forever.
      pending = pending.filter((p) => !sent.has(p.uid));
      lastOk = Date.now();
      setState("live");
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { events?: Ev[]; cursor?: number };
    // Accepted: drop exactly the uids we sent, so anything queued meanwhile survives.
    pending = pending.filter((p) => !sent.has(p.uid));
    absorb(data);
    lastOk = Date.now();
    setState("live");
  } catch {
    // Keep the outbox; it is persisted, so it survives a reload and drains later.
    setState(Date.now() - lastOk > 20_000 ? "offline" : "syncing");
  } finally {
    inFlight = false;
    saveCache();
    emit();
  }
}

/** 4xx other than "slow down" — the request itself is wrong, not the network. */
function isPermanentRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429 && status !== 408;
}

// --- reading ---------------------------------------------------------------

function absorb(data: { events?: Ev[]; cursor?: number }): boolean {
  const incoming = Array.isArray(data.events) ? data.events : [];
  if (!incoming.length) {
    if (typeof data.cursor === "number") cursor = Math.max(cursor, data.cursor);
    return false;
  }
  // Dedupe by id — a re-read of overlapping ids must be harmless.
  const seen = new Set(served.map((e) => e.id));
  let added = false;
  for (const e of incoming) {
    if (seen.has(e.id)) continue;
    served.push(e);
    seen.add(e.id);
    added = true;
  }
  served.sort((a, b) => a.id - b.id);
  cursor = Math.max(cursor, ...served.map((e) => e.id));
  return added;
}

async function poll(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch(`${API}?room=${encodeURIComponent(roomId())}&since=${cursor}`, {
      headers: { "x-party": partyHeader() },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { events?: Ev[]; cursor?: number; more?: boolean };
    const added = absorb(data);
    lastOk = Date.now();
    setState("live");
    if (added) {
      saveCache();
      emit();
    }
    // A full page means a phone joining late is behind; catch up now rather
    // than one page per tick.
    if (data.more) {
      inFlight = false;
      return poll();
    }
  } catch {
    setState(Date.now() - lastOk > 20_000 ? "offline" : "syncing");
  } finally {
    inFlight = false;
  }
}

// --- the loop --------------------------------------------------------------

function tick(): void {
  if (document.hidden) return;
  if (Date.now() - lastInteraction > IDLE_STOP_MS) {
    idleStopped = true;
    return;
  }
  void flush();
  void poll();
}

function reschedule(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (intervalMs !== null) timer = setInterval(tick, intervalMs) as unknown as number;
}

/** Set by the router on every route change. `null` stops polling entirely. */
export function setPollInterval(ms: number | null): void {
  intervalMs = ms;
  reschedule();
  if (ms !== null) tick();
}

export function pokeNow(): void {
  markInteraction();
  void flush();
  void poll();
}

export function markInteraction(): void {
  lastInteraction = Date.now();
  if (idleStopped) {
    idleStopped = false;
    reschedule();
    tick();
  }
}

export function isIdleStopped(): boolean {
  return idleStopped;
}

export function start(onChange: (events: Ev[]) => void): void {
  listener = onChange;
  loadCache();
  emit();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pokeNow();
  });
  for (const evt of ["pointerdown", "keydown"]) {
    window.addEventListener(evt, markInteraction, { passive: true });
  }

  pokeNow();
}
