/**
 * Unit tests for the pieces added on 2026-10-14 (no jsdom in this repo — pure functions plus
 * `renderToStaticMarkup` for markup, same as the page test).
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientBillingApi", () => ({
  INVOICE_TYPES: ["Revenue", "Non Revenue"],
  listProformas: vi.fn(() => new Promise(() => {})),
  getBillingFilterOptions: vi.fn(() => new Promise(() => {})),
  bulkApproveInvoices: vi.fn(),
}));

import { auditActionLabel, auditActor } from "../auditLabels";
import { buildCsv, csvEscape } from "../csv";
import { invoiceTaxRows, taxRate } from "../invoiceTax";
import { blockingPartyWarnings } from "../InvoiceApproveView";
import { buildApprovalSteps } from "../InvoiceDetailSections";
import { Table, initialFilters, toListFilters } from "../legacyListParts";
import { InvoiceApprovalList } from "../InvoiceApprovalList";
import type { AuditLogEntry, InvoiceRow } from "@/lib/clientBillingApi";

const baseRow = {
  id: "inv-1", cost_centre_id: "cc-1", invoice_status: "proforma", category: "Others", finance_year: "2026-27",
  month_label: "Sep-26", invoice_date: "2026-09-30", description: null, proforma_no: "PF/1", bill_no: null,
  gst_type: "Integrated", apply_gst: 1, total_amount: "1000.00", igst_amount: "180.00", cgst_amount: "0.00",
  sgst_amount: "0.00", grand_total: "1180.00", created_by: "u-maker", created_at: "2026-09-30 10:00:00",
  updated_at: null, rejected_reason: null, rejected_by: null, rejected_at: null, tally_head: null, client_tally_name: null,
} as unknown as InvoiceRow;

const audit = (action: string, extra: Partial<AuditLogEntry> = {}): AuditLogEntry =>
  ({ id: `a-${action}`, invoice_id: "inv-1", action, actor_id: "u-x", reason: null, created_at: "2026-10-01 10:00:00", ...extra }) as AuditLogEntry;

describe("audit labels", () => {
  it("maps new action codes and prefers actor names", () => {
    expect(auditActionLabel("po_approved")).toBe("PO approved");
    expect(auditActionLabel("grn_added")).toBe("GRN added");
    expect(auditActionLabel("edited")).toBe("Edited");
    expect(auditActionLabel("something_new")).toBe("something new");
    expect(auditActor({ actor_id: "u1", actor_name: "Asha", actor_email: "a@x" })).toBe("Asha");
    expect(auditActor({ actor_id: "u1", actor_name: null, actor_email: "a@x" })).toBe("a@x");
    expect(auditActor({ actor_id: "u1" })).toBe("u1");
  });
});

describe("tax rows from the record", () => {
  it("derives the rate and shows only heads with an amount", () => {
    expect(invoiceTaxRows(baseRow).map((r) => r.label)).toEqual(["Total:", "IGST @ 18.00%", "Grand Total:"]);
    const intra = { ...baseRow, igst_amount: 0, cgst_amount: "60.00", sgst_amount: "60.00", grand_total: "1120.00" };
    expect(invoiceTaxRows(intra).map((r) => r.label)).toEqual(["Total:", "CGST @ 6.00%", "SGST @ 6.00%", "Grand Total:"]);
    const none = { ...baseRow, igst_amount: 0, grand_total: "1000.00" };
    expect(invoiceTaxRows(none).map((r) => r.label)).toEqual(["Total:", "Grand Total:"]);
    expect(taxRate(1, 0)).toBe("0");
  });
});

describe("party warnings that need acknowledgement", () => {
  it("keeps client GSTIN and blank Bill To, ignores the rest", () => {
    expect(blockingPartyWarnings([
      "Client GSTIN is not recorded on the cost centre.",
      'Client GSTIN "X" is not a valid GSTIN.',
      "Bill To address is blank on the cost centre.",
      "SAC / HSN code is blank on the cost centre.",
    ])).toHaveLength(3);
    expect(blockingPartyWarnings(undefined)).toEqual([]);
  });
});

describe("approval timeline", () => {
  it("fills who / when per step from the row and the audit log", () => {
    const row = { ...baseRow, invoice_status: "approved", bill_no: "B/1", proforma_approved_at: "2026-10-01 09:00:00", proforma_approved_by: "u-checker", last_sent_at: null } as InvoiceRow;
    const steps = buildApprovalSteps(row, [audit("approved", { actor_name: "Finance Head" })]);
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.created.by).toBe("u-maker");
    expect(byKey.proforma.by).toBe("u-checker");
    expect(byKey.invoice.by).toBe("Finance Head");
    expect(byKey.invoice.state).toBe("done");
    expect(byKey.sent.state).toBe("pending");
  });

  it("adds a failed void step with reason for rejected records", () => {
    const row = { ...baseRow, invoice_status: "rejected", bill_no: "B/9", rejected_at: "2026-10-02 10:00:00", rejected_by: "u-r", rejected_reason: "Duplicate" } as InvoiceRow;
    const last = buildApprovalSteps(row, []).at(-1)!;
    expect(last).toMatchObject({ title: "Voided", state: "failed", by: "u-r", note: "Duplicate" });
  });
});

describe("csv", () => {
  it("quotes only when needed", () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape(null)).toBe("");
    expect(buildCsv(["A", "B"], [[1, "x"]])).toBe("A,B\n1,x");
  });
});

describe("legacy list filters", () => {
  it("map 1:1 onto the list / export query", () => {
    const f = { ...initialFilters("2026-27"), number: " PF ", fromDate: "2026-09-01", costCentreId: "cc-1", invoiceType: "Revenue" };
    expect(toListFilters(f)).toEqual({
      companyName: undefined, branchId: undefined, financeYear: "2026-27", search: "PF", fromDate: "2026-09-01",
      toDate: undefined, costCentreId: "cc-1", invoiceType: "Revenue",
    });
  });

  it("a load error shows the message and Retry instead of 'No records found'", () => {
    const html = renderToStaticMarkup(
      <Table head={["A"]} loading={false} empty error={new Error("boom")} onRetry={() => {}}><tr /></Table>,
    );
    expect(html).toContain("Could not load the list: boom");
    expect(html).toContain("Retry");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No records found");
  });
});

describe("InvoiceApprovalList", () => {
  it("renders row checkboxes (live rows only) and the page total", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rows = [
      { ...baseRow, proforma_approved_at: "2026-10-01" },
      { ...baseRow, id: "inv-2", proforma_no: "PF/2", is_migrated: 1 },
    ];
    client.setQueryData(["client-billing", "legacy-invoice-approval", initialFilters(""), 1], { success: true, data: rows, total: 2 });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <InvoiceApprovalList onView={() => {}} onEdit={() => {}} onReject={() => {}} onOpen={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Select PF/1");
    expect(html).not.toContain("Select PF/2");
    expect(html).toContain("Reject PF/1");
    expect(html).not.toContain("Reject PF/2");
    expect(html).toContain("2,000");
  });
});
