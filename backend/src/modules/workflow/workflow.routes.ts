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
// Role is derived from the authenticated user's roles, not a query param
router.get("/requests/pending", requireRole("admin", "hr", "manager", "team_leader", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userRoles: string[] = (req.authUser as any)?.roles ?? [];
  // Pick the most privileged approver role the caller holds
  const APPROVER_PRIORITY = ["admin", "hr", "manager", "team_leader"];
  const derivedRole = APPROVER_PRIORITY.find(r => userRoles.includes(r)) ?? userRoles[0] ?? "hr";
  const role = (req.query.role as string) || derivedRole;
  const requests = await workflowService.listPendingForRole(role);
  res.json({ data: requests });
}));

// Requests for a specific entity
router.get("/requests/entity/:type/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const requests = await workflowService.listRequestsForEntity(req.params.type, req.params.id);
  res.json({ data: requests });
}));

// Act on a request (approve/reject/withdraw)
router.post("/requests/:id/act", requireRole("admin", "hr", "manager", "team_leader", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { action, remarks } = req.body;
  if (!["approved", "rejected", "withdrawn"].includes(action)) {
    return res.status(400).json({ error: "action must be approved, rejected, or withdrawn" });
  }
  const updated = await workflowService.act(req.params.id, req.authUser!.id, action, remarks);
  res.json({ data: updated });
}));

// My submitted requests (all authenticated users)
router.get("/requests/my", h(async (req: AuthenticatedRequest, res: Response) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 25;
  const status = req.query.status as string | undefined;
  const requests = await workflowService.listRequestsByUser(req.authUser!.id, { status, page, limit });
  res.json({ data: requests });
}));

// All requests — admin/hr
router.get("/requests", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 25;
  const requests = await workflowService.listAllRequests({
    status: req.query.status as string | undefined,
    entity_type: req.query.entity_type as string | undefined,
    requested_by: req.query.requested_by as string | undefined,
    page, limit,
  });
  res.json({ data: requests });
}));

// Audit/action log for a single request
router.get("/requests/:id/actions", requireRole("admin", "hr", "manager", "team_leader", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const actions = await workflowService.getRequestActions(req.params.id);
  res.json({ data: actions });
}));

export { router as workflowRouter };
