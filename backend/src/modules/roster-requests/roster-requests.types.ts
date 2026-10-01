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
