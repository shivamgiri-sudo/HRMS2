import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import ExcelJS from "exceljs";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { parseCsv, parseTallySheet, parseTallyXml, type TallyVoucher } from "./tally-import-parse.js";
import { matchPayments, normName, reviewPurchases, type OpenBill, type PaymentRow, type PurchaseRow } from "./tally-import-match.js";

/**
 * Takes payments Finance made in Tally into HRMS.
 *
 * preview(): parse the export (XML, CSV or Excel), match each Payment voucher to the vendor's open GRNs, and
 * store the result as a batch. Nothing is recorded.
 * apply(): record the matched payments. Each Tally voucher is recorded once, ever: tally_import_voucher has a
 * UNIQUE key on the voucher's identity, inserted first inside the voucher's own transaction, so a re-upload of
 * the same file (or the same voucher in another file) records nothing the second time.
 *
 * Only the payment is recorded (a transaction on the GRN's payment record, its paid/TDS/balance and status). No
 * bank-ledger or journal entry: Tally already holds the accounting, and a second posting here would double it.
 */

export class TallyImportError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const MAX_BYTES = 10 * 1024 * 1024;
const r2 = (n: number) => Math.round(n * 100) / 100;

const cellValue = (v: unknown): unknown => {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join("");
    if (o.result !== undefined) return o.result;
    if (o.text !== undefined) return o.text;
  }
  return v;
};

export async function parseTallyFile(buffer: Buffer, fileName: string): Promise<TallyVoucher[]> {
  if (buffer.length > MAX_BYTES) throw new TallyImportError("The file is larger than 10 MB.");
  const name = fileName.toLowerCase();
  if (name.endsWith(".xml") || buffer.slice(0, 200).toString("utf8").includes("<ENVELOPE")) return parseTallyXml(buffer.toString("utf8"));
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseTallySheet(parseCsv(buffer.toString("utf8")));
  if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new TallyImportError("The workbook has no sheet.");
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => rows.push((row.values as unknown[]).slice(1).map(cellValue)));
    return parseTallySheet(rows);
  }
  throw new TallyImportError("Upload a Tally export as .xml, .csv or .xlsx.");
}

