/**
 * Fix two process_master branch links so their MAS revenue lands on the right branch.
 *   Raritiq Designs Private Limited : NOIDA-DIALDESK -> NOIDA-2   (cost centre BSS/OB/NOIDA-2/984 is MAS: invoices issued by
 *                                     Mas Callnet India Pvt Ltd, master company Mas Callnet, branch NOIDA-2)
 *   EBC Bridge                       : no branch      -> NOIDA     (cost centre BSS/OB/Noida/945, company Mas Callnet, branch NOIDA)
 * Guards: each row is updated only if it is still in the expected state; the DialDesk/IDC predicate is evaluated
 * before and after so a MAS process can never be turned into a DialDesk one, nor the reverse. Writes branch_id only.
 *
 *   npx tsx scripts/fix-process-branches.ts            # dry-run (default)
 *   npx tsx scripts/fix-process-branches.ts --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { notDialDeskProcessSql } from "../src/shared/ownCompanyCostCentre.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const APPLY = process.argv.includes("--apply");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const FIXES = [
  { name: "Raritiq Designs Private Limited", expectBranch: "NOIDA-DIALDESK", targetBranch: "NOIDA-2" },
  { name: "EBC Bridge", expectBranch: null as string | null, targetBranch: "NOIDA" },
];

(async () => {
  for (const f of FIXES) {
    const [target] = await q(`SELECT id, branch_name FROM branch_master WHERE branch_name = ? LIMIT 2`, [f.targetBranch]);
    const rows = await q(
      `SELECT p.id, p.process_name, p.active_status, p.branch_id, bm.branch_name cur_branch,
              (CASE WHEN ${notDialDeskProcessSql("p", "bm")} THEN 1 ELSE 0 END) is_mas_now
         FROM process_master p LEFT JOIN branch_master bm ON bm.id = p.branch_id WHERE p.process_name = ?`, [f.name]);
    console.log("PB_CANDIDATES " + JSON.stringify({ name: f.name, target: target ?? null, rows }));
    for (const r of rows as any[]) {
      const ok = (r.cur_branch ?? null) === f.expectBranch;
      console.log("PB_PLAN " + JSON.stringify({ id: r.id, name: r.process_name, from: r.cur_branch ?? null, to: f.targetBranch, in_expected_state: ok }));
      if (!APPLY || !ok || !target) continue;
      const [res] = await db.execute<ResultSetHeader>(`UPDATE process_master SET branch_id = ? WHERE id = ? AND ${f.expectBranch === null ? "branch_id IS NULL" : "branch_id = ?"}`,
        f.expectBranch === null ? [(target as any).id, r.id] : [(target as any).id, r.id, r.branch_id]);
      console.log("PB_APPLIED " + JSON.stringify({ id: r.id, affectedRows: res.affectedRows }));
    }
  }
  console.log(APPLY ? "PB_MODE apply" : "PB_MODE dry-run: nothing written");
  process.exit(0);
})().catch((e) => { console.error("PB_ERROR", e instanceof Error ? e.message : e); process.exit(1); });
