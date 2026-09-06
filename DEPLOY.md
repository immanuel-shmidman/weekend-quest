# Deploying

Already done once — the site is live at **https://weekend-quest.pages.dev**.
This is the runbook for redeploying after a change. Event ids, passwords and
host codes belong to the people running each event and are never written here.

## v2 cut-over

Done on 2026-09-06: schema applied, the original weekend moved into a `rooms`
row, site deployed. The one-off migration script lives in `tools/private/`.

## Verify v2 in a minute

```bash
curl -s "https://weekend-quest.pages.dev/api/rooms?id=<an event id>"   # {"room":{...name...}}
curl -s -X POST -H "content-type: application/json" \n  -d '{"name":"smoke","lang":"en","password":"pw","config":{}}' \n  "https://weekend-quest.pages.dev/api/rooms"                                # 403 human check failed — Turnstile is on
```

Then open `https://weekend-quest.pages.dev/#/new` on a phone and walk the
wizard once. A smoke-test event expires with everything else 30 days after its
last write; nothing to clean up.

## Feedback → your email

Guests send bug reports and ideas from the home screen (`#/feedback`). The
Function verifies the Turnstile token, stores the row in D1, then forwards it
to the Formspree form in `wrangler.toml` (`FEEDBACK_ENDPOINT`), which emails
you the message, the guest's nickname, the event name and id, language and
phone user agent. Formspree asks you to confirm the form by email once.

Guests may leave an email; it becomes the Reply-To of the Formspree mail.

The D1 copy is the record; nothing in the app shows it:

```bash
npx wrangler d1 execute weekend-quest --remote --json --command "SELECT datetime(ts/1000,'unixepoch') AS at, room_name, name, email, lang, text FROM feedback ORDER BY id DESC LIMIT 50"
```

## Human check (Turnstile)

Creating an event and sending feedback require a Cloudflare Turnstile token;
guests joining and playing never see a widget. The site key is public and in
`src/config.ts`; the secret is a Pages secret:

```bash
npx wrangler pages secret put TURNSTILE_SECRET --project-name weekend-quest
```

and `TURNSTILE_SECRET=...` in `.dev.vars` for `wrangler pages dev`. Without a
secret the server skips the check, which is what you want on a laptop without
a widget and never in production. The widget's allowed hostnames (Cloudflare
dashboard → Turnstile) must include `weekend-quest.pages.dev`, and
`localhost` if you test locally; the server additionally checks the hostname
Cloudflare reports against the same list (`TURNSTILE_HOSTS` in `_lib.js`).

## Abuse knobs

If Turnstile ever is not enough: set `CREATE_CODE` in `wrangler.toml`
`[vars]`, flip `REQUIRE_CREATE_CODE` to `true` in `functions/api/rooms.js`,
redeploy. `MAX_ROOMS_PER_DAY` (40) and `MAX_EVENTS_PER_ROOM` (20,000) are the
other two dials. The free plan has no card attached, so the worst case is a
bad day, not a bill.

## The whole loop

```bash
npm run build && npx wrangler pages deploy dist --project-name weekend-quest --branch main --commit-dirty=true
```

`wrangler pages deploy` uploads `dist/` **and** `functions/`, and attaches the
D1 binding and the vars from `wrangler.toml` automatically. There is nothing to
click in the dashboard.

## What already exists

| Thing | Value |
|---|---|
| Pages project | `weekend-quest` |
| URL | https://weekend-quest.pages.dev |
| D1 database | `weekend-quest`, id `b01142c1-548f-4a9c-855f-0a1c39f5f75a` (in `wrangler.toml`) |
| Binding | `DB` |
| Vars | none required. Optional `CREATE_CODE` if event creation is ever locked down |
| Tables | `events` (the log) and `rooms` (per-event config, hashed secrets) |

The schema is applied. You only need this again if you recreate the database:

```bash
npx wrangler d1 execute weekend-quest --remote --file=./schema.sql
```

## Verify a deploy in 30 seconds

```bash
curl -s "https://weekend-quest.pages.dev/api/rooms?id=<an event id>"
curl -s "https://weekend-quest.pages.dev/api/events?room=<an event id>&since=0"
```

The first returns the event's name and language; the second
`{"error":"forbidden"}` — the Function is live and the per-room password check
is working. With the header it returns the event log:

```bash
curl -s -H "x-party: <percent-encoded password>" "https://weekend-quest.pages.dev/api/events?room=<an event id>&since=0"
```

(The header is percent-encoded because HTTP headers must be Latin-1 and
passwords are usually Hebrew. `src/sync.ts` does the same encoding.)

## The one check that actually matters

D1 bills **rows scanned**, not rows returned. Without the `events_room_id`
index, every poll from all 14 phones becomes a full table scan — roughly 53M
rows/day against a 5M free-tier limit, and the app starts erroring on Saturday
afternoon with no obvious symptom.

```bash
npx wrangler d1 execute weekend-quest --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events';"
```

Both `events_uid` and `events_room_id` must be listed. They are, as of the
initial deploy — this is here for after any database change.

## If something goes wrong mid-weekend

**Wrong data you cannot fix from `#/host`.** Create a fresh event
(`POST /api/rooms`, or the wizard once it exists) and share the new link. Every
read filters on the room id, so that is a clean slate with the old data still
in the table for laughs later.

**Requests trending high.** Raise the numbers in `POLL_MS` in `src/config.ts`
and redeploy. Check the Cloudflare dashboard Saturday morning; the design
budgets ~53k requests/day against a 100k/day free tier.

**Someone advanced a phase by mistake.** Advance it back from `#/host`. Phases
are last-write-wins events; nothing is destroyed.

## Regenerating a quiz from the CLI

Hosts build quizzes in the browser (settings → quiz). The CLI still works for
the developer:

```bash
npm run roster -- --in "<path to WhatsApp export .zip>"
npm run stats  -- --in "<path to WhatsApp export .zip>"      # writes tools/private/chat-stats.json
```

and the result can be PUT into an event with its host code (see `PUT /api/rooms`
in `functions/api/rooms.js`). The raw export is never committed and never
deployed — the analyzer refuses to run if it sits inside the repo.

## After the weekend

Delete the Pages project and the D1 database in the Cloudflare dashboard, or
leave them — both sit inside the free tier at this scale.
