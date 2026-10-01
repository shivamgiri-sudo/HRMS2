/**
 * Per-batch visibility for the Bulk Upload Hub's by-id routes.
 *
 * GET /batches already limits the LIST to the caller's own uploads plus their branch scope
 * (buildScopeWhereClause; hr/hr_admin never get org-wide). The by-id routes (rows, import-status,
 * import, delete, row staging) only checked the role, so anyone holding a batch id could read or
 * mutate another branch's batch. This applies the SAME predicate to a single batch.
 * Missing and not-visible batches are answered differently only for callers who may see neither:
 * a not-visible batch is 403, a missing one 404.
 */
import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";

export const BATCH_SCOPE_ROLES = ["admin", "hr", "wfm", "wfm_analyst", "payroll", "payroll_hr", "branch_head", "branch_admin"];

export function requireBatchVisible() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser!.id;
      const scope = await buildScopeWhereClause(
        userId,
        BATCH_SCOPE_ROLES,
        { branchId: "COALESCE(ub.branch_id, uploader_emp.branch_id)" },
        { allowAdminBypass: true, blockOrgWideForRoles: ["hr", "hr_admin"] },
      );
      const [hit] = await db.execute<RowDataPacket[]>(
        `SELECT 1
           FROM upload_batch ub
           LEFT JOIN employees uploader_emp ON uploader_emp.user_id = ub.uploaded_by
          WHERE ub.id = ? AND (ub.uploaded_by = ? OR (${scope.sql}))
          LIMIT 1`,
        [req.params.id, userId, ...scope.params],
      );
      if ((hit as RowDataPacket[]).length > 0) return next();
      const [exists] = await db.execute<RowDataPacket[]>("SELECT 1 FROM upload_batch WHERE id = ? LIMIT 1", [req.params.id]);
      if ((exists as RowDataPacket[]).length === 0) return next(); // let the handler answer its own 404
      return res.status(403).json({
        success: false,
        error: "Forbidden: batch is outside your branch / assigned scope",
        message: "Forbidden: batch is outside your branch / assigned scope",
      });
    } catch (err) {
      return next(err); // fail closed
    }
  };
}
