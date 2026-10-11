/**
 * The one definition of "this requisition is filled" for the hiring engine (owner decision, 2026-10-11):
 *   - the target is 130% of the requested seats (a 30% buffer for people who are selected but never join);
 *   - it is met by the JOINED count: candidates whose employee code has been generated, not walk-ins and not selections;
 *   - when it is met the engine moves on to the next requisition of the same process, designation and branch.
 * HR's fulfilled_headcount (the selected count) keeps its meaning for HR screens and for planning; it no longer closes anything here.
 */
export const FILL_BUFFER = 1.3;

/** Joins needed for a requisition with this many requested seats. */
export const joinTarget = (requested: number | null | undefined): number => Math.ceil(Math.max(0, Number(requested ?? 0)) * FILL_BUFFER);

/** True when the joined count has reached the target (never true for a requisition with no seats requested). */
export const fillTargetMet = (requested: number | null | undefined, joined: number | null | undefined): boolean =>
  Number(requested ?? 0) > 0 && Number(joined ?? 0) >= joinTarget(requested);

/** Joins still needed. */
export const joinsLeft = (requested: number | null | undefined, joined: number | null | undefined): number =>
  Math.max(0, joinTarget(requested) - Math.max(0, Number(joined ?? 0)));

/** SQL: the requisition (alias `a`) still has joins to reach. Use where the old test was `fulfilled_headcount < requested_headcount`. */
export const joinsOpenSql = (a = "jr"): string => `${a}.joined_headcount < CEIL(${a}.requested_headcount * ${FILL_BUFFER})`;
/** SQL: the requisition (alias `a`) has reached its join target. */
export const joinsMetSql = (a = "jr"): string => `${a}.joined_headcount >= CEIL(${a}.requested_headcount * ${FILL_BUFFER})`;

/**
 * Selections still to be made: the 130% target minus whichever is larger, the people already selected (HR's count, capped at the
 * requested seats) or already joined. Used to size outreach while the requisition is open; once the joined count meets the target the
 * requisition is filled and this is 0 by definition of fillTargetMet.
 */
export const selectionsStillNeeded = (requested: number | null | undefined, selected: number | null | undefined, joined: number | null | undefined): number =>
  fillTargetMet(requested, joined) ? 0 : Math.max(0, joinTarget(requested) - Math.max(Math.max(0, Number(selected ?? 0)), Math.max(0, Number(joined ?? 0))));
