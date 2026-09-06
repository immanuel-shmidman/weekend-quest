# נופש מופלאים — working notes

A phone-first, self-serve party app: anyone opens the landing page, sets up an
event in a six-step wizard, and shares one link. Six activities, all playable at
once or one at a time. Hebrew or English, RTL or LTR, switchable per phone.

Live: **https://weekend-quest.pages.dev** (landing). The original weekend is one
event among others now; its id, password and host code are not in this repo.

This file is the living plan. Read it first each session. v2 (`PLAN-v2.md`) is
built; the status table at the bottom says what is deployed.

---

## Guiding principles

- **The event log is the whole architecture.** Every activity is a stream of
  events in one D1 table; every screen is a pure function of the fold. There is
  no per-activity backend and no derived state to keep in sync. Resist adding
  either.
- **Phone-first, and it runs all weekend.** People will open this dozens of
  times on bad wifi with locked phones. Identity persists, writes are
  optimistic, and everything degrades rather than throwing.
- **An unfinished activity must not look broken.** `built: false` in
  `ACTIVITIES` removes it from the home screen entirely.
- **The raw WhatsApp export never leaves the phone.** Non-negotiable. In v2 the
  analysis runs in the browser (`src/lib/chat`, loaded as its own chunk only on
  the quiz-setup screen) and only the derived statistics are uploaded to the
  event's `quiz` column — counts, names and dates. The single exception is
  opt-in: the host's "excerpts" switch adds the opening words of the longest and
  the funniest message. The v1 weekend's generated file lives only in
  `tools/private/` (gitignored) and in the event's row; nothing with names or
  message text is committed. If you add another field carrying message
  text, you are changing a property this repo otherwise guarantees.
- **Strings live next to their screen.** Every module declares
  `const S = strings({ he: {...}, en: {...} })` (`src/i18n.ts`) and the same
  keys must exist in both tables — TypeScript enforces it. No central file, no
  string ids; the Hebrew stays byte-identical to v1.

## Stack

TypeScript + Vite + plain DOM. **No framework, no runtime dependencies** — the
whole bundle is ~56 KB (18 KB gzipped). Cloudflare Pages + Pages Functions + D1.

Descended from `../birthday-quest` (Phaser 3 party game), which supplied the
Pages/wrangler setup, the gate pattern, the palette, the degrade-to-null
discipline and the zero-dep `tools/` precedent. **Phaser was deliberately not
carried over** — these activities are forms, lists and a grid, and that repo's
own notes record how much pain canvas text input caused.

## How it is wired

- `src/sync.ts` — the event-log client. Incremental `?since=<cursor>` reads,
  optimistic idempotent writes with a persisted outbox, per-route polling,
  visibility and idle gating.
- `src/store.ts` — `fold(events) -> World`. Every screen reads from here.
- `src/world.ts` — holds the current fold, broadcasts changes.
- `src/router.ts` — hash router; also the single place the polling policy is
  applied.
- `src/room.ts` — **the current event.** Resolves the room id (`?r=` → last
  opened → none, which means the landing page), fetches the row from
  `/api/rooms`, holds the password and host code for this room, caches the
  full room for offline boot. Every per-event value (bingo side, min proposals,
  quiz, activity switches) is a getter here; `createRoom` / `updateRoom` /
  `switchRoom` are how the wizard and settings write.
- `src/i18n.ts` — language: phone override → event language → browser
  language. `applyDocumentLang()` flips `<html lang dir>`; the stylesheet is
  all logical properties so that is the whole RTL/LTR switch.
- `src/main.ts` — two boots: `#/new` and `#/start` (and "no room at all")
  render without a room, password or sync; everything else resolves the room
  first, then the two-step gate, then the router.
- `src/screens/wizard.ts` → `editors.ts` (participants, activities, custom
  questions — shared with `settings.ts`) → `quizsetup.ts` (export → roster →
  questions, in the browser) → share screen with `lib/qr.ts`.
- `src/lib/chat/` — the analyzer as plain ESM JS with JSDoc types, shared by
  the browser and `tools/chat-analyze.mjs`. `index.js` is the API; `browser.js`
  is the only file allowed to touch web APIs and the CLI never imports it.
- `functions/api/events.js` — the event log, ~200 lines of plain JS. Auth is
  per room: the `x-party` header is hashed against the room's `pass_hash`.
