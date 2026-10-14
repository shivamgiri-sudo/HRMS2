/**
 * Thin wrapper functions over `hrmsApi` for the client-billing replica's already-live
 * `/api/client-billing/*` backend (client-billing.routes.ts). No new HTTP client — every
 * function here calls `hrmsApi.get/post/getBlob` directly, matching this codebase's
 * established "thin API module + React Query in the page" convention (see portalApi.ts).
 *
 * Response shapes below are read from the real backend rows, NOT guessed:
 *   - ProformaRow / InvoiceRow  -> `SELECT * FROM client_invoice` (backend/sql/migrations/1300_client_billing_foundation.sql)
 *     plus `rejected_reason/by/at` (also on client_invoice) and `updated_at`.
 *   - InvoiceLineRow            -> `SELECT * FROM client_invoice_line` (same file)
 *   - CreditNoteRow             -> `SELECT * FROM client_credit_note` (backend/sql/migrations/1302_client_billing_credit_notes.sql)
 *   - CreditNoteLineRow         -> `SELECT * FROM client_credit_note_line` (same file)
 *   - AuditLogEntry             -> `SELECT * FROM client_invoice_audit_log` (backend/sql/migrations/1301_client_billing_approval_workflow.sql)
 *
 * All columns are snake_case, exactly as MySQL returns them — the routes do `SELECT *`
 * with no aliasing (client-billing.routes.ts GET /proformas, GET /proformas/:id, GET
 * /credit-notes, GET /credit-notes/:id, GET /invoices/:id/audit-log). Every money field
 * (`total_amount`, `igst_amount`, `cgst_amount`, `sgst_amount`, `grand_total`) is a plain
 * DECIMAL from the API — this module and its callers only format it, never compute it
 * (design doc §5).
 */
import { hrmsApi } from "@/lib/hrmsApi";

// ── Row shapes (verbatim backend field names) ──────────────────────────────────────────

export type InvoiceStatus = "proforma" | "approved" | "rejected";
export type GstType = "Integrated" | "Intrastate";
export type CreditNoteStatus = "draft" | "approved" | "rejected";
export type LineType = "charge" | "deduction";
export type AuditAction =
  | "created"
  | "edited"
  | "approved"
  | "rejected"
  | "void_requested"
  | "void_approved"
  | "void_declined"
  | "status_change_requested"
  | "status_change_approved"
  | "status_change_declined"
  | "submitted_to_client"
  | "proforma_approved"
  | "po_approved"
  | "grn_added";

/** One row of `client_invoice`. Covers both the Proformas tab (`invoice_status='proforma'`)
 *  and the Invoices tab (`invoice_status='approved'`) — same table, different filter. */
export interface InvoiceRow {
  id: string;
  cost_centre_id: string;
  /** Resolved via a join in GET /proformas (2026-08-21) — billing_client_name falling back
   *  to company_name, same rule the PDF uses. Undefined on responses from routes that don't
   *  join it (e.g. the single-invoice detail GET). */
  cost_centre_display_name?: string | null;
  cost_centre_code?: string | null;
  invoice_status: InvoiceStatus;
  category: string;
  finance_year: string;
  month_label: string;
  invoice_date: string;
  description: string | null;
  proforma_no: string | null;
  bill_no: string | null;
  gst_type: GstType;
  apply_gst: 0 | 1;
  total_amount: string | number;
  igst_amount: string | number;
  cgst_amount: string | number;
  sgst_amount: string | number;
  grand_total: string | number;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  rejected_reason: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  /** Internal accounting reference, frozen at creation time from
   *  cost_centre_master.tally_head/billing_client_name — never shown on the
   *  client-facing PDF, only in the finance-team detail view (migration 1308). */
  tally_head: string | null;
  client_tally_name: string | null;
  /** Set on rows loaded by the 2026-08-19 historical cutover; 0/absent-equivalent
   *  for anything created through the live workflow. */
  is_migrated?: 0 | 1;
  legacy_id?: number | null;
  /** P5 (migration 1975): PO numbers (CSV, max 4), GRN, JCC, RCM flag and last "Submit to
   *  Client" stamp. Undefined/null on rows created before the migration. */
  po_numbers?: string | null;
  grn_no?: string | null;
  grn_date?: string | null;
  jcc_no?: string | null;
  jcc_date?: string | null;
  rcm_applicable?: 0 | 1;
  last_sent_at?: string | null;
  last_sent_by?: string | null;
  /** Migration 2196: legacy two-step approval. Set by "Approve Proforma"; the row then waits
   *  in Invoice Approval (still invoice_status='proforma') until the bill number is minted. */
  proforma_approved_at?: string | null;
  proforma_approved_by?: string | null;
  /** Legacy invoiceType: Revenue / Non Revenue. */
  invoice_type?: string | null;
  /** Legacy app_tax_cal: 0 = no tax at all (migration 2197). */
  apply_tax_calc?: 0 | 1;
  /** Legacy approve_po (migration 2197). */
  po_approved?: 0 | 1;
  po_approved_at?: string | null;
  /** Step-2 approver (bill number minted). Not a column on origin/main today — rendered only
   *  when the API starts returning it; the audit log's "approved" entry is the fallback. */
  approved_by?: string | null;
  approved_at?: string | null;
  /** Optional resolved names for the *_by user ids, when the API joins them. */
  rejected_by_name?: string | null;
  proforma_approved_by_name?: string | null;
  approved_by_name?: string | null;
  last_sent_by_name?: string | null;
  /** Joined by GET /proformas. */
  company_name?: string | null;
  branch_name?: string | null;
}

