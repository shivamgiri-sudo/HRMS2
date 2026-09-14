import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { salaryIncrementService } from "./salaryIncrement.service.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/salary-increment — list (hr/finance/admin see all; others see own)
router.get("/", h(async (req: any, res: any) => {
  const userId: string = req.authUser!.id;
  const { status } = req.query as Record<string, string>;

  if (await hasRole(userId, "admin", "hr", "finance")) {
    const data = await salaryIncrementService.list({ status });
    return res.json({ success: true, data, total: data.length });
  }

  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, error: "No employee record" });
  const data = await salaryIncrementService.list({ employee_id: emp.id, status });
  return res.json({ success: true, data, total: data.length });
}));

// GET /api/salary-increment/:id — detail
router.get("/:id", requireRole("admin", "hr", "finance"), h(async (req: any, res: any) => {
  const data = await salaryIncrementService.getById(req.params.id);
  if (!data) return res.status(404).json({ success: false, error: "Not found" });
  return res.json({ success: true, data });
}));

// GET /api/salary-increment/:id/audit — audit trail
router.get("/:id/audit", requireRole("admin", "hr", "finance"), h(async (req: any, res: any) => {
  const data = await salaryIncrementService.getAuditLog(req.params.id);
  return res.json({ success: true, data });
}));

// POST /api/salary-increment — create new increment request (hr/admin)
router.post("/", requireRole("admin", "hr"), h(async (req: any, res: any) => {
  const { employee_id, proposed_ctc, effective_from, reason_code, reason, business_justification } = req.body;
  if (!employee_id || !proposed_ctc || !effective_from) {
    return res.status(400).json({ success: false, error: "employee_id, proposed_ctc, effective_from are required" });
  }
  if (Number(proposed_ctc) <= 0) {
    return res.status(400).json({ success: false, error: "proposed_ctc must be positive" });
  }
  const data = await salaryIncrementService.create({
    employee_id,
    proposed_ctc: Number(proposed_ctc),
    effective_from,
    reason_code,
    reason,
    business_justification,
    requested_by: req.authUser!.id,
    requested_role: "hr",
  });
  return res.status(201).json({ success: true, data });
}));

// POST /api/salary-increment/:id/action — workflow transitions
router.post("/:id/action", h(async (req: any, res: any) => {
  const userId: string = req.authUser!.id;
  const { action, remarks } = req.body as { action: string; remarks?: string };

  const ROLE_GATES: Record<string, string[]> = {
    hr_validate:      ["admin", "hr"],
    finance_validate: ["admin", "finance"],
    approve:          ["admin", "hr"],
    reject:           ["admin", "hr", "finance"],
    implement:        ["admin", "hr", "finance"],
    cancel:           ["admin", "hr"],
    withdraw:         ["admin", "hr"],
  };

  const allowed = ROLE_GATES[action];
  if (!allowed) return res.status(400).json({ success: false, error: "Invalid action" });
  if (!await hasRole(userId, ...allowed)) {
    return res.status(403).json({ success: false, error: "Insufficient role for this action" });
  }

  const data = await salaryIncrementService.transition(
    req.params.id,
    action as any,
    userId,
    "hr",
    remarks
  );
  return res.json({ success: true, data });
}));

export { router as salaryIncrementRouter };
