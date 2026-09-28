/**
 * Front-end mirror of backend/src/modules/bulk-upload/bulk-role-restriction.ts.
 *
 * branch_wfm, ho_wfm and wfm_spoc may open the Bulk Upload Hub for the Employee LOB Mapping
 * upload only. The API is what enforces that; this helper only decides what the page should
 * not bother offering (the APR tab, the reconcile button), so a wrong answer here can never
 * widen access. `roleKeys` are the raw role keys from useWorkforceAccess().
 */
export const LOB_ONLY_HUB_ROLES: readonly string[] = ["branch_wfm", "ho_wfm", "wfm_spoc"];

/** Roles that already give the full Hub, including the legacy aliases the backend folds in. */
const FULL_HUB_ROLES: readonly string[] = [
  "admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr",
  "branch_admin", "payroll_head", "hr_admin", "branch_hr", "ho_hr", "payroll_admin",
];

export function isLobOnlyHubUser(roleKeys: readonly string[] | null | undefined): boolean {
  const keys = roleKeys ?? [];
  if (!keys.some((key) => LOB_ONLY_HUB_ROLES.includes(key))) return false;
  return !keys.some((key) => FULL_HUB_ROLES.includes(key));
}
