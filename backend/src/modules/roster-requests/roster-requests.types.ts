export type RequestKind = "swap" | "weekoff_rejection" | "dispute" | "conflict";
export const REQUEST_KINDS: readonly RequestKind[] = ["swap", "weekoff_rejection", "dispute", "conflict"];

export type SlaState = "ok" | "due_soon" | "overdue" | "urgent";

export interface ImpactResult {
  kind: RequestKind;
  id: string;
  blockers: string[];
  warnings: string[];
  locked: boolean;
  rest: Array<{ employeeId: string; ok: boolean; message: string | null }>;
  sameDayHeadcount: { date: string; processName: string | null; planned: number } | null;
  week: Array<{ employeeId: string; days: Array<{ date: string; shiftName: string | null; isWeekOff: boolean }> }>;
}

export type DecisionAction = "approve" | "reject" | "realign" | "escalate";

export interface DecideInput {
  action: DecisionAction;
  reason?: string;
  newDate?: string;
  newShiftTemplateId?: string;
  restOverrideReason?: string;
  forceWithoutCounterpartAcceptance?: boolean;
}

export interface DecideResult {
  ok: true;
  kind: RequestKind;
  id: string;
  action: DecisionAction;
  /** Swap: the swap service's own `applied` flag. Other kinds: true once the decision is committed. */
  applied: boolean;
}

/**
 * Actor id written into the underlying services' reviewer columns (wfm_roster_swap_request.reviewed_by,
 * wfm_roster_assignment.manager_action_by, roster_decision_audit.override_by, sensitive_action_log.actor_user_id)
 * when an auto-approve rule decides. None of those columns has a foreign key to users (same convention
 * as the "system" actor used by exitAutoAdvance.cron.ts), and the spec names this exact value. The hub's
 * own roster_request_decision_log records actor_user_id = NULL with auto = 1 instead.
 */
export const SYSTEM_AUTO_APPROVE_ACTOR = "system:auto-approve";

/** Kinds an auto-approve rule may decide. Disputes and conflicts always need a human. */
export const AUTO_APPROVABLE_KINDS: readonly RequestKind[] = ["swap", "weekoff_rejection"];
