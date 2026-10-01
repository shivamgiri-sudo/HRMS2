import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { isInReportingSpan } from "../../shared/reportingSpan.js";

/**
 * Branch-scope guard for `/:<param>` employee routes that used to trust the role alone
 * (owner ruling 2026-10-01: hr, payroll_hr, branch roles and managers see / change only their own
 * branch / assigned scope; org-wide roles are unaffected - canViewEmployee returns true for them).
 * `allowReportingSpan` additionally lets a manager act on their own team (reporting span).
 */
export const EMPLOYEE_OUT_OF_SCOPE = "Forbidden: this employee is outside your branch / assigned scope";

export async function canActOnEmployee(userId: string, employeeId: string, allowReportingSpan = false): Promise<boolean> {
  if (await canViewEmployee({ id: userId }, employeeId)) return true;
  return allowReportingSpan ? isInReportingSpan(userId, employeeId) : false;
}

export function guardEmployeeScope(param = "id", opts: { allowReportingSpan?: boolean } = {}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const employeeId = String(req.params[param] ?? "");
      if (!employeeId) return next();
      if (await canActOnEmployee(userId, employeeId, opts.allowReportingSpan)) return next();
      return res.status(403).json({ success: false, message: EMPLOYEE_OUT_OF_SCOPE });
    } catch (err) {
      return next(err);
    }
  };
}
