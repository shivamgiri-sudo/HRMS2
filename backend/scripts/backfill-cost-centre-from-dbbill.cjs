/**
 * Backfill employees.cost_centre_id for joiners whose cost centre was never written.
 *
 * WHY THIS EXISTS
 * ---------------
 * Onboarding captures a REQUIRED cost centre, but no employee-creation path ever wrote
 * employees.cost_centre_id (fixed forward in employee-creation-orchestrator.service.ts and
 * employee.service.ts). 185 active employees who joined on/after 2026-07-20 were left NULL.
 *
 * SOURCES, and why each is trusted
 * --------------------------------
 * Every source below was measured against a LABELLED set before being used: the 729 recent
 * joiners whose cost centre is already correct in HRMS. A source that cannot reproduce a
 * known answer is not fit to invent an unknown one.
 *
 *   ats_offer   the value HR chose at onboarding. Authoritative where it exists, but only
 *               a handful of these employees came through ATS.
 *   attendance  db_bill.Attandence.CostCenter - agreed 559/559 (100%).
 *   jclr        db_bill.masjclrentry.CostCenter - agreed 727/729 (99.7%), and the only
 *               source covering every remaining employee. This is the joining register.
 *   salary      db_bill.salary_data.CostCenter - agreed 701/702 (99.9%).
 *   onboarding  db_bill.emp_onboard_trigger_services.cost_center - agreed 190/190 (100%),
 *               but covers few rows.
 *
 * Deliberately NOT used: his_masjsclrentry, which managed only 420/439 (95.7%) and returns
 * truncated values like 'BO/' where the real cost centre is 'BSS/OB/Noida/1005'. A 4-in-100
 * error rate on a field that drives billing is not worth the extra coverage.
 *
 * HOW DISAGREEMENTS ARE HANDLED
 *   - within ONE dated source, several values over time is a transfer rather than a
 *     conflict, and the most recent attendance date is the current posting. This settles
 *     MAS63175: BSS/OB/Noida/592 (to 03 Aug) over BSS/OB/Noida/1005 (to 27 Jul).
 *   - ACROSS sources, a disagreement is NOT auto-resolved. The employee is handed to a
 *     human with the evidence attached.
 *
 *     A "the cost centre in the employee's own branch wins" rule was written here and then
 *     removed, because it looks objective and quietly picks the wrong answer. MAS63085 is
 *     the case: the ATS offer says BSS/BO/NOIDA-2/576 while attendance, the joining register
 *     and salary_data all say BSS/IB/Noida/892, and the employee has 24 days of recorded
 *     attendance under 892. That rule would have discarded three independent operational
 *     sources plus real attendance in favour of one statement of intent, on the strength of
 *     a branch_id that is itself just another field that can be wrong. Whether this column
 *     should hold where HR meant to put someone or where they actually work is a business
 *     decision, and a wrong cost centre bills a client.
 *
 * SAFETY
 *   - dry run unless --apply;
 *   - only ever touches rows where cost_centre_id IS NULL, so it is idempotent and cannot
 *     overwrite a value a human set;
 *   - every candidate must resolve to EXACTLY ONE ACTIVE cost_centre_master row;
 *   - the plan, the skips and the reasons are written to backend/backups/ before any write.
 *
 * Usage:
 *   node scripts/backfill-cost-centre-from-dbbill.cjs            # dry run
 *   node scripts/backfill-cost-centre-from-dbbill.cjs --apply    # writes
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

/**
 * Credentials come from backend/.env, never from this file - a hardcoded password in a
 * tracked script is a credential leak that outlives the task it was written for. Values in
 * that file are wrapped in double quotes, which a naive split('=')[1] keeps and then sends
 * as part of the password, producing an "Access denied" that looks like a host-grant problem
 * and is not.
 */
