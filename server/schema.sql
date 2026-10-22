-- tmux からくり屋敷: the shared records. A player is a 合言葉 (sync key),
-- stored only as its SHA-256. No accounts, no e-mail.
CREATE TABLE IF NOT EXISTS players (
  key_hash TEXT PRIMARY KEY,
  name     TEXT UNIQUE,          -- the name on the boards; NULL until set
  created  TEXT NOT NULL
);

-- Every run of every device that shares the key (the synced history).
CREATE TABLE IF NOT EXISTS runs (
  key_hash TEXT NOT NULL,
  id       TEXT NOT NULL,
  course   TEXT NOT NULL,
  at       TEXT NOT NULL,
  body     TEXT NOT NULL,        -- the run as the browser keeps it (JSON)
  PRIMARY KEY (key_hash, id)
);

-- Runs entered on the boards, with the seconds each question took (the ghost).
CREATE TABLE IF NOT EXISTS scores (
  run_id   TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  course   TEXT NOT NULL,
  ver      INTEGER NOT NULL,
  time     REAL NOT NULL,
  day      TEXT NOT NULL,        -- the date in Japan, YYYY-MM-DD
  at       TEXT NOT NULL,
  splits   TEXT NOT NULL,        -- JSON: seconds per question, penalties included
  PRIMARY KEY (key_hash, run_id)
);
CREATE INDEX IF NOT EXISTS scores_board ON scores (course, ver, day, time);
CREATE INDEX IF NOT EXISTS scores_all ON scores (course, ver, time);

-- Requests per address per minute, for the endpoints that write.
CREATE TABLE IF NOT EXISTS hits (
  ip     TEXT NOT NULL,
  minute INTEGER NOT NULL,
  n      INTEGER NOT NULL,
  PRIMARY KEY (ip, minute)
);

-- One step of a visit (the counts): a random id per browser, never tied to
-- a 合言葉. The Worker also creates this on first use.
CREATE TABLE IF NOT EXISTS events (day TEXT NOT NULL, v TEXT NOT NULL, e TEXT NOT NULL, c TEXT NOT NULL, n INTEGER NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_day ON events (day, e);
