import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Tally XML export (PRD §6.2.1) — the ENVELOPE > BODY > DATA > TALLYMESSAGE > VOUCHER format,
 * verified against Tally Solutions' own published case study
 * (https://help.tallysolutions.com/docs/td9rel54/integration-capabilities/case_study_1.htm)
 * rather than assumed, because a wrong debit/credit polarity silently swaps which side of a
 * ledger moves on import.
 *
 * Sign convention (confirmed against the official example — Payment voucher paying
 * "Conveyance" via "Bank of India": Conveyance ISDEEMEDPOSITIVE=Yes AMOUNT=-12000.00, Bank
 * ISDEEMEDPOSITIVE=No AMOUNT=12000.00):
 *   ISDEEMEDPOSITIVE=Yes (debit)  -> AMOUNT is NEGATIVE
 *   ISDEEMEDPOSITIVE=No  (credit) -> AMOUNT is POSITIVE
 * Which ledger plays debit vs credit depends on voucher_type:
 *   payment: party/payable ledger is DEBITED (Yes, -amount); bank ledger is CREDITED (No, +amount)
 *   receipt: bank ledger is DEBITED (Yes, -amount); party/receivable ledger is CREDITED (No, +amount)
 *
 * TDS handling: when a voucher's release booked a zero-cash "TDS Payable" memo row
 * (payment-voucher.service.ts's release(), the liability-recognition entry with debit=credit=0
 * because there is no general-ledger table in this schema), the Tally voucher correctly
 * represents it as a THIRD ledger line rather than dropping it — the vendor payable is cleared
 * in FULL (gross), split into a credit to the bank (net) and a credit to TDS Payable
 * (withheld): -(net+tds) + net + tds = 0. This is what makes the exported voucher double-entry
 * correct instead of only showing the net cash movement.
 *
 * Every export is logged (finance_action_audit_log) with entry count and total debit/credit,
 * per PRD §6.3, so a re-export can be checked against the original for tamper/mismatch.
 *
 * isFinal (Phase 4, bank-reconciliation-period.service.ts): an export is "final" only once
 * every row in it belongs to a closed bank_reconciliation_period. Until then it's provisional
 * — see buildEnvelope()'s docstring for the exact rule.
 */

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tallyDate(value: string): string {
  // YYYY-MM-DD -> YYYYMMDD, the format Tally's own case study uses (20080402).
  return String(value).slice(0, 10).replace(/-/g, "");
}

function amt(value: number): string {
  return Math.abs(value).toFixed(2);
}

export interface VoucherExportRow {
  voucher_id: string;
  voucher_number: string;
  voucher_type: "payment" | "receipt";
  entry_date: string;
  narration: string;
  bank_ledger: string;
  party_ledger: string;
  net_amount: number;
  tds_ledger: string | null;
  tds_amount: number;
  period_status: string | null;
}

async function fetchVoucherRows(bankAccountId: string, from?: string, to?: string): Promise<VoucherExportRow[]> {
  const conditions: string[] = ["bale.bank_account_id = ?", "bale.source_type = 'voucher'", "pv.status = 'released'"];
  const params: unknown[] = [bankAccountId];
  if (from) { conditions.push("bale.entry_date >= ?"); params.push(from); }
  if (to) { conditions.push("bale.entry_date <= ?"); params.push(to); }

  // One payment voucher release now inserts ONE cash ledger row PER allocated GRN (Payment
  // Voucher multi-GRN support, 2026-09-10) — a voucher covering 3 GRNs of the same vendor
  // produces 3 rows here, all sharing voucher_id/voucher_number. These must collapse back into
  // ONE Tally <VOUCHER> per payment_voucher (grouped in JS below), or Tally would receive
  // several vouchers all claiming the same VOUCHERNUMBER — a real defect this fix closes.
  const [cashRows] = await db.execute<RowDataPacket[]>(
    `SELECT bale.voucher_id, pv.voucher_number, pv.voucher_type, bale.entry_date, bale.narration,
            bale.created_at,
            cba.tally_ledger_name AS bank_ledger, pam.tally_ledger_name AS party_ledger,
            bale.debit_amount, bale.credit_amount,
            brp.status AS period_status
       FROM bank_account_ledger_entry bale
       JOIN payment_voucher pv ON pv.id = bale.voucher_id
       JOIN company_bank_account cba ON cba.id = bale.bank_account_id
       JOIN payable_account_master pam ON pam.id = bale.payable_account_id
       LEFT JOIN bank_reconciliation_period brp ON brp.id = bale.reconciliation_period_id
      WHERE ${conditions.join(" AND ")} AND (bale.debit_amount > 0 OR bale.credit_amount > 0)
      ORDER BY bale.entry_date ASC, bale.created_at ASC`,
    params,
  );

  if ((cashRows as RowDataPacket[]).length === 0) return [];

  const voucherIds = [...new Set((cashRows as RowDataPacket[]).map((r) => String(r.voucher_id)))];
  const placeholders = voucherIds.map(() => "?").join(",");

  // TDS withheld per voucher: sum across every GRN this voucher paid, read from
  // payment_voucher_grn_allocation joined to vendor_payment_tracking's own tds_deducted_amount
  // — NOT the zero-cash memo ledger row itself, which never carried the amount (debit=credit=0
  // by design, see payment-voucher.service.ts). Falls back to the voucher's single
  // linked_vendor_payment_id for a voucher raised before the allocation table existed.
  const [tdsRows] = voucherIds.length
    ? await db.execute<RowDataPacket[]>(
        `SELECT pv.id AS voucher_id,
                COALESCE(
                  (SELECT SUM(vpt.tds_deducted_amount)
                     FROM payment_voucher_grn_allocation pvga
                     JOIN vendor_payment_tracking vpt ON vpt.id = pvga.vendor_payment_tracking_id
                    WHERE pvga.payment_voucher_id = pv.id),
                  (SELECT vpt2.tds_deducted_amount FROM vendor_payment_tracking vpt2 WHERE vpt2.id = pv.linked_vendor_payment_id),
                  0
                ) AS tds_total
           FROM payment_voucher pv
          WHERE pv.id IN (${placeholders})`,
        voucherIds,
      )
    : [[]];
  const tdsByVoucher = new Map<string, number>();
  for (const r of tdsRows as RowDataPacket[]) tdsByVoucher.set(String(r.voucher_id), Number(r.tds_total ?? 0));

  // One TDS-memo ledger row's payable_account (e.g. "TDS Payable") per voucher — every memo row
  // for one voucher points at the same account, so any one of them names the right ledger.
  const [memoRows] = voucherIds.length
    ? await db.execute<RowDataPacket[]>(
        `SELECT bale.voucher_id, pam.tally_ledger_name
           FROM bank_account_ledger_entry bale
           JOIN payable_account_master pam ON pam.id = bale.payable_account_id
          WHERE bale.voucher_id IN (${placeholders}) AND bale.debit_amount = 0 AND bale.credit_amount = 0
          GROUP BY bale.voucher_id, pam.tally_ledger_name`,
        voucherIds,
      )
    : [[]];
  const tdsLedgerByVoucher = new Map<string, string>();
  for (const r of memoRows as RowDataPacket[]) tdsLedgerByVoucher.set(String(r.voucher_id), String((r as any).tally_ledger_name));

  type Grouped = { rows: RowDataPacket[] };
  const grouped = new Map<string, Grouped>();
  for (const row of cashRows as RowDataPacket[]) {
    const key = String(row.voucher_id);
    if (!grouped.has(key)) grouped.set(key, { rows: [] });
    grouped.get(key)!.rows.push(row);
  }

  const result: VoucherExportRow[] = [];
  for (const [voucherId, { rows }] of grouped) {
    const first = rows[0];
    const netAmount = rows.reduce(
      (sum, r) => sum + (Number(r.debit_amount) > 0 ? Number(r.debit_amount) : Number(r.credit_amount)),
      0,
    );
    const tdsAmount = tdsByVoucher.get(voucherId) ?? 0;
    const tdsLedger = tdsAmount > 0 ? tdsLedgerByVoucher.get(voucherId) ?? null : null;

    result.push({
      voucher_id: voucherId,
      voucher_number: String(first.voucher_number),
      voucher_type: first.voucher_type,
      entry_date: String(first.entry_date).slice(0, 10),
      narration:
        rows.length > 1
          ? `${String(first.narration ?? "").split(" — GRN ")[0]} — ${rows.length} GRNs`
          : String(first.narration ?? ""),
      bank_ledger: String(first.bank_ledger),
      party_ledger: String(first.party_ledger),
      net_amount: netAmount,
      tds_ledger: tdsLedger,
      tds_amount: tdsAmount,
      period_status: first.period_status ? String(first.period_status) : null,
    });
  }
  result.sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.voucher_number.localeCompare(b.voucher_number));
  return result;
}

