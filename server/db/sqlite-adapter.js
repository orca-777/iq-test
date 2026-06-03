/**
 * 本地 sql.js 适配器
 * 封装 sql.js WASM SQLite，供 server/db/index.js 调用
 */

const fs = require('fs');
const path = require('path');

class SqliteAdapter {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this._db = null;
    this._SQL = null;
  }

  async _init() {
    if (this._db) return;
    if (!this._SQL) {
      const initSqlJs = require('sql.js');
      this._SQL = await initSqlJs();
    }
    if (!fs.existsSync(this.dbPath)) {
      throw new Error('数据库未初始化，请先运行 node init-db.js');
    }
    const buf = fs.readFileSync(this.dbPath);
    this._db = new this._SQL.Database(buf);
  }

  /**
   * 执行查询，返回行数组 [{col: val, ...}, ...]
   */
  async query(sql, params = []) {
    await this._init();
    const result = this._db.exec(sql, params);
    if (!result.length || !result[0].columns.length) return [];

    const columns = result[0].columns;
    return result[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  /**
   * 执行写操作（INSERT/UPDATE/DELETE）
   */
  async run(sql, params = []) {
    await this._init();
    // sql.js run 接受单层数组
    this._db.run(sql, params);
  }

  /**
   * 将内存中的数据库写回磁盘
   */
  async flush() {
    if (!this._db) return;
    const data = this._db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  /**
   * 批量执行多条 SQL（用于初始化）
   */
  async execScript(sql) {
    await this._init();
    this._db.run(sql);
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}

module.exports = SqliteAdapter;
