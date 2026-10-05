/**
 * Repairs the legacy vendor GRNs that the F-02/F-03 reclassification (2026-09-29) blanket-relabelled
 * "paid" although no payment was made. Dry run by default; --apply writes, in ONE transaction, after
 * saving a before-image of every row it touches (tables grn_false_paid_fix_bak_grn / _trk).
 *
 * Evidence for each bill is db_bill.tbl_payment_processing (GrnId = grn_request.bill_source_id):
 *
 *   A  db_bill HAS a payment, HRMS tracking still says Payment Pending
 *        -> tracking becomes Paid (paid = due, balance 0) with ONE payment transaction built from the
 *           latest db_bill payment row. The earlier backfill wrote a full-amount transaction per
 *           payment row, which multiplies the amount when a bill has several rows; one row does not.
 *
 *   B1 db_bill has NO payment AND the same bill was re-entered in the live flow (same vendor name or id,
 *      same head, amount within Re 1, still alive)
 *        -> the LEGACY copy is cancelled (GRN 'cancelled', tracking 'Rejected'). The live copy is kept:
 *           it carries the invoice number and the approvals. This is the double-payment case.
 *
 *   B2 db_bill has NO payment and nothing re-entered it
 *        -> the bill is genuinely unpaid, so the GRN label goes back to 'pending_accounts_payment' to
 *           match its tracking row.
 *
 * Not touched: bills db_bill never paid whose tracking says Paid (they were closed another way), and
 * the ~6,000 old reclassified GRNs with no tracking row (a Finance decision, 2026-09-29).
 *
 * ORDER MATTERS: run this BEFORE backfill-grn-journal, so a cancelled duplicate is never journaled.
 *
 *   npx tsx scripts/fix-legacy-false-paid-grns.ts [--apply]
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const APPLY = process.argv.includes("--apply");
const ACTOR = "00000000-0000-0000-0000-migrat000002";
const r2 = (v: number) => Math.round(v * 100) / 100;
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const AMT = `COALESCE(NULLIF(g.amount_with_tax,0), g.amount)`;

function paymentMode(raw: unknown) {
  const r = String(raw ?? "").trim().toLowerCase();
  return ({ cheque: "Cheque", check: "Cheque", neft: "NEFT", rtgs: "RTGS", imps: "IMPS", upi: "UPI", cash: "Cash" } as Record<string, string>)[r] ?? "Other";
}
const day = (v: unknown) => (v ? new Date(v as any).toISOString().slice(0, 10) : null);

const NEEDED: Record<string, string[]> = {
  grn_request: ["status", "accounts_payment_status", "bill_source_id", "vendor_name", "head", "invoice_number"],
  vendor_payment_tracking: ["payment_status", "paid_amount", "balance_amount", "due_amount", "payment_date", "payment_mode", "transaction_id", "bank_name", "remarks"],
  vendor_payment_transaction: ["vendor_payment_id", "grn_request_id", "sequence_no", "payment_mode", "payment_date", "bank_name", "transaction_id", "amount", "tds_amount", "net_amount", "remarks", "created_by", "created_at"],
  sensitive_action_log: ["actor_user_id", "action_type", "module_key", "entity_type", "entity_id", "change_summary", "acted_at", "reason"],
};

async function preflight() {
  const [cols] = await db.execute<RowDataPacket[]>(
    `SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (${Object.keys(NEEDED).map(() => "?").join(",")})`, Object.keys(NEEDED));
  const have = new Set((cols as any[]).map((r) => `${r.t}.${r.c}`));
  const missing = Object.entries(NEEDED).flatMap(([t, cs]) => cs.filter((c) => !have.has(`${t}.${c}`)).map((c) => `${t}.${c}`));
  if (missing.length) throw new Error(`schema pre-flight failed, columns missing: ${missing.join(", ")}`);
  console.log("schema pre-flight: every column this script writes exists");
}

async function main() {
  await preflight();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id grn_id, g.grn_number, g.bill_source_id, g.vendor_id, g.vendor_name, g.head, g.sub_head, g.invoice_number, g.bill_date, g.created_at, ${AMT} amt,
            t.id trk_id, t.payment_status trk_status, t.due_amount, t.paid_amount, t.balance_amount
       FROM grn_request g JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
      WHERE g.grn_type = 'vendor' AND g.status = 'paid' AND g.bill_source_id IS NOT NULL
        AND t.payment_status <> 'Paid'
        AND NOT EXISTS (SELECT 1 FROM vendor_payment_transaction x WHERE x.vendor_payment_id = t.id)`);
  const cands = rows as any[];
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${cands.length} legacy GRNs are 'paid' but their tracking is not Paid and has no payment`);

  const pays = new Map<number, any[]>();
  const ids = [...new Set(cands.map((c) => Number(c.bill_source_id)))];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    for (const p of await billQuery<any>(
      `SELECT Id, GrnId, PaymentMode, PaymentDate, BankName, TransactionId, CreateDate FROM tbl_payment_processing WHERE GrnId IN (${chunk.map(() => "?").join(",")}) ORDER BY Id`, chunk)) {
      const list = pays.get(Number(p.GrnId)) ?? []; list.push(p); pays.set(Number(p.GrnId), list);
    }
  }

  // Live-flow bills a legacy copy could be a duplicate of.
  const [liveRows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.vendor_id, g.vendor_name, g.head, g.invoice_number, ${AMT} amt, g.status
       FROM grn_request g WHERE g.grn_type='vendor' AND g.bill_source_id IS NULL AND g.status NOT IN ('rejected','cancelled','draft') AND g.created_at >= '2026-08-01'`);
  const live = liveRows as any[];

  const A: any[] = [], B1: any[] = [], B2: any[] = [];
  for (const c of cands) {
    const p = pays.get(Number(c.bill_source_id));
    if (p?.length) { A.push({ ...c, pay: p[p.length - 1], n: p.length }); continue; }
    const twin = live.find((l) => Math.abs(Number(l.amt) - Number(c.amt)) <= 1 && norm(l.head) === norm(c.head)
      && ((l.vendor_id && l.vendor_id === c.vendor_id) || (norm(l.vendor_name) !== "" && norm(l.vendor_name) === norm(c.vendor_name))));
    if (twin) B1.push({ ...c, twin }); else B2.push(c);
  }
  const sum = (xs: any[]) => r2(xs.reduce((s, x) => s + Number(x.amt), 0));
  console.table([
    { action: "A  db_bill paid it -> tracking Paid + payment recorded", grns: A.length, amount: sum(A) },
    { action: "B1 never paid, re-entered live -> cancel the legacy copy", grns: B1.length, amount: sum(B1) },
    { action: "B2 never paid, not re-entered -> label back to pending", grns: B2.length, amount: sum(B2) },
  ]);
  console.log("\nB1 pairs (legacy copy -> live copy kept):");
  console.table(B1.sort((a, b) => b.amt - a.amt).map((x) => ({ cancel_legacy: x.grn_number, amt: r2(Number(x.amt)), keep_live: x.twin.grn_number, live_invoice: x.twin.invoice_number, live_status: x.twin.status, vendor_same_id: x.twin.vendor_id === x.vendor_id })));
  console.log("\nB2 (kept, relabelled pending):");
  console.table(B2.sort((a, b) => b.amt - a.amt).slice(0, 30).map((x) => ({ grn: x.grn_number, amt: r2(Number(x.amt)), head: x.head, vendor: x.vendor_name, bill_date: day(x.bill_date) })));
  console.log("\nA sample:");
  console.table(A.slice(0, 10).map((x) => ({ grn: x.grn_number, amt: r2(Number(x.amt)), db_bill_payments: x.n, mode: x.pay.PaymentMode, date: day(x.pay.PaymentDate), ref: x.pay.TransactionId })));

  if (!APPLY) { console.log("\nNo changes written. Re-run with --apply (run it BEFORE backfill-grn-journal)."); await closeBillPool(); return; }

  const conn = await (db as any).getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS grn_false_paid_fix_bak_grn (id CHAR(36) PRIMARY KEY, grn_id CHAR(36) NOT NULL, grn_number VARCHAR(80), old_status VARCHAR(40), old_accounts_payment_status VARCHAR(40), action VARCHAR(4), backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP, KEY (grn_id))`);
    await conn.query(`CREATE TABLE IF NOT EXISTS grn_false_paid_fix_bak_trk (id CHAR(36) PRIMARY KEY, trk_id CHAR(36) NOT NULL, old_payment_status VARCHAR(30), old_paid_amount DECIMAL(14,2), old_balance_amount DECIMAL(14,2), action VARCHAR(4), backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP, KEY (trk_id))`);
    await conn.beginTransaction();
    const bak = async (c: any, action: string) => {
      const [[g]] = await conn.query(`SELECT status, accounts_payment_status FROM grn_request WHERE id = ?`, [c.grn_id]);
      await conn.query(`INSERT INTO grn_false_paid_fix_bak_grn (id, grn_id, grn_number, old_status, old_accounts_payment_status, action) VALUES (?,?,?,?,?,?)`, [randomUUID(), c.grn_id, c.grn_number, g?.status ?? null, g?.accounts_payment_status ?? null, action]);
      await conn.query(`INSERT INTO grn_false_paid_fix_bak_trk (id, trk_id, old_payment_status, old_paid_amount, old_balance_amount, action) VALUES (?,?,?,?,?,?)`, [randomUUID(), c.trk_id, c.trk_status, c.paid_amount, c.balance_amount, action]);
    };
    const audit = (c: any, action: string, extra: object) => conn.query(
      `INSERT INTO sensitive_action_log (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'LEGACY_FALSE_PAID_FIX', 'finance', 'grn_request', ?, ?, NOW(), ?)`,
      [ACTOR, c.grn_id, JSON.stringify({ grn: c.grn_number, action, ...extra }), "F-02 reclassification marked this bill paid without a payment; corrected from db_bill evidence"]);

    for (const c of A) {
      await bak(c, "A");
      await conn.query(`UPDATE vendor_payment_tracking SET payment_status='Paid', paid_amount = due_amount, balance_amount = 0, payment_date = ?, payment_mode = ?, transaction_id = ?, bank_name = ? WHERE id = ?`,
        [day(c.pay.PaymentDate), paymentMode(c.pay.PaymentMode), c.pay.TransactionId ?? null, c.pay.BankName ?? null, c.trk_id]);
      await conn.query(`INSERT IGNORE INTO vendor_payment_transaction (id, vendor_payment_id, grn_request_id, sequence_no, payment_mode, payment_date, bank_name, transaction_id, amount, tds_amount, net_amount, remarks, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), c.trk_id, c.grn_id, Number(c.pay.Id), paymentMode(c.pay.PaymentMode), day(c.pay.PaymentDate) ?? day(c.created_at), c.pay.BankName ?? null, c.pay.TransactionId ?? null,
         c.due_amount, 0, c.due_amount, `db_bill payment (${c.n} row${c.n > 1 ? "s" : ""}), recorded by legacy false-paid fix`, ACTOR, c.pay.CreateDate ? new Date(c.pay.CreateDate) : new Date()]);
      await audit(c, "A", { paid_from: "db_bill.tbl_payment_processing", db_bill_rows: c.n });
    }
    for (const c of B1) {
      await bak(c, "B1");
      await conn.query(`UPDATE grn_request SET status='cancelled', accounts_payment_status='cancelled' WHERE id = ? AND status='paid'`, [c.grn_id]);
      await conn.query(`UPDATE vendor_payment_tracking SET payment_status='Rejected', remarks = CONCAT(COALESCE(remarks,''), ?) WHERE id = ?`, [` | Legacy duplicate of ${c.twin.grn_number}; cancelled (no db_bill payment).`, c.trk_id]);
      await audit(c, "B1", { duplicate_of: c.twin.grn_number });
    }
    for (const c of B2) {
      await bak(c, "B2");
      await conn.query(`UPDATE grn_request SET status='pending_accounts_payment', accounts_payment_status='pending' WHERE id = ? AND status='paid'`, [c.grn_id]);
      await audit(c, "B2", { relabelled_to: "pending_accounts_payment" });
    }
    await conn.commit();
    console.log(`\napplied: A ${A.length}, B1 ${B1.length}, B2 ${B2.length}. Before-images in grn_false_paid_fix_bak_grn / _trk.`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); await closeBillPool(); }
}

main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await db.end?.(); } catch { } process.exit(1); });
