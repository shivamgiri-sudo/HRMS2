/** The GRNs whose status says pending while their payment record says Paid. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
const AMT = `COALESCE(NULLIF(g.amount_with_tax,0), g.amount)`;
async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.bill_source_id, g.status, g.bill_date, ${AMT} amt, t.paid_amount, t.payment_date, t.transaction_id,
            (SELECT COUNT(*) FROM vendor_payment_transaction x WHERE x.vendor_payment_id = t.id) txns,
            EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='grn' AND je.source_id = g.id AND je.reversed_by_entry_id IS NULL) journaled
       FROM grn_request g JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
      WHERE g.grn_type='vendor' AND g.status='pending_accounts_payment' AND t.payment_status='Paid'`);
  const r = rows as any[];
  console.log(`GRN pending but tracking Paid: ${r.length}`);
  const ids = [...new Set(r.filter((x) => x.bill_source_id).map((x) => Number(x.bill_source_id)))];
  const paid = new Set<number>();
  for (let i = 0; i < ids.length; i += 2000) {
    const c = ids.slice(i, i + 2000);
    for (const p of await billQuery<any>(`SELECT DISTINCT GrnId FROM tbl_payment_processing WHERE GrnId IN (${c.map(() => "?").join(",")})`, c)) paid.add(Number(p.GrnId));
  }
  const agg = new Map<string, { n: number; amt: number }>();
  for (const x of r) {
    const k = `${x.bill_source_id ? (paid.has(Number(x.bill_source_id)) ? "db_bill HAS payment" : "db_bill NO payment") : "no db_bill id"} | txns ${x.txns > 0 ? "yes" : "none"} | journaled ${x.journaled ? "yes" : "no"} | billed ${String(x.bill_date ?? "-").slice(0, 4)}`;
    const a = agg.get(k) ?? { n: 0, amt: 0 }; a.n++; a.amt += Number(x.amt); agg.set(k, a);
  }
  console.table([...agg.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20).map(([k, v]) => ({ bucket: k, grns: v.n, amount: Math.round(v.amt) })));
  await closeBillPool();
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await db.end?.(); } catch { } process.exit(1); });
