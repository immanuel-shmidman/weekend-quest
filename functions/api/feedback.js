/**
 * Cloudflare Pages Function: /api/feedback — bug reports and ideas from guests.
 *
 *   POST /api/feedback  { room, text, name?, email?, lang?, turnstile }  + x-party header
 *        -> { ok: true, emailed: bool }
 *
 * Verifies the Turnstile token, stores a copy in the `feedback` table, then
 * forwards to the Formspree endpoint in wrangler.toml (FEEDBACK_ENDPOINT),
 * which emails the developer. Not shown to hosts or guests, so there is no
 * GET. Anyone who can see the event can send feedback; the caps stop it
 * becoming a free text store.
 */

import { json, hashSecret, safeEqual, getRoom, verifyTurnstile, ROOM_ID_RE } from "../_lib.js";

const MAX_TEXT = 2000;
const MAX_PER_ROOM = 300;

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
  const room = await getRoom(env, roomId);
  if (!room) return json({ error: "no such event" }, 404);

  let supplied = request.headers.get("x-party") ?? "";
  try {
    supplied = decodeURIComponent(supplied);
  } catch {
    return json({ error: "forbidden" }, 403);
  }
  if (!safeEqual(await hashSecret(room.id, supplied), room.pass_hash)) return json({ error: "forbidden" }, 403);

  const text = String(body.text ?? "").trim().slice(0, MAX_TEXT);
  if (!text) return json({ error: "empty" }, 400);

  const human = await verifyTurnstile(env, request, body.turnstile, "feedback");
  if (!human.ok) return json({ error: "human check failed", codes: human.codes }, 403);
  const name = String(body.name ?? "").trim().slice(0, 24);
  // Optional, so the developer can reply. Loosely validated; it is only ever
  // shown to a human.
  const emailRaw = String(body.email ?? "").trim().slice(0, 120);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : "";
  const lang = body.lang === "en" ? "en" : "he";
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 200);

  try {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE room = ?1").bind(roomId).first();
    if ((count?.n ?? 0) >= MAX_PER_ROOM) return json({ error: "enough feedback for one event, thank you" }, 429);
    await env.DB.prepare(
      "INSERT INTO feedback (room, room_name, name, email, lang, text, ua, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    )
      .bind(roomId, room.name, name, email, lang, text, ua, Date.now())
      .run();
  } catch {
    return json({ error: "write failed" }, 500);
  }

  // The email. Best-effort: the D1 row is the record, the mail is the alert.
  let emailed = false;
  if (env.FEEDBACK_ENDPOINT) {
    try {
      const res = await fetch(env.FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          _subject: `Weekend Quest feedback — ${room.name}`,
          // Formspree sets the email's Reply-To from this field.
          _replyto: email || undefined,
          email: email || undefined,
          message: text,
          name,
          event: `${room.name} (${roomId})`,
          lang,
          userAgent: ua,
        }),
      });
      emailed = res.ok;
    } catch {
      emailed = false;
    }
  }
  return json({ ok: true, emailed });
}
