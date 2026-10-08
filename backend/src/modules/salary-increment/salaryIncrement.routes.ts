import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { salaryIncrementService, INCREMENT_ROLE_GATES, INCREMENT_VIEW_ROLES, type IncrementAction } from "./salaryIncrement.service.js";
import { employeeScopeFor, guardEmployee } from "../payroll/payroll-branch-scope.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/salary-increment — list (hr / payroll head / admin see all; others see own)
router.get("/", h(async (req: any, res: any) => {
  const userId: string = req.authUser!.id;
  const { status, search, page, limit } = req.query as Record<string, string>;
  const paging = { search, page: Number(page) || 1, limit: Number(limit) || 25 };

  let result;
  if (await hasRole(userId, ...INCREMENT_VIEW_ROLES)) {
    result = await salaryIncrementService.list({ status, ...paging, scope: await employeeScopeFor(req, "e") });
  } else {
    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ success: false, error: "No employee record" });
    result = await salaryIncrementService.list({ employee_id: emp.id, status, ...paging });
  }
  return res.json({ success: true, data: result.rows, total: result.total, page: result.page, limit: result.limit });
}));

// GET /api/salary-increment/:id — detail
router.get("/:id", requireRole(...INCREMENT_VIEW_ROLES), h(async (req: any, res: any) => {
  const data = await salaryIncrementService.getById(req.params.id);
  if (!data) return res.status(404).json({ success: false, error: "Not found" });
  if (!(await guardEmployee(req, res, (data as any).employee_id))) return;
  return res.json({ success: true, data });
}));

// GET /api/salary-increment/:id/audit — audit trail
router.get("/:id/audit", requireRole(...INCREMENT_VIEW_ROLES), h(async (req: any, res: any) => {
  {
    const owner = await salaryIncrementService.getById(req.params.id);
    if (owner && !(await guardEmployee(req, res, (owner as any).employee_id))) return;
  }
  const data = await salaryIncrementService.getAuditLog(req.params.id);
  return res.json({ success: true, data });
}));

// POST /api/salary-increment — create new increment request (hr / payroll head / admin)
router.post("/", requireRole(...INCREMENT_VIEW_ROLES), h(async (req: any, res: any) => {
  const { employee_id, proposed_ctc, effective_from, reason_code, reason, business_justification } = req.body;
  if (!employee_id || !proposed_ctc || !effective_from) {
    return res.status(400).json({ success: false, error: "employee_id, proposed_ctc, effective_from are required" });
  }
  if (Number(proposed_ctc) <= 0) {
    return res.status(400).json({ success: false, error: "proposed_ctc must be positive" });
  }
  if (!(await guardEmployee(req, res, String(employee_id)))) return;
  const data = await salaryIncrementService.create({
    employee_id,
    proposed_ctc: Number(proposed_ctc),
    effective_from,
    reason_code,
    reason,
    business_justification,
    requested_by: req.authUser!.id,
    requested_role: (await hasRole(req.authUser!.id, "payroll_head", "super_admin")) ? "payroll_head" : "hr",
  });
  return res.status(201).json({ success: true, data });
}));

// POST /api/salary-increment/:id/action — workflow transitions
router.post("/:id/action", h(async (req: any, res: any) => {
  const userId: string = req.authUser!.id;
  const { action, remarks } = req.body as { action: string; remarks?: string };

  const allowed = INCREMENT_ROLE_GATES[action as IncrementAction];
  if (!allowed) return res.status(400).json({ success: false, error: "Invalid action" });
  if (!await hasRole(userId, ...allowed)) {
    return res.status(403).json({ success: false, error: "Insufficient role for this action" });
  }

  {
    const owner = await salaryIncrementService.getById(req.params.id);
    if (owner && !(await guardEmployee(req, res, (owner as any).employee_id))) return;
  }
  let data = await salaryIncrementService.transition(
    req.params.id,
    action as IncrementAction,
    userId,
    "payroll_head",
    remarks
  );
  // The Payroll Head is the last approval, so approving applies the increment in the same click.
  // If applying fails the request stays "approved" and can be applied again with the implement action.
  if (action === "approve") {
    data = await salaryIncrementService.transition(req.params.id, "implement", userId, "payroll_head", remarks);
  }
  return res.json({ success: true, data });
}));

export { router as salaryIncrementRouter };
