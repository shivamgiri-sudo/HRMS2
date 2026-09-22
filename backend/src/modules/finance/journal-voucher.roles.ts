import { expandRoles, normalizeRoleInputs } from "../../platform/policy/index.js";
import type { JvStatus } from "./journal-voucher.validation.js";

/**
 * Who may do what with a manual journal voucher. Maker-checker: a maker drafts and submits; a
 * DIFFERENT person in an approver role posts it. The route guards use these same lists, and
 * computeJvPermissions() derives the per-voucher action flags the UI shows from them, so the
 * button a user sees and the endpoint that answers it can never disagree.
 */
export const JV_MAKER_ROLES = ["finance_head", "accounts_head", "finance", "super_admin"] as const;
export const JV_APPROVER_ROLES = ["finance_head", "ceo", "super_admin"] as const;
export const JV_REVERSE_ROLES = ["finance_head", "ceo", "super_admin"] as const;
export const JV_READ_ROLES = [
  ...new Set([...JV_MAKER_ROLES, ...JV_APPROVER_ROLES, "admin"]),
] as readonly string[];

/** Same matching rule requireRole applies: super_admin passes everything, otherwise the
 *  expanded role sets must intersect. */
export function holdsAnyRole(userRoles: readonly string[], allowed: readonly string[]): boolean {
  const normalized = normalizeRoleInputs([...userRoles]);
  if (normalized.includes("super_admin")) return true;
  const held = expandRoles(normalized);
  return expandRoles(normalizeRoleInputs([...allowed])).some((role) => held.includes(role));
}

export type JvActor = { id: string; roles: string[] };

export type JvPermissions = {
  canEdit: boolean;
  canDelete: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReverse: boolean;
};

export function computeJvPermissions(voucher: { status: JvStatus; created_by: string }, actor: JvActor): JvPermissions {
  const isMaker = holdsAnyRole(actor.roles, JV_MAKER_ROLES);
  const isApprover = holdsAnyRole(actor.roles, JV_APPROVER_ROLES);
  const isReverser = holdsAnyRole(actor.roles, JV_REVERSE_ROLES);
  const isCreator = String(voucher.created_by) === String(actor.id);
  const canEditOwn = isMaker && isCreator && (voucher.status === "draft" || voucher.status === "rejected");

  return {
    canEdit: canEditOwn,
    canDelete: isMaker && isCreator && voucher.status === "draft",
    canSubmit: isMaker && isCreator && voucher.status === "draft",
    canWithdraw: voucher.status === "pending_approval" && (isCreator || holdsAnyRole(actor.roles, ["finance_head", "super_admin"])),
    canApprove: voucher.status === "pending_approval" && isApprover && !isCreator,
    canReject: voucher.status === "pending_approval" && isApprover && !isCreator,
    canReverse: voucher.status === "posted" && isReverser,
  };
}
