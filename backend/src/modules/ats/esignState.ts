/**
 * Esign_State_Authority — the single declared source for how a joining document
 * checklist status is bucketed.
 *
 * WHY THIS FILE EXISTS
 * The tracker SQL used to hard-code three states inline
 * (`ats.joiningDocumentsTracker.service.ts:296-297`) while
 * `EmployeeJoiningDocumentsPage.tsx` kept a separate colour map that omitted
 * `ready_for_esign`, `draft_generated`, `hr_fill_required`,
 * `employee_review_pending` and `correction_requested`. Neither knew about the
 * other, so a row in an unrecognised state left the eSign denominator entirely
 * and MAS63411 read a green "5/5" over nine documents, four of them unsigned.
 *
 * The two builds cannot share a literal module — `vite.config.ts` and the root
 * `tsconfig.json` alias `@` to `./src` only, and the backend is a separate
 * tsconfig — so the server is made the authority and the frontend mirror
 * (`src/lib/esignState.ts`) is pinned to it by a contract test rather than by an
 * import.
 *
 * LEAF MODULE — IMPORTS NOTHING.
 * No db, no env, no services. Two reasons, both load-bearing: it is trivially
 * testable without a database, and it can be imported by anything (tracker
 * service, routes, scripts, tests) without ever forming a cycle. Keep it that
 * way; a single import of `../../db` here would put a connection pool behind a
 * pure lookup table.
 */

export type EsignBucket = "completed" | "in_progress" | "not_started";

/**
 * Every status this system writes to `employee_joining_document_checklist.status`,
 * mapped to exactly one bucket.
 *
 * The key set is the union of:
 *   - `ALLOWED_CHECKLIST_STATUSES` (`employeeJoiningDocuments.service.ts:89-107`),
 *     the write-side allow-list — all 17 members are present here, and a contract
 *     test asserts that, so adding a status there without classifying it here
 *     fails the build; and
 *   - the three live production values that predate that allow-list and are
 *     written by `universalDigitalFormFill.service.ts` (`draft_generated`,
 *     `hr_fill_required`, `employee_review_pending`).
 *
 * TOTALITY IS THE POINT. Because every status maps,
 * `completed + in_progress + not_started` equals `COUNT(c.id)` — no checklist row
 * can silently leave the denominator (Requirement 6, criterion 1). That is why
 * `uploaded_pending_review` is bucketed rather than excluded: it is eSign-irrelevant
 * work, but dropping it would break the row-count identity that makes the
 * denominator trustworthy.
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
  // and a re-dispatch can both still carry it to completion, and Requirement 6
  // criterion 3 requires it inside the denominator.
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
 * Distinct unrecognised status values already logged by this process.
 *
 * Module-level and deliberately unbounded-in-principle but bounded-in-practice:
 * the log line must fire once per distinct value per process, not once per row.
 * Without this, one bad status across the 309 in-scope employees is 309
 * identical log lines, which is how a real signal gets buried.
 */
const loggedUnknownStates = new Set<string>();

/**
 * Bucket a checklist status. TOTAL by construction: every input, including
 * `null`, `undefined` and a value never seen before, returns a bucket.
 *
 * An unrecognised value is bucketed `not_started` (the safest reading — it does
 * not claim a signature that may not exist) and is counted rather than dropped,
 * per Requirement 6 criteria 1 and 5.
 */
export function classifyEsignState(status: string | null | undefined): EsignBucket {
  if (status === null || status === undefined) {
    warnUnrecognised(status === null ? "<null>" : "<undefined>");
    return "not_started";
  }

  const bucket: EsignBucket | undefined = ESIGN_STATE_BUCKET[status];
  if (bucket !== undefined) return bucket;

  warnUnrecognised(status);
  return "not_started";
}

function warnUnrecognised(value: string): void {
  if (loggedUnknownStates.has(value)) return;
  loggedUnknownStates.add(value);
  console.warn(
    `[esignState] Unrecognised joining document checklist status "${value}" — ` +
      `counted as "not_started". Add it to ESIGN_STATE_BUCKET in ` +
      `backend/src/modules/ats/esignState.ts to classify it deliberately.`,
  );
}

/**
 * Test seam only: forget which unrecognised values have been logged, so a test
 * can assert the once-per-distinct-value behaviour without a fresh process.
 * Not used by production code.
 */
export function __resetUnknownEsignStateLogCache(): void {
  loggedUnknownStates.clear();
}

/**
 * The SQL `CASE` expression for `column`, GENERATED from `ESIGN_STATE_BUCKET`.
 *
 *   CASE c.status WHEN 'esign_completed' THEN 'completed' … ELSE 'not_started' END
 *
 * Generated rather than hand-written so the query and `classifyEsignState` cannot
 * disagree — they are the same table. Hand-writing the `CASE` is exactly the
 * drift this module exists to end.
 *
 * `column` is a caller-supplied SQL identifier (e.g. `"c.status"`), not user
 * input; it is interpolated as given. Status keys are single-quote-escaped
 * defensively — nothing in the table contains a quote today, and this is what
 * keeps that true if someone adds one.
 */
export function esignBucketCaseSql(column: string): string {
  const whens = Object.entries(ESIGN_STATE_BUCKET)
    .map(([status, bucket]) => `WHEN '${sqlQuote(status)}' THEN '${bucket}'`)
    .join(" ");
  return `CASE ${column} ${whens} ELSE 'not_started' END`;
}

function sqlQuote(value: string): string {
  return value.replace(/'/g, "''");
}
