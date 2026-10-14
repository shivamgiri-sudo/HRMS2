import type { RowDataPacket } from "mysql2";
import { env } from "../../config/env.js";
import { billQuery } from "../../db/billDb.js";

/**
 * Keeps a bill out of the Tally import when the legacy billing system already sent it.
 *
 * db_bill is still taking GRNs, and Accounts have been entering the same vendor bill in both systems:
 * on 2026-10-14, 71 of 78 recent HRMS GRNs with a bill number were the same bill as a db_bill vendor
 * GRN already downloaded to Tally. Exporting those again would book the expense, GST and vendor
 * payable twice.
 *
 * Two tiers, because the second entry is often typed differently:
 *   exact     same bill number (ignoring punctuation and case) and amount within Rs 2
 *   probable  amount within Rs 2 and either the same legacy vendor within 7 days of the bill date
 *             ("NA" bills, a mistyped bill number; a month apart is a new bill, e.g. monthly rent)
 *             or one bill number ending in the other
 *             ("26-27/91" vs "2026-27/91")
 * Both are left out with the legacy GRN named, so Accounts can see it on the check sheet.
 *
 * Two sources, so this keeps working after db_bill is switched off:
 *   - grn_request rows migrated from db_bill (bill_source_id set): always available.
 *   - db_bill itself (vendor GRNs with DownloadStatus = 1), read-only, only while BILL_DB_HOST is
 *     configured; a db_bill outage just narrows the check to the migrated rows.
 */

type Executor = { execute(sql: string, params?: any[]): Promise<[any, any]> };

export type LegacyBill = {
  grnNumber: string;
  amount: number;
  billKey: string;
  /** "L<tbl_vendormaster.Id>" when known, else "H<vendor_master.id>". */
  vendorKey: string | null;
  billDate: string | null; // YYYY-MM-DD
  source: "hrms-migrated" | "db_bill";
};

export type LegacyBillIndex = {
  bills: LegacyBill[];
  byBill: Map<string, LegacyBill[]>;
  /** HRMS vendor_master.id -> vendor key, for the GRNs being exported. */
  vendorKeys: Map<string, string>;
};

export type LegacyHit = { bill: LegacyBill; kind: "exact" | "probable" };

/** "OESPL/26-27/0511" and "oespl 26-27 0511" are the same bill. */
export const normaliseBillNo = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const usable = (key: string) => key.length >= 2 && key !== "NA" && key !== "NIL";

/** db_bill keeps dates as dd-mm-yyyy text; HRMS as DATE. */
const isoDate = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const s = String(value).trim();
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const vendorKeyOf = (code: unknown, id: unknown) => {
  const m = /^DB_BILL_(\d+)$/.exec(String(code ?? ""));
  return m ? `L${m[1]}` : id ? `H${id}` : null;
};

