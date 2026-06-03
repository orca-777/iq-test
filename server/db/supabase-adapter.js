/**
 * Supabase REST API Adapter
 * Uses @supabase/supabase-js for all database operations
 * Works entirely through REST API - no PostgreSQL direct connection needed
 */
const { createClient } = require('@supabase/supabase-js');

class SupabaseAdapter {
  constructor(url, key) {
    this.client = createClient(url, key, {
      auth: { persistSession: false },
    });
    this.url = url;
  }

  /**
   * Execute a SQL query via exec_sql RPC function
   * Returns array of rows
   */
  async query(sql, params = []) {
    // Parameterize the query
    let finalSql = sql;
    for (let i = 0; i < params.length; i++) {
      const val = params[i];
      if (typeof val === 'number') {
        finalSql = finalSql.replace('?', String(val));
      } else if (typeof val === 'string') {
        finalSql = finalSql.replace('?', `'${val.replace(/'/g, "''")}'`);
      } else if (val === null || val === undefined) {
        finalSql = finalSql.replace('?', 'NULL');
      } else {
        finalSql = finalSql.replace('?', String(val));
      }
    }

    const { data, error } = await this.client.rpc('exec_sql', {
      query_string: finalSql
    });

    if (error) {
      // Try direct REST API as fallback for simple queries
      if (sql.trim().toUpperCase().startsWith('SELECT') && sql.toUpperCase().includes('FROM')) {
        return await this._selectViaRest(sql);
      }
      throw new Error(`Supabase query failed: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Execute a write SQL query
   */
  async run(sql, params = []) {
    return await this.query(sql, params);
  }

  /**
   * Execute multiple SQL statements
   */
  async execScript(sql) {
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^(--|\/\*)/));

    const results = [];
    for (const stmt of statements) {
      try {
        const result = await this.client.rpc('exec_sql', {
          query_string: stmt
        });
        results.push(result.data);
      } catch (e) {
        results.push({ error: e.message });
      }
    }
    return results;
  }

  flush() {
    // No-op for REST API (stateless)
  }

  /**
   * Fallback SELECT via REST API
   */
  async _selectViaRest(sql) {
    // Extract table name and conditions from simple SELECT queries
    const match = sql.match(/FROM\s+(\w+)/i);
    if (!match) return [];

    const table = match[1];
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+|\s+LIMIT\s+|\s+GROUP\s+|$)/is);
    
    let query = this.client.from(table).select('*');
    
    if (whereMatch) {
      const conditions = whereMatch[1].trim();
      // Parse simple equality conditions
      const eqMatches = conditions.match(/(\w+)\s*=\s*'?([^']*)'?/g);
      if (eqMatches) {
        for (const cond of eqMatches) {
          const parts = cond.match(/(\w+)\s*=\s*'?([^']*)'?/);
          if (parts) {
            query = query.eq(parts[1], parts[2]);
          }
        }
      }
    }

    // Handle ORDER BY
    const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)(\s+(ASC|DESC))?/i);
    if (orderMatch) {
      query = query.order(orderMatch[1], { ascending: (orderMatch[3] || 'ASC').toUpperCase() === 'ASC' });
    }

    // Handle LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      query = query.limit(parseInt(limitMatch[1]));
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Direct REST API helpers for common operations
   */
  async selectAll(table) {
    const { data, error } = await this.client.from(table).select('*');
    if (error) throw error;
    return data;
  }

  async insertRow(table, row) {
    const { data, error } = await this.client.from(table).insert(row).select();
    if (error) throw error;
    return data;
  }

  async updateRow(table, idCol, id, updates) {
    const { data, error } = await this.client.from(table).update(updates).eq(idCol, id).select();
    if (error) throw error;
    return data;
  }
}

module.exports = { SupabaseAdapter };