/** Exported for unit testing the sign-convention/balancing logic without touching the DB —
 *  see __tests__/tally-export.service.test.ts. */
export function buildVoucherXml(row: VoucherExportRow): string {
  const voucherTypeName = row.voucher_type === "receipt" ? "Receipt" : "Payment";
  const isPayment = row.voucher_type !== "receipt";

  // debit ledger/amount, credit ledger(s)/amount — see the module header for the derivation.
  const grossAmount = row.net_amount + row.tds_amount;
  const lines: string[] = [];
  if (isPayment) {
    // Party is debited for the FULL liability being cleared (gross = net + TDS withheld).
    lines.push(ledgerLine(row.party_ledger, "Yes", -grossAmount));
    lines.push(ledgerLine(row.bank_ledger, "No", row.net_amount));
    if (row.tds_ledger && row.tds_amount > 0) {
      lines.push(ledgerLine(row.tds_ledger, "No", row.tds_amount));
    }
  } else {
    lines.push(ledgerLine(row.bank_ledger, "Yes", -grossAmount));
    lines.push(ledgerLine(row.party_ledger, "No", row.net_amount));
    if (row.tds_ledger && row.tds_amount > 0) {
      lines.push(ledgerLine(row.tds_ledger, "No", row.tds_amount));
    }
  }

  return `      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="${xmlEscape(voucherTypeName)}" ACTION="Create">
          <DATE>${tallyDate(row.entry_date)}</DATE>
          <NARRATION>${xmlEscape(row.narration)}</NARRATION>
          <VOUCHERTYPENAME>${xmlEscape(voucherTypeName)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${xmlEscape(row.voucher_number)}</VOUCHERNUMBER>
${lines.join("\n")}
        </VOUCHER>
      </TALLYMESSAGE>`;
}

