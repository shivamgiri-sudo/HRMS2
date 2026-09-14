import type { Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { insertAuditLog } from "./dpdp-withdrawal.service.js";

/**
 * DPDP Act 2023 §13 enforcement.
 * Blocks data access for employees who have an approved, active withdrawal order.
 * Must be applied AFTER requireRole on employee-scoped GET endpoints.
 *
 * The target employee is resolved from route params (:id / :employeeId)
 * or query param (?employeeId=). For /me endpoints this guard is not needed
 * since the user is accessing their own data.
 *
 * The requester_id in dpdp_consent_withdrawal is the auth_user.id of the employee.
 * We resolve from employees.id via a JOIN when the param is an employee UUID.
 *
 * There is deliberately no owner bypass: a data subject under an approved restriction
 * order is blocked from their own record too. That mirrors documentVaultAuth.ts, which
 * runs its processing-hold check BEFORE its owner bypass for the same reason — a §13
 * order stops processing, and serving the record is processing however initiated.
 */

/** employees.id / auth_user.id are CHAR(36) UUIDs. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function checkDpdpRestriction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const targetId =
      (req.params as Record<string, string>).id ??
      (req.params as Record<string, string>).employeeId ??
      (req.query.employeeId as string | undefined);

    if (!targetId) {
      next();
      return;
    }

    // Mounted on a path pattern (app.use("/api/employees/:employeeId", ...)), so this also
    // matches literal sub-paths like /api/employees/bank-quality or /directory-masters.
    // Those can never name an employee, and querying for them costs a round trip per
    // request on the directory's hot endpoints. Anything that is not UUID-shaped is not
    // an id this guard can restrict, so it is passed straight through.
    if (!UUID_RE.test(targetId)) {
      next();
      return;
    }

    // targetId could be either employees.id or auth_user.id depending on the endpoint.
    // Check both: if it matches an employee record, resolve via user_id; also check directly.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT dcw.id
       FROM dpdp_consent_withdrawal dcw
       WHERE dcw.data_restriction_applied = 1
         AND dcw.status = 'approved'
         AND (
           dcw.requester_id = ?
           OR dcw.requester_id IN (
             -- No LIMIT here. MySQL rejects LIMIT inside IN/ALL/ANY/SOME with
             -- ER_NOT_SUPPORTED_YET ("This version of MySQL doesn't yet support
             -- 'LIMIT & IN/ALL/ANY/SOME subquery'"), so the LIMIT 1 this used to
             -- carry made the whole statement throw on EVERY UUID-shaped target.
             -- The guard fails closed by design, so that turned into a blanket
             -- 503 "Privacy restriction check temporarily unavailable" across
             -- everything under /api/employees/:employeeId. It is also redundant:
             -- employees.id is the primary key, so this can match at most one row.
             SELECT e.user_id FROM employees e WHERE e.id = ?
           )
         )
       LIMIT 1`,
      [targetId, targetId]
    );

    if (rows.length > 0) {
      /**
       * The hold being ENFORCED is a distinct auditable event from the hold being applied.
       * DPDP_PROCESSING_HOLD_APPLIED is written once, when HR starts review; without this,
       * the record showed that a restriction existed but never that it actually stopped
       * anyone — which is the only evidence that the restriction did its job.
       *
       * Fire-and-forget: an audit-write failure must never convert this 403 into a 500,
       * because the guard's whole contract is to fail closed.
       */
      const actor = (req as Request & { authUser?: { id?: string } }).authUser?.id ?? "anonymous";
      void insertAuditLog(String(rows[0].id), "DPDP_PROCESSING_HOLD_ENFORCED", actor, {
        remarks: `Access to ${req.method} ${req.originalUrl ?? req.path} blocked by active restriction`,
      }).catch(() => undefined);

      res.status(403).json({
        success: false,
        message:
          "Access restricted: this employee has an active DPDP data withdrawal order. Contact the compliance/DPO team.",
        code: "DPDP_RESTRICTION_ACTIVE",
      });
      return;
    }

    next();
  } catch (err) {
    // Fail CLOSED: a DB error during a restriction check must not silently allow access
    // through an active withdrawal order. Return 503 so the caller can retry.
    process.stderr.write(
      JSON.stringify({
        level: "critical",
        module: "dpdpRestrictionGuard",
        event: "DPDP_RESTRICTION_CHECK_FAILED",
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }) + "\n"
    );
    res.status(503).json({
      success: false,
      message: "Privacy restriction check temporarily unavailable. Please retry.",
      code: "DPDP_RESTRICTION_CHECK_FAILED",
    });
  }
}
