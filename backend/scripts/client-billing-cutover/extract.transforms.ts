/**
 * Pure mapping/casting logic for the client-billing historical cutover extraction
 * (docs/superpowers/plans/2026-08-19-client-billing-cutover.md Task 2,
 *  docs/superpowers/specs/2026-08-19-client-billing-cutover-design.md §2, §5, §6).
 *
 * Every function here is a pure transform: no DB connection, no I/O. extract.ts
 * imports these to build staging rows from live db_bill query results; this file's
 * own test (__tests__/extract.transforms.test.ts) exercises them against fixture
 * data reproducing every real quirk found in the live data (see design §8) without
 * ever touching a real database connection.
 */

// ── §5.7: legacy's own "deleted" flag for tbl_invoice ────────────────────────
// Verified live 2026-08-19 against db_bill.tbl_invoice: status=0 (10,797 rows,
// active/legal-hold) vs status=1 (234 rows, legacy's own deleted/void marker).
export function shouldExcludeInvoice(status: number | null): boolean {
  return status === 1;
}

// tbl_credit_note's `status` column does NOT mean the same thing as tbl_invoice's.
// Verified live 2026-08-19: tbl_credit_note status=1 correlates with credit_approve=1
// and recent createdate (121 of 138 status=1 rows are approved; the 5 most recent
// credit notes in the whole table, up to 2026-08-18, are ALL status=1) while status=0
// correlates with credit_approve=0 (all 6 status=0 rows are unapproved). This is the
// REVERSE of tbl_invoice's status semantics — applying tbl_invoice's "status=1 is
// deleted" rule here would exclude 138 of 144 real credit notes, keeping only 6. No
// InvoiceDeleteRemarks-equivalent column exists on tbl_credit_note at all, so there
// is no reliable "this one is void" signal to filter on here. Extraction therefore
// migrates every tbl_credit_note row and leaves any exclusion decision to Task 3's
// human-reviewed validation report — never guesses and silently drops real credit
// notes. This function exists so that decision is explicit and named, not absent.
export function shouldExcludeCreditNote(_status: number | null): boolean {
  return false;
}

// ── §5.2: GSTType null/empty (2,237 of 11,031 tbl_invoice rows, verified live) ──
export function mapGstFields(gstTypeRaw: string | null): {
  target_gst_type: string | null;
  target_apply_gst: 0 | 1;
} {
  const trimmed = (gstTypeRaw ?? "").trim();
  if (trimmed === "") {
    return { target_gst_type: null, target_apply_gst: 0 };
  }
  return { target_gst_type: trimmed, target_apply_gst: 1 };
}

// ── A1 (2026-08-19 addendum, supersedes design §5.2 / mapGstFields's own NULL
// result for a blank legacy GSTType): client_invoice.gst_type /
// client_credit_note.gst_type are VARCHAR(20) NOT NULL with no DEFAULT, so
// mapGstFields's `target_gst_type: null` for a blank GSTType is not insertable.
//
// computeGstType() is a strict superset of mapGstFields: a non-blank legacy
// GSTType still passes straight through unchanged (identical to mapGstFields).
// Only the genuinely-blank case is handled differently — instead of NULL, it is
// derived when derivable, or classified honestly instead of guessed:
//
//   1. If the vendor's own GSTIN (cost_VendorGSTNo / src_cost_vendorgstno) looks
//      like a real 15-char GSTIN (`^\d{2}[A-Z0-9]{13}$` — no existing GSTIN
//      validator was found anywhere else in this codebase, confirmed by search;
//      this is the addendum's own exact pattern) AND the row's cost centre
//      resolves to a branch with a known gst_state_code: derive
//      Integrated/Intrastate by comparing the GSTIN's 2-digit state prefix
//      against that branch's own gst_state_code — the SAME comparison
//      client-billing.service.ts's createProforma() already relies on (it reads
//      cost_centre_master.gst_type + branch_master.gst_state_code directly
//      rather than re-deriving them, because this derivation is expected to
//      already have happened once, at cost-centre setup time; this addendum
//      performs that same one-time derivation for historical rows that never
//      had it done at all). apply_gst = 1.
//   2. Otherwise (malformed/absent/foreign GSTIN, OR no resolvable branch state
//      code — which also naturally covers pre-GST-era rows and rows with an
//      explicit legacy apply_gst=0, since those essentially never carry a
//      valid-looking modern GSTIN on file): gst_type = 'Not Applicable',
//      apply_gst = 0. A real, honest classification, not a NULL stand-in — the
//      frontend's GstBreakdown / PDF's drawTaxSummary already guard on
//      apply_gst before rendering any tax line, so nothing downstream needs to
//      change to handle it correctly.
//
// branchStateCode is resolved by the caller (validate.ts, live, fresh off
// cost_centre_master.branch_id -> branch_master.gst_state_code) — this function
// stays a pure transform with no DB access of its own.
const GSTIN_RE = /^\d{2}[A-Z0-9]{13}$/;

export interface GstTypeInput {
  /** legacy GSTType column (row.GSTType / src_gsttype) */
  gstTypeRaw: string | null;
  /** legacy cost_VendorGSTNo column (src_cost_vendorgstno on invoices; for a
   *  credit note, the caller resolves this from its matched invoice — see A4) */
  vendorGstin: string | null;
  /** resolved live: cost_centre_master.branch_id -> branch_master.gst_state_code
   *  for this row's own cost centre; null when unresolvable */
  branchStateCode: string | null;
}

