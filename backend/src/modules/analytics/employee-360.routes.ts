/**
 * Employee 360 Composite Profile Routes
 * File: backend/src/modules/analytics/employee-360.routes.ts
 *
 * Exposes GET /api/analytics/employee-360/:employeeId?period=YYYY-MM
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployee360Profile } from "./employee-360.service.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";

export const employee360Router = Router();

employee360Router.use(requireAuth);
employee360Router.use(requireRole("hr", "admin", "super_admin", "manager", "wfm", "payroll", "branch_head"));

// GET /api/analytics/employee-360/:employeeId?period=YYYY-MM
// Branch scoping: the role list above says who may open the page, not whose profile they may open.
// Without this check any hr / manager / wfm / payroll / branch_head user could read the composite
// profile of an employee in any branch just by knowing the id. Org-wide roles are unaffected.
employee360Router.get(
  "/:employeeId",
  async (req: any, res: any, next: any) => {
    try {
      if (!(await canViewEmployee(req.authUser, String(req.params.employeeId)))) {
        return res.status(403).json({ success: false, message: "Forbidden: this employee is outside your branch / assigned scope" });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  },
  getEmployee360Profile,
);
