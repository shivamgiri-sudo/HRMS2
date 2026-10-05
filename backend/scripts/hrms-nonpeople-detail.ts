/**
 * HRMS non-people (GRN) cost detail the P&L reads, per row, Apr-Aug 2026. READ-ONLY.
 * Uses readGrnSpend (the single reader every P&L surface shares) for 'consumed' and 'reserved'.
 *   NP_ROW  period, kind, branch, cost centre code, process, source, grn ref, label (vendor - head - sub head), bill date, amount
 *   npx tsx scripts/hrms-nonpeople-detail.ts
 */
import "dotenv/config";
import { readGrnSpend } from "../src/modules/process-pnl/pnl-actuals.service.js";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

(async () => {
  const [br] = await db.execute<RowDataPacket[]>(`SELECT id, branch_name FROM branch_master`);
  const [cc] = await db.execute<RowDataPacket[]>(`SELECT id, cost_centre_code FROM cost_centre_master`);
  const [pm] = await db.execute<RowDataPacket[]>(`SELECT id, process_name FROM process_master`);
  const B = new Map((br as any[]).map((x) => [String(x.id), x.branch_name]));
  const C = new Map((cc as any[]).map((x) => [String(x.id), x.cost_centre_code]));
  const P = new Map((pm as any[]).map((x) => [String(x.id), x.process_name]));
  for (const period of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]) {
    for (const kind of ["consumed", "reserved"] as const) {
      const rows = await readGrnSpend(period, kind, { withProcess: true, withDetail: true });
      for (const r of rows)
        console.log("NP_ROW " + JSON.stringify({ p: period, k: kind, br: B.get(String(r.branchId)) ?? null, cc: C.get(String(r.costCentreId)) ?? null, pr: P.get(String(r.processId)) ?? null, src: r.source, ref: r.grnRef, lab: r.label, d: r.billDate, amt: Math.round(Number(r.amount) * 100) / 100 }));
    }
  }
  await new Promise((resolve) => process.stdout.write("NP_DONE\n", resolve));
  process.exit(0);
})();
