/**
 * Recipient resolution for the per-branch recruitment activity email. Read-only.
 *
 *   TO  branch head(s) of that branch     user_roles.role_key = 'branch_head', employee mapped to the branch
 *   CC  HR team                           roles hr, hr_admin, ho_hr (all branches) + branch_hr of that branch
 *   CC  COO                               COO_EMAILS (+ any user holding role coo)
 *
 * Same join the ATS requisition-approval nudge already uses to find a branch's approvers
 * (user_roles → employees.branch_id → branch_master). Employees who have left are excluded.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";

const HR_GLOBAL_ROLES = ["hr", "hr_admin", "ho_hr"];
const COO_ROLES = ["coo"];
/** No user holds the `coo` role today, so the COO is named explicitly (confirmed by the owner 2026-09-21). */
const COO_EMAILS = ["bhavana.harjani@teammas.in"];

export interface ResolvedRecipients {
  to: string[];
  cc: string[];
  /** True when the branch has no branch head on record and the HR team was placed in To. */
  toFellBackToHr: boolean;
}

const isEmail = (v: unknown): v is string => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const unique = (list: string[]) => [...new Map(list.map((e) => [e.trim().toLowerCase(), e.trim()])).values()];

async function emailsForRoles(roles: string[], branchName: string | null): Promise<string[]> {
  const branchClause = branchName === null ? "" : "AND (b.branch_name = ? OR b.branch_code = ?)";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT au.email
       FROM user_roles ur
       JOIN auth_user au ON au.id = ur.user_id
       ${branchName === null ? "LEFT" : ""} JOIN employees e ON e.user_id = au.id
       ${branchName === null ? "LEFT" : ""} JOIN branch_master b ON b.id = e.branch_id
      WHERE ur.active_status = 1
        AND ur.role_key IN (${roles.map(() => "?").join(",")})
        AND au.email IS NOT NULL AND au.email <> ''
        AND (e.id IS NULL OR e.active_status = 1)
        ${branchClause}`,
    branchName === null ? roles : [...roles, branchName, branchName],
  );
  return (rows as RowDataPacket[]).map((r) => String(r.email)).filter(isEmail);
}

export async function resolveRecipients(branchName: string): Promise<ResolvedRecipients> {
  const [branchHeads, hrGlobal, hrBranch, coo] = await Promise.all([
    emailsForRoles(["branch_head"], branchName),
    emailsForRoles(HR_GLOBAL_ROLES, null),
    emailsForRoles(["branch_hr"], branchName),
    emailsForRoles(COO_ROLES, null),
  ]);
  const hrTeam = unique([...hrGlobal, ...hrBranch]);
  const toFellBackToHr = branchHeads.length === 0;
  const to = toFellBackToHr ? hrTeam : unique(branchHeads);
  const toSet = new Set(to.map((e) => e.toLowerCase()));
  const cc = unique([...(toFellBackToHr ? [] : hrTeam), ...COO_EMAILS, ...coo]).filter((e) => !toSet.has(e.toLowerCase()));
  return { to, cc, toFellBackToHr };
}
