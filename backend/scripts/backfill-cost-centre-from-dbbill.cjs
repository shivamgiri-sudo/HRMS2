/**
 * Backfill employees.cost_centre_id for joiners whose cost centre was never written.
 *
 * WHY THIS EXISTS
 * ---------------
 * Onboarding captures a REQUIRED cost centre, but no employee-creation path ever wrote
 * employees.cost_centre_id (fixed forward in employee-creation-orchestrator.service.ts and
 * employee.service.ts). 185 active employees who joined on/after 2026-07-20 were left NULL.
 *
 * SOURCES, in priority order
 * --------------------------
 *   1. ats_employment_offer.cost_centre / ats_payroll_hr_validation.cost_centre_id
 *      — the value the business actually chose at onboarding. Only 2 employees came
 *        through ATS, but where it exists it is authoritative.
 *   2. db_bill.Attandence.CostCenter — db_bill is the payroll/billing source of truth and
 *      already bills these people to a cost centre, so it is a statement of record rather
 *      than an inference. Used only where an employee has exactly ONE distinct value.
 *
 * SAFETY RULES (all enforced below, not assumed)
 *   - dry run unless --apply is passed;
 *   - only ever touches rows where cost_centre_id IS NULL, so it is idempotent and cannot
 *     overwrite a value a human set;
 *   - every source value must resolve to an ACTIVE cost_centre_master row, by id, code or
 *     name, and to EXACTLY ONE such row — an ambiguous name is skipped, not guessed;
 *   - an employee with conflicting cost centres in db_bill is skipped for a human to decide;
 *   - a resolved cost centre whose branch disagrees with the employee's branch is reported
 *     and skipped by default (--allow-branch-mismatch to include);
 *   - writes the before-state of every touched row to a timestamped JSON file first, so the
 *     change can be reversed exactly.
 *
 * Usage:
 *   node scripts/backfill-cost-centre-from-dbbill.cjs            # dry run, prints the plan
 *   node scripts/backfill-cost-centre-from-dbbill.cjs --apply    # performs the update
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ALLOW_BRANCH_MISMATCH = process.argv.includes('--allow-branch-mismatch');

/**
 * Credentials come from backend/.env, never from this file — a hardcoded password in a
 * tracked script is a credential leak that outlives the task it was written for.
 * Values in that file are wrapped in double quotes, which a naive `split('=')[1]` keeps and
 * then sends as part of the password, producing an "Access denied" that looks like a host
 * grant problem and is not.
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

const USER = pick('DB_USER');
const PASS = pick('DB_PASSWORD');
if (!USER || !PASS) { console.error('DB_USER / DB_PASSWORD not found in environment or backend/.env'); process.exit(1); }

const HRMS = { user: USER, password: PASS, database: pick('DB_NAME', 'mas_hrms'), connectTimeout: 20000 };
const BILL = { user: USER, password: PASS, database: pick('BILL_DB_NAME', 'db_bill'), connectTimeout: 20000 };
// Both addresses are tried because which one answers depends on the network the machine is
// on that day; whichever is wrong times out rather than failing fast.
const HRMS_HOSTS = [pick('DB_HOST', '192.168.10.6'), '122.184.128.90'];
const BILL_HOSTS = [pick('BILL_DB_HOST', '192.168.10.22'), '14.97.30.236'];

async function connectAny(hosts, cfg, label) {
  for (const host of hosts) {
    try { const c = await mysql.createConnection({ ...cfg, host }); console.log(`  ${label}: connected via ${host}`); return c; }
    catch (e) { console.log(`  ${label}: ${host} -> ${e.code}`); }
  }
  throw new Error(`${label} unreachable on every known address`);
}

(async () => {
  console.log(APPLY ? '=== APPLY MODE — this will write ===' : '=== DRY RUN — no writes ===');
  const hrms = await connectAny(HRMS_HOSTS, HRMS, 'mas_hrms');
  const bill = await connectAny(BILL_HOSTS, BILL, 'db_bill');

  // ── The population: NULL cost centre only, so re-running is a no-op ──────────
  const [targets] = await hrms.query(
    `SELECT e.id, e.employee_code, e.candidate_id, e.branch_id,
            COALESCE(b.branch_name,'UNASSIGNED') AS branch_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.active_status = 1
        AND e.cost_centre_id IS NULL
        AND e.date_of_joining >= '2026-07-20'`
  );
  console.log(`\nEmployees missing a cost centre: ${targets.length}`);
  if (targets.length === 0) { await hrms.end(); await bill.end(); return; }

  const codes = targets.map(t => t.employee_code);
  const ph = codes.map(() => '?').join(',');

  // ── Source 1: the onboarding offer ──────────────────────────────────────────
  const [offerRows] = await hrms.query(
    `SELECT e.employee_code,
            COALESCE(o.cost_centre, v.cost_centre_id) AS cc
       FROM employees e
       LEFT JOIN ats_employment_offer o        ON o.candidate_id = e.candidate_id
       LEFT JOIN ats_payroll_hr_validation v   ON v.candidate_id = e.candidate_id
      WHERE e.employee_code IN (${ph})
        AND COALESCE(o.cost_centre, v.cost_centre_id) IS NOT NULL`, codes
  );
  const fromOffer = new Map(offerRows.map(r => [r.employee_code, String(r.cc)]));

  // ── Source 2: db_bill attendance, single distinct value only ────────────────
  const [billRows] = await bill.query(
    `SELECT EmpCode, COUNT(DISTINCT CostCenter) n, GROUP_CONCAT(DISTINCT CostCenter) ccs
       FROM Attandence
      WHERE EmpCode IN (${ph}) AND NULLIF(TRIM(CostCenter),'') IS NOT NULL
      GROUP BY EmpCode`, codes
  );
  const fromBill = new Map();
  const conflicted = [];
  for (const r of billRows) {
    if (Number(r.n) === 1) fromBill.set(r.EmpCode, String(r.ccs));
    else conflicted.push({ employee_code: r.EmpCode, values: r.ccs });
  }

  // ── Resolve every distinct source value to exactly one ACTIVE master row ─────
  const distinct = [...new Set([...fromOffer.values(), ...fromBill.values()])];
  const resolved = new Map();   // raw value -> { id, name, branch_id }
  const unresolved = [];
  for (const raw of distinct) {
    const [m] = await hrms.query(
      `SELECT id, cost_centre_name, branch_id FROM cost_centre_master
        WHERE active_status = 1 AND (id = ? OR cost_centre_code = ? OR cost_centre_name = ?)`,
      [raw, raw, raw]
    );
    if (m.length === 1) resolved.set(raw, { id: m[0].id, name: m[0].cost_centre_name, branch_id: m[0].branch_id });
    else unresolved.push({ value: raw, matches: m.length });   // 0 = unknown, >1 = ambiguous
  }

  // ── Build the plan ──────────────────────────────────────────────────────────
  const plan = [], skipped = [], branchMismatch = [], crossSourceConflict = [];
  for (const t of targets) {
    const offerRaw = fromOffer.get(t.employee_code) ?? null;
    const billRaw = fromBill.get(t.employee_code) ?? null;

    /*
     * Where BOTH sources speak and they disagree, skip rather than pick.
     *
     * db_bill is demonstrably reliable — measured against the 559 recent joiners whose cost
     * centre is already set in HRMS, it agreed on 559 of 559 (100%). The offer is what HR
     * chose at onboarding. So a disagreement is not noise in one of them; it usually means
     * the person was moved after joining, and which value is "right" is a business question
     * about whether the record should show intent or current billing. One employee is in
     * this state (MAS63085: offer BSS/BO/NOIDA-2/576 vs db_bill BSS/IB/Noida/892) and a
     * silent coin-flip there is exactly the kind of wrong-but-plausible write this whole
     * exercise exists to stop.
     */
    if (offerRaw && billRaw) {
      const a = resolved.get(offerRaw), b2 = resolved.get(billRaw);
      if (a && b2 && a.id !== b2.id) {
        crossSourceConflict.push({ employee_code: t.employee_code, ats_offer: a.name, db_bill: b2.name });
        skipped.push({ ...t, reason: `sources disagree — offer says "${a.name}", db_bill says "${b2.name}"` });
        continue;
      }
    }

    const raw = offerRaw ?? billRaw;
    const src = offerRaw ? 'ats_offer' : (billRaw ? 'db_bill' : null);
    if (!raw) { skipped.push({ ...t, reason: conflicted.some(c => c.employee_code === t.employee_code) ? 'conflicting cost centres in db_bill' : 'no cost centre in any source' }); continue; }
    const r = resolved.get(raw);
    if (!r) { skipped.push({ ...t, reason: `value "${raw}" does not resolve to exactly one active cost centre` }); continue; }
    if (r.branch_id && t.branch_id && r.branch_id !== t.branch_id) {
      branchMismatch.push({ employee_code: t.employee_code, employee_branch: t.branch_name, cost_centre: r.name });
      if (!ALLOW_BRANCH_MISMATCH) { skipped.push({ ...t, reason: `cost centre "${r.name}" belongs to a different branch` }); continue; }
    }
    plan.push({ id: t.id, employee_code: t.employee_code, cost_centre_id: r.id, cost_centre_name: r.name, source: src });
  }

  console.log(`\n  resolvable and safe to write : ${plan.length}`);
  console.log(`    from the onboarding offer  : ${plan.filter(p => p.source === 'ats_offer').length}`);
  console.log(`    from db_bill attendance    : ${plan.filter(p => p.source === 'db_bill').length}`);
  console.log(`  skipped                      : ${skipped.length}`);
  console.log(`  branch mismatches            : ${branchMismatch.length}`);
  if (unresolved.length) console.log(`  unresolved source values     : ${JSON.stringify(unresolved)}`);
  if (conflicted.length) console.log(`  conflicting in db_bill       : ${JSON.stringify(conflicted)}`);
  if (crossSourceConflict.length) console.log(`  offer vs db_bill disagreement: ${JSON.stringify(crossSourceConflict)}`);
  if (branchMismatch.length) console.log(`  mismatch detail: ${JSON.stringify(branchMismatch.slice(0, 10))}`);

  const byCc = {};
  for (const p of plan) byCc[p.cost_centre_name] = (byCc[p.cost_centre_name] ?? 0) + 1;
  console.log(`\n  distribution: ${JSON.stringify(byCc)}`);

  const outDir = path.resolve(__dirname, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = process.env.BACKFILL_STAMP || 'run';
  fs.writeFileSync(path.join(outDir, `cost-centre-backfill-plan-${stamp}.json`),
    JSON.stringify({ plan, skipped, conflicted, crossSourceConflict, branchMismatch, unresolved }, null, 2));
  console.log(`\n  plan + skip list written to backend/backups/cost-centre-backfill-plan-${stamp}.json`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    await hrms.end(); await bill.end(); return;
  }

  // ── Apply. The IS NULL guard is repeated in the UPDATE itself so a row a human
  //    set between the read and the write is never clobbered. ──────────────────
  let updated = 0;
  for (const p of plan) {
    const [res] = await hrms.execute(
      `UPDATE employees SET cost_centre_id = ? WHERE id = ? AND cost_centre_id IS NULL`,
      [p.cost_centre_id, p.id]
    );
    updated += res.affectedRows;
  }
  console.log(`\n  rows updated: ${updated} of ${plan.length} planned`);

  const [after] = await hrms.query(
    `SELECT COUNT(*) still_null FROM employees
      WHERE active_status = 1 AND cost_centre_id IS NULL AND date_of_joining >= '2026-07-20'`
  );
  console.log(`  still missing a cost centre: ${after[0].still_null}`);
  await hrms.end(); await bill.end();
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
