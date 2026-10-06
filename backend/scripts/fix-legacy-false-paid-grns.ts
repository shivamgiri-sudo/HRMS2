/**
 * Repairs the legacy vendor GRNs that the F-02/F-03 reclassification (2026-09-29) blanket-relabelled
 * "paid" although no payment was made, and the duplicate bills that grew out of it. Dry run by default.
 *
 * Evidence for a legacy bill is db_bill.tbl_payment_processing (GrnId = grn_request.bill_source_id).
 * Finance re-entered many September bills by hand in the live flow (MAS/09/26/00xx), so the same bill
 * exists twice. Four actions:
 *
 *   A   db_bill HAS a payment, HRMS tracking still says Payment Pending
 *         -> tracking becomes Paid (paid = due, balance 0) with ONE transaction built from the latest
 *            db_bill payment row (the older backfill wrote a full-amount row per payment row, which
 *            multiplies the amount when a bill has several).
 *   D1  a live copy of a bill db_bill already PAID (legacy copy paid, live copy still awaiting payment)
 *         -> the live copy is reversed through grnService.reverseConsumption (releases its budget,
 *            reverses its journal entry, audited) and its tracking row becomes Rejected. This is the
 *            double-payment case.
 *   B1  db_bill has NO payment and the bill was re-entered live (the live copy is still in the pipeline)
 *         -> the LEGACY copy is reversed the same way and its tracking becomes Rejected; the live copy,
 *            which carries the invoice number and the approvals, is kept.
 *   B2  db_bill has NO payment and nothing re-entered it
 *         -> genuinely unpaid: the GRN label goes back to 'pending_accounts_payment' to match its tracking.
 *
 * Copies are matched ONE-TO-ONE (same vendor name or id, same head, amount within Re 1, same bill month),
 * so five identical Rs 411.82 phone bills are not all treated as copies of one.
 *
 *   A2  an imported GRN db_bill says was PAID but HRMS shows approved / pending (or has no payment record at all)
 *         -> marked Paid with a payment transaction; a payment record is created when there is none. Repeatable:
 *            run it after every legacy import.
 *
 * Not touched: bills db_bill never paid whose tracking says Paid, and the ~6,000 old reclassified GRNs
 * with no tracking row (a Finance decision). Run this BEFORE backfill-grn-journal.
 *
 *   npx tsx scripts/fix-legacy-false-paid-grns.ts [--apply] [--status-only] [--actor <user_id>]
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const APPLY = process.argv.includes("--apply");
/** --status-only: apply A and B2 (status/payment corrections) and leave the duplicate reversals (D1, B1) for later. */
const STATUS_ONLY = process.argv.includes("--status-only");
const actorArg = process.argv.indexOf("--actor");
const ACTOR = actorArg !== -1 ? String(process.argv[actorArg + 1]) : "00000000-0000-0000-0000-migrat000002";
const SINCE = "2026-08-01";
const r2 = (v: number) => Math.round(v * 100) / 100;
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const month = (v: unknown) => (v ? new Date(v as any).toISOString().slice(0, 7) : "-");
const day = (v: unknown) => (v ? new Date(v as any).toISOString().slice(0, 10) : null);
const AMT = `COALESCE(NULLIF(g.amount_with_tax,0), g.amount)`;

function paymentMode(raw: unknown) {
  const r = String(raw ?? "").trim().toLowerCase();
  return ({ cheque: "Cheque", check: "Cheque", neft: "NEFT", rtgs: "RTGS", imps: "IMPS", upi: "UPI", cash: "Cash" } as Record<string, string>)[r] ?? "Other";
}

