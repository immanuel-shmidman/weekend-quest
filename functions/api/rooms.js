/**
 * Cloudflare Pages Function: /api/rooms — event setup.
 *
 *   GET  /api/rooms?id=<roomId>                        -> public info (name, language)
 *   GET  /api/rooms?id=<roomId>   + x-party header     -> full config + quiz
 *   GET  /api/rooms?id=<roomId>&host=<code> + x-party  -> same, after checking the host code
 *   POST /api/rooms                           -> create an event
 *   PUT  /api/rooms                           -> update config/quiz (host only)
 *
 * v1 had exactly one event and kept its password, host code, room id, bingo
 * size and quiz as compile-time constants. This is where all of that now lives,
 * so a family can set up their own without a developer.
 */

import {
  json,
  hashSecret,
  safeEqual,
  newRoomId,
  getRoom,
  publicRoom,
  fullRoom,
  purgeExpired,
  verifyTurnstile,
  ROOM_ID_RE,
} from "../_lib.js";

/**
 * Anyone with the URL can create an event — that is what makes this
 * self-serve. A Cloudflare Turnstile check (verifyTurnstile) keeps scripts
 * out; the daily cap below bounds the damage if one gets through, and the
 * free plan has no card attached, so abuse degrades the service for a day
 * rather than producing a bill.
 *
 * REQUIRE_CREATE_CODE is a second lock, off by default: flip it (and set
 * CREATE_CODE in wrangler.toml) to make creation invite-only.
 */
const REQUIRE_CREATE_CODE = false;

/** Crude flood stop. One person setting up a trip creates one event. */
const MAX_ROOMS_PER_DAY = 40;

/** Per-event caps, so one event cannot balloon the shared database. */
export const CAPS = {
  participants: 60,
  nameLen: 24,
  eventNameLen: 60,
  passLen: 40,
  configBytes: 24_000,
  quizBytes: 400_000,
};

