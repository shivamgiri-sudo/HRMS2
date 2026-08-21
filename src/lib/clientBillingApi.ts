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
export type CreditNoteStatus = "draft" | "approved";
export type LineType = "charge" | "deduction";
export type AuditAction = "created" | "edited" | "approved" | "rejected";

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

export interface CreateProformaPayload {
  costCentreId: string;
  category: string;
  financeYear: string;
  monthLabel: string;
  invoiceDate: string; // YYYY-MM-DD
  description?: string;
  applyGst?: boolean;
  lines: ProformaLineInput[];
}

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

// ── Wrapper functions ──────────────────────────────────────────────────────────────────

/** GET /api/client-billing/proformas — returns every client_invoice row regardless of
 *  status; callers filter client-side by `invoice_status` for the Proformas vs Invoices
 *  tab, since the backend route itself takes no status query param. */
export function listProformas(): Promise<{ success: boolean; data: InvoiceRow[] }> {
  return hrmsApi.get("/api/client-billing/proformas");
}

export function getProforma(id: string): Promise<{ success: boolean; data: InvoiceDetail }> {
  return hrmsApi.get(`/api/client-billing/proformas/${id}`);
}

export function createProforma(payload: CreateProformaPayload): Promise<{ success: boolean; data: ProformaCreateResult }> {
  return hrmsApi.post("/api/client-billing/proformas", payload);
}

export function approveInvoice(id: string, poNumbers?: string[]): Promise<{ success: boolean; data: ApproveInvoiceResult }> {
  return hrmsApi.post(`/api/client-billing/invoices/${id}/approve`, poNumbers ? { poNumbers } : {});
}

export function rejectInvoice(id: string, reason: string): Promise<{ success: boolean; data: RejectInvoiceResult }> {
  return hrmsApi.post(`/api/client-billing/invoices/${id}/reject`, { reason });
}

export function getAuditLog(id: string): Promise<{ success: boolean; data: AuditLogEntry[] }> {
  return hrmsApi.get(`/api/client-billing/invoices/${id}/audit-log`);
}

export function listCreditNotes(): Promise<{ success: boolean; data: CreditNoteRow[] }> {
  return hrmsApi.get("/api/client-billing/credit-notes");
}

export function getCreditNote(id: string): Promise<{ success: boolean; data: CreditNoteDetail }> {
  return hrmsApi.get(`/api/client-billing/credit-notes/${id}`);
}

export function createCreditNote(payload: CreateCreditNotePayload): Promise<{ success: boolean; data: CreditNoteResult }> {
  return hrmsApi.post("/api/client-billing/credit-notes", payload);
}

export function approveCreditNote(id: string): Promise<{ success: boolean; data: CreditNoteResult }> {
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
  letterhead = true
): Promise<void> {
  const path = kind === "proforma"
    ? `/api/client-billing/proformas/${id}/pdf`
    : kind === "invoice"
      ? `/api/client-billing/invoices/${id}/pdf`
      : `/api/client-billing/credit-notes/${id}/pdf`;
  const blob = await hrmsApi.getBlob(`${path}?letterhead=${letterhead ? "true" : "false"}`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
