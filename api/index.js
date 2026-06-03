/**
 * Vercel Serverless Function - 管培生综合评估系统
 *
 * 数据存储: Turso 云端 SQLite（持久化）
 * 通过 TURSO_DATABASE_URL + TURSO_AUTH_TOKEN 环境变量连接
 *
 * 环境变量（在 Vercel 控制台设置）:
 *   TURSO_DATABASE_URL  - Turso 数据库 URL (libsql://xxx)
 *   TURSO_AUTH_TOKEN     - Turso 认证 token
 */

// 导入 server.js 中的 handleRequest
// server.js 会通过 getDbAdapter() 自动检测 Turso 环境变量
const { handleRequest } = require('../server/server');

module.exports = async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    // 捕获所有未处理异常，避免 Vercel 黑盒 FUNCTION_INVOCATION_FAILED
    console.error('❌ API Error:', err.message);
    console.error(err.stack);

    // 构造诊断信息
    const isTurso = !!process.env.TURSO_DATABASE_URL;
    const hasToken = !!process.env.TURSO_AUTH_TOKEN;
    const diag = {
      error: '服务器内部错误',
      detail: err.message,
      diag: {
        env_turso_url_set: isTurso,
        env_token_set: hasToken,
        mode: isTurso && hasToken ? 'turso' : 'local_sqlite',
        hint: !isTurso || !hasToken
          ? '请在 Vercel 控制台设置 TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN 环境变量'
          : 'Turso 连接异常，请检查数据库 URL 和 Token 是否正确',
      },
    };

    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(diag));
    }
  }
};
