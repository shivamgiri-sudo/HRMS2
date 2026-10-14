/**
 * Import MAS Callnet I-Spark (db_bill) data HRMS does not have yet, so billing and money tracking
 * work from HRMS alone (design: docs/superpowers/specs/2026-10-14-receivables-money-flow-design.md).
 *
 *   PART=provisions   provision_master (FY in FINANCE_YEAR, default 2026-27) -> client_provision,
 *                     status approved, amount + balance exactly as I-Spark has them.
 *   PART=collections  bill_pay_particulars (one row per bill paid) -> client_receipt (is_migrated=1)
 *                     + client_receipt_allocation against the matching HRMS bill.
 *
 *   MODE=dry-run (default) prints what would happen; MODE=apply CONFIRM=import-mas-legacy writes.
 * Idempotent: every row carries legacy_source_id (pm:<id> / bpp:<id>) under a unique key, so a re-run
 * at cutover only adds what I-Spark recorded since. db_bill is read with SELECT only.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const MODE = (process.env.MODE ?? "dry-run").trim();
const PART = (process.env.PART ?? "").trim();
const FY = (process.env.FINANCE_YEAR ?? "2026-27").trim();
if (!["dry-run", "apply"].includes(MODE)) throw new Error("MODE must be dry-run or apply");
if (!["provisions", "collections"].includes(PART)) throw new Error("PART must be provisions or collections");
if (MODE === "apply" && process.env.CONFIRM !== "import-mas-legacy") throw new Error("apply needs CONFIRM=import-mas-legacy");
const APPLY = MODE === "apply";

const MAS_HRMS = "REPLACE(REPLACE(REPLACE(LOWER(COALESCE(cc.company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'";
const paise = (v: unknown) => Math.round(Number(String(v ?? "0").replace(/,/g, "")) * 100);
const rupees = (p: number) => p / 100;
const fyShort = (fy: string) => { const m = /^(\d{2})(\d{2})-(\d{2})$/.exec(fy.trim()); return m ? `${m[2]}-${m[3]}` : fy.trim(); };
const isoDate = (v: unknown) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  // db_bill DATETIMEs come back as UTC instants of IST midnights; shift to IST before taking the date.
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
};

async function actorId(): Promise<string> {
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT au.id FROM auth_user au JOIN user_roles ur ON ur.user_id = au.id
     WHERE ur.role_key = 'super_admin' AND ur.active_status = 1 ORDER BY au.id LIMIT 1`);
  if (!row) throw new Error("no super_admin to attribute imported rows to");
  return String(row.id);
}

async function importProvisions() {
  const rows = await billQuery<RowDataPacket>(
    `SELECT p.id, p.cost_center, p.finance_year, p.month, p.invoiceType1, p.provision, p.provision_balance, p.remarks
     FROM provision_master p JOIN cost_master c ON c.cost_center = p.cost_center
     WHERE p.finance_year = ? AND c.company_name LIKE '%Mas Callnet%' ORDER BY p.id`, [FY]);
  const [ccRows] = await db.query<RowDataPacket[]>(`SELECT cc.id, cc.cost_centre_code FROM cost_centre_master cc WHERE ${MAS_HRMS}`);
  const ccByCode = new Map(ccRows.map((r) => [String(r.cost_centre_code), String(r.id)]));
  const [done] = await db.query<RowDataPacket[]>(`SELECT legacy_source_id FROM client_provision WHERE legacy_source_id LIKE 'pm:%'`);
  const doneSet = new Set(done.map((r) => String(r.legacy_source_id)));
  const [existing] = await db.query<RowDataPacket[]>(
    `SELECT cost_centre_id, finance_year, month_label FROM client_provision WHERE provision_status <> 'rejected' AND legacy_source_id IS NULL`);
  const typed = new Set(existing.map((r) => `${r.cost_centre_id}|${r.finance_year}|${r.month_label}`));
  const user = await actorId();
  let add = 0, skipDone = 0, skipNoCc = 0, skipTyped = 0, skipBadMonth = 0, amount = 0, balance = 0;
  for (const r of rows) {
    const key = `pm:${r.id}`;
    if (doneSet.has(key)) { skipDone++; continue; }
    const ccId = ccByCode.get(String(r.cost_center));
    if (!ccId) { skipNoCc++; console.log(`  no HRMS cost centre for ${r.cost_center} (pm:${r.id})`); continue; }
    const month = String(r.month ?? "").trim();
    if (!/^[A-Z][a-z]{2}-\d{2}$/.test(month)) { skipBadMonth++; console.log(`  bad month "${month}" (pm:${r.id})`); continue; }
    if (typed.has(`${ccId}|${FY}|${month}`)) { skipTyped++; console.log(`  HRMS already has a provision for ${r.cost_center} ${month} (pm:${r.id}) - kept HRMS one`); continue; }
    const amt = paise(r.provision), bal = paise(r.provision_balance);
    if (amt <= 0 || bal < 0 || bal > amt) { console.log(`  odd amounts pm:${r.id} provision=${r.provision} balance=${r.provision_balance} - imported as is`); }
    add++; amount += amt; balance += bal;
    if (APPLY) {
      await db.execute(
        `INSERT INTO client_provision (id, cost_centre_id, finance_year, month_label, provision_amount, provision_balance,
           provision_status, remarks, created_by, approved_by, approved_at, invoice_type, legacy_source_id)
         VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, NOW(), ?, ?)`,
        [randomUUID(), ccId, FY, month, rupees(amt), rupees(Math.max(0, bal)), String(r.remarks ?? "").slice(0, 500) || "Imported from I-Spark",
          user, user, String(r.invoiceType1 ?? "").trim() === "Non Revenue" ? "Non Revenue" : "Revenue", key]);
    }
  }
  console.log(`\nprovisions ${FY}: I-Spark ${rows.length}; ${APPLY ? "imported" : "would import"} ${add} (provision ${rupees(amount)}, balance ${rupees(balance)}); already imported ${skipDone}; no cost centre ${skipNoCc}; HRMS already had one ${skipTyped}; bad month ${skipBadMonth}`);
}

const MODE_MAP: Array<[RegExp, string]> = [[/rtgs/i, "RTGS"], [/neft/i, "NEFT"], [/imps/i, "IMPS"], [/upi/i, "UPI"], [/che|chq/i, "Cheque"], [/\bdd\b|demand/i, "DD"], [/cash/i, "Cash"]];
const payMode = (v: unknown) => MODE_MAP.find(([re]) => re.test(String(v ?? "")))?.[1] ?? "Other";

async function importCollections() {
  const rows = await billQuery<RowDataPacket>(
    `SELECT id, company_name, branch_name, financial_year, pay_type, pay_no, bank_name, pay_type_dates, createdate,
            bill_no, bill_amount, tds_ded, net_amount, deduction, status, remarks
     FROM bill_pay_particulars WHERE company_name LIKE '%Mas Callnet%' AND COALESCE(delete_status, 0) <> 1 ORDER BY id`);
  const [bills] = await db.query<RowDataPacket[]>(
    `SELECT ci.id, ci.bill_no, ci.grand_total, ci.invoice_status, cc.branch_id, cc.company_name,
            COALESCE(NULLIF(cc.billing_client_name, ''), cc.company_name) AS client_name
     FROM client_invoice ci JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
     WHERE ci.bill_no IS NOT NULL AND ${MAS_HRMS}`);
  const billByNo = new Map<string, RowDataPacket>();
  const dupBillNos = new Set<string>();
  for (const b of bills) { const k = String(b.bill_no); if (billByNo.has(k)) dupBillNos.add(k); billByNo.set(k, b); }
  const [done] = await db.query<RowDataPacket[]>(`SELECT legacy_source_id FROM client_receipt WHERE legacy_source_id LIKE 'bpp:%'`);
  const doneSet = new Set(done.map((r) => String(r.legacy_source_id)));
  const settled = new Map<string, number>();
  const [prior] = await db.query<RowDataPacket[]>(
    `SELECT a.invoice_id, SUM(a.received_amount + a.tds_amount + a.deduction_amount) AS s FROM client_receipt_allocation a
     JOIN client_receipt r ON r.id = a.receipt_id AND r.status = 'recorded' GROUP BY a.invoice_id`);
  for (const p of prior) settled.set(String(p.invoice_id), paise(p.s));
  const user = await actorId();
  const unmatchedByFy = new Map<string, number>();
  let add = 0, skipDone = 0, unmatched = 0, over = 0, zero = 0, ambiguous = 0, sumNet = 0, sumTds = 0, sumDed = 0;
  const touched: string[] = [];
  for (const r of rows) {
    const key = `bpp:${r.id}`;
    if (doneSet.has(key)) { skipDone++; continue; }
    const billNo = `${String(r.bill_no ?? "").trim()}/${fyShort(String(r.financial_year ?? ""))}`;
    if (dupBillNos.has(billNo)) { ambiguous++; continue; }
    const bill = billByNo.get(billNo);
    if (!bill) { unmatched++; const fy = String(r.financial_year); unmatchedByFy.set(fy, (unmatchedByFy.get(fy) ?? 0) + 1); continue; }
    const net = paise(r.net_amount), tds = paise(r.tds_ded), ded = paise(r.deduction);
    if (net + tds + ded <= 0) { zero++; continue; }
    const already = settled.get(String(bill.id)) ?? 0;
    if (already + net + tds + ded > paise(bill.grand_total) + 100) {
      over++;
      console.log(`  over-settles ${billNo}: grand ${bill.grand_total}, already ${rupees(already)}, this row ${rupees(net + tds + ded)} (bpp:${r.id}) - skipped`);
      continue;
    }
    settled.set(String(bill.id), already + net + tds + ded);
    add++; sumNet += net; sumTds += tds; sumDed += ded;
    const date = isoDate(r.pay_type_dates) ?? isoDate(r.createdate) ?? "2000-01-01";
    if (APPLY) {
      const id = randomUUID();
      await db.execute(
        `INSERT INTO client_receipt (id, receipt_no, finance_year, receipt_date, client_name, company_name, branch_id, amount_received,
           tds_amount, other_deduction, payment_mode, reference_no, bank_account_id, remarks, created_by, is_migrated, legacy_source_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?)`,
        [id, `ISPARK/${r.id}`, String(r.financial_year ?? FY).slice(0, 10), date, bill.client_name, bill.company_name ?? null, bill.branch_id ?? null,
          rupees(net), rupees(tds), rupees(ded), payMode(r.pay_type), String(r.pay_no ?? "").trim().slice(0, 100) || null,
          `I-Spark collection ${r.status ?? ""}${r.bank_name ? ` · ${r.bank_name}` : ""}`.slice(0, 500), user, key]);
      await db.execute(
        `INSERT INTO client_receipt_allocation (id, receipt_id, invoice_id, received_amount, tds_amount, deduction_amount) VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), id, bill.id, rupees(net), rupees(tds), rupees(ded)]);
      touched.push(String(bill.id));
    }
  }
  console.log(`\ncollections: I-Spark MAS rows ${rows.length}; ${APPLY ? "imported" : "would import"} ${add} (net received ${rupees(sumNet)}, TDS ${rupees(sumTds)}, deductions ${rupees(sumDed)}); already imported ${skipDone}; bill not in HRMS ${unmatched}; ambiguous bill no ${ambiguous}; would over-settle ${over}; zero rows ${zero}`);
  console.table([...unmatchedByFy.entries()].sort().map(([fy, n]) => ({ fy, unmatched: n })));
  if (APPLY && touched.length) {
    // Keep client_invoice_payment_status in step for the legacy Client Payments screen.
    const ids = [...new Set(touched)];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await db.query(
        `INSERT INTO client_invoice_payment_status (id, invoice_id, legacy_invoice_id, payment_status, total_amount, amount_received,
           tds_deducted, other_deduction, net_received, last_payment_date)
         SELECT UUID(), ci.id, ci.legacy_id,
                CASE WHEN ci.grand_total - s.settled - COALESCE(cn.credited, 0) <= 0.5 THEN 'paid' WHEN s.settled > 0 THEN 'partial' ELSE 'pending' END,
                ci.grand_total, s.received, s.tds, s.deduction, s.received, s.last_date
         FROM client_invoice ci
         JOIN (SELECT a.invoice_id, SUM(a.received_amount) received, SUM(a.tds_amount) tds, SUM(a.deduction_amount) deduction,
                      SUM(a.received_amount + a.tds_amount + a.deduction_amount) settled, MAX(r.receipt_date) last_date
               FROM client_receipt_allocation a JOIN client_receipt r ON r.id = a.receipt_id AND r.status = 'recorded'
               GROUP BY a.invoice_id) s ON s.invoice_id = ci.id
         LEFT JOIN (SELECT invoice_id, SUM(grand_total) credited FROM client_credit_note WHERE credit_status = 'approved' GROUP BY invoice_id) cn ON cn.invoice_id = ci.id
         WHERE ci.id IN (${chunk.map(() => "?").join(",")})
         ON DUPLICATE KEY UPDATE payment_status = VALUES(payment_status), total_amount = VALUES(total_amount),
           amount_received = VALUES(amount_received), tds_deducted = VALUES(tds_deducted), other_deduction = VALUES(other_deduction),
           net_received = VALUES(net_received), last_payment_date = VALUES(last_payment_date)`,
        chunk);
    }
    console.log(`payment status refreshed for ${ids.length} bills`);
  }
}

(PART === "provisions" ? importProvisions() : importCollections())
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await closeBillPool(); await db.end().catch(() => {}); });
