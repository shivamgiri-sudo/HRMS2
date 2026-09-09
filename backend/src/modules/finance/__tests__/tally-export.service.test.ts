import { describe, expect, it } from "vitest";
import { buildVoucherXml, type VoucherExportRow } from "../tally-export.service.js";

/**
 * Tally XML sign-convention correctness (Payment Voucher System Phase 3).
 *
 * Verified against Tally Solutions' own published case study
 * (help.tallysolutions.com/docs/td9rel54/integration-capabilities/case_study_1.htm): a Payment
 * voucher paying "Conveyance" via "Bank of India" is ISDEEMEDPOSITIVE=Yes/AMOUNT=-12000.00 for
 * Conveyance (the debited party) and ISDEEMEDPOSITIVE=No/AMOUNT=12000.00 for the bank (credited).
 * These tests pin that convention so a future edit cannot silently swap debit and credit on
 * real Tally imports — the failure mode is not a crash, it is every voucher landing backwards.
 */

function row(overrides: Partial<VoucherExportRow> = {}): VoucherExportRow {
  return {
    voucher_id: "v1",
    voucher_number: "PV/HQ/202609/0001",
    voucher_type: "payment",
    entry_date: "2026-09-09",
    narration: "Vendor payment released",
    bank_ledger: "HDFC Current Account",
    party_ledger: "Vendor Payables",
    net_amount: 50000,
    tds_ledger: null,
    tds_amount: 0,
    ...overrides,
  };
}

describe("tally-export.service buildVoucherXml", () => {
  it("payment voucher: debits the party ledger (negative) and credits the bank ledger (positive)", () => {
    const xml = buildVoucherXml(row());
    expect(xml).toContain("<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>");
    expect(xml).toContain("<VOUCHERNUMBER>PV/HQ/202609/0001</VOUCHERNUMBER>");
    // Party: debit -> Yes, negative
    expect(xml).toMatch(/<LEDGERNAME>Vendor Payables<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-50000\.00<\/AMOUNT>/);
    // Bank: credit -> No, positive
    expect(xml).toMatch(/<LEDGERNAME>HDFC Current Account<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>50000\.00<\/AMOUNT>/);
  });

  it("receipt voucher: debits the bank ledger (negative) and credits the party ledger (positive) — the mirror of payment", () => {
    const xml = buildVoucherXml(row({ voucher_type: "receipt" }));
    expect(xml).toContain("<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>");
    expect(xml).toMatch(/<LEDGERNAME>HDFC Current Account<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-50000\.00<\/AMOUNT>/);
    expect(xml).toMatch(/<LEDGERNAME>Vendor Payables<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>50000\.00<\/AMOUNT>/);
  });

  it("TDS withheld: three ledger lines that sum to zero — the party is debited the GROSS (net+TDS), split into two credits", () => {
    const r = row({ net_amount: 45000, tds_ledger: "TDS Payable", tds_amount: 5000 });
    const xml = buildVoucherXml(r);
    // Party debited for the full gross (net + tds), not just net.
    expect(xml).toMatch(/<LEDGERNAME>Vendor Payables<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-50000\.00<\/AMOUNT>/);
    // Bank credited for the net cash that actually moved.
    expect(xml).toMatch(/<LEDGERNAME>HDFC Current Account<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>45000\.00<\/AMOUNT>/);
    // TDS Payable credited for the withheld portion.
    expect(xml).toMatch(/<LEDGERNAME>TDS Payable<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>5000\.00<\/AMOUNT>/);

    // The whole point of double-entry: every voucher's lines must net to zero, or Tally
    // rejects the import outright.
    const amounts = [...xml.matchAll(/<AMOUNT>(-?\d+\.\d{2})<\/AMOUNT>/g)].map((m) => Number(m[1]));
    const sum = amounts.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(0);
  });

  it("no TDS: exactly two ledger lines, still netting to zero", () => {
    const xml = buildVoucherXml(row());
    const lines = xml.match(/<ALLLEDGERENTRIES\.LIST>/g) ?? [];
    expect(lines).toHaveLength(2);
    const amounts = [...xml.matchAll(/<AMOUNT>(-?\d+\.\d{2})<\/AMOUNT>/g)].map((m) => Number(m[1]));
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("escapes XML special characters in narration and ledger names", () => {
    const xml = buildVoucherXml(row({ narration: `Payment & "Cheque" <bounced>`, party_ledger: "A & B Traders" }));
    expect(xml).toContain("Payment &amp; &quot;Cheque&quot; &lt;bounced&gt;");
    expect(xml).toContain("A &amp; B Traders");
    expect(xml).not.toContain("<bounced>");
  });
});