const NEEDED: Record<string, string[]> = {
  grn_request: ["status", "accounts_payment_status", "review_note", "budget_line_id", "bill_source_id", "vendor_name", "head", "sub_head", "invoice_number", "branch_id", "due_date", "amount_without_tax", "tax_amount", "amount_with_tax", "financial_year", "cost_centre_id"],
  vendor_payment_tracking: ["grn_request_id", "grn_number", "branch_id", "vendor_id", "vendor_name", "head", "sub_head", "due_date", "financial_year", "amount_without_tax", "tax_amount", "amount_with_tax", "cost_centre_id", "bill_source_id", "created_at", "payment_status", "paid_amount", "balance_amount", "due_amount", "payment_date", "payment_mode", "transaction_id", "bank_name", "remarks"],
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

type Bill = { grn_id: string; grn_number: string; trk_id: string; vendor_id: string | null; vendor_name: string | null; head: string; amt: number; bill_date: unknown; created_at: unknown; status?: string; [k: string]: any };
const sameBill = (a: Bill, b: Bill) =>
  Math.abs(Number(a.amt) - Number(b.amt)) <= 1 && norm(a.head) === norm(b.head) && month(a.bill_date) === month(b.bill_date)
  && ((a.vendor_id && a.vendor_id === b.vendor_id) || (norm(a.vendor_name) !== "" && norm(a.vendor_name) === norm(b.vendor_name)));

/** One-to-one pairing: each copy in `copies` is matched to a distinct original in `originals`. */
function pair(originals: Bill[], copies: Bill[]) {
  const used = new Set<string>(); const pairs: { original: Bill; copy: Bill }[] = [];
  for (const c of [...copies].sort((x, y) => Number(y.amt) - Number(x.amt))) {
    const o = originals.find((x) => !used.has(x.grn_id) && x.grn_id !== c.grn_id && sameBill(x, c));
    if (o) { used.add(o.grn_id); pairs.push({ original: o, copy: c }); }
  }
  return pairs;
}

async function main() {
  await preflight();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id grn_id, g.grn_number, g.bill_source_id, g.vendor_id, g.vendor_name, g.head, g.invoice_number, g.bill_date, g.created_at, g.status, g.budget_line_id, ${AMT} amt,
            t.id trk_id, t.payment_status trk_status, t.due_amount, t.paid_amount, t.balance_amount
       FROM grn_request g JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
      WHERE g.grn_type = 'vendor' AND g.status = 'paid' AND g.bill_source_id IS NOT NULL
        AND t.payment_status <> 'Paid'
        AND NOT EXISTS (SELECT 1 FROM vendor_payment_transaction x WHERE x.vendor_payment_id = t.id)`);
  const cands = rows as (Bill & { due_amount: number })[];
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} (actor ${ACTOR}): ${cands.length} legacy GRNs are 'paid' but their tracking is not Paid and has no payment`);

  // A2: imported GRNs still sitting in an approval / payment-pending state that db_bill says were PAID (new legacy
  // imports arrive like this). Tracking row may be Payment Pending or missing altogether.
  const [pendingRows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id grn_id, g.grn_number, g.bill_source_id, g.vendor_id, g.vendor_name, g.head, g.sub_head, g.invoice_number, g.bill_date, g.created_at, g.status, ${AMT} amt,
            g.branch_id, g.due_date, g.amount_without_tax, g.tax_amount, g.amount_with_tax, g.financial_year, g.cost_centre_id,
            t.id trk_id, t.payment_status trk_status, t.due_amount, t.paid_amount, t.balance_amount
       FROM grn_request g LEFT JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
      WHERE g.grn_type = 'vendor' AND g.bill_source_id IS NOT NULL
        AND g.status IN ('finance_head_approved','pending_accounts_payment','payment_scheduled','partially_paid','approved')
        AND (t.id IS NULL OR t.payment_status <> 'Paid')
        AND (t.id IS NULL OR NOT EXISTS (SELECT 1 FROM vendor_payment_transaction x WHERE x.vendor_payment_id = t.id))`);
  const pendingCands = pendingRows as any[];

  // db_bill payments for the candidates AND for every legacy GRN billed recently (the "already paid" pool).
  const [recent] = await db.execute<RowDataPacket[]>(
    `SELECT g.id grn_id, g.grn_number, g.bill_source_id, g.vendor_id, g.vendor_name, g.head, g.bill_date, g.created_at, g.status, ${AMT} amt, t.id trk_id
       FROM grn_request g LEFT JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
      WHERE g.grn_type='vendor' AND g.bill_source_id IS NOT NULL AND g.status = 'paid' AND COALESCE(g.bill_date, DATE(g.created_at)) >= '${SINCE}'`);
  const pays = new Map<number, any[]>();
  const ids = [...new Set([...cands, ...pendingCands, ...(recent as any[])].map((c) => Number(c.bill_source_id)))];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    for (const p of await billQuery<any>(`SELECT Id, GrnId, PaymentMode, PaymentDate, BankName, TransactionId, CreateDate FROM tbl_payment_processing WHERE GrnId IN (${chunk.map(() => "?").join(",")}) ORDER BY Id`, chunk)) {
      const list = pays.get(Number(p.GrnId)) ?? []; list.push(p); pays.set(Number(p.GrnId), list);
    }
  }

  // Live-flow bills (not from db_bill), still alive.
  const [liveRows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id grn_id, g.grn_number, g.vendor_id, g.vendor_name, g.head, g.invoice_number, g.bill_date, g.created_at, g.status, ${AMT} amt,
            t.id trk_id, t.payment_status trk_status, t.paid_amount trk_paid,
            EXISTS (SELECT 1 FROM payment_voucher_grn_allocation a JOIN payment_voucher pv ON pv.id = a.payment_voucher_id
                     WHERE a.vendor_payment_tracking_id = t.id AND pv.status IN ('raised','ceo_approved','changes_requested','released')) has_voucher
       FROM grn_request g LEFT JOIN vendor_payment_tracking t ON t.grn_request_id = g.id
      WHERE g.grn_type='vendor' AND g.bill_source_id IS NULL AND g.status NOT IN ('rejected','cancelled','draft','consumption_reversed') AND g.created_at >= '${SINCE}'`);
  const live = liveRows as Bill[];

  const A = cands.filter((c) => pays.has(Number(c.bill_source_id))).map((c) => ({ ...c, pay: pays.get(Number(c.bill_source_id))!.slice(-1)[0], n: pays.get(Number(c.bill_source_id))!.length }));
  const A2 = pendingCands.filter((c) => pays.has(Number(c.bill_source_id))).map((c) => ({ ...c, pay: pays.get(Number(c.bill_source_id))!.slice(-1)[0], n: pays.get(Number(c.bill_source_id))!.length }));
  const U = cands.filter((c) => !pays.has(Number(c.bill_source_id)));

  // D1: live copies, still awaiting payment with nothing paid and no voucher, of a bill db_bill says was paid.
  const paidLegacy = (recent as Bill[]).filter((r) => pays.has(Number(r.bill_source_id)));
  const D1 = pair(paidLegacy, live.filter((l) => ["pending_accounts_payment", "payment_scheduled"].includes(String(l.status)) && Number(l.trk_paid ?? 0) === 0 && !l.has_voucher && l.trk_id));
  const D1Skipped = pair(paidLegacy, live.filter((l) => Number(l.trk_paid ?? 0) > 0 || l.has_voucher));
  // B1: legacy copies db_bill never paid, whose bill is also in the live flow.
  const B1 = pair(live, U as Bill[]).map((p) => ({ legacy: p.copy, live: p.original }));
  const b1Ids = new Set(B1.map((p) => p.legacy.grn_id));
  const B2 = U.filter((u) => !b1Ids.has(u.grn_id));

  const sum = (xs: { amt: unknown }[]) => r2(xs.reduce((s, x) => s + Number(x.amt), 0));
  console.table([
    { action: "A  db_bill paid it -> tracking Paid + payment recorded", grns: A.length, amount: sum(A) },
    { action: "A2 imported GRN db_bill says is paid, HRMS shows pending/none -> mark paid", grns: A2.length, amount: sum(A2) },
    { action: "D1 live copy of a bill db_bill already paid -> reverse the live copy", grns: D1.length, amount: sum(D1.map((p) => p.copy)) },
    { action: "B1 never paid, re-entered live -> reverse the legacy copy", grns: B1.length, amount: sum(B1.map((p) => p.legacy)) },
    { action: "B2 never paid, not re-entered -> label back to pending", grns: B2.length, amount: sum(B2) },
  ]);
  const lastPay = (b: Bill) => pays.get(Number(b.bill_source_id))!.slice(-1)[0];
  console.log("\nD1 pairs (the live copy is what would have been paid twice):");
  console.table(D1.map((p) => ({ reverse_live: p.copy.grn_number, live_status: p.copy.status, amt: r2(Number(p.copy.amt)), already_paid_legacy: p.original.grn_number, paid_ref: lastPay(p.original).TransactionId, paid_on: day(lastPay(p.original).PaymentDate), live_invoice: p.copy.invoice_number })));
  console.log("\nD1 NOT touched - the live copy already has a payment or a voucher in progress (needs a person):");
  console.table(D1Skipped.map((p) => ({ live: p.copy.grn_number, amt: r2(Number(p.copy.amt)), live_paid: p.copy.trk_paid, voucher: p.copy.has_voucher ? "yes" : "no", legacy_paid: p.original.grn_number })));
  console.log("\nB1 pairs (legacy copy reversed, live copy kept):");
  console.table(B1.map((p) => ({ reverse_legacy: p.legacy.grn_number, amt: r2(Number(p.legacy.amt)), keep_live: p.live.grn_number, live_status: p.live.status, live_invoice: p.live.invoice_number })));
  console.log("\nB2 (kept, relabelled pending):");
  console.table(B2.sort((a, b) => b.amt - a.amt).slice(0, 30).map((x) => ({ grn: x.grn_number, amt: r2(Number(x.amt)), head: x.head, vendor: x.vendor_name, bill_date: day(x.bill_date) })));

  if (!APPLY) { console.log("\nNo changes written. Re-run with --apply (BEFORE backfill-grn-journal)."); await closeBillPool(); return; }

  // ── A and B2: plain row corrections, one transaction, with before-images ──
  const conn = await (db as any).getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS grn_false_paid_fix_bak_grn (id CHAR(36) PRIMARY KEY, grn_id CHAR(36) NOT NULL, grn_number VARCHAR(80), old_status VARCHAR(40), old_accounts_payment_status VARCHAR(40), action VARCHAR(4), backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP, KEY (grn_id))`);
    await conn.query(`CREATE TABLE IF NOT EXISTS grn_false_paid_fix_bak_trk (id CHAR(36) PRIMARY KEY, trk_id CHAR(36) NOT NULL, old_payment_status VARCHAR(30), old_paid_amount DECIMAL(14,2), old_balance_amount DECIMAL(14,2), action VARCHAR(4), backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP, KEY (trk_id))`);
    await conn.beginTransaction();
    const bak = async (grnId: string, trkId: string | null, action: string) => {
      const [[g]] = await conn.query(`SELECT grn_number, status, accounts_payment_status FROM grn_request WHERE id = ?`, [grnId]);
      await conn.query(`INSERT INTO grn_false_paid_fix_bak_grn (id, grn_id, grn_number, old_status, old_accounts_payment_status, action) VALUES (?,?,?,?,?,?)`, [randomUUID(), grnId, g?.grn_number ?? null, g?.status ?? null, g?.accounts_payment_status ?? null, action]);
      if (trkId) {
        const [[t]] = await conn.query(`SELECT payment_status, paid_amount, balance_amount FROM vendor_payment_tracking WHERE id = ?`, [trkId]);
        await conn.query(`INSERT INTO grn_false_paid_fix_bak_trk (id, trk_id, old_payment_status, old_paid_amount, old_balance_amount, action) VALUES (?,?,?,?,?,?)`, [randomUUID(), trkId, t?.payment_status ?? null, t?.paid_amount ?? null, t?.balance_amount ?? null, action]);
      }
    };
    const audit = (grnId: string, grn: string, action: string, extra: object) => conn.query(
      `INSERT INTO sensitive_action_log (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'LEGACY_FALSE_PAID_FIX', 'finance', 'grn_request', ?, ?, NOW(), ?)`,
      [ACTOR, grnId, JSON.stringify({ grn, action, ...extra }), "F-02 reclassification marked this bill paid without a payment; corrected from db_bill evidence"]);

    for (const c of A) {
      await bak(c.grn_id, c.trk_id, "A");
      await conn.query(`UPDATE vendor_payment_tracking SET payment_status='Paid', paid_amount = due_amount, balance_amount = 0, payment_date = ?, payment_mode = ?, transaction_id = ?, bank_name = ? WHERE id = ?`,
        [day(c.pay.PaymentDate), paymentMode(c.pay.PaymentMode), c.pay.TransactionId ?? null, c.pay.BankName ?? null, c.trk_id]);
      await conn.query(`INSERT IGNORE INTO vendor_payment_transaction (id, vendor_payment_id, grn_request_id, sequence_no, payment_mode, payment_date, bank_name, transaction_id, amount, tds_amount, net_amount, remarks, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), c.trk_id, c.grn_id, Number(c.pay.Id), paymentMode(c.pay.PaymentMode), day(c.pay.PaymentDate) ?? day(c.created_at), c.pay.BankName ?? null, c.pay.TransactionId ?? null,
         c.due_amount, 0, c.due_amount, `db_bill payment (${c.n} row${c.n > 1 ? "s" : ""}), recorded by legacy false-paid fix`, ACTOR, c.pay.CreateDate ? new Date(c.pay.CreateDate) : new Date()]);
      await audit(c.grn_id, c.grn_number, "A", { paid_from: "db_bill.tbl_payment_processing", db_bill_rows: c.n });
    }
    for (const c of A2) {
      await bak(c.grn_id, c.trk_id ?? null, "A2");
      let trkId = c.trk_id as string | null;
      const due = Number(c.due_amount ?? c.amt);
      if (trkId) {
        await conn.query(`UPDATE vendor_payment_tracking SET payment_status='Paid', paid_amount = due_amount, balance_amount = 0, payment_date = ?, payment_mode = ?, transaction_id = ?, bank_name = ? WHERE id = ?`,
          [day(c.pay.PaymentDate), paymentMode(c.pay.PaymentMode), c.pay.TransactionId ?? null, c.pay.BankName ?? null, trkId]);
      } else {
        trkId = randomUUID();
        await conn.query(`INSERT INTO vendor_payment_tracking (id, grn_request_id, grn_number, branch_id, vendor_id, vendor_name, head, sub_head, due_amount, due_date, paid_amount, balance_amount, payment_status, financial_year, amount_without_tax, tax_amount, amount_with_tax, cost_centre_id, bill_source_id, payment_date, payment_mode, transaction_id, bank_name, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
          [trkId, c.grn_id, c.grn_number, c.branch_id, c.vendor_id, c.vendor_name, c.head, c.sub_head, due, c.due_date, due, 0, "Paid", c.financial_year, c.amount_without_tax, c.tax_amount, c.amount_with_tax, c.cost_centre_id, c.bill_source_id,
           day(c.pay.PaymentDate), paymentMode(c.pay.PaymentMode), c.pay.TransactionId ?? null, c.pay.BankName ?? null]);
      }
      await conn.query(`INSERT IGNORE INTO vendor_payment_transaction (id, vendor_payment_id, grn_request_id, sequence_no, payment_mode, payment_date, bank_name, transaction_id, amount, tds_amount, net_amount, remarks, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), trkId, c.grn_id, Number(c.pay.Id), paymentMode(c.pay.PaymentMode), day(c.pay.PaymentDate) ?? day(c.created_at), c.pay.BankName ?? null, c.pay.TransactionId ?? null,
         due, 0, due, `db_bill payment (${c.n} row${c.n > 1 ? "s" : ""}), synced from db_bill`, ACTOR, c.pay.CreateDate ? new Date(c.pay.CreateDate) : new Date()]);
      await conn.query(`UPDATE grn_request SET status='paid', accounts_payment_status='paid' WHERE id = ?`, [c.grn_id]);
      await audit(c.grn_id, c.grn_number, "A2", { paid_from: "db_bill.tbl_payment_processing", db_bill_rows: c.n, tracking_created: !c.trk_id });
    }
    for (const c of B2) {
      await bak(c.grn_id, c.trk_id, "B2");
      await conn.query(`UPDATE grn_request SET status='pending_accounts_payment', accounts_payment_status='pending' WHERE id = ? AND status='paid'`, [c.grn_id]);
      await audit(c.grn_id, c.grn_number, "B2", { relabelled_to: "pending_accounts_payment" });
    }
    await conn.commit();
    console.log(`\nA ${A.length}, A2 ${A2.length} and B2 ${B2.length} applied (before-images in grn_false_paid_fix_bak_grn / _trk).`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

  if (STATUS_ONLY) { console.log("\n--status-only: duplicate reversals (D1, B1) left for a later run."); await closeBillPool(); return; }
  // ── D1 and B1: duplicates go through the supported reversal (budget released, journal reversed) ──
  const { grnService } = await import("../src/modules/finance/grn.service.js");
  const bak2 = async (b: Bill) => {
    const [[g]] = await db.execute<any>(`SELECT status, accounts_payment_status FROM grn_request WHERE id = ?`, [b.grn_id]);
    await db.execute(`INSERT INTO grn_false_paid_fix_bak_grn (id, grn_id, grn_number, old_status, old_accounts_payment_status, action) VALUES (?,?,?,?,?,?)`, [randomUUID(), b.grn_id, b.grn_number, g?.status ?? null, g?.accounts_payment_status ?? null, "rev"]);
  };
  const reverse = async (b: Bill, why: string, action: string) => {
    try {
      await bak2(b);
      if (b.bill_source_id && !b.budget_line_id) {
        // A legacy db_bill import never consumed any budget (it has no budget line), so there is nothing to release
        // and reverseConsumption would refuse. It never reached the journal either (checked below). Plain cancel.
        const [[je]] = await db.execute<any>(`SELECT COUNT(*) n FROM journal_entry WHERE source_type='grn' AND source_id = ? AND reversed_by_entry_id IS NULL`, [b.grn_id]);
        if (Number(je?.n) > 0) throw new Error("legacy GRN has a live journal entry - reverse it through the GRN reversal screen");
        const [res] = await db.execute<any>(`UPDATE grn_request SET status='cancelled', accounts_payment_status='cancelled', review_note = ? WHERE id = ? AND status IN ('paid','pending_accounts_payment','approved','partially_paid','payment_scheduled')`, [why.slice(0, 500), b.grn_id]);
        if (Number(res.affectedRows) !== 1) throw new Error("GRN status changed before cancellation");
      } else {
        await (grnService as any).reverseConsumption(b.grn_id, why, ACTOR, "super_admin");
      }
      if (b.trk_id) await db.execute(`UPDATE vendor_payment_tracking SET payment_status='Rejected', remarks = CONCAT(COALESCE(remarks,''), ?) WHERE id = ?`, [` | ${why}`, b.trk_id]);
      await db.execute(
        `INSERT INTO sensitive_action_log (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at, reason)
         VALUES (UUID(), ?, 'LEGACY_FALSE_PAID_FIX', 'finance', 'grn_request', ?, ?, NOW(), ?)`, [ACTOR, b.grn_id, JSON.stringify({ grn: b.grn_number, action }), why]);
      return null;
    } catch (e: any) { return String(e?.message ?? e); }
  };
  const failures: { grn: string; error: string }[] = []; let done = 0;
  for (const p of D1) {
    const err = await reverse(p.copy, `Duplicate of ${p.original.grn_number}, already paid on the legacy bill (db_bill ref ${lastPay(p.original).TransactionId})`, "D1");
    if (err) failures.push({ grn: p.copy.grn_number, error: err }); else done++;
  }
  for (const p of B1) {
    const err = await reverse(p.legacy, `Legacy duplicate of ${p.live.grn_number} (no db_bill payment); the live copy is kept`, "B1");
    if (err) failures.push({ grn: p.legacy.grn_number, error: err }); else done++;
  }
  console.log(`\nD1 + B1: ${done} reversed through the GRN reversal flow, ${failures.length} could not be (they need a person).`);
  if (failures.length) console.table(failures);
  await closeBillPool();
}

main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await db.end?.(); } catch { } process.exit(1); });
