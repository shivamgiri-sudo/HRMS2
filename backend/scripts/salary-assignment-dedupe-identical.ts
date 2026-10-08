/**
 * Deactivate the redundant copy of identical active employee_salary_assignment rows.
 *
 * Ten employees (MAS63412..MAS63421) carry two ACTIVE rows with the same ctc_annual (199,056) and the
 * same structure (ss-std-001); the second was written by a bulk run on 31 Aug with effective_from
 * 2026-09-01. Any reader that takes one row without ordering gets the same figure either way, so this
 * is tidy-up, not a pay fix — but two active rows is a trap for the next change.
 *
 * Which row stays: the one with the EARLIEST effective_from (ties: earliest created_at). A reader that
 * filters on effective_from <= the month being computed still finds a row for August; keeping the
 * 1 Sep copy would leave August with none.
 *
 * Guards: an employee is touched only if it has EXACTLY two active rows, identical ctc_annual,
 * structure_id and governance_mode, effective_to NULL on both, and is in the expected list below.
 * Soft change only (active_status 1 -> 0), one audit row each, one transaction.
 * Dry-run by default; --apply writes.
 *
 *   npx tsx scripts/salary-assignment-dedupe-identical.ts [--apply]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const APPLY = process.argv.includes("--apply");
const CODES = Array.from({ length: 10 }, (_, i) => `MAS${63412 + i}`);
const ph = CODES.map(() => "?").join(",");

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.id, a.employee_id, e.employee_code, a.ctc_annual, a.structure_id, a.governance_mode,
            a.effective_from, a.effective_to, a.created_at
       FROM employee_salary_assignment a JOIN employees e ON e.id = a.employee_id
      WHERE a.active_status = 1 AND UPPER(TRIM(e.employee_code)) IN (${ph})
      ORDER BY e.employee_code, a.effective_from, a.created_at`, CODES);

  const byEmp = new Map<string, any[]>();
  for (const r of rows as any[]) byEmp.set(String(r.employee_id), [...(byEmp.get(String(r.employee_id)) ?? []), r]);

  const plan: Array<{ keep: any; drop: any }> = [];
  const skipped: string[] = [];
  for (const [, list] of byEmp) {
    const [a, b] = list;
    const code = a.employee_code;
    if (list.length !== 2) { skipped.push(`${code}: ${list.length} active rows (need exactly 2)`); continue; }
    const same = Number(a.ctc_annual) === Number(b.ctc_annual) && a.structure_id === b.structure_id
      && a.governance_mode === b.governance_mode && a.effective_to == null && b.effective_to == null;
    if (!same) {
      const diff = (["ctc_annual", "structure_id", "governance_mode", "effective_to"] as const)
        .filter((k) => String(a[k] ?? "") !== String(b[k] ?? ""))
        .map((k) => `${k}: ${a[k] ?? "NULL"} vs ${b[k] ?? "NULL"}`);
      skipped.push(`${code}: rows differ (${diff.join("; ")}) — left alone`);
      continue;
    }
    plan.push({ keep: a, drop: b }); // list is ordered by effective_from, created_at: a = earliest
  }

  console.log(`employees matched: ${byEmp.size}; to clean: ${plan.length}; skipped: ${skipped.length}`);
  skipped.forEach((s) => console.log("  skip -", s));
  console.table(plan.map((p) => ({
    code: p.keep.employee_code, ctc: p.keep.ctc_annual,
    keep_id: p.keep.id, keep_from: p.keep.effective_from, drop_id: p.drop.id, drop_from: p.drop.effective_from,
  })));
  if (!plan.length) return;
  if (!APPLY) { console.log("\nDry run only — pass --apply to deactivate the later duplicate of each pair."); return; }

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();
    for (const p of plan) {
      await logSensitiveAction({
        actor_user_id: "ops_salary_assignment_dedupe",
        actor_role: "system:ops",
        action_type: "salary_assignment_deactivate_identical_duplicate",
        module_key: "payroll_salary",
        entity_type: "employee_salary_assignment",
        entity_id: String(p.drop.id),
        old_value_json: { active_status: 1, ctc_annual: p.drop.ctc_annual, effective_from: p.drop.effective_from },
        new_value_json: { active_status: 0, kept_row: p.keep.id },
        reason: "Identical duplicate active row from the 31 Aug bulk run; earliest row kept so every month still resolves",
      });
      const [res] = await conn.execute(
        `UPDATE employee_salary_assignment SET active_status = 0 WHERE id = ? AND active_status = 1`, [p.drop.id]);
      if ((res as any).affectedRows !== 1) throw new Error(`expected 1 row for ${p.drop.id}, got ${(res as any).affectedRows}`);
    }
    await conn.commit();
    console.log(`\nDeactivated ${plan.length} duplicate row(s).`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

main().then(() => process.exit()).catch((e) => { console.error(e); process.exit(1); });