const LANGS = new Set(["he", "en"]);

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "DB binding missing" }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!ROOM_ID_RE.test(id)) return json({ error: "bad room id" }, 400);

  const row = await getRoom(env, id);
  if (!row) return json({ error: "no such event" }, 404);

  // Without the password you learn only that the event exists and what it is
  // called — enough to render the join screen, nothing more.
  //
  // The password travels in the same percent-encoded x-party header events.js
  // uses, rather than the query string, so it stays out of access logs.
  const header = request.headers.get("x-party");
  if (header === null) return json({ room: publicRoom(row) });

  let pass;
  try {
    pass = decodeURIComponent(header);
  } catch {
    return json({ error: "wrong password" }, 403);
  }
  const supplied = await hashSecret(row.id, pass);
  if (!safeEqual(supplied, row.pass_hash)) return json({ error: "wrong password" }, 403);

  // Optional host-code check, so #/host can refuse a wrong code up front
  // instead of letting rejected phase events pile up in the outbox.
  const host = url.searchParams.get("host");
  if (host !== null) {
    const hostHash = await hashSecret(row.id, host);
    if (!safeEqual(hostHash, row.host_hash)) return json({ error: "not host" }, 403);
    return json({ room: fullRoom(row), host: true });
  }
  return json({ room: fullRoom(row) });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "DB binding missing" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  if (REQUIRE_CREATE_CODE) {
    if (String(body.createCode ?? "") !== String(env.CREATE_CODE ?? "")) {
      return json({ error: "create code required" }, 403);
    }
  }

  const human = await verifyTurnstile(env, request, body.turnstile, "create-event");
  if (!human.ok) return json({ error: "human check failed", codes: human.codes }, 403);

  const name = String(body.name ?? "").trim().slice(0, CAPS.eventNameLen);
  const lang = LANGS.has(body.lang) ? body.lang : "he";
  const password = String(body.password ?? "").trim();
  if (!name) return json({ error: "event needs a name" }, 400);
  if (password.length < 2 || password.length > CAPS.passLen) {
    return json({ error: "password must be 2-40 characters" }, 400);
  }

  const config = normaliseConfig(body.config);
  const configText = JSON.stringify(config);
  if (configText.length > CAPS.configBytes) return json({ error: "config too large" }, 400);

  // Opportunistic housekeeping: no cron to forget about, and it runs on the
  // one request per event that is never latency-sensitive.
  await purgeExpired(env);

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM rooms WHERE created_at > ?1")
    .bind(since)
    .first();
  if ((recent?.n ?? 0) >= MAX_ROOMS_PER_DAY) {
    return json({ error: "too many events created today, try tomorrow" }, 429);
  }

  // The host code is generated rather than chosen: people pick weak ones, and
  // this is the credential that can advance phases for everybody.
  const id = newRoomId();
  const hostCode = newRoomId(6);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO rooms (id, name, lang, pass_hash, host_hash, config, quiz, created_at, last_seen)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?7)`
  )
    .bind(id, name, lang, await hashSecret(id, password), await hashSecret(id, hostCode), configText, now)
    .run();

  // hostCode is returned exactly once, here. It is not recoverable: there are
  // no accounts and no email, so recovery would mean a support channel this
  // does not have. Losing it means making a new event.
  return json({ id, hostCode, room: fullRoom({ id, name, lang, config: configText, quiz: null, created_at: now }) });
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return json({ error: "DB binding missing" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const id = String(body.id ?? "");
  const row = await getRoom(env, id);
  if (!row) return json({ error: "no such event" }, 404);

  const supplied = await hashSecret(row.id, String(body.hostCode ?? ""));
  if (!safeEqual(supplied, row.host_hash)) return json({ error: "not host" }, 403);

  const sets = [];
  const binds = [];
  if (body.config !== undefined) {
    const text = JSON.stringify(normaliseConfig(body.config));
    if (text.length > CAPS.configBytes) return json({ error: "config too large" }, 400);
    sets.push(`config = ?${sets.length + 1}`);
    binds.push(text);
  }
  if (body.quiz !== undefined) {
    const text = body.quiz === null ? null : JSON.stringify(body.quiz);
    if (text && text.length > CAPS.quizBytes) return json({ error: "quiz too large" }, 400);
    sets.push(`quiz = ?${sets.length + 1}`);
    binds.push(text);
  }
  if (body.name !== undefined) {
    sets.push(`name = ?${sets.length + 1}`);
    binds.push(String(body.name).trim().slice(0, CAPS.eventNameLen));
  }
  if (!sets.length) return json({ error: "nothing to update" }, 400);

  sets.push(`last_seen = ?${sets.length + 1}`);
  binds.push(Date.now());
  binds.push(id);

  await env.DB.prepare(`UPDATE rooms SET ${sets.join(", ")} WHERE id = ?${binds.length}`)
    .bind(...binds)
    .run();

  const updated = await getRoom(env, id);
  return json({ room: fullRoom(updated) });
}

/**
 * Clamp whatever the wizard sends into something the client can trust.
 *
 * The client renders straight from this, so a malformed config would break the
 * app for every guest rather than just its author.
 */
function normaliseConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };

  const seen = new Set();
  const participants = (Array.isArray(c.participants) ? c.participants : [])
    .slice(0, CAPS.participants)
    .map((p) => ({
      name: String(p?.name ?? "").trim().slice(0, CAPS.nameLen),
      // Non-playing people (children, absent relatives) are answer options in
      // "who is most likely" and nothing else: no board, no score, no sign-in.
      playing: p?.playing !== false,
    }))
    .filter((p) => {
      if (!p.name) return false;
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    participants,
    activities: {
      bingo: c.activities?.bingo !== false,
      truths: c.activities?.truths !== false,
      quiz: c.activities?.quiz === true, // off unless a quiz was actually built
      superlatives: c.activities?.superlatives !== false,
      wall: c.activities?.wall !== false,
      awards: c.activities?.awards !== false,
    },
    bingo: {
      // 3x3 is nine squares and a quick win; 5x5 is a whole weekend.
      side: clampInt(c.bingo?.side, 3, 5, 4),
      // A minimum, not a quota — some people have ten ideas and some have one.
      minProposals: clampInt(c.bingo?.minProposals, 1, 10, 2),
    },
  };
}