export async function loadLegacyBills(executor: Executor, rows: RowDataPacket[]): Promise<LegacyBillIndex> {
  const index: LegacyBillIndex = { bills: [], byBill: new Map(), vendorKeys: new Map() };
  const vendorRows = rows.filter((r) => r.grn_type !== "imprest");
  if (!vendorRows.length) return index;

  const dates = vendorRows.map((r) => isoDate(r.bill_date)).filter(Boolean).sort() as string[];
  const since = dates[0] ? new Date(Date.parse(`${dates[0]}T00:00:00Z`) - 180 * 86400000).toISOString().slice(0, 10) : "2000-01-01";

  const vendorCodes = async (ids: string[]) => {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const [found] = (await executor.execute(
      `SELECT id, vendor_code FROM vendor_master WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    )) as [RowDataPacket[], unknown];
    for (const v of found) {
      const k = vendorKeyOf(v.vendor_code, v.id);
      if (k) out.set(String(v.id), k);
    }
    return out;
  };

  try {
    index.vendorKeys = await vendorCodes([...new Set(vendorRows.map((r) => String(r.vendor_id ?? "")).filter(Boolean))]);
  } catch {
    /* no vendor keys: only the bill-number tiers apply */
  }

  const add = (entry: LegacyBill) => {
    index.bills.push(entry);
    if (!usable(entry.billKey)) return;
    if (!index.byBill.has(entry.billKey)) index.byBill.set(entry.billKey, []);
    index.byBill.get(entry.billKey)!.push(entry);
  };

  try {
    const [migrated] = (await executor.execute(
      `SELECT grn_number, invoice_number, amount_with_tax, amount, vendor_id, bill_date
         FROM grn_request
        WHERE bill_source_id IS NOT NULL AND grn_type = 'vendor' AND bill_date >= ?`,
      [since],
    )) as [RowDataPacket[], unknown];
    let keys = new Map<string, string>();
    try {
      keys = await vendorCodes([...new Set(migrated.map((m) => String(m.vendor_id ?? "")).filter(Boolean))]);
    } catch {
      /* keep the bill-number tiers */
    }
    for (const m of migrated) {
      add({
        grnNumber: String(m.grn_number ?? ""),
        amount: Number(m.amount_with_tax) > 0 ? Number(m.amount_with_tax) : Number(m.amount),
        billKey: normaliseBillNo(m.invoice_number),
        vendorKey: keys.get(String(m.vendor_id ?? "")) ?? null,
        billDate: isoDate(m.bill_date),
        source: "hrms-migrated",
      });
    }
  } catch {
    /* without the migrated rows the db_bill read below is the only check */
  }

  if (env.BILL_DB_HOST) {
    try {
      const legacy = (await billQuery<any>(
        `SELECT GrnNo, bill_no, Amount, Vendor, bill_date FROM expense_entry_master
          WHERE ExpenseEntryType = 'Vendor' AND DownloadStatus = 1 AND createdate >= ?`,
        [since],
      )) as any[];
      for (const l of legacy)
        add({
          grnNumber: String(l.GrnNo ?? ""),
          amount: Number(l.Amount) || 0,
          billKey: normaliseBillNo(l.bill_no),
          vendorKey: l.Vendor ? `L${l.Vendor}` : null,
          billDate: isoDate(l.bill_date),
          source: "db_bill",
        });
    } catch {
      /* db_bill unreachable: the migrated rows above still apply */
    }
  }
  return index;
}

const days = (a: string | null, b: string | null) =>
  a && b ? Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000 : Infinity;

/** The legacy GRN that already carried this bill to Tally, if any. */
export function legacyDuplicate(
  index: LegacyBillIndex,
  row: Record<string, unknown>,
  gross: number,
): LegacyHit | null {
  const near = (b: LegacyBill) => Math.abs(b.amount - gross) <= 2;
  const billKey = normaliseBillNo(row.invoice_number);
  if (usable(billKey)) {
    const exact = (index.byBill.get(billKey) ?? []).find(near);
    if (exact) return { bill: exact, kind: "exact" };
  }
  const vendorKey = index.vendorKeys.get(String(row.vendor_id ?? "")) ?? null;
  const billDate = isoDate(row.bill_date);
  for (const b of index.bills) {
    if (!near(b)) continue;
    if (vendorKey && b.vendorKey === vendorKey && days(b.billDate, billDate) <= 7) return { bill: b, kind: "probable" };
    if (billKey.length >= 4 && b.billKey.length >= 4 && (billKey.endsWith(b.billKey) || b.billKey.endsWith(billKey)))
      return { bill: b, kind: "probable" };
  }
  return null;
}

export const duplicateReason = (hit: LegacyHit) =>
  hit.kind === "exact"
    ? `Already in Tally through legacy GRN ${hit.bill.grnNumber} (same bill number and amount); left out so it is not booked twice.`
    : `Probably already in Tally through legacy GRN ${hit.bill.grnNumber} (same vendor or bill number ending and same amount, bill number written differently); left out — confirm with Accounts.`;
