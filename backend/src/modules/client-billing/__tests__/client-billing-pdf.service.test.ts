import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let clientBillingPdfService: typeof import("../client-billing-pdf.service.js")["clientBillingPdfService"];
beforeAll(async () => {
  ({ clientBillingPdfService } = await import("../client-billing-pdf.service.js"));
});

beforeEach(() => {
  execute.mockReset();
});

const PROFORMA_INVOICE = {
  id: "inv-proforma-1", cost_centre_id: "cc-1", invoice_status: "proforma",
  category: "Subscription", finance_year: "2026-27", month_label: "Aug-26",
  invoice_date: "2026-08-18", description: "Aug seat charges", proforma_no: "PI/09/7971",
  bill_no: null, gst_type: "Integrated", apply_gst: 1,
  total_amount: 30000, igst_amount: 5400, cgst_amount: 0, sgst_amount: 0, grand_total: 35400,
  created_at: "2026-08-18 10:00:00",
};

const APPROVED_INTRASTATE_INVOICE = {
  id: "inv-approved-1", cost_centre_id: "cc-2", invoice_status: "approved",
  category: "Non Subscription", finance_year: "2026-27", month_label: "Aug-26",
  invoice_date: "2026-08-19", description: null, proforma_no: "PI/09/7972",
  bill_no: "09-01/26-27", gst_type: "Intrastate", apply_gst: 1,
  total_amount: 4678, igst_amount: 0, cgst_amount: 421.02, sgst_amount: 421.02, grand_total: 5520.04,
  created_at: "2026-08-19 09:00:00",
};

const LINES = [
  { line_type: "charge", particulars: "OB Dedicated Seat 1", qty: 1, rate: 30000, amount: 30000 },
];

const LINES_WITH_DEDUCTION = [
  { line_type: "charge", particulars: "OB Dedicated Seat 1", qty: 1, rate: 30000, amount: 30000 },
  { line_type: "deduction", particulars: "Downtime credit", qty: 1, rate: 1200, amount: 1200 },
];

const COST_CENTRE_ROW = {
  billToAddress1: "3rd Floor, Tower A", billToAddress2: "Cyber City", billToAddress3: "Gurugram",
  shipToAddress1: null, shipToAddress2: null, shipToAddress3: null,
  hsnCode: null, sacCode: "998593", serviceTaxNo: "06AAJCM1234F1Z5",
  vendorGstNo: "27AAJCV1234F1Z2", vendorGstState: "Maharashtra",
  billingClientName: "Vodafone Mobile Services Ltd", companyName: "Mas Callnet India Pvt Ltd",
  stateCode: "09",
};

describe("generateInvoicePdf", () => {
  it("throws statusCode 400 when the invoice does not exist", async () => {
    execute.mockResolvedValueOnce([[], []]); // client_invoice lookup: empty

    await expect(
      clientBillingPdfService.generateInvoicePdf("missing-id")
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not found/) });

    // Only the invoice lookup should run before the not-found throw.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("renders a PDF buffer for a known proforma invoice", async () => {
    execute
      .mockResolvedValueOnce([[PROFORMA_INVOICE], []]) // client_invoice
      .mockResolvedValueOnce([LINES, []]) // client_invoice_line
      .mockResolvedValueOnce([[COST_CENTRE_ROW], []]); // cost_centre_master + branch_master join

    const buffer = await clientBillingPdfService.generateInvoicePdf(PROFORMA_INVOICE.id);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders a PDF buffer for a known approved intrastate invoice (CGST+SGST split)", async () => {
    execute
      .mockResolvedValueOnce([[APPROVED_INTRASTATE_INVOICE], []])
      .mockResolvedValueOnce([[], []]) // no lines is a legitimate case, still renders
      .mockResolvedValueOnce([[{ ...COST_CENTRE_ROW, stateCode: "27" }], []]);

    const buffer = await clientBillingPdfService.generateInvoicePdf(APPROVED_INTRASTATE_INVOICE.id);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders without throwing when a line is a deduction (amount flips sign in the display)", async () => {
    execute
      .mockResolvedValueOnce([[PROFORMA_INVOICE], []])
      .mockResolvedValueOnce([LINES_WITH_DEDUCTION, []])
      .mockResolvedValueOnce([[COST_CENTRE_ROW], []]);

    const buffer = await clientBillingPdfService.generateInvoicePdf(PROFORMA_INVOICE.id);

    // Exercises the `line_type === "deduction"` sign-flip branch in the line-items table —
    // pdfkit compresses its content streams by default, so we can't cheaply assert the
    // rendered text itself; this asserts the branch executes cleanly end-to-end and still
    // produces a valid PDF, closing the coverage gap flagged in review.
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("still renders when cost_centre_master has no matching row (LEFT JOIN found nothing)", async () => {
    execute
      .mockResolvedValueOnce([[PROFORMA_INVOICE], []])
      .mockResolvedValueOnce([LINES, []])
      .mockResolvedValueOnce([[], []]); // cost centre join: no row

    const buffer = await clientBillingPdfService.generateInvoicePdf(PROFORMA_INVOICE.id);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("queries client_invoice, client_invoice_line, and the cost_centre_master/branch_master join in that order", async () => {
    execute
      .mockResolvedValueOnce([[PROFORMA_INVOICE], []])
      .mockResolvedValueOnce([LINES, []])
      .mockResolvedValueOnce([[COST_CENTRE_ROW], []]);

    await clientBillingPdfService.generateInvoicePdf(PROFORMA_INVOICE.id);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(String(execute.mock.calls[0][0])).toMatch(/FROM client_invoice WHERE id = \?/);
    expect(execute.mock.calls[0][1]).toEqual([PROFORMA_INVOICE.id]);
    expect(String(execute.mock.calls[1][0])).toMatch(/FROM client_invoice_line WHERE invoice_id = \?/);
    expect(execute.mock.calls[1][1]).toEqual([PROFORMA_INVOICE.id]);
    expect(String(execute.mock.calls[2][0])).toMatch(/FROM cost_centre_master cc\s+LEFT JOIN branch_master b/);
    expect(execute.mock.calls[2][1]).toEqual([PROFORMA_INVOICE.cost_centre_id]);
  });
});