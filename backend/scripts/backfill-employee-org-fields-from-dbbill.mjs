/**
 * Backfills employees.process_id / cost_centre_id / cost_center_code for active employees
 * where HRMS left them blank, using db_bill as the source.
 *
 * RESOLUTION CHAIN - why it is not a straight column copy
 *   masjclrentry.Process and .ClientName are NULL for every one of these people, so the
 *   process cannot be read directly. What masjclrentry does carry is CostCenter, and
 *   db_bill.cost_master maps cost_center -> client. That client is the process. The last
 *   hop (client name -> HRMS process_master.process_name) needs an alias table because the
 *   two systems name the same client differently: db_bill says "Locon solutions private
 *   limited", HRMS calls that process "Housing.com".
 *
 * Anything that does not resolve cleanly is REPORTED, never guessed: a client whose HRMS
 * side has two equally plausible process rows, and any employee whose db_bill name does
 * not match the HRMS name, are both left alone.
 *
 * DRY RUN by default. --apply writes.
 *   node scripts/backfill-employee-org-fields-from-dbbill.mjs
 *   node scripts/backfill-employee-org-fields-from-dbbill.mjs --apply
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const APPLY = process.argv.includes('--apply');

// db_bill client name -> HRMS process_master.process_name. Only unambiguous pairs live here;
// a client whose HRMS side has two equally plausible rows is deliberately absent so it
// surfaces as UNRESOLVED instead of being picked by coin flip.
const CLIENT_TO_PROCESS = {
  'Locon solutions private limited': 'Housing.com',
  'Onfido Limited': 'Onfido',
  'Godfrey Philips India Ltd': 'Godfrey Philips India Ltd',
  'SAMARTH E-MOBILITY PRIVATE LIMITED': 'AVORE E-BIKE',
  'Exicom Tele-Systems Limited': 'Exicom',
  'BirlaNu Limited': 'BirlaNu Limited',
  'BTM VENTURES PVT LTD': 'BTM Ventures',
  'Captureatrip India Pvt. Ltd.': 'Captureatrip',
  'Eresolution Consultancy Services Private Limited': 'Eresolution',
  // MCIPL is the company itself, not a client: cost centre MANAGEMENT-CORPORATE, and
  // exactly one active process_master row carries that name.
  MCIPL: 'MANAGEMENT-CORPORATE',
};

const norm = (s) => (s ?? '').trim().replace(/\s+/g, ' ');
const nameKey = (s) => norm(s).toUpperCase().replace(/[^A-Z ]/g, '').split(' ').filter(Boolean).sort().join(' ');

const hrms = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
// db_bill sits on a different box; BILL_DB_HOST in .env is the LAN address and is
// unreachable off-LAN. Fall back to the public pair documented in .env.
const billHost = process.env.BILL_DB_HOST === '192.168.10.22' ? '14.97.30.236' : process.env.BILL_DB_HOST;
const bill = await mysql.createConnection({
  host: billHost, port: Number(process.env.BILL_DB_PORT || 3306),
  user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD,
  database: process.env.BILL_DB_NAME || 'db_bill', connectTimeout: 20000,
});
const qh = async (s, p = []) => (await hrms.query(s, p))[0];
const qb = async (s, p = []) => (await bill.query(s, p))[0];

// Fail fast rather than block for a minute. The rows this script writes are exactly the
// ones kpi-data-connector's syncIntegrationCallMetrics locks a range over
// (active_status = 1 AND process_id IS NULL), so a collision is expected, not exceptional.
// Waiting the server default of 60s just turns one collision into a dead run.
await hrms.query('SET SESSION innodb_lock_wait_timeout = 5');

/** Retries a write past lock contention. Every write here is a blank-fill, so a retry
 *  re-applies the same value and cannot double-write. */
