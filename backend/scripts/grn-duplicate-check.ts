/**
 * Read-only: GRN numbers that exist BOTH as an HRMS-raised grn_request and as a db_bill-migrated one (bill_source_id set).
 *   GD_SUM  per accounting month: duplicate pairs and ex-GST of each side
 *   GD_ROW  up to 40 examples
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
(async () => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT h.grn_number g, h.id hrms_id, m.id mig_id, h.accounting_period hp, m.accounting_period mp, h.status hst, m.status mst,
            ROUND(COALESCE(h.amount_without_tax,h.amount,0)) hx, ROUND(COALESCE(m.amount_without_tax,m.amount,0)) mx,
            (SELECT COUNT(*) FROM vendor_payment_tracking v WHERE v.grn_request_id = h.id) hv, (SELECT COUNT(*) FROM vendor_payment_tracking v WHERE v.grn_request_id = m.id) mv,
            DATE_FORMAT(m.created_at,'%Y-%m-%d %H:%i') m_created
       FROM grn_request h JOIN grn_request m
         ON SUBSTRING_INDEX(m.grn_number, '-', 1) = SUBSTRING_INDEX(h.grn_number, '-', 1) AND m.id <> h.id
      WHERE h.bill_source_id IS NULL AND m.bill_source_id IS NOT NULL
        AND COALESCE(h.accounting_period, m.accounting_period) BETWEEN '2026-03' AND '2026-10'`);
  const sum: Record<string, any> = {};
  for (const r of rows as any[]) { const k = r.hp ?? "-"; const s = sum[k] ?? { pairs: 0, hrms_ex: 0, mig_ex: 0 }; s.pairs++; s.hrms_ex += Number(r.hx); s.mig_ex += Number(r.mx); sum[k] = s; }
  for (const [k, v] of Object.entries(sum).sort()) console.log("GD_SUM " + JSON.stringify({ month: k, ...v }));
  for (const r of (rows as any[]).slice(0, 40)) console.log("GD_ROW " + JSON.stringify(r));
  process.exit(0);
})();
