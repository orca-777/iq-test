/**
 * Supabase Database Init Endpoint
 * Vercel Serverless Function
 */
const bcrypt = require('bcryptjs');

const INIT_KEY = process.env.INIT_KEY || 'init_iq_test_2026';

module.exports = async (req, res) => {
  if (req.query.key !== INIT_KEY) {
    return res.status(403).json({ error: 'Invalid init key' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !dbPassword) {
    return res.status(500).json({ error: 'Missing env vars', has_url: !!supabaseUrl, has_pass: !!dbPassword });
  }

  const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

  const { Client } = require('pg');

  let client = null;
  let debug = [];
  const connConfigs = [
    // 1. Direct connection port 5432
    {
      label: 'direct-5432',
      host: `db.${projectRef}.supabase.co`,
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: dbPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    },
    // 2. Supavisor pooler port 6543 (transaction mode)
    {
      label: 'pooler-6543-v1',
      host: `aws-0-${projectRef}.pooler.supabase.com`,
      port: 6543,
      database: 'postgres',
      user: `postgres.${projectRef}`,
      password: dbPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    },
    // 3. Supavisor pooler port 6543 (session mode) 
    {
      label: 'pooler-6543-v2',
      host: `aws-0-${projectRef}.pooler.supabase.com`,
      port: 6543,
      database: 'postgres',
      user: `postgres`,
      password: dbPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    },
  ];

  for (const config of connConfigs) {
    try {
      const c = new Client(config);
      await c.connect();
      client = c;
      debug.push(`Connected via ${config.label}`);
      break;
    } catch (e) {
      debug.push(`${config.label}: ${e.message.substring(0, 120)}`);
      try { } catch {}
    }
  }

  if (!client) {
    return res.status(500).json({
      error: 'All PostgreSQL connections failed',
      success: false,
      project_ref: projectRef,
      debug: debug,
    });
  }

  let results = { connection: debug[0], project: projectRef };

  try {
    // Create questions table
    await client.query(`CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY, part INTEGER NOT NULL, dimension TEXT NOT NULL,
      order_num INTEGER NOT NULL, q_text TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]',
      answer TEXT NOT NULL DEFAULT '', q_type TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    results.questions_table = 'created';

    // Create admin_users table
    await client.query(`CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'readonly', display_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login TIMESTAMPTZ
    )`);
    results.admin_users_table = 'created';

    // Create app_settings table
    await client.query(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    )`);
    results.app_settings_table = 'created';

    // Create assessment_results table
    await client.query(`CREATE TABLE IF NOT EXISTS assessment_results (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL,
      overall_score REAL, cognitive_score REAL, cognitive_level TEXT,
      leadership_score REAL, leadership_level TEXT,
      personality_score REAL, personality_level TEXT,
      cog_correct INTEGER DEFAULT 0, lead_correct INTEGER DEFAULT 0,
      likert_total INTEGER DEFAULT 0, sub_scores TEXT, answers TEXT
    )`);
    results.assessment_results_table = 'created';

    // Create exec_sql RPC function
    await client.query(`CREATE OR REPLACE FUNCTION exec_sql(query_string TEXT)
      RETURNS SETOF JSONB AS $$
      BEGIN
        RETURN QUERY EXECUTE query_string;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER`);
    results.exec_sql_function = 'created';

    // Default settings
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('shuffle_questions', 'true') ON CONFLICT (key) DO NOTHING`);
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('exam_duration_minutes', '60') ON CONFLICT (key) DO NOTHING`);

    // Admin accounts
    const uc = await client.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(uc.rows[0].count) === 0) {
      await client.query(`INSERT INTO admin_users (username, password_hash, role, display_name) VALUES ($1,$2,$3,$4)`,
        ['admin', bcrypt.hashSync('admin123', 10), 'super', 'Super Admin']);
      await client.query(`INSERT INTO admin_users (username, password_hash, role, display_name) VALUES ($1,$2,$3,$4)`,
        ['examadmin', bcrypt.hashSync('exam123', 10), 'exam_admin', 'Exam Admin']);
      await client.query(`INSERT INTO admin_users (username, password_hash, role, display_name) VALUES ($1,$2,$3,$4)`,
        ['viewer', bcrypt.hashSync('read123', 10), 'readonly', 'Viewer']);
      results.admin_users = '3 accounts created';
    } else {
      results.admin_users = `already ${uc.rows[0].count} accounts`;
    }

    // Question bank
    const qc = await client.query('SELECT COUNT(*) FROM questions');
    if (parseInt(qc.rows[0].count) === 0) {
      const QUESTIONS = getQuestions();
      for (const q of QUESTIONS) {
        await client.query(
          `INSERT INTO questions (part, dimension, order_num, q_text, options, answer, q_type) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [q.part, q.dimension, q.order_num, q.q_text, JSON.stringify(q.options), q.answer, q.q_type]
        );
      }
      results.questions = `${QUESTIONS.length} questions imported`;
    } else {
      results.questions = `already ${qc.rows[0].count} questions`;
    }

    results.success = true;
  } catch (e) {
    results.error = e.message;
    results.success = false;
  } finally {
    try { await client.end(); } catch {}
  }

  res.status(200).json(results);
};

function getQuestions() {
  const mc = (part, dim, num, text, opts, ans) => ({
    part, dimension: dim, order_num: num, q_text: text,
    options: opts.map((t, i) => ({ key: String.fromCharCode(65 + i), text: t })),
    answer: ans, q_type: part === 1 ? 'mc' : 'sjt'
  });
  const likert = (dim, num, text) => ({
    part: 3, dimension: dim, order_num: num, q_text: text,
    options: [
      { key: '1', text: '1' }, { key: '2', text: '2' }, { key: '3', text: '3' },
      { key: '4', text: '4' }, { key: '5', text: '5' }
    ],
    answer: '', q_type: 'likert'
  });
  return [
    mc(1,'Reasoning',1,'Test Q1',['A','B','C','D','E'],'E'),
    mc(1,'Reasoning',2,'Test Q2',['A','B','C','D','E'],'A'),
    mc(1,'Reasoning',3,'Test Q3',['A','B','C','D','E'],'B'),
  ];
}
