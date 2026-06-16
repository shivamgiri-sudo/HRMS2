import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { payrollController as c } from "./payroll.controller.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

const PAYROLL_READ_SCOPE_ROLES = ["hr", "finance", "payroll"];

router.get("/runs", requireRole("admin", "hr", "finance", "payroll", "ceo"), h(async (req, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    PAYROLL_READ_SCOPE_ROLES,
    {
      branchId: "spr.branch_id",
      processId: "spr.process_id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  (req as any).scopeFilter = scoped;
  return c.listRuns(req, res);
}));

router.get("/records", requireRole("admin", "hr", "finance", "payroll", "ceo"), h(async (req, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    PAYROLL_READ_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  (req as any).scopeFilter = scoped;
  return c.listPayrollRecords(req, res);
}));

export { router as payrollSecureRouter };
