/**
 * Owner ruling 2026-10-13: Ahmedabad Neelakanth rent (and everything on its cost centres) belongs to AHMEDABAD-JALDARSHAN.
 * Today cost centre BSS/BO/Ahmedabad-Neelakanth/681 is mastered under branch AHMEDABAD-NEELAKANTH, so Jaldarshan's P&L misses it
 * (about Rs 4.5 lakh a month) and the Branch Review lists Neelakanth as a branch of its own.
 *
 * Moves the Neelakanth-branch cost centres to AHMEDABAD-JALDARSHAN (cost_centre_master.branch_id only; old values printed as NKM_OLD for revert).
 * The P&L reads the branch from the cost centre first, so every view follows. grn_request / vendor_payment_tracking branch_id are left alone.
 *
 *   npx tsx scripts/pnl-nk-branch-move.ts            # dry-run (default): prints what would change and the before / after branch totals
 *   npx tsx scripts/pnl-nk-branch-move.ts --apply
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { getPnlReconciliation } from "../src/modules/process-pnl/pnl-reconciliation.service.js";

const APPLY = process.argv.includes("--apply");
const r0 = (v: unknown) => Math.round(Number(v ?? 0));
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as any[];

(async () => {
  const nk = await q(`SELECT id, branch_name, active_status FROM branch_master WHERE branch_name = 'AHMEDABAD-NEELAKANTH'`);
  const jd = await q(`SELECT id, branch_name FROM branch_master WHERE branch_name = 'AHMEDABAD-JALDARSHAN'`);
  console.log("NKM_BRANCHES " + JSON.stringify({ nk, jd }));
  if (nk.length !== 1 || jd.length !== 1) { console.log("NKM_STOP expected exactly one Neelakanth and one Jaldarshan branch"); process.exit(1); }
  const ccs = await q(`SELECT id, cost_centre_code code, company_name, active_status FROM cost_centre_master WHERE branch_id = ?`, [nk[0].id]);
  console.log("NKM_COST_CENTRES " + JSON.stringify(ccs));
  const emp = await q(`SELECT COUNT(*) n, SUM(e.branch_id = ?) home_nk FROM employees e WHERE e.active_status = 1 AND e.cost_centre_id IN (${ccs.map(() => "?").join(",") || "NULL"})`, [nk[0].id, ...ccs.map((c) => c.id)]);
  console.log("NKM_STAFF " + JSON.stringify(emp[0]));
  for (const p of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
    const rec = await getPnlReconciliation(p, {});
    const get = (name: string) => rec.branches.find((b) => b.branchName === name);
    const a = get("AHMEDABAD-JALDARSHAN"), n = get("AHMEDABAD-NEELAKANTH");
    const sum = (f: (b: NonNullable<typeof a>) => number) => r0((a ? f(a) : 0) + (n ? f(n) : 0));
    console.log("NKM_IMPACT " + JSON.stringify({ period: p,
      jaldarshanNow: a ? { revenue: r0(a.revenue), people: r0(a.payrollCost), nonPeople: r0(a.grnActual + a.grnEstimated), op: r0(a.operatingProfit) } : null,
      neelakanthNow: n ? { revenue: r0(n.revenue), people: r0(n.payrollCost), nonPeople: r0(n.grnActual + n.grnEstimated), op: r0(n.operatingProfit) } : null,
      jaldarshanAfter: { revenue: sum((b) => b.revenue), people: sum((b) => b.payrollCost), nonPeople: sum((b) => b.grnActual + b.grnEstimated), op: sum((b) => b.operatingProfit) } }));
  }
  if (!APPLY) { console.log("NKM_MODE dry-run: nothing written"); process.exit(0); }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const c of ccs) console.log("NKM_OLD " + JSON.stringify({ id: c.id, code: c.code, branch_id: nk[0].id }));
    const [r] = await conn.execute<any>(`UPDATE cost_centre_master SET branch_id = ? WHERE branch_id = ?`, [jd[0].id, nk[0].id]);
    await conn.commit();
    console.log("NKM_APPLIED " + JSON.stringify({ cost_centres_moved: r.affectedRows, revertTo: nk[0].id }));
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  process.exit(0);
})().catch((e) => { console.error("NKM_ERROR", e instanceof Error ? e.message : e); process.exit(1); });
