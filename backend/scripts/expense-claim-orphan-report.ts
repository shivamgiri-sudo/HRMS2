/**
 * Lists expense_claim rows whose employee_id is the migration placeholder — money entries
 * nobody can currently attribute to an employee.
 *
 * WHY THIS EXISTS
 *
 * expense_claim.employee_id is CHAR(36) NOT NULL, but the stored placeholder is 16 raw zero
 * BYTES (confirmed via LENGTH()/CHAR_LENGTH() = 16 — the packed-binary "nil UUID"), not 36
 * ASCII '0' characters as a first pass at this assumed. A bulk migration from
 * expense_migration_staging (1:1 row count match, 5,634 == 5,634) defaulted every
 * unresolvable reference to this value. 5,531 of those are vendor_bill/imprest rows, which
 * plausibly never had an individual employee to begin with. The other 100 are
 * expense_type='employee_claim'.
 *
 * READ THE DESCRIPTIONS BEFORE ASSUMING THESE ARE LOST PERSONAL CLAIMS. A run of this script
 * on 2026-08-12 shows the 100 are overwhelmingly office rent, ISP/telecom circuit bills,
 * security-service and housekeeping invoices, BGV and e-sign vendor charges — the shape of
 * facility/vendor overhead, not individual reimbursement. That suggests expense_type itself
 * may be the wrong field for these (should be vendor_bill, which correctly carries no
 * employee_id), not that an employee reference was lost. This script does NOT reclassify
 * anything — that is a Finance accounting decision (GL treatment, tax handling differ by
 * type), not a data-repair one. It only surfaces the rows so that decision can be made.
 *
 * These rows are also structurally invisible to every existing report while classified as
 * employee_claim: expenseReport.service.ts scopes every employee-claim view by process_id
 * derived from a JOIN through employees, and a row with no real employee_id has no
 * derivable process_id. This script is process-agnostic on purpose, so it is the only place
 * these 100 rows are currently visible at all.
 *
 * WHAT WAS CHECKED BEFORE CONCLUDING EMPLOYEE ATTRIBUTION (AS OPPOSED TO RECLASSIFICATION)
 * IS UNRECOVERABLE (2026-08-12)
 *
 *   - expense_migration_staging carries no employee_id, employee_code or employee_name
 *     column of any kind for these rows - only approved_by_str, description, remarks as
 *     free text, and zero staging rows are even tagged expense_type='employee_claim', so
 *     there is nothing to join back to for that specific angle.
 *   - No employees row exists at the zero-placeholder ID (ruled out silent misattribution
 *     to a real person - a LEFT JOIN correctly returns NULL for these rows everywhere).
 *
 * Per standing policy: no name-only or fuzzy matching, no guessing at which employee. This
 * writes nothing — it is a worklist for Finance to either reclassify (if these are vendor
 * spend, as the descriptions suggest) or resolve case by case from original records (if any
 * genuinely are personal claims that lost their attribution).
 *
 * Usage: npx tsx scripts/expense-claim-orphan-report.ts
 */
import { db } from "../src/db/mysql.js";

// The placeholder is 16 raw zero BYTES (the packed-binary "nil UUID"), not 36 ASCII '0'
// characters — confirmed via LENGTH()/CHAR_LENGTH() = 16 on the stored value. Matching on
// HEX() sidesteps any binary-literal escaping issues in the query layer.
const ZERO_HEX = "0".repeat(32);

(async () => {
  const [rows] = await db.query<any[]>(
    `SELECT id AS claim_id, expense_date, amount, currency, description, status,
            branch_id, finance_year, finance_month, created_at
       FROM expense_claim
      WHERE HEX(employee_id) = ? AND expense_type = 'employee_claim'
      ORDER BY expense_date ASC`,
    [ZERO_HEX],
  );

  console.log(`unattributed employee_claim rows: ${rows.length}`);
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  console.log(`total amount across them: ${totalAmount.toFixed(2)}`);

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log(`by status:`, JSON.stringify(byStatus));

  const byYearMonth: Record<string, { n: number; amount: number }> = {};
  for (const r of rows) {
    const key = `${r.finance_year ?? "?"}-${String(r.finance_month ?? "?").padStart(2, "0")}`;
    byYearMonth[key] = byYearMonth[key] ?? { n: 0, amount: 0 };
    byYearMonth[key].n++;
    byYearMonth[key].amount += Number(r.amount ?? 0);
  }
  console.log(`by finance period:`, JSON.stringify(byYearMonth, null, 2));

  console.log(`\nfull list (claim_id | date | amount | status | description):`);
  console.table(
    rows.map((r) => ({
      claim_id: r.claim_id,
      date: r.expense_date,
      amount: r.amount,
      status: r.status,
      description: String(r.description ?? "").slice(0, 60),
    })),
  );

  console.log(
    `\nThese ${rows.length} claims (${totalAmount.toFixed(2)} total) have no employee`,
    `attribution anywhere in this database. Read the descriptions above first — many look`,
    `like vendor/facility overhead (rent, telecom, security, housekeeping), which may mean`,
    `expense_type should be vendor_bill rather than employee_claim. That reclassification is`,
    `a Finance accounting call. For any that ARE genuine personal claims, resolution requires`,
    `original paper/email records identifying the submitter, worked case by case. Do not guess.`,
  );
  await db.end();
})().catch(async (e) => {
  console.error("ERR", e?.message ?? e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
