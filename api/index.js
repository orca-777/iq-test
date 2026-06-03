/**
 * Vercel Serverless Function - IQ Assessment System API
 *
 * Supports: Supabase (REST API) | Turso | Local SQLite
 * Auto-detects database backend via environment variables
 */

const { handleRequest } = require('../server/server');

module.exports = async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('API Error:', err.message);
    console.error(err.stack);

    const dbType = (() => {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) return 'supabase';
      if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) return 'turso';
      return 'local_sqlite';
    })();

    const diag = {
      error: 'Server internal error',
      detail: err.message,
      db_type: dbType,
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
