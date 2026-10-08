/**
 * Unified decision path for the Roster Requests hub: applies one manager decision to any of the
 * four request kinds by REUSING the existing per-kind logic, never a copy of it:
 *
 *   swap              -> rosterSwapService.review (transactional apply; notifies requester + counterpart)
 *   conflict          -> rosterConflictService.resolve (notifies the employee)
 *   weekoff_rejection -> weekoff-review.service (transactional; notifies, except escalate)
 *   dispute           -> dispute-resolution.service resolveDispute (notifies the employee)
 *
 * Steps: validate -> status pre-check (weekoff/dispute) -> impact + blocker gate -> apply ->
 * decision log -> close approver inbox items -> notify (only where the service does not).
 *
 * Transactions: the existing services own their transactions. Where the service exposes one
 * (week-off), the decision log is written inside it. For the others the log is written right after
 * the service commits; a failure there is logged loudly but does not turn a committed decision into
 * an error (the services already write their own audit rows: logSensitiveAction / roster_decision_audit).
 */
import type { Request } from "express";
import { db as defaultDb } from "../../db/mysql.js";
import { hasRole as defaultHasRole } from "../../shared/accessGuard.js";
import { rosterSwapService, rosterConflictService } from "../wfm-extensions/wfm-ext.service.js";
import { employeeScope } from "../wfm-extensions/employee-scope.js";
import {
  forceApproveWeekoff,
  rejectWeekoffRequest,
  realignWeekoff,
  escalateWeekoff,
  type WeekoffReviewParams,
  type WeekoffReviewResult,
} from "../wfm/weekoff-review.service.js";
import { resolveDispute as defaultResolveDispute } from "../roster/dispute-resolution.service.js";
import { computeImpact as defaultComputeImpact, type ImpactCandidate } from "./roster-requests.impact.js";
import { logDecision as defaultLogDecision } from "./roster-requests.decision-log.js";
import { notifyRosterRequest as defaultNotify } from "./roster-requests.notify.js";
import {
  AUTO_APPROVABLE_KINDS,
  REQUEST_KINDS,
  SYSTEM_AUTO_APPROVE_ACTOR,
  type DecideInput,
  type DecideResult,
  type DecisionAction,
  type ImpactResult,
  type RequestKind,
} from "./roster-requests.types.js";

type Exec = { execute: (sql: string, params?: unknown[]) => Promise<any> };
type WeekoffFn = (p: WeekoffReviewParams) => Promise<WeekoffReviewResult>;

export const ALLOWED_ACTIONS: Readonly<Record<RequestKind, readonly DecisionAction[]>> = {
  swap: ["approve", "reject"],
  // approve = force-approve, reject = reject-request
  weekoff_rejection: ["approve", "reject", "realign", "escalate"],
  // approve = resolve and apply newShiftTemplateId if given; reject = resolve keeping the original shift
  dispute: ["approve", "reject"],
  // approve = resolve; reason is the resolution action text
  conflict: ["approve"],
};

export interface DecideActor {
  /** null only for an auto-approve-rule decision (auto: true). */
  userId: string | null;
  /** Decision taken by an auto-approve rule: approve only, swap / week-off only. */
  auto?: boolean;
  req?: Request;
}

export interface DecideDeps {
  db: Exec;
  computeImpact: (kind: RequestKind, id: string, candidate?: ImpactCandidate) => Promise<ImpactResult>;
  logDecision: typeof defaultLogDecision;
  notifyRosterRequest: typeof defaultNotify;
  hasRole: (userId: string, ...roles: string[]) => Promise<boolean>;
  swapReview: typeof rosterSwapService.review;
  conflictResolve: typeof rosterConflictService.resolve;
  conflictScope: (userId: string) => Promise<{ sql: string; params: unknown[] }>;
  weekoff: { approve: WeekoffFn; reject: WeekoffFn; realign: WeekoffFn; escalate: WeekoffFn };
  resolveDispute: typeof defaultResolveDispute;
}

const defaultDeps: DecideDeps = {
  db: defaultDb as any,
  computeImpact: (kind, id, candidate) => defaultComputeImpact(kind, id, undefined, candidate),
  logDecision: defaultLogDecision,
  notifyRosterRequest: defaultNotify,
  hasRole: defaultHasRole,
  swapReview: (...args) => rosterSwapService.review(...args),
  conflictResolve: (...args) => rosterConflictService.resolve(...args),
  conflictScope: (userId) => employeeScope(userId),
  weekoff: { approve: forceApproveWeekoff, reject: rejectWeekoffRequest, realign: realignWeekoff, escalate: escalateWeekoff },
  resolveDispute: defaultResolveDispute,
};

