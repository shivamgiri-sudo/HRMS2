/**
 * Aligns apr_eligibility_config to the client-confirmed per-process source list.
 *
 * THE BUG THIS FIXES
 *   attendanceEngineService.isAprEligible() returns true if ANY active row matches; the
 *   ORDER BY specificity only decides WHICH row comes back, never whether. One active row
 *   ('Operations EXECUTIVE APR Rule') has process_id = NULL, so every Operations EXECUTIVE
 *   is APR-eligible in every process and the 60 process-scoped rows under it are inert.
 *   Measured on live data: ~3,000 day-rows in 30 days built from the dialler feed for
 *   people whose process is biometric-only.
 *
 * THE RULE (client table, 2026-09-02)
 *   APR: Bella-Vita Organic, Guardian Healthcare, Clovia, Neemans, BirlaNu, Exicom, Viega,
 *        Dalmia Cement, Onfido.  Every other process: COSEC biometric.
 *
 * Note apr_eligibility_config has no effective dating, so deactivating a row changes the
 * answer for past dates too if the engine reprocesses them. That is intended here — August
 * is being rebuilt under this rule straight after.
 *
 * DRY RUN by default. --apply writes.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');

const APR_PROCESSES = [
  'Bella-Vita Organic', 'Guardian Healthcare', 'Clovia', 'Neemans Private Limited',
  'BirlaNu Limited', 'Exicom', 'Viega', 'Dalmia Cement', 'Onfido',
];

const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
const q = async (s, p = []) => (await db.query(s, p))[0];
await db.query('SET SESSION innodb_lock_wait_timeout = 5');

const rows = await q(
  `SELECT a.id, a.rule_name, a.designation_id, a.department_id, a.process_id,
          d.designation_name, p.process_name
     FROM apr_eligibility_config a
     LEFT JOIN designation_master d ON d.id = a.designation_id
     LEFT JOIN process_master p ON p.id = a.process_id
    WHERE a.active_status = 1`);

const aprSet = new Set(APR_PROCESSES.map((s) => s.toLowerCase()));
const deactivate = rows.filter((r) => !r.process_id || !aprSet.has((r.process_name ?? '').toLowerCase()));
const keep = rows.filter((r) => r.process_id && aprSet.has((r.process_name ?? '').toLowerCase()));

// Onfido is on the APR list but has no row at all — it is APR today only by accident of the
// process_id = NULL row being fixed here. Without this it would flip to biometric.
const covered = new Set(keep.map((r) => (r.process_name ?? '').toLowerCase()));
const missing = APR_PROCESSES.filter((p) => !covered.has(p.toLowerCase()));

// New rows mirror the designation/department shape the existing process rows already use.
const template = keep[0];
const designations = [...new Map(keep.map((r) => [r.designation_id, r.designation_name])).entries()];
const inserts = [];
for (const procName of missing) {
  const proc = (await q(`SELECT id FROM process_master WHERE process_name = ? AND active_status = 1`, [procName]))[0];
  if (!proc) { console.log(`!! process_master has no active row named "${procName}" — skipped`); continue; }
  for (const [desigId, desigName] of designations) {
    inserts.push({
      id: randomUUID(), rule_name: `APR: ${desigName} / ${procName}`,
      designation_id: desigId, department_id: template.department_id, process_id: proc.id,
      label: `${desigName} / ${procName}`,
    });
  }
}

console.log(`\nActive rows now: ${rows.length}`);
console.log(`Keep (APR processes): ${keep.length}   Deactivate: ${deactivate.length}   Insert: ${inserts.length}\n`);

const byProc = {};
for (const r of deactivate) {
  const k = r.process_name ?? '*** ALL PROCESSES (process_id IS NULL) ***';
  (byProc[k] ??= []).push(r.designation_name);
}
console.log('TO DEACTIVATE:');
console.table(Object.entries(byProc).map(([process, d]) => ({ process, designations: d.join(', ') })));
if (inserts.length) { console.log('TO INSERT:'); console.table(inserts.map((i) => ({ rule: i.label }))); }
console.log('REMAINING APR PROCESSES:', [...new Set(keep.map((r) => r.process_name))].sort().join(', ') || '(none)');

if (!APPLY) { console.log('\nDRY RUN - nothing written. Re-run with --apply.'); }
else {
  for (const r of deactivate) {
    await db.execute(
      `UPDATE apr_eligibility_config SET active_status = 0, updated_at = NOW() WHERE id = ?`, [r.id]);
  }
  for (const i of inserts) {
    await db.execute(
      `INSERT INTO apr_eligibility_config
         (id, rule_name, designation_id, department_id, process_id, active_status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'apr-eligibility-align script', NOW(), NOW())`,
      [i.id, i.rule_name, i.designation_id, i.department_id, i.process_id,
       'Added 2026-09-02 to align APR eligibility with the client per-process source list.']);
  }
  console.log(`\nAPPLIED - ${deactivate.length} deactivated, ${inserts.length} inserted.`);
  const after = await q(
    `SELECT p.process_name, COUNT(*) n FROM apr_eligibility_config a
       JOIN process_master p ON p.id = a.process_id
      WHERE a.active_status = 1 GROUP BY p.process_name ORDER BY p.process_name`);
  const nullScoped = await q(`SELECT COUNT(*) n FROM apr_eligibility_config WHERE active_status = 1 AND process_id IS NULL`);
  console.log('\nActive APR rules after change:');
  console.table(after);
  console.log(`Rows still scoped to ALL processes (must be 0): ${nullScoped[0].n}`);
}
await db.end();