export function computeGstType(input: GstTypeInput): {
  target_gst_type: string;
  target_apply_gst: 0 | 1;
} {
  const trimmedLegacy = (input.gstTypeRaw ?? "").trim();
  if (trimmedLegacy !== "") {
    return { target_gst_type: trimmedLegacy, target_apply_gst: 1 };
  }
  const gstin = (input.vendorGstin ?? "").trim().toUpperCase();
  const branchStateCode = (input.branchStateCode ?? "").trim();
  if (GSTIN_RE.test(gstin) && branchStateCode !== "") {
    const vendorStateCode = gstin.slice(0, 2);
    const gstType = vendorStateCode === branchStateCode ? "Intrastate" : "Integrated";
    return { target_gst_type: gstType, target_apply_gst: 1 };
  }
  return { target_gst_type: "Not Applicable", target_apply_gst: 0 };
}

// ── §5.5: category normalization ──────────────────────────────────────────────
// Built from a FRESH live query (2026-08-19) of every distinct db_bill.tbl_invoice
// category, not the design doc's LIMIT-10 sample:
//   Others (8005), Subscription (1077), Talk Time (662), '' empty string (470),
//   Non Subscription (370), Talktime (144), first_bill (112), One time cost (63),
//   Setup Cost (51), NULL (44), Development Cost (19), Topup (9),
//   PlatForm Charges (2), Subscription-Tool (2), Other (1).
// Two real casing/spelling variants found beyond the design doc's own example:
//   - "Talktime" -> "Talk Time"     (144 rows; the doc's own example, confirmed)
//   - "Other"    -> "Others"        (1 row; singular vs the dominant plural form —
//                                    same category, not a distinct one; found only
//                                    by running the fresh unlimited query)
// ── A2 (2026-08-19 addendum, supersedes this comment's original "normalize blank
// to NULL" call): client_invoice.category / client_credit_note.category are
// VARCHAR(50) NOT NULL — blank/NULL is not insertable as NULL. Blank category
// (510 invoice rows + 1 credit-note row, re-verified live) is defaulted to
// 'Others' instead: already the dominant real category (70%+ of all rows), a
// low-stakes reporting/filter field with no financial consequence, not worth a
// more elaborate inference. This is a real, disclosed default — not a silent
// data fabrication — and is exactly what 'Others' already means for every one
// of the 8,006 rows that legitimately recorded it themselves.
const CATEGORY_NORMALIZATION_MAP: Record<string, string> = {
  talktime: "Talk Time",
  other: "Others",
};

const BLANK_CATEGORY_DEFAULT = "Others";

export function normalizeCategory(categoryRaw: string | null): string {
  if (categoryRaw === null) return BLANK_CATEGORY_DEFAULT;
  const trimmed = categoryRaw.trim();
  if (trimmed === "") return BLANK_CATEGORY_DEFAULT;
  const key = trimmed.toLowerCase();
  return CATEGORY_NORMALIZATION_MAP[key] ?? trimmed;
}

// ── §5.6: status=0 + InvoiceDeleteRemarks ("under legal process", 89 rows) ─────
export function buildDescription(
  descriptionRaw: string | null,
  deleteRemarksRaw: string | null,
): string | null {
  const description = (descriptionRaw ?? "").trim();
  const remarks = (deleteRemarksRaw ?? "").trim();
  if (remarks === "") {
    return description === "" ? null : description;
  }
  const note = `[${remarks}]`;
  return description === "" ? note : `${description} ${note}`;
}

// ── §6.2 / design's own note that VARCHAR total/tax/igst/sgst/cgst/grnd are a real,
// expected parse-failure mode, not hypothetical. This function is used only to
// COUNT/report cast failures during extraction (per Task 2 Step 1) — the staging
// table has no dedicated numeric target column for these (1304/1305's schema keeps
// them as verbatim src_* strings only), so Task 3's own validate.ts is the
// authoritative parse pass against the real client_invoice column types. Extraction
// never lets a cast failure here abort the row: the raw src_ value is always written
// regardless of what this returns.
export function parseLegacyDecimal(raw: string | null): { value: number | null; ok: boolean } {
  if (raw === null) return { value: null, ok: true }; // NULL is not a parse failure — it's absent
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, ok: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, ok: false };
  return { value: n, ok: true };
}

// ── MySQL 5.5 zero-dates on db_bill's own DATETIME columns ────────────────────
// A real defect found only by running extraction against real data, not
// hypothesized in the design doc: db_bill (MySQL 5.5) allows the zero-date
// sentinel '0000-00-00 00:00:00' on ANY DATETIME column, not only createdate
// (which design §5.1 already accounts for — 2 rows). mysql2, reading it without
// dateStrings on a value it cannot represent as a JS Date, returns the raw
// sentinel string as-is. mas_hrms (MySQL 8, strict mode) then rejects that same
// string on INSERT with ER_TRUNCATED_WRONG_VALUE (1292) — confirmed live on
// po_date/grn_date across many rows during this task's own extraction run, well
// beyond the 2 createdate rows design §5.1 anticipated. A zero date on an
// OPTIONAL auxiliary field (po_date, grn_date, the InvoiceType*/InvoiceReject*
// approval timestamps, credit_approved_date, updated_at) means "this event never
// happened", which is exactly what SQL NULL already means — so it is normalized
// to NULL here, never treated as a row-level failure the way §5.1 treats a
// zero/garbage value on the migration-critical createdate itself (createdate is
// NOT NULL in both legacy and every DATETIME column that receives it verbatim
// here; a genuinely zero createdate row is instead caught by the DB `NOT NULL`
// rejection and surfaces as a normal per-row write failure, same as any other
// real error — nothing here silently drops it).
const ZERO_DATETIME_RE = /^0{4}-0{2}-0{2}([ T]0{2}:0{2}:0{2})?/;

export function sanitizeLegacyDatetime(raw: unknown): string | Date | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    return ZERO_DATETIME_RE.test(raw.trim()) ? null : raw;
  }
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  return raw as string | Date;
}