const httpError = (statusCode: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { statusCode, ...extra });

const REASON_REQUIRED_ACTIONS: readonly DecisionAction[] = ["reject", "realign", "escalate"];
const REASON_REQUIRED_KINDS: readonly RequestKind[] = ["dispute", "conflict"];
// Week-off rejections stay decidable after an escalation (HR/WFM acts on them); escalating twice is not allowed.
const WEEKOFF_DECIDABLE = ["pending_manager_action", "escalated_to_hr"];

const isRestBlocker = (b: string) => /^Insufficient rest/i.test(b);
const day = (v: unknown) => String(v instanceof Date ? v.toISOString() : v ?? "").slice(0, 10);

/**
 * Status pre-check for the kinds whose underlying service re-applies on repeat (week-off, dispute);
 * swap and conflict services already refuse an already-processed request with 409.
 */
async function assertStillPending(
  kind: RequestKind,
  id: string,
  action: DecisionAction,
  d: DecideDeps,
): Promise<{ employeeId: string | null; date: string | null }> {
  if (kind === "weekoff_rejection") {
    const [rows] = await d.db.execute(
      "SELECT employee_id, roster_date, final_roster_status FROM wfm_roster_assignment WHERE id = ? LIMIT 1",
      [id],
    );
    const row = (rows as any[])[0];
    if (!row) throw httpError(404, "Roster request not found");
    const allowed = action === "escalate" ? ["pending_manager_action"] : WEEKOFF_DECIDABLE;
    if (!allowed.includes(String(row.final_roster_status))) {
      throw httpError(409, "Request not found, or already processed");
    }
    return { employeeId: row.employee_id ?? null, date: day(row.roster_date) };
  }
  if (kind === "dispute") {
    const [rows] = await d.db.execute(
      "SELECT employee_id, roster_date, acknowledgement_status, dispute_resolved_at FROM roster_daily_assignment WHERE id = ? LIMIT 1",
      [id],
    );
    const row = (rows as any[])[0];
    if (!row) throw httpError(404, "Roster request not found");
    if (row.acknowledgement_status !== "disputed" || row.dispute_resolved_at != null) {
      throw httpError(409, "Request not found, or already processed");
    }
    return { employeeId: row.employee_id ?? null, date: day(row.roster_date) };
  }
  return { employeeId: null, date: null };
}

