#!/usr/bin/env node
/**
 * Repair leave_request rows whose status was mis-mapped by the db_bill import.
 *
 *   node scripts/repair-legacy-leave-status.mjs                 # dry run, prints the plan
 *   node scripts/repair-legacy-leave-status.mjs --apply         # phase 1 only
 *   node scripts/repair-legacy-leave-status.mjs --apply --include-approved
 *
 * ── What is wrong ───────────────────────────────────────────────────────────────
 *
 * db_bill.leave_management.Status holds exactly four values:
 *
 *     Approved       31,540
 *     Not Approved      718     <- terminal; 548 of them carry a DisApprovedReason
 *     '' (blank)         34     <- all 34 also carry a DisApprovedReason
 *     NULL               16     <- genuinely undecided, no reason, no approver
 *
 * "Not Approved" contains the substring "approve", and more than one import path tested
 * for approval before rejection. Cross-mapping every mas_hrms row that carries a
 * legacy_leave_id against its db_bill source on 2026-08-28 gave:
 *
 *     Approved     -> approved     26,549   correct
 *     Not Approved -> pending         514   WRONG: shows as an approval queue
 *     Not Approved -> approved         77   WRONG: counts toward leave balances
 *     Not Approved -> rejected         31   correct
 *     '' (blank)   -> pending          33   WRONG: source carries a disapproval reason
 *     '' (blank)   -> approved          1   WRONG: same
 *     NULL         -> pending           4   correct (undecided in the source too)
 *     NULL         -> approved          1   WRONG: nothing approved it
 *
 * The 547 pending rows are why "Pending Leave Approvals" read 171 branch-scoped / 586
 * org-wide with nothing in it actionable — every one of the 586 has a to_date in the
 * past, and 415 belong to employees who have since left.
 *
 * ── Two phases, deliberately separate ───────────────────────────────────────────
 *
 * PHASE 1 (default): pending -> rejected, for rows the source had already decided.
 *   Balance-neutral. Leave balances are computed from APPROVED requests
 *   (leave-balance-report.test.ts pins that pending/rejected/cancelled do not count),
 *   so moving a row between two non-approved states cannot change a balance, a payslip
 *   or a payable-days figure. AWOL detection ignores them too: it looks for leave
 *   covering the last 10 days and the newest affected row has to_date 2026-07-30.
 *
 * PHASE 2 (--include-approved): approved -> rejected, for the 79 rows the source
 *   rejected but which were imported as approved. This one DOES change leave balances
 *   — 200 leave days in total, 39 of them in the current 2026 leave year — so it is
 *   opt-in and should be run only with payroll's agreement, and not against a month
 *   whose payroll run is already finalized.
 *
 * Neither phase touches a row without a legacy_leave_id, so nothing an employee filed
 * in HRMS is affected. Every change is written to leave_request_status_repair_log
 * (created on first run) with the before value, so the whole run is reversible.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes('--apply');
const INCLUDE_APPROVED = process.argv.includes('--include-approved');

/** backend/.env stores values wrapped in double quotes — strip them or auth fails. */
function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv(path.join(__dirname, '..', '.env'));

