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
import { currentFinanceYear } from "@/components/finance/client-billing/billingFieldOptions";
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
  approveProforma: vi.fn(),
  exportInvoiceCsv: vi.fn(),
  getBillingFilterOptions: vi.fn(() => new Promise(() => {})),
  getProvisionForScope: vi.fn(() => new Promise(() => {})),
  listProvisions: vi.fn(() => new Promise(() => {})),
  createProvision: vi.fn(),
  updateProvision: vi.fn(),
  approveProvision: vi.fn(),
  rejectProvision: vi.fn(),
  uploadProvisions: vi.fn(),
  INVOICE_TYPES: ["Revenue", "Non Revenue"],
  RECEIPT_PAYMENT_MODES: ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "DD", "Cash", "Other"],
  listOutstandingBills: vi.fn(() => new Promise(() => {})),
  listReceipts: vi.fn(() => new Promise(() => {})),
  createReceipt: vi.fn(),
  voidReceipt: vi.fn(),
  listCompanyBankAccounts: vi.fn(() => new Promise(() => {})),
  decideProvisionEdit: vi.fn(),
  listPoReport: vi.fn(() => new Promise(() => {})),
  savePo: vi.fn(),
  approveInvoicePo: vi.fn(),
  addInvoiceGrn: vi.fn(),
  getBillingHeader: vi.fn(() => new Promise(() => {})),
  getSummary: vi.fn(() => new Promise(() => {})),
  exportClientBillingCsv: vi.fn(),
  previewInvoicePdfUrl: vi.fn(() => new Promise(() => {})),
  bulkApproveInvoices: vi.fn(),
  listSubmissions: vi.fn(() => new Promise(() => {})),
  listInvoiceChangeRequests: vi.fn(() => new Promise(() => {})),
  listChangeRequests: vi.fn(() => new Promise(() => {})),
  getChangeRequest: vi.fn(() => new Promise(() => {})),
  decideChangeRequest: vi.fn(),
  createChangeRequest: vi.fn(),
  submitToClient: vi.fn(),
  updateInvoiceNarration: vi.fn(),
  updateProforma: vi.fn(),
  listAvailablePos: vi.fn(() => new Promise(() => {})),
  checkPo: vi.fn(() => new Promise(() => {})),
  getPoDetail: vi.fn(() => new Promise(() => {})),
  downloadPoDocument: vi.fn(),
}));

// DashboardLayout pulls in react-router's useLocation/useNavigate + AuthContext, none of which
// this page's own behaviour depends on — passthrough it so the test doesn't need a Router/Auth
// provider stack unrelated to client-billing.
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => children,
}));

// useApprovalFocus reads the router's search params; this test renders without a Router.
vi.mock("@/hooks/useApprovalFocus", () => ({ useApprovalFocus: () => null }));

// See file header: real Radix Tabs.Content only mounts the active panel with no click available
// to switch tabs under renderToStaticMarkup. Passthrough so all 3 tab panels render at once,
// which is what lets Section A assert Invoices/Credit Notes content in the same pass.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  TabsContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import ClientBillingWorkspacePage from "@/pages/finance/ClientBillingWorkspacePage";

/**
 * Mirrors EMPTY_FILTERS in ClientBillingWorkspacePage.tsx — the initial state of each tab's
 * filter bar. The page's list queries are keyed BY that filter object
 * (`["client-billing", "proformas", proformaFilters]`), so a cache entry seeded under the bare
 * `["client-billing", "proformas"]` key never matches, every list query stays in its loading
 * state, and the assertions below then run against a spinner instead of a row. Keep this in
 * step with the page's own EMPTY_FILTERS.
 */
const EMPTY_FILTERS = (status: string) => ({
  status,
  fromDate: "",
  toDate: "",
  costCentreId: "",
  companyName: "",
  branchId: "",
  search: "",
  page: 1,
});

