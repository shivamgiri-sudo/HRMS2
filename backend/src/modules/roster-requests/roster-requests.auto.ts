/**
 * Auto-approve (opt-in per process, default OFF): a routine, rule-clean request is approved by the
 * process's roster_request_auto_rule instead of waiting for a manager.
 *
 * Eligible ONLY when all of these hold:
 *  - the kind is swap or weekoff_rejection (disputes and conflicts always need a human);
 *  - the request is still pending (swap 'pending'; week-off 'pending_manager_action' — once escalated
 *    to HR it is HR's call);
 *  - the employee's process has an ENABLED rule for the kind;
 *  - the shift date is strictly in the future (IST);
 *  - swap: the counterpart accepted (see the counterpart note in evaluateAutoApprove);
 *  - computeImpact reports zero blockers, zero warnings and the date is not payroll-locked;
 *  - the coverage drop the change causes is within max_coverage_drop (always 0 today, see below).
 *
 * The decision goes through decideRosterRequest with actor { userId: null, auto: true }: the hub's
 * decision log records actor NULL + auto=1, and the services record SYSTEM_AUTO_APPROVE_ACTOR.
 *
 * Triggers: on raise (roster-requests.raise.ts, after the approver notification), after a swap
 * counterpart accepts (rosterSwapService.respond), and the 5-minute sweep (roster-requests.cron.ts)
 * that catches anything the event triggers missed.
 */
import type { RowDataPacket } from "mysql2";
import { db as defaultDb } from "../../db/mysql.js";
import { getIstDateString } from "../../utils/dateUtils.js";
import { getAutoRule as defaultGetAutoRule, type AutoRule } from "./roster-requests.auto-rule.js";
import { computeImpact as defaultComputeImpact } from "./roster-requests.impact.js";
import { decideRosterRequest, type DecideActor } from "./roster-requests.decide.js";
import { notifyApproversAutoApproved, type RaisedRequest } from "./roster-requests.notify.js";
import {
  AUTO_APPROVABLE_KINDS,
  type DecideInput,
  type DecideResult,
  type ImpactResult,
  type RequestKind,
} from "./roster-requests.types.js";

type Exec = { execute: (sql: string, params?: unknown[]) => Promise<any> };

export interface AutoDeps {
  db: Exec;
  getAutoRule: (processId: string, kind: RequestKind) => Promise<AutoRule>;
  computeImpact: (kind: RequestKind, id: string) => Promise<ImpactResult>;
  decide: (kind: RequestKind, id: string, input: DecideInput, actor: DecideActor) => Promise<DecideResult>;
  notifyAutoApproved: (req: RaisedRequest) => Promise<void>;
  /** Today's date in IST, YYYY-MM-DD. */
  today: () => string;
}

const defaultDeps: AutoDeps = {
  db: defaultDb as any,
  getAutoRule: (processId, kind) => defaultGetAutoRule(processId, kind),
  computeImpact: (kind, id) => defaultComputeImpact(kind, id),
  decide: (kind, id, input, actor) => decideRosterRequest(kind, id, input, actor),
  notifyAutoApproved: (req) => notifyApproversAutoApproved(req),
  today: () => getIstDateString(),
};

export const AUTO_APPROVE_REASON = "Auto-approved by rule";
const SWEEP_LIMIT = 200;

export interface AutoEvaluation {
  eligible: boolean;
  reason: string;
}

interface Subject {
  pending: boolean;
  employeeId: string;
  date: string;
  processId: string | null;
  branchId: string | null;
  /** Swap only. undefined when the counterpart_status column (migration 1212) is absent. */
  counterpartStatus?: string | null;
}