/** `GET /proformas/:id` and `GET /invoices/:id` (same route) attach `lines` to the invoice row. */
export interface InvoiceDetail extends InvoiceRow {
  lines: InvoiceLineRow[];
}

/** One row of `client_invoice_line`. */
export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_type: LineType;
  particulars: string;
  qty: string | number;
  rate: string | number;
  amount: string | number;
  created_at: string;
}

/** One row of `client_credit_note`. */
export interface CreditNoteRow {
  id: string;
  invoice_id: string;
  cost_centre_id: string;
  /** Resolved via a join in GET /credit-notes (2026-08-21) — see InvoiceRow's equivalent. */
  cost_centre_display_name?: string | null;
  against_invoice_number?: string | null;
  category: string;
  finance_year: string;
  month_label: string;
  credit_date: string;
  description: string | null;
  credit_no: string | null;
  credit_status: CreditNoteStatus;
  gst_type: GstType;
  apply_gst: 0 | 1;
  total_amount: string | number;
  igst_amount: string | number;
  cgst_amount: string | number;
  sgst_amount: string | number;
  grand_total: string | number;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  /** See InvoiceRow's own doc comment — same frozen-snapshot/detail-view-only
   *  convention (migration 1308). Never backfilled for migrated credit notes
   *  (legacy tbl_credit_note never had this column at all). */
  tally_head: string | null;
  client_tally_name: string | null;
  is_migrated?: 0 | 1;
  legacy_id?: number | null;
}

export interface CreditNoteDetail extends CreditNoteRow {
  lines: CreditNoteLineRow[];
}

/** One row of `client_credit_note_line`. */
export interface CreditNoteLineRow {
  id: string;
  credit_note_id: string;
  particulars: string;
  qty: string | number;
  rate: string | number;
  amount: string | number;
}

/** One row of `client_invoice_audit_log`. */
export interface AuditLogEntry {
  id: string;
  invoice_id: string;
  action: AuditAction;
  actor_id: string;
  /** Resolved actor, when the API joins the user table (render `actor_name ?? actor_email ?? actor_id`). */
  actor_name?: string | null;
  actor_email?: string | null;
  reason: string | null;
  created_at: string;
}

// ── Request payload shapes (match client-billing.routes.ts's req.body destructuring) ──

export interface ProformaLineInput {
  particulars: string;
  qty: number;
  rate: number;
  lineType?: LineType;
}

/** PO / GRN / JCC / RCM block accepted by create and edit. */
export interface InvoiceReferencesPayload {
  poNumbers?: string[];
  grnNo?: string;
  grnDate?: string; // YYYY-MM-DD
  jccNo?: string;
  jccDate?: string; // YYYY-MM-DD
  rcmApplicable?: boolean;
}

export interface CreateProformaPayload extends InvoiceReferencesPayload {
  costCentreId: string;
  category?: string;
  financeYear: string;
  monthLabel: string;
  invoiceDate: string; // YYYY-MM-DD
  description?: string;
  applyGst?: boolean;
  /** Legacy "Apply Tax Calculation": false = no tax at all. */
  applyTaxCalc?: boolean;
  invoiceType?: InvoiceType;
  lines: ProformaLineInput[];
}

