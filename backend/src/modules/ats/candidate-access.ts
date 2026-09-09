import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getUserRoleKeys, getUserAssignmentScopes } from "../../shared/scopeAccess.js";
import { branchNameVariants } from "./ats-vocabulary.js";

/**
 * ONE canonical candidate row-scope rule, for every candidate operation.
 *
 * GET /api/ats/candidates resolved the actor's branch/process scope inline in ats.routes.ts
 * and passed it to listCandidates. Every INDIVIDUAL-candidate route resolved nothing at all:
 * atsService.getCandidate(id) is `SELECT ... FROM ats_candidate WHERE id = ?`, with no actor
 * predicate, and that SELECT returns mobile, email, date_of_birth and gender.
 *
 * recruiter and manager are exactly the roles the list path scopes, so a recruiter assigned
 * to Branch A could read a Branch B candidate's PII by id — and on move-stage, mutate them.
 * The row-scope model existed and was simply not applied on the by-id path.
 *
 * The rule lives here, once, so the remaining by-id routes adopt the SAME predicate rather
 * than each growing its own. The logic is lifted verbatim from the list route's inline block,
 * so list behaviour is unchanged: wide roles get 1=1, a recruiter with no assignment gets
 * 1=0, a recruiter with scope_type 'all' gets 1=1, otherwise branch names OR process names.
 */
export type CandidateScope = { sql: string; params: unknown[] };

const WIDE_ROLES = ["super_admin", "admin", "hr", "manager", "ceo"];

/** Resolve the actor's candidate row scope. `1=1` = all, `1=0` = none. */
export async function resolveCandidateScope(userId: string): Promise<CandidateScope> {
  const roleKeys = await getUserRoleKeys(userId);
  if (roleKeys.some((r) => WIDE_ROLES.includes(r))) {
    return { sql: "1=1", params: [] };
  }

  const scopes = await getUserAssignmentScopes(userId, ["recruiter"]);
  if (scopes.length === 0) return { sql: "1=0", params: [] };
  if (scopes.some((s) => s.scope_type === "all")) return { sql: "1=1", params: [] };

  const branchIds = [...new Set(scopes.filter((s) => s.branch_id).map((s) => s.branch_id as string))];
  const processNames = [...new Set(scopes.filter((s) => s.process_id).map((s) => s.process_id as string))];

  const sqlParts: string[] = [];
  const params: unknown[] = [];

  if (branchIds.length > 0) {
    const [bmRows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_name FROM branch_master WHERE id IN (${branchIds.map(() => "?").join(",")})`,
      branchIds,
    );
    const branchNames = (bmRows as { branch_name: string }[]).map((r) => r.branch_name);
    // applied_for_branch is free text, and the same physical branch is recorded under
    // several spellings (e.g. 1,862 candidates as "Okaya Centre" rather than "NOIDA-2") —
    // see ats-vocabulary.ts. Matching only the canonical branch_master name silently
    // dropped every one of those candidates for a recruiter scoped to that branch.
    // branchNameVariants() only adds confirmed aliases, so this can only widen who a
    // scoped recruiter sees, never narrow it.
    const expandedNames = [...new Set(branchNames.flatMap((n) => branchNameVariants(n)))];
    if (expandedNames.length > 0) {
      sqlParts.push(`applied_for_branch IN (${expandedNames.map(() => "?").join(",")})`);
      params.push(...expandedNames);
    }
  }

  if (processNames.length > 0) {
    sqlParts.push(`applied_for_process IN (${processNames.map(() => "?").join(",")})`);
    params.push(...processNames);
  }

  return { sql: sqlParts.length > 0 ? sqlParts.join(" OR ") : "1=0", params };
}

/**
 * True when this actor may act on this candidate.
 *
 * Deliberately a single existence probe under the scope predicate, so callers cannot
 * accidentally fetch the row first and check afterwards — the shape that leaks data through
 * error messages and timing.
 */
export async function canAccessCandidate(userId: string, candidateId: string): Promise<boolean> {
  const scope = await resolveCandidateScope(userId);
  if (scope.sql === "1=0") return false;

  const where = scope.sql === "1=1" ? "" : ` AND (${scope.sql})`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM ats_candidate WHERE id = ?${where} LIMIT 1`,
    [candidateId, ...scope.params],
  );
  return rows.length > 0;
}

/**
 * Guard for a by-id candidate route. Returns true when the caller may proceed; otherwise it
 * has already answered 404 and the caller must return.
 *
 * 404 rather than 403 on purpose: a 403 confirms the candidate exists, which tells an
 * out-of-scope recruiter that a given id is real. Not-found and not-yours are deliberately
 * indistinguishable.
 */
export async function assertCandidateInScope(
  userId: string,
  candidateId: string,
  res: { status: (c: number) => { json: (b: unknown) => unknown } },
): Promise<boolean> {
  if (await canAccessCandidate(userId, candidateId)) return true;
  res.status(404).json({ success: false, message: "Candidate not found" });
  return false;
}
