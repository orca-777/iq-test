const initSql = require('sql.js');
const fs      = require('fs');
const path    = require('path');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'assessment.db');

initSql().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  
  // 不带参数，直接查
  const all = db.exec("SELECT id, username, role FROM admin_users");
  console.log('all users:', JSON.stringify(all));
  
  // 带单个字符串参数
  const r1 = db.exec("SELECT id, username FROM admin_users WHERE username = 'admin'");
  console.log('admin (literal):', JSON.stringify(r1));
  
  // 用数组形式的参数
  const r2 = db.exec("SELECT id, username FROM admin_users WHERE username = ?", [['admin']]);
  console.log('admin (param array):', JSON.stringify(r2));
  
  // 用字符串参数
  const r3 = db.exec("SELECT id, username FROM admin_users WHERE username = ?", ['admin']);
  console.log('admin (param string):', JSON.stringify(r3));
  
  db.close();
}).catch(e => console.error(e.message));