async function loadBills(vendorKeys: string[]): Promise<{ open: Map<string, OpenBill[]>; all: Map<string, OpenBill[]> }> {
  const open = new Map<string, OpenBill[]>(); const all = new Map<string, OpenBill[]>();
  for (let i = 0; i < vendorKeys.length; i += 400) {
    const chunk = vendorKeys.slice(i, i + 400);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.id, t.grn_request_id, t.grn_number, g.invoice_number, t.vendor_name, t.due_amount, t.paid_amount, t.tds_deducted_amount, t.balance_amount, t.payment_status
         FROM vendor_payment_tracking t JOIN grn_request g ON g.id = t.grn_request_id
        WHERE UPPER(TRIM(t.vendor_name)) IN (${chunk.map(() => "?").join(",")})
          AND t.payment_status NOT IN ('Rejected','Closed') AND g.status NOT IN ('rejected','cancelled','draft','consumption_reversed')`, chunk);
    for (const r of rows as RowDataPacket[]) {
      const key = normName(r.vendor_name);
      const b: OpenBill = {
        trackingId: String(r.id), grnId: String(r.grn_request_id), grnNumber: String(r.grn_number ?? ""), invoiceNumber: r.invoice_number ? String(r.invoice_number) : null,
        vendorKey: key, due: Number(r.due_amount), paid: Number(r.paid_amount), balance: r2(Number(r.due_amount) - Number(r.paid_amount)), /* paid_amount is gross: TDS is part of it, as dispatch stores it */ status: String(r.payment_status),
      };
      (all.get(key) ?? all.set(key, []).get(key)!).push(b);
      if (b.balance > 0.005 && b.status !== "Paid") (open.get(key) ?? open.set(key, []).get(key)!).push(b);
    }
  }
  return { open, all };
}

export type PreviewResult = {
  batchId: string; fileName: string; vouchers: number;
  summary: Record<string, number>; payments: PaymentRow[]; purchases: PurchaseRow[];
};

export const tallyPaymentImport = {
  async preview(buffer: Buffer, fileName: string, userId: string): Promise<PreviewResult> {
    const vouchers = await parseTallyFile(buffer, fileName);
    if (!vouchers.length) throw new TallyImportError("No vouchers were found in this file. Export the Day Book (or a vendor's Ledger Vouchers) from Tally as XML, CSV or Excel.");

    const parties = new Set<string>();
    for (const v of vouchers) for (const l of v.ledgers) if (l.name) parties.add(normName(l.name));
    const { open, all } = await loadBills([...parties]);

    const keys = vouchers.map((v) => v.key);
    const done = new Set<string>();
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT voucher_key FROM tally_import_voucher WHERE voucher_key IN (${chunk.map(() => "?").join(",")})`, chunk);
      for (const r of rows as RowDataPacket[]) done.add(String(r.voucher_key));
    }

    const payments = matchPayments(vouchers, open, all, done);
    const purchases = reviewPurchases(vouchers, all);
    const summary: Record<string, number> = {};
    for (const p of payments) summary[p.status] = (summary[p.status] ?? 0) + 1;
    summary.purchase_without_grn = purchases.filter((p) => p.status === "not_in_hrms").length;

    const batchId = randomUUID();
    await db.execute(
      `INSERT INTO tally_import_batch (id, file_name, uploaded_by, status, summary, payment_rows, purchase_rows) VALUES (?,?,?,?,?,?,?)`,
      [batchId, fileName.slice(0, 255), userId || null, "previewed", JSON.stringify(summary), JSON.stringify(payments), JSON.stringify(purchases)]);
    return { batchId, fileName, vouchers: vouchers.length, summary, payments, purchases };
  },

  async getBatch(batchId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM tally_import_batch WHERE id = ? LIMIT 1`, [batchId]);
    const b = (rows as RowDataPacket[])[0];
    if (!b) throw new TallyImportError("Import batch not found.", 404);
    return { ...b, summary: JSON.parse(String(b.summary ?? "{}")), payments: JSON.parse(String(b.payment_rows ?? "[]")) as PaymentRow[], purchases: JSON.parse(String(b.purchase_rows ?? "[]")) as PurchaseRow[] };
  },

  async listBatches(limit = 20) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.id, b.file_name, b.status, b.summary, b.created_at, b.applied_at,
              (SELECT COUNT(*) FROM tally_import_voucher v WHERE v.batch_id = b.id) AS recorded
         FROM tally_import_batch b ORDER BY b.created_at DESC LIMIT ${Math.min(Math.max(Math.trunc(limit) || 20, 1), 100)}`);
    return (rows as RowDataPacket[]).map((r) => ({ ...r, summary: JSON.parse(String(r.summary ?? "{}")) }));
  },

  /**
   * Records the batch's payments. `choices` maps a voucher key to the tracking id the user picked for an
   * ambiguous row. Returns what was recorded and what was skipped, with the reason.
   */
  async apply(batchId: string, choices: Record<string, string>, userId: string, role: string) {
    const batch = await this.getBatch(batchId);
    const recorded: { key: string; number: string; party: string; amount: number }[] = [];
    const skipped: { key: string; number: string; party: string; reason: string }[] = [];

    for (const row of batch.payments) {
      let allocations = row.allocations;
      if (row.status === "ambiguous") {
        const pick = choices?.[row.key];
        if (!pick || !row.candidateIds.includes(pick)) { skipped.push({ key: row.key, number: row.number, party: row.party, reason: "Ambiguous: no bill chosen." }); continue; }
        allocations = [{ trackingId: pick, grnNumber: "", invoiceNumber: null, amount: row.amount, by: "amount" }];
      } else if (row.status !== "ready") { skipped.push({ key: row.key, number: row.number, party: row.party, reason: row.note || row.status }); continue; }

      const conn: PoolConnection = await db.getConnection();
      try {
        await conn.beginTransaction();
        // The identity row goes in FIRST: a second recording of this voucher stops here.
        try {
          await conn.execute(`INSERT INTO tally_import_voucher (id, voucher_key, batch_id, voucher_no, party, amount, imported_by) VALUES (?,?,?,?,?,?,?)`,
            [randomUUID(), row.key, batchId, row.number.slice(0, 120), row.party.slice(0, 255), row.amount, userId || null]);
        } catch (e: any) {
          if (e?.code === "ER_DUP_ENTRY") { await conn.rollback(); skipped.push({ key: row.key, number: row.number, party: row.party, reason: "Already recorded from an earlier import." }); continue; }
          throw e;
        }

        const total = allocations.reduce((s, a) => s + a.amount, 0) || 1;
        for (const a of allocations) {
          const [[t]] = await conn.execute<RowDataPacket[]>(
            `SELECT id, grn_request_id, due_amount, paid_amount, tds_deducted_amount FROM vendor_payment_tracking WHERE id = ? FOR UPDATE`, [a.trackingId]) as any;
          if (!t) throw new TallyImportError(`Payment record for ${a.grnNumber || a.trackingId} no longer exists.`);
          const tds = r2(row.tds * (a.amount / total));
          const net = r2(a.amount - tds);
          const paidBefore = Number(t.paid_amount ?? 0); const tdsBefore = Number(t.tds_deducted_amount ?? 0);
          const balanceBefore = r2(Number(t.due_amount) - paidBefore);
          if (a.amount > balanceBefore + 1) throw new TallyImportError(`${a.grnNumber || a.trackingId}: payment ${a.amount} is more than the open balance ${balanceBefore}.`);
          const paidAfter = r2(paidBefore + a.amount); const tdsAfter = r2(tdsBefore + tds);
          const balanceAfter = r2(Math.max(0, Number(t.due_amount) - paidAfter));
          const status = balanceAfter <= 0.01 ? "Paid" : "Partially Paid";
          const [[seq]] = await conn.execute<RowDataPacket[]>(`SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM vendor_payment_transaction WHERE vendor_payment_id = ?`, [a.trackingId]) as any;
          await conn.execute(
            `INSERT INTO vendor_payment_transaction (id, vendor_payment_id, grn_request_id, sequence_no, payment_mode, payment_date, transaction_id, amount, tds_amount, net_amount, remarks, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [randomUUID(), a.trackingId, t.grn_request_id, Number(seq.n), "Other", row.date ?? new Date().toISOString().slice(0, 10), `Tally:${row.number}`.slice(0, 255), a.amount, tds, net,
             `Imported from Tally voucher ${row.number}${row.narration ? ` - ${row.narration}` : ""}`.slice(0, 1000), userId]);
          await conn.execute(
            `UPDATE vendor_payment_tracking SET paid_amount = ?, tds_deducted_amount = ?, balance_amount = ?, payment_status = ?, payment_date = ?, transaction_id = ?, updated_by = ?, updated_at = NOW() WHERE id = ?`,
            [paidAfter, tdsAfter, balanceAfter, status, row.date, `Tally:${row.number}`.slice(0, 255), userId, a.trackingId]);
          await conn.execute(`UPDATE grn_request SET status = ?, accounts_payment_status = ? WHERE id = ?`,
            [status === "Paid" ? "paid" : "partially_paid", status === "Paid" ? "paid" : "partially_paid", t.grn_request_id]);
        }
        await conn.commit();
        recorded.push({ key: row.key, number: row.number, party: row.party, amount: row.amount });
      } catch (e: any) {
        await conn.rollback();
        skipped.push({ key: row.key, number: row.number, party: row.party, reason: e instanceof TallyImportError ? e.message : `Could not record: ${e?.message ?? e}` });
      } finally { conn.release(); }
    }

    await db.execute(`UPDATE tally_import_batch SET status = 'applied', applied_at = NOW() WHERE id = ?`, [batchId]);
    await logSensitiveAction({
      actor_user_id: userId, actor_role: role, action_type: "TALLY_PAYMENT_IMPORT_APPLIED", module_key: "FINANCE", entity_type: "tally_import_batch", entity_id: batchId,
      change_summary: { file: batch.file_name, recorded: recorded.length, skipped: skipped.length, amount: r2(recorded.reduce((s, r) => s + r.amount, 0)) },
    }).catch(() => undefined);
    return { recorded, skipped };
  },
};