const REPAIR_LOG_DDL = `
  CREATE TABLE IF NOT EXISTS leave_request_status_repair_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    leave_request_id CHAR(36) NOT NULL,
    legacy_leave_id BIGINT NULL,
    legacy_source_status VARCHAR(64) NULL,
    status_before VARCHAR(50) NOT NULL,
    status_after VARCHAR(50) NOT NULL,
    phase VARCHAR(32) NOT NULL,
    repaired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_repair_leave_request (leave_request_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/**
 * Terminal in db_bill: either the status literally says so, or the status was blanked
 * but a disapproval reason survives. NULL status with no reason is NOT terminal — that
 * row was genuinely never decided and stays pending.
 */
function isDecidedRejection(row) {
  const status = (row.Status ?? '').trim().toLowerCase();
  const hasReason = Boolean(row.DisApprovedReason && String(row.DisApprovedReason).trim());
  if (status === 'not approved' || status.includes('reject') || status.includes('disapprove')) return true;
  if (status === '' && row.Status !== null && hasReason) return true;
  return false;
}

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

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${INCLUDE_APPROVED ? ' (+phase 2, approved rows)' : ''}`);

  const [hrmsRows] = await hrms.query(
    `SELECT id, legacy_leave_id, status, from_date, to_date, total_days
       FROM leave_request
      WHERE legacy_leave_id IS NOT NULL
        AND status IN ('pending', 'approved')`,
  );
  // db_bill is MySQL 5.5 — no CTEs, no window functions. A plain full read of a
  // 32k-row table is cheaper than 30k round trips.
  const [billRows] = await bill.query(
    `SELECT Id, Status, DisApprovedReason FROM leave_management`,
  );
  const source = new Map(billRows.map((r) => [String(r.Id), r]));

  const phase1 = [];   // pending  -> rejected
  const phase2 = [];   // approved -> rejected
  let unmatched = 0;

  for (const row of hrmsRows) {
    const src = source.get(String(row.legacy_leave_id));
    if (!src) { unmatched += 1; continue; }
    if (!isDecidedRejection(src)) continue;
    (row.status === 'pending' ? phase1 : phase2).push({ row, src });
  }

  const days = (list) => list.reduce((sum, e) => sum + Number(e.row.total_days ?? 0), 0);
  console.log(`\nphase 1  pending  -> rejected : ${phase1.length} rows, ${days(phase1)} leave days`);
  console.log(`phase 2  approved -> rejected : ${phase2.length} rows, ${days(phase2)} leave days`
    + `${INCLUDE_APPROVED ? '' : '  (skipped — pass --include-approved)'}`);
  if (unmatched) console.log(`\n${unmatched} rows carry a legacy_leave_id with no db_bill row; left untouched.`);

  const planned = [
    ...phase1.map((e) => ({ ...e, from: 'pending', phase: 'pending_to_rejected' })),
    ...(INCLUDE_APPROVED ? phase2.map((e) => ({ ...e, from: 'approved', phase: 'approved_to_rejected' })) : []),
  ];

  if (!APPLY) {
    console.log('\nDry run — nothing written. Sample of what would change:');
    for (const e of planned.slice(0, 10)) {
      console.log(`  ${e.row.id}  legacy ${e.row.legacy_leave_id}  ${e.from} -> rejected`
        + `  (${String(e.row.from_date).slice(0, 10)} .. ${String(e.row.to_date).slice(0, 10)},`
        + ` source "${e.src.Status ?? 'NULL'}")`);
    }
    await hrms.end(); await bill.end();
    return;
  }

  await hrms.query(REPAIR_LOG_DDL);
  let done = 0;
  for (const e of planned) {
    await hrms.query(
      `INSERT INTO leave_request_status_repair_log
         (leave_request_id, legacy_leave_id, legacy_source_status, status_before, status_after, phase)
       VALUES (?, ?, ?, ?, 'rejected', ?)`,
      [e.row.id, e.row.legacy_leave_id, e.src.Status, e.from, e.phase],
    );
    // Guarded on the status we read, so a concurrent decision by a real approver
    // between the SELECT above and this UPDATE wins instead of being overwritten.
    const [res] = await hrms.query(
      `UPDATE leave_request
          SET status = 'rejected',
              rejection_reason = COALESCE(NULLIF(TRIM(rejection_reason), ''),
                                          'Imported from db_bill as Not Approved; status corrected 2026-08-28')
        WHERE id = ? AND status = ?`,
      [e.row.id, e.from],
    );
    if (res.affectedRows) done += 1;
  }
  console.log(`\nUpdated ${done} of ${planned.length} rows. Reversal: `
    + `UPDATE leave_request lr JOIN leave_request_status_repair_log l ON l.leave_request_id = lr.id `
    + `SET lr.status = l.status_before WHERE l.phase = '<phase>';`);

  await hrms.end();
  await bill.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
