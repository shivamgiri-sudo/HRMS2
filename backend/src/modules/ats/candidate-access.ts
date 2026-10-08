import type { RequestParamHandler } from "express";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { buildCandidateScopeSql, resolveAtsBranchScope } from "./ats-branch-scope.js";

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

/**
 * Resolve the actor's candidate row scope. `1=1` = all, `1=0` = none.
 *
 * Owner ruling 2026-10-01: only the org-wide roles (ORG_WIDE_EXEMPT_ROLES) see every candidate. hr and
 * manager used to be "wide" here; they are now limited to their own branch / assigned scope like every other
 * role (see ats-branch-scope.ts). A scope_type='all' row no longer widens a non-org-wide role.
 * `alias` is the ats_candidate alias when the caller joins it; default is the bare column name.
 */
export async function resolveCandidateScope(userId: string, alias?: string): Promise<CandidateScope> {
  return buildCandidateScopeSql(await resolveAtsBranchScope(userId), alias);
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

/**
 * `router.param(name, candidateParamGuard())` - refuses (404, same as assertCandidateInScope) every route that
 * carries a candidate id the caller's branch scope does not cover (owner ruling 2026-10-01).
 *
 * Express runs param callbacks BEFORE a route's own middleware (requireAuth / requireRole), so an
 * unauthenticated request is passed through untouched (`next()`): the route's requireAuth then answers 401.
 * Only a caller that is authenticated AND out of scope is refused here.
 */
export function candidateParamGuard(): RequestParamHandler {
  return (req, res, next, candidateId) => {
    const userId = (req as AuthenticatedRequest).authUser?.id;
    if (!userId) return next();
    canAccessCandidate(userId, String(candidateId))
      .then((ok) => (ok ? next() : void res.status(404).json({ success: false, message: "Candidate not found" })))
      .catch(next);
  };
}
