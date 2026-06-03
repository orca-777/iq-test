/**
 * 数据库适配器工厂
 * 根据环境自动选择 sql.js（本地）或 Turso（Vercel）
 *
 * 环境变量:
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

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoToken) {
    // Vercel / Turso 模式
    const TursoAdapter = require('./turso-adapter');
    _adapter = new TursoAdapter(tursoUrl, tursoToken);
    console.log('🔗 使用 Turso 云端数据库');
  } else {
    // 本地 sql.js 模式
    const SqliteAdapter = require('./sqlite-adapter');
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'assessment.db');
    _adapter = new SqliteAdapter(dbPath);
    console.log('📦 使用本地 SQLite 数据库');
  }

  return _adapter;
}

/**
 * 检测是否使用 Turso
 */
function isTurso() {
  return !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

module.exports = { getDbAdapter, isTurso };
