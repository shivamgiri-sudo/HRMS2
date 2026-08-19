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
 *   refusing to load it.
 *
 * ── 2026-08-19 design addendum (A1/A3/A4) — supersedes several of the notes
 *    above; see docs/superpowers/specs/2026-08-19-client-billing-cutover-addendum.md
 * - A1: gst_type is no longer flagged NULL for a blank legacy GSTType —
 *   extract.transforms.ts's computeGstType() derives a real Integrated/
 *   Intrastate/'Not Applicable' value for every row before this file ever
 *   sees it (validate.ts UPDATEs target_gst_type/target_apply_gst on the
 *   staging rows first). The `target_gst_type === null` check below stays as
 *   defense-in-depth, not the primary path.
 * - A2: category is no longer flagged NULL/blank — normalizeCategory()
 *   defaults blank to 'Others'. The isBlank(category) check below also stays
 *   as defense-in-depth against any row that predates the fix.
 * - A3: cost_centre_id unresolved rows are still a real, disclosed error —
 *   re-confirmed live (87 invoice rows, 0 credit-note rows, unchanged from
 *   Task 3's report) — but the message is now a fixed, filterable string so
 *   a future manual-reconciliation task can select exactly these rows.
 * - A4: 53 of 144 credit notes now resolve invoice_id via a unique
 *   proforma_bill_no -> bill_no match (validated against 0 cost-centre
 *   disagreements) — validate.ts computes this and passes the resolved
 *   target_invoice_id (or a specific unresolved reason) into
 *   validateCreditNoteRow instead of this file unconditionally failing every
 *   row.
 */

export interface CostCentreLookup {
  has(code: string): boolean;
  get(code: string): string | undefined;
  getBranchId(code: string): string | undefined;
}

export function buildCostCentreLookup(
  rows: Array<{ cost_centre_code: string; id: string; branch_id?: string | null }>,
): CostCentreLookup {
  const map = new Map<string, string>();
  const branchMap = new Map<string, string>();
  for (const r of rows) {
    if (!r.cost_centre_code) continue;
    const code = r.cost_centre_code.trim();
    map.set(code, r.id);
    if (r.branch_id) branchMap.set(code, r.branch_id);
  }
  return {
    has: (code: string) => map.has(code),
    get: (code: string) => map.get(code),
    getBranchId: (code: string) => branchMap.get(code),
  };
}

/** branch_master.id -> gst_state_code, built fresh live by validate.ts (A1). */
export function buildBranchStateCodeLookup(
  rows: Array<{ id: string; gst_state_code: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.gst_state_code) map.set(r.id, r.gst_state_code);
  }
  return map;
}

/** Resolves a legacy free-text cost_center code straight through to the branch's
 *  own gst_state_code, for computeGstType()'s branchStateCode input (A1). Returns
 *  null when the cost centre itself doesn't resolve, or its branch has no code. */
export function resolveBranchStateCode(
  costCenterCode: string | null,
  costCentre: CostCentreLookup,
  branchStateCodes: Map<string, string>,
): string | null {
  const trimmed = (costCenterCode ?? "").trim();
  if (trimmed === "") return null;
  const branchId = costCentre.getBranchId(trimmed);
  if (!branchId) return null;
  return branchStateCodes.get(branchId) ?? null;
}

/** A3's fixed, filterable error message for a cost centre that genuinely does
 *  not exist in the live cost_centre_master — a future manual-reconciliation
 *  task selects on this exact string. */
export const COST_CENTRE_UNRESOLVED_MESSAGE = "cost_centre_id unresolved - needs manual reconciliation";

function costCentreError(rawCode: string | null): string {
  return `${COST_CENTRE_UNRESOLVED_MESSAGE} (legacy cost_center "${rawCode ?? ""}" has no match in cost_centre_master.cost_centre_code)`;
}

// ── A4: credit_note -> invoice matching (proforma_bill_no unique match) ──────
export interface InvoiceBillNoCandidate {
  targetInvoiceId: string;
  costCenterCode: string | null;
}

/** Indexes staged invoices by bill_no for A4's credit-note matching. Blank/NULL
 *  bill_no never participates (an invoice with no bill_no was never actually
 *  billed — design §5.4 — so it cannot be what a credit note references). */
