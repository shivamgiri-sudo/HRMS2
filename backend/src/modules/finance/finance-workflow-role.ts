const STAGED_ROLES = ["branch_head", "finance_head", "accounts_head"] as const;

export type FinanceStageRole = (typeof STAGED_ROLES)[number];

function normalizedRoles(primaryRole?: string | null, userRoles: string[] = []) {
  return new Set(
    [primaryRole, ...userRoles]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
  );
}

/**
 * Resolves the role that owns the current workflow stage from every role assigned
 * to the authenticated user. Super Admin may execute the action, but the audit and
 * state transition still use the role that owns that exact approval stage.
 */
export function resolveFinanceStageRole(input: {
  primaryRole?: string | null;
  userRoles?: string[];
  currentStatus: string;
  workflow: "budget" | "grn";
}): FinanceStageRole {
  const roles = normalizedRoles(input.primaryRole, input.userRoles ?? []);
  // Both workflows are the same 2-stage shape today: the Accounts Head stage was removed from
  // the budget header workflow (owner decision, 2026-08-21) — REVIEW_STAGES in
  // branch-budget.service.ts no longer has a 'finance_head_approved' resting stage, Finance Head
  // approval goes straight to 'active'. Kept as one shared ternary rather than two identical ones.
  const expectedRole = input.currentStatus === "submitted"
    ? "branch_head"
    : input.currentStatus === "branch_head_approved"
      ? "finance_head"
      : null;

  /*
   * Both refusals carry a status. Without one, errorHandler.ts treats them as unexpected 500s
   * and, in production, REPLACES the message with "An unexpected server error occurred. Please
   * quote reference <hex>". Every caller here is a reviewer pressing Approve or Reject, so the
   * two things they most need to be told — this stage is not yours, and this row is past the
   * point where anyone can act — were the two things they could never see.
   *
   * The live case: accounts_head is in TOPUP_REVIEW_ROLES, so requireRole lets them through to
   * a top-up's Approve button, but no top-up stage maps to accounts_head. They got the
   * anonymous reference every time instead of "this stage requires the finance_head role".
   *
   * 409 for a status with no stage (the row's state forbids it), 403 for a role that owns no
   * stage here — the same split budget-topup.service.ts already documents.
   */
  if (!expectedRole) {
    throw Object.assign(
      new Error(`No approval role is valid for ${input.workflow} status ${input.currentStatus}`),
      { statusCode: 409, code: "WORKFLOW_NO_STAGE_FOR_STATUS" }
    );
  }
  if (!roles.has(expectedRole) && !roles.has("super_admin")) {
    throw Object.assign(
      new Error(`The current ${input.workflow} stage requires the ${expectedRole} role`),
      { statusCode: 403, code: "WORKFLOW_WRONG_STAGE_ROLE" }
    );
  }
  return expectedRole;
}

/** How a stage owner reads on screen. */
const STAGE_LABELS: Record<FinanceStageRole, string> = {
  branch_head: "Branch Head",
  finance_head: "Finance Head",
  accounts_head: "Accounts Head",
};

export type PendingWith = {
  /** The role that owes the next action, or null when nobody does. */
  role: FinanceStageRole | null;
  /** Display text, including terminal states — never blank. */
  label: string;
  /** True while the item is still waiting on someone. */
  isPending: boolean;
};

/**
 * Who a request is waiting on, for display (Requirement 1).
 *
 * Separate from resolveFinanceStageRole, and deliberately NOT a relaxation of it. That
 * function throws for a status with no valid stage, and that throw is an authorisation
 * check — softening it so a list could render would turn a security guard into a label
 * formatter. This one answers a different question ("who owes the next move?"), never
 * throws, and is safe to call for every row in a list.
 *
 * Nothing is stored. Pending-with is a pure function of status, so a column would be a second
 * source of truth that could drift from the status it describes.
 */
export function resolvePendingWith(
  currentStatus: string,
  // Unused now that budget and top-up both resolve 'finance_head_approved' the same way
  // (terminal/legacy, not a pending stage) — kept in the signature so every existing call site
  // that passes workflow does not need to change, and in case the workflows diverge again later.
  _workflow: "budget" | "grn" | "topup" = "topup",
): PendingWith {
  const status = String(currentStatus ?? "").toLowerCase();

  // Terminal states first: these are answers, not gaps.
  if (status === "applied") return { role: null, label: "Completed", isPending: false };
  if (status === "rejected") return { role: null, label: "Rejected", isPending: false };
  if (status === "cancelled") return { role: null, label: "Cancelled", isPending: false };
  if (status === "draft") return { role: null, label: "Not submitted", isPending: false };

  if (status === "submitted") {
    return { role: "branch_head", label: STAGE_LABELS.branch_head, isPending: true };
  }
  if (status === "branch_head_approved") {
    return { role: "finance_head", label: STAGE_LABELS.finance_head, isPending: true };
  }
  // Declared on both the budget status enum and the top-up status enum, though neither service
  // ever writes it any more — Finance Head approval goes straight to 'active' (budget) or
  // 'applied' (top-up). Handled the same way for both workflows so a legacy row (e.g. one
  // migrated by 1523_branch_budget_drop_accounts_head_stage.sql) still renders something true
  // instead of "Unknown".
  if (status === "finance_head_approved") {
    return { role: null, label: "Completed", isPending: false };
  }

  // An unrecognised status is reported as unknown rather than guessed at. Silently showing
  // "Completed" for a status nobody anticipated is how a stuck request stops being chased.
  return { role: null, label: "Unknown", isPending: false };
}
