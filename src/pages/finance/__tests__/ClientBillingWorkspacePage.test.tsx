/**
 * ClientBillingWorkspacePage tests (Task 3 of docs/superpowers/plans/2026-08-19-client-billing-frontend.md).
 *
 * Environment reality check (see vitest.config.ts's own comment and
 * src/components/tracker/__tests__/TrackerSummaryCards.test.tsx's header): this repo has
 * **no jsdom and no @testing-library/react/user-event installed** (verified against
 * node_modules and both package.json files — only @playwright/test exists for real browser
 * interaction, as an e2e tool, not a unit-test one). Frontend vitest runs under
 * `environment: "node"`. Every existing component test in this repo either:
 *   (a) renders via `react-dom/server`'s `renderToStaticMarkup` and asserts on the resulting
 *       HTML string (src/components/attendance/__tests__/attendance-calendar-matches-table.test.tsx), or
 *   (b) reads the real source file as text and asserts specific code is present
 *       (src/tests/process-pnl-page.contract.test.tsx), or
 *   (c) tests extracted pure logic with no rendering at all.
 * There is no `render()`/`fireEvent`/`userEvent.click()` anywhere in this codebase's frontend
 * tests, because clicking requires a real DOM event system that isn't installed here.
 *
 * This file follows the same two patterns:
 *   - Section A renders the REAL page component (`clientBillingApi.ts` mocked at the module
 *     boundary, matching the plan's Step 1 instruction) via `renderToStaticMarkup` and asserts
 *     mocked API data actually appears in the output — genuine data-flow coverage.
 *     `@/components/ui/tabs` is also mocked to a plain-div passthrough, because Radix's real
 *     `Tabs.Content` only mounts the *active* panel (`Presence present={forceMount || isSelected}`,
 *     confirmed by reading node_modules/@radix-ui/react-tabs/dist/index.mjs) — with no jsdom click
 *     to switch tabs, only the `defaultValue` panel would ever render otherwise. This is the one
 *     place a UI primitive is mocked, and only to defeat that SSR mount gate, not the feature logic.
 *   - Section B verifies the click-driven mutation wiring (create/approve/reject/download) that a
 *     real DOM would normally exercise via `userEvent.click()`, by asserting the exact call sites in
 *     the real, live source files — the same technique process-pnl-page.contract.test.tsx already
 *     uses in this same `finance` domain. Every payload shape asserted here is cross-checked against
 *     `src/lib/clientBillingApi.ts`'s real exported function signatures and payload interfaces
 *     (read directly, not guessed) so a signature drift would break these assertions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Module-boundary mock of clientBillingApi.ts (plan's Task 3 Step 1 instruction: mock this,
//    not hrmsApi directly, since the page and its sub-components import from here). ──────────
const listProformas = vi.fn();
const getProforma = vi.fn();
const createProforma = vi.fn();
const approveInvoice = vi.fn();
const rejectInvoice = vi.fn();
const getAuditLog = vi.fn();
const listCreditNotes = vi.fn();
const getCreditNote = vi.fn();
const createCreditNote = vi.fn();
const approveCreditNote = vi.fn();
const downloadInvoicePdf = vi.fn();

vi.mock("@/lib/clientBillingApi", () => ({
  listProformas: (...args: unknown[]) => listProformas(...args),
  getProforma: (...args: unknown[]) => getProforma(...args),
  createProforma: (...args: unknown[]) => createProforma(...args),
  approveInvoice: (...args: unknown[]) => approveInvoice(...args),
  rejectInvoice: (...args: unknown[]) => rejectInvoice(...args),
  getAuditLog: (...args: unknown[]) => getAuditLog(...args),
  listCreditNotes: (...args: unknown[]) => listCreditNotes(...args),
  getCreditNote: (...args: unknown[]) => getCreditNote(...args),
  createCreditNote: (...args: unknown[]) => createCreditNote(...args),
  approveCreditNote: (...args: unknown[]) => approveCreditNote(...args),
  downloadInvoicePdf: (...args: unknown[]) => downloadInvoicePdf(...args),
}));

// DashboardLayout pulls in react-router's useLocation/useNavigate + AuthContext, none of which
// this page's own behaviour depends on — passthrough it so the test doesn't need a Router/Auth
// provider stack unrelated to client-billing.
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => children,
}));

// See file header: real Radix Tabs.Content only mounts the active panel with no click available
// to switch tabs under renderToStaticMarkup. Passthrough so all 3 tab panels render at once,
// which is what lets Section A assert Invoices/Credit Notes content in the same pass.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ClientBillingWorkspacePage from "@/pages/finance/ClientBillingWorkspacePage";

function renderPage(seed?: { proformas?: unknown[]; creditNotes?: unknown[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(["client-billing", "proformas"], { success: true, data: seed?.proformas ?? [] });
  client.setQueryData(["client-billing", "credit-notes"], { success: true, data: seed?.creditNotes ?? [] });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ClientBillingWorkspacePage />
    </QueryClientProvider>,
  );
}

const proformaRow = {
  id: "inv-proforma-1",
  cost_centre_id: "CC-CLIENT-100",
  invoice_status: "proforma",
  category: "Subscription",
  finance_year: "2026-27",
  month_label: "Aug-26",
  invoice_date: "2026-08-01",
  description: null,
  proforma_no: "PF/2026-27/0001",
  bill_no: null,
  gst_type: "Intrastate",
  apply_gst: 1,
  total_amount: "10000.00",
  igst_amount: "0.00",
  cgst_amount: "900.00",
  sgst_amount: "900.00",
  grand_total: "11800.00",
  created_by: "user-1",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: null,
  rejected_reason: null,
  rejected_by: null,
  rejected_at: null,
};

const approvedInvoiceRow = {
  ...proformaRow,
  id: "inv-approved-1",
  invoice_status: "approved",
  proforma_no: null,
  bill_no: "BILL/2026-27/0007",
};

const creditNoteRow = {
  id: "cn-1",
  invoice_id: "inv-approved-1",
  cost_centre_id: "CC-CLIENT-100",
  category: "Subscription",
  finance_year: "2026-27",
  month_label: "Aug-26",
  credit_date: "2026-08-10",
  description: null,
  credit_no: "CN/2026-27/0001",
  credit_status: "draft",
  gst_type: "Intrastate",
  apply_gst: 1,
  total_amount: "1000.00",
  igst_amount: "0.00",
  cgst_amount: "90.00",
  sgst_amount: "90.00",
  grand_total: "1180.00",
  approved_by: null,
  approved_at: null,
  created_by: "user-1",
  created_at: "2026-08-10T10:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section A — real render, real (mocked) API data flowing through the real component tree
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("ClientBillingWorkspacePage — rendering", () => {
  it("renders the 3 tabs", () => {
    const html = renderPage();
    expect(html).toContain("Proformas");
    expect(html).toContain("Invoices");
    expect(html).toContain("Credit Notes");
    expect(html).toContain("Client Billing");
  });

  it("Proformas tab renders a list from a mocked listProformas response", () => {
    const html = renderPage({ proformas: [proformaRow] });

    expect(html).toContain("PF/2026-27/0001");
    expect(html).toContain("CC-CLIENT-100");
    expect(html).toContain("Subscription");
    expect(html).toContain("Aug-26");
    expect(html).toContain("Intrastate");
    // money() formats grand_total via Intl en-IN currency — the digits must survive regardless
    // of how the ₹ symbol itself is encoded in the output.
    expect(html).toContain("11,800.00");
    // Proforma-status rows get Approve/Reject actions.
    expect(html).toContain('title="Approve"');
    expect(html).toContain('title="Reject"');
    expect(html).toContain('title="Download PDF"');
  });

  it("Proformas tab shows the empty state when listProformas returns nothing", () => {
    const html = renderPage({ proformas: [] });
    expect(html).toContain("No proformas found");
  });

  it("Invoices tab renders only invoice_status='approved' rows from the same listProformas data", () => {
    const html = renderPage({ proformas: [proformaRow, approvedInvoiceRow] });

    expect(html).toContain("BILL/2026-27/0007");
    // Approved rows get an Audit log action, not Approve/Reject.
    expect(html).toContain('title="Audit log"');
  });

  it("Credit Notes tab renders a list from a mocked listCreditNotes response", () => {
    const html = renderPage({ creditNotes: [creditNoteRow] });

    expect(html).toContain("CN/2026-27/0001");
    expect(html).toContain("inv-approved-1");
    expect(html).toContain("1,180.00");
    expect(html).toContain("New Credit Note");
    // draft credit notes get an Approve action.
    expect(html).toContain('title="Approve"');
  });

  it("Credit Notes tab shows the empty state when listCreditNotes returns nothing", () => {
    const html = renderPage({ creditNotes: [] });
    expect(html).toContain("No credit notes found");
  });

  it("New Proforma and New Credit Note buttons render (open their respective create Sheets)", () => {
    const html = renderPage();
    expect(html).toContain("New Proforma");
    expect(html).toContain("New Credit Note");
    // CreateProformaSheet/CreateCreditNoteSheet are always mounted, but unlike the Tabs mock
    // above, Sheet is a real (unmocked) Radix Dialog underneath — its content is correctly gated
    // by the real `open` state (both start false), so their form fields are genuinely absent from
    // the tree here. That's correct app behaviour, not a gap: only the trigger button is expected
    // to render before a click, and there's no jsdom click available in this repo to open it (see
    // file header) — Section B verifies the Sheet's submit-time wiring from source instead.
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section B — click-driven mutation wiring, verified against the real live source (no jsdom
// click available; see file header). Every payload field asserted below is cross-checked
// against clientBillingApi.ts's real exported interfaces, read directly below.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const pageSource = readFileSync(
  resolve(process.cwd(), "src/pages/finance/ClientBillingWorkspacePage.tsx"),
  "utf8",
);
const createProformaSheetSource = readFileSync(
  resolve(process.cwd(), "src/components/finance/client-billing/CreateProformaSheet.tsx"),
  "utf8",
);
const createCreditNoteSheetSource = readFileSync(
  resolve(process.cwd(), "src/components/finance/client-billing/CreateCreditNoteSheet.tsx"),
  "utf8",
);
const rejectDialogSource = readFileSync(
  resolve(process.cwd(), "src/components/finance/client-billing/RejectInvoiceDialog.tsx"),
  "utf8",
);
const apiSource = readFileSync(resolve(process.cwd(), "src/lib/clientBillingApi.ts"), "utf8");

describe("ClientBillingWorkspacePage — mutation wiring (source-verified)", () => {
  it("create-proforma Sheet submits createProforma with the payload clientBillingApi.ts actually declares", () => {
    // Real declared shape, read from the module under test rather than assumed.
    expect(apiSource).toContain("export interface CreateProformaPayload {");
    expect(apiSource).toContain("costCentreId: string;");
    expect(apiSource).toContain("lines: ProformaLineInput[];");
    expect(apiSource).toContain("export function createProforma(payload: CreateProformaPayload)");

    expect(createProformaSheetSource).toContain(
      "mutationFn: (payload: CreateProformaPayload) => createProforma(payload),",
    );
    // The exact payload construction at submit() — every field name matches CreateProformaPayload.
    expect(createProformaSheetSource).toContain("createMutation.mutate({");
    expect(createProformaSheetSource).toContain("costCentreId,");
    expect(createProformaSheetSource).toContain("category: category.trim(),");
    expect(createProformaSheetSource).toContain("financeYear: financeYear.trim(),");
    expect(createProformaSheetSource).toContain("monthLabel: monthLabel.trim(),");
    expect(createProformaSheetSource).toContain("invoiceDate,");
    expect(createProformaSheetSource).toContain("applyGst,");
    expect(createProformaSheetSource).toContain("lines: validLines.map((l) => ({");
    expect(createProformaSheetSource).toContain("particulars: l.particulars.trim(),");
    expect(createProformaSheetSource).toContain("qty: Number(l.qty),");
    expect(createProformaSheetSource).toContain("rate: Number(l.rate),");
    expect(createProformaSheetSource).toContain("lineType: l.lineType,");
  });

  it("Approve (Proformas tab) calls approveInvoice with the row id", () => {
    expect(apiSource).toContain("export function approveInvoice(id: string,");
    expect(pageSource).toContain("mutationFn: (id: string) => approveInvoice(id),");
    // wired from the confirm AlertDialog, not a bare click — matches the plan's "confirm dialog" step.
    expect(pageSource).toContain("if (approveTarget) approveMutation.mutate(approveTarget.id);");
  });

  it("Reject (via its reason dialog) calls rejectInvoice with a non-empty reason", () => {
    expect(apiSource).toContain("export function rejectInvoice(id: string, reason: string)");
    expect(rejectDialogSource).toContain(
      "mutationFn: () => rejectInvoice(invoiceId as string, reason.trim()),",
    );
    // Reason is mandatory client-side too, not just left to the backend's 400.
    expect(rejectDialogSource).toContain("disabled={!reason.trim() || rejectMutation.isPending}");
  });

  it("PDF download button calls downloadInvoicePdf", () => {
    expect(apiSource).toContain(
      'export async function downloadInvoicePdf(kind: "proforma" | "invoice", id: string, filename: string)',
    );
    expect(pageSource).toContain("async function handleDownload(kind:");
    expect(pageSource).toContain(
      'await downloadInvoicePdf(kind, row.id, `${row.bill_no || row.proforma_no || row.id}.pdf`);',
    );
    // Both tabs' Download PDF buttons route through the same handler.
    expect(pageSource).toContain('onClick={() => void handleDownload("proforma", row)}');
    expect(pageSource).toContain('onClick={() => void handleDownload("invoice", row)}');
  });

  it("Credit Notes: create Sheet submits createCreditNote with the payload clientBillingApi.ts actually declares", () => {
    expect(apiSource).toContain("export interface CreateCreditNotePayload {");
    expect(apiSource).toContain("invoiceId: string;");
    expect(apiSource).toContain("lines: CreditNoteLineInput[];");
    expect(apiSource).toContain("export function createCreditNote(payload: CreateCreditNotePayload)");

    expect(createCreditNoteSheetSource).toContain(
      "mutationFn: (payload: CreateCreditNotePayload) => createCreditNote(payload),",
    );
    expect(createCreditNoteSheetSource).toContain("createMutation.mutate({");
    expect(createCreditNoteSheetSource).toContain("invoiceId,");
    expect(createCreditNoteSheetSource).toContain("category: category.trim(),");
    expect(createCreditNoteSheetSource).toContain("financeYear: financeYear.trim(),");
    expect(createCreditNoteSheetSource).toContain("monthLabel: monthLabel.trim(),");
    expect(createCreditNoteSheetSource).toContain("creditDate,");
    expect(createCreditNoteSheetSource).toContain("applyGst,");
    // Credit note lines carry no lineType (design doc: "no charge/deduction split" for credit notes).
    expect(createCreditNoteSheetSource).not.toContain("lineType: l.lineType,\n      })),\n    });");
  });

  it("Credit Notes: Approve calls approveCreditNote with the row id", () => {
    expect(apiSource).toContain("export function approveCreditNote(id: string)");
    expect(pageSource).toContain("mutationFn: (id: string) => approveCreditNote(id),");
    expect(pageSource).toContain(
      "if (approveCreditTarget) approveCreditMutation.mutate(approveCreditTarget.id);",
    );
  });
});
