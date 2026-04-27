-- Run in Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS habits (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  cue         TEXT,
  frequency   TEXT        NOT NULL DEFAULT 'daily',
  streak_count INTEGER    NOT NULL DEFAULT 0,
  last_done_at DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  meta        JSONB       DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id          TEXT        PRIMARY KEY,
  habit_id    TEXT        NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_at   DATE        NOT NULL,
  skipped     BOOLEAN     NOT NULL DEFAULT FALSE,
  UNIQUE(habit_id, logged_at)
);

ALTER TABLE habits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own habits"      ON habits      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own habit_logs"  ON habit_logs  FOR ALL USING (auth.uid() = user_id);
