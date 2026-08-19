/**
 * Pure validation logic for the client-billing historical cutover dry-run
 * (docs/superpowers/plans/2026-08-19-client-billing-cutover.md Task 3,
 *  docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §6.2-6.3).
 *
 * Every function here is a pure transform: no DB connection, no I/O. validate.ts
 * imports these to re-validate each client_invoice_migration_staging /
 * client_credit_note_migration_staging row against client_invoice's and
 * client_credit_note's REAL live column requirements (read fresh off
 * information_schema by validate.ts, never hand-transcribed here) before
 * deciding validation_status/validation_error. This file's own test
 * (__tests__/validate.transforms.test.ts) exercises it against fixture data
 * without ever touching a real database connection.
 *
 * ── Why these specific required-field checks exist (found only by actually
 *    inspecting the LIVE schema, not assumed from the design doc) ───────────
 * - client_invoice.gst_type / client_credit_note.gst_type are VARCHAR(20)
 *   NOT NULL with no DEFAULT. Design §5.2 calls for migrating GSTType-blank
 *   rows with `gst_type = NULL` — that is NOT insertable against the live
 *   schema as it stands today. This is flagged as a real validation error,
 *   not silently worked around, because "insert an empty string instead of
 *   NULL" would misrepresent §5.2's own stated intent (honestly show "no GST
 *   recorded"), so it needs a human schema/design decision, not a script
 *   guessing on their behalf.
 * - client_invoice.category / client_credit_note.category are VARCHAR(50)
 *   NOT NULL — normalizeCategory() (extract.transforms.ts) intentionally
 *   returns NULL for blank/NULL legacy category (514-ish rows), which is
 *   not insertable either.
 * - client_invoice.cost_centre_id / client_credit_note.cost_centre_id are
 *   CHAR(36) NOT NULL FK to cost_centre_master.id. Neither 1304 nor 1305 nor
 *   extract.ts computed any mapping for this at all — it is resolved here,
 *   for the first time in this plan, by joining the legacy free-text
 *   src_cost_center against cost_centre_master.cost_centre_code (validate.ts
 *   builds that map fresh from the live table). A legacy cost_center with no
 *   match is a real validation error.
 * - client_credit_note.invoice_id is CHAR(36) NOT NULL FK to
 *   client_invoice.id. tbl_credit_note carries no column that reliably
 *   identifies which tbl_invoice row it was issued against — proforma_bill_no
 *   exists but bill_no/proforma_bill_no collide badly in the legacy data
 *   (§2), so a fuzzy string match would silently attach a credit note to the
 *   wrong invoice some real fraction of the time, which is worse than
 *   refusing to load it. Every credit-note row therefore fails this check
 *   until a load-time linking strategy is separately designed — this is a
 *   100%-of-rows structural finding, not a per-row data-quality issue, and
 *   is reported as such.
 */

export interface CostCentreLookup {
  has(code: string): boolean;
  get(code: string): string | undefined;
}

export function buildCostCentreLookup(rows: Array<{ cost_centre_code: string; id: string }>): CostCentreLookup {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.cost_centre_code) map.set(r.cost_centre_code, r.id);
  }
  return map;
}

function isBlank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === "";
}

function parseDecimalOk(raw: string | null): boolean {
  if (raw === null) return true; // absent, not a parse failure
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  const n = Number(trimmed);
  return Number.isFinite(n);
}

export interface InvoiceValidationInput {
  src_id: number;
  src_category: string | null; // already normalized by extract.ts
  src_finance_year: string | null;
  src_month: string | null;
  src_invoicedate: string | null;
  src_cost_center: string | null;
  target_gst_type: string | null;
  src_total: string | null;
  src_tax: string | null;
  src_igst: string | null;
  src_sgst: string | null;
  src_cgst: string | null;
  src_grnd: string | null;
}

export interface ValidationResult {
  status: "valid" | "error";
  error: string | null;
}

const MAX_ERROR_LEN = 500;

function joinErrors(errors: string[]): ValidationResult {
  if (errors.length === 0) return { status: "valid", error: null };
  let msg = errors.join("; ");
  if (msg.length > MAX_ERROR_LEN) msg = msg.slice(0, MAX_ERROR_LEN - 3) + "...";
  return { status: "error", error: msg };
}

