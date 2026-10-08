/**
 * Which legacy GRNs the F-02/F-03 reclassification marked "paid" were REALLY paid? STRICTLY READ-ONLY.
 * Source of truth for a legacy bill: db_bill.tbl_payment_processing (GrnId = grn_request.bill_source_id).
 *   npx tsx scripts/grn-false-paid-audit.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const AMT = `COALESCE(NULLIF(g.amount_with_tax,0), g.amount)`;
const r2 = (v: number) => Math.round(v * 100) / 100;
const table = (label: string, rows: unknown[]) => { console.log(`\n## ${label}`); console.table(rows); };

async function main() {
  const [grns] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.bill_source_id, g.status, g.vendor_id, g.invoice_number, g.bill_date, g.head, g.sub_head, ${AMT} AS amt,
            (SELECT t.payment_status FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id LIMIT 1) AS trk_status,
            (SELECT t.id FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id LIMIT 1) AS trk_id,
            (SELECT ROUND(t.balance_amount,2) FROM vendor_payment_tracking t WHERE t.grn_request_id = g.id LIMIT 1) AS trk_balance,
            EXISTS (SELECT 1 FROM journal_entry je WHERE je.source_type='grn' AND je.source_id = g.id AND je.reversed_by_entry_id IS NULL) AS journaled
       FROM grn_request g
      WHERE g.grn_type = 'vendor' AND g.status = 'paid' AND g.bill_source_id IS NOT NULL`);
  const rows = grns as any[];
  console.log(`vendor GRNs with status paid that came from db_bill: ${rows.length}`);
  // One pass over the audit log instead of a lookup per GRN (the per-row lookup never finished).
  const [recl] = await db.execute<RowDataPacket[]>(`SELECT entity_id FROM sensitive_action_log WHERE action_type = 'LEGACY_MIGRATION_RECLASSIFY'`);
  const reclassified = new Set((recl as any[]).map((r) => String(r.entity_id)));
  for (const r of rows) r.reclassified = reclassified.has(String(r.id));
  console.log(`audit-log rows for the F-02/F-03 reclassification: ${reclassified.size}`);

  // Does db_bill hold a payment for each?
  const paid = new Set<number>();
  const ids = [...new Set(rows.map((r) => Number(r.bill_source_id)))];
  for (let i = 0; i < ids.length; i += 2000) {
    const chunk = ids.slice(i, i + 2000);
    const p = await billQuery<any>(`SELECT DISTINCT GrnId FROM tbl_payment_processing WHERE GrnId IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const x of p) paid.add(Number(x.GrnId));
  }

  const key = (r: any) => `${paid.has(Number(r.bill_source_id)) ? "payment IN db_bill" : "NO payment in db_bill"} | ${r.reclassified ? "reclassified paid" : "paid by other route"} | tracking ${r.trk_status ?? "none"}`;
  const agg = new Map<string, { n: number; amt: number; journaled: number }>();
  for (const r of rows) { const k = key(r); const a = agg.get(k) ?? { n: 0, amt: 0, journaled: 0 }; a.n++; a.amt += Number(r.amt); a.journaled += Number(r.journaled); agg.set(k, a); }
  table("legacy 'paid' GRNs: db_bill payment x how it became paid x tracking state",
    [...agg.entries()].sort((a, b) => b[1].amt - a[1].amt).map(([k, v]) => ({ bucket: k, grns: v.n, amount: r2(v.amt), already_journaled: v.journaled })));

  const falsely = rows.filter((r) => !paid.has(Number(r.bill_source_id)));
  const byYear = new Map<string, { n: number; amt: number; pend: number }>();
  for (const r of falsely) { const y = String(r.bill_date ?? "no date").slice(0, 7); const a = byYear.get(y) ?? { n: 0, amt: 0, pend: 0 }; a.n++; a.amt += Number(r.amt); a.pend += Number(r.trk_balance ?? 0); byYear.set(y, a); }
  table("NO payment in db_bill: by bill month (tracking_balance = shown as still payable)",
    [...byYear.entries()].sort().reverse().slice(0, 16).map(([ym, v]) => ({ bill_month: ym, grns: v.n, amount: r2(v.amt), tracking_balance: r2(v.pend) })));
  const fy = falsely.filter((r) => String(r.bill_date ?? "") >= "2026-04-01");
  console.log(`\nfalsely 'paid' since 2026-04-01: ${fy.length} GRNs, ${r2(fy.reduce((s, r) => s + Number(r.amt), 0))}`);

  // Re-entered in the new flow? (same vendor, amount within Re 1, not a legacy row, still alive)
  const [twins] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.vendor_id, ${AMT} amt, g.grn_number, g.status, g.invoice_number FROM grn_request g
      WHERE g.grn_type='vendor' AND g.bill_source_id IS NULL AND g.status NOT IN ('rejected','cancelled','draft') AND g.created_at >= '2026-08-01'`);
  const tw = twins as any[];
  let reentered = 0, reenteredAmt = 0; const unmatched: any[] = [];
  for (const r of falsely.filter((x) => String(x.bill_date ?? "") >= "2026-08-01")) {
    const t = tw.find((x) => x.vendor_id && x.vendor_id === r.vendor_id && Math.abs(Number(x.amt) - Number(r.amt)) <= 1);
    if (t) { reentered++; reenteredAmt += Number(r.amt); } else unmatched.push({ grn: r.grn_number, vendor: r.vendor_id ? "yes" : "NONE", amt: r2(Number(r.amt)), head: r.head, invoice: r.invoice_number, trk: r.trk_status ?? "none" });
  }
  console.log(`\nfalsely paid, billed since 2026-08-01: re-entered in the new flow ${reentered} (${r2(reenteredAmt)}); NOT re-entered ${unmatched.length}`);
  table("not re-entered (largest 25) - these may be genuinely unpaid bills hidden by the 'paid' label", unmatched.sort((a, b) => b.amt - a.amt).slice(0, 25));

  // And the reverse: tracking says Pending for a GRN that db_bill says was paid.
  const paidButPending = rows.filter((r) => paid.has(Number(r.bill_source_id)) && r.trk_status && r.trk_status !== "Paid");
  table("db_bill says PAID but HRMS tracking still pending (shows as payable)",
    [{ grns: paidButPending.length, amount: r2(paidButPending.reduce((s, r) => s + Number(r.amt), 0)) }]);
  await closeBillPool();
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await db.end?.(); } catch { } process.exit(1); });
