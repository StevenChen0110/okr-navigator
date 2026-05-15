-- 週度任務記錄
CREATE TABLE IF NOT EXISTS weekly_logs (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  raw_input TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS weekly_logs_user_week ON weekly_logs (user_id, week_start);
ALTER TABLE weekly_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "weekly_logs own data" ON weekly_logs FOR ALL USING (auth.uid() = user_id);

-- AI 拆解後的單一任務項目（對應 KR）
CREATE TABLE IF NOT EXISTS log_items (
  id TEXT PRIMARY KEY,
  log_id TEXT REFERENCES weekly_logs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  kr_id TEXT,
  kr_title TEXT,
  is_planned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE log_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "log_items own data" ON log_items FOR ALL USING (auth.uid() = user_id);

-- 週度方向對齊報告
CREATE TABLE IF NOT EXISTS alignment_reports (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  alignment_score INTEGER NOT NULL,
  ai_insight TEXT NOT NULL,
  suggestions JSONB NOT NULL DEFAULT '[]',
  log_id TEXT REFERENCES weekly_logs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);
ALTER TABLE alignment_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alignment_reports own data" ON alignment_reports FOR ALL USING (auth.uid() = user_id);