- `functions/api/rooms.js` — event setup: public info, full config on
  password, create, update. `functions/_lib.js` holds hashing, ids, expiry.
- `src/config.ts` — genuine constants only: poll intervals, scoring, palette,
  the activity registry (`activities()`, a function because titles are
  language-dependent).

### Adding an activity

1. Add an event kind to `KINDS` in `functions/api/events.js`.
2. Fold it in `src/store.ts`.
3. Write `src/screens/<name>.ts` returning an optional teardown.
4. Register the route in `src/main.ts` and add an entry to `ACTIVITIES`.

Screens with text inputs must subscribe via `onWorld` and re-render only their
non-input parts — the `live()` wrapper in `main.ts` re-renders everything and
would steal focus mid-typing.

## The activities

| key | phases | notes |
|---|---|---|
| `bingo` | propose → play | 3x3–5x5 per event, no free space; everyone proposes at least `minProposals`, more allowed |
| `truths` | submit → guess → reveal | statements shuffled once at submit time |
| `quiz` | none — self-paced | questions from the in-browser analyzer and/or the host's own, in the room's `quiz` column |
| `superlatives` | none | unscored on purpose; vote targets are players plus listed non-playing participants (`voteTargets`) |
| `wall` | none | text only; photos would need blob storage |
| `awards` | none | pure fold, no input, gives the weekend an ending |

Not activities but part of the app: the host can **rename any player** from
`#/host` (a `rename` event, host-gated server-side; the renamed phone adopts
the folded name), and every guest can send **feedback** from the home screen, through
`/api/feedback` to a D1 row and on to the Formspree endpoint in
`wrangler.toml` (email). Both feedback and event creation are behind a
**Cloudflare Turnstile** check (`src/lib/turnstile.ts`, `verifyTurnstile` in
`_lib.js`) — the one external script the app loads, and only on those two
screens. Guests never see it (`DEPLOY.md`).

## Decisions locked in (do not re-litigate)

- **`localStorage`, not `sessionStorage`.** birthday-quest used the latter for a
  90-minute game. This must survive a weekend of phone reboots. The gate is
  shown exactly once per phone, ever.
- **Bingo boards derive from `(playerId, freezeId, poolIds)`.** The freeze event
  carries the ordered pool. Seeding on the live pool would silently reshuffle
  all 14 boards whenever anyone proposed a square, and marks would appear to
  teleport. Nearly invisible when testing alone.
- **Non-playing participants are ids of the form `p:<name>`.** They exist only
  as vote targets in "who is most…"; `nameOf` decodes them, and they never get
  a board, a score or a standings row. Matching a listed name to a signed-in
  player is by case-folded name — the host has no other handle on a person.
- **The analyzer is loaded lazily.** `quizsetup.ts` uses dynamic `import()`
  so guests never download the ~47 KB chunk. Keep it that way.
- **The freeze event carries the grid side** as well as the pool (`side`).
  Boards are `(playerId, freezeId, poolIds, side)`; a host editing the bingo
  size after the freeze must not resize anyone's board. Old freezes without it
  fall back to the room setting via `sideOf(w)`.
- **Per-room storage keys.** Password, unlocked flag, host code, event cache and
  outbox are all suffixed with the room id (`roomKey()`). Player id and
  nickname are global — you are the same person at every event. "Leave this
  event" on the home screen (`me.leaveRoom()`) clears only the per-room keys,
  which is exactly why rejoining with the code brings back the same name,
  board and score.
- **Global marks, personal boards.** A square happens once for everyone; only
  the layout differs. No cheat vector, less code, and one declaration lights up
  most people's cards at once.
- **Phase changes are gated server-side** on the room's hashed host code. A
  client-only check would let anyone with devtools advance a phase mid-round.
  The host screen still verifies the code with the server at unlock time
  (`GET /api/rooms?id=…&host=…`), so a typo is refused up front.
- **Passwords and host codes are stored hashed** (SHA-256 over
  `roomId:secret`, in `_lib.js`). Not KDF-grade on purpose: the threat is a
  curious guest, not an offline attacker.
- **Party password travels percent-encoded** in the `x-party` header. Header
  values must be Latin-1 and the password is Hebrew — raw makes `fetch` throw.
  The server `decodeURIComponent`s and hashes; the client never hashes.