export function validateInvoiceRow(row: InvoiceValidationInput, costCentre: CostCentreLookup): ValidationResult {
  const errors: string[] = [];

  if (isBlank(row.src_category)) {
    errors.push("category is NULL/blank (client_invoice.category is NOT NULL)");
  }
  if (isBlank(row.src_finance_year)) {
    errors.push("finance_year is NULL/blank (client_invoice.finance_year is NOT NULL)");
  }
  if (isBlank(row.src_month)) {
    errors.push("month_label is NULL/blank (client_invoice.month_label is NOT NULL)");
  }
  if (isBlank(row.src_invoicedate)) {
    errors.push("invoice_date is NULL/blank/unrecoverable (client_invoice.invoice_date is NOT NULL) — design §5.1");
  }
  if (row.target_gst_type === null) {
    errors.push("gst_type is NULL (client_invoice.gst_type is NOT NULL, no DEFAULT — design §5.2 vs live schema conflict)");
  }
  if (isBlank(row.src_cost_center) || !costCentre.has((row.src_cost_center ?? "").trim())) {
    errors.push(
      `cost_centre_id cannot be resolved — legacy cost_center "${row.src_cost_center ?? ""}" has no match in cost_centre_master.cost_centre_code`,
    );
  }
  const amountFields: Array<[string, string | null]> = [
    ["total", row.src_total],
    ["tax", row.src_tax],
    ["igst", row.src_igst],
    ["sgst", row.src_sgst],
    ["cgst", row.src_cgst],
    ["grnd", row.src_grnd],
  ];
  for (const [name, raw] of amountFields) {
    if (!parseDecimalOk(raw)) {
      errors.push(`${name} does not parse as a decimal (raw=${JSON.stringify(raw)})`);
    }
  }

  return joinErrors(errors);
}

export interface CreditNoteValidationInput {
  src_id: number;
  src_category: string | null;
  src_finance_year: string | null;
  src_month: string | null;
  src_creditdate: string | null;
  src_cost_center: string | null;
  target_gst_type: string | null;
  src_total: string | null;
  src_tax: string | null;
  src_igst: string | null;
  src_sgst: string | null;
  src_cgst: string | null;
  src_grnd: string | null;
}

export function validateCreditNoteRow(row: CreditNoteValidationInput, costCentre: CostCentreLookup): ValidationResult {
  const errors: string[] = [];

  // Structural, 100%-of-rows finding — see file header.
  errors.push(
    "invoice_id cannot be resolved — tbl_credit_note has no column reliably linking to its originating tbl_invoice row (client_credit_note.invoice_id is NOT NULL FK to client_invoice.id)",
  );

  if (isBlank(row.src_category)) {
    errors.push("category is NULL/blank (client_credit_note.category is NOT NULL)");
  }
  if (isBlank(row.src_finance_year)) {
    errors.push("finance_year is NULL/blank (client_credit_note.finance_year is NOT NULL)");
  }
  if (isBlank(row.src_month)) {
    errors.push("month_label is NULL/blank (client_credit_note.month_label is NOT NULL)");
  }
  if (isBlank(row.src_creditdate)) {
    errors.push("credit_date is NULL/blank (client_credit_note.credit_date is NOT NULL)");
  }
  if (row.target_gst_type === null) {
    errors.push("gst_type is NULL (client_credit_note.gst_type is NOT NULL, no DEFAULT — design §5.2 vs live schema conflict)");
  }
  if (isBlank(row.src_cost_center) || !costCentre.has((row.src_cost_center ?? "").trim())) {
    errors.push(
      `cost_centre_id cannot be resolved — legacy cost_center "${row.src_cost_center ?? ""}" has no match in cost_centre_master.cost_centre_code`,
    );
  }
  const amountFields: Array<[string, string | null]> = [
    ["total", row.src_total],
    ["tax", row.src_tax],
    ["igst", row.src_igst],
    ["sgst", row.src_sgst],
    ["cgst", row.src_cgst],
    ["grnd", row.src_grnd],
  ];
  for (const [name, raw] of amountFields) {
    if (!parseDecimalOk(raw)) {
      errors.push(`${name} does not parse as a decimal (raw=${JSON.stringify(raw)})`);
    }
  }

  return joinErrors(errors);
}

// ── §6.2/design-driven mapping decisions for enum target columns, exercised
// here so they are unit-testable, even though they don't affect
// validation_status/validation_error (both live enums have safe DEFAULTs
// so an unmapped case can never make an INSERT fail — these are provenance/
// correctness decisions for Task 4's load.ts to reuse, not gating checks).
export function mapInvoiceStatus(billNo: string | null): "proforma" | "approved" {
  return isBlank(billNo) ? "proforma" : "approved";
}

export function mapCreditStatus(creditApprove: number | null): "draft" | "approved" {
  return creditApprove === 1 ? "approved" : "draft";
}
