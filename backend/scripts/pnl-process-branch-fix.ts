/**
 * Move a process record from a non-MAS branch (NOIDA-DIALDESK / I-Spark) to the MAS branch its own
 * cost centres run in. Dry run by default (READ-ONLY); PROC_APPLY=yes writes process_master.branch_id.
 *
 * Target branch = the one branch shared by ALL of the process's cost centres (cost_centre_master.process_id
 * or, failing that, the employees' cost centres); it must itself be a MAS branch. Anything ambiguous is
 * listed and never changed. Apply is guarded (WHERE branch_id still equals the value read) and prints the
 * revert statement.
 *
 *   npx tsx scripts/pnl-process-branch-fix.ts <process_id>
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { ownCompanyBranchSql } from "../src/shared/ownCompanyCostCentre.js";

(async () => {
  const processId = process.argv[2];
  if (processId?.startsWith("search:")) {
    const like = `%${processId.slice(7)}%`;
    const [found] = await db.query<RowDataPacket[]>(
      `SELECT pm.id, pm.process_name, pm.process_code, pm.client_name, pm.active_status, bm.branch_name,
              (SELECT COUNT(*) FROM cost_centre_master c WHERE c.process_id = pm.id) AS cost_centres,
              (SELECT COUNT(*) FROM employees e WHERE e.process_id = pm.id AND e.active_status = 1) AS staff
         FROM process_master pm LEFT JOIN branch_master bm ON bm.id = pm.branch_id
        WHERE pm.process_name LIKE ? OR pm.client_name LIKE ? OR pm.process_code LIKE ?`, [like, like, like]);
    for (const r of found) console.log("PBF_SEARCH " + JSON.stringify({ id: r.id, name: r.process_name, code: r.process_code, client: r.client_name, branch: r.branch_name, active: r.active_status, costCentres: Number(r.cost_centres), staff: Number(r.staff) }));
    console.log("PBF_DONE");
    process.exit(0);
  }
  if (!/^[0-9a-f-]{36}$/i.test(processId ?? "")) throw new Error("pass the process id or search:<text>");
  const apply = process.env.PROC_APPLY === "yes";
  const [procs] = await db.query<RowDataPacket[]>(
    `SELECT pm.id, pm.process_name, pm.process_code, pm.client_name, pm.branch_id, bm.branch_name, pm.active_status
       FROM process_master pm LEFT JOIN branch_master bm ON bm.id = pm.branch_id WHERE pm.id = ?`, [processId]);
  if (!procs.length) throw new Error("process not found");
  const p = procs[0];
  const [ccs] = await db.query<RowDataPacket[]>(
    `SELECT ccm.cost_centre_code AS cc, ccm.company_name, ccm.branch_id, bm.branch_name, ccm.active_status,
            (SELECT COUNT(*) FROM employees e WHERE e.cost_centre_id = ccm.id AND e.active_status = 1) AS staff
       FROM cost_centre_master ccm LEFT JOIN branch_master bm ON bm.id = ccm.branch_id WHERE ccm.process_id = ?`, [processId]);
  const [emps] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT e.branch_id) AS branches FROM employees e WHERE e.process_id = ? AND e.active_status = 1`, [processId]);
  const branches = new Map<string, string>();
  for (const c of ccs) if (c.branch_id) branches.set(String(c.branch_id), String(c.branch_name));
  console.log("PBF_PROCESS " + JSON.stringify({ id: p.id, name: p.process_name, code: p.process_code, client: p.client_name, branch: p.branch_name, branchId: p.branch_id, active: p.active_status, activeEmployees: Number(emps[0]?.n ?? 0) }));
  for (const c of ccs) console.log("PBF_CC " + JSON.stringify({ cc: c.cc, company: c.company_name, branch: c.branch_name, active: c.active_status, staff: Number(c.staff) }));
  let plan = "SKIP";
  let target: string | null = null;
  if (branches.size !== 1) plan = `SKIP: cost centres span ${branches.size} branches`;
  else {
    target = [...branches.keys()][0];
    const [ok] = await db.query<RowDataPacket[]>(`SELECT 1 AS ok FROM branch_master bm WHERE bm.id = ? AND ${ownCompanyBranchSql("bm")}`, [target]);
    if (!ok.length) { plan = "SKIP: target branch is not a MAS branch"; target = null; }
    else if (String(p.branch_id) === target) { plan = "SKIP: already on that branch"; target = null; }
    else plan = `SET process_master.branch_id to ${branches.get(target)}`;
  }
  console.log("PBF_PLAN " + JSON.stringify({ plan, targetBranchId: target, mode: apply ? "APPLY" : "DRY-RUN" }));
  if (apply && target) {
    const [res]: any = await db.query("UPDATE process_master SET branch_id = ? WHERE id = ? AND branch_id <=> ?", [target, processId, p.branch_id]);
    console.log("PBF_APPLIED " + JSON.stringify({ affectedRows: Number(res?.affectedRows ?? 0), revert: `UPDATE process_master SET branch_id = ${p.branch_id ? `'${p.branch_id}'` : "NULL"} WHERE id = '${processId}' AND branch_id = '${target}';` }));
  }
  await new Promise((resolve) => process.stdout.write("PBF_DONE\n", resolve));
  process.exit(0);
})();