async function writeWithRetry(sql, params, label) {
  const MAX = 6;
  for (let attempt = 1; ; attempt++) {
    try {
      await hrms.execute(sql, params);
      return { ok: true, attempts: attempt };
    } catch (err) {
      const contended = err.code === 'ER_LOCK_WAIT_TIMEOUT' || err.code === 'ER_LOCK_DEADLOCK';
      if (!contended || attempt >= MAX) return { ok: false, attempts: attempt, why: `${label}: ${err.code ?? err.message}` };
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

const gaps = await qh(
  `SELECT e.id, e.employee_code, TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS hrms_name,
          e.process_id, e.cost_centre_id, e.cost_center_code, e.department_id, e.designation_id
     FROM employees e
    WHERE e.employment_status = 'active'
      AND (e.process_id IS NULL OR e.cost_centre_id IS NULL OR e.cost_center_code IS NULL
           OR e.cost_center_code = '' OR e.department_id IS NULL OR e.designation_id IS NULL)
    ORDER BY e.employee_code`);
if (!gaps.length) {
  console.log('No active employee has a missing org field.');
  await hrms.end(); await bill.end(); process.exit(0);
}

const codes = gaps.map((r) => r.employee_code);
const ph = codes.map(() => '?').join(',');
const jclr = await qb(
  `SELECT EmpCode, EmpName, Dept, Desgination, Process, ClientName, CostCenter
     FROM masjclrentry WHERE EmpCode IN (${ph})`, codes);
const byCode = new Map(jclr.map((r) => [norm(r.EmpCode), r]));

const ccCodes = [...new Set(jclr.map((r) => norm(r.CostCenter)).filter(Boolean))];
const ccToClient = new Map();
if (ccCodes.length) {
  const rows = await qb(
    `SELECT cost_center, client FROM cost_master WHERE cost_center IN (${ccCodes.map(() => '?').join(',')})`, ccCodes);
  for (const r of rows) ccToClient.set(norm(r.cost_center), norm(r.client));
}

// A process_name present more than once cannot be targeted by name - drop both so it reports.
const procRows = await qh(`SELECT id, process_name FROM process_master WHERE active_status = 1`);
const procByName = new Map();
const procDupes = new Set();
for (const r of procRows) {
  const k = norm(r.process_name).toLowerCase();
  if (procByName.has(k)) { procDupes.add(k); procByName.delete(k); }
  else if (!procDupes.has(k)) procByName.set(k, r.id);
}
const ccIdByCode = new Map((await qh(`SELECT id, cost_centre_code FROM cost_centre_master`))
  .map((r) => [norm(r.cost_centre_code), r.id]));

const plan = [];
const unresolved = [];
for (const e of gaps) {
  const src = byCode.get(norm(e.employee_code));
  if (!src) {
    unresolved.push({ code: e.employee_code, name: e.hrms_name, why: 'not in db_bill masjclrentry' });
    continue;
  }
  const hk = nameKey(e.hrms_name);
  const bk = nameKey(src.EmpName);
  const firstToken = hk.split(' ')[0] ?? '';
  if (hk !== bk && !(firstToken && bk.includes(firstToken))) {
    unresolved.push({ code: e.employee_code, name: e.hrms_name, why: `name mismatch - db_bill has "${norm(src.EmpName)}"` });
    continue;
  }

  const ccCode = norm(src.CostCenter);
  const client = norm(src.Process) || ccToClient.get(ccCode) || '';
  const procName = CLIENT_TO_PROCESS[client] ?? null;
  const procId = procName ? procByName.get(procName.toLowerCase()) ?? null : null;
  const ccId = ccCode ? ccIdByCode.get(ccCode) ?? null : null;

  const set = {};
  if (!e.process_id && procId) set.process_id = procId;
  if (!e.cost_centre_id && ccId) set.cost_centre_id = ccId;
  if (!e.cost_center_code && ccCode) set.cost_center_code = ccCode;

  if (!e.process_id && !procId) {
    unresolved.push({
      code: e.employee_code, name: e.hrms_name,
      why: client ? `no unambiguous HRMS process for client "${client}" (cc ${ccCode || 'none'})` : 'db_bill row has no cost centre',
    });
  }
  if (Object.keys(set).length) {
    plan.push({ id: e.id, code: e.employee_code, name: e.hrms_name, ccCode, client, procName: procName ?? '-', set });
  }
}

console.log(`\nActive employees with a missing org field: ${gaps.length}`);
console.log(`Rows with at least one field resolvable: ${plan.length}    Unresolved notes: ${unresolved.length}\n`);
const grouped = {};
for (const p of plan) {
  const k = `${p.ccCode || '(no cc)'}  ->  ${p.client || '(no client)'}  ->  ${p.procName}`;
  (grouped[k] ??= []).push(p.code);
}
console.table(Object.entries(grouped).map(([mapping, v]) => ({ mapping, n: v.length, codes: v.join(' ') })));
if (unresolved.length) {
  console.log('\nUNRESOLVED - process left blank, no guess made:');
  console.table(unresolved);
}
const fieldCounts = plan.reduce((a, p) => { for (const k of Object.keys(p.set)) a[k] = (a[k] ?? 0) + 1; return a; }, {});
console.log('\nFields to be written:', JSON.stringify(fieldCounts));
if (procDupes.size) console.log('Duplicate active process_master names (untargetable by name):', [...procDupes].join(', '));

if (!APPLY) {
  console.log('\nDRY RUN - nothing written. Re-run with --apply to write.');
} else {
  let n = 0;
  const failed = [];
  for (const p of plan) {
    const cols = Object.keys(p.set);
    const r = await writeWithRetry(
      `UPDATE employees SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => p.set[c]), p.id], p.code);
    if (r.ok) n++; else failed.push({ code: p.code, name: p.name, why: r.why });
  }
  console.log(`\nAPPLIED - ${n} of ${plan.length} employee rows updated.`);
  if (failed.length) {
    console.log('FAILED after retries - re-run the script, it recomputes the remaining gaps:');
    console.table(failed);
  }
  const [after] = await qh(
    `SELECT SUM(process_id IS NULL) no_process, SUM(cost_centre_id IS NULL) no_cost_centre
       FROM employees WHERE employment_status = 'active'`);
  console.log(`Remaining active gaps -> process: ${after.no_process}, cost centre: ${after.no_cost_centre}`);
}
await hrms.end();
await bill.end();
