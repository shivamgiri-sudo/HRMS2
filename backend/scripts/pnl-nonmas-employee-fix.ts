/**
 * Employees paid on a MAS Callnet cost centre whose employee-master process is an Ispark / DialDesk /
 * Dataconnect process. Dry run by default (READ-ONLY); NONMAS_APPLY=yes writes employees.process_id.
 *
 * Target process = the process of the employee's own cost centre (cost_centre_master.process_id).
 * An employee whose cost centre carries no process is listed and never changed.
 * Apply is idempotent and guarded (WHERE process_id still equals the value read), and prints the old
 * value of every row so it can be put back:
 *     UPDATE employees SET process_id = '<old>' WHERE id = '<id>' AND process_id = '<new>';
 *
 *   npx tsx scripts/pnl-nonmas-employee-fix.ts YYYY-MM    (the month whose payroll run is read)
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { nonVoidRunSql } from "../src/modules/payroll/run-status.js";
import { notDialDeskProcessSql } from "../src/shared/ownCompanyCostCentre.js";

(async () => {
  const period = process.argv[2];
  if (!/^\d{4}-\d{2}$/.test(period ?? "")) throw new Error("pass YYYY-MM");
  const apply = process.env.NONMAS_APPLY === "yes";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT e.id, e.employee_code, e.process_id AS cur_process_id, pm.process_name AS cur_process, pm.process_code AS cur_code, pm.client_name AS cur_client,
            ccm.cost_centre_code AS cc, ccm.process_id AS target_process_id, tpm.process_name AS target_process, tpm.process_code AS target_code,
            tpm.client_name AS target_client, tbm.branch_name AS target_branch
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id AND spr.run_month = ? AND ${nonVoidRunSql("spr")}
       JOIN employees e ON e.id = spl.employee_id
       JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN branch_master pbm ON pbm.id = pm.branch_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
       LEFT JOIN process_master tpm ON tpm.id = ccm.process_id
       LEFT JOIN branch_master tbm ON tbm.id = tpm.branch_id
      WHERE NOT ${notDialDeskProcessSql("pm", "pbm")}`, [period]);
  console.log("FIX_META " + JSON.stringify({ period, mode: apply ? "APPLY" : "DRY-RUN", candidates: rows.length }));
  let changed = 0;
  for (const r of rows) {
    const target = r.target_process_id ? String(r.target_process_id) : null;
    // The target process must itself be a MAS process: not named / coded for DialDesk / Ispark, and not
    // on a DialDesk / Ispark branch (a process filed under NOIDA-DIALDESK is a data question, not a fix).
    const targetIsMas = target
      && target !== String(r.cur_process_id)
      && !(/dial\s*desk|dialdesk|ispark|dataconnect/i.test(`${r.target_process} ${r.target_code} ${r.target_client} ${r.target_branch}`));
    const plan = !target ? "SKIP: cost centre has no process"
      : target === String(r.cur_process_id) ? "SKIP: cost centre's process is the same process (filed under a non-MAS branch): needs a business decision"
      : !targetIsMas ? "SKIP: cost centre's process is itself non-MAS"
      : "SET process_id to the cost centre's process";
    console.log("FIX_ROW " + JSON.stringify({
      employeeCode: r.employee_code, employeeId: r.id, currentProcess: r.cur_process, currentProcessId: r.cur_process_id, costCentre: r.cc,
      targetProcess: r.target_process ?? null, targetProcessId: target, targetBranch: r.target_branch ?? null, plan,
    }));
    if (apply && target && targetIsMas) {
      const [res]: any = await db.query("UPDATE employees SET process_id = ? WHERE id = ? AND process_id = ?", [target, r.id, r.cur_process_id]);
      const n = Number(res?.affectedRows ?? 0);
      changed += n;
      console.log("FIX_APPLIED " + JSON.stringify({ employeeCode: r.employee_code, affectedRows: n, revert: `UPDATE employees SET process_id = '${r.cur_process_id}' WHERE id = '${r.id}' AND process_id = '${target}';` }));
    }
  }
  console.log("FIX_SUMMARY " + JSON.stringify({ candidates: rows.length, changed }));
  await new Promise((resolve) => process.stdout.write("FIX_DONE\n", resolve));
  process.exit(0);
})();
