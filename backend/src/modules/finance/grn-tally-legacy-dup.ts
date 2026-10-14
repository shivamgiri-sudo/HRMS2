import type { RowDataPacket } from "mysql2";
import { env } from "../../config/env.js";
import { billQuery } from "../../db/billDb.js";

/**
 * Keeps a bill out of the Tally import when the legacy billing system already sent it.
 *
 * db_bill is still taking GRNs, and Accounts have been entering the same vendor bill in both systems:
 * on 2026-10-14, 71 of 78 recent HRMS GRNs with a bill number were the same bill (same bill number,
 * amount within Rs 2) as a db_bill vendor GRN already downloaded to Tally. Exporting those again
 * would book the expense, GST and vendor payable twice.
 *
 * Two sources, so this keeps working after db_bill is switched off:
 *   - grn_request rows migrated from db_bill (bill_source_id set): always available.
 *   - db_bill itself (vendor GRNs with DownloadStatus = 1), read-only, only while BILL_DB_HOST is
 *     configured; a db_bill outage just narrows the check to the migrated rows.
 */

type Executor = { execute(sql: string, params?: any[]): Promise<[any, any]> };

export type LegacyBill = { grnNumber: string; amount: number; source: "hrms-migrated" | "db_bill" };

/** "OESPL/26-27/0511" and "oespl 26-27 0511" are the same bill. */
export const normaliseBillNo = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const usable = (key: string) => key.length >= 2 && key !== "NA" && key !== "NIL";

export async function loadLegacyBills(
  executor: Executor,
  rows: RowDataPacket[],
): Promise<Map<string, LegacyBill[]>> {
  const out = new Map<string, LegacyBill[]>();
  const wanted = new Set(rows.map((r) => normaliseBillNo(r.invoice_number)).filter(usable));
  if (!wanted.size) return out;
  const add = (bill: unknown, entry: LegacyBill) => {
    const key = normaliseBillNo(bill);
    if (!wanted.has(key)) return;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(entry);
  };

  const dates = rows.map((r) => String(r.bill_date ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const since = dates[0] ? new Date(Date.parse(`${dates[0]}T00:00:00Z`) - 180 * 86400000).toISOString().slice(0, 10) : "2000-01-01";

  try {
    const [migrated] = (await executor.execute(
      `SELECT grn_number, invoice_number, amount_with_tax, amount
         FROM grn_request
        WHERE bill_source_id IS NOT NULL AND grn_type = 'vendor' AND bill_date >= ?
          AND invoice_number IS NOT NULL AND TRIM(invoice_number) <> ''`,
      [since],
    )) as [RowDataPacket[], unknown];
    for (const m of migrated) {
      const amount = Number(m.amount_with_tax) > 0 ? Number(m.amount_with_tax) : Number(m.amount);
      add(m.invoice_number, { grnNumber: String(m.grn_number ?? ""), amount, source: "hrms-migrated" });
    }
  } catch {
    /* without the migrated rows the db_bill read below is the only check */
  }

  if (env.BILL_DB_HOST) {
    try {
      const legacy = (await billQuery<any>(
        `SELECT GrnNo, bill_no, Amount FROM expense_entry_master
          WHERE ExpenseEntryType = 'Vendor' AND DownloadStatus = 1 AND createdate >= ?`,
        [since],
      )) as any[];
      for (const l of legacy) add(l.bill_no, { grnNumber: String(l.GrnNo ?? ""), amount: Number(l.Amount) || 0, source: "db_bill" });
    } catch {
      /* db_bill unreachable: the migrated rows above still apply */
    }
  }
  return out;
}

/** The legacy GRN that already carried this bill to Tally, if any. */
export function legacyDuplicate(
  bills: Map<string, LegacyBill[]>,
  invoiceNumber: unknown,
  gross: number,
): LegacyBill | null {
  const hits = bills.get(normaliseBillNo(invoiceNumber)) ?? [];
  return hits.find((h) => Math.abs(h.amount - gross) <= 2) ?? null;
}

export const duplicateReason = (hit: LegacyBill) =>
  `Already in Tally through legacy GRN ${hit.grnNumber} (same bill number and amount); left out so it is not booked twice.`;
