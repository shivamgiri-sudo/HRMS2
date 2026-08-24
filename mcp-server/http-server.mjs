/**
 * HRMS MCP Server — HTTP/Streamable mode
 *
 * Run this on the production server so anyone with Claude Code
 * can connect with just a URL — no Node.js install required on their machine.
 *
 * Usage:
 *   node http-server.mjs
 *
 * Environment variables (add to your .env):
 *   HTTP_PORT=3099          (default 3099)
 *   MCP_TOKEN=your_secret   (required — share this token with users)
 *   HRMS_ROLE=full          (role for all HTTP clients)
 *
 * User's .mcp.json:
 *   {
 *     "mcpServers": {
 *       "hrms-db": {
 *         "url": "http://192.168.10.6:3099/mcp",
 *         "headers": { "Authorization": "Bearer YOUR_TOKEN" }
 *       }
 *     }
 *   }
 */

import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BLOCKED_TABLES, PII_COLUMNS, getAllowedTables, VALID_ROLES } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const DB_HOST     = process.env.DB_HOST     || '192.168.10.6';
const DB_PORT     = parseInt(process.env.DB_PORT || '3306');
const DB_USER     = process.env.DB_USER     || '';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME     = process.env.DB_NAME     || 'mas_hrms';
const ROLE        = (process.env.HRMS_ROLE  || 'full').toLowerCase();
const HTTP_PORT   = parseInt(process.env.HTTP_PORT || '3099');
const MCP_TOKEN   = process.env.MCP_TOKEN   || '';

if (!DB_USER || !DB_PASSWORD) { console.error('DB_USER and DB_PASSWORD required in .env'); process.exit(1); }
if (!MCP_TOKEN) { console.error('MCP_TOKEN required in .env — set a secret token to share with users'); process.exit(1); }

const ALLOWED = getAllowedTables(ROLE);

const pool = mysql.createPool({
  host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD,
  database: DB_NAME, connectionLimit: 10, timezone: '+05:30',
  dateStrings: true, decimalNumbers: true,
});

// ── Security helpers (same as stdio server) ──────────────────────────────────
function isSafeQuery(sql) { return /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(sql); }
function withLimit(sql, limit = 100) {
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  const s = sql.trim().replace(/;\s*$/, '');
  return /\bLIMIT\b/i.test(s) ? s : `${s} LIMIT ${cap}`;
}
function extractTables(sql) {
  const tables = []; const re = /\b(?:FROM|JOIN)\s+`?([a-zA-Z0-9_]+)`?/gi; let m;
  while ((m = re.exec(sql)) !== null) tables.push(m[1].toLowerCase());
  return tables;
}
function checkTableAccess(sql) {
  for (const t of extractTables(sql)) {
    if (BLOCKED_TABLES.has(t)) return { ok:false, reason:`Table "${t}" is blocked (payroll/PII)` };
    if (!ALLOWED.has(t) && !/^\s*(SHOW|DESCRIBE|DESC)\b/i.test(sql))
      return { ok:false, reason:`Table "${t}" not accessible for role="${ROLE}"` };
  }
  return { ok:true };
}
function maskPII(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => {
    const out = {};
    for (const [k,v] of Object.entries(row)) out[k] = PII_COLUMNS.has(k.toLowerCase()) ? '***' : v;
    return out;
  });
}

