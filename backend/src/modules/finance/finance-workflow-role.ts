const STAGED_ROLES = ["branch_head", "finance_head", "accounts_head"] as const;

export type FinanceStageRole = (typeof STAGED_ROLES)[number] | "super_admin";

function normalizedRoles(primaryRole?: string | null, userRoles: string[] = []) {
  return new Set(
    [primaryRole, ...userRoles]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
  );
}

/**
 * Resolves the role that owns the current workflow stage from every role assigned
 * to the authenticated user. This prevents a user's primary/default role from
 * hiding an additional Finance approval role.
 */
export function resolveFinanceStageRole(input: {
  primaryRole?: string | null;
  userRoles?: string[];
  currentStatus: string;
  workflow: "budget" | "grn";
}): FinanceStageRole {
  const roles = normalizedRoles(input.primaryRole, input.userRoles ?? []);
  if (roles.has("super_admin")) return "super_admin";

  const expectedRole = input.workflow === "budget"
    ? input.currentStatus === "submitted"
      ? "branch_head"
      : input.currentStatus === "branch_head_approved"
        ? "finance_head"
        : input.currentStatus === "finance_head_approved"
          ? "accounts_head"
          : null
    : input.currentStatus === "submitted"
      ? "branch_head"
      : input.currentStatus === "branch_head_approved"
        ? "finance_head"
        : null;

  if (!expectedRole) {
    throw new Error(
      `No approval role is valid for ${input.workflow} status ${input.currentStatus}`
    );
  }
  if (!roles.has(expectedRole)) {
    throw new Error(
      `The current ${input.workflow} stage requires the ${expectedRole} role`
    );
  }
  return expectedRole;
}
