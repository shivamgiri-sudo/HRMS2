import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { workflowService } from "./workflow.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// List workflow definitions — admin/hr
router.get("/", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await workflowService.listWorkflows() });
}));

// Create an approval request (any authenticated user for their own entity)
router.post("/requests", h(async (req: AuthenticatedRequest, res: Response) => {
  const { workflow_code, module_key, entity_type, entity_id, summary_text } = req.body;
  if (!workflow_code || !module_key || !entity_type || !entity_id) {
    return res.status(400).json({ error: "workflow_code, module_key, entity_type, entity_id required" });
  }
  const request = await workflowService.createRequest({
    workflow_code, module_key, entity_type, entity_id,
    requested_by: req.authUser!.id,
    summary_text,
  });
  res.status(201).json({ data: request });
}));

// Pending requests for caller's role (approver inbox)
router.get("/requests/pending", requireRole("admin", "hr", "manager", "team_leader"), h(async (req: AuthenticatedRequest, res: Response) => {
  const role = (req.query.role as string) ?? "hr";
  const requests = await workflowService.listPendingForRole(role);
  res.json({ data: requests });
}));

// Requests for a specific entity
router.get("/requests/entity/:type/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const requests = await workflowService.listRequestsForEntity(req.params.type, req.params.id);
  res.json({ data: requests });
}));

// Act on a request (approve/reject/withdraw)
router.post("/requests/:id/act", requireRole("admin", "hr", "manager", "team_leader"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { action, remarks } = req.body;
  if (!["approved", "rejected", "withdrawn"].includes(action)) {
    return res.status(400).json({ error: "action must be approved, rejected, or withdrawn" });
  }
  const updated = await workflowService.act(req.params.id, req.authUser!.id, action, remarks);
  res.json({ data: updated });
}));

export { router as workflowRouter };
