/**
 * 管培生综合评估系统 - 后端服务
 *
 * 启动: node server.js
 * 端口: 3000
 *
 * 数据库: 自动适配本地 sql.js 或 Turso 云端
 *   本地: 使用 sql.js WASM SQLite (server/data/assessment.db)
 *   Vercel: 使用 Turso 云端 SQLite (通过 TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
 *
 * API:
 *   GET  /api/questions          → 获取题库（维度内乱序）
 *   POST /api/submit             → 提交答案（写入 assessment_results 表）
 *   POST /api/admin/login        → 管理员登录
 *   GET  /api/admin/records      → 获取考试记录（需鉴权）
 *   GET  /api/admin/stats        → 统计数据
 *   GET  /api/admin/questions    → 获取题库列表
 *   POST /api/admin/questions    → 新增题目
 *   PUT  /api/admin/questions/:id → 修改题目
 *   DELETE /api/admin/questions/:id → 删除/禁用题目
 *   GET  /api/admin/users        → 获取账号列表（super）
 *   POST /api/admin/users        → 新增账号（super）
 *   PUT  /api/admin/users/:id    → 修改账号（super）
 *   DELETE /api/admin/users/:id  → 删除账号（super）
 *   GET  /api/admin/settings     → 系统设置
 *   PUT  /api/admin/settings     → 更新设置（super）
 *   GET  /api/admin/export       → 导出CSV/JSON
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');

const { getDbAdapter, isTurso } = require('./db');

const PORT      = 3000;
const JWT_SECRET  = 'zongteng_assessment_2026_secret';

// ── 工具函数 ──────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function verifyToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function requireRole(req, res, allowedRoles) {
  const payload = verifyToken(req);
  if (!payload) { json(res, 401, { error: '未登录或 Token 已过期' }); return null; }
  if (!allowedRoles.includes(payload.role)) {
    json(res, 403, { error: '权限不足' }); return null;
  }
  return payload;
}

/**
 * 从数据库获取设置值
 */
async function getSetting(db, key) {
  const rows = await db.query(`SELECT value FROM app_settings WHERE key = ?`, [key]);
  return rows.length > 0 ? rows[0].value : null;
}

/**
 * 从数据库读取考试记录
 */
async function getRecords(db) {
  const rows = await db.query(
    `SELECT id, name, timestamp, overall_score, cognitive_score, cognitive_level,
            leadership_score, leadership_level, personality_score, personality_level,
            cog_correct, lead_correct, likert_total,
            sub_scores, answers
     FROM assessment_results ORDER BY timestamp`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    timestamp: r.timestamp,
    overall: r.overall_score,
    cogScore: r.cognitive_score,
    cogLevel: r.cognitive_level,
    leadScore: r.leadership_score,
    leadLevel: r.leadership_level,
    persScore: r.personality_score,
    persLevel: r.personality_level,
    cogCorrect: r.cog_correct || 0,
    leadCorrect: r.lead_correct || 0,
    likertTotal: r.likert_total || 0,
    subScores: typeof r.sub_scores === 'string' ? JSON.parse(r.sub_scores) : (r.sub_scores || {}),
    answers: typeof r.answers === 'string' ? JSON.parse(r.answers) : (r.answers || {}),
  }));
}

