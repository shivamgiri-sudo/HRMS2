#!/usr/bin/env node
/**
 * Backfill employee_bank_detail from db_bill, corroborated by actual salary payments.
 *
 *   node scripts/backfill-bank-details-from-dbbill.mjs                    # dry run
 *   node scripts/backfill-bank-details-from-dbbill.mjs --apply            # phase 1 only
 *   node scripts/backfill-bank-details-from-dbbill.mjs --apply --fix-mismatches
 *   node scripts/backfill-bank-details-from-dbbill.mjs --apply --mark-verified
 *
 * ── Why ─────────────────────────────────────────────────────────────────────────
 *
 * The Payroll dashboard reports 130 active employees as "Missing Bank Account — cannot
 * be paid by NEFT". Measured 2026-08-28, only **4** of them are genuinely missing. The
 * other 126 have an account number and IFSC in `db_bill.masjclrentry`, 114 of those
 * carrying `AcValidationStatus = 'Yes'`.
 *
 * `masjclrentry` is not merely plausible — it is corroborated by money. Comparing every
 * active employee's most recent `db_bill.salary_data.AcNo` (the account a salary was
 * actually paid into; July-2026 run carries one on 1,469 of 1,502 lines) against the
 * register:
 *
 *     paid account vs masjclrentry          1,034 agree,  0 differ,  12 no row
 *     paid account vs employee_bank_detail    894 agree, 14 DIFFER, 138 absent
 *
 * Zero disagreements on 1,034 checkable cases. `masjclrentry.AcNo` is where the money
 * goes. `employee_bank_detail` is a small, partly-wrong subset of it.
 *
 * ── The three HRMS bank stores, and which one matters ───────────────────────────
 *
 *   employees.bank_account_number   frozen legacy, NO WRITER in the application.
 *                                   bank-advice pays to this. See the note at
 *                                   bank-payment-readiness.service.ts:760.
 *   employee_bank_detail            what neft-transfer-file and /bank-export pay to.
 *                                   977 rows for 1,120 active employees, verified=0
 *                                   on every one. THIS is what this script fills.
 *   candidate_onboarding_bank_detail  the penny-drop store. 27 verified rows out of
 *                                   32,798 — real, but not yet a usable source.
 *
 * ── Two phases, deliberately separate ───────────────────────────────────────────
 *
 * PHASE 1 (default): INSERT a primary row for an active employee who has NO usable
 *   bank record in HRMS. Purely additive — it cannot change an existing payment
 *   instruction, only supply one where there was none.
 *
 * PHASE 2 (--fix-mismatches): UPDATE the 14 employees whose HRMS row names a DIFFERENT
 *   account from the one their salary was actually paid into on 2026-07-31. This one
 *   changes where somebody gets paid, so it is opt-in. One of the 14 (MAS08226) holds
 *   a value like `4.57E+11` — Excel scientific notation, not an account number.
 *
 * `verified` is written as 0 unless --mark-verified. The NEFT export joins on
 * `active_status = 1 AND is_primary = 1` and does NOT read `verified`, so a 0 excludes
 * nobody from payment; it just declines to assert that HRMS itself verified an account
 * it imported. --mark-verified sets 1 only on rows corroborated by an actual payment.
 *
 * Every write is recorded in employee_bank_detail_backfill_log with the previous value,
 * so any phase reverses with one UPDATE joined to that table.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes('--apply');
const FIX_MISMATCHES = process.argv.includes('--fix-mismatches');
const MARK_VERIFIED = process.argv.includes('--mark-verified');

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = readEnv(path.join(__dirname, '..', '.env'));

const s = (v) => String(v ?? '').trim();
const mask = (a) => (a.length > 4 ? '*'.repeat(a.length - 4) + a.slice(-4) : a);

/**
 * An account number we are willing to write into a payment file.
 *
 * Digits only, 6–20 long. This is the guard that rejects the Excel damage the legacy
 * exports carry — `4.57E+11` passes a naive "is it non-empty" check and would be sent
 * to a bank. IFSC is required alongside: an account without one cannot be routed.
 */
