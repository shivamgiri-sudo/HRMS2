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

/**
 * Conflict coalescing. Conflicts are raised in bulk (auto-roster sync logs one per problem cell), which would
 * flood approvers. Per branch (else process) the FIRST conflict in a 10-minute window notifies normally; later
 * ones in the window are suppressed and counted, and when the window closes ONE summary notification with the
 * count is sent. In-memory and per process: a restart or another instance simply opens a fresh window.
 * Conflicts whose branch/process cannot be resolved are not coalesced.
 */
export const CONFLICT_COALESCE_WINDOW_MS = 10 * 60_000;
interface ConflictBucket { suppressed: number; last: RaisedRequest | null; timer: ReturnType<typeof setTimeout> }
const conflictBuckets = new Map<string, ConflictBucket>();

export function resetConflictCoalescing(): void {
  for (const b of conflictBuckets.values()) clearTimeout(b.timer);
  conflictBuckets.clear();
}

async function conflictKey(input: RaiseInput, db: Exec): Promise<string | null> {
  let branchId = input.branchId ?? null;
  let processId = input.processId ?? null;
  if (!branchId && !processId) {
    const [rows] = await db.execute("SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1", [input.employeeId]);
    const row = (rows as RowDataPacket[] | undefined)?.[0];
    branchId = row?.branch_id ?? null;
    processId = row?.process_id ?? null;
  }
  return branchId ? `branch:${branchId}` : processId ? `process:${processId}` : null;
}

/** Returns true when this conflict was absorbed into an open window (caller must not notify). */
async function coalesceConflict(req: RaisedRequest, input: RaiseInput, deps: RaiseDeps): Promise<boolean> {
  const key = await conflictKey(input, deps.db);
  if (!key) return false;
  const open = conflictBuckets.get(key);
  if (open) {
    open.suppressed += 1;
    open.last = req;
    return true;
  }
  const timer = setTimeout(() => {
    const b = conflictBuckets.get(key);
    conflictBuckets.delete(key);
    if (b?.suppressed && b.last) {
      void deps
        .notify({ ...b.last, summary: `${b.suppressed} more roster conflicts raised in the last 10 minutes (latest: ${b.last.summary})` })
        .catch((err) => console.error("[roster-requests] conflict summary notification failed:", (err as Error)?.message));
    }
  }, CONFLICT_COALESCE_WINDOW_MS);
  (timer as { unref?: () => void }).unref?.();
  conflictBuckets.set(key, { suppressed: 0, last: null, timer });
  return false;
}

export async function raiseRosterRequest(input: RaiseInput, deps: RaiseDeps = defaultDeps): Promise<void> {
  try {
    let date = input.date ? day(input.date) : "";
    if (!date) {
      const [rows] = await deps.db.execute(DATE_LOOKUP[input.kind], [input.sourceId]);
      date = String((rows as RowDataPacket[])[0]?.d ?? "");
    }
    const req: RaisedRequest = { ...input, date };
    if (input.kind === "conflict" && (await coalesceConflict(req, input, deps))) return;
    await deps.notify(req);
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
