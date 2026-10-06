/**
 * Book Ahmedabad Neelkanth (NK) branch spend to the Bluevine Technologies (Finfort) process, FY 2026-27.
 * Owner decision 2026-10-06, same as the finance sheet (Ahmedabad NK tab = Finfort). NK has no process of its own,
 * so its vendor / GRN spend (~5 lakh/month) matched no P&L row and was dropped.
 *
 * Writes (apply only): process_id = Bluevine process, cost_class = 'direct' on NK-branch vendor_payment_tracking,
 * grn_request and grn_cost_allocation rows of FY 2026-27 that carry no process. Old values logged (NK_OLD) for revert.
 *
 *   npx tsx scripts/book-nk-to-bluevine.ts            # dry-run (default)
 *   npx tsx scripts/book-nk-to-bluevine.ts --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const APPLY = process.argv.includes("--apply");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as any[];
(async () => {
  const nk = await q(`SELECT id, branch_name FROM branch_master WHERE branch_name LIKE 'AHMEDABAD-NEEL%'`);
  const bv = await q(`SELECT p.id, p.process_name, bm.branch_name FROM process_master p JOIN branch_master bm ON bm.id = p.branch_id
                       WHERE p.process_name = 'Bluevine Technologies' AND bm.branch_name = 'AHMEDABAD-JALDARSHAN' AND COALESCE(p.active_status,1) = 1`);
  console.log("NK_TARGET " + JSON.stringify({ nk, bluevine: bv }));
  if (nk.length !== 1 || bv.length !== 1) { console.log("NK_STOP: expected exactly one NK branch and one Bluevine process"); process.exit(1); }
  const nkId = nk[0].id, bvId = bv[0].id;
  const where = {
    vpt: `branch_id = ? AND process_id IS NULL AND financial_year = '2026-27'`,
    grn: `branch_id = ? AND process_id IS NULL AND financial_year = '2026-27'`,
    alloc: `a.branch_id = ? AND a.process_id IS NULL AND g.financial_year = '2026-27'`,
  };
  const v = await q(`SELECT COALESCE(recognition_period,'-') m, COUNT(*) n, ROUND(SUM(COALESCE(amount_without_tax, due_amount, 0))) ex FROM vendor_payment_tracking WHERE ${where.vpt} GROUP BY m`, [nkId]);
  const g = await q(`SELECT COALESCE(accounting_period,'-') m, COUNT(*) n, ROUND(SUM(COALESCE(amount_without_tax, amount, 0))) ex FROM grn_request WHERE ${where.grn} GROUP BY m`, [nkId]);
  const a = await q(`SELECT COALESCE(g.accounting_period,'-') m, COUNT(*) n, ROUND(SUM(COALESCE(a.amount_without_tax,0))) ex FROM grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id WHERE ${where.alloc} GROUP BY m`, [nkId]);
  console.log("NK_PLAN " + JSON.stringify({ vendor_rows: v, grn_rows: g, allocation_rows: a }));
  if (!APPLY) { console.log("NK_MODE dry-run: nothing written"); process.exit(0); }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [ov] = await conn.query<RowDataPacket[]>(`SELECT 'vpt' t, id, process_id, cost_class FROM vendor_payment_tracking WHERE ${where.vpt}
       UNION ALL SELECT 'grn', id, process_id, cost_class FROM grn_request WHERE ${where.grn}
       UNION ALL SELECT 'alloc', a.id, a.process_id, a.cost_class FROM grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id WHERE ${where.alloc}`, [nkId, nkId, nkId]);
    for (const r of ov as any[]) console.log("NK_OLD " + JSON.stringify(r));
    const [r1] = await conn.execute<any>(`UPDATE grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id SET a.process_id = ?, a.cost_class = 'direct' WHERE ${where.alloc}`, [bvId, nkId]);
    const [r2] = await conn.execute<any>(`UPDATE vendor_payment_tracking SET process_id = ?, cost_class = 'direct' WHERE ${where.vpt}`, [bvId, nkId]);
    const [r3] = await conn.execute<any>(`UPDATE grn_request SET process_id = ?, cost_class = 'direct' WHERE ${where.grn}`, [bvId, nkId]);
    await conn.commit();
    console.log("NK_APPLIED " + JSON.stringify({ grn_cost_allocation: r1.affectedRows, vendor_payment_tracking: r2.affectedRows, grn_request: r3.affectedRows }));
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  process.exit(0);
})().catch((e) => { console.error("NK_ERROR", e instanceof Error ? e.message : e); process.exit(1); });