async function loadSubject(kind: RequestKind, id: string, d: AutoDeps): Promise<Subject | null> {
  if (kind === "swap") {
    const [rows] = await d.db.execute(
      `SELECT s.*, DATE_FORMAT(s.swap_date, '%Y-%m-%d') AS d, e.process_id, e.branch_id
         FROM wfm_roster_swap_request s
         JOIN employees e ON e.id = s.requester_emp_id
        WHERE s.id = ? LIMIT 1`,
      [id],
    );
    const r = (rows as RowDataPacket[])[0];
    if (!r) return null;
    return {
      pending: r.status === "pending",
      employeeId: String(r.requester_emp_id),
      date: String(r.d),
      processId: r.process_id ?? null,
      branchId: r.branch_id ?? null,
      counterpartStatus: r.counterpart_status,
    };
  }
  const [rows] = await d.db.execute(
    `SELECT wra.employee_id, wra.final_roster_status, DATE_FORMAT(wra.roster_date, '%Y-%m-%d') AS d,
            e.process_id, e.branch_id
       FROM wfm_roster_assignment wra
       JOIN employees e ON e.id = wra.employee_id
      WHERE wra.id = ? LIMIT 1`,
    [id],
  );
  const r = (rows as RowDataPacket[])[0];
  if (!r) return null;
  return {
    pending: r.final_roster_status === "pending_manager_action",
    employeeId: String(r.employee_id),
    date: String(r.d),
    processId: r.process_id ?? null,
    branchId: r.branch_id ?? null,
  };
}

const no = (reason: string): AutoEvaluation => ({ eligible: false, reason });

/**
 * Coverage drop the decision causes on the shift date, in headcount. A swap exchanges two shifts on
 * the same day (net 0); approving a rejected week-off keeps / puts the employee on shift (never a
 * drop). So max_coverage_drop cannot gate anything yet — it is validated and stored now and will
 * gate the kinds that CAN remove headcount (e.g. granting a week-off or leave-driven changes) once
 * those become auto-approvable.
 */
function coverageDrop(_kind: RequestKind, _impact: ImpactResult): number {
  return 0;
}

export async function evaluateAutoApprove(kind: RequestKind, id: string, deps: AutoDeps = defaultDeps): Promise<AutoEvaluation> {
  if (!AUTO_APPROVABLE_KINDS.includes(kind)) return no(`${kind} requests are never auto-approved`);
  const s = await loadSubject(kind, id, deps);
  if (!s) return no("Request not found");
  if (!s.pending) return no("Request is no longer pending");
  if (!s.processId) return no("Employee has no process, so no auto-approve rule applies");

  const rule = await deps.getAutoRule(s.processId, kind);
  if (!rule.enabled) return no("Auto-approve rule is disabled for this process");

  if (!(s.date > deps.today())) return no("Shift date is not in the future");

  if (kind === "swap") {
    // The swap service itself refuses an approval without counterpart acceptance unless an admin/hr
    // forces it, and an auto decision never forces. So whenever acceptance is tracked (the column
    // exists) it is required regardless of the rule; require_counterpart_accept=false only relaxes
    // the check on a database without counterpart tracking.
    const cs = s.counterpartStatus;
    if (cs === undefined) {
      if (rule.requireCounterpartAccept) return no("Counterpart acceptance is required but not tracked on this database");
    } else if (cs !== "accepted") {
      return no(`Counterpart has not accepted (status: ${cs ?? "unknown"})`);
    }
  }

  const impact = await deps.computeImpact(kind, id);
  if (impact.locked) return no("Roster date is locked for payroll");
  if (impact.blockers.length) return no(`Has blockers: ${impact.blockers.join("; ")}`);
  if (impact.warnings.length) return no(`Has warnings: ${impact.warnings.join("; ")}`);
  const drop = coverageDrop(kind, impact);
  if (drop > rule.maxCoverageDrop) return no(`Coverage drop ${drop} exceeds the allowed ${rule.maxCoverageDrop}`);

  return { eligible: true, reason: "All auto-approve conditions met" };
}

export interface AutoRunResult {
  approved: boolean;
  reason: string;
}