export const INVOICE_TYPES = ["Revenue", "Non Revenue"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export type UpdateProformaPayload = Partial<
  Omit<CreateProformaPayload, "costCentreId">
> & {
  /** PUT /proformas/:id reads PO/GRN/JCC/RCM only from this block (flat fields are ignored)
   *  and replaces all of them, so send the current values for anything not being changed. */
  references?: {
    poNumbers?: string[];
    grnNo?: string | null;
    grnDate?: string | null;
    jccNo?: string | null;
    jccDate?: string | null;
    rcmApplicable?: boolean;
  };
};

export interface CreditNoteLineInput {
  particulars: string;
  qty: number;
  rate: number;
}

export interface CreateCreditNotePayload {
  invoiceId: string;
  category: string;
  financeYear: string;
  monthLabel: string;
  creditDate: string;
  description?: string;
  applyGst?: boolean;
  lines: CreditNoteLineInput[];
}

/** Result shape returned by POST /proformas (clientBillingService.createProforma). */
export interface ProformaCreateResult {
  id: string;
  proformaNo: string;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  /** Taxable total drawn from the month's approved provision. */
  provisionUsed?: number;
}

/** Result shape returned by POST /invoices/:id/approve (clientBillingApprovalService.approveInvoice). */
export interface ApproveInvoiceResult {
  id: string;
  billNo: string;
  invoiceStatus: "approved";
}

/** Result shape returned by POST /invoices/:id/reject (clientBillingApprovalService.rejectInvoice). */
export interface RejectInvoiceResult {
  id: string;
  invoiceStatus: "rejected";
}

/** Result shape returned by POST /credit-notes and POST /credit-notes/:id/approve. */
export interface CreditNoteResult {
  id: string;
  creditNo: string | null;
  totalAmount: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  creditStatus: CreditNoteStatus;
}

/** Summary aggregates for the page header's stat cards — GET /api/client-billing/summary.
 *  Computed in SQL across the whole table, not summed from a fetched (paginated) page. */
export interface ClientBillingSummary {
  invoices: Record<InvoiceStatus, { count: number; total: number }>;
  creditNotes: Record<CreditNoteStatus, { count: number; total: number }>;
  thisMonthBilled: { count: number; total: number };
  pendingApprovalCount: number;
  awaitingProformaApprovalCount?: number;
  awaitingInvoiceApprovalCount?: number;
  pendingProvisionCount?: number;
}

/** Shared filter shape for both list endpoints and their CSV export siblings — the same
 *  params work on all four, so a filter that works on screen also works in the export. */
export interface ClientBillingListFilters {
  status?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
  costCentreId?: string;
  search?: string;
  companyName?: string;
  branchId?: string;
  financeYear?: string;
  /** Legacy invoiceType: "Revenue" / "Non Revenue" (buildInvoiceListQuery filters on it). */
  invoiceType?: string;
  /** Legacy approval queue: "proforma_approval" (View & Approve Proforma) or
   *  "invoice_approval" (Invoice Approval). Only meaningful on /proformas. */
  stage?: "proforma_approval" | "invoice_approval";
  page?: number;
  limit?: number;
}

function buildQueryString(filters: ClientBillingListFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.costCentreId) params.set("costCentreId", filters.costCentreId);
  if (filters.search) params.set("search", filters.search);
  if (filters.companyName) params.set("companyName", filters.companyName);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.financeYear) params.set("financeYear", filters.financeYear);
  if (filters.invoiceType) params.set("invoiceType", filters.invoiceType);
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Paginated list response shape — every list endpoint below returns this shape. */
export interface PaginatedResult<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Wrapper functions ──────────────────────────────────────────────────────────────────

export function getSummary(): Promise<{
  success: boolean;
  data: ClientBillingSummary;
}> {
  return hrmsApi.get("/api/client-billing/summary");
}

/** GET /api/client-billing/proformas — server-side filtered + paginated (2026-08-21).
 *  `filters.status` narrows to a single `invoice_status`; omit it (or pass "_all") for the
 *  Proformas/Invoices tabs' own client-side status split over one broader fetch. */
export function listProformas(
  filters: ClientBillingListFilters = {},
): Promise<PaginatedResult<InvoiceRow>> {
  return hrmsApi.get(
    `/api/client-billing/proformas${buildQueryString(filters)}`,
  );
}

export function getProforma(
  id: string,
): Promise<{ success: boolean; data: InvoiceDetail }> {
  return hrmsApi.get(`/api/client-billing/proformas/${id}`);
}

export function createProforma(
  payload: CreateProformaPayload,
): Promise<{ success: boolean; data: ProformaCreateResult }> {
  return hrmsApi.post("/api/client-billing/proformas", payload);
}

export function approveInvoice(
  id: string,
  poNumbers?: string[],
): Promise<{ success: boolean; data: ApproveInvoiceResult }> {
  return hrmsApi.post(
    `/api/client-billing/invoices/${id}/approve`,
    poNumbers ? { poNumbers } : {},
  );
}

/** Step 1 of 2 — legacy "View & Approve Proforma". No bill number yet. */
export function approveProforma(
  id: string,
): Promise<{ success: boolean; data: { id: string; proformaApprovedAt: string } }> {
  return hrmsApi.post(`/api/client-billing/proformas/${id}/approve`, {});
}

