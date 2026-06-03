/**
 * Turso (libSQL) 适配器
 * 通过 HTTP client 连接 Turso 云端 SQLite，供 server/db/index.js 调用
 */

const { createClient } = require('@libsql/client');

class TursoAdapter {
  constructor(url, authToken) {
    this.client = createClient({
      url: url,
      authToken: authToken,
    });
  }

  /**
   * 执行查询，返回行数组 [{col: val, ...}, ...]
   */
  async query(sql, params = []) {
    const result = await this.client.execute({
      sql: sql,
      args: params,
    });
    if (!result.columns) return [];

    return result.rows.map(row => {
      const obj = {};
      result.columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  /**
   * 执行写操作（INSERT/UPDATE/DELETE）
   */
  async run(sql, params = []) {
    await this.client.execute({
      sql: sql,
      args: params,
    });
  }

  /**
   * Turso 自动持久化，flush 为空操作
   */
  async flush() {
    // no-op
  }

  /**
   * 批量执行多条 SQL（用于初始化）
   */
  async execScript(sql) {
    // Turso 不支持多语句执行，逐条拆分执行
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));
    for (const stmt of statements) {
      await this.client.execute({ sql: stmt, args: [] });
    }
  }

  close() {
    // no-op
  }
}

module.exports = TursoAdapter;
