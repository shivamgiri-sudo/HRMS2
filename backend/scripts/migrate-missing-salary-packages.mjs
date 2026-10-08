/**
 * migrate-missing-salary-packages.mjs
 *
 * Fills the gaps found by audit-salary-package-parity.mjs. Additive only —
 * never updates or deletes an existing row.
 *
 *   db_bill.mas_packagemaster            -> mas_hrms.salary_package_master
 *   db_bill.mas_packagemaster_state_wise -> mas_hrms.salary_package_state_wise
 *
 * What it inserts:
 *   - Every db_bill package whose `id` has no salary_package_master row with
 *     that (source_db='db_bill', source_id). Skips placeholder rows (CTC=0 AND
 *     Gross=0) — 31 of the 87 missing ids in db_bill are empty rows nobody
 *     completed, not real packages.
 *   - Every db_bill state-wise package row — salary_package_state_wise currently
 *     holds 0 of 13.
 *
 * Does NOT touch the 11 divergent packages or the 142 surplus duplicate rows
 * found by the audit — those need a human decision (which amount is current;
 * which duplicate to keep), not a mechanical migration.
 *
 * Safe to re-run: keyed on source_id, so a row already migrated is skipped.
 *
 * Usage:
 *   node backend/scripts/migrate-missing-salary-packages.mjs            # dry run
 *   node backend/scripts/migrate-missing-salary-packages.mjs --apply
 */
import crypto from 'crypto';
import { connect } from './lib/db-connect.mjs';
import { num } from './lib/dbbill-salary-mapping.mjs';

const arg = (n, fb) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? fb;
const APPLY = process.argv.includes('--apply');
const log = m => process.stdout.write(m + '\n');
const uuid = () => crypto.randomUUID();

async function main() {
  const hrms = await connect('mas_hrms', { host: arg('hrms-host', null), log });
  const bill = await connect('db_bill', { host: arg('bill-host', null), log });

  log(`mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // ── 1. salary_package_master ────────────────────────────────────────────
  const [bp] = await bill.query('SELECT * FROM mas_packagemaster');
  const [existing] = await hrms.query(
    `SELECT source_id FROM salary_package_master WHERE source_db = 'db_bill'`);
  const have = new Set(existing.map(r => String(r.source_id)));

  const toInsert = bp.filter(b =>
    !have.has(String(b.id)) && !(num(b.CTC) === 0 && num(b.Gross) === 0));
  const placeholders = bp.filter(b =>
    !have.has(String(b.id)) && num(b.CTC) === 0 && num(b.Gross) === 0);

  log(`\n=== salary_package_master ===`);
  log(`  db_bill rows                 ${bp.length}`);
  log(`  already in mas_hrms          ${have.size}`);
  log(`  missing, will insert         ${toInsert.length}`);
  log(`  missing, skipped (empty)     ${placeholders.length}  (CTC=0 and Gross=0 in db_bill itself)`);

  if (APPLY) {
    let inserted = 0;
    for (const b of toInsert) {
      await hrms.execute(
        `INSERT INTO salary_package_master
           (id, branch_name, cost_centre_code, band_code, package_amount,
            basic, hra, lta, conveyance, portfolio, medical, special_allowance,
            other_allowance, bonus, pli, gross, epf_employee, esic_employee,
            professional_tax, net_in_hand, epf_employer, esic_employer,
            admin_charges, ctc, active_status, source_db, source_id, created_by)
         VALUES (?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?,?,1,'db_bill',?,'migrate-missing-salary-packages')`,
        [uuid(), b.BranchName, b.CostCenter, b.Band, num(b.PackageAmount),
         num(b.Basic), num(b.HRA), 0 /* db_bill mas_packagemaster carries no LTA column */, num(b.Conveyance),
         num(b.Portfolio), num(b.Medical), num(b.Special),
         num(b.OtherAllow), num(b.Bonus), num(b.PLI), num(b.Gross),
         num(b.EPF), num(b.ESIC), num(b.Professional), num(b.NetInHand),
         num(b.EPFCO), num(b.ESICCO), num(b.Admin), num(b.CTC), b.id]
      );
      inserted++;
    }
    log(`  inserted                     ${inserted}`);
  } else {
    log('\n  Sample of rows that would be inserted:');
    for (const b of toInsert.slice(0, 10)) {
      log(`    id=${b.id}  ${String(b.BranchName ?? '').padEnd(24)} band=${b.Band}  CTC=${num(b.CTC)}`);
    }
    if (toInsert.length > 10) log(`    ... and ${toInsert.length - 10} more`);
  }

  // ── 2. salary_package_state_wise ────────────────────────────────────────
  const [bs] = await bill.query('SELECT * FROM mas_packagemaster_state_wise');
  const [existingS] = await hrms.query('SELECT source_id FROM salary_package_state_wise');
  const haveS = new Set(existingS.map(r => String(r.source_id)));
  const toInsertS = bs.filter(s => !haveS.has(String(s.id)));

  log(`\n=== salary_package_state_wise ===`);
  log(`  db_bill rows                 ${bs.length}`);
  log(`  already in mas_hrms          ${haveS.size}`);
  log(`  missing, will insert         ${toInsertS.length}`);

  if (APPLY) {
    let inserted = 0;
    for (const s of toInsertS) {
      await hrms.execute(
        `INSERT INTO salary_package_state_wise
           (id, state_name, package_type, branch_name, cost_centre_code, band_code,
            package_amount, basic, conveyance, hra, lta, bonus, gross,
            epf_employee, esic_employee, net_in_hand, epf_employer, esic_employer,
            admin_charges, ctc, active_status, source_id)
         VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,1,?)`,
        [uuid(), s.StateName, s.PackageType, s.BranchName, s.CostCenter, s.Band,
         num(s.PackageAmount), num(s.Basic), num(s.Conveyance), num(s.HRA), 0, num(s.Bonus), num(s.Gross),
         num(s.EPF), num(s.ESIC), num(s.NetInHand), num(s.EPFCO), num(s.ESICCO),
         num(s.Admin), num(s.CTC), s.id]
      );
      inserted++;
    }
    log(`  inserted                     ${inserted}`);
  } else {
    log('\n  Sample of rows that would be inserted:');
    for (const s of toInsertS.slice(0, 10)) {
      log(`    id=${s.id}  ${s.StateName}  ${s.PackageType}  CTC=${num(s.CTC)}`);
    }
  }

  if (!APPLY) log('\nDRY RUN — nothing was written. Re-run with --apply.');
  await hrms.end(); await bill.end();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
