/**
 * What the increment split would do on live data if increment_package_split_enabled were on. STRICTLY READ-ONLY.
 *
 *   npx tsx scripts/increment-split-what-if.ts [YYYY-MM]    (default: the latest open run month)
 *
 * Runs the same resolver the payroll engine uses (increment-package-split.ts) for every employee in the run who
 * has an active package row and an implemented increment, and prints current gross vs the gross the engine
 * would price, with the day split. Writes nothing and recalculates nothing. Employee code only.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";
import { isIncrementSplitEnabled, resolveIncrementPackage, toPackageParts, type Executor } from "../src/modules/payroll/increment-package-split.js";
import { payableThrough } from "../src/modules/payroll/employment-end-date.js";

const q = async (sql: string, p: unknown[] = []) => {
  if (!/^\s*select/i.test(sql)) throw new Error("read-only");
  const [rows] = await db.execute<RowDataPacket[]>(sql, p as any[]);
  return rows as any[];
};
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

async function main() {
  console.log("flag increment_package_split_enabled is currently:", (await isIncrementSplitEnabled()) ? "ON" : "OFF");
  const arg = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a));
  const runs = await q(`SELECT id, run_month, status FROM salary_prep_run ${arg ? "WHERE run_month = ?" : "WHERE LOWER(status) NOT IN ('draft','cancelled','finalized','disbursed','locked','closed')"} ORDER BY run_month DESC LIMIT 1`, arg ? [arg] : []);
  if (!runs.length) { console.log("no run found"); return; }
  const run = runs[0];
  const [y, m] = String(run.run_month).split("-").map(Number);
  const monthStart = `${run.run_month}-01`;
  const monthEnd = `${run.run_month}-${String(new Date(y!, m!, 0).getDate()).padStart(2, "0")}`;
  console.log(`run ${run.run_month} (${run.status})`);

  const rows = await q(
    `SELECT e.id AS employee_id, e.employee_code, COALESCE(e.salary_start_date, e.date_of_joining) AS start_date,
            (SELECT x.last_working_day_confirmed FROM employee_exit_request x WHERE x.employee_id = e.id ORDER BY x.created_at DESC LIMIT 1) AS lwd,
            s.basic, s.hra, s.conveyance, s.special_allowance, s.bonus, s.portfolio, s.medical_allowance, s.lta, s.other_allowance, s.pli, s.gross, s.effective_date
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       JOIN salary_component_assignments s ON s.employee_id = e.id AND s.status = 'active'
      WHERE spl.run_id = ? AND s.gross > 0
        AND EXISTS (SELECT 1 FROM salary_increment_request r WHERE r.employee_id = e.id AND r.status = 'implemented' AND r.approved_at IS NOT NULL)
      ORDER BY e.employee_code`, [run.id]).catch(async () => await q(
    `SELECT e.id AS employee_id, e.employee_code, COALESCE(e.salary_start_date, e.date_of_joining) AS start_date, NULL AS lwd,
            s.basic, s.hra, s.conveyance, s.special_allowance, s.bonus, s.portfolio, s.medical_allowance, s.lta, s.other_allowance, s.pli, s.gross, s.effective_date
       FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
       JOIN salary_component_assignments s ON s.employee_id = e.id AND s.status = 'active'
      WHERE spl.run_id = ? AND s.gross > 0
        AND EXISTS (SELECT 1 FROM salary_increment_request r WHERE r.employee_id = e.id AND r.status = 'implemented' AND r.approved_at IS NOT NULL)
      ORDER BY e.employee_code`, [run.id]));
  console.log(`employees in the run with a package row and an implemented increment: ${rows.length}`);

  const changed: any[] = [];
  let untouched = 0;
  const exec = db as unknown as Executor;
  for (const r of rows) {
    const start = iso(r.start_date);
    const windowStart = start && start > monthStart ? start : monthStart;
    const windowEnd = payableThrough(r.lwd ? iso(r.lwd) : null, monthEnd);
    const res = await resolveIncrementPackage(exec, { employeeId: r.employee_id, current: toPackageParts(r), currentEffectiveDate: r.effective_date, windowStart, windowEnd });
    if (!res) { untouched++; continue; }
    changed.push({ code: r.employee_code, package_dated: iso(r.effective_date), increment_from: res.effectiveFrom, days_old: res.daysOld, days_new: res.daysNew, current_gross: Number(r.gross), would_price_gross: res.package.gross, basic: res.package.basic });
  }
  console.log(`would change: ${changed.length}; unchanged (package newer than the increment, or no unique catalog package): ${untouched}`);
  console.table(changed.slice(0, 60));
  const mid = changed.filter((c) => c.days_old > 0 && c.days_new > 0);
  console.log(`of those, split mid-month: ${mid.length}`);
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
