import { describe, it, expect } from "vitest";
import {
  buildCostCentreLookup,
  validateInvoiceRow,
  validateCreditNoteRow,
  mapInvoiceStatus,
  mapCreditStatus,
  type InvoiceValidationInput,
  type CreditNoteValidationInput,
} from "../validate.transforms.js";

const costCentre = buildCostCentreLookup([
  { cost_centre_code: "BSS/BLD/06/650", id: "cc-uuid-1" },
  { cost_centre_code: "BO/DEL", id: "cc-uuid-2" },
]);

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

  it("flags NULL target_gst_type (design §5.2 vs live NOT NULL gst_type column)", () => {
    const result = validateInvoiceRow(baseInvoice({ target_gst_type: null }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("gst_type is NULL");
  });

  it("flags a legacy cost_center with no cost_centre_master match", () => {
    const result = validateInvoiceRow(baseInvoice({ src_cost_center: "UNKNOWN/CODE" }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("cost_centre_id cannot be resolved");
  });

  it("flags a blank cost_center the same way", () => {
    const result = validateInvoiceRow(baseInvoice({ src_cost_center: null }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("cost_centre_id cannot be resolved");
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

describe("validateCreditNoteRow", () => {
  it("ALWAYS flags invoice_id, even on an otherwise-clean row — no legacy linking column exists", () => {
    const result = validateCreditNoteRow(baseCreditNote(), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("invoice_id cannot be resolved");
  });

  it("still reports every other real issue alongside the always-present invoice_id one", () => {
    const result = validateCreditNoteRow(baseCreditNote({ target_gst_type: null, src_category: null }), costCentre);
    expect(result.status).toBe("error");
    expect(result.error).toContain("invoice_id cannot be resolved");
    expect(result.error).toContain("gst_type is NULL");
    expect(result.error).toContain("category is NULL/blank");
  });

  it("a credit note with a resolvable cost centre still fails only on invoice_id + gst_type when those are the sole issues", () => {
    const result = validateCreditNoteRow(baseCreditNote({ target_gst_type: null }), costCentre);
    expect(result.status).toBe("error");
    const parts = result.error!.split("; ");
    expect(parts).toHaveLength(2);
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
