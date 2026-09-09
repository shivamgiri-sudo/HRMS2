import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * The Credit/Debit report (PRD §6.1) — bank_account_ledger_entry joined out to everything a
 * reader needs without opening each voucher: ledger head, party/vendor, and who raised/
 * CEO-approved/released the voucher behind the entry. Also the source for the CSV/Tally
 * exports (§6.2), so this is the one place that decides what a "row" of the bank book means.
 */
export interface LedgerReportFilters {
  bankAccountId: string;
  from?: string;
  to?: string;
  limit?: number;
}

async function fetchRows(filters: LedgerReportFilters) {
  const conditions: string[] = ["bale.bank_account_id = ?"];
  const params: unknown[] = [filters.bankAccountId];
  if (filters.from) { conditions.push("bale.entry_date >= ?"); params.push(filters.from); }
  if (filters.to) { conditions.push("bale.entry_date <= ?"); params.push(filters.to); }
  const limit = Math.min(5000, Math.max(1, filters.limit ?? 2000));

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bale.id, bale.entry_date, bale.debit_amount, bale.credit_amount, bale.running_balance,
            bale.narration, bale.instrument_ref, bale.source_type, bale.created_at,
            pam.account_name AS ledger_head,
            pv.voucher_number, pv.voucher_type, pv.source_type AS voucher_source_type,
            pv.raised_by, pv.ceo_approved_by, pv.released_by,
            vpt.vendor_name,
            e.full_name AS imprest_manager_name,
            ru.full_name AS raised_by_name, cu.full_name AS ceo_approved_by_name, rl.full_name AS released_by_name
       FROM bank_account_ledger_entry bale
       LEFT JOIN payable_account_master pam ON pam.id = bale.payable_account_id
       LEFT JOIN payment_voucher pv ON pv.id = bale.voucher_id
       LEFT JOIN vendor_payment_tracking vpt ON vpt.id = pv.linked_vendor_payment_id
       LEFT JOIN imprest_manager im ON im.id = pv.linked_imprest_manager_id
       LEFT JOIN employees e ON e.id = im.employee_id
       LEFT JOIN employees ru ON ru.user_id = pv.raised_by
       LEFT JOIN employees cu ON cu.user_id = pv.ceo_approved_by
       LEFT JOIN employees rl ON rl.user_id = pv.released_by
      WHERE ${conditions.join(" AND ")}
      ORDER BY bale.entry_date ASC, bale.created_at ASC, bale.id ASC
      LIMIT ${limit}`,
    params,
  );
  return rows as RowDataPacket[];
}

function typeLabel(row: RowDataPacket) {
  if (row.source_type === "reconciliation_adjustment") return "Adjustment";
  if (row.voucher_type === "receipt") return "Receipt";
  return "Payment";
}

function partyLabel(row: RowDataPacket) {
  return row.vendor_name ?? row.imprest_manager_name ?? null;
}

export const bankLedgerService = {
  async getReport(filters: LedgerReportFilters) {
    const rows = await fetchRows(filters);
    return rows.map((row) => ({
      entry_date: row.entry_date,
      voucher_number: row.voucher_number ?? null,
      type: typeLabel(row),
      ledger_head: row.ledger_head ?? null,
      party: partyLabel(row),
      debit: Number(row.debit_amount ?? 0),
      credit: Number(row.credit_amount ?? 0),
      running_balance: Number(row.running_balance ?? 0),
      instrument_ref: row.instrument_ref ?? null,
      narration: row.narration,
      raised_by: row.raised_by_name ?? null,
      ceo_approved_by: row.ceo_approved_by_name ?? null,
      released_by: row.released_by_name ?? null,
    }));
  },

  /** Same escape convention as imprest.routes.ts's CSV export — quote on comma/quote/newline. */
  async toCsv(filters: LedgerReportFilters): Promise<string> {
    const report = await this.getReport(filters);
    const columns = [
      "Date", "Voucher No.", "Type", "Ledger Head", "Party/Vendor",
      "Debit", "Credit", "Running Balance", "Instrument/UTR", "Narration",
      "Raised By", "CEO Approved By", "Released By",
    ];
    const money = (value: number) => (value === 0 ? "" : value.toFixed(2));
    const escape = (value: unknown) => {
      const text = String(value ?? "");
      // Formula-injection guard, same as gst-export.routes.ts: a cell opening with =, +, - or @
      // is prefixed so a spreadsheet never executes it as a formula.
      const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
    };
    const body = report.map((r) => [
      r.entry_date, r.voucher_number ?? "", r.type, r.ledger_head ?? "", r.party ?? "",
      money(r.debit), money(r.credit), r.running_balance.toFixed(2), r.instrument_ref ?? "",
      r.narration ?? "", r.raised_by ?? "", r.ceo_approved_by ?? "", r.released_by ?? "",
    ]);
    return [columns, ...body].map((row) => row.map(escape).join(",")).join("\n");
  },
};