function envFile() {
  const p = path.resolve(__dirname, '..', '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const E = envFile();
const pick = (k, d) => process.env[k] || E[k] || d;
const USER = pick('DB_USER'), PASS = pick('DB_PASSWORD');
if (!USER || !PASS) { console.error('DB_USER / DB_PASSWORD not found in environment or backend/.env'); process.exit(1); }

const HRMS_HOSTS = [pick('DB_HOST', '192.168.10.6'), '122.184.128.90'];
const BILL_HOSTS = [pick('BILL_DB_HOST', '192.168.10.22'), '14.97.30.236'];

async function connectAny(hosts, database, label) {
  for (const host of hosts) {
    try {
      const c = await mysql.createConnection({ host, user: USER, password: PASS, database, connectTimeout: 20000 });
      console.log(`  ${label}: connected via ${host}`);
      return c;
    } catch (e) { console.log(`  ${label}: ${host} -> ${e.code}`); }
  }
  throw new Error(`${label} unreachable on every known address`);
}

/** db_bill tables to read, in descending measured accuracy. */
const BILL_SOURCES = [
  { key: 'attendance', table: 'Attandence', cc: 'CostCenter', emp: 'EmpCode', dateCol: 'AttandDate' },
  { key: 'jclr', table: 'masjclrentry', cc: 'CostCenter', emp: 'EmpCode', dateCol: null },
  { key: 'salary', table: 'salary_data', cc: 'CostCenter', emp: 'EmpCode', dateCol: null },
  { key: 'onboarding', table: 'emp_onboard_trigger_services', cc: 'cost_center', emp: 'emp_code', dateCol: null },
];

(async () => {
  console.log(APPLY ? '=== APPLY MODE - this will write ===' : '=== DRY RUN - no writes ===');
  const hrms = await connectAny(HRMS_HOSTS, pick('DB_NAME', 'mas_hrms'), 'mas_hrms');
  const bill = await connectAny(BILL_HOSTS, pick('BILL_DB_NAME', 'db_bill'), 'db_bill');

  const [targets] = await hrms.query(
    `SELECT e.id, e.employee_code, e.candidate_id, e.branch_id,
            COALESCE(b.branch_name,'UNASSIGNED') AS branch_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.active_status = 1
        AND e.cost_centre_id IS NULL
        ${process.env.BACKFILL_ALL === '1' ? '' : "AND e.date_of_joining >= '2026-07-20'"}`);
  console.log(`\nEmployees missing a cost centre: ${targets.length}`);
  if (targets.length === 0) { await hrms.end(); await bill.end(); return; }

  const codes = targets.map(t => t.employee_code);
  const ph = codes.map(() => '?').join(',');

  // candidates: employee_code -> [{ source, value }]
  const candidates = new Map(codes.map(c => [c, []]));

  // Source: the onboarding offer.
  const [offerRows] = await hrms.query(
    `SELECT e.employee_code, COALESCE(o.cost_centre, v.cost_centre_id) AS cc
       FROM employees e
       LEFT JOIN ats_employment_offer o      ON o.candidate_id = e.candidate_id
       LEFT JOIN ats_payroll_hr_validation v ON v.candidate_id = e.candidate_id
      WHERE e.employee_code IN (${ph}) AND COALESCE(o.cost_centre, v.cost_centre_id) IS NOT NULL`, codes);
  for (const r of offerRows) {
    const list = candidates.get(r.employee_code);
    if (list) list.push({ source: 'ats_offer', value: String(r.cc) });
  }

  // Sources: db_bill. Where a table is dated, the newest value wins a transfer.
  for (const s of BILL_SOURCES) {
    const sql = s.dateCol
      ? `SELECT \`${s.emp}\` emp, \`${s.cc}\` cc, MAX(\`${s.dateCol}\`) last_seen
           FROM \`${s.table}\`
          WHERE \`${s.emp}\` IN (${ph}) AND NULLIF(TRIM(\`${s.cc}\`),'') IS NOT NULL
          GROUP BY \`${s.emp}\`, \`${s.cc}\` ORDER BY last_seen DESC`
      : `SELECT DISTINCT \`${s.emp}\` emp, \`${s.cc}\` cc, NULL last_seen
           FROM \`${s.table}\`
          WHERE \`${s.emp}\` IN (${ph}) AND NULLIF(TRIM(\`${s.cc}\`),'') IS NOT NULL`;
    let rows = [];
    try { [rows] = await bill.query(sql, codes); }
    catch (e) { console.log(`  (${s.table} unreadable: ${e.message.slice(0, 60)})`); continue; }

    const seen = new Set();
    for (const r of rows) {
      // Rows arrive newest-first for dated tables, so the first value per employee is current.
      if (s.dateCol && seen.has(r.emp)) continue;
      seen.add(r.emp);
      const list = candidates.get(r.emp);
      if (list) list.push({ source: s.key, value: String(r.cc) });
    }
  }

  // Resolve every distinct raw value to exactly one ACTIVE master row.
  const allValues = [...new Set([...candidates.values()].flat().map(c => c.value))];
  const resolved = new Map();
  const unresolved = [];
  for (const raw of allValues) {
    const [m] = await hrms.query(
      `SELECT id, cost_centre_name, branch_id FROM cost_centre_master
        WHERE active_status = 1 AND (id = ? OR cost_centre_code = ? OR cost_centre_name = ?)`,
      [raw, raw, raw]);
    if (m.length === 1) resolved.set(raw, { id: m[0].id, name: m[0].cost_centre_name, branch_id: m[0].branch_id });
    else unresolved.push({ value: raw, matches: m.length });
  }

  // Decide.
  const plan = [], skipped = [];
  for (const t of targets) {
    const raw = (candidates.get(t.employee_code) || []).filter(c => resolved.has(c.value));
    if (raw.length === 0) { skipped.push({ employee_code: t.employee_code, reason: 'no usable cost centre in any source' }); continue; }

    const distinct = [...new Set(raw.map(c => resolved.get(c.value).id))];
    if (distinct.length > 1) {
      const inBranch = [...new Set(raw.filter(c => resolved.get(c.value).branch_id === t.branch_id)
        .map(c => resolved.get(c.value).name))];
      skipped.push({
        employee_code: t.employee_code,
        reason: 'sources disagree - needs a human decision',
        employee_branch: t.branch_name,
        candidates: raw.map(c => `${c.source}=${resolved.get(c.value).name}`),
        matches_employee_branch: inBranch.length ? inBranch : ['none'],
      });
      continue;
    }

    const chosen = raw[0];
    const r = resolved.get(chosen.value);
    plan.push({ id: t.id, employee_code: t.employee_code, cost_centre_id: r.id, cost_centre_name: r.name, source: chosen.source });
  }

  const bySource = {};
  for (const p of plan) bySource[p.source] = (bySource[p.source] ?? 0) + 1;
  console.log(`\n  resolvable and safe to write : ${plan.length}`);
  console.log(`    by source                  : ${JSON.stringify(bySource)}`);
  console.log(`  skipped                      : ${skipped.length}`);
  if (skipped.length) console.log(`    ${JSON.stringify(skipped, null, 2)}`);
  if (unresolved.length) console.log(`  values not in cost_centre_master: ${JSON.stringify(unresolved)}`);

  const byCc = {};
  for (const p of plan) byCc[p.cost_centre_name] = (byCc[p.cost_centre_name] ?? 0) + 1;
  console.log(`\n  distribution: ${JSON.stringify(byCc)}`);

  const outDir = path.resolve(__dirname, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = process.env.BACKFILL_STAMP || 'run';
  fs.writeFileSync(path.join(outDir, `cost-centre-backfill-plan-${stamp}.json`),
    JSON.stringify({ plan, skipped, unresolved }, null, 2));
  console.log(`\n  plan written to backend/backups/cost-centre-backfill-plan-${stamp}.json`);

  if (!APPLY) { console.log('\nDry run only. Re-run with --apply to write.'); await hrms.end(); await bill.end(); return; }

  let updated = 0;
  for (const p of plan) {
    const [res] = await hrms.execute(
      `UPDATE employees SET cost_centre_id = ? WHERE id = ? AND cost_centre_id IS NULL`,
      [p.cost_centre_id, p.id]);
    updated += res.affectedRows;
  }
  console.log(`\n  rows updated: ${updated} of ${plan.length} planned`);
  const [after] = await hrms.query(
    // Must use the SAME population as the run, or the closing number reports on a
    // different set than was just written and reads as success while work remains.
    `SELECT COUNT(*) still_null FROM employees
      WHERE active_status = 1 AND cost_centre_id IS NULL
        ${process.env.BACKFILL_ALL === '1' ? '' : "AND date_of_joining >= '2026-07-20'"}`);
  console.log(`  still missing a cost centre: ${after[0].still_null}`);
  await hrms.end(); await bill.end();
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
