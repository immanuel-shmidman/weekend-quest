/**
 * Shared helpers for the Pages Functions.
 *
 * Underscore-prefixed so Pages does not route it — this is a module, not an
 * endpoint.
 */

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Hash a secret for storage.
 *
 * v1 kept the party password as a build-time constant that shipped inside the
 * client bundle. That was fine for one party where the password was a curtain
 * over a Hebrew word everyone already knew. Holding *other people's* passwords
 * in plaintext on my account is a different proposition, so they are hashed.
 *
 * Salted with the room id, which is unique and unguessable, so two events
 * choosing the same password do not produce the same hash. This is not
 * password-database-grade — no KDF, no work factor — because the threat is a
 * curious guest, not an offline attacker with the table.
 */
export async function hashSecret(roomId, secret) {
  const data = new TextEncoder().encode(`${roomId}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish compare. Both sides are fixed-length hex here. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Room ids people have to read off a screen and sometimes type.
 *
 * Alphabet excludes 0/O/1/I/L and vowels: no ambiguous glyphs, and no accidental
 * words in any language. 10 chars from 26 symbols is ~47 bits — not guessable
 * by brute force against a rate-limited endpoint.
 */
const ID_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";

export function newRoomId(len = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export const ROOM_ID_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6,16}$/;

/** Fetch a room, or null. Callers decide what a missing room means. */
export async function getRoom(env, roomId) {
  if (!ROOM_ID_RE.test(roomId)) return null;
  const row = await env.DB.prepare(
    "SELECT id, name, lang, pass_hash, host_hash, config, quiz, created_at, last_seen FROM rooms WHERE id = ?1"
  )
    .bind(roomId)
    .first();
  return row ?? null;
}

/** What the client is allowed to see before it has proved it knows the password. */
export function publicRoom(row) {
  return {
    id: row.id,
    name: row.name,
    lang: row.lang,
    createdAt: row.created_at,
  };
}

/** Everything the app needs once the password checks out. Never the hashes. */
export function fullRoom(row) {
  return {
    id: row.id,
    name: row.name,
    lang: row.lang,
    config: safeParse(row.config, {}),
    quiz: safeParse(row.quiz, null),
    createdAt: row.created_at,
  };
}

export function safeParse(text, fallback) {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * Rooms are dropped 30 days after their last write.
 *
 * This is a favour, not a service: nobody is promised their data is kept, and
 * an unbounded table on someone else's account is rude. Called opportunistically
 * on room creation so there is no cron to forget about.
 */
export const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeExpired(env) {
  const cutoff = Date.now() - ROOM_TTL_MS;
  try {
    const stale = await env.DB.prepare("SELECT id FROM rooms WHERE last_seen < ?1 LIMIT 20")
      .bind(cutoff)
      .all();
    const ids = (stale.results ?? []).map((r) => r.id);
    if (!ids.length) return 0;
    const marks = ids.map(() => "?").join(",");
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM events WHERE room IN (${marks})`).bind(...ids),
      env.DB.prepare(`DELETE FROM rooms WHERE id IN (${marks})`).bind(...ids),
    ]);
    return ids.length;
  } catch {
    return 0; // never let housekeeping break a request
  }
}

/**
 * Cloudflare Turnstile: prove a person is behind a request.
 *
 * Only two endpoints ask — creating an event and sending feedback — because
 * they are the two things a script could do damage with. Guests joining,
 * voting or marking squares never see a widget.
 *
 * Rules, per Cloudflare's guidance: always call siteverify from the server,
 * require success, require the action the widget was rendered with (a token
 * for one form cannot be replayed on another), and require an approved
 * hostname. Tokens are single-use and live five minutes.
 *
 * With no TURNSTILE_SECRET configured (a local dev setup without a widget)
 * the check is skipped — production always has the secret.
 */
const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_HOSTS = ["weekend-quest.pages.dev", "localhost", "127.0.0.1"];

export async function verifyTurnstile(env, request, token, action) {
  if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, codes: ["missing-input-response"] };
  try {
    const body = new FormData();
    body.set("secret", env.TURNSTILE_SECRET);
    body.set("response", token);
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) body.set("remoteip", ip);
    const res = await fetch(TURNSTILE_VERIFY, { method: "POST", body });
    const data = await res.json();
    if (!data.success) return { ok: false, codes: data["error-codes"] ?? ["unknown"] };
    if (data.action && data.action !== action) return { ok: false, codes: ["action-mismatch"] };
    // Approved hostnames: the built-in list plus TURNSTILE_HOSTS (comma
    // separated) from wrangler.toml, for a custom domain without a code change.
    const extra = String(env.TURNSTILE_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    const hosts = [...TURNSTILE_HOSTS, ...extra];
    const host = String(data.hostname ?? "");
    const hostOk = hosts.some((h) => host === h || host.endsWith("." + h));
    if (host && !hostOk) return { ok: false, codes: ["hostname-mismatch"], hostname: host };
    return { ok: true };
  } catch {
    // Cloudflare unreachable from Cloudflare is not a thing that should
    // happen; if it does, failing closed is the safer default here.
    return { ok: false, codes: ["verify-unavailable"] };
  }
}

export async function touchRoom(env, roomId) {
  try {
    await env.DB.prepare("UPDATE rooms SET last_seen = ?1 WHERE id = ?2")
      .bind(Date.now(), roomId)
      .run();
  } catch {
    /* not worth failing a write over */
  }
}
