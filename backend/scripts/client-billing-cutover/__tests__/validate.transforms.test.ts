import { describe, it, expect } from "vitest";
import {
  buildCostCentreLookup,
  buildBranchStateCodeLookup,
  resolveBranchStateCode,
  buildInvoiceBillNoIndex,
  matchCreditNoteInvoice,
  validateInvoiceRow,
  validateCreditNoteRow,
  mapInvoiceStatus,
  mapCreditStatus,
  COST_CENTRE_UNRESOLVED_MESSAGE,
  type InvoiceValidationInput,
  type CreditNoteValidationInput,
  type InvoiceMatchResult,
} from "../validate.transforms.js";

const costCentre = buildCostCentreLookup([
  { cost_centre_code: "BSS/BLD/06/650", id: "cc-uuid-1", branch_id: "branch-uuid-1" },
  { cost_centre_code: "BO/DEL", id: "cc-uuid-2", branch_id: "branch-uuid-2" },
]);

// A credit note is validated with an already-resolved invoiceMatch (validate.ts's
// job via matchCreditNoteInvoice) — this fixture represents a clean A4 match.
const resolvedMatch: InvoiceMatchResult = {
  status: "resolved",
  targetInvoiceId: "invoice-target-uuid-1",
  vendorGstin: "07AAACV1234A1Z5",
  error: null,
};

function baseInvoice(overrides: Partial<InvoiceValidationInput> = {}): InvoiceValidationInput {
  return {
    src_id: 1,
    src_category: "Others",
    src_finance_year: "24-25",
    src_month: "Jan",
    src_invoicedate: "2025-01-15",
    src_cost_center: "BSS/BLD/06/650",
    target_gst_type: "Intrastate",
    src_total: "1000",
    src_tax: "180",
    src_igst: "0",
    src_sgst: "90",
    src_cgst: "90",
    src_grnd: "1180",
    ...overrides,
  };
}

function baseCreditNote(overrides: Partial<CreditNoteValidationInput> = {}): CreditNoteValidationInput {
  return {
    src_id: 1,
    src_category: "Others",
    src_finance_year: "24-25",
    src_month: "Jan",
    src_creditdate: "2025-01-15",
    src_cost_center: "BO/DEL",
    target_gst_type: "Intrastate",
    src_total: "1000",
    src_tax: "180",
    src_igst: "0",
    src_sgst: "90",
    src_cgst: "90",
    src_grnd: "1180",
    ...overrides,
  };
}

