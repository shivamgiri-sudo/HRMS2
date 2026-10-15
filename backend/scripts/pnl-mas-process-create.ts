/**
 * Create the MAS process for a cost centre whose only process is a non-MAS (DialDesk / IDC) one, then point the
 * cost centre and its employees at it. Dry run by default (READ-ONLY); MASPROC_APPLY=yes writes.
 *
 *   npx tsx scripts/pnl-mas-process-create.ts "<cost centre code>" "<client name>"
 *
 * Process code follows the existing convention: cost centre code, '/' -> '_', upper case
 * (BSS/IB/Noida/761 -> BSS_IB_NOIDA_761). Branch = the cost centre's own MAS branch. The new row is a copy of a
 * sibling process on that branch (same columns, same defaults) with its own id, name, code and client.
 * Guarded: nothing is written when the code or name already exists on the branch, the cost centre is not MAS,
 * or its current process is not a non-MAS one. Prints the revert statements.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { notDialDeskProcessSql, ownCompanyBranchSql, ownCompanyCostCentreSql } from "../src/shared/ownCompanyCostCentre.js";

(async () => {
  const [ccCode, client] = [process.argv[2], process.argv[3]];
  if (!ccCode || !client) throw new Error("pass the cost centre code and client name");
  const apply = process.env.MASPROC_APPLY === "yes";
  const code = ccCode.replace(/\//g, "_").toUpperCase();

  const [ccs] = await db.query<RowDataPacket[]>(
    `SELECT ccm.id, ccm.cost_centre_code, ccm.branch_id, ccm.process_id, ccm.company_name, bm.branch_name,
            (${ownCompanyCostCentreSql("ccm")}) AS own_cc, (${ownCompanyBranchSql("bm")}) AS own_branch,
            pm.process_name AS cur_process, (${notDialDeskProcessSql("pm", "pbm")}) AS cur_is_mas
       FROM cost_centre_master ccm
       LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
       LEFT JOIN process_master pm ON pm.id = ccm.process_id
       LEFT JOIN branch_master pbm ON pbm.id = pm.branch_id
      WHERE ccm.cost_centre_code = ?`, [ccCode]);
  if (ccs.length !== 1) throw new Error(`expected one cost centre, found ${ccs.length}`);
  const cc = ccs[0];
  const [dupe] = await db.query<RowDataPacket[]>(
    "SELECT id, process_name, process_code, active_status FROM process_master WHERE process_code = ? OR (branch_id <=> ? AND UPPER(TRIM(process_name)) = UPPER(TRIM(?)))",
    [code, cc.branch_id, client]);
  const [tmpl] = await db.query<RowDataPacket[]>(
    `SELECT pm.* FROM process_master pm WHERE pm.branch_id = ? AND COALESCE(pm.active_status, 1) = 1 ORDER BY pm.created_at DESC LIMIT 1`, [cc.branch_id]);
  const [emps] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM employees WHERE cost_centre_id = ? AND active_status = 1", [cc.id]);

  const blockers: string[] = [];
  if (!Number(cc.own_cc)) blockers.push("cost centre company is not MAS Callnet");
  if (!Number(cc.own_branch)) blockers.push("cost centre branch is not a MAS branch");
  if (Number(cc.cur_is_mas)) blockers.push("current process is already a MAS process");
  if (dupe.length) blockers.push(`process code or name already exists (${dupe.map((d) => `${d.process_code}/${d.active_status}`).join(", ")})`);
  if (!tmpl.length) blockers.push("no sibling process on the branch to copy defaults from");
  console.log("MPC_PLAN " + JSON.stringify({
    costCentre: ccCode, branch: cc.branch_name, currentProcess: cc.cur_process, newProcess: { name: client, code, client, branch: cc.branch_name },
    activeEmployeesOnCostCentre: Number(emps[0]?.n ?? 0), template: tmpl[0] ? { name: tmpl[0].process_name, code: tmpl[0].process_code } : null,
    blockers, mode: apply ? "APPLY" : "DRY-RUN",
  }));
  if (blockers.length || !apply) { console.log("MPC_DONE"); process.exit(0); }

  const cols = Object.keys(tmpl[0]).filter((c) => !["id", "created_at", "updated_at", "bill_source_id"].includes(c));
  const values: Record<string, unknown> = { ...Object.fromEntries(cols.map((c) => [c, tmpl[0][c]])) };
  const newId = randomUUID();
  Object.assign(values, { process_name: client, process_code: code, client_name: client, branch_id: cc.branch_id, active_status: 1 });
  const colList = ["id", ...cols];
  await db.query(`INSERT INTO process_master (${colList.map((c) => `\`${c}\``).join(",")}) VALUES (${colList.map(() => "?").join(",")})`, [newId, ...cols.map((c) => values[c])]);
  const [u1]: any = await db.query("UPDATE cost_centre_master SET process_id = ? WHERE id = ? AND process_id <=> ?", [newId, cc.id, cc.process_id]);
  const [u2]: any = await db.query("UPDATE employees SET process_id = ? WHERE cost_centre_id = ? AND process_id <=> ?", [newId, cc.id, cc.process_id]);
  console.log("MPC_APPLIED " + JSON.stringify({
    newProcessId: newId, costCentreRows: Number(u1?.affectedRows ?? 0), employeeRows: Number(u2?.affectedRows ?? 0),
    revert: [
      `UPDATE employees SET process_id = ${cc.process_id ? `'${cc.process_id}'` : "NULL"} WHERE cost_centre_id = '${cc.id}' AND process_id = '${newId}';`,
      `UPDATE cost_centre_master SET process_id = ${cc.process_id ? `'${cc.process_id}'` : "NULL"} WHERE id = '${cc.id}' AND process_id = '${newId}';`,
      `DELETE FROM process_master WHERE id = '${newId}';`,
    ],
  }));
  console.log("MPC_DONE");
  process.exit(0);
})();
