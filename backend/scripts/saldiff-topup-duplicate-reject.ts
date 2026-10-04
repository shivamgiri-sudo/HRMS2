/**
 * Take the double-counted Aug 2026 WO_ADJ top-up lines out of payroll for 62516C, 62654C, 63107C.
 *
 * db_bill paid each a single "WO deduction adjustment" of 516. HR's native upload split that into
 * WO_ADJ 258 + SAL_DIFF 258 (BATCH-1788861217009-WO_ADJ / BATCH-1788861806993-SAL_DIFF, 8 Sep), and
 * the 3 Oct reconcile-aug-incentives run, comparing per type only, then topped WO_ADJ up by another
 * 258 -> 774 total against db_bill's 516. The payroll engine sums every line of an approved batch, so
 * the extra 258 each would be paid.
 *
 * Fix, reversible: the three top-up lines are MOVED into a new batch whose status is 'rejected'
 * (lines are kept, only their batch changes) and the source batch's totals are reduced to match.
 * Nothing is deleted. Undo = move the lines back.
 *
 * Guards (refuses unless ALL hold):
 *   - every candidate line is in a BATCH-DBBILL-TOPUP-2026-08-WO_ADJ-% batch, amount 258, for one of the 3 codes
 *   - the employee also holds approved native WO_ADJ 258 AND approved SAL_DIFF 258 for 2026-08, so that
 *     removing the top-up leaves exactly 516
 *   - no 2026-08 salary_prep_run is locked / finalized / disbursed / closed / paid
 *
 * Dry-run by default; --apply writes inside one transaction.
 *
 *   npx tsx scripts/saldiff-topup-duplicate-reject.ts [--apply]
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const APPLY = process.argv.includes("--apply");
const CODES = ["62516C", "62654C", "63107C"];
const ph = CODES.map(() => "?").join(",");
// Employee codes differ only by letter case in places (62516C / 62516c) and are the same value:
// every comparison below is on UPPER(code), in SQL and in JS.
const up = (v: unknown) => String(v ?? "").trim().toUpperCase();
const REJECT_REF = "BATCH-DBBILL-TOPUP-2026-08-WO_ADJ-DUPLICATE-REJECTED";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

async function main() {
  const runs = await q(`SELECT id, status, run_kind, total_employees FROM salary_prep_run WHERE run_month LIKE '2026-08%'`);
  console.log("== 2026-08 payroll runs =="); console.table(runs);
  const frozen = (runs as any[]).filter((r) => ["locked", "finalized", "finalised", "disbursed", "closed", "paid"]
    .includes(String(r.status).toLowerCase()));

  const lines = await q(
    `SELECT l.id, l.batch_id, l.employee_id, l.employee_code, l.amount, l.incentive_code, b.batch_ref, b.status batch_status
       FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
      WHERE b.pay_month = '2026-08' AND b.batch_ref LIKE 'BATCH-DBBILL-TOPUP-2026-08-WO_ADJ-%'
        AND b.batch_ref <> ? AND UPPER(TRIM(l.employee_code)) IN (${ph})`, [REJECT_REF, ...CODES]);
  console.log("== candidate top-up lines =="); console.table(lines);

  const stored = await q(
    `SELECT p.employee_code, p.status, p.incentive_total, p.net_salary, p.needs_recalculation
       FROM salary_prep_line p JOIN salary_prep_run r ON r.id = p.run_id
      WHERE r.run_month LIKE '2026-08%' AND UPPER(TRIM(p.employee_code)) IN (${ph})`, CODES);
  console.log("== stored Aug payroll lines for the 3 =="); console.table(stored);

  const problems: string[] = [];
  if (frozen.length) problems.push(`a 2026-08 run is already ${frozen.map((r: any) => r.status).join("/")} — payroll must decide on recovery`);
  if ((lines as any[]).length !== CODES.length) problems.push(`expected 3 top-up lines, found ${(lines as any[]).length}`);
  for (const l of lines as any[]) {
    if (Number(l.amount) !== 258 || l.incentive_code !== "WO_ADJ") problems.push(`${l.employee_code}: line is not WO_ADJ 258`);
    const own = await q(
      `SELECT l2.incentive_code, SUM(l2.amount) amt FROM incentive_upload_line l2 JOIN incentive_upload_batch b2 ON b2.id = l2.batch_id
        WHERE b2.pay_month = '2026-08' AND b2.status IN ('approved','applied') AND UPPER(TRIM(l2.employee_code)) = ?
          AND l2.incentive_code IN ('WO_ADJ','SAL_DIFF') GROUP BY l2.incentive_code`, [up(l.employee_code)]);
    const m = Object.fromEntries((own as any[]).map((r) => [r.incentive_code, Number(r.amt)]));
    console.log(`${l.employee_code}: approved WO_ADJ ${m.WO_ADJ ?? 0}, SAL_DIFF ${m.SAL_DIFF ?? 0} (WO_ADJ includes the top-up)`);
    if (m.WO_ADJ !== 516 || m.SAL_DIFF !== 258) problems.push(`${l.employee_code}: expected WO_ADJ 516 (incl. top-up) and SAL_DIFF 258`);
  }
  if (problems.length) {
    console.log("\nGuards not satisfied:\n - " + problems.join("\n - "));
    process.exitCode = 1;
    return;
  }
  console.log("\nAll guards hold: removing the top-up leaves each at WO_ADJ 258 + SAL_DIFF 258 = 516 (db_bill 516).");
  if (!APPLY) { console.log("Dry run only — pass --apply to move the 3 lines into a rejected batch."); return; }

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();
    const src = (lines as any[])[0];
    const newBatchId = randomUUID();
    await conn.execute(
      `INSERT INTO incentive_upload_batch
         (id, incentive_id, batch_ref, salary_month, uploaded_by, branch_id, process_id, total_employees, total_amount,
          status, cost_centre_id, remarks)
       SELECT ?, incentive_id, ?, salary_month, uploaded_by, branch_id, process_id, ?, ?, 'rejected', cost_centre_id,
              'Rejected: duplicate of the SAL_DIFF 258 already paid with WO_ADJ 258 (db_bill WO adjustment 516). Lines moved here, not deleted.'
         FROM incentive_upload_batch WHERE id = ?`,
      [newBatchId, REJECT_REF, CODES.length, 258 * CODES.length, src.batch_id]);
    for (const l of lines as any[]) {
      await logSensitiveAction({
        actor_user_id: "ops_saldiff_topup_reject",
        actor_role: "system:ops",
        action_type: "incentive_line_duplicate_rejected",
        module_key: "payroll_incentives",
        entity_type: "incentive_upload_line",
        entity_id: String(l.id),
        old_value_json: { batch_id: l.batch_id, batch_ref: l.batch_ref, amount: l.amount },
        new_value_json: { batch_id: newBatchId, batch_ref: REJECT_REF },
        reason: "Top-up double-counted WO_ADJ 258 already split from db_bill's 516 into WO_ADJ 258 + SAL_DIFF 258",
      });
      await conn.execute(`UPDATE incentive_upload_line SET batch_id = ? WHERE id = ? AND batch_id = ?`, [newBatchId, l.id, l.batch_id]);
    }
    const perBatch = new Map<string, number>();
    for (const l of lines as any[]) perBatch.set(String(l.batch_id), (perBatch.get(String(l.batch_id)) ?? 0) + 1);
    for (const [batchId, n] of perBatch) {
      await conn.execute(
        `UPDATE incentive_upload_batch SET total_employees = GREATEST(total_employees - ?, 0), total_amount = GREATEST(total_amount - ?, 0) WHERE id = ?`,
        [n, 258 * n, batchId]);
    }
    await conn.commit();
    console.log(`\nMoved ${(lines as any[]).length} lines into rejected batch ${REJECT_REF}.`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

main().then(() => process.exit()).catch((e) => { console.error(e); process.exit(1); });
