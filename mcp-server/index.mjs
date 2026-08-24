/**
 * MAS Callnet HRMS — MCP Server
 * Exposes mas_hrms as read-only Claude tools with role-based access and PII masking.
 *
 * Setup: copy this folder, run `npm install`, fill in .env, add to .mcp.json
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BLOCKED_TABLES, PII_COLUMNS, getAllowedTables, VALID_ROLES } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const paths = [
    resolve(__dirname, '.env'),
    resolve(__dirname, '../backend/.env'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
    break;
  }
}
loadEnv();

const DB_HOST     = process.env.DB_HOST     || '192.168.10.6';
const DB_PORT     = parseInt(process.env.DB_PORT || '3306');
const DB_USER     = process.env.DB_USER     || '';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME     = process.env.DB_NAME     || 'mas_hrms';
const ROLE        = (process.env.HRMS_ROLE  || 'viewer').toLowerCase();

if (!DB_USER || !DB_PASSWORD) {
  process.stderr.write('[hrms-mcp] ERROR: DB_USER and DB_PASSWORD must be set in .env\n');
  process.exit(1);
}
if (!VALID_ROLES.includes(ROLE)) {
  process.stderr.write(`[hrms-mcp] ERROR: HRMS_ROLE="${ROLE}" is invalid. Use: ${VALID_ROLES.join(', ')}\n`);
  process.exit(1);
}

const ALLOWED = getAllowedTables(ROLE);

const pool = mysql.createPool({
  host: DB_HOST, port: DB_PORT,
  user: DB_USER, password: DB_PASSWORD,
  database: DB_NAME,
  connectionLimit: 3,
  timezone: '+05:30',
  dateStrings: true,
  decimalNumbers: true,
});

process.stderr.write(`[hrms-mcp] Connected → ${DB_HOST}:${DB_PORT}/${DB_NAME} | role=${ROLE} | allowed_tables=${ALLOWED.size}\n`);

// ── Security helpers ─────────────────────────────────────────────────────────
function isSafeQuery(sql) {
  return /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(sql);
}

function withLimit(sql, limit = 100) {
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  const s = sql.trim().replace(/;\s*$/, '');
  return /\bLIMIT\b/i.test(s) ? s : `${s} LIMIT ${cap}`;
}

// Extract table names from SQL (simple heuristic — enough for allowlist check)
function extractTables(sql) {
  const tables = [];
  const re = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+`?([a-zA-Z0-9_]+)`?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) tables.push(m[1].toLowerCase());
  return tables;
}

function checkTableAccess(sql) {
  const tables = extractTables(sql);
  for (const t of tables) {
    if (BLOCKED_TABLES.has(t)) return { ok: false, reason: `Table "${t}" is blocked (payroll/PII)` };
    if (!ALLOWED.has(t) && !/^(information_schema|performance_schema)$/i.test(t)) {
      // Allow SHOW/DESCRIBE without table allowlist check
      if (/^\s*(SHOW|DESCRIBE|DESC)\b/i.test(sql)) continue;
      return { ok: false, reason: `Table "${t}" is not accessible for role="${ROLE}". Use list_allowed_tables to see what's available.` };
    }
  }
  return { ok: true };
}

// Mask PII columns in result rows
function maskPII(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = PII_COLUMNS.has(k.toLowerCase()) ? '***' : v;
    }
    return out;
  });
}

// ── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'query_hrms',
    description:
      'Run a read-only SQL SELECT query against mas_hrms. ' +
      'Blocked tables (payroll/PII) are rejected. PII columns are automatically masked. ' +
      'Auto-appends LIMIT 100 if not specified (max 500 rows).',
    inputSchema: {
      type: 'object',
      properties: {
        sql:   { type: 'string', description: 'SQL query — SELECT / SHOW / DESCRIBE only' },
        limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'list_allowed_tables',
    description: `List every table accessible for the current role (${ROLE}). Shows which tables can be queried.`,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_table',
    description: 'Return column names, types, and key info for an allowed mas_hrms table.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
      },
      required: ['table'],
    },
  },
  {
    name: 'get_hrms_stats',
    description: 'Live CEO/management snapshot: headcount, attendance today, ATS pipeline, pending leave.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_employees',
    description: 'Search employees by name or employee code. PII columns are masked.',
    inputSchema: {
      type: 'object',
      properties: {
        q:      { type: 'string', description: 'Name or employee code to search' },
        status: { type: 'string', description: 'Filter: Active | inactive | Resigned | terminated' },
        limit:  { type: 'number', description: 'Max results (default 50, max 200)' },
      },
    },
  },
  {
    name: 'get_dashboard_data',
    description:
      'Returns a complete JSON dataset for building dashboards: ' +
      'workforce summary, branch headcount, monthly joiners/exits, ' +
      'attendance trend (30d), ATS pipeline stages, leave pending by type, ' +
      'and top processes. One call builds a full CEO analytics dashboard.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_role_info',
    description: 'Show the current access role, allowed table count, and what each role can access.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Server ────────────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'hrms-db', version: '2.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const ok  = (t) => ({ content: [{ type: 'text', text: String(t) }] });
  const err = (t) => ({ content: [{ type: 'text', text: `❌ ${t}` }], isError: true });

  try {

    // ── get_role_info ──────────────────────────────────────────────────────
    if (name === 'get_role_info') {
      const info = {
        current_role: ROLE,
        allowed_tables: ALLOWED.size,
        db_host: DB_HOST,
        db_name: DB_NAME,
        roles: {
          viewer:      'Org structure + headcount only',
          hr:          'viewer + attendance, leave, balances',
          recruitment: 'hr + full ATS candidate pipeline',
          management:  'recruitment + KPI + process performance + WFM',
          finance:     'management + P&L cost/revenue components',
          full:        'Everything above (no payroll/statutory ever)',
        },
        pii_columns_masked: [...PII_COLUMNS].join(', '),
        payroll_tables_blocked: 'Always — regardless of role',
      };
      return ok(JSON.stringify(info, null, 2));
    }

    // ── list_allowed_tables ────────────────────────────────────────────────
    if (name === 'list_allowed_tables') {
      const tables = [...ALLOWED].sort();
      return ok(`Allowed tables for role="${ROLE}" (${tables.length}):\n${tables.join('\n')}`);
    }

    // ── describe_table ─────────────────────────────────────────────────────
    if (name === 'describe_table') {
      const table = String(args.table || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (!table) return err('table name is required');
      if (BLOCKED_TABLES.has(table)) return err(`Table "${table}" is blocked`);
      const [rows] = await pool.query(`DESCRIBE \`${table}\``);
      const lines = rows.map(r =>
        `${PII_COLUMNS.has(r.Field) ? r.Field + ' [MASKED]' : r.Field} | ${r.Type} | ${r.Null} | ${r.Key}`
      );
      return ok(['Field | Type | Null | Key', ...lines].join('\n'));
    }

    // ── query_hrms ─────────────────────────────────────────────────────────
    if (name === 'query_hrms') {
      const sql = String(args.sql || '').trim();
      if (!sql) return err('sql is required');
      if (!isSafeQuery(sql)) return err('Only SELECT / SHOW / DESCRIBE / EXPLAIN queries are allowed');
      const check = checkTableAccess(sql);
      if (!check.ok) return err(check.reason);
      const [rows] = await pool.query(withLimit(sql, args.limit));
      return ok(JSON.stringify(maskPII(Array.isArray(rows) ? rows : [rows]), null, 2));
    }

    // ── get_hrms_stats ─────────────────────────────────────────────────────
    if (name === 'get_hrms_stats') {
      const settled = await Promise.allSettled([
        pool.query('SELECT COUNT(*) AS n FROM employees'),
        pool.query("SELECT COUNT(*) AS n FROM employees WHERE employment_status='Active'"),
        pool.query('SELECT COUNT(*) AS n FROM ats_candidate'),
        pool.query('SELECT COUNT(*) AS n FROM attendance_daily_record WHERE record_date=CURDATE()'),
        pool.query("SELECT COUNT(*) AS n FROM leave_request WHERE status='Pending'"),
        pool.query("SELECT COUNT(*) AS n FROM employees WHERE MONTH(date_of_joining)=MONTH(CURDATE()) AND YEAR(date_of_joining)=YEAR(CURDATE())"),
        pool.query("SELECT COUNT(*) AS n FROM employees WHERE date_of_exit IS NOT NULL AND MONTH(date_of_exit)=MONTH(CURDATE()) AND YEAR(date_of_exit)=YEAR(CURDATE())"),
      ]);
      const v = (r) => r.status === 'fulfilled' ? Number(r.value[0][0].n) : 'N/A';
      const stats = {
        total_workforce:       v(settled[0]),
        active_employees:      v(settled[1]),
        ats_total_candidates:  v(settled[2]),
        attendance_today:      v(settled[3]),
        pending_leave:         v(settled[4]),
        new_joiners_this_month: v(settled[5]),
        exits_this_month:      v(settled[6]),
        data_as_of:            new Date().toISOString().split('T')[0],
      };
      return ok(JSON.stringify(stats, null, 2));
    }

    // ── search_employees ───────────────────────────────────────────────────
    if (name === 'search_employees') {
      const q      = String(args.q || '').trim();
      const status = String(args.status || '').trim();
      const limit  = Math.min(Number(args.limit) || 50, 200);
      const conds  = [];
      const params = [];
      if (q) {
        conds.push('(employee_code LIKE ? OR full_name LIKE ? OR CONCAT(first_name," ",last_name) LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like);
      }
      if (status) { conds.push('employment_status=?'); params.push(status); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT id, employee_code, full_name, date_of_joining, employment_status, branch_id, process_id, designation_id ` +
        `FROM employees ${where} ORDER BY employee_code LIMIT ${limit}`,
        params
      );
      return ok(JSON.stringify(maskPII(rows), null, 2));
    }

    // ── get_dashboard_data ─────────────────────────────────────────────────
    if (name === 'get_dashboard_data') {
      const results = await Promise.allSettled([
        // 0: workforce summary
        pool.query(
          "SELECT COUNT(*) as total," +
          " SUM(CASE WHEN employment_status='Active' THEN 1 ELSE 0 END) as active_count," +
          " SUM(CASE WHEN employment_status='inactive' THEN 1 ELSE 0 END) as inactive_count," +
          " SUM(CASE WHEN employment_status='Resigned' THEN 1 ELSE 0 END) as resigned_count," +
          " SUM(CASE WHEN employment_status='terminated' THEN 1 ELSE 0 END) as term_count" +
          " FROM employees"
        ),
        // 1: branch headcount top 15
        pool.query(
          "SELECT b.branch_name, COUNT(e.id) as total," +
          " SUM(CASE WHEN e.employment_status='Active' THEN 1 ELSE 0 END) as active" +
          " FROM employees e JOIN branch_master b ON e.branch_id=b.id" +
          " GROUP BY b.id,b.branch_name ORDER BY total DESC LIMIT 15"
        ),
        // 2: monthly joiners last 12 months
        pool.query(
          "SELECT DATE_FORMAT(date_of_joining,'%Y-%m') as month, COUNT(*) as joiners" +
          " FROM employees WHERE date_of_joining>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH)" +
          " GROUP BY month ORDER BY month"
        ),
        // 3: monthly exits last 12 months
        pool.query(
          "SELECT DATE_FORMAT(date_of_exit,'%Y-%m') as month, COUNT(*) as exits" +
          " FROM employees WHERE date_of_exit>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH)" +
          " AND date_of_exit IS NOT NULL GROUP BY month ORDER BY month"
        ),
        // 4: ATS pipeline stages
        pool.query(
          "SELECT current_stage as stage, COUNT(*) as count FROM ats_candidate" +
          " GROUP BY current_stage ORDER BY count DESC LIMIT 12"
        ),
        // 5: ATS monthly last 6 months
        pool.query(
          "SELECT DATE_FORMAT(created_at,'%Y-%m') as month, COUNT(*) as applications" +
          " FROM ats_candidate WHERE created_at>=DATE_SUB(CURDATE(),INTERVAL 6 MONTH)" +
          " GROUP BY month ORDER BY month"
        ),
        // 6: attendance last 30 days
        pool.query(
          "SELECT record_date, COUNT(*) as present FROM attendance_daily_record" +
          " WHERE record_date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY)" +
          " GROUP BY record_date ORDER BY record_date"
        ),
        // 7: leave pending by type
        pool.query(
          "SELECT lt.leave_name, COUNT(lr.id) as count" +
          " FROM leave_request lr JOIN leave_type_master lt ON lr.leave_type_id=lt.id" +
          " WHERE lr.status='Pending' GROUP BY lt.id,lt.leave_name ORDER BY count DESC"
        ),
        // 8: process headcount top 10
        pool.query(
          "SELECT p.process_name, COUNT(e.id) as total," +
          " SUM(CASE WHEN e.employment_status='Active' THEN 1 ELSE 0 END) as active" +
          " FROM employees e JOIN process_master p ON e.process_id=p.id" +
          " GROUP BY p.id,p.process_name ORDER BY total DESC LIMIT 10"
        ),
        // 9: today stats
        pool.query("SELECT COUNT(*) AS n FROM attendance_daily_record WHERE record_date=CURDATE()"),
      ]);

      const get = (i) => results[i].status === 'fulfilled' ? results[i].value[0] : [];

      const data = {
        generated_at:       new Date().toISOString(),
        workforce:          get(0)[0] || {},
        branches:           get(1),
        monthly_joiners:    get(2),
        monthly_exits:      get(3),
        ats_pipeline:       get(4),
        ats_monthly:        get(5),
        attendance_30d:     get(6),
        leave_pending:      get(7),
        processes:          get(8),
        today_attendance:   Number(get(9)[0]?.n || 0),
      };

      return ok(JSON.stringify(data, null, 2));
    }

    return err(`Unknown tool: ${name}`);

  } catch (ex) {
    process.stderr.write(`[hrms-mcp] Error in ${name}: ${ex.message}\n`);
    return err(`Database error: ${ex.message}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
