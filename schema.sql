-- Weekend Quest — the entire database.
--
-- One append-only log for all three activities. Apply once with:
--   npx wrangler d1 execute weekend-quest --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  room    TEXT    NOT NULL,
  kind    TEXT    NOT NULL,
  player  TEXT    NOT NULL,
  uid     TEXT    NOT NULL,
  payload TEXT    NOT NULL,
  ts      INTEGER NOT NULL
);

-- Makes writes idempotent: a phone on bad wifi that times out and retries
-- cannot double-submit a guess or double-mark a square.
CREATE UNIQUE INDEX IF NOT EXISTS events_uid ON events(room, uid);

-- NOT an optimisation -- the design depends on it. D1 bills rows *scanned*.
-- With this index a poll that finds nothing new scans about one row
-- (~110k rows/day across 14 phones, 2% of the free tier). Without it every
-- poll is a full table scan: ~53M rows/day, 10x over the limit, and D1 starts
-- erroring on Saturday afternoon with no obvious symptom.
CREATE INDEX IF NOT EXISTS events_room_id ON events(room, id);

-- ---------------------------------------------------------------------------
-- v2: one deployment, many events.
--
-- `events.room` already existed and every query filtered on it, so the event
-- log was multi-tenant from the start. This table is what was missing: a place
-- to put per-event configuration that used to be compile-time constants.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,     -- short, unguessable, URL-safe
  name       TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'he',
  -- SHA-256, never the password itself. The old build-time password shipped in
  -- the client bundle, which was fine for one party where it was a curtain;
  -- holding other people's passwords in plaintext is a different thing.
  pass_hash  TEXT NOT NULL,
  host_hash  TEXT NOT NULL,
  config     TEXT NOT NULL,        -- JSON: activities, bingo size, participants, caps
  quiz       TEXT,                 -- JSON: generated + custom questions, or null
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL      -- bumped on write; drives expiry
);

-- Expiry sweep reads this; without it the purge is a full scan.
CREATE INDEX IF NOT EXISTS rooms_last_seen ON rooms(last_seen);

-- Bug reports and ideas from guests (#/feedback). Read with wrangler, never
-- shown in the app. Kept when a room is purged: the report outlives the event.
CREATE TABLE IF NOT EXISTS feedback (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  room      TEXT NOT NULL,
  room_name TEXT,
  name      TEXT,                 -- the guest's nickname at the time
  email     TEXT,                 -- optional, so the developer can reply
  lang      TEXT,
  text      TEXT NOT NULL,
  ua        TEXT,                 -- user agent, for "which phone" bugs
  ts        INTEGER NOT NULL
);
