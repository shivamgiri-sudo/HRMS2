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
// Blank category ('' or NULL, 470 + 44 = 514 rows) is normalized to NULL rather than
// merged into any named category — it is a missing value, not a spelling variant of
// one, so inventing a bucket for it would misrepresent what legacy actually recorded.
// Everything else passes through verbatim (trimmed only).
const CATEGORY_NORMALIZATION_MAP: Record<string, string> = {
  talktime: "Talk Time",
  other: "Others",
};

export function normalizeCategory(categoryRaw: string | null): string | null {
  if (categoryRaw === null) return null;
  const trimmed = categoryRaw.trim();
  if (trimmed === "") return null;
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