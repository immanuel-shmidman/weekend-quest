# v2 — from one weekend to a self-serve party app

> **Status (2026-09-06): built, not yet deployed.** All seven milestones are
> implemented and verified locally; the remaining step is the database
> migration + deploy described in `DEPLOY.md`. The milestone table at the end
> of `CLAUDE.md` is the authoritative record of what shipped and what was
> deliberately left out.

## What changed

The app worked. Two families asked to use it for their own trips, and neither is
technical. Today an event needs a developer: password, host code, room id, bingo
size and the entire quiz are compile-time constants, and setup means running
`wrangler deploy`. v2 makes all of that runtime data behind a setup wizard.

## Decisions (from the owner)

| | |
|---|---|
| Hosting | **One shared site.** `weekend-quest.pages.dev` becomes a landing page; families create their own events |
| Language | **Hebrew + English, switchable.** ~333 hardcoded strings move into a string table |
| Who can create | **Anyone with the URL**, with a lockdown flag, auto-expiry and caps |
| Chat quiz | **WhatsApp, Hebrew or English, iOS or Android**, parsed in the browser |
| Bingo | Owner picks 3x3–5x5; everyone proposes **at least** 2, more allowed |
| Participants | Non-playing people (children) can be added as answer options |

## The capacity question, settled

- **Storage: a non-issue.** ~1,000 rows/event at ~250 B, plus ~50 KB of quiz
  JSON ≈ **300 KB per event**. Against D1's 5 GB free tier that is ~17,000
  events.
- **Requests: the real ceiling.** ~53k/day budgeted per active event against a
  100k/day free tier → about **two concurrently-active events**. Different
  weekends are fine; two families on one Saturday is not.
- **No billing risk.** Free plan has no card attached; exceeding the budget
  returns errors until the daily reset. Worst case is a bad day, not an invoice.

Guardrails, all cheap:

- `REQUIRE_CREATE_CODE` — one flag, flips event creation behind a code.
- Rooms expire 30 days after their last event; a scheduled purge deletes them.
- Per-event caps: players, proposals per person, text lengths.
- A global daily create cap as a flood stop.

---

## Architecture

### The data layer is already multi-tenant

`events.room` exists and every query filters on it — built that way for the
"bump to w2 for a clean slate" escape hatch. The expensive part is done. What is
missing is a place to put per-event *configuration*.

### New table: `rooms`

```sql
CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,       -- short, unguessable, URL-safe
  name       TEXT NOT NULL,
  lang       TEXT NOT NULL,          -- 'he' | 'en'
  pass_hash  TEXT NOT NULL,          -- SHA-256, not the password itself
  host_hash  TEXT NOT NULL,
  config     TEXT NOT NULL,          -- JSON: activities, bingo size, caps
  quiz       TEXT,                   -- JSON: generated + custom questions
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL        -- drives expiry
);
CREATE INDEX IF NOT EXISTS rooms_last_seen ON rooms(last_seen);
```

Passwords are **hashed, not stored**. Today's are build-time constants that ship
in the bundle, which was fine for one party where the password was a curtain.
Holding other people's passwords in plaintext on my account is a different
thing, so: SHA-256 via WebCrypto, compared server-side.

### Auth becomes per-room

`functions/api/events.js` currently compares `x-party` against
`env.PARTY_PASSWORD`. It will look the room up, compare against `pass_hash`, and
cache the row per request. `phase` events check `host_hash` the same way.

### The client stops importing its own config

`src/config.ts` keeps only genuine constants (palette, poll intervals, caps).
Everything per-event moves to `src/room.ts`, fetched once at boot from
`GET /api/room/:id` and held in memory. `sync.ts` reads the room id from the URL
rather than a constant.

---

## The setup wizard — `#/new`

Six steps, each skippable except the first two. Phone-first, same components.

1. **Event name and language.**
2. **Password** — what guests type to get in. Host code generated and shown once,
   with a "copy" button and a warning that it is the only time it appears.
