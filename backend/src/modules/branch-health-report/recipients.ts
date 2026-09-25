/**
 * Branch Health Report — recipient resolution.
 *
 *   TO  branch_head(s) of the branch
 *   CC  COO + CEO
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface ResolvedRecipients {
  to: string[];
  cc: string[];
  toFellBackToHr: boolean;
}

const CEO_COO_ROLES = ["ceo", "coo"];
/** Hardcoded fallbacks confirmed by owner (same pattern as branch-activity-report). */
const EXEC_FALLBACK_EMAILS: string[] = ["bhavana.harjani@teammas.in"];
/** Individuals explicitly excluded from CC regardless of their system role. */
const NEVER_CC = new Set([
  "ashwani.wadhwa@teammas.in",
  "ashish.awasthi@teammas.in",
]);

const isEmail = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

const unique = (list: string[]) => [
  ...new Map(list.map((e) => [e.trim().toLowerCase(), e.trim()])).values(),
];

async function emailsForRoles(
  roles: string[],
  branchName: string | null,
): Promise<string[]> {
  const branchClause =
    branchName === null ? "" : "AND (b.branch_name = ? OR b.branch_code = ?)";
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

export async function resolveRecipients(
  branchName: string,
): Promise<ResolvedRecipients> {
  const [branchHeads, execs] = await Promise.all([
    emailsForRoles(["branch_head"], branchName),
    emailsForRoles(CEO_COO_ROLES, null),
  ]);

  const toFellBackToHr = branchHeads.length === 0;
  const to: string[] = toFellBackToHr ? [] : unique(branchHeads);
  const toSet = new Set(to.map((e) => e.toLowerCase()));
  const cc = unique([...EXEC_FALLBACK_EMAILS, ...execs]).filter(
    (e) => !toSet.has(e.toLowerCase()) && !NEVER_CC.has(e.toLowerCase()),
  );
  return { to, cc, toFellBackToHr };
}
