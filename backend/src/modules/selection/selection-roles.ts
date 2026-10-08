// Who may do what with selection criteria. The routes enforce these; the read endpoints also return them (permissionsFor) so
// the UI hides controls a role cannot use. Recruiters see nothing of selection (owner ruling 2026-10-09).
import { APPROVAL_ROLES } from "./approval.service.js";
import { CRITERIA_EDIT_ROLES } from "./criteria.service.js";
import { OVERRIDE_ROLES } from "./override.service.js";

/** Requisition readers (without recruiters) plus Hiring Engine viewers. */
export const CRITERIA_READ_ROLES = [
  "super_admin", "hr", "recruitment_hr", "branch_head", "operations_manager", "process_manager", "management", "manager", "assistant_manager",
  "admin", "hr_admin", "ceo",
] as const;
export const PREVIEW_EXPORT_ROLES = ["super_admin", "hr", "recruitment_hr"] as const;

export interface SelectionPermissions { read: boolean; edit: boolean; export: boolean; approve: boolean; override: boolean }
const has = (roles: readonly string[], r: string) => roles.includes(r);
export function permissionsFor(role: string): SelectionPermissions {
  const read = has(CRITERIA_READ_ROLES, role);
  return { read, edit: read && has(CRITERIA_EDIT_ROLES, role), export: read && has(PREVIEW_EXPORT_ROLES, role), approve: read && has(APPROVAL_ROLES, role), override: read && has(OVERRIDE_ROLES, role) };
}
