/**
 * 修复密码哈希脚本 - 重新生成所有账号的密码哈希
 */
const initSql = require('sql.js');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const path    = require('path');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'assessment.db');

initSql().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  const accounts = [
    { username: 'admin',     password: 'admin123' },
    { username: 'examadmin', password: 'exam123'  },
    { username: 'viewer',    password: 'read123'  },
  ];

  for (const acc of accounts) {
    const hash = bcrypt.hashSync(acc.password, 10);
    db.run('UPDATE admin_users SET password_hash=? WHERE username=?', [hash, acc.username]);
    const ok = bcrypt.compareSync(acc.password, hash);
    console.log(`${acc.username} / ${acc.password}  hash_verify=${ok}`);
  }

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  console.log('DB 已保存，密码哈希更新完毕');
  db.close();
}).catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
