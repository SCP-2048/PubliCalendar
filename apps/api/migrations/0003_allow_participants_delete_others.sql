PRAGMA foreign_keys = ON;

ALTER TABLE schedules
ADD COLUMN allow_participants_delete_others INTEGER NOT NULL DEFAULT 0;
