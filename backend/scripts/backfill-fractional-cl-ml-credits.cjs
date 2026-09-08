/**
 * Round fractional scheduled CL/ML credits up to the whole day the schedule says they are.
 *
 * WHY THIS EXISTS
 * ---------------
 * leave-monthly-credit.worker.ts multiplied `leave_credit_schedule.credit_days` by
 * prorateMonthlyCredit(), so an employee who joined part-way through a credit month received a
 * fraction of the scheduled day - someone who joined 24-Aug-2026 got 8/31 of a Casual Leave,
 * and their Employee Stat Card read "0.3". Confirmed with the business on 2026-09-08: the
 * scheduled credit is a whole day or nothing, and a fraction of a leave day cannot be applied
 * for anyway, since leave is taken in whole or half days.
 *
 * The worker is fixed forward (isAccruingInMonth in leave-policy.service.ts). This script
 * repairs the balances already written.
 *
 * HOW IT COMPUTES THE CORRECTION
 * ------------------------------
 * It does NOT round the ledger total. leave_balance_ledger.allocated_days is a running SUM of
 * every monthly credit, so a total like 3.7 is 1 + 1 + 1 + 0.7 and rounding the total to 4
 * would be a guess that happens to be right. Instead each row in leave_el_credit_log - the
 * per-month audit of what was actually credited - is compared with the schedule for that
 * month, and the ledger is moved by the exact difference. The log and the ledger therefore
 * stay reconciled, which they would not if only the ledger were touched.
 *
 * DELIBERATELY OUT OF SCOPE: July-2026 ML
 * ---------------------------------------
 * 1,381 rows credit ML at 0.42 in July 2026. leave_credit_schedule has NO ML row for July -
 * these are the last survivors of the pre-schedule fractional rule (ML 0.417/month). They are
 * not a proration of a scheduled day, so this script leaves them alone: rounding them to 1.0
 * would grant ~576 days of leave the schedule never intended, and deleting them would take
 * back leave employees already hold. That is a business decision, not a repair.
 *
 * SAFETY
 *   - dry run unless --apply;
 *   - only ever INCREASES a credit, never reduces one, and only where a schedule row exists;
 *   - each ledger move is the exact delta for one logged credit, so re-running finds nothing;
 *   - writes the before/after plan to backend/backups/ before any write.
 *
 * Usage:
 *   node scripts/backfill-fractional-cl-ml-credits.cjs            # dry run
 *   node scripts/backfill-fractional-cl-ml-credits.cjs --apply    # writes
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

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

async function connectAny(hosts, database, label) {
  for (const host of hosts) {
    try {
      const c = await mysql.createConnection({
        host, user: pick('DB_USER'), password: pick('DB_PASSWORD'), database, connectTimeout: 20000,
      });
      console.log(`  ${label}: connected via ${host}`);
      return c;
    } catch (e) { console.log(`  ${label}: ${host} -> ${e.code}`); }
  }
  throw new Error(`${label} unreachable on every known address`);
}

(async () => {
  console.log(APPLY ? '=== APPLY MODE - this will write ===' : '=== DRY RUN - no writes ===');
  const db = await connectAny(
    [pick('DB_HOST', '192.168.10.6'), '122.184.128.90'], pick('DB_NAME', 'mas_hrms'), 'mas_hrms'
  );

  try {
    // Every logged monthly CL/ML credit that came in under the scheduled whole day.
    const [short] = await db.query(
      `SELECT l.id            AS log_id,
              l.employee_id,
              l.leave_type_id,
              l.credit_year,
              l.credit_month,
              lt.leave_code,
              l.days_credited AS credited,
              s.credit_days   AS scheduled,
              e.employee_code
         FROM leave_el_credit_log l
         JOIN leave_type_master   lt ON lt.id = l.leave_type_id
         JOIN leave_credit_schedule s
              ON s.month = l.credit_month AND s.leave_code = lt.leave_code
         LEFT JOIN employees e ON e.id = l.employee_id
        WHERE l.credit_type = 'monthly'
          AND lt.leave_code IN ('CL','ML')
          AND l.days_credited < s.credit_days
        ORDER BY l.credit_year, l.credit_month, lt.leave_code`
    );

    if (short.length === 0) {
      console.log('\nNo short-credited scheduled CL/ML rows found. Nothing to do.');
      return;
    }

    const byMonth = {};
    let totalDelta = 0;
    for (const r of short) {
      const delta = Number(r.scheduled) - Number(r.credited);
      totalDelta += delta;
      const k = `${r.credit_year}-${String(r.credit_month).padStart(2, '0')} ${r.leave_code}`;
      byMonth[k] = byMonth[k] || { rows: 0, days: 0 };
      byMonth[k].rows++;
      byMonth[k].days += delta;
    }

    console.log(`\nShort-credited scheduled CL/ML rows: ${short.length}`);
    console.log(`Employees affected:                  ${new Set(short.map(r => r.employee_id)).size}`);
    console.log(`Leave days to be added in total:     ${totalDelta.toFixed(2)}\n`);
    for (const [k, v] of Object.entries(byMonth).sort()) {
      console.log(`  ${k}  ${String(v.rows).padStart(5)} rows  +${v.days.toFixed(2)} days`);
    }

    // Ledger totals before, so the write can be checked against them afterwards.
    const [before] = await db.query(
      `SELECT lt.leave_code,
              COUNT(*)                                              AS rows_2026,
              SUM(b.allocated_days <> ROUND(b.allocated_days))      AS fractional,
              ROUND(SUM(b.allocated_days), 2)                       AS total_allocated
         FROM leave_balance_ledger b
         JOIN leave_type_master lt ON lt.id = b.leave_type_id
        WHERE b.balance_year = 2026 AND lt.leave_code IN ('CL','ML')
        GROUP BY lt.leave_code`
    );
    console.log('\nleave_balance_ledger 2026 BEFORE:');
    for (const r of before) {
      console.log(`  ${r.leave_code}  ${r.rows_2026} rows, ${r.fractional} fractional, ${r.total_allocated} days allocated`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.resolve(__dirname, '..', 'backups');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `fractional-cl-ml-backfill-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ before, byMonth, rows: short }, null, 2));
    console.log(`\nPlan written to ${outFile}`);

    if (!APPLY) {
      console.log('\nDRY RUN - nothing written. Re-run with --apply to correct these balances.');
      return;
    }

    let done = 0;
    for (const r of short) {
      const delta = Number((Number(r.scheduled) - Number(r.credited)).toFixed(2));
      if (!(delta > 0)) continue;

      // The ledger moves by the delta rather than being set to a computed total: the ledger
      // also carries manual adjustments, and overwriting it would erase them.
      const [res] = await db.execute(
        `UPDATE leave_balance_ledger
            SET allocated_days = allocated_days + ?, updated_at = NOW()
          WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [delta, r.employee_id, r.leave_type_id, r.credit_year]
      );
      if (res.affectedRows === 0) {
        // No ledger row means the credit was logged but never landed. Correcting the log
        // alone would make the two disagree in the opposite direction, so leave both.
        console.log(`  SKIP ${r.employee_code ?? r.employee_id} ${r.leave_code} ${r.credit_year}-${r.credit_month}: no ledger row`);
        continue;
      }
      await db.execute(
        `UPDATE leave_el_credit_log SET days_credited = ? WHERE id = ?`,
        [Number(r.scheduled), r.log_id]
      );
      done++;
      if (done % 100 === 0) console.log(`  ... ${done}/${short.length}`);
    }

    const [after] = await db.query(
      `SELECT lt.leave_code,
              COUNT(*)                                         AS rows_2026,
              SUM(b.allocated_days <> ROUND(b.allocated_days)) AS fractional,
              ROUND(SUM(b.allocated_days), 2)                  AS total_allocated
         FROM leave_balance_ledger b
         JOIN leave_type_master lt ON lt.id = b.leave_type_id
        WHERE b.balance_year = 2026 AND lt.leave_code IN ('CL','ML')
        GROUP BY lt.leave_code`
    );
    console.log('\nleave_balance_ledger 2026 AFTER:');
    for (const r of after) {
      console.log(`  ${r.leave_code}  ${r.rows_2026} rows, ${r.fractional} fractional, ${r.total_allocated} days allocated`);
    }
    console.log(`\nDone. Credits corrected: ${done}.`);
    console.log('Remaining CL fractions should be 0. Remaining ML fractions are the July-2026');
    console.log('pre-schedule 0.42 credits, which this script deliberately does not touch.');
  } finally {
    await db.end();
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
