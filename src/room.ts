/**
 * The current event ("room"): which one this phone is looking at, and what the
 * server said about it.
 *
 * v1 had exactly one event, so its password, host code, room id, bingo size and
 * quiz were compile-time constants in config.ts. v2 hosts many events on one
 * deployment, so all of that is a row in the `rooms` table, fetched once at boot
 * and held here. Every screen that used to import a constant reads a getter
 * from this module instead.
 *
 * Resolution order for "which room":
 *   1. `?r=<id>` in the URL — what a shared link carries.
 *   2. the last room this phone opened — so an add-to-home-screen icon, whose
 *      start URL has no query string, still lands in the right event.
 *   3. nothing — main.ts shows the landing page (create an event / enter a code).
 *
 * Everything degrades rather than throws: the full room is cached in
 * localStorage, so a phone that opens the app offline still renders.
 */

import type { ChatStats } from "./lib/quiz";

export interface Participant {
  name: string;
  /** false for children / absent relatives: an answer option, never a player. */
  playing: boolean;
}

export interface RoomConfig {
  participants: Participant[];
  activities: Record<string, boolean>;
  bingo: { side: number; minProposals: number };
}

export interface PublicRoom {
  id: string;
  name: string;
  lang: "he" | "en";
  createdAt: number;
}

export interface Room extends PublicRoom {
  config: RoomConfig;
  quiz: ChatStats | null;
}

const ID_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6,16}$/;
const K_LAST_ROOM = "wq-room";
const API = "./api/rooms";

const DEFAULT_CONFIG: RoomConfig = {
  participants: [],
  activities: { bingo: true, truths: true, quiz: true, superlatives: true, wall: true, awards: true },
  bingo: { side: 4, minProposals: 2 },
};

let id = "";
let pub: PublicRoom | null = null;
let full: Room | null = null;

// --- storage helpers ---------------------------------------------------------

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the session still works, it just won't persist */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Per-room keys, so two events opened on one phone never share credentials or caches. */
export function roomKey(base: string): string {
  return `${base}:${id}`;
}

// --- which room ----------------------------------------------------------------

/**
 * Decide which room this page is for. Called once, first thing in boot.
 * Returns "" if nothing resolves — the caller shows the "no event" screen.
 */
export function resolveRoomId(): string {
  const fromUrl = new URLSearchParams(location.search).get("r")?.trim().toUpperCase() ?? "";
  const candidate = ID_RE.test(fromUrl) ? fromUrl : read(K_LAST_ROOM);
  if (!ID_RE.test(candidate)) return "";
  id = candidate;
  write(K_LAST_ROOM, id);

  // Put the id back into the URL if it came from storage, so that "share this
  // page" from the browser produces a link that lands in the right event.
  if (fromUrl !== id) {
    try {
      const url = new URL(location.href);
      url.searchParams.set("r", id);
      history.replaceState(null, "", url);
    } catch {
      /* cosmetic */
    }
  }
  return id;
}

export function roomId(): string {
  return id;
}

/** Is this a plausible room id (as typed by a person)? Normalised form or "". */
export function normaliseRoomId(raw: string): string {
  const v = raw.trim().toUpperCase();
  if (ID_RE.test(v)) return v;
  // A whole link pasted in: pull the ?r= out of it.
  try {
    const fromUrl = new URL(raw.trim()).searchParams.get("r")?.trim().toUpperCase() ?? "";
    return ID_RE.test(fromUrl) ? fromUrl : "";
  } catch {
    return "";
  }
}

