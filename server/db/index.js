/**
 * 数据库适配器工厂
 * 根据环境自动选择 sql.js（本地）、Supabase（PostgreSQL）或 Turso（libSQL）
 *
 * 环境变量:
 *   SUPABASE_URL        - Supabase 项目 URL (https://xxx.supabase.co)
 *   SUPABASE_KEY        - Supabase service_role key
 *   TURSO_DATABASE_URL  - Turso 数据库 URL (libsql://xxx)
 *   TURSO_AUTH_TOKEN     - Turso 认证 token
 *   DB_PATH             - 本地数据库文件路径 (默认 server/data/assessment.db)
 */

const path = require('path');

let _adapter = null;

/**
 * 获取数据库适配器（单例）
 */
async function getDbAdapter() {
  if (_adapter) return _adapter;

  // 优先级: Supabase > Turso > 本地 SQLite
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (supabaseUrl && supabaseKey) {
    // Supabase PostgreSQL 模式
    const SupabaseAdapter = require('./supabase-adapter');
    _adapter = new SupabaseAdapter(supabaseUrl, supabaseKey);
    console.log('🔗 使用 Supabase PostgreSQL 数据库');
    return _adapter;
  }

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoToken) {
    // Turso / Vercel 模式
    const TursoAdapter = require('./turso-adapter');
    _adapter = new TursoAdapter(tursoUrl, tursoToken);
    console.log('🔗 使用 Turso 云端数据库');
    return _adapter;
  }

  // 本地 sql.js 模式
  const SqliteAdapter = require('./sqlite-adapter');
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'assessment.db');
  _adapter = new SqliteAdapter(dbPath);
  console.log('📦 使用本地 SQLite 数据库');
  return _adapter;
}

/**
 * 检测当前数据库类型
 */
function getDbType() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) return 'supabase';
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) return 'turso';
  return 'sqlite';
}

function isTurso() {
  return getDbType() === 'turso';
}

function isSupabase() {
  return getDbType() === 'supabase';
}

module.exports = { getDbAdapter, isTurso, isSupabase, getDbType };