function renderPage(seed?: {
  proformas?: unknown[];
  invoices?: unknown[];
  creditNotes?: unknown[];
  awaitingInvoice?: unknown[];
  rejected?: unknown[];
  outstanding?: unknown[];
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // `total` accompanies `data` in the real list responses — the page reads it for pagination.
  const list = (data: unknown[]) => ({
    success: true,
    data,
    total: data.length,
  });
  client.setQueryData(
    // The Proformas tab opens on the legacy "View & Approve Proforma" queue.
    ["client-billing", "proformas", EMPTY_FILTERS("_awaiting")],
    list(seed?.proformas ?? []),
  );
  // Invoices is its own server-filtered query now (listProformas with the status overridden to
  // "approved"), not a client-side filter over the proformas response, so it needs its own seed.
  client.setQueryData(
    ["client-billing", "invoices", EMPTY_FILTERS("approved")],
    list(seed?.invoices ?? []),
  );
  client.setQueryData(
    ["client-billing", "credit-notes", EMPTY_FILTERS("_all")],
    list(seed?.creditNotes ?? []),
  );
  // The legacy list screens (LegacyBillingLists.tsx) key on their own search-bar filters.
  // Keep in step with legacyListParts.tsx's initialFilters().
  const legacy = { companyName: "", branchId: "", financeYear: currentFinanceYear(), number: "", fromDate: "", toDate: "", costCentreId: "", invoiceType: "" };
  client.setQueryData(["client-billing", "legacy-proformas", legacy, 1], list(seed?.proformas ?? []));
  client.setQueryData(["client-billing", "legacy-invoice-approval", { ...legacy, financeYear: "" }, 1], list(seed?.awaitingInvoice ?? []));
  client.setQueryData(["client-billing", "legacy-download", legacy, 1], list(seed?.invoices ?? []));
  client.setQueryData(["client-billing", "legacy-rejected", { ...legacy, financeYear: "" }, 1], list(seed?.rejected ?? []));
  // Download list's received / outstanding lookup (same key the Receipts tab uses).
  client.setQueryData(["client-billing", "outstanding", { companyName: "", branchId: "" }, ""], { success: true, data: seed?.outstanding ?? [] });
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
  it("renders the legacy I-Spark sequence: step bar and tabs in order", () => {
    const html = renderPage();
    const order = ["Provision", "Proforma", "Approve Proforma", "Invoice Approval", "Download"];
    let at = -1;
    for (const step of order) {
      const next = html.indexOf(step, at + 1);
      expect(next, `${step} after previous step`).toBeGreaterThan(at);
      at = next;
    }
    expect(html).toContain("1 · Provision");
    expect(html).toContain("2–3 · View &amp; Approve Proforma");
    expect(html).toContain("4 · Invoice Approval");
    expect(html).toContain("5 · Download Initial Invoice");
    expect(html).toContain("ADD PO");
    expect(html).toContain("6 · Receipts");
    expect(html).toContain("Credit Notes");
    expect(html).toContain("Client Billing");
  });

  it("View Proforma Invoice: legacy columns, filters and actions", () => {
    const html = renderPage({ proformas: [{ ...proformaRow, branch_name: "NOIDA-2", po_numbers: "PO-1", description: "Customer Service Charges for Aug-26" }] });
    for (const h of ["Sr. No.", "Branch Name", "Proforma No.", "Amount", "PO No.", "Description", "Action", "Download"]) expect(html).toContain(h);
    for (const f of ["Select Finance year", "Proforma No.", "search", "Initial Invoice/Proforma"]) expect(html).toContain(f);
    expect(html).toContain("PF/2026-27/0001");
    expect(html).toContain("NOIDA-2");
    // Amount is the taxable total (legacy shows 778901, not the grand total).
    expect(html).toContain("10,000");
    expect(html).not.toContain("11,800");
    for (const a of [">Edit<", ">Approve<", ">Reject<", ">PDF<", ">Letter Head<"]) expect(html).toContain(a);
  });

  it("lists show the legacy empty state", () => {
    expect(renderPage({ proformas: [] })).toContain("No records found");
  });

  it("Invoice Approval: filters, view / Edit / Reject per row, row checkboxes for bulk approve", () => {
    const html = renderPage({ awaitingInvoice: [{ ...proformaRow, proforma_approved_at: "2026-10-14", branch_name: "NOIDA-2", cost_centre_display_name: "Acme Ltd" }] });
    for (const f of ["Branch", "Bill date from", "Bill date to", "Cost centre", "Export CSV"]) expect(html).toContain(f);
    expect(html).toContain("view PF/2026-27/0001");
    expect(html).toContain("Edit PF/2026-27/0001");
    expect(html).toContain("Reject PF/2026-27/0001");
    expect(html).toContain("Select PF/2026-27/0001");
    expect(html).toContain("Select all on this page");
    expect(html).toContain("Details of PF/2026-27/0001");
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("Page total");
  });

  it("Proforma numbers open the detail drawer; lists carry export and a page total", () => {
    const html = renderPage({ proformas: [{ ...proformaRow, branch_name: "NOIDA-2" }] });
    expect(html).toContain("Details of PF/2026-27/0001");
    expect(html).toContain("Export CSV");
    expect(html).toContain("Page total");
  });

  it("Rejected / Void: reason, who / when, bill no. kept, clone action", () => {
    const html = renderPage({
      rejected: [{
        ...approvedInvoiceRow, invoice_status: "rejected", proforma_no: "PF/2026-27/0009", bill_no: "BILL/2026-27/0099",
        rejected_reason: "Wrong month billed", rejected_by: "user-77", rejected_at: "2026-10-01T10:00:00.000Z",
      }],
    });
    expect(html).toContain("Rejected / Void");
    expect(html).toContain("Wrong month billed");
    expect(html).toContain("user-77");
    expect(html).toContain("BILL/2026-27/0099");
    expect(html).toContain("(void)");
    expect(html).toContain("Clone as new proforma");
  });

  it("Download Initial Invoice: Invoice No., PDF / Letter Head / Export, Files", () => {
    const html = renderPage({ invoices: [approvedInvoiceRow] });
    expect(html).toContain("BILL/2026-27/0007");
    for (const h of ["Invoice No.", "Files", ">Export<", "Bill No."]) expect(html).toContain(h);
    expect(html).toContain("More actions for BILL/2026-27/0007");
  });

  it("Download Initial Invoice: client, bill date, grand total, received / outstanding, sent to client", () => {
    const html = renderPage({
      invoices: [
        { ...approvedInvoiceRow, cost_centre_display_name: "Acme Ltd", last_sent_at: null },
        { ...approvedInvoiceRow, id: "inv-approved-2", bill_no: "BILL/2026-27/0008", last_sent_at: "2026-10-02T09:30:00.000Z" },
      ],
      outstanding: [{ id: "inv-approved-1", bill_no: "BILL/2026-27/0007", settled: "5000.00", outstanding: "6800.00", days_past_due: 12 }],
    });
    for (const h of ["Client", "Bill date", "Grand total", "Received", "Outstanding", "Sent to client", "Invoice type"]) expect(html).toContain(h);
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("01/08/2026");
    expect(html).toContain("11,800");
    expect(html).toContain("5,000");
    expect(html).toContain("6,800");
    expect(html).toContain("12 days past due");
    expect(html).toContain("Not sent");
    expect(html).toContain("Not in the outstanding register");
    // Approved by / at is not on origin/main rows, so the column stays hidden.
    expect(html).not.toContain(">Approved<");
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

  it("Initial Invoice/Proforma and New Credit Note buttons render", () => {
    const html = renderPage();
    expect(html).toContain("Initial Invoice/Proforma");
    expect(html).toContain("New Credit Note");
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
const entrySheetSource = readFileSync(
  resolve(process.cwd(), "src/components/finance/client-billing/ProformaEntrySheet.tsx"),
  "utf8",
);
const approveViewSource = readFileSync(
  resolve(process.cwd(), "src/components/finance/client-billing/InvoiceApproveView.tsx"),
  "utf8",
);
const createCreditNoteSheetSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/finance/client-billing/CreateCreditNoteSheet.tsx",
  ),
  "utf8",
);
const rejectDialogSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/finance/client-billing/RejectInvoiceDialog.tsx",
  ),
  "utf8",
);
const creditNotesTabSource = readFileSync(
  resolve(process.cwd(), "src/components/finance/client-billing/CreditNotesTab.tsx"),
  "utf8",
);
const apiSource = readFileSync(
  resolve(process.cwd(), "src/lib/clientBillingApi.ts"),
  "utf8",
);

describe("ClientBillingWorkspacePage — mutation wiring (source-verified)", () => {
  it("create-proforma Sheet submits createProforma with the payload clientBillingApi.ts actually declares", () => {
    // Real declared shape, read from the module under test rather than assumed.
    expect(apiSource).toMatch(/export interface CreateProformaPayload\b[^{]*\{/);
    expect(apiSource).toContain("costCentreId: string;");
    expect(apiSource).toContain("lines: ProformaLineInput[];");
    expect(apiSource).toMatch(
      /export function createProforma\(\s*payload: CreateProformaPayload,?\s*\)/,
    );

    // Legacy two-stage entry: one mutation, update when editing, otherwise createProforma.
    expect(entrySheetSource).toContain("return createProforma(payload);");
    expect(entrySheetSource).toContain("const payload: CreateProformaPayload = {");
    // Category is no longer asked (server defaults it); Apply GST is the one tax switch.
    expect(entrySheetSource).not.toContain('aria-label="Category"');
    expect(entrySheetSource).not.toContain("Apply Tax Calculation <");
    for (const f of ["costCentreId, financeYear, monthLabel, invoiceDate,", "applyGst, applyTaxCalc: applyGst, invoiceType,",
      'lineType: "charge" as const', 'lineType: "deduction" as const']) expect(entrySheetSource).toContain(f);
    // Edit keeps the GRN already on the invoice (the edit route replaces the whole references block).
    expect(entrySheetSource).toContain("grnNo: editing?.grn_no ?? null");
  });

  it("Approve Proforma page: step 1 approveProforma, step 2 approveInvoice (bill number)", () => {
    expect(approveViewSource).toContain("if (mode === \"invoice\") return { billNo: (await approveInvoice(invoiceId!)).data.billNo };");
    expect(approveViewSource).toContain("await approveProforma(invoiceId!);");
    expect(pageSource).toContain('onApprove={(r) => setApproveView({ id: r.id, mode: "proforma" })}');
    expect(pageSource).toContain('onView={(r) => setApproveView({ id: r.id, mode: "invoice" })}');
    expect(pageSource).toContain("Generated Successfully. And moved to Branch");
  });

  it("Reject (via its reason dialog) calls rejectInvoice with a non-empty reason", () => {
    expect(apiSource).toMatch(
      /export function rejectInvoice\(\s*id: string,\s*reason: string,?\s*\)/,
    );
    expect(rejectDialogSource).toContain(
      "mutationFn: () => rejectInvoice(invoiceId as string, reason.trim()),",
    );
    // Reason is mandatory client-side too, not just left to the backend's 400.
    expect(rejectDialogSource).toContain(
      "disabled={!reason.trim() || rejectMutation.isPending}",
    );
  });

  it("PDF download button calls downloadInvoicePdf", () => {
    // Signature asserted piecewise: it is declared across multiple lines and has grown a
    // "credit-note" kind and a `letterhead` flag since this test was first written. Matching
    // the parts keeps the assertion honest about the real contract without re-breaking on the
    // next reformat.
    expect(apiSource).toContain("export async function downloadInvoicePdf(");
    expect(apiSource).toContain('kind: "proforma" | "invoice" | "credit-note"');
    expect(apiSource).toContain("letterhead = true");

    expect(pageSource).toContain("async function handleDownload(");
    expect(pageSource).toContain(
      "await downloadInvoicePdf(kind, id, `${docNumber || id}${suffix}.pdf`, letterhead);",
    );
    // PDF = with letterhead, Letter Head = plain, on both legacy lists; credit notes keep the button.
    expect(pageSource).toContain('onDownload={(r, lh) => void handleDownload("proforma", r.id, r.proforma_no ?? r.id, lh)}');
    expect(pageSource).toContain('onDownload={(r, lh) => void handleDownload("invoice", r.id, r.bill_no ?? r.id, lh)}');
    expect(creditNotesTabSource).toContain('<DownloadPdfButton kind="credit-note"');
  });

  it("Credit Notes: create Sheet submits createCreditNote with the payload clientBillingApi.ts actually declares", () => {
    expect(apiSource).toMatch(/export interface CreateCreditNotePayload\b[^{]*\{/);
    expect(apiSource).toContain("invoiceId: string;");
    expect(apiSource).toContain("lines: CreditNoteLineInput[];");
    expect(apiSource).toMatch(
      /export function createCreditNote\(\s*payload: CreateCreditNotePayload,?\s*\)/,
    );

    expect(createCreditNoteSheetSource).toContain(
      "mutationFn: (payload: CreateCreditNotePayload) => createCreditNote(payload),",
    );
    expect(createCreditNoteSheetSource).toContain("createMutation.mutate({");
    expect(createCreditNoteSheetSource).toContain("invoiceId,");
    expect(createCreditNoteSheetSource).toContain("category: category.trim(),");
    expect(createCreditNoteSheetSource).toContain(
      "financeYear: financeYear.trim(),",
    );
    expect(createCreditNoteSheetSource).toContain(
      "monthLabel: monthLabel.trim(),",
    );
    expect(createCreditNoteSheetSource).toContain("creditDate,");
    expect(createCreditNoteSheetSource).toContain("applyGst,");
    // Credit note lines carry no lineType (design doc: "no charge/deduction split" for credit notes).
    expect(createCreditNoteSheetSource).not.toContain(
      "lineType: l.lineType,\n      })),\n    });",
    );
  });

  it("Credit Notes: Approve calls approveCreditNote with the row id", () => {
    expect(apiSource).toMatch(
      /export function approveCreditNote\(\s*id: string,?\s*\)/,
    );
    expect(pageSource).toContain(
      "mutationFn: (id: string) => approveCreditNote(id),",
    );
    expect(pageSource).toContain(
      "if (approveCreditTarget) approveCreditMutation.mutate(approveCreditTarget.id);",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section C — 2026-10-14 UI completion: entry points, confirmations, inline errors (source-verified)
// ═══════════════════════════════════════════════════════════════════════════════════════════

const cb = (file: string) => readFileSync(resolve(process.cwd(), "src/components/finance/client-billing", file), "utf8");

describe("ClientBillingWorkspacePage — detail drawer, reject, confirmations, errors", () => {
  it("every list's number opens InvoiceDetailDialog, which exposes preview / approve / narration / clone", () => {
    expect(pageSource).toContain("const openDetail = (r: Pick<InvoiceRow, \"id\">) => setDetailInvoiceId(r.id);");
    expect(pageSource.match(/onOpen=\{openDetail\}/g)?.length).toBeGreaterThanOrEqual(4);
    expect(pageSource).toContain("<ReceiptsTab onOpenInvoice={(id) => setDetailInvoiceId(id)} />");
    const detail = cb("InvoiceDetailDialog.tsx");
    for (const s of ["Preview PDF", "Approve invoice", "Approve proforma", "Edit narration", "Clone as new proforma", "<ApprovalTimeline"]) expect(detail).toContain(s);
    expect(pageSource).toContain('onEditNarration: (inv) => setApproveView({ id: inv.id, mode: "view", initialEdit: true })');
    expect(pageSource).toContain("cloneFromInvoiceId={entry.cloneFromId ?? null}");
    expect(cb("ProformaEntrySheet.tsx")).toContain("return createProforma(payload);");
  });

  it("Reject is offered on Invoice Approval and inside the approve screen, via RejectInvoiceDialog", () => {
    expect(pageSource).toContain('onReject={(r) => setRejectInvoiceTarget({ id: r.id, label: r.proforma_no ?? r.id })}');
    expect(pageSource).toContain("onReject={(inv: InvoiceDetail) => setRejectInvoiceTarget({ id: inv.id, label: numberOf(inv) })}");
    expect(approveViewSource).toContain("onClick={() => onReject(inv)}");
  });

  it("bill-number approval, Approve PO, void approval and provision approval ask for confirmation", () => {
    expect(approveViewSource).toContain('onClick={() => (mode === "invoice" ? setConfirmOpen(true) : approve.mutate())}');
    expect(approveViewSource).toContain("This generates the bill number.");
    expect(pageSource).toContain('confirmLabel="Approve PO"');
    expect(cb("ChangeRequestsTab.tsx")).toContain('request.request_type === "void" ? setConfirmVoid(true) : decide.mutate("approve")');
    expect(cb("ProvisionsTab.tsx")).toContain('confirmLabel="Approve provision"');
  });

  it("approval with GST / Bill To warnings needs the 'I have checked' box and links to Cost Centres", () => {
    expect(approveViewSource).toContain("approveDisabled = approve.isPending || editing || (blocking.length > 0 && !checked)");
    expect(approveViewSource).toContain('export const COST_CENTRES_PATH = "/finance/cost-centres";');
    expect(approveViewSource).toContain("Fix in Cost Centres");
  });

  it("tax rows come from the record, not hard-coded 18 / 9 labels", () => {
    expect(approveViewSource).not.toContain("IGST @ 18.00%");
    expect(approveViewSource).not.toContain("CGST @ 9.00%");
    expect(approveViewSource).toContain("invoiceTaxRows(inv)");
  });

  it("dialog errors are shown inline (role=alert) and the toast layer sits above dialogs", () => {
    for (const f of ["RejectInvoiceDialog.tsx", "SubmitToClientDialog.tsx", "ChangeRequestDialog.tsx", "CreateCreditNoteSheet.tsx", "NarrationEditor.tsx"]) {
      expect(cb(f), f).toContain("<InlineError");
    }
    expect(approveViewSource).toContain('<InlineError title="Approval failed"');
    const toast = readFileSync(resolve(process.cwd(), "src/components/ui/toast.tsx"), "utf8");
    expect(toast).toContain("fixed top-0 z-[140]");
  });

  it("bulk approve posts the ticked ids to bulkApproveInvoices and lists each row's result", () => {
    const list = cb("InvoiceApprovalList.tsx");
    expect(list).toContain("mutationFn: (ids: string[]) => bulkApproveInvoices(ids),");
    expect(list).toContain("onConfirm={() => bulk.mutate([...selected])}");
    expect(list).toContain('failed — ${r.error ?? "unknown reason"}');
  });

  it("credit note picker searches the server and Download rows can raise a credit note", () => {
    const sheet = cb("CreateCreditNoteSheet.tsx");
    expect(sheet).toContain('listProformas({ status: "approved", search: debouncedSearch || undefined, limit: 50 })');
    expect(sheet).toContain("onSearchChange={setSearch}");
    expect(pageSource).toContain("onCreditNote={(r) => setCreditNoteSheet({ open: true, invoice: r })}");
    expect(pageSource).not.toContain("limit: 200");
  });

  it("InvoiceReferencesFields.tsx (unused) is gone", () => {
    expect(() => cb("InvoiceReferencesFields.tsx")).toThrow();
  });
});
