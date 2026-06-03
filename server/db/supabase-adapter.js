/**
 * Supabase (PostgreSQL) 适配器
 * 通过 exec_sql RPC 函数操作 PostgreSQL
 *
 * 前提: 需要先调用 /api/init-supabase 创建表和 RPC 函数
 *
 * 环境变量:
 *   SUPABASE_URL  - Supabase 项目 URL (https://xxx.supabase.co)
 *   SUPABASE_KEY  - Supabase service_role secret key
 */

const { createClient } = require('@supabase/supabase-js');

class SupabaseAdapter {
  constructor(url, key) {
    this.client = createClient(url, key, {
      auth: { persistSession: false }
    });
  }

  /**
   * 执行查询（SELECT），返回 [{col: val, ...}, ...]
   * 通过 exec_sql RPC 函数执行原生 SQL
   */
  async query(sql, params = []) {
    const { sql: pgSql, values } = this._toPg(sql, params);
    const { data, error } = await this.client.rpc('exec_sql', {
      query_string: pgSql,
      query_params: values
    });
    if (error) throw new Error(`Supabase query error: ${error.message}`);
    if (!data) return [];
    return data.map(row => this._toObject(row));
  }

  /**
   * 执行写操作（INSERT/UPDATE/DELETE）
   */
  async run(sql, params = []) {
    const { sql: pgSql, values } = this._toPg(sql, params);
    const { error } = await this.client.rpc('exec_sql', {
      query_string: pgSql,
      query_params: values
    });
    if (error) throw new Error(`Supabase run error: ${error.message}`);
  }

  /**
   * Supabase 自动持久化
   */
  async flush() {}

  /**
   * 执行多条 SQL
   */
  async execScript(sql) {
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));
    for (const stmt of statements) {
      const { sql: pgSql } = this._toPg(stmt, []);
      const { error } = await this.client.rpc('exec_sql', {
        query_string: pgSql,
        query_params: []
      });
      if (error) console.warn('execScript warning:', error.message);
    }
  }

  close() {}

  // ── 内部方法 ──

  /**
   * 将 SQLite SQL 转为 PostgreSQL 语法
   */
  _toPg(sql, params) {
    let converted = sql;

    // ? 占位符 → $1, $2, ...
    let idx = 0;
    const values = [];
    converted = converted.replace(/\?/g, () => {
      idx++;
      values.push(params[idx - 1]);
      return `$${idx}`;
    });

    // datetime('now','localtime') → NOW()
    converted = converted.replace(/datetime\('now'\s*,\s*'localtime'\)/g, 'NOW()');

    // INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
    converted = converted.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');

    // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
    converted = converted.replace(/INSERT OR IGNORE\s+INTO\s+(\w+)\s+\(([^)]+)\)\s+VALUES/g,
      'INSERT INTO $1 ($2) VALUES');

    // INSERT OR REPLACE → INSERT ... ON CONFLICT DO UPDATE
    converted = converted.replace(/INSERT OR REPLACE\s+INTO\s+(\w+)\s+\(([^)]+)\)\s+VALUES/g,
      'INSERT INTO $1 ($2) VALUES');

    return { sql: converted, values };
  }

  /**
   * 将 Supabase 返回的 JSONB 行转为普通对象
   */
  _toObject(row) {
    if (typeof row === 'string') {
      try { return JSON.parse(row); } catch { return {}; }
    }
    if (row && typeof row === 'object') {
      return { ...row };
    }
    return {};
  }
}

module.exports = SupabaseAdapter;