function ledgerLine(ledgerName: string, isDeemedPositive: "Yes" | "No", signedAmount: number): string {
  return `          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${xmlEscape(ledgerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isDeemedPositive}</ISDEEMEDPOSITIVE>
            <AMOUNT>${signedAmount < 0 ? "-" : ""}${amt(signedAmount)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
}

export const tallyExportService = {
  /**
   * Builds the full ENVELOPE for one bank account's released vouchers in a date range.
   *
   * `isFinal` is true only when EVERY row in the range belongs to a bank_reconciliation_period
   * that is 'closed' (bank-reconciliation-period.service.ts's close() sets reconciliation_period_id
   * on each entry it locks). A range that mixes a closed period with rows still outstanding in an
   * open one stays provisional — never partially final — per PRD §6.3.
   */
  async buildEnvelope(bankAccountId: string, from?: string, to?: string) {
    const rows = await fetchVoucherRows(bankAccountId, from, to);
    const isFinal = rows.length > 0 && rows.every((r) => r.period_status === "closed");
    const watermark = isFinal ? "" : "\n  <!-- PROVISIONAL EXPORT: no bank_reconciliation for this period is closed yet. Not for final Tally posting. -->";
    const body = rows.map(buildVoucherXml).join("\n");
    const xml = `<ENVELOPE>${watermark}
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC></DESC>
    <DATA>
${body}
    </DATA>
  </BODY>
</ENVELOPE>
`;
    const totalDebit = rows.reduce((sum, r) => sum + r.net_amount + r.tds_amount, 0);
    const totalCredit = totalDebit; // every voucher is individually balanced by construction
    return { xml, isFinal, entryCount: rows.length, totalDebit, totalCredit };
  },

  async exportAndLog(bankAccountId: string, from: string | undefined, to: string | undefined, actorUserId: string, actorRole?: string) {
    const result = await this.buildEnvelope(bankAccountId, from, to);
    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "BANK_LEDGER_TALLY_EXPORT_GENERATED",
      module_key: "FINANCE",
      entity_type: "company_bank_account",
      entity_id: bankAccountId,
      change_summary: {
        from: from ?? null, to: to ?? null,
        entry_count: result.entryCount, total_debit: result.totalDebit, total_credit: result.totalCredit,
        is_final: result.isFinal,
      },
    }).catch(() => undefined);
    return result;
  },
};
