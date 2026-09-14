/**
 * Frontend mirror of the tracker's summary classifier.
 *
 * The authority is `classifyEmployeeBucket` in
 * `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts`, which
 * `calculateTrackerSummary` calls in its loop to produce `completed_count`,
 * `in_progress_count` and `pending_count`. This file is a PINNED MIRROR of that
 * function — same union, same thresholds, same order of tests — not a second
 * opinion.
 *
 * WHY A MIRROR AND NOT AN IMPORT
 * The two builds cannot share a literal module: `vite.config.ts` and the root
 * `tsconfig.json` alias `@` to `./src` only, and the backend compiles under its
 * own tsconfig. Same constraint, and same mirroring answer, as
 * `src/lib/esignState.ts`.
 *
 * WHY THE PAGE NEEDS IT AT ALL
 * Requirement 7 criterion 4: a row badged In Progress must be counted in the In
 * Progress tile. The tracker page's `StatusBadge` used to read
 * `employees.joining_document_status`, a separate column written by
 * `recalculateDocumentProgress` on a schedule the tiles know nothing about, so
 * the badge and the tile could disagree — and in production they did, tiles
 * reading Completed 0 / In Progress 0 above rows badged In Progress. Deriving the
 * badge from the same percentage the summary buckets, through the same
 * thresholds, removes the second source of truth rather than resynchronising it.
 *
 * LEAF MODULE — IMPORTS NOTHING.
 */

/**
 * The buckets the tracker tiles render, and the only buckets the summary
 * produces. Mirrors `SummaryBucket` in the service.
 */
export type SummaryBucket = "completed" | "in_progress" | "pending";

/**
 * Bucket an employee by joining-document completion percentage.
 *
 * Total by construction: every real number lands in exactly one bucket, which is
 * what makes the three summary counts a partition of the employee set rather
 * than three independent tallies.
 *
 * Mirrors `classifyEmployeeBucket` in
 * `backend/src/modules/ats/ats.joiningDocumentsTracker.service.ts`. Keep the
 * thresholds and their order identical — the former 75-99 `pending_verification`
 * band is deliberately folded into `in_progress` on both sides.
 */
export function classifyEmployeeBucket(pct: number): SummaryBucket {
  if (pct >= 100) return "completed";
  if (pct > 0) return "in_progress"; // absorbs the former 75-99 pending_verification band
  return "pending";
}
