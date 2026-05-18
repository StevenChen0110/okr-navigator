-- Personal knowledge base: user-uploaded documents for AI context
CREATE TABLE IF NOT EXISTS user_documents (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('paste', 'upload', 'notion', 'gdrive')),
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_documents_user_id ON user_documents(user_id, created_at DESC);
ALTER TABLE user_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_documents own data" ON user_documents FOR ALL USING (auth.uid() = user_id);

-- OAuth integration tokens (Notion, Google Drive)
CREATE TABLE IF NOT EXISTS user_integrations (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('notion', 'gdrive')),
  access_token TEXT NOT NULL,
  workspace_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);
ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_integrations own data" ON user_integrations FOR ALL USING (auth.uid() = user_id);
