import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";

/** Start of the backend's message for a section whose first (cold-cache) load is still running. */
export const STILL_CALCULATING_PREFIX = "Still calculating";
export const PENDING_POLL_MS = 20_000;
export const MAX_PENDING_POLLS = 6;

export function isStillCalculating(message: unknown): boolean {
  return typeof message === "string" && message.startsWith(STILL_CALCULATING_PREFIX);
}

type Part = { status?: unknown; message?: unknown; data?: unknown } | null | undefined;
const pending = (p: Part) => Boolean(p && typeof p === "object" && isStillCalculating(p.message));

/** True when any section (overview sections, Callmaster's parts, data health) is still calculating. */
export function hasPendingSections(data: BranchHeadHealthPayload | null | undefined): boolean {
  if (!data) return false;
  if (pending(data.dataHealth as Part)) return true;
  return (data.branches ?? []).some(({ overview }) => Object.values(overview ?? {}).some((v) => {
    const part = v as Part;
    if (pending(part)) return true;
    const inner = part && typeof part === "object" && part.data && typeof part.data === "object" && !Array.isArray(part.data) ? Object.values(part.data as object) : [];
    return inner.some((x) => pending(x as Part));
  }));
}

/** Poll bookkeeping kept in a ref: the result time last counted and how many pending results in a row. */
export interface PollState { lastAt: number; polls: number }

/**
 * refetchInterval decision: poll every 20 s while sections are pending, at most 6 polls in a row after
 * the first pending result; the count resets as soon as nothing is pending. Counts each result once
 * (keyed by its update time), however often react-query asks.
 */
export function pendingPollInterval(state: PollState, data: BranchHeadHealthPayload | null | undefined, dataUpdatedAt: number): number | false {
  if (!hasPendingSections(data)) { state.polls = 0; state.lastAt = dataUpdatedAt; return false; }
  if (dataUpdatedAt !== state.lastAt) { state.lastAt = dataUpdatedAt; state.polls += 1; }
  return state.polls <= MAX_PENDING_POLLS ? PENDING_POLL_MS : false;
}