export function buildInvoiceBillNoIndex(
  rows: Array<{ src_bill_no: string | null; target_id: string; src_cost_center: string | null }>,
): Map<string, InvoiceBillNoCandidate[]> {
  const map = new Map<string, InvoiceBillNoCandidate[]>();
  for (const r of rows) {
    const key = (r.src_bill_no ?? "").trim();
    if (key === "") continue;
    const arr = map.get(key) ?? [];
    arr.push({ targetInvoiceId: r.target_id, costCenterCode: r.src_cost_center });
    map.set(key, arr);
  }
  return map;
}

export interface InvoiceMatchResult {
  status: "resolved" | "ambiguous" | "unresolved";
  targetInvoiceId: string | null;
  /** the matched invoice's own vendor GSTIN, for A1's credit-note gst_type
   *  derivation (tbl_credit_note itself never carried this column) */
  vendorGstin: string | null;
  error: string | null;
}

/** Matches one credit note to its originating invoice by proforma_bill_no
 *  (A4). Three disclosed outcomes, never a silent guess:
 *    - blank/absent proforma_bill_no -> unresolved ("no proforma_bill_no recorded")
 *    - 0 or >1 candidate invoices share that bill_no -> unresolved/ambiguous
 *    - exactly 1 candidate, but its own cost centre disagrees with the credit
 *      note's -> ambiguous (the addendum's own trust signal was "0 of 53
 *      disagree"; a disagreement found now would mean the match is not safe)
 *    - exactly 1 candidate, cost centres agree -> resolved */
export function matchCreditNoteInvoice(
  proformaBillNo: string | null,
  creditNoteCostCenter: string | null,
  index: Map<string, InvoiceBillNoCandidate[]>,
  invoiceVendorGstinByTargetId: Map<string, string | null>,
): InvoiceMatchResult {
  const key = (proformaBillNo ?? "").trim();
  if (key === "") {
    return {
      status: "unresolved",
      targetInvoiceId: null,
      vendorGstin: null,
      error: "invoice_id unresolvable - no proforma_bill_no recorded",
    };
  }
  const candidates = index.get(key) ?? [];
  if (candidates.length === 0) {
    return {
      status: "unresolved",
      targetInvoiceId: null,
      vendorGstin: null,
      error: `invoice_id unresolvable - no invoice found with bill_no ${JSON.stringify(key)}`,
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      targetInvoiceId: null,
      vendorGstin: null,
      error: `invoice_id ambiguous - ${candidates.length} candidate invoices share this bill_no`,
    };
  }
  const only = candidates[0];
  if ((only.costCenterCode ?? "").trim() !== (creditNoteCostCenter ?? "").trim()) {
    return {
      status: "ambiguous",
      targetInvoiceId: null,
      vendorGstin: null,
      error: `invoice_id ambiguous - matched invoice's cost centre "${only.costCenterCode ?? ""}" disagrees with credit note's cost centre "${creditNoteCostCenter ?? ""}"`,
    };
  }
  return {
    status: "resolved",
    targetInvoiceId: only.targetInvoiceId,
    vendorGstin: invoiceVendorGstinByTargetId.get(only.targetInvoiceId) ?? null,
    error: null,
  };
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
    errors.push(costCentreError(row.src_cost_center));
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

export function validateCreditNoteRow(
  row: CreditNoteValidationInput,
  costCentre: CostCentreLookup,
  invoiceMatch: InvoiceMatchResult,
): ValidationResult {
  const errors: string[] = [];

  // A4 (2026-08-19 addendum) — supersedes the prior 100%-of-rows structural
  // failure. validate.ts resolves invoiceMatch via matchCreditNoteInvoice()
  // (proforma_bill_no unique match against staged invoice bill_no) before
  // calling this function. Only a genuinely unresolved/ambiguous match is an
  // error now — the 53 rows that resolve cleanly no longer fail here at all.
  if (invoiceMatch.status !== "resolved") {
    errors.push(invoiceMatch.error ?? "invoice_id cannot be resolved");
  }

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
    errors.push(costCentreError(row.src_cost_center));
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