export async function decideRosterRequest(
  kind: RequestKind,
  id: string,
  input: DecideInput,
  actor: DecideActor,
  deps: DecideDeps = defaultDeps,
): Promise<DecideResult> {
  const d = deps;
  // 1) validate
  if (!(REQUEST_KINDS as readonly string[]).includes(kind)) throw httpError(400, "Unsupported request kind");
  const action = input?.action;
  if (!ALLOWED_ACTIONS[kind].includes(action)) {
    throw httpError(400, `Action '${String(action)}' is not supported for ${kind}; allowed: ${ALLOWED_ACTIONS[kind].join(", ")}`);
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const reasonRequired = REASON_REQUIRED_ACTIONS.includes(action) || REASON_REQUIRED_KINDS.includes(kind)
    // week-off force-approve has always required a reason at the existing endpoint
    || kind === "weekoff_rejection";
  if (reasonRequired && !reason) throw httpError(400, "reason is required");
  const isAuto = actor.auto === true;
  if (isAuto && (action !== "approve" || !AUTO_APPROVABLE_KINDS.includes(kind))) {
    throw httpError(400, `Auto-approve cannot ${action} a ${kind} request`);
  }
  if (!isAuto && !actor.userId) throw httpError(400, "A deciding user is required");
  // The id the underlying services record as reviewer. See SYSTEM_AUTO_APPROVE_ACTOR.
  const serviceUserId: string = isAuto ? SYSTEM_AUTO_APPROVE_ACTOR : (actor.userId as string);
  const restOverrideReason = typeof input.restOverrideReason === "string" ? input.restOverrideReason.trim() : "";

  const subject = await assertStillPending(kind, id, action, d);

  // 2) impact + blocker gate (reject / escalate are never blocked)
  // A dispute approve that moves the employee to a new shift is judged on that NEW shift.
  const newShiftTemplateId = kind === "dispute" && action === "approve" ? input.newShiftTemplateId || undefined : undefined;
  const impact = newShiftTemplateId
    ? await d.computeImpact(kind, id, { shiftTemplateId: newShiftTemplateId })
    : await d.computeImpact(kind, id);
  if (action === "approve" || action === "realign") {
    // A swap or dispute with a rest-override reason goes to its service, which applies the same
    // override policy (canOverride + REST_POLICY_MISSING); every other blocker stops here.
    const blocking = (kind === "swap" || kind === "dispute") && restOverrideReason
      ? impact.blockers.filter((b) => !isRestBlocker(b))
      : impact.blockers;
    if (blocking.length) throw httpError(409, `Cannot ${action}: ${blocking.join("; ")}`, { impact });
  }

  const logEntry = (after: unknown) => ({
    kind,
    sourceId: id,
    action,
    actorUserId: isAuto ? null : actor.userId,
    auto: isAuto,
    reason: reason || restOverrideReason || null,
    before: impact,
    after,
  });
  const logAfterCommit = async (after: unknown) => {
    try {
      await d.logDecision(logEntry(after), d.db);
    } catch (err) {
      console.error("[roster-requests] decision log write failed (decision already applied):", { kind, id, action, err });
    }
  };

  // 3) apply via the existing service, 4) decision log
  let applied = true;
  let notifyHere: { title: string; description: string } | null = null;

  if (kind === "swap") {
    const wantsForce = input.forceWithoutCounterpartAcceptance === true;
    // Same rule as POST /roster/swaps/:id/review: force is honoured for admin/hr only.
    // An auto decision never forces past a missing counterpart acceptance.
    const forceWithoutCounterpartAcceptance = !isAuto && wantsForce && (await d.hasRole(serviceUserId, "admin", "hr"));
    const result: any = await d.swapReview(id, action === "approve" ? "approved" : "rejected", serviceUserId, actor.req, {
      forceWithoutCounterpartAcceptance,
      restOverrideReason: restOverrideReason || undefined,
    });
    applied = !!result?.applied;
    await logAfterCommit(result);
  } else if (kind === "conflict") {
    const scope = await d.conflictScope(serviceUserId);
    await d.conflictResolve(id, serviceUserId, { resolution_action: reason, resolution_remarks: null, scope }, actor.req);
    await logAfterCommit({ resolved: true, resolution_action: reason });
  } else if (kind === "dispute") {
    const result = await d.resolveDispute({
      assignmentId: id,
      userId: serviceUserId,
      resolution: reason,
      newShiftTemplateId,
      restOverrideReason: restOverrideReason || undefined,
      req: actor.req,
    });
    await logAfterCommit(result);
  } else {
    const body: WeekoffReviewParams["body"] = { reason };
    if (action === "realign") {
      body.new_roster_date = input.newDate || undefined;
      body.new_shift_template_id = input.newShiftTemplateId || undefined;
    }
    const finalStatus: Record<DecisionAction, string> = {
      approve: "force_approved_by_manager",
      reject: "manager_rejected_employee_request",
      realign: "realigned_by_manager",
      escalate: "escalated_to_hr",
    };
    await d.weekoff[action]({
      assignmentId: id,
      userId: serviceUserId,
      body,
      req: actor.req,
      ...(isAuto ? { systemActor: true as const } : {}),
      // Written inside the week-off decision transaction: the decision and its log commit together.
      onTx: (tx) => d.logDecision(logEntry({ finalRosterStatus: finalStatus[action], ...body }), tx),
    });
    if (action === "escalate") {
      // escalateWeekoff deliberately does not notify (it is still awaiting a human); the hub tells
      // the employee their request moved on, so every decision produces exactly one notification.
      notifyHere = {
        title: "Week-off request escalated",
        description: `Your week-off request${subject.date ? ` for ${subject.date}` : ""} was escalated to HR/WFM for review.`,
      };
    }
  }

  // 5) close approver inbox items (producer arrives in a later task) — non-fatal, decision is committed
  try {
    await d.db.execute(
      "UPDATE work_inbox_item SET is_actioned = 1 WHERE entity_type = ? AND entity_id = ? AND is_actioned = 0",
      [`roster_request_pending:${kind}`, id],
    );
  } catch (err) {
    console.error("[roster-requests] failed to close approver inbox items:", { kind, id, err });
  }

  // 6) notify — only where the underlying service does not already (notifyRosterRequest is non-fatal)
  if (notifyHere) {
    const employeeIds = subject.employeeId ? [subject.employeeId] : impact.week.map((w) => w.employeeId);
    await d.notifyRosterRequest({ employeeIds, kind, sourceId: id, ...notifyHere }, d.db);
  }

  return { ok: true, kind, id, action, applied };
}