export function rejectInvoice(
  id: string,
  reason: string,
): Promise<{ success: boolean; data: RejectInvoiceResult }> {
  return hrmsApi.post(`/api/client-billing/invoices/${id}/reject`, { reason });
}

export function getAuditLog(
  id: string,
): Promise<{ success: boolean; data: AuditLogEntry[] }> {
  return hrmsApi.get(`/api/client-billing/invoices/${id}/audit-log`);
}

/** GET /api/client-billing/credit-notes — server-side filtered + paginated (2026-08-21). */
export function listCreditNotes(
  filters: ClientBillingListFilters = {},
): Promise<PaginatedResult<CreditNoteRow>> {
  return hrmsApi.get(
    `/api/client-billing/credit-notes${buildQueryString(filters)}`,
  );
}

export function getCreditNote(
  id: string,
): Promise<{ success: boolean; data: CreditNoteDetail }> {
  return hrmsApi.get(`/api/client-billing/credit-notes/${id}`);
}

export function createCreditNote(
  payload: CreateCreditNotePayload,
): Promise<{ success: boolean; data: CreditNoteResult }> {
  return hrmsApi.post("/api/client-billing/credit-notes", payload);
}

/** Reject (or withdraw) a draft credit note; it never gets a number. */
export function rejectCreditNote(id: string, reason: string): Promise<{ success: boolean; data: CreditNoteResult }> {
  return hrmsApi.post(`/api/client-billing/credit-notes/${id}/reject`, { reason });
}

export function approvePo(id: string, note?: string): Promise<{ success: boolean; data: { id: string; approvalStatus: string } }> {
  return hrmsApi.post(`/api/client-billing/po-master/${id}/approve`, { note: note || undefined });
}

export function rejectPo(id: string, reason: string): Promise<{ success: boolean; data: { id: string; approvalStatus: string } }> {
  return hrmsApi.post(`/api/client-billing/po-master/${id}/reject`, { reason });
}

export function approveCreditNote(
  id: string,
): Promise<{ success: boolean; data: CreditNoteResult }> {
  return hrmsApi.post(`/api/client-billing/credit-notes/${id}/approve`, {});
}

/**
 * Downloads a proforma/invoice/credit-note PDF and triggers a browser save, performing the
 * side effect directly rather than returning a Blob for the caller to handle — matching this
 * codebase's existing convention for authenticated file downloads (see
 * `VendorPaymentDispatchPage.tsx`'s `downloadAuthenticated`). Both `/proformas/:id/pdf` and
 * `/invoices/:id/pdf` resolve to the same underlying route
 * (`clientBillingPdfService.generateInvoicePdf`) — `kind` only selects which URL segment is
 * used, since a proforma and its approved invoice are the same `client_invoice` row across
 * its lifecycle.
 *
 * `letterhead` (default true) selects between the two formats the backend renders: with MAS
 * Callnet's logo/CIN/branch-address header and corporate-address/certification-badge footer
 * (for emailing to a client), or without both blocks (for printing onto pre-printed
 * letterhead stationery) — same invoice content either way.
 */