- **A 4xx from the events endpoint drops the batch.** Retrying a rejected write
  cannot succeed, and leaving it in the outbox would block every later write
  behind it. 5xx and network errors still retry forever.
- **Rate stats have a 200-message floor.** Someone with two messages otherwise
  "wins" exclamation marks per 100 messages at 200.
- **Numeric-guess falloff is relative** (~70% of the answer), not the fixed
  falloff birthday-quest used — answers here span three orders of magnitude.

## Things that will bite

- **D1 bills rows scanned.** The `events_room_id` index is load-bearing, not an
  optimization. See `DEPLOY.md`.
- **Free-tier request budget.** ~53k/day by design against 100k/day. The
  per-route intervals plus visibility/idle gating are what keep it there; a flat
  3s poll would be ~235k.
- **RTL in plain DOM**: logical properties only, `<bdi>` around every number
  (`11/14` renders as `14/11` otherwise), `dir="auto"` on user text, inputs
  never below 16px or iOS zooms on focus.
- **Hebrew pluralization**: use `heCount`/`heCountText` from `ui/dom.ts`, not a
  bare numeral — "1 שאלות" is wrong.

## The WhatsApp analyzer

`tools/chat-analyze.mjs`, zero dependencies, two passes (`roster` then `build`).
Reads the .zip directly via the central directory (WhatsApp writes streaming
zips, so local headers carry no sizes).

Hard-won details, all of which produced plausible-looking wrong output first:

- **Format is detected once for the whole file**, not per line. Someone pasted a
  US-format transcript into the group in 2018; per-line detection turned those
  11 body lines into fake messages with a month field of 30.
- **`BIDI_RE` excludes U+200D.** Stripping ZWJ shatters every compound emoji.
- **10.1% of lines are continuations.** Dropping them costs ~10% of every word
  count, concentrated on whoever writes long messages.
- **Dates are built from parts**, never parsed from a string — `new Date(2018,
  30, 9)` is *valid* and lands in July 2021.
- **Media/deleted placeholders count as messages, not words**, or `<Media
  omitted>` injects two fake words 4,000 times.
- **Read the sanity report.** It exists because every failure above is silent.

## Commands

```bash
npm install
npm run build
npx wrangler pages dev dist --port 8788   # the Function + a local D1
npm run dev                               # localhost:5173, proxies /api to 8788
npm run roster -- --in "<export>"  # pass 1: emits tools/private/names.json
npm run stats  -- --in "<export>"  # pass 2: emits tools/private/chat-stats.json (--lang en, --out, --no-excerpts)
```

The local D1 needs the schema once: `npx wrangler d1 execute weekend-quest
--local --file=./schema.sql`; then create an event via the wizard. No `.dev.vars` are needed any more — there are no per-party
vars.

## v2 status

All seven milestones are built and verified against a local D1 + Function
(wizard end to end, in-browser analysis of a synthetic iOS export, Hebrew and
English, host settings, listed participants as vote targets). **None of it is
deployed yet** — see the cut-over in `DEPLOY.md`.

| # | Milestone | Notes |
|---|---|---|
| 1 | rooms table, room API, hashed auth, client reads room from URL, v1 migrated | one-off migration, done; script kept in `tools/private/` |
| 2 | String table + language switch | per-module tables; toggle on the gate, home and landing |
| 3 | Wizard steps 1–4 + share screen | `#/new`; draft survives reload, password does not |
| 4 | Bingo 3x3–5x5, open proposals, non-playing participants | side rides on the freeze event |
| 5 | Analyzer in the browser, roster screen, quiz upload | `src/lib/chat`, lazy chunk; CLI still works |
| 6 | Custom questions | `editors.ts`, ids `custom_*`, merged into `quiz.questions` |
| 7 | Landing page, join by code/link, QR, expiry purge, caps | `#/start`; purge runs on create; caps in `rooms.js` |

Known gaps, deliberately left: no way to change an event's password or host
code after creation (make a new event); the roster screen merges by tapping,
not by drag; a real iOS export has not been tested, only synthetic ones.

## Public repository

The repo is public (MIT). Nothing under `tools/private/` is tracked, and no
tracked file may carry names, message text or secrets from any real event —
the v1 checklist that did was removed before publishing. Keep it that way.