// ── Build MCP server (reused logic — same tools as stdio) ────────────────────
function buildMcpServer() {
  const server = new Server({ name:'hrms-db-http', version:'2.0.0' }, { capabilities:{ tools:{} } });

  const TOOLS = [
    { name:'query_hrms', description:'Read-only SQL against mas_hrms. PII auto-masked.',
      inputSchema:{ type:'object', properties:{ sql:{type:'string'}, limit:{type:'number'} }, required:['sql'] } },
    { name:'list_allowed_tables', description:`Tables accessible for role=${ROLE}.`,
      inputSchema:{ type:'object', properties:{} } },
    { name:'describe_table', description:'Column schema for a table.',
      inputSchema:{ type:'object', properties:{ table:{type:'string'} }, required:['table'] } },
    { name:'get_hrms_stats', description:'Live CEO snapshot: headcount, attendance, ATS, leave.',
      inputSchema:{ type:'object', properties:{} } },
    { name:'search_employees', description:'Find employees by name or code.',
      inputSchema:{ type:'object', properties:{ q:{type:'string'}, status:{type:'string'}, limit:{type:'number'} } } },
    { name:'get_dashboard_data', description:'Full dataset for CEO analytics dashboard in one call.',
      inputSchema:{ type:'object', properties:{} } },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const ok  = t => ({ content:[{ type:'text', text:String(t) }] });
    const err = t => ({ content:[{ type:'text', text:`❌ ${t}` }], isError:true });
    try {
      if (name === 'list_allowed_tables') {
        return ok(`Allowed tables for role="${ROLE}" (${ALLOWED.size}):\n${[...ALLOWED].sort().join('\n')}`);
      }
      if (name === 'describe_table') {
        const table = String(args.table||'').replace(/[^a-zA-Z0-9_]/g,'');
        if (!table) return err('table required');
        if (BLOCKED_TABLES.has(table)) return err(`Table "${table}" is blocked`);
        const [rows] = await pool.query(`DESCRIBE \`${table}\``);
        return ok(['Field | Type | Null | Key', ...rows.map(r=>`${PII_COLUMNS.has(r.Field)?r.Field+' [MASKED]':r.Field} | ${r.Type} | ${r.Null} | ${r.Key}`)].join('\n'));
      }
      if (name === 'query_hrms') {
        const sql = String(args.sql||'').trim();
        if (!isSafeQuery(sql)) return err('Only SELECT/SHOW/DESCRIBE allowed');
        const chk = checkTableAccess(sql); if (!chk.ok) return err(chk.reason);
        const [rows] = await pool.query(withLimit(sql, args.limit));
        return ok(JSON.stringify(maskPII(Array.isArray(rows)?rows:[rows]), null, 2));
      }
      if (name === 'get_hrms_stats') {
        const s = await Promise.allSettled([
          pool.query('SELECT COUNT(*) AS n FROM employees'),
          pool.query("SELECT COUNT(*) AS n FROM employees WHERE employment_status='Active'"),
          pool.query('SELECT COUNT(*) AS n FROM ats_candidate'),
          pool.query('SELECT COUNT(*) AS n FROM attendance_daily_record WHERE record_date=CURDATE()'),
          pool.query("SELECT COUNT(*) AS n FROM leave_request WHERE status='Pending'"),
          pool.query("SELECT COUNT(*) AS n FROM employees WHERE MONTH(date_of_joining)=MONTH(CURDATE()) AND YEAR(date_of_joining)=YEAR(CURDATE())"),
        ]);
        const v = r => r.status==='fulfilled' ? Number(r.value[0][0].n) : 'N/A';
        return ok(JSON.stringify({ total_workforce:v(s[0]), active_employees:v(s[1]), ats_candidates:v(s[2]), attendance_today:v(s[3]), pending_leave:v(s[4]), new_joiners_this_month:v(s[5]), data_as_of:new Date().toISOString().split('T')[0] }, null, 2));
      }
      if (name === 'search_employees') {
        const q=String(args.q||'').trim(), status=String(args.status||'').trim(), limit=Math.min(Number(args.limit)||50,200);
        const conds=[], params=[];
        if (q) { conds.push('(employee_code LIKE ? OR full_name LIKE ?)'); const like=`%${q}%`; params.push(like,like); }
        if (status) { conds.push('employment_status=?'); params.push(status); }
        const [rows] = await pool.query(
          `SELECT id,employee_code,full_name,date_of_joining,employment_status,branch_id,process_id FROM employees${conds.length?' WHERE '+conds.join(' AND '):''} ORDER BY employee_code LIMIT ${limit}`, params);
        return ok(JSON.stringify(maskPII(rows), null, 2));
      }
      if (name === 'get_dashboard_data') {
        const r = await Promise.allSettled([
          pool.query("SELECT COUNT(*) as total,SUM(CASE WHEN employment_status='Active' THEN 1 ELSE 0 END) as active_count,SUM(CASE WHEN employment_status='inactive' THEN 1 ELSE 0 END) as inactive_count,SUM(CASE WHEN employment_status='Resigned' THEN 1 ELSE 0 END) as resigned_count,SUM(CASE WHEN employment_status='terminated' THEN 1 ELSE 0 END) as term_count FROM employees"),
          pool.query("SELECT b.branch_name,COUNT(e.id) as total,SUM(CASE WHEN e.employment_status='Active' THEN 1 ELSE 0 END) as active FROM employees e JOIN branch_master b ON e.branch_id=b.id GROUP BY b.id,b.branch_name ORDER BY total DESC LIMIT 15"),
          pool.query("SELECT DATE_FORMAT(date_of_joining,'%Y-%m') as month,COUNT(*) as joiners FROM employees WHERE date_of_joining>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH) GROUP BY month ORDER BY month"),
          pool.query("SELECT DATE_FORMAT(date_of_exit,'%Y-%m') as month,COUNT(*) as exits FROM employees WHERE date_of_exit>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH) AND date_of_exit IS NOT NULL GROUP BY month ORDER BY month"),
          pool.query("SELECT current_stage as stage,COUNT(*) as count FROM ats_candidate GROUP BY current_stage ORDER BY count DESC LIMIT 12"),
          pool.query("SELECT record_date,COUNT(*) as present FROM attendance_daily_record WHERE record_date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) GROUP BY record_date ORDER BY record_date"),
          pool.query("SELECT lt.leave_name,COUNT(lr.id) as count FROM leave_request lr JOIN leave_type_master lt ON lr.leave_type_id=lt.id WHERE lr.status='Pending' GROUP BY lt.id,lt.leave_name ORDER BY count DESC"),
          pool.query("SELECT p.process_name,COUNT(e.id) as total FROM employees e JOIN process_master p ON e.process_id=p.id GROUP BY p.id,p.process_name ORDER BY total DESC LIMIT 10"),
        ]);
        const g = i => r[i].status==='fulfilled' ? r[i].value[0] : [];
        return ok(JSON.stringify({ generated_at:new Date().toISOString(), workforce:g(0)[0]||{}, branches:g(1), monthly_joiners:g(2), monthly_exits:g(3), ats_pipeline:g(4), attendance_30d:g(5), leave_pending:g(6), processes:g(7) }, null, 2));
      }
      return err(`Unknown tool: ${name}`);
    } catch(ex) { return err(`DB error: ${ex.message}`); }
  });

  return server;
}

// ── Express HTTP server ───────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Auth middleware
app.use('/mcp', (req, res, next) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${MCP_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized — provide Authorization: Bearer TOKEN header' });
  }
  next();
});

// Streamable HTTP MCP endpoint — one session per request
app.all('/mcp', async (req, res) => {
  const mcpServer = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => Math.random().toString(36).slice(2) });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Health check
app.get('/health', (req, res) => res.json({ status:'ok', role:ROLE, db:DB_NAME, allowed_tables:ALLOWED.size }));

app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`\n🚀 HRMS MCP HTTP Server running`);
  console.log(`   Port    : ${HTTP_PORT}`);
  console.log(`   Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  console.log(`   Role    : ${ROLE} (${ALLOWED.size} tables)`);
  console.log(`\n   Share this URL with users:`);
  console.log(`   http://<this-server-ip>:${HTTP_PORT}/mcp`);
  console.log(`\n   Their .mcp.json entry:`);
  console.log(`   {`);
  console.log(`     "hrms-db": {`);
  console.log(`       "url": "http://<this-server-ip>:${HTTP_PORT}/mcp",`);
  console.log(`       "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }`);
  console.log(`     }`);
  console.log(`   }\n`);
});