export async function runAutoApprove(kind: RequestKind, id: string, deps: AutoDeps = defaultDeps): Promise<AutoRunResult> {
  const evaluation = await evaluateAutoApprove(kind, id, deps);
  if (!evaluation.eligible) return { approved: false, reason: evaluation.reason };
  // Load the subject before deciding: the FYI needs the employee / date of the request.
  const s = await loadSubject(kind, id, deps);
  try {
    await deps.decide(kind, id, { action: "approve", reason: AUTO_APPROVE_REASON }, { userId: null, auto: true });
  } catch (err) {
    // e.g. 409: a manager decided it in the meantime, or the service's own checks refused.
    return { approved: false, reason: String((err as Error)?.message ?? "Decision refused") };
  }
  if (s) {
    await deps.notifyAutoApproved({
      kind,
      sourceId: id,
      employeeId: s.employeeId,
      date: s.date,
      processId: s.processId,
      branchId: s.branchId,
      summary: kind === "swap" ? "Shift swap" : "Rejected week-off",
    });
  }
  return { approved: true, reason: evaluation.reason };
}

// One evaluation per request at a time in this process: the raise hook, the respond hook and the
// sweep can all reach the same request together.
const inFlight = new Set<string>();

/** Non-throwing wrapper for the triggers. */
export async function maybeAutoApprove(kind: RequestKind, id: string, deps: AutoDeps = defaultDeps): Promise<AutoRunResult> {
  const key = `${kind}:${id}`;
  if (inFlight.has(key)) return { approved: false, reason: "Already being evaluated" };
  inFlight.add(key);
  try {
    const r = await runAutoApprove(kind, id, deps);
    if (r.approved) console.log(`[roster-requests] auto-approved ${kind} ${id}`);
    return r;
  } catch (err) {
    console.error("[roster-requests] auto-approve evaluation failed:", { kind, id, err: (err as Error)?.message });
    return { approved: false, reason: "Evaluation failed" };
  } finally {
    inFlight.delete(key);
  }
}

/** Fire-and-forget trigger for request paths: never awaited, never throws. */
export function triggerAutoApprove(kind: RequestKind, id: string): void {
  if (!AUTO_APPROVABLE_KINDS.includes(kind)) return;
  setImmediate(() => {
    void maybeAutoApprove(kind, id);
  });
}

/** Cron sweep: pending swaps / week-off rejections, future-dated, whose process has an enabled rule. */
export async function sweepAutoApprove(deps: AutoDeps = defaultDeps): Promise<{ checked: number; approved: number }> {
  // Every rule is default-off, so on most ticks there is nothing to do: one COUNT on the tiny rule
  // table (one row per process and kind at most) instead of the two candidate scans below.
  const [ruleRows] = await deps.db.execute(
    `SELECT COUNT(*) AS n FROM roster_request_auto_rule WHERE enabled = 1`,
  );
  if (Number((ruleRows as RowDataPacket[])[0]?.n ?? 0) === 0) return { checked: 0, approved: 0 };
  const today = deps.today();
  const [swaps] = await deps.db.execute(
    `SELECT s.id
       FROM wfm_roster_swap_request s
       JOIN employees e ON e.id = s.requester_emp_id
       JOIN roster_request_auto_rule r ON r.process_id = e.process_id AND r.kind = 'swap' AND r.enabled = 1
      WHERE s.status = 'pending' AND s.swap_date > ?
      ORDER BY s.swap_date ASC
      LIMIT ${SWEEP_LIMIT}`,
    [today],
  );
  const [weekoffs] = await deps.db.execute(
    `SELECT wra.id
       FROM wfm_roster_assignment wra
       JOIN employees e ON e.id = wra.employee_id
       JOIN roster_request_auto_rule r ON r.process_id = e.process_id AND r.kind = 'weekoff_rejection' AND r.enabled = 1
      WHERE wra.final_roster_status = 'pending_manager_action' AND wra.roster_date > ?
      ORDER BY wra.roster_date ASC
      LIMIT ${SWEEP_LIMIT}`,
    [today],
  );
  const candidates: Array<[RequestKind, string]> = [
    ...(swaps as RowDataPacket[]).map((r): [RequestKind, string] => ["swap", String(r.id)]),
    ...(weekoffs as RowDataPacket[]).map((r): [RequestKind, string] => ["weekoff_rejection", String(r.id)]),
  ];
  let approved = 0;
  for (const [kind, id] of candidates) {
    if ((await maybeAutoApprove(kind, id, deps)).approved) approved++;
  }
  return { checked: candidates.length, approved };
}