// ── 评分逻辑 ──────────────────────────────────────────────────
function calcScores(questions, answers) {
  let cogCorrect = 0, leadCorrect = 0, likertTotal = 0;
  const subDim = {};

  for (const q of questions) {
    const ans = answers[q.id];
    if (!ans) continue;

    if (q.q_type === 'likert') {
      const score = parseInt(ans) || 0;
      likertTotal += score;
      if (!subDim[q.dimension]) subDim[q.dimension] = { correct: 0, total: 0, likertSum: 0 };
      subDim[q.dimension].likertSum += score;
      subDim[q.dimension].total += 1;
    } else {
      if (!subDim[q.dimension]) subDim[q.dimension] = { correct: 0, total: 0, likertSum: 0 };
      subDim[q.dimension].total += 1;
      if (ans === q.answer) {
        subDim[q.dimension].correct += 1;
        if (q.part === 1) cogCorrect++;
        else leadCorrect++;
      }
    }
  }

  const cogScore  = Math.round(cogCorrect / 30 * 50 * 10) / 10;
  const leadScore = Math.round(leadCorrect / 15 * 30 * 10) / 10;
  const persScore = likertTotal > 0
    ? Math.round((likertTotal - 15) / (75 - 15) * 20 * 10) / 10
    : 0;
  const overall   = Math.round((cogScore + leadScore + persScore) * 10) / 10;

  const cogLevel  = cogCorrect >= 27 ? '优秀' : cogCorrect >= 22 ? '良好' : cogCorrect >= 16 ? '中等' : '待提升';
  const leadLevel = leadCorrect >= 13 ? '优秀' : leadCorrect >= 10 ? '良好' : leadCorrect >= 6 ? '中等' : '待提升';
  const persLevel = likertTotal >= 60 ? '优秀' : likertTotal >= 48 ? '良好' : likertTotal >= 35 ? '中等' : '待提升';

  const subScores = {};
  for (const [dim, d] of Object.entries(subDim)) {
    if (d.total === 0) { subScores[dim] = 0; continue; }
    if (d.likertSum > 0) {
      subScores[dim] = Math.round((d.likertSum - d.total) / (d.total * 4) * 100);
    } else {
      subScores[dim] = Math.round(d.correct / d.total * 100);
    }
  }

  return { overall, cogScore, leadScore, persScore, cogLevel, leadLevel, persLevel,
           cogCorrect, leadCorrect, likertTotal, subScores };
}