describe("validateInvoiceRow", () => {
  it("a fully clean row (all quirks resolved) is valid", () => {
    const result = validateInvoiceRow(baseInvoice(), costCentre);
    expect(result).toEqual({ status: "valid", error: null });
  });

  it("flags NULL category as an error (client_invoice.category is NOT NULL)", () => {
    const result = validateInvoiceRow(baseInvoice({ src_category: null }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("category is NULL/blank");
  });

  it("flags blank finance_year", () => {
    const result = validateInvoiceRow(baseInvoice({ src_finance_year: "" }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("finance_year is NULL/blank");
  });

  it("flags blank month_label", () => {
    const result = validateInvoiceRow(baseInvoice({ src_month: null }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("month_label is NULL/blank");
  });

  it("flags blank/unrecoverable invoice_date (design §5.1's 2 zero-date rows)", () => {
    const result = validateInvoiceRow(baseInvoice({ src_invoicedate: null }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("invoice_date is NULL/blank/unrecoverable");
  });

  it("flags NULL target_gst_type as defense-in-depth (A1 addendum: should no longer occur post-fix)", () => {
    const result = validateInvoiceRow(baseInvoice({ target_gst_type: null }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("gst_type is NULL");
  });

  it("accepts A1's 'Not Applicable' fallback value as a valid gst_type", () => {
    const result = validateInvoiceRow(baseInvoice({ target_gst_type: "Not Applicable" }), costCentre);
    expect(result.status).toBe("valid");
  });

  it("flags a legacy cost_center with no cost_centre_master match using A3's fixed, filterable message", () => {
    const result = validateInvoiceRow(baseInvoice({ src_cost_center: "UNKNOWN/CODE" }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain(COST_CENTRE_UNRESOLVED_MESSAGE);
  });

  it("flags a blank cost_center the same way", () => {
    const result = validateInvoiceRow(baseInvoice({ src_cost_center: null }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain(COST_CENTRE_UNRESOLVED_MESSAGE);
  });

  it("flags a non-numeric total (the real 'total'='8800\\r0' quirk found live)", () => {
    const result = validateInvoiceRow(baseInvoice({ src_total: "8800\r0" }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("total does not parse as a decimal");
  });

  it("does NOT flag a NULL amount column — NULL is absent, not a parse failure", () => {
    const result = validateInvoiceRow(baseInvoice({ src_tax: null }), costCentre);
    expect(result.status).toBe("valid");
  });

  it("accumulates multiple simultaneous errors on one row, joined with '; '", () => {
    const result = validateInvoiceRow(
      baseInvoice({ src_category: null, target_gst_type: null, src_total: "not-a-number" }),
      costCentre,
    );
    expect(result.status).toBe("error");
    expect(result.error).toContain("category is NULL/blank");
    expect(result.error).toContain("gst_type is NULL");
    expect(result.error).toContain("total does not parse as a decimal");
  });

  it("truncates a very long combined error message to 500 chars", () => {
    const result = validateInvoiceRow(
      baseInvoice({
        src_category: null,
        src_finance_year: null,
        src_month: null,
        src_invoicedate: null,
        target_gst_type: null,
        src_cost_center: "totally-unknown-code-of-considerable-length-for-padding-purposes",
        src_total: "bad",
        src_tax: "bad",
        src_igst: "bad",
        src_sgst: "bad",
        src_cgst: "bad",
        src_grnd: "bad",
      }),
      costCentre,
    );
    expect(result.status).toBe("error");
    expect(result.error!.length).toBeLessThanOrEqual(500);
  });
});

describe("validateCreditNoteRow (A4 addendum — invoiceMatch replaces the always-fail check)", () => {
  it("a resolved invoiceMatch + otherwise-clean row is valid", () => {
    const result = validateCreditNoteRow(baseCreditNote(), costCentre, resolvedMatch);
    expect(result).toEqual({ status: "valid", error: null });
  });

  it("an unresolved invoiceMatch fails with its own specific reason", () => {
    const unresolved: InvoiceMatchResult = {
      status: "unresolved",
      targetInvoiceId: null,
      vendorGstin: null,
      error: "invoice_id unresolvable - no proforma_bill_no recorded",
    };
    const result = validateCreditNoteRow(baseCreditNote(), costCentre, unresolved);
    expect(result.status).toBe("error");
    expect(result.error).toContain("invoice_id unresolvable - no proforma_bill_no recorded");
  });

  it("an ambiguous invoiceMatch fails with its own specific reason", () => {
    const ambiguous: InvoiceMatchResult = {
      status: "ambiguous",
      targetInvoiceId: null,
      vendorGstin: null,
      error: "invoice_id ambiguous - 3 candidate invoices share this bill_no",
    };
    const result = validateCreditNoteRow(baseCreditNote(), costCentre, ambiguous);
    expect(result.status).toBe("error");
    expect(result.error).toContain("invoice_id ambiguous - 3 candidate invoices share this bill_no");
  });

  it("still reports every other real issue alongside an unresolved invoiceMatch", () => {
    const unresolved: InvoiceMatchResult = {
      status: "unresolved",
      targetInvoiceId: null,
      vendorGstin: null,
      error: "invoice_id unresolvable - no proforma_bill_no recorded",
    };
    const result = validateCreditNoteRow(
      baseCreditNote({ target_gst_type: null, src_category: null }),
      costCentre,
      unresolved,
    );
    expect(result.status).toBe("error");
    expect(result.error).toContain("invoice_id unresolvable");
    expect(result.error).toContain("gst_type is NULL");
    expect(result.error).toContain("category is NULL/blank");
  });

  it("a credit note with a resolvable cost centre and a resolved match, but a stray gst_type NULL, fails on only that one issue", () => {
    const result = validateCreditNoteRow(baseCreditNote({ target_gst_type: null }), costCentre, resolvedMatch);
    expect(result.status).toBe("error");
    const parts = result.error!.split("; ");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("gst_type is NULL");
  });

  it("flags an unresolved cost centre using A3's fixed message even with a resolved invoiceMatch", () => {
    const result = validateCreditNoteRow(
      baseCreditNote({ src_cost_center: "UNKNOWN/CODE" }),
      costCentre,
      resolvedMatch,
    );
    expect(result.status).toBe("error");
    expect(result.error).toContain(COST_CENTRE_UNRESOLVED_MESSAGE);
  });
});

describe("buildBranchStateCodeLookup / resolveBranchStateCode (A1)", () => {
  const branchStateCodes = buildBranchStateCodeLookup([
    { id: "branch-uuid-1", gst_state_code: "07" },
    { id: "branch-uuid-2", gst_state_code: "09" },
    { id: "branch-uuid-3", gst_state_code: null },
  ]);

  it("resolves a known cost centre's code straight through to its branch's gst_state_code", () => {
    expect(resolveBranchStateCode("BSS/BLD/06/650", costCentre, branchStateCodes)).toBe("07");
    expect(resolveBranchStateCode("BO/DEL", costCentre, branchStateCodes)).toBe("09");
  });

  it("trims the cost centre code before lookup", () => {
    expect(resolveBranchStateCode("  BSS/BLD/06/650  ", costCentre, branchStateCodes)).toBe("07");
  });

  it("returns null for an unresolvable cost centre code", () => {
    expect(resolveBranchStateCode("UNKNOWN/CODE", costCentre, branchStateCodes)).toBeNull();
  });

  it("returns null for blank/null input", () => {
    expect(resolveBranchStateCode(null, costCentre, branchStateCodes)).toBeNull();
    expect(resolveBranchStateCode("", costCentre, branchStateCodes)).toBeNull();
  });
});

describe("buildInvoiceBillNoIndex / matchCreditNoteInvoice (A4)", () => {
  const invoiceVendorGstinByTargetId = new Map<string, string | null>([
    ["inv-uuid-1", "07AAACV1234A1Z5"],
    ["inv-uuid-2", null],
  ]);

  it("resolves cleanly when exactly one invoice shares the bill_no and cost centres agree", () => {
    const index = buildInvoiceBillNoIndex([
      { src_bill_no: "09-129/20-21", target_id: "inv-uuid-1", src_cost_center: "BSS/BLD/06/650" },
    ]);
    const result = matchCreditNoteInvoice(
      "09-129/20-21",
      "BSS/BLD/06/650",
      index,
      invoiceVendorGstinByTargetId,
    );
    expect(result).toEqual({
      status: "resolved",
      targetInvoiceId: "inv-uuid-1",
      vendorGstin: "07AAACV1234A1Z5",
      error: null,
    });
  });

  it("is unresolved when proforma_bill_no is blank/null", () => {
    const index = buildInvoiceBillNoIndex([]);
    for (const blank of [null, "", "   "]) {
      const result = matchCreditNoteInvoice(blank, "BO/DEL", index, invoiceVendorGstinByTargetId);
      expect(result.status).toBe("unresolved");
      expect(result.error).toContain("no proforma_bill_no recorded");
    }
  });

  it("is unresolved when no invoice carries that bill_no at all", () => {
    const index = buildInvoiceBillNoIndex([
      { src_bill_no: "09-129/20-21", target_id: "inv-uuid-1", src_cost_center: "BSS/BLD/06/650" },
    ]);
    const result = matchCreditNoteInvoice("09-999/20-21", "BO/DEL", index, invoiceVendorGstinByTargetId);
    expect(result.status).toBe("unresolved");
    expect(result.error).toContain("no invoice found with bill_no");
  });

  it("is ambiguous when more than one invoice shares the bill_no (the design §2 collision bug)", () => {
    const index = buildInvoiceBillNoIndex([
      { src_bill_no: "09-129/20-21", target_id: "inv-uuid-1", src_cost_center: "BSS/BLD/06/650" },
      { src_bill_no: "09-129/20-21", target_id: "inv-uuid-2", src_cost_center: "BO/DEL" },
    ]);
    const result = matchCreditNoteInvoice(
      "09-129/20-21",
      "BSS/BLD/06/650",
      index,
      invoiceVendorGstinByTargetId,
    );
    expect(result.status).toBe("ambiguous");
    expect(result.error).toContain("2 candidate invoices share this bill_no");
    expect(result.targetInvoiceId).toBeNull();
  });

  it("is ambiguous (not silently accepted) when the sole candidate's cost centre disagrees with the credit note's", () => {
    const index = buildInvoiceBillNoIndex([
      { src_bill_no: "09-129/20-21", target_id: "inv-uuid-1", src_cost_center: "BSS/BLD/06/650" },
    ]);
    const result = matchCreditNoteInvoice("09-129/20-21", "BO/DEL", index, invoiceVendorGstinByTargetId);
    expect(result.status).toBe("ambiguous");
    expect(result.error).toContain("disagrees with credit note's cost centre");
    expect(result.targetInvoiceId).toBeNull();
  });

  it("ignores invoices with a blank bill_no when indexing (design §5.4's never-billed rows)", () => {
    const index = buildInvoiceBillNoIndex([
      { src_bill_no: null, target_id: "inv-uuid-1", src_cost_center: "BSS/BLD/06/650" },
      { src_bill_no: "", target_id: "inv-uuid-2", src_cost_center: "BSS/BLD/06/650" },
    ]);
    expect(index.size).toBe(0);
  });
});

describe("mapInvoiceStatus", () => {
  it("no bill_no -> proforma (matches design §5.4's 211 never-billed rows)", () => {
    expect(mapInvoiceStatus(null)).toBe("proforma");
    expect(mapInvoiceStatus("")).toBe("proforma");
  });
  it("a real bill_no -> approved", () => {
    expect(mapInvoiceStatus("09-129/20-21")).toBe("approved");
  });
});

describe("mapCreditStatus", () => {
  it("credit_approve=1 -> approved", () => {
    expect(mapCreditStatus(1)).toBe("approved");
  });
  it("credit_approve=0 or null -> draft", () => {
    expect(mapCreditStatus(0)).toBe("draft");
    expect(mapCreditStatus(null)).toBe("draft");
  });
});
