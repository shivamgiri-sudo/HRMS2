/**
 * What the branch head may do on the review page, and why not when they can't. Pure so the rules
 * are unit-tested; the server enforces the same ones (employee-reactivation.routes.ts branch-action),
 * this only stops a doomed submit and tells the user what is missing.
 */
import type { RehireVerdict } from "./rejoinTypes";

export const MIN_REMARKS = 5;
/** Backend rule for approving an absconder: acknowledgement ticked and remarks of at least 20 characters. */
export const MIN_ABSCONDING_REMARKS = 20;

/**
 * Statuses still waiting for the branch head's decision. 'branch_head_approved' is a legacy status: the
 * old two-step flow parked requests there for an HR confirmation that was removed, so the branch head
 * makes the final decision on them (the server's branch-action accepts both).
 */
export const AWAITING_BRANCH_HEAD_STATUSES = ["pending", "branch_head_approved"] as const;

export function isAwaitingBranchHead(status: string | null | undefined): boolean {
  return (AWAITING_BRANCH_HEAD_STATUSES as readonly string[]).includes(String(status ?? ""));
}

export interface DecisionInput {
  requestStatus: string;
  eligibility: Pick<RehireVerdict, "status" | "reasons" | "requiresAbscondingAck">;
  remarks: string;
  abscondingAcknowledged: boolean;
}

export interface DecisionState {
  canApprove: boolean;
  canReject: boolean;
  /** Why Approve is disabled; null when it is enabled. */
  approveReason: string | null;
  /** Why Reject is disabled; null when it is enabled. */
  rejectReason: string | null;
  /** The absconding acknowledgement checkbox must be shown. */
  needsAck: boolean;
  /** Remarks length that unlocks Approve (Reject always needs MIN_REMARKS). */
  approveMinRemarks: number;
}

export function decide(input: DecisionInput): DecisionState {
  const needsAck = input.eligibility.requiresAbscondingAck === true;
  const approveMinRemarks = needsAck ? MIN_ABSCONDING_REMARKS : MIN_REMARKS;
  const len = input.remarks.trim().length;

  if (!isAwaitingBranchHead(input.requestStatus)) {
    const why = "This request is no longer pending, so it cannot be actioned.";
    return { canApprove: false, canReject: false, approveReason: why, rejectReason: why, needsAck, approveMinRemarks };
  }

  const rejectReason = len < MIN_REMARKS ? `Remarks need at least ${MIN_REMARKS} characters (${len}/${MIN_REMARKS}).` : null;

  let approveReason: string | null = null;
  if (input.eligibility.status === "blocked") {
    const first = input.eligibility.reasons.find((r) => r.severity === "blocked");
    approveReason = `Rejoin is blocked${first ? `: ${first.message}` : "."} You can still reject.`;
  } else if (needsAck && !input.abscondingAcknowledged) {
    approveReason = "This employee absconded: tick the acknowledgement to approve.";
  } else if (len < approveMinRemarks) {
    approveReason = needsAck
      ? `Absconding case: remarks need at least ${MIN_ABSCONDING_REMARKS} characters to approve (${len}/${MIN_ABSCONDING_REMARKS}).`
      : `Remarks need at least ${MIN_REMARKS} characters (${len}/${MIN_REMARKS}).`;
  }

  return {
    canApprove: approveReason === null,
    canReject: rejectReason === null,
    approveReason,
    rejectReason,
    needsAck,
    approveMinRemarks,
  };
}
