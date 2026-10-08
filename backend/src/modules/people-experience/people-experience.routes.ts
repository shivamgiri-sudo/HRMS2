import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  resolvePeopleExperienceScope,
  canManageGrievance,
} from "./people-experience.scope.js";
import {
  createAction,
  getPeopleExperienceCommandCenter,
  listActions,
  scanPeopleExperience,
  updateActionStatus,
} from "./people-experience.service.js";

export const peopleExperienceRouter = Router();
peopleExperienceRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

peopleExperienceRouter.get("/scope", h(async (req, res) => {
  const scope = await resolvePeopleExperienceScope(req);
  res.json({
    success: true,
    data: {
      kind: scope.kind,
      label: scope.label,
      roles: scope.roles,
      can_manage_grievances: scope.canManageGrievances,
      can_view_confidential_grievance_identity: scope.canSeeConfidentialGrievanceIdentity,
    },
  });
}));

peopleExperienceRouter.get("/command-center", h(async (req, res) => {
  const scope = await resolvePeopleExperienceScope(req);
  const data = await getPeopleExperienceCommandCenter(scope, req.query as Record<string, string | undefined>);
  res.json({ success: true, data });
}));

peopleExperienceRouter.post("/scan", h(async (req, res) => {
  const scope = await resolvePeopleExperienceScope(req);
  if (!["global", "branch", "process", "team"].includes(scope.kind)) {
    return res.status(403).json({ success: false, message: "Employees can only view their own people-experience health" });
  }
  const data = await scanPeopleExperience(
    scope,
    req.body?.filters ?? {},
    Math.min(Number(req.body?.limit ?? 500), 2000)
  );
  res.json({ success: true, data });
}));

peopleExperienceRouter.get("/actions", h(async (req, res) => {
  const scope = await resolvePeopleExperienceScope(req);
  res.json({ success: true, data: await listActions(scope, req.query as Record<string, string | undefined>) });
}));

peopleExperienceRouter.post("/actions", h(async (req, res) => {
  const scope = await resolvePeopleExperienceScope(req);
  if (scope.kind === "self") {
    return res.status(403).json({ success: false, message: "Employees cannot assign people-experience actions" });
  }
  res.status(201).json({ success: true, data: await createAction(scope, req.body) });
}));

peopleExperienceRouter.patch("/actions/:id", h(async (req, res) => {
  const scope = await resolvePeopleExperienceScope(req);
  res.json({ success: true, data: await updateActionStatus(scope, req.params.id, req.body) });
}));

peopleExperienceRouter.post("/actions/:id/complete", h(async (req, res) => {
  const scope = await resolvePeopleExperienceScope(req);
  res.json({ success: true, data: await updateActionStatus(scope, req.params.id, { ...req.body, status: "completed" }) });
}));

peopleExperienceRouter.get("/grievance-access", h(async (req, res) => {
  const scope = await resolvePeopleExperienceScope(req);
  res.json({
    success: true,
    data: {
      can_manage_grievances: canManageGrievance(scope),
      anonymous_identity_protected: true,
    },
  });
}));
