PRAGMA foreign_keys = ON;

CREATE TABLE schedule_date_ranges (
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  CHECK (start_date <= end_date)
);

CREATE INDEX schedule_date_ranges_schedule_idx
  ON schedule_date_ranges(schedule_id, start_date);
