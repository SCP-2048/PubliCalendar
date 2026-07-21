PRAGMA foreign_keys = ON;

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (length(code) = 8),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  creator_token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX schedules_expiry_idx ON schedules(expires_at);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  submitted_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX participants_schedule_idx ON participants(schedule_id);

CREATE TABLE availability_ranges (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  CHECK (start_at < end_at)
);

CREATE INDEX availability_participant_idx ON availability_ranges(participant_id, start_at);