/** The link to hand to guests, for a given room id. */
export function shareUrlFor(roomIdValue: string): string {
  const url = new URL(location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set("r", roomIdValue);
  return url.toString();
}

/** The link to hand to guests. */
export function shareUrl(): string {
  const url = new URL(location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set("r", id);
  return url.toString();
}

// --- credentials -----------------------------------------------------------

/** The event password, exactly as typed. Sent percent-encoded in `x-party`. */
export function password(): string {
  return read(roomKey("wq-pass"));
}

export function hasPassword(): boolean {
  return password().length > 0;
}

function rememberPassword(pass: string): void {
  write(roomKey("wq-pass"), pass);
}

export function forgetPassword(): void {
  remove(roomKey("wq-pass"));
}

/**
 * HTTP header values must be Latin-1 and passwords are usually Hebrew — sending
 * one raw makes fetch() throw. The Function decodes the same way.
 */
export function partyHeader(): string {
  return encodeURIComponent(password());
}

/** The host code, if this phone has unlocked #/host for this room. */
export function hostCode(): string {
  return read(roomKey("wq-host"));
}

// --- the room itself ---------------------------------------------------------

export function getRoom(): Room {
  return full ?? { id, name: pub?.name ?? "", lang: pub?.lang ?? "he", createdAt: pub?.createdAt ?? 0, config: DEFAULT_CONFIG, quiz: null };
}

export function publicInfo(): PublicRoom | null {
  return pub ?? full;
}

export function isLoaded(): boolean {
  return full !== null;
}

export function bingoSide(): number {
  return getRoom().config.bingo?.side ?? 4;
}

export function bingoCells(): number {
  return bingoSide() * bingoSide();
}

export function minProposals(): number {
  return getRoom().config.bingo?.minProposals ?? 2;
}

export function activityOn(key: string): boolean {
  return getRoom().config.activities?.[key] !== false;
}

function acceptFull(data: unknown): Room | null {
  const r = (data as { room?: Partial<Room> })?.room;
  if (!r || typeof r !== "object" || r.id !== id) return null;
  full = {
    id,
    name: String(r.name ?? ""),
    lang: r.lang === "en" ? "en" : "he",
    createdAt: Number(r.createdAt ?? 0),
    config: { ...DEFAULT_CONFIG, ...(r.config ?? {}) },
    quiz: (r.quiz as ChatStats | null) ?? null,
  };
  pub = full;
  write(roomKey("wq-room-cache"), JSON.stringify(full));
  return full;
}

function loadCachedFull(): Room | null {
  try {
    const raw = read(roomKey("wq-room-cache"));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Room;
    if (parsed?.id !== id) return null;
    full = parsed;
    pub = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export type LoadResult = "ok" | "not-found" | "forbidden" | "offline";

/**
 * Fetch what anyone may know about the room: its name and language.
 * Enough to render the gate. Falls back to the cached full room when offline.
 */
export async function loadPublic(): Promise<LoadResult> {
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(id)}`);
    if (res.status === 404) return "not-found";
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { room?: PublicRoom };
    if (data.room?.id === id) pub = data.room;
    return "ok";
  } catch {
    return loadCachedFull() ? "ok" : "offline";
  }
}

/**
 * Prove the password and receive the full config + quiz. On success the
 * password is remembered on this phone for every later request.
 *
 * "offline" with a cached room is still usable: the caller proceeds with the
 * cache and sync will catch up when the network does.
 */
export async function unlock(pass: string): Promise<LoadResult> {
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(id)}`, {
      headers: { "x-party": encodeURIComponent(pass) },
    });
    if (res.status === 403) return "forbidden";
    if (res.status === 404) return "not-found";
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!acceptFull(data)) return "offline";
    rememberPassword(pass);
    return "ok";
  } catch {
    return loadCachedFull() ? "ok" : "offline";
  }
}

/** Boot path for a phone that already knows the password. */
export async function loadFull(): Promise<LoadResult> {
  const result = await unlock(password());
  if (result === "forbidden") forgetPassword();
  return result;
}

/**
 * Check a host code against the server. The real gate is on `phase` events;
 * this exists so a wrong code is refused at unlock time rather than jamming the
 * outbox with rejected writes later.
 */
export async function unlockHost(code: string): Promise<"ok" | "wrong" | "offline"> {
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(id)}&host=${encodeURIComponent(code)}`, {
      headers: { "x-party": partyHeader() },
    });
    if (res.status === 403) return "wrong";
    if (!res.ok) throw new Error(String(res.status));
    write(roomKey("wq-host"), code);
    return "ok";
  } catch {
    return "offline";
  }
}

export function forgetHost(): void {
  remove(roomKey("wq-host"));
}

/** Stop opening this room by default; the bare URL goes to the landing page again. */
export function forgetLastRoom(): void {
  remove(K_LAST_ROOM);
}

// --- creating and editing events ----------------------------------------------

export interface CreateRequest {
  name: string;
  lang: "he" | "en";
  password: string;
  config: Partial<RoomConfig>;
  /** Cloudflare Turnstile token from the wizard's widget. */
  turnstile: string;
}

export type CreateResult = { ok: true; id: string; hostCode: string; room: Room } | { ok: false; error: string };

/** POST /api/rooms. The host code comes back exactly once, here. */
export async function createRoom(req: CreateRequest): Promise<CreateResult> {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; hostCode?: string; room?: Room; error?: string };
    if (!res.ok || !data.id || !data.hostCode || !data.room) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, id: data.id, hostCode: data.hostCode, room: data.room };
  } catch {
    return { ok: false, error: "network" };
  }
}

export interface RoomPatch {
  name?: string;
  config?: RoomConfig;
  quiz?: ChatStats | null;
}

/** PUT /api/rooms with this phone's host code. Updates the held room on success. */
export async function updateRoom(patch: RoomPatch): Promise<{ ok: true; room: Room } | { ok: false; error: string }> {
  try {
    const res = await fetch(API, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, hostCode: hostCode(), ...patch }),
    });
    const data = (await res.json().catch(() => ({}))) as { room?: Room; error?: string };
    if (!res.ok || !data.room) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    const accepted = acceptFull(data);
    if (!accepted) return { ok: false, error: "bad response" };
    return { ok: true, room: accepted };
  } catch {
    return { ok: false, error: "network" };
  }
}

/**
 * Make a just-created event the current one: id, URL, password, host code and
 * the full row, so the creator walks straight in as host without re-typing
 * anything. Nothing here touches the network.
 */
export function switchRoom(newId: string, creds: { password: string; hostCode: string; room: Room }): void {
  id = newId;
  write(K_LAST_ROOM, id);
  try {
    const url = new URL(location.href);
    url.searchParams.set("r", id);
    history.replaceState(null, "", url);
  } catch {
    /* cosmetic */
  }
  rememberPassword(creds.password);
  write(roomKey("wq-host"), creds.hostCode);
  acceptFull({ room: creds.room });
}

/** Everything this phone remembers about a room, for the landing page's "recent" list. */
export function lastRoomId(): string {
  const v = read(K_LAST_ROOM);
  return ID_RE.test(v) ? v : "";
}
