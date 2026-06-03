-- IQ Test System - Supabase Database Setup SQL
-- Copy and paste this into Supabase Dashboard > SQL Editor and run it

-- 1. Create questions table
CREATE TABLE IF NOT EXISTS questions (
  id         SERIAL PRIMARY KEY,
  part       INTEGER NOT NULL,
  dimension  TEXT    NOT NULL,
  order_num  INTEGER NOT NULL,
  q_text     TEXT    NOT NULL,
  options    TEXT    NOT NULL DEFAULT '[]',
  answer     TEXT    NOT NULL DEFAULT '',
  q_type     TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create admin_users table
CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT   NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'readonly',
  display_name  TEXT    NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

-- 3. Create app_settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 4. Create assessment_results table
CREATE TABLE IF NOT EXISTS assessment_results (
  id               TEXT PRIMARY KEY,
  name             TEXT    NOT NULL,
  timestamp        TIMESTAMPTZ NOT NULL,
  overall_score    REAL,
  cognitive_score  REAL,
  cognitive_level  TEXT,
  leadership_score REAL,
  leadership_level TEXT,
  personality_score REAL,
  personality_level TEXT,
  cog_correct      INTEGER DEFAULT 0,
  lead_correct     INTEGER DEFAULT 0,
  likert_total     INTEGER DEFAULT 0,
  sub_scores       TEXT,
  answers          TEXT
);

-- 5. Create exec_sql RPC function (for adapter to execute arbitrary SQL)
CREATE OR REPLACE FUNCTION exec_sql(query_string TEXT)
RETURNS SETOF JSONB AS $$
BEGIN
  RETURN QUERY EXECUTE query_string;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Insert default settings
INSERT INTO app_settings (key, value) VALUES ('shuffle_questions', 'true') ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('exam_duration_minutes', '60') ON CONFLICT (key) DO NOTHING;

-- 7. Disable RLS for simplicity (enable later if needed)
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service_role" ON questions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON admin_users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON app_settings FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON assessment_results FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Allow anon select" ON questions FOR SELECT USING (true);
CREATE POLICY "Allow anon insert" ON assessment_results FOR INSERT USING (true);
CREATE POLICY "Allow anon select" ON assessment_results FOR SELECT USING (true);
CREATE POLICY "Allow anon select" ON app_settings FOR SELECT USING (true);
