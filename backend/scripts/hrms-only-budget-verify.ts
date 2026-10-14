/**
 * Verifies the HRMS-only budget views against stored counters. READ-ONLY.
 * For each FY2026-27 budget: stored line reserved/consumed vs what branchBudgetService.get() returns,
 * plus the legacy-allocation count behind the per-line drill-through (must be 0).
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { branchBudgetService } from "../src/modules/process-pnl/branch-budget.service.js";
import type { RowDataPacket } from "mysql2";

(async () => {
  const [headers] = await db.execute<RowDataPacket[]>(
    `SELECT h.id, h.period_code, bm.branch_name FROM finance_budget_header h
       JOIN branch_master bm ON bm.id = h.branch_id
      WHERE h.period_code >= '2026-04' AND h.status IN ('active','closed') ORDER BY h.period_code, bm.branch_name`);
  const out: any[] = [];
  let leakLines = 0;
  for (const h of headers) {
    const [[stored]] = (await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(reserved_amount),0) r, COALESCE(SUM(consumed_amount),0) c FROM finance_budget_line WHERE budget_id = ?`, [h.id])) as any;
    const view: any = await branchBudgetService.get(String(h.id));
    const vr = view.lines.reduce((a: number, l: any) => a + Number(l.reserved_amount), 0);
    const vc = view.lines.reduce((a: number, l: any) => a + Number(l.consumed_amount), 0);
    for (const l of view.lines) {
      const g: any[] = await branchBudgetService.getGrnsForLine(String(l.id));
      if (g.length) {
        const [[n]] = (await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) n FROM grn_request WHERE id IN (${g.map(() => "?").join(",")}) AND (bill_source_id IS NOT NULL OR COALESCE(created_by,'') LIKE '00000000-%')`,
          g.map((x) => x.id))) as any;
        leakLines += Number(n.n);
      }
    }
    out.push({ period: h.period_code, branch: h.branch_name, stored_res: Number(stored.r), view_res: Math.round(vr * 100) / 100,
      stored_con: Number(stored.c), view_con: Math.round(vc * 100) / 100 });
  }
  console.table(out);
  console.log("legacy GRNs still listed by per-line drill-through:", leakLines);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