3. **Who is coming** — a name list. Each row toggles **playing** / **not playing**
   (children: appear as options in "who is most", never get a board or a score).
4. **Which activities**, with per-activity settings: bingo grid size 3x3–5x5 and
   minimum proposals; whether two truths is on; and so on.
5. **Chat quiz (optional)** — drop the WhatsApp export in, roster screen, pick
   questions. the general questions used in v1 should be offered automatically (who wrote the most, who broke silence the most, most emojies etc.). there should be a notice to user informing him of the privacy policy regarding the chat (correct if I'm wrong)- it is parsed by a script and messages themselves aren't saved online ever, only stats. 
6. **Your own questions (optional)** — multiple choice or number guess.

Ends on a share screen: the join link, the password, a QR code, and the host
code again.

### In-browser WhatsApp analysis — the biggest chunk

`tools/chat-analyze.mjs` is 2,109 lines of Node. The parsing, stats and question
generation are pure string work and port directly; only four things are
Node-specific:

| Node | Browser |
|---|---|
| `readFileSync` | `File` + `arrayBuffer()` |
| `zlib.inflateRawSync` | `DecompressionStream('deflate-raw')` |
| `writeFileSync` | POST to the room |
| console report | a results screen |

Split into `src/lib/chat/` (shared, environment-free) with thin Node and browser
adapters, so the CLI keeps working and the browser reuses the same tested logic.

**The roster step becomes a screen.** Today it is a hand-edited JSON file where
17 display names collapse to 14 people. In the wizard: a list of names with
counts, tap two to merge, swipe to exclude, and the Levenshtein suggestions
surface as "these two look like the same person" prompts.

**Privacy improves.** Today the export is parsed on my machine. In the browser it
never leaves the guest's device at all — only the derived stats are uploaded,
and the existing rules still apply about which excerpts ship.

---

## The two named infrastructure changes

**Bingo, variable size and open proposals.** `BINGO_SIDE` becomes
`room.config.bingoSide` (3–5). `LINES` is computed rather than a constant — it
already is. The propose screen stops capping at exactly 2: it asks for a minimum
and lets anyone add more, because ideas are not evenly distributed. The freeze
screen warns if the pool is smaller than the board.

**Non-playing participants.** `rooms.config.participants` carries everyone,
each flagged `playing`. The fold gains them as `World.participants`, distinct
from `World.players` (who have signed in). Superlatives offer all participants
as vote targets; scoring, boards and standings only ever consider players. The
awards screen already skips anything with no data, so it needs no change.

---

## Order of work

Each milestone ends deployable, with the existing event still working.

| # | Milestone | Est |
|---|---|---|
| 1 | `rooms` table, room API, hashed auth, client reads room from URL. **Migrate the existing weekend into a row so nothing breaks.** | 1.5h |
| 2 | String table + language switch; extract all 333 strings | 2h |
| 3 | Setup wizard steps 1–4 + share screen | 2h |
| 4 | Bingo variable size + open proposals; non-playing participants | 1h |
| 5 | Chat analyzer → browser, roster screen, quiz upload | 2.5h |
| 6 | Custom question authoring | 1h |
| 7 | Landing page, join flow, QR, expiry purge, caps | 1.5h |

**~11.5 hours.**

## Risks

1. **The analyzer port.** Largest chunk, and the iOS export path is untested
   against a real file. Mitigation: the format-detection and sanity-report
   machinery already exists and fails loudly; an unreadable export gets a clear
   message rather than silently wrong numbers.
2. **Breaking the existing event.** Mitigation: milestone 1 migrates it into a
   room row first, and every later milestone is verified against it.
3. **Scope creep into a product.** This is a favour, not a service. No accounts,
   no email, no recovery flow — if someone loses their host code, they make a
   new event. however, we want it to be friendly- have a צור קשר button where they can contact me (will I be able to tell them they're host key?)