function usableAccount(acc, ifsc) {
  return /^[0-9]{6,20}$/.test(s(acc)) && /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(s(ifsc));
}

const LOG_DDL = `
  CREATE TABLE IF NOT EXISTS employee_bank_detail_backfill_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    employee_id CHAR(36) NOT NULL,
    employee_code VARCHAR(64) NULL,
    bank_detail_id CHAR(36) NULL,
    account_before VARCHAR(64) NULL,
    account_after VARCHAR(64) NOT NULL,
    ifsc_before VARCHAR(32) NULL,
    ifsc_after VARCHAR(32) NULL,
    source VARCHAR(48) NOT NULL,
    corroborated_by_payment TINYINT(1) NOT NULL DEFAULT 0,
    phase VARCHAR(32) NOT NULL,
    written_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_bank_backfill_employee (employee_id)
  )
  -- utf8mb4_unicode_ci matches this schema's prevailing collation, but note that
  -- CONVERT(... USING utf8mb4) yields the CONNECTION collation (utf8mb4_0900_ai_ci on
  -- MySQL 8), so any comparison between the two needs an explicit COLLATE — see the
  -- self-heal DELETE below, which failed with ER_CANT_AGGREGATE_2COLLATIONS without one.
  ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function main() {
  const hrms = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  const bill = await mysql.createConnection({
    host: env.BILL_DB_HOST, port: Number(env.BILL_DB_PORT || 3306),
    user: env.BILL_DB_USER, password: env.BILL_DB_PASSWORD || env.BILL_DB_PASS,
    database: env.BILL_DB_NAME,
  });

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`
    + `${FIX_MISMATCHES ? ' +phase2(mismatches)' : ''}`
    + `${MARK_VERIFIED ? ' +mark-verified' : ''}`);

  const [employees] = await hrms.query(
    `SELECT id, employee_code FROM employees
      WHERE active_status = 1 AND employee_code IS NOT NULL AND TRIM(employee_code) <> ''`,
  );
  const codes = employees.map((e) => s(e.employee_code));

  // Existing PRIMARY bank rows in HRMS. account_number is binary — convert for compare.
  const [existing] = await hrms.query(
    `SELECT e.employee_code, bd.id, CONVERT(bd.account_number USING utf8mb4) acc,
            CONVERT(bd.ifsc_code USING utf8mb4) ifsc
       FROM employees e
       JOIN employee_bank_detail bd ON bd.employee_id = e.id
      WHERE e.active_status = 1 AND bd.is_primary = 1 AND bd.active_status = 1`,
  );
  const hrmsRow = new Map(existing.map((r) => [s(r.employee_code), r]));

  // db_bill is MySQL 5.5 — no CTEs, no window functions. Read and fold in JS.
  const [reg] = await bill.query(
    `SELECT EmpCode, AcNo, IFSCCode, AcBank, AcBranch, AccHolder, AccType, AcValidationStatus
       FROM masjclrentry WHERE EmpCode IN (?)`, [codes]);
  const register = new Map();
  for (const r of reg) {
    const k = s(r.EmpCode);
    if (!register.has(k) || s(r.AcNo)) register.set(k, r);
  }

  // Most recent account a salary was actually paid into. ORDER BY ascending so the last
  // write into the map is the newest.
  const [sal] = await bill.query(
    `SELECT EmpCode, AcNo, SalDate FROM salary_data
      WHERE EmpCode IN (?) AND TRIM(COALESCE(AcNo,'')) <> '' ORDER BY SalDate ASC`, [codes]);
  const paid = new Map();
  for (const r of sal) paid.set(s(r.EmpCode), { acc: s(r.AcNo), on: String(r.SalDate).slice(0, 10) });

  const inserts = [];
  const updates = [];
  const skipped = { noRegisterRow: 0, unusableAccount: 0, alreadyCorrect: 0 };

  for (const emp of employees) {
    const code = s(emp.employee_code);
    const r = register.get(code);
    const p = paid.get(code);
    const have = hrmsRow.get(code);

    // Prefer the account money actually reached; fall back to the register.
    const chosen = p?.acc && usableAccount(p.acc, r?.IFSCCode) ? p.acc : s(r?.AcNo);
    const ifsc = s(r?.IFSCCode);

    if (!r) { skipped.noRegisterRow += 1; continue; }
    if (!usableAccount(chosen, ifsc)) { skipped.unusableAccount += 1; continue; }

    const row = {
      employee_id: emp.id, employee_code: code, account: chosen, ifsc,
      bank: s(r.AcBank), branch: s(r.AcBranch), holder: s(r.AccHolder), type: s(r.AccType),
      corroborated: Boolean(p && p.acc === chosen),
      paidOn: p?.on ?? null,
      registerValidated: s(r.AcValidationStatus).toLowerCase() === 'yes',
    };

    // Three cases, and the difference matters: only the third is risky.
    //
    //   no row at all            -> insert            (phase 1)
    //   row with NO usable acct  -> fill it in        (phase 1) — an empty or
    //                               Excel-mangled value is not a payment instruction,
    //                               so writing over it cannot redirect anyone's salary
    //   row with a DIFFERENT
    //     usable account         -> genuine conflict  (phase 2, opt-in)
    //
    // The first dry run lumped case 2 into phase 2 and reported 75 "mismatches" when
    // only 14 are real — presenting 61 harmless fills as decisions to move a salary.
    if (!have) { inserts.push(row); continue; }
    const held = s(have.acc);
    if (held === chosen) { skipped.alreadyCorrect += 1; continue; }
    if (!usableAccount(held, have.ifsc)) {
      inserts.push({ ...row, bankDetailId: have.id, before: held, ifscBefore: s(have.ifsc), fillEmpty: true });
      continue;
    }
    updates.push({ ...row, bankDetailId: have.id, before: held, ifscBefore: s(have.ifsc) });
  }

  console.log(`\nactive employees            : ${employees.length}`);
  const newRows = inserts.filter((i) => !i.fillEmpty).length;
  console.log(`phase 1  supply an account : ${inserts.length}  (${newRows} new row, ${inserts.length - newRows} fill blank/mangled)`
    + `   (${inserts.filter((i) => i.corroborated).length} corroborated by an actual payment)`);
  console.log(`phase 2  REDIRECT (real clash): ${updates.length}`
    + `${FIX_MISMATCHES ? '' : '  (skipped — pass --fix-mismatches)'}`);
  console.log(`skipped  no masjclrentry row : ${skipped.noRegisterRow}`);
  console.log(`skipped  unusable acct/IFSC  : ${skipped.unusableAccount}`);
  console.log(`skipped  already correct     : ${skipped.alreadyCorrect}`);

  if (updates.length) {
    console.log('\nPhase 2 detail — HRMS holds vs actually paid:');
    for (const u of updates) {
      console.log(`  ${u.employee_code.padEnd(10)} ${mask(u.before).padEnd(20)} -> ${mask(u.account).padEnd(20)} paid ${u.paidOn ?? '—'}`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written.');
    await hrms.end(); await bill.end();
    return;
  }

  await hrms.query(LOG_DDL);

  // Self-heal: drop any log entry whose claimed change is not what the row actually
  // holds. Such an entry can only come from a write that was logged but did not land,
  // and leaving it in place is worse than having no log — the documented reversal
  // joins on it and would "restore" a value that was never replaced.
  const [stale] = await hrms.query(
    `DELETE l FROM employee_bank_detail_backfill_log l
       JOIN employee_bank_detail bd ON bd.id = l.bank_detail_id
      WHERE l.phase IN ('fill_unusable', 'fix_mismatch')
        AND COALESCE(CONVERT(bd.account_number USING utf8mb4), '')
              COLLATE utf8mb4_unicode_ci <> l.account_after`,
  );
  if (stale.affectedRows) console.log(`
cleared ${stale.affectedRows} stale log entries from an earlier partial run`);

  let done = 0;

  for (const row of inserts) {
    const verified = MARK_VERIFIED && row.corroborated ? 1 : 0;
    if (row.fillEmpty) {
      // Existing primary row whose account is blank or Excel-mangled. Update in place
      // rather than inserting a second primary row for the same employee.
      //
      // COALESCE on the guard, not a bare equality. account_number is NULL on 61 of
      // these 62 rows, and `CONVERT(NULL USING utf8mb4) = ''` evaluates to NULL, not
      // true — so the first run of this script matched exactly one row, reported
      // "Wrote 97" against 158 planned, and left the other 61 untouched.
      const [res] = await hrms.query(
        `UPDATE employee_bank_detail SET account_number = ?, ifsc_code = ?, verified = ?
          WHERE id = ? AND COALESCE(CONVERT(account_number USING utf8mb4), '') = ?`,
        [row.account, row.ifsc, verified, row.bankDetailId, row.before],
      );
      if (!res.affectedRows) continue;
      // Logged AFTER the write, so the log records what happened rather than what was
      // attempted. The first run logged first and left 61 entries claiming changes that
      // never landed — entries whose reversal query would have set live accounts to NULL.
      await hrms.query(
        `INSERT INTO employee_bank_detail_backfill_log
           (employee_id, employee_code, bank_detail_id, account_before, account_after,
            ifsc_before, ifsc_after, source, corroborated_by_payment, phase)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fill_unusable')`,
        [row.employee_id, row.employee_code, row.bankDetailId, row.before || null, row.account,
         row.ifscBefore || null, row.ifsc, row.corroborated ? 'salary_data' : 'masjclrentry',
         row.corroborated ? 1 : 0],
      );
      done += 1;
      continue;
    }
    const id = crypto.randomUUID();
    await hrms.query(
      `INSERT INTO employee_bank_detail
         (id, employee_id, is_primary, account_seq, bank_name, account_holder_name,
          bank_branch, account_number, ifsc_code, account_type, verified, active_status)
       VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, row.employee_id, row.bank || null, row.holder || null, row.branch || null,
       row.account, row.ifsc, row.type || null, verified],
    );
    await hrms.query(
      `INSERT INTO employee_bank_detail_backfill_log
         (employee_id, employee_code, bank_detail_id, account_before, account_after,
          ifsc_before, ifsc_after, source, corroborated_by_payment, phase)
       VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'insert_missing')`,
      [row.employee_id, row.employee_code, id, row.account, row.ifsc,
       row.corroborated ? 'salary_data' : 'masjclrentry', row.corroborated ? 1 : 0],
    );
    done += 1;
  }

  if (FIX_MISMATCHES) {
    for (const u of updates) {
      await hrms.query(
        `INSERT INTO employee_bank_detail_backfill_log
           (employee_id, employee_code, bank_detail_id, account_before, account_after,
            ifsc_before, ifsc_after, source, corroborated_by_payment, phase)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fix_mismatch')`,
        [u.employee_id, u.employee_code, u.bankDetailId, u.before, u.account,
         u.ifscBefore || null, u.ifsc, u.corroborated ? 'salary_data' : 'masjclrentry',
         u.corroborated ? 1 : 0],
      );
      // Guarded on the value we read, so a concurrent edit by HR wins rather than
      // being overwritten by a number this script decided on minutes earlier.
      const [res] = await hrms.query(
        `UPDATE employee_bank_detail
            SET account_number = ?, ifsc_code = ?,
                verified = ?
          WHERE id = ? AND CONVERT(account_number USING utf8mb4) = ?`,
        [u.account, u.ifsc, MARK_VERIFIED && u.corroborated ? 1 : 0, u.bankDetailId, u.before],
      );
      if (res.affectedRows) done += 1;
    }
  }

  console.log(`\nWrote ${done} rows. Reversal:`);
  console.log(`  phase 1: DELETE bd FROM employee_bank_detail bd JOIN employee_bank_detail_backfill_log l `
    + `ON l.bank_detail_id = bd.id WHERE l.phase = 'insert_missing';`);
  console.log(`  phase 2: UPDATE employee_bank_detail bd JOIN employee_bank_detail_backfill_log l `
    + `ON l.bank_detail_id = bd.id SET bd.account_number = l.account_before, bd.ifsc_code = l.ifsc_before `
    + `WHERE l.phase = 'fix_mismatch';`);

  await hrms.end();
  await bill.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