export async function downloadInvoicePdf(
  kind: "proforma" | "invoice" | "credit-note",
  id: string,
  filename: string,
  letterhead = true,
): Promise<void> {
  const path =
    kind === "proforma"
      ? `/api/client-billing/proformas/${id}/pdf`
      : kind === "invoice"
        ? `/api/client-billing/invoices/${id}/pdf`
        : `/api/client-billing/credit-notes/${id}/pdf`;
  const blob = await hrmsApi.getBlob(
    `${path}?letterhead=${letterhead ? "1" : "0"}`,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fetches a proforma/invoice/credit-note PDF as a blob URL for INLINE preview (an
 * `<iframe>`/`<embed>` in a dialog) rather than triggering a download — same underlying
 * route and `letterhead` toggle as `downloadInvoicePdf`, just returning the object URL
 * instead of clicking a synthetic anchor. Caller is responsible for calling
 * `URL.revokeObjectURL` when the preview closes (see `ClientBillingWorkspacePage.tsx`'s
 * preview dialog `onOpenChange`).
 */
export async function previewInvoicePdfUrl(
  kind: "proforma" | "invoice" | "credit-note",
  id: string,
  letterhead = true,
): Promise<string> {
  const path =
    kind === "proforma"
      ? `/api/client-billing/proformas/${id}/pdf`
      : kind === "invoice"
        ? `/api/client-billing/invoices/${id}/pdf`
        : `/api/client-billing/credit-notes/${id}/pdf`;
  const blob = await hrmsApi.getBlob(
    `${path}?letterhead=${letterhead ? "1" : "0"}`,
  );
  return URL.createObjectURL(blob);
}

/**
 * Downloads a filtered CSV export of proformas/invoices or credit notes — same filter
 * shape as the list endpoints (`buildQueryString`), so what's exported always matches
 * what's on screen. GET /api/client-billing/{proformas,credit-notes}/export.
 */
export async function exportClientBillingCsv(
  kind: "proformas" | "credit-notes",
  filters: ClientBillingListFilters,
  filename: string,
): Promise<void> {
  const blob = await hrmsApi.getBlob(
    `/api/client-billing/${kind}/export${buildQueryString(filters)}`,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ── P5: edit, PO check, change requests, bulk approve, submit-to-client ─────────────────

export function updateProforma(
  id: string,
  payload: UpdateProformaPayload,
): Promise<{
  success: boolean;
  data: { id: string; grandTotal: number; gstType: string; changed: string[] };
}> {
  return hrmsApi.put(`/api/client-billing/proformas/${id}`, payload);
}

export interface AvailablePo {
  id: string;
  po_number: string;
  period_from: string;
  period_to: string;
  total_amount: string | number;
  balance_amount: string | number;
}

/** POs of a cost centre whose period covers `invoiceDate` and that still have a balance. */
export function listAvailablePos(
  costCentreId: string,
  invoiceDate: string,
): Promise<{ success: boolean; data: AvailablePo[] }> {
  const qs = new URLSearchParams({ costCentreId, invoiceDate });
  return hrmsApi.get(`/api/client-billing/po/available?${qs.toString()}`);
}

export interface PoCheckResult {
  ok: boolean;
  errors: string[];
  totalBalance: number;
  poNumbers: string[];
}

export function checkPo(args: {
  costCentreId: string;
  invoiceDate: string;
  grandTotal: number;
  poNumbers: string[];
}): Promise<{ success: boolean; data: PoCheckResult }> {
  const qs = new URLSearchParams({
    costCentreId: args.costCentreId,
    invoiceDate: args.invoiceDate,
    grandTotal: String(args.grandTotal),
    poNumbers: args.poNumbers.join(","),
  });
  return hrmsApi.get(`/api/client-billing/po/check?${qs.toString()}`);
}

export type ChangeRequestType = "void" | "status_change";
export type ChangeRequestStatus = "pending" | "approved" | "declined";

export interface ChangeRequestRow {
  id: string;
  invoice_id: string;
  request_type: ChangeRequestType;
  current_value: string | null;
  requested_value: string | null;
  reason: string;
  request_status: ChangeRequestStatus;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  requested_by_name?: string | null;
  decided_by_name?: string | null;
  proforma_no?: string | null;
  bill_no?: string | null;
  invoice_status?: InvoiceStatus;
  grand_total?: string | number;
  month_label?: string;
  cost_centre_display_name?: string | null;
}

export interface ChangeRequestDetail extends ChangeRequestRow {
  category?: string;
  finance_year?: string;
  invoice_date?: string;
  audit_log: AuditLogEntry[];
}

export function createChangeRequest(
  invoiceId: string,
  payload: {
    requestType: ChangeRequestType;
    reason: string;
    requestedValue?: string;
  },
): Promise<{ success: boolean; data: { id: string } }> {
  return hrmsApi.post(
    `/api/client-billing/invoices/${invoiceId}/change-requests`,
    payload,
  );
}

export function listInvoiceChangeRequests(
  invoiceId: string,
): Promise<{ success: boolean; data: ChangeRequestRow[] }> {
  return hrmsApi.get(
    `/api/client-billing/invoices/${invoiceId}/change-requests`,
  );
}

/** `requestType` / `search` are sent for forward compatibility; on origin/main the route only
 *  filters by status and pages, so callers also narrow the returned page themselves. */
export function listChangeRequests(
  filters: { status?: string; requestType?: string; search?: string; page?: number; limit?: number } = {},
): Promise<PaginatedResult<ChangeRequestRow>> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.requestType) params.set("requestType", filters.requestType);
  if (filters.search) params.set("search", filters.search);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return hrmsApi.get(
    `/api/client-billing/change-requests${qs ? `?${qs}` : ""}`,
  );
}

export function getChangeRequest(
  id: string,
): Promise<{ success: boolean; data: ChangeRequestDetail }> {
  return hrmsApi.get(`/api/client-billing/change-requests/${id}`);
}

export function decideChangeRequest(
  id: string,
  decision: "approve" | "decline",
  note?: string,
): Promise<{
  success: boolean;
  data: { id: string; requestStatus: ChangeRequestStatus };
}> {
  return hrmsApi.post(`/api/client-billing/change-requests/${id}/${decision}`, {
    note,
  });
}

export interface BulkApproveResponse {
  approved: number;
  failed: number;
  results: Array<{
    invoiceId: string;
    ok: boolean;
    billNo?: string;
    error?: string;
  }>;
}

export function bulkApproveInvoices(
  invoiceIds: string[],
): Promise<{ success: boolean; data: BulkApproveResponse }> {
  return hrmsApi.post("/api/client-billing/invoices/bulk-approve", {
    invoiceIds,
  });
}

export interface SubmissionRow {
  id: string;
  invoice_id: string;
  to_emails: string;
  cc_emails: string | null;
  subject: string;
  with_letterhead: 0 | 1;
  send_status: "sent" | "failed";
  message_id: string | null;
  error_message: string | null;
  sent_by: string;
  sent_at: string;
}

export function listSubmissions(
  invoiceId: string,
): Promise<{ success: boolean; data: SubmissionRow[] }> {
  return hrmsApi.get(`/api/client-billing/invoices/${invoiceId}/submissions`);
}

export function submitToClient(
  invoiceId: string,
  payload: {
    to: string[];
    cc?: string[];
    subject?: string;
    message?: string;
    letterhead?: boolean;
  },
): Promise<{
  success: boolean;
  data: {
    submissionId: string;
    billNo: string;
    to: string[];
    cc: string[];
    sentAt: string;
  };
}> {
  return hrmsApi.post(
    `/api/client-billing/invoices/${invoiceId}/submit-to-client`,
    payload,
  );
}

// ── Legacy I-Spark sequence: filter options, provisions, per-invoice export ────────────

export interface BillingCostCentreOption {
  id: string;
  cost_centre_code: string;
  cost_centre_name: string | null;
  company_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  client_name: string | null;
  state_code: string | null;
  gst_type: string | null;
  vendor_gst_no: string | null;
}

export interface BillingFilterOptions {
  companies: string[];
  branches: Array<{ id: string; name: string }>;
  costCentres: BillingCostCentreOption[];
}

/** Company / Branch / active cost centres for the legacy-style filters. */
export function getBillingFilterOptions(): Promise<{ success: boolean; data: BillingFilterOptions }> {
  return hrmsApi.get("/api/client-billing/filter-options");
}

export type ProvisionStatus = "pending" | "approved" | "rejected";

export interface ProvisionRow {
  id: string;
  cost_centre_id: string;
  cost_centre_code: string | null;
  company_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  client_name: string | null;
  finance_year: string;
  month_label: string;
  provision_amount: string | number;
  provision_balance: string | number;
  used_amount: string | number;
  provision_status: ProvisionStatus;
  remarks: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  invoice_type?: string | null;
  /** A pending edit of an approved provision (applied after a second person approves). */
  edit_amount?: string | number | null;
  edit_remarks?: string | null;
  edit_requested_by?: string | null;
  edit_requested_at?: string | null;
}

export interface ProvisionListFilters {
  financeYear?: string;
  monthLabel?: string;
  costCentreId?: string;
  branchId?: string;
  companyName?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function listProvisions(filters: ProvisionListFilters = {}): Promise<PaginatedResult<ProvisionRow>> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return hrmsApi.get(`/api/client-billing/provisions${qs ? `?${qs}` : ""}`);
}

export interface ProvisionScope {
  id: string;
  provision_status: ProvisionStatus;
  provision_amount: string | number;
  provision_balance: string | number;
  remarks: string | null;
}

/** The provision a proforma for this cost centre + month will draw from (null if none). */
export function getProvisionForScope(
  costCentreId: string,
  financeYear: string,
  monthLabel: string,
): Promise<{ success: boolean; data: ProvisionScope | null; required: boolean }> {
  const qs = new URLSearchParams({ costCentreId, financeYear, monthLabel });
  return hrmsApi.get(`/api/client-billing/provisions/scope?${qs.toString()}`);
}

export function createProvision(payload: {
  costCentreId: string;
  financeYear: string;
  monthLabel: string;
  amount: number;
  remarks?: string;
  invoiceType?: InvoiceType;
}): Promise<{ success: boolean; data: { id: string } }> {
  return hrmsApi.post("/api/client-billing/provisions", payload);
}

export function decideProvisionEdit(id: string, decision: "approve" | "decline"): Promise<{ success: boolean }> {
  return hrmsApi.post(`/api/client-billing/provisions/${id}/edit/${decision}`, {});
}

export function updateProvision(
  id: string,
  payload: { amount?: number; remarks?: string | null },
): Promise<{ success: boolean; data: { id: string; editPending: boolean; provisionAmount: number; provisionBalance: number } }> {
  return hrmsApi.put(`/api/client-billing/provisions/${id}`, payload);
}

export function approveProvision(id: string): Promise<{ success: boolean; data: { id: string } }> {
  return hrmsApi.post(`/api/client-billing/provisions/${id}/approve`, {});
}

export function rejectProvision(id: string, reason: string): Promise<{ success: boolean; data: { id: string } }> {
  return hrmsApi.post(`/api/client-billing/provisions/${id}/reject`, { reason });
}

export interface UploadProvisionRow {
  costCentreCode: string;
  financeYear: string;
  monthLabel: string;
  amount: number;
  remarks?: string;
}

export function uploadProvisions(rows: UploadProvisionRow[]): Promise<{
  success: boolean;
  data: { created: number; failed: number; results: Array<{ row: number; costCentreCode: string; ok: boolean; error?: string }> };
}> {
  return hrmsApi.post("/api/client-billing/provisions/upload", { rows });
}

/** Download Initial Invoice → Export: one invoice's header + lines + totals as CSV. */
export async function exportInvoiceCsv(id: string, filename: string): Promise<void> {
  const blob = await hrmsApi.getBlob(`/api/client-billing/invoices/${id}/export`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ── Legacy ADD PO / Approve PO / ADD GRN, and the proforma entry page header ───────────

export type PoStatus = "active" | "expired" | "upcoming" | "exhausted";

/** One row of the governed PO report (backend client-billing-po-master.service.ts). */
export interface PoReportRow {
  id: string;
  poNumber: string;
  costCentreId: string;
  costCentre: string;
  branch: string;
  client: string;
  periodFrom: string;
  periodTo: string;
  amount: number;
  drawn: number;
  balance: number;
  utilisation: number;
  status: PoStatus;
  bills: number;
  lines: number;
  hasDocument: boolean;
  remarks: string | null;
  /** New POs and amount increases wait for a second person (pending) before invoices can use them. */
  approvalStatus?: "pending" | "approved" | "rejected";
  approvalRequestedBy?: string | null;
}

export interface PoLine { particulars: string; qty: number; rate: number }

export interface PoDetail {
  po: {
    id: string; poNumber: string; costCentreId: string; costCentre: string; branchId: string | null; branch: string; client: string;
    periodFrom: string; periodTo: string; amount: number; balance: number; drawn: number; remarks: string | null;
    document: { name: string; mime: string } | null;
    approvalStatus?: "pending" | "approved" | "rejected";
    approvedAmount?: number | null;
    approvalRequestedBy?: string | null;
    approvalNote?: string | null;
  };
  lines: Array<PoLine & { lineNo: number; amount: number }>;
  invoices: Array<{ id: string; number: string; date: string; month: string; grandTotal: number; status: string; drawn: number; stage: "billed" | "waiting" }>;
  history: Array<{ action: string; changes: string; at: string; actor: string }>;
}

const PO_BASE = "/api/client-billing/po-master";

export function listPoReport(filters: { costCentreId?: string; branchId?: string; companyName?: string; search?: string; status?: PoStatus } = {}): Promise<{ success: boolean; data: PoReportRow[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const qs = params.toString();
  return hrmsApi.get(`${PO_BASE}${qs ? `?${qs}` : ""}`);
}

export function getPoDetail(id: string): Promise<{ success: boolean; data: PoDetail }> {
  return hrmsApi.get(`${PO_BASE}/${id}`);
}

export interface SavePoPayload {
  costCentreId?: string;
  poNumber: string;
  periodFrom: string;
  periodTo: string;
  lines: PoLine[];
  remarks?: string | null;
}

/** Create (no id) or edit a PO; the document travels as multipart "file", the rest as JSON "data". */
export function savePo(payload: SavePoPayload, file: File | null, id?: string): Promise<{ success: boolean; data: { id: string } }> {
  const form = new FormData();
  form.append("data", JSON.stringify(payload));
  if (file) form.append("file", file);
  return hrmsApi.postForm(id ? `${PO_BASE}/${id}` : PO_BASE, form);
}

export async function downloadPoDocument(id: string, name: string): Promise<void> {
  const blob = await hrmsApi.getBlob(`${PO_BASE}/${id}/document`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Correct narration / particulars at any stage; the server refuses a different total. */
export function updateInvoiceNarration(
  id: string,
  payload: { description?: string | null; lines?: Array<PoLine & { lineType: "charge" | "deduction" }> },
): Promise<{ success: boolean; data: { id: string; changed: string[] } }> {
  return hrmsApi.put(`/api/client-billing/invoices/${id}/narration`, payload);
}

export function approveInvoicePo(id: string): Promise<{ success: boolean }> {
  return hrmsApi.post(`/api/client-billing/invoices/${id}/approve-po`, {});
}

export function addInvoiceGrn(id: string, grnNo: string, grnDate: string | null): Promise<{ success: boolean }> {
  return hrmsApi.put(`/api/client-billing/invoices/${id}/grn`, { grnNo, grnDate });
}

export interface BillingHeader {
  id: string;
  cost_centre_code: string;
  company_name: string | null;
  branch_name: string | null;
  state_code: string | null;
  client_name: string | null;
  service_tax_no: string | null;
  vendor_gst_no: string | null;
  vendor_gst_state: string | null;
  vendor_state_code: string | null;
  gst_type: string | null;
  bill_to_address1: string | null;
  bill_to_address2: string | null;
  bill_to_address3: string | null;
  bill_to_address4: string | null;
  bill_to_address5: string | null;
  ship_to_address1: string | null;
  ship_to_address2: string | null;
  ship_to_address3: string | null;
  ship_to_address4: string | null;
  ship_to_address5: string | null;
  /** Resolved by the server (client-billing-party.ts) — the same values the PDF prints. */
  party?: BillingParty;
}

export interface BillingParty {
  clientName: string;
  billTo: string[];
  shipTo: string[];
  clientGstin: string;
  clientStateCode: string;
  clientStateName: string;
  placeOfSupply: string;
  ourGstin: string;
  pan: string;
  hsnCode: string;
  sacCode: string;
  warnings: string[];
}

export function getBillingHeader(costCentreId: string): Promise<{ success: boolean; data: BillingHeader }> {
  return hrmsApi.get(`/api/client-billing/cost-centres/${costCentreId}/billing-header`);
}

// ── Receipts (money received against bills) ─────────────────────────────────────────────

export interface OutstandingBill {
  id: string;
  bill_no: string;
  invoice_date: string;
  due_date: string;
  month_label: string;
  finance_year: string;
  total_amount: string | number;
  grand_total: string | number;
  description: string | null;
  cost_centre_code: string;
  company_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  client_name: string;
  received: string | number;
  tds: string | number;
  deduction: string | number;
  settled: string | number;
  credited: string | number;
  outstanding: string | number;
  days_past_due: number;
}

export function listOutstandingBills(filters: { clientName?: string; branchId?: string; companyName?: string; search?: string } = {}): Promise<{ success: boolean; data: OutstandingBill[] }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const qs = params.toString();
  return hrmsApi.get(`/api/client-billing/receipts/outstanding${qs ? `?${qs}` : ""}`);
}

export type ReceiptState = "awaiting_bank" | "in_bank" | "voucher_rejected" | "void";
export const RECEIPT_PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "DD", "Cash", "Other"] as const;

export interface ReceiptRow {
  id: string;
  receipt_no: string;
  receipt_date: string;
  client_name: string;
  company_name: string | null;
  branch_name: string | null;
  amount_received: string | number;
  tds_amount: string | number;
  other_deduction: string | number;
  payment_mode: string;
  reference_no: string | null;
  bank_account_name: string | null;
  voucher_number: string | null;
  voucher_status: string | null;
  state: ReceiptState;
  bill_nos: string | null;
  void_reason: string | null;
  is_migrated: 0 | 1;
}

export function listReceipts(filters: { fromDate?: string; toDate?: string; branchId?: string; companyName?: string; search?: string; status?: string; page?: number; limit?: number } = {}): Promise<PaginatedResult<ReceiptRow>> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return hrmsApi.get(`/api/client-billing/receipts${qs ? `?${qs}` : ""}`);
}

export interface CreateReceiptPayload {
  receiptDate: string;
  bankAccountId: string;
  paymentMode: string;
  referenceNo?: string;
  remarks?: string;
  amountReceived: number;
  allocations: Array<{ invoiceId: string; received: number; tds: number; deduction: number }>;
}

export function createReceipt(payload: CreateReceiptPayload): Promise<{ success: boolean; data: ReceiptRow }> {
  return hrmsApi.post("/api/client-billing/receipts", payload);
}

export function voidReceipt(id: string, reason: string): Promise<{ success: boolean; data: ReceiptRow }> {
  return hrmsApi.post(`/api/client-billing/receipts/${id}/void`, { reason });
}

export interface CompanyBankAccount { id: string; account_name: string; account_number_last4?: string | null; active_status?: number; bank_name?: string | null }

export function listCompanyBankAccounts(): Promise<{ success: boolean; data: CompanyBankAccount[] }> {
  return hrmsApi.get("/api/finance/bank-accounts");
}
