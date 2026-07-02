import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { lettersService } from "./letters.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

router.get("/templates", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await lettersService.listTemplates() });
}));

router.post("/generate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, template_code, issued_date, override_vars } = req.body;
  if (!employee_id || !template_code) return res.status(400).json({ error: "employee_id and template_code required" });
  const letter = await lettersService.generateLetter({
    employee_id, template_code, issued_date, override_vars,
    generated_by: req.authUser!.id,
  });
  res.status(201).json({ data: letter });
}));

router.get("/employee/:employeeId", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await lettersService.listGenerated(req.params.employeeId) });
}));

// Acknowledge: employee may only acknowledge their own letter; admin/hr override is audited
router.post("/:letterId/acknowledge", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const letter = await lettersService.getById(req.params.letterId);
  if (!letter) return res.status(404).json({ error: "Not found" });

  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== letter.employee_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  } else {
    // Admin/HR override: audit it
    await logSensitiveAction({
      actor_user_id: userId, action_type: "LETTER_ACK_ADMIN_OVERRIDE",
      module_key: "LETTERS", entity_type: "generated_letter", entity_id: req.params.letterId,
      req,
    });
  }

  await lettersService.acknowledge(req.params.letterId);
  res.json({ ok: true });
}));

export { router as lettersRouter };
