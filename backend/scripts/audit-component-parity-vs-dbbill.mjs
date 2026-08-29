/**
 * audit-component-parity-vs-dbbill.mjs
 *
 * Read-only. Answers two questions about salary_prep_line_component:
 *
 *  1. HEAD COVERAGE  — does mas_hrms carry a component head for every money
 *     column db_bill actually populates?
 *  2. VALUE PARITY   — for every employee and month, does the stored amount for
 *     each head equal the db_bill EARNED value for that head?
 *
 * Compares against the `1`-suffixed (earned) columns, which is what the register
 * should hold — see lib/dbbill-salary-mapping.mjs.
 *
 * Usage:
 *   node backend/scripts/audit-component-parity-vs-dbbill.mjs
 *   node backend/scripts/audit-component-parity-vs-dbbill.mjs --month=2026-07
 *   node backend/scripts/audit-component-parity-vs-dbbill.mjs --samples=10
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { COMPONENT_MAP, num } from './lib/dbbill-salary-mapping.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}
const arg = (n, fb) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? fb;

const ONLY_MONTH = arg('month', null);
const SAMPLES    = Number(arg('samples', 3));
const HRMS_HOST  = arg('hrms-host', fromEnvFile('DB_HOST') ?? '192.168.10.6');
const BILL_HOST  = arg('bill-host', fromEnvFile('BILL_DB_HOST') ?? '192.168.10.22');
const USER = fromEnvFile('DB_USER'), PASS = fromEnvFile('DB_PASSWORD');

/** db_bill money columns that no importer maps to any HRMS head. */
const UNMAPPED = ['SHSH', 'ShortCollection'];

const money = v => Math.round(num(v) * 100) / 100;
const log = m => process.stdout.write(m + '\n');

async function main() {
  const hrms = await mysql.createConnection({ host: HRMS_HOST, port: 3306, user: USER,
    password: PASS, database: 'mas_hrms', connectTimeout: 30000 });
  const bill = await mysql.createConnection({ host: BILL_HOST, port: 3306, user: USER,
    password: PASS, database: 'db_bill', connectTimeout: 30000, dateStrings: true });

  const byCode = {};                       // component_code -> stats
  for (const [code, , , col] of COMPONENT_MAP) {
    byCode[code] = { col, billNonZero: 0, hrmsRows: 0, match: 0, differ: 0,
                     missingInHrms: 0, extraInHrms: 0, diffAmt: 0, samples: [] };
  }
  const unmapped = Object.fromEntries(UNMAPPED.map(c => [c, { rows: 0, total: 0 }]));
  const T = { lines: 0, matched: 0, unmatchedLines: 0 };

  const [months] = await hrms.query('SELECT DISTINCT run_month m FROM salary_prep_run ORDER BY m');
  for (const { m } of months) {
    if (ONLY_MONTH && m !== ONLY_MONTH) continue;

    const [hr] = await hrms.query(
      `SELECT l.id, e.employee_code ec FROM salary_prep_line l
         JOIN employees e ON e.id = l.employee_id
        WHERE l.run_id IN (SELECT id FROM salary_prep_run WHERE run_month = ?)`, [m]);
    if (!hr.length) continue;

    const [comps] = await hrms.query(
      `SELECT c.line_id, c.component_code cc, c.amount FROM salary_prep_line_component c
        WHERE c.run_id IN (SELECT id FROM salary_prep_run WHERE run_month = ?)`, [m]);
    const byLine = new Map();
    for (const c of comps) {
      if (!byLine.has(c.line_id)) byLine.set(c.line_id, new Map());
      byLine.get(c.line_id).set(c.cc, money(c.amount));
    }

    const [bl] = await bill.query(
      `SELECT * FROM salary_data WHERE DATE_FORMAT(SalDate, '%Y-%m') = ?`, [m]);
    const B = new Map(), dup = new Set();
    for (const r of bl) {
      const k = String(r.EmpCode || '').trim();
      if (!k) continue;
      if (B.has(k)) dup.add(k); else B.set(k, r);
    }

    for (const l of hr) {
      T.lines++;
      const s = B.get(String(l.ec || '').trim());
      if (!s || dup.has(String(l.ec || '').trim())) { T.unmatchedLines++; continue; }
      T.matched++;
      const have = byLine.get(l.id) ?? new Map();

      for (const [code, , , col] of COMPONENT_MAP) {
        const want = money(s[col]);
        const got  = have.get(code);
        const st   = byCode[code];
        if (want !== 0) st.billNonZero++;
        if (got !== undefined) st.hrmsRows++;

        if (want === 0 && got === undefined) continue;          // correctly absent
        if (want === 0 && got !== undefined) { st.extraInHrms++; continue; }
        if (got === undefined) {                                 // should exist, does not
          st.missingInHrms++;
          if (st.samples.length < SAMPLES) st.samples.push({ m, ec: l.ec, want, got: 'ABSENT' });
          continue;
        }
        if (Math.abs(got - want) <= 0.005) st.match++;
        else {
          st.differ++; st.diffAmt += Math.abs(got - want);
          if (st.samples.length < SAMPLES) st.samples.push({ m, ec: l.ec, want, got });
        }
      }

      for (const c of UNMAPPED) {
        const v = money(s[c]);
        if (v !== 0) { unmapped[c].rows++; unmapped[c].total += v; }
      }
    }
  }

  log('\n=== 1. HEAD COVERAGE + VALUE PARITY (per component) ===');
  log(['code'.padEnd(14), 'db_bill col'.padEnd(20), 'bill≠0'.padStart(8),
       'in hrms'.padStart(8), 'match'.padStart(8), 'differ'.padStart(8),
       'missing'.padStart(8), 'extra'.padStart(8), 'diff ₹'.padStart(12)].join(' '));
  for (const [code, st] of Object.entries(byCode)) {
    log([code.padEnd(14), st.col.padEnd(20),
         String(st.billNonZero).padStart(8), String(st.hrmsRows).padStart(8),
         String(st.match).padStart(8), String(st.differ).padStart(8),
         String(st.missingInHrms).padStart(8), String(st.extraInHrms).padStart(8),
         String(Math.round(st.diffAmt)).padStart(12)].join(' '));
  }

  log('\n=== 2. db_bill MONEY COLUMNS WITH NO HRMS HEAD AT ALL ===');
  for (const [c, v] of Object.entries(unmapped)) {
    log(`  ${c.padEnd(20)} ${String(v.rows).padStart(8)} rows   ₹${Math.round(v.total).toLocaleString('en-IN')}`);
  }

  log('\n=== 3. SAMPLES (first mismatches per head) ===');
  for (const [code, st] of Object.entries(byCode)) {
    if (!st.samples.length) continue;
    log(`  ${code}: ` + st.samples.map(s => `${s.m} ${s.ec} bill=${s.want} hrms=${s.got}`).join(' | '));
  }

  log('\nLines: ' + JSON.stringify(T));
  await hrms.end(); await bill.end();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
