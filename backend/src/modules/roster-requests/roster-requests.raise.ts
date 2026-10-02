/**
 * Producer hook for the four request kinds: called by every place a roster request is raised
 * (swap create, week-off rejection, dispute raise, conflict log) right after the request commits.
 *
 * Off the response path: onRosterRequestRaised defers everything with setImmediate and never
 * throws, so the producers' responses and timings are unchanged. Order: approver inbox items
 * first, then the auto-approve evaluation (which, if it approves, closes those same items).
 *
 * The auto-approve module is loaded lazily: it imports the decide service, which imports the swap
 * service, which imports this file — a static import would be a cycle.
 */
import type { RowDataPacket } from "mysql2";
import { db as defaultDb } from "../../db/mysql.js";
import { notifyApproversOfRequest, type RaisedRequest } from "./roster-requests.notify.js";
import { AUTO_APPROVABLE_KINDS, type RequestKind } from "./roster-requests.types.js";

type Exec = { execute: (sql: string, params?: unknown[]) => Promise<any> };

export interface RaiseInput extends Omit<RaisedRequest, "date"> {
  /** Shift date; resolved from the source row when the producer does not have it at hand. */
  date?: string | Date | null;
}

export interface RaiseDeps {
  db: Exec;
  notify: (req: RaisedRequest) => Promise<void>;
  autoApprove: (kind: RequestKind, id: string) => void;
}

/** Loads the auto-approve module on first use and runs maybeAutoApprove; never throws. */
export function scheduleAutoApprove(kind: RequestKind, id: string): void {
  if (!AUTO_APPROVABLE_KINDS.includes(kind)) return;
  import("./roster-requests.auto.js")
    .then((m) => m.triggerAutoApprove(kind, id))
    .catch((err) => console.error("[roster-requests] auto-approve trigger failed:", (err as Error)?.message));
}

const defaultDeps: RaiseDeps = { db: defaultDb as any, notify: (r) => notifyApproversOfRequest(r), autoApprove: scheduleAutoApprove };

const day = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);

const DATE_LOOKUP: Record<RequestKind, string> = {
  swap: "SELECT DATE_FORMAT(swap_date, '%Y-%m-%d') AS d FROM wfm_roster_swap_request WHERE id = ? LIMIT 1",
  weekoff_rejection: "SELECT DATE_FORMAT(roster_date, '%Y-%m-%d') AS d FROM wfm_roster_assignment WHERE id = ? LIMIT 1",
  dispute: "SELECT DATE_FORMAT(roster_date, '%Y-%m-%d') AS d FROM roster_daily_assignment WHERE id = ? LIMIT 1",
  conflict: "SELECT DATE_FORMAT(conflict_date, '%Y-%m-%d') AS d FROM wfm_roster_conflict_log WHERE id = ? LIMIT 1",
};

export async function raiseRosterRequest(input: RaiseInput, deps: RaiseDeps = defaultDeps): Promise<void> {
  try {
    let date = input.date ? day(input.date) : "";
    if (!date) {
      const [rows] = await deps.db.execute(DATE_LOOKUP[input.kind], [input.sourceId]);
      date = String((rows as RowDataPacket[])[0]?.d ?? "");
    }
    await deps.notify({ ...input, date });
    if (AUTO_APPROVABLE_KINDS.includes(input.kind)) deps.autoApprove(input.kind, input.sourceId);
  } catch (err) {
    console.error("[roster-requests] raise hook failed (request already recorded):", { kind: input.kind, id: input.sourceId, err: (err as Error)?.message });
  }
}

/** Fire-and-forget entry point for the producers. */
export function onRosterRequestRaised(input: RaiseInput): void {
  setImmediate(() => {
    void raiseRosterRequest(input);
  });
}
