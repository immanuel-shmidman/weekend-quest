/**
 * Cloudflare Pages Function: /api/events — the entire game backend.
 *
 * One append-only log serves every activity. Bingo marks, truth submissions,
 * guesses, quiz answers and phase changes are all just rows here; every
 * interpretation happens on the client. That is why this file is ~200 lines
 * instead of six separate endpoints.
 *
 * v2: auth is per-room. v1 compared against env.PARTY_PASSWORD — a single
 * build-time constant — because there was one event. Now the room is looked up
 * and the supplied password hashed against what that event stored.
 *
 * Plain JS on purpose: tsconfig only covers src/, and Pages picks this up as-is.
 *
 *   GET  /api/events?room=<id>&since=<n>
 *        -> { events: [...], cursor, more }
 *   POST /api/events   { room, since, events: [{kind, player, uid, payload}] }
 *        -> { ok, accepted: [uid...], events: [...tail...], cursor }
 */

import { json, hashSecret, safeEqual, getRoom, touchRoom, ROOM_ID_RE } from "../_lib.js";

const KINDS = new Set([
  "join", // {name}
  "phase", // {activity, phase, poolIds?}   host only
  "rename", // {target, name}                host only — fix a guest's typo'd nickname
  "q.answer", // {qid, value, points}
  "t.submit", // {statements:[s,s,s], lie}
  "t.guess", // {target, index}
  "b.propose", // {text}
  "b.mark", // {square, on}
  "b.bingo", // {line:[...]}
  "s.ask", // {text}                     superlative question
  "s.vote", // {ask, target}
  "w.post", // {text, said}              quote wall
  "w.react", // {post, emoji}
]);

const PLAYER_RE = /^[A-Za-z0-9-]{6,64}$/;
const UID_RE = /^[A-Za-z0-9-]{6,64}$/;
const PAGE = 500;

/** Stops one event filling the shared database. Generous for a real party. */
const MAX_EVENTS_PER_ROOM = 20000;

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "DB binding missing" }, 500);

  const url = new URL(request.url);
  const roomId = url.searchParams.get("room") ?? "";
  if (!ROOM_ID_RE.test(roomId)) return json({ error: "bad room" }, 400);

  const auth = await authorise(request, env, roomId);
  if (auth.error) return auth.error;

  const since = clampInt(url.searchParams.get("since"), 0, 0, 1e12);
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, kind, player, payload, ts FROM events WHERE room = ?1 AND id > ?2 ORDER BY id LIMIT ?3"
    )
      .bind(roomId, since, PAGE)
      .all();
    return json(shape(results, since));
  } catch {
    return json({ error: "read failed" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "DB binding missing" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const roomId = String(body.room ?? "");
  if (!ROOM_ID_RE.test(roomId)) return json({ error: "bad room" }, 400);

  const auth = await authorise(request, env, roomId);
  if (auth.error) return auth.error;
  const room = auth.room;

  const incoming = Array.isArray(body.events) ? body.events : [];
  if (incoming.length < 1 || incoming.length > 20) {
    return json({ error: "bad batch size" }, 400);
  }

  const ts = Date.now(); // never trust a phone clock
  const rows = [];
  for (const e of incoming) {
    const kind = String(e.kind ?? "");
    const player = String(e.player ?? "");
    const uid = String(e.uid ?? "");
    if (!KINDS.has(kind)) return json({ error: "bad kind: " + kind }, 400);
    if (!PLAYER_RE.test(player)) return json({ error: "bad player" }, 400);
    if (!UID_RE.test(uid)) return json({ error: "bad uid" }, 400);

    let payload = e.payload;
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ error: "bad payload" }, 400);
    }

    // Phase changes are the one privileged write. Checking this only on the
    // client would let anyone with devtools shove an activity into its next
    // phase while half the group is still typing.
    if (kind === "phase" || kind === "rename") {
      const supplied = await hashSecret(room.id, String(payload.hostCode ?? ""));
      if (!safeEqual(supplied, room.host_hash)) return json({ error: "not host" }, 403);
      payload = { ...payload };
      delete payload.hostCode; // never store it
    }

    const text = JSON.stringify(payload);
    if (text.length > 4000) return json({ error: "payload too large" }, 400);
    rows.push({ kind, player, uid, text });
  }

  const since = clampInt(body.since, 0, 0, 1e12);

  try {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE room = ?1")
      .bind(roomId)
      .first();
    if ((count?.n ?? 0) + rows.length > MAX_EVENTS_PER_ROOM) {
      return json({ error: "this event has reached its limit" }, 429);
    }

    const insert = env.DB.prepare(
      "INSERT OR IGNORE INTO events (room, kind, player, uid, payload, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    );
    await env.DB.batch(rows.map((r) => insert.bind(roomId, r.kind, r.player, r.uid, r.text, ts)));

    // Hand back everything the caller is missing, so a submit updates their
    // world without waiting for the next poll.
    const { results } = await env.DB.prepare(
      "SELECT id, kind, player, payload, ts FROM events WHERE room = ?1 AND id > ?2 ORDER BY id LIMIT ?3"
    )
      .bind(roomId, since, PAGE)
      .all();

    // Keeps the room alive against the 30-day expiry sweep.
    await touchRoom(env, roomId);

    return json({ ok: true, accepted: rows.map((r) => r.uid), ...shape(results, since) });
  } catch {
    return json({ error: "write failed" }, 500);
  }
}

// --- helpers ---------------------------------------------------------------

/**
 * Look the room up and check the password.
 *
 * Percent-encoded in the header because header values must be Latin-1 and these
 * passwords are usually Hebrew — sending one raw makes fetch() throw in the
 * browser. src/sync.ts does the matching encode.
 */
async function authorise(request, env, roomId) {
  const room = await getRoom(env, roomId);
  if (!room) return { error: json({ error: "no such event" }, 404) };

  let supplied = request.headers.get("x-party") ?? "";
  try {
    supplied = decodeURIComponent(supplied);
  } catch {
    return { error: json({ error: "forbidden" }, 403) };
  }

  const hash = await hashSecret(room.id, supplied);
  if (!safeEqual(hash, room.pass_hash)) return { error: json({ error: "forbidden" }, 403) };
  return { room };
}

function shape(results, since) {
  const rows = results ?? [];
  const events = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    player: r.player,
    payload: safeParse(r.payload),
    ts: r.ts,
  }));
  const cursor = events.length ? events[events.length - 1].id : since;
  return { events, cursor, more: rows.length === PAGE };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function clampInt(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
