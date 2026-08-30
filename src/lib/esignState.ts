/**
 * Frontend mirror of Esign_State_Authority.
 *
 * The authority is `backend/src/modules/ats/esignState.ts`. This file is a PINNED
 * MIRROR of it, not a second opinion: same `EsignBucket` union, same 20-key
 * status→bucket table, same total `classifyEsignState` behaviour.
 *
 * WHY A MIRROR AND NOT AN IMPORT
 * The two builds cannot share a literal module. `vite.config.ts` and the root
 * `tsconfig.json` alias `@` to `./src` only, and the backend compiles under its
 * own tsconfig, so neither side can reach the other's file. The agreement is
 * therefore pinned by a contract test that compares the two files' bucket KEY
 * SETS (`src/lib/__tests__/esignStateMirror.contract.test.ts`) rather than
 * assumed. If you add, remove or rename a key here or there, that test fails and
 * names the offending value.
 *
 * WHAT THIS FILE IS FOR
 * Presentation only. `EmployeeJoiningDocumentsPage.tsx` renders one row per
 * checklist document and needs a colour for whatever `status` the row carries —
 * previously from a hand-kept map that omitted `ready_for_esign`,
 * `draft_generated`, `hr_fill_required`, `employee_review_pending` and
 * `correction_requested`, all of which occur in production data, so documents in
 * those states rendered with no status styling at all (Requirement 6, criteria 6
 * and 7). Driving that map from this table means a status can no longer be live
 * in the database and invisible in the UI.
 *
 * The tracker page needs none of this: the API sends the bucket already, so it
 * carries no status vocabulary. Do not add status lists anywhere else.
 *
 * LEAF MODULE — IMPORTS NOTHING. Same rule as the backend authority: pure lookup
 * table plus pure functions, trivially testable, safe to import from anywhere.
 */

export type EsignBucket = "completed" | "in_progress" | "not_started";

/**
 * Every status the system writes to `employee_joining_document_checklist.status`,
 * mapped to exactly one bucket. Mirrors `ESIGN_STATE_BUCKET` in
 * `backend/src/modules/ats/esignState.ts` key-for-key — the comment groupings
 * below are the backend's, kept so the two read as the same table.
 *
 * TOTALITY IS THE POINT. Every status maps, so no row can leave the eSign
 * denominator on the server and no row can render unstyled here.
 */
export const ESIGN_STATE_BUCKET: Readonly<Record<string, EsignBucket>> = Object.freeze({
  // ── completed ──────────────────────────────────────────────────────────────
  // Terminal and satisfied: a signature or a verification outcome is on file.
  esign_completed: "completed",
  employee_confirmed: "completed",
  verified: "completed",
  completed: "completed",
  signed_verified: "completed",
  wet_signed_uploaded: "completed",

  // ── in_progress ────────────────────────────────────────────────────────────
  // The document is in flight: someone (candidate, employee or HR) has an
  // outstanding action on a document that already exists.
  esign_initiated: "in_progress",
  pending_candidate_esign: "in_progress",
  ready_for_esign: "in_progress",
  employee_review_pending: "in_progress",
  uploaded_pending_review: "in_progress",
  uploaded_pending_esign: "in_progress",
  correction_requested: "in_progress",
  needs_correction: "in_progress",
  // A failed signature is in progress, not terminal: the reconciliation worker
  // and a re-dispatch can both still carry it to completion.
  esign_failed: "in_progress",

  // ── not_started ────────────────────────────────────────────────────────────
  // Nothing has been asked of anyone outside HR yet — the document is still
  // being prepared.
  draft_generated: "not_started",
  hr_fill_required: "not_started",
  pending_hr_upload: "not_started",
  pending_generation: "not_started",
  template_pending: "not_started",
} as const satisfies Record<string, EsignBucket>);

/**
 * Bucket a checklist status. TOTAL by construction: every input, including
 * `null`, `undefined` and a value never seen before, returns a bucket.
 *
 * An unrecognised value buckets to `not_started` — the safest reading, since it
 * does not claim a signature that may not exist. Unlike the backend authority
 * this does not log: the server already names the unrecognised value once per
 * distinct value per process (Requirement 6, criterion 5), and repeating it from
 * every browser adds noise without adding signal.
 */
export function classifyEsignState(status: string | null | undefined): EsignBucket {
  if (status === null || status === undefined) return "not_started";
  return ESIGN_STATE_BUCKET[status] ?? "not_started";
}

/**
 * Bucket → Tailwind chip classes. The presentation default for every status,
 * chosen to preserve what the page already rendered for the statuses that were
 * in its map: emerald for the completed group, blue for in-flight, slate for
 * not-yet-started.
 *
 * A handful of in-progress statuses carry more urgency than "in flight" and keep
 * an explicit per-status colour on top of this default — see
 * `ESIGN_STATUS_COLOR_OVERRIDES`.
 */
export const ESIGN_BUCKET_COLORS: Readonly<Record<EsignBucket, string>> = Object.freeze({
  completed: "bg-emerald-50 text-emerald-700",
  in_progress: "bg-blue-50 text-blue-700",
  not_started: "bg-slate-100 text-slate-500",
});

/**
 * Per-status colours that deliberately differ from their bucket default.
 *
 * All four are `in_progress` — correct for the denominator, since the worker or a
 * re-dispatch can still carry them to completion — but rendering them the same
 * calm blue as `esign_initiated` would hide the fact that they are blocked on
 * someone. `pending_candidate_esign` is waiting on a person outside the company
 * (amber); the correction and failure states need HR to act (red). These four
 * colours are what the page showed before this map existed, and are preserved.
 */
export const ESIGN_STATUS_COLOR_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  pending_candidate_esign: "bg-amber-50 text-amber-700",
  esign_failed: "bg-red-50 text-red-700",
  needs_correction: "bg-red-50 text-red-700",
  // Same meaning as needs_correction from the universal-form-fill path; styled
  // alike so one workflow's wording does not read as a different state.
  correction_requested: "bg-red-50 text-red-700",
});

/**
 * Chip classes for a checklist status: its override if it has one, else its
 * bucket's default. Total for the same reason `classifyEsignState` is — an
 * unknown status renders slate rather than unstyled.
 */
export function esignStatusColor(status: string | null | undefined): string {
  if (status !== null && status !== undefined) {
    const override = ESIGN_STATUS_COLOR_OVERRIDES[status];
    if (override !== undefined) return override;
  }
  return ESIGN_BUCKET_COLORS[classifyEsignState(status)];
}

/**
 * The status→colour map every one of the 20 statuses resolves through, built from
 * the table above rather than maintained as a second list.
 *
 * Consumers may spread additional non-Esign_State keys over this (the documents
 * page adds `linked_from_general_docs` and the `pending`/`not_started` UI
 * sentinels, which are display values rather than checklist statuses).
 */
export const ESIGN_STATE_COLORS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.keys(ESIGN_STATE_BUCKET).map((status) => [status, esignStatusColor(status)]),
  ),
);