// ── 路由处理 ──────────────────────────────────────────────────
async function handleRequest(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;
  const method   = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const db = await getDbAdapter();

  // ── GET /api/questions ────────────────────────────────────
  if (method === 'GET' && pathname === '/api/questions') {
    const shuffleEnabled = await getSetting(db, 'shuffle_questions') === 'true';
    const duration = parseInt(await getSetting(db, 'exam_duration_minutes') || '60');

    const questions = await db.query(
      `SELECT id,part,dimension,order_num,q_text,options,answer,q_type
       FROM questions WHERE enabled=1 ORDER BY part, order_num`
    );
    questions.forEach(q => { q.options = JSON.parse(q.options || '[]'); });

    let result = questions;
    if (shuffleEnabled) {
      const part1 = shuffle(result.filter(q => q.part === 1));
      const part2 = shuffle(result.filter(q => q.part === 2));
      const part3 = shuffle(result.filter(q => q.part === 3));
      result = [...part1, ...part2, ...part3];
    }

    // 不向考生暴露答案
    const safe = result.map(({ answer: _a, ...q }) => q);
    return json(res, 200, { questions: safe, duration, total: safe.length });
  }

  // ── POST /api/submit ──────────────────────────────────────
  if (method === 'POST' && pathname === '/api/submit') {
    const body = await parseBody(req);
    if (!body.name || !body.answers) {
      return json(res, 400, { error: '缺少必要参数: name, answers' });
    }

    const questions = await db.query(
      `SELECT id,part,dimension,q_text,options,answer,q_type FROM questions WHERE enabled=1`
    );

    const scores = calcScores(questions, body.answers);
    const recordId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // 写入 assessment_results 表（持久化）
    await db.run(
      `INSERT INTO assessment_results
        (id, name, timestamp, overall_score, cognitive_score, cognitive_level,
         leadership_score, leadership_level, personality_score, personality_level,
         cog_correct, lead_correct, likert_total,
         sub_scores, answers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [recordId, body.name, new Date().toISOString(),
       scores.overall, scores.cogScore, scores.cogLevel,
       scores.leadScore, scores.leadLevel, scores.persScore, scores.persLevel,
       scores.cogCorrect, scores.leadCorrect, scores.likertTotal,
       JSON.stringify(scores.subScores), JSON.stringify(body.answers)]
    );

    // 本地模式需要 flush
    await db.flush();

    console.log(`📝 提交: ${body.name} | 综合:${scores.overall} | 认知:${scores.cogScore}(${scores.cogLevel}) | 领导:${scores.leadScore}(${scores.leadLevel}) | 性格:${scores.persScore}(${scores.persLevel})`);
    return json(res, 200, { success: true });
  }

  // ── POST /api/admin/login ─────────────────────────────────
  if (method === 'POST' && pathname === '/api/admin/login') {
    const body = await parseBody(req);
    const rows = await db.query(
      `SELECT id, username, password_hash, role, display_name FROM admin_users WHERE username = ?`,
      [body.username || '']
    );

    if (!rows.length) return json(res, 401, { error: '用户名或密码错误' });
    const { id, username, password_hash, role, display_name } = rows[0];

    const ok = bcrypt.compareSync(body.password || '', password_hash);
    if (!ok) return json(res, 401, { error: '用户名或密码错误' });

    // 更新最后登录时间
    await db.run(`UPDATE admin_users SET last_login = datetime('now','localtime') WHERE id = ?`, [id]);
    await db.flush();

    const token = jwt.sign({ id, username, role, displayName: display_name }, JWT_SECRET, { expiresIn: '8h' });
    return json(res, 200, { token, role, username, displayName: display_name });
  }

  // ── 以下路由需要认证 ──────────────────────────────────────

  // GET /api/admin/stats
  if (method === 'GET' && pathname === '/api/admin/stats') {
    const payload = requireRole(req, res, ['super', 'exam_admin', 'readonly']);
    if (!payload) return;

    const records = await getRecords(db);

    const total = records.length;
    const avgOverall  = total ? Math.round(records.reduce((s,r) => s + (r.overall||0), 0) / total * 10) / 10 : 0;
    const avgCog      = total ? Math.round(records.reduce((s,r) => s + (r.cogScore||0), 0) / total * 10) / 10 : 0;
    const avgLead     = total ? Math.round(records.reduce((s,r) => s + (r.leadScore||0), 0) / total * 10) / 10 : 0;
    const avgPers     = total ? Math.round(records.reduce((s,r) => s + (r.persScore||0), 0) / total * 10) / 10 : 0;
    const excellent   = records.filter(r => r.overall >= 80).length;

    // 子维度均分
    const subDimSums = {};
    const subDimCounts = {};
    for (const r of records) {
      if (r.subScores) {
        for (const [dim, score] of Object.entries(r.subScores)) {
          subDimSums[dim] = (subDimSums[dim] || 0) + score;
          subDimCounts[dim] = (subDimCounts[dim] || 0) + 1;
        }
      }
    }
    const subDimAvg = {};
    for (const dim of Object.keys(subDimSums)) {
      subDimAvg[dim] = Math.round(subDimSums[dim] / subDimCounts[dim]);
    }

    return json(res, 200, { total, avgOverall, avgCog, avgLead, avgPers, excellent, subDimAvg });
  }

  // GET /api/admin/records
  if (method === 'GET' && pathname === '/api/admin/records') {
    const payload = requireRole(req, res, ['super', 'exam_admin', 'readonly']);
    if (!payload) return;

    let records = await getRecords(db);

    // readonly 不返回姓名和详细答题
    if (payload.role === 'readonly') {
      records = records.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        overall: r.overall,
        cogScore: r.cogScore, cogLevel: r.cogLevel,
        leadScore: r.leadScore, leadLevel: r.leadLevel,
        persScore: r.persScore, persLevel: r.persLevel,
        subScores: r.subScores,
      }));
    }

    return json(res, 200, { records });
  }

  // GET /api/admin/export  → CSV/JSON
  if (method === 'GET' && pathname === '/api/admin/export') {
    const payload = requireRole(req, res, ['super', 'exam_admin']);
    if (!payload) return;

    const records = await getRecords(db);
    const format = u.searchParams.get('format') || 'csv';
    const type = u.searchParams.get('type') || 'detail'; // summary | detail
    const dateStr = new Date().toISOString().slice(0,10);

    if (format === 'json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="assessment_${dateStr}.json"`,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(JSON.stringify(records, null, 2));
    }

    // 加载题目信息用于明细导出
    let questions = [];
    if (type === 'detail') {
      const qRows = await db.query(
        `SELECT id, part, dimension, order_num, q_text, options, answer, q_type FROM questions WHERE enabled = 1 ORDER BY part, order_num`
      );
      qRows.forEach(q => { q.options = JSON.parse(q.options || '[]'); });
      questions = qRows;
    }

    if (type === 'summary') {
      // 汇总表
      const header = '姓名,综合得分,认知得分,认知等级,领导得分,领导等级,性格得分,性格等级,认知正确数,领导正确数,Likert总分,提交时间';
      const csvRows = records.map(r =>
        [r.name||'', r.overall||0, r.cogScore||0, r.cogLevel||'',
         r.leadScore||0, r.leadLevel||'', r.persScore||0, r.persLevel||'',
         r.cogCorrect||0, r.leadCorrect||0, r.likertTotal||0,
         new Date(r.timestamp).toLocaleString('zh-CN')].join(',')
      );
      const csv = '\uFEFF' + header + '\n' + csvRows.join('\n');

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="assessment_summary_${dateStr}.csv"`,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(csv);
    }

    // 逐题明细表（默认）
    const qMap = {};
    questions.forEach(q => { qMap[q.id] = q; });

    const detailHeader = '姓名,综合得分,题号,维度,题型,题目内容,正确答案,考生答案,是否正确,Likert得分,提交时间';
    const detailRows = [];
    for (const r of records) {
      const ans = r.answers || {};
      for (const q of questions) {
        const userAns = ans[q.id] || '';
        let correct = '', likertScore = '';
        if (q.q_type === 'likert') {
          likertScore = userAns;
          correct = '-';
        } else {
          correct = userAns === q.answer ? '✓' : '✗';
        }
        // 简化题目内容（去换行）
        const qText = (q.q_text || '').replace(/[\r\n]+/g, ' ');
        const correctOpt = q.q_type === 'likert' ? '-' : (q.answer || '');
        detailRows.push([
          r.name||'', r.overall||0,
          `${q.part}-${String(q.order_num||0).padStart(2,'0')}`,
          q.dimension, q.q_type === 'likert' ? '量表' : (q.q_type === 'mc' ? '选择' : q.q_type),
          qText, correctOpt, userAns, correct, likertScore,
          new Date(r.timestamp).toLocaleString('zh-CN')
        ].join(','));
      }
    }
    const csv = '\uFEFF' + detailHeader + '\n' + detailRows.join('\n');

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="assessment_detail_${dateStr}.csv"`,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(csv);
  }

  // ── 题库管理 ──────────────────────────────────────────────
  if (pathname === '/api/admin/questions') {
    if (method === 'GET') {
      const payload = requireRole(req, res, ['super', 'exam_admin', 'readonly']);
      if (!payload) return;

      const partFilter = u.searchParams.get('part');
      const dimFilter  = u.searchParams.get('dimension');
      let sql = `SELECT id,part,dimension,order_num,q_text,options,answer,q_type,enabled,created_at,updated_at FROM questions`;
      const params = [];
      const conditions = [];
      if (partFilter) { conditions.push('part = ?'); params.push(parseInt(partFilter)); }
      if (dimFilter)  { conditions.push('dimension = ?'); params.push(dimFilter); }
      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY part, order_num';

      const questions = await db.query(sql, params);
      questions.forEach(q => { q.options = JSON.parse(q.options || '[]'); });
      return json(res, 200, { questions });
    }

    if (method === 'POST') {
      const payload = requireRole(req, res, ['super']);
      if (!payload) return;
      const body = await parseBody(req);
      const { part, dimension, order_num, q_text, options, answer, q_type } = body;
      if (!part || !dimension || !q_text || !q_type) {
        return json(res, 400, { error: '缺少必填字段: part, dimension, q_text, q_type' });
      }
      await db.run(
        `INSERT INTO questions (part,dimension,order_num,q_text,options,answer,q_type) VALUES (?,?,?,?,?,?,?)`,
        [part, dimension, order_num||999, q_text, JSON.stringify(options||[]), answer||'', q_type]
      );
      await db.flush();
      return json(res, 200, { success: true, message: '题目已添加' });
    }
  }

  // PUT/DELETE /api/admin/questions/:id
  const qMatch = pathname.match(/^\/api\/admin\/questions\/(\d+)$/);
  if (qMatch) {
    const qid = parseInt(qMatch[1]);
    if (method === 'PUT') {
      const payload = requireRole(req, res, ['super']);
      if (!payload) return;
      const body = await parseBody(req);
      const fields = [];
      const vals   = [];
      const allowed = ['part','dimension','order_num','q_text','options','answer','q_type','enabled'];
      for (const k of allowed) {
        if (body[k] !== undefined) {
          fields.push(`${k} = ?`);
          vals.push(k === 'options' ? JSON.stringify(body[k]) : body[k]);
        }
      }
      if (!fields.length) return json(res, 400, { error: '没有可更新的字段' });
      fields.push(`updated_at = datetime('now','localtime')`);
      vals.push(qid);
      await db.run(`UPDATE questions SET ${fields.join(', ')} WHERE id = ?`, vals);
      await db.flush();
      return json(res, 200, { success: true, message: '题目已更新' });
    }
    if (method === 'DELETE') {
      const payload = requireRole(req, res, ['super']);
      if (!payload) return;
      await db.run(`UPDATE questions SET enabled = 0, updated_at = datetime('now','localtime') WHERE id = ?`, [qid]);
      await db.flush();
      return json(res, 200, { success: true, message: '题目已禁用' });
    }
  }

  // ── 账号管理（super only）────────────────────────────────
  if (pathname === '/api/admin/users') {
    if (method === 'GET') {
      const payload = requireRole(req, res, ['super']);
      if (!payload) return;
      const users = await db.query(
        `SELECT id, username, role, display_name, created_at, last_login FROM admin_users ORDER BY id`
      );
      return json(res, 200, { users });
    }
    if (method === 'POST') {
      const payload = requireRole(req, res, ['super']);
      if (!payload) return;
      const body = await parseBody(req);
      if (!body.username || !body.password || !body.role) {
        return json(res, 400, { error: '缺少: username, password, role' });
      }
      const hash = bcrypt.hashSync(body.password, 10);
      try {
        await db.run(
          `INSERT INTO admin_users (username, password_hash, role, display_name) VALUES (?,?,?,?)`,
          [body.username, hash, body.role, body.display_name || body.username]
        );
        await db.flush();
        return json(res, 200, { success: true });
      } catch (e) {
        return json(res, 400, { error: '用户名已存在' });
      }
    }
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userMatch) {
    const uid = parseInt(userMatch[1]);
    if (method === 'PUT') {
      const payload = requireRole(req, res, ['super']);
      if (!payload) return;
      const body = await parseBody(req);
      const fields = [], vals = [];
      if (body.role)         { fields.push('role = ?'); vals.push(body.role); }
      if (body.display_name) { fields.push('display_name = ?'); vals.push(body.display_name); }
      if (body.password)     { fields.push('password_hash = ?'); vals.push(bcrypt.hashSync(body.password, 10)); }
      if (!fields.length) return json(res, 400, { error: '无可更新字段' });
      vals.push(uid);
      await db.run(`UPDATE admin_users SET ${fields.join(', ')} WHERE id = ?`, vals);
      await db.flush();
      return json(res, 200, { success: true });
    }
    if (method === 'DELETE') {
      const payload = requireRole(req, res, ['super']);
      if (!payload) return;
      if (payload.id === uid) return json(res, 400, { error: '不能删除自己' });
      await db.run(`DELETE FROM admin_users WHERE id = ?`, [uid]);
      await db.flush();
      return json(res, 200, { success: true });
    }
  }

  // ── 系统设置 ─────────────────────────────────────────────
  if (pathname === '/api/admin/settings') {
    if (method === 'GET') {
      const payload = requireRole(req, res, ['super', 'exam_admin', 'readonly']);
      if (!payload) return;
      const rows = await db.query(`SELECT key, value FROM app_settings`);
      const settings = {};
      for (const r of rows) {
        settings[r.key] = r.value;
      }
      return json(res, 200, { settings });
    }
    if (method === 'PUT') {
      const payload = requireRole(req, res, ['super']);
      if (!payload) return;
      const body = await parseBody(req);
      for (const [k, v] of Object.entries(body)) {
        await db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`, [k, String(v)]);
      }
      await db.flush();
      return json(res, 200, { success: true });
    }
  }

  // ── 静态文件（仅本地模式）────────────────────────────────
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
  };

  const CLIENT_DIR = path.join(__dirname, '..', 'client', 'public');

  let filePath;
  if (pathname === '/' || pathname === '') {
    filePath = path.join(CLIENT_DIR, 'index.html');
  } else if (pathname === '/admin' || pathname === '/admin/') {
    filePath = path.join(CLIENT_DIR, 'admin.html');
  } else {
    filePath = path.join(CLIENT_DIR, pathname.slice(1));
  }

  const ext = path.extname(filePath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    return res.end(fs.readFileSync(filePath));
  }

  return json(res, 404, { error: 'Not Found' });
}

// ── 导出（供 Vercel Serverless 使用）───────────────────────────
module.exports = { handleRequest };

// ── 启动服务（仅本地运行时）───────────────────────────────────
if (require.main === module) {
const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (e) {
    console.error('❌ 服务器错误:', e.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '服务器内部错误', detail: e.message }));
    }
  }
});

server.listen(PORT, async () => {
  console.log('============================================================');
  console.log('  🏢 管培生综合评估系统 - 已启动');
  console.log('============================================================');
  console.log(`  考生入口:   http://localhost:${PORT}`);
  console.log(`  管理后台:   http://localhost:${PORT}/admin`);
  console.log('');
  console.log('  管理账号:');
  console.log('    超级管理员: admin / admin123');
  console.log('    考务管理员: examadmin / exam123');
  console.log('    只读用户:   viewer / read123');
  console.log('============================================================');

  // 自动内网穿透
  startTunnel();
});

function startTunnel() {
  try {
    const lt = require('localtunnel');
    lt(PORT, {}).then(tunnel => {
      console.log('');
      console.log('============================================================');
      console.log('  🌐 公网访问地址（可发给考生）:');
      console.log('  ' + tunnel.url);
      console.log('  管理后台: ' + tunnel.url + '/admin');
      console.log('============================================================');
      tunnel.on('close', () => { console.log('⚠️ 隧道断开，10s后重连...'); setTimeout(startTunnel, 10000); });
      tunnel.on('error', () => { setTimeout(startTunnel, 10000); });
    }).catch(() => { setTimeout(startTunnel, 10000); });
  } catch {
    console.log('⚠️ localtunnel 未安装，运行: npm install localtunnel');
  }
}
} // end require.main === module
