/**
 * Branch scope helpers shared by the ats-extensions / ats-assessment / ats-full-parity routes.
 * Owner policy 2026-10-01: only ORG_WIDE_EXEMPT_ROLES see every branch; hr and every other role are
 * limited to their own branch / assigned scope. Built on the ATS resolver (ats/ats-branch-scope.ts),
 * which already encodes that policy and fails closed (no resolvable scope => nothing).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  resolveAtsBranchScope,
  buildCandidateScopeSql,
  branchInScope,
  type AtsBranchScope,
} from "../ats/ats-branch-scope.js";

export const OUT_OF_SCOPE_MESSAGE = "Forbidden: record is outside your branch / assigned scope";

export type ScopeVerdict = "ok" | "not_found" | "forbidden";

export { resolveAtsBranchScope, buildCandidateScopeSql, branchInScope };
export type { AtsBranchScope };

/** Is this ats_candidate inside the caller's scope? Org-wide callers only need the row to exist. */
export async function checkCandidateScope(scope: AtsBranchScope, candidateId: string): Promise<ScopeVerdict> {
  const [exists] = await db.execute<RowDataPacket[]>("SELECT 1 FROM ats_candidate WHERE id = ? LIMIT 1", [candidateId]);
  if (!(exists as RowDataPacket[]).length) return "not_found";
  if (scope.orgWide) return "ok";
  const cond = buildCandidateScopeSql(scope, "c");
  const [hit] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM ats_candidate c WHERE c.id = ? AND (${cond.sql}) LIMIT 1`,
    [candidateId, ...cond.params],
  );
  return (hit as RowDataPacket[]).length ? "ok" : "forbidden";
}
