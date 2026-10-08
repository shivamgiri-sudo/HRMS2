import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * REPORT FORMAT CONTRACTS.
 *
 * Where a reference format has been supplied, the business-facing export must reproduce it
 * exactly. Backend and calculations may be modernised; the output contract may not drift.
 * Finance already works from these headers, and a renamed or reordered column silently breaks
 * whatever consumes the file — which is the kind of failure nobody notices until a month-end
 * reconciliation does not tie.
 *
 * Each contract below records WHERE the reference came from, so a future reader can tell a
 * verified format from an assumed one.
 */

// ── GRN Payment Report ───────────────────────────────────────────────────────
// Reference: db_bill.tbl_payment_processing, 12,553 rows, still being written (latest
// 2026-08-04). Columns GrnNo, BranchId, Head, SubHead, DueAmount, DueDate, PaymentMode,
// PaymentDate, BankName, TransactionId; Grn File from expense_entry_master.grn_file.
const GRN_PAYMENT_REPORT_COLUMNS = [
  "Sr. No.",
  "Branch",
  "Grn No.",
  "Head",
  "SubHead",
  "Due Amount",
  "Due Date",
  "Grn File",
  "Payment Mode",
  "Payment Date",
  "Bank Name",
  "Transaction ID / Cheque No.",
];

// ── Tally salary voucher ─────────────────────────────────────────────────────
// Reference: the supplied MAS and IDC June-2026 workbooks. Their layouts DIFFER, so they are
// two contracts, not one: IDC has ten columns, MAS has twelve — two unnamed columns sit
// between Amount and DebitCredit, and Amount equals their sum on 48 of 48 rows.
const IDC_VOUCHER_COLUMNS = [
  "Vch No", "Date", "Details", "Amount", "DebitCredit",
  "Cost Category", "Cost Centre", "Narration for Each Entry", "Narration", "VchType",
];
const MAS_VOUCHER_COLUMNS = [
  "Vch No", "Date", "Details", "Amount", "", "",
  "DebitCredit", "Cost Category", "Cost Centre",
  "Narration for Each Entry", "Narration", "VchType",
];

function exportSource(): string {
  return readFileSync(new URL("../vendor-payment.routes.ts", import.meta.url), "utf8");
}

describe("GRN Payment Report — the default export is the legacy format", () => {
  const src = exportSource();

  it("declares the twelve legacy columns, spelled exactly", () => {
    for (const column of GRN_PAYMENT_REPORT_COLUMNS) {
      expect(src, `missing or renamed column: ${column}`).toContain(`"${column}"`);
    }
  });

  it("keeps them in the legacy order", () => {
    // Order is part of the contract. Reorganising into a "better logical grouping" is exactly
    // what this test exists to prevent.
    const block = src.slice(src.indexOf("const LEGACY_COLUMNS"), src.indexOf("const EXTENDED_COLUMNS"));
    const found = GRN_PAYMENT_REPORT_COLUMNS.map((c) => block.indexOf(`"${c}"`));
    expect(found.every((i) => i > -1), "a legacy column is missing from LEGACY_COLUMNS").toBe(true);
    const sorted = [...found].sort((a, b) => a - b);
    expect(found).toEqual(sorted);
  });

  it("does not rename Due Amount, Grn No. or SubHead", () => {
    // The three most tempting to "tidy". HRMS2 internally calls them due_amount_with_tax,
    // grn_number and sub_head; the report must not.
    const block = src.slice(src.indexOf("const LEGACY_COLUMNS"), src.indexOf("const EXTENDED_COLUMNS"));
    expect(block).toContain('"Due Amount"');
    expect(block).not.toContain('"Due Amount With Tax"');
    expect(block).toContain('"Grn No."');
    expect(block).toContain('"SubHead"');
  });

  it("still carries Grn File, which the previous export had dropped", () => {
    expect(src).toContain('"Grn File"');
    expect(src).toContain("grn_file_name");
  });

  it("keeps the richer columns available rather than deleting them", () => {
    // "As-is" protects the official report; it does not mean losing data anyone already used.
    expect(src).toContain("EXTENDED_COLUMNS");
    expect(src).toContain('format ?? ""');
  });

  it("emits one value per column", () => {
    // A row/header length mismatch shifts every field one to the left and is invisible until
    // someone reads the file.
    // Captures only the legacy branch of the ternary — the `: [ ... ]` immediately before
    // .map(escape). Counting commas across the whole block would include the extended array.
    const match = /:\s*\[([\s\S]*?)\]\s*\)\s*\.map\(escape\)/.exec(src);
    expect(match, "could not locate the legacy row builder").not.toBeNull();
    const fields = match![1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(fields).toHaveLength(GRN_PAYMENT_REPORT_COLUMNS.length);
  });
});

describe("Tally salary voucher — MAS and IDC are separate contracts", () => {
  it("records both column lists, and they genuinely differ", () => {
    // The brief said to compare field by field and keep both templates if the layouts differ.
    // They do: twelve columns against ten.
    expect(MAS_VOUCHER_COLUMNS.length).toBe(12);
    expect(IDC_VOUCHER_COLUMNS.length).toBe(10);
    expect(MAS_VOUCHER_COLUMNS).not.toEqual(IDC_VOUCHER_COLUMNS);
  });

  it("keeps the two unnamed MAS columns between Amount and DebitCredit", () => {
    // They carry data — Amount equals their sum on every row of the reference file — and an
    // exporter that quietly drops them would shift DebitCredit two columns left.
    expect(MAS_VOUCHER_COLUMNS[3]).toBe("Amount");
    expect(MAS_VOUCHER_COLUMNS[4]).toBe("");
    expect(MAS_VOUCHER_COLUMNS[5]).toBe("");
    expect(MAS_VOUCHER_COLUMNS[6]).toBe("DebitCredit");
    expect(IDC_VOUCHER_COLUMNS[4]).toBe("DebitCredit");
  });

  it("pins the header spelling the reference actually uses", () => {
    // "DebitCredit" is one word; "Narration for Each Entry" is sentence case with "for" and
    // "Each" as written. These are Tally import headers, not prose.
    expect(IDC_VOUCHER_COLUMNS).toContain("DebitCredit");
    expect(IDC_VOUCHER_COLUMNS).toContain("Narration for Each Entry");
    expect(IDC_VOUCHER_COLUMNS).toContain("VchType");
    expect(IDC_VOUCHER_COLUMNS).not.toContain("Debit/Credit");
    expect(IDC_VOUCHER_COLUMNS).not.toContain("Voucher No");
  });
});
