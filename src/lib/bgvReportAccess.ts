/**
 * Roles allowed to open the candidate BGV report (report page, HR Report tab, address panel).
 * Mirrors BGV_REPORT_ROLES in backend/src/modules/ats/bgv-verification.routes.ts — the API enforces
 * it (and the branch scope); this list only decides what the UI offers. super_admin passes everywhere.
 */
export const BGV_REPORT_ROLES = ["super_admin", "admin", "branch_hr", "branch_head", "branch_manager"] as const;
