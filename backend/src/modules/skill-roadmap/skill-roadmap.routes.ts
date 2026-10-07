import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { skillRoadmapService } from "./skill-roadmap.service.js";

export const skillRoadmapRouter = Router();
skillRoadmapRouter.use(requireAuth);

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) =>
    fn(req, res).catch(next);

const MANAGER_ROLES = [
  "super_admin",
  "admin",
  "hr",
  "manager",
  "branch_head",
  "process_manager",
  "operations_manager",
  "ceo",
  "coo",
] as const;

async function canAccessEmployee(
  req: AuthenticatedRequest,
  employeeId: string,
): Promise<boolean> {
  const userId = req.authUser!.id;
  if (await hasRole(userId, ...MANAGER_ROLES)) return true;
  const emp = await getEmployeeForUser(userId);
  return !!emp && emp.id === employeeId;
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

// GET /api/skill-roadmap/catalogue
skillRoadmapRouter.get(
  "/catalogue",
  h(async (_req, res) => {
    const data = await skillRoadmapService.listRoadmaps();
    return res.json({ success: true, data });
  }),
);

// GET /api/skill-roadmap/nodes/:roadmapId
skillRoadmapRouter.get(
  "/nodes/:roadmapId",
  h(async (req, res) => {
    const nodes = await skillRoadmapService.getRoadmapNodes(
      req.params.roadmapId,
    );
    return res.json({ success: true, data: nodes });
  }),
);

// ─── Employee Roadmap Assignments ─────────────────────────────────────────────

// GET /api/skill-roadmap/employee/:employeeId
skillRoadmapRouter.get(
  "/employee/:employeeId",
  h(async (req, res) => {
    if (!(await canAccessEmployee(req, req.params.employeeId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const data = await skillRoadmapService.getEmployeeRoadmaps(
      req.params.employeeId,
    );
    return res.json({ success: true, data });
  }),
);

// POST /api/skill-roadmap/employee/:employeeId/assign
skillRoadmapRouter.post(
  "/employee/:employeeId/assign",
  requireRole(...MANAGER_ROLES),
  h(async (req, res) => {
    const { roadmap_id } = req.body as { roadmap_id?: string };
    if (!roadmap_id || typeof roadmap_id !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "roadmap_id required" });
    }
    await skillRoadmapService.assignRoadmap(
      req.params.employeeId,
      roadmap_id,
      req.authUser!.id,
    );
    return res.json({ success: true });
  }),
);

// DELETE /api/skill-roadmap/employee/:employeeId/assign/:roadmapId
skillRoadmapRouter.delete(
  "/employee/:employeeId/assign/:roadmapId",
  requireRole(...MANAGER_ROLES),
  h(async (req, res) => {
    await skillRoadmapService.unassignRoadmap(
      req.params.employeeId,
      req.params.roadmapId,
    );
    return res.json({ success: true });
  }),
);

// ─── Skill States ─────────────────────────────────────────────────────────────

// GET /api/skill-roadmap/employee/:employeeId/states/:roadmapId
skillRoadmapRouter.get(
  "/employee/:employeeId/states/:roadmapId",
  h(async (req, res) => {
    if (!(await canAccessEmployee(req, req.params.employeeId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const [states, summary] = await Promise.all([
      skillRoadmapService.getEmployeeSkillStates(
        req.params.employeeId,
        req.params.roadmapId,
      ),
      skillRoadmapService.getSkillSummary(
        req.params.employeeId,
        req.params.roadmapId,
      ),
    ]);
    return res.json({ success: true, data: { states, summary } });
  }),
);

// PATCH /api/skill-roadmap/employee/:employeeId/state
skillRoadmapRouter.patch(
  "/employee/:employeeId/state",
  h(async (req, res) => {
    if (!(await canAccessEmployee(req, req.params.employeeId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const { node_id, status, notes } = req.body as {
      node_id?: string;
      status?: string;
      notes?: string;
    };
    if (!node_id || !status) {
      return res
        .status(400)
        .json({ success: false, message: "node_id and status required" });
    }
    const VALID = new Set(["none", "in_progress", "done"]);
    if (!VALID.has(status)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "status must be none|in_progress|done",
        });
    }
    await skillRoadmapService.setSkillState(
      req.params.employeeId,
      node_id,
      status as "none" | "in_progress" | "done",
      req.authUser!.id,
      notes,
    );
    return res.json({ success: true });
  }),
);

// ─── Gap Analysis ─────────────────────────────────────────────────────────────

// GET /api/skill-roadmap/employee/:employeeId/gaps/:roadmapId?designation_id=<uuid>
skillRoadmapRouter.get(
  "/employee/:employeeId/gaps/:roadmapId",
  h(async (req, res) => {
    if (!(await canAccessEmployee(req, req.params.employeeId))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const designationId = String(req.query.designation_id ?? "");
    if (!designationId) {
      return res.json({ success: true, data: [] });
    }
    const gaps = await skillRoadmapService.getGapSkills(
      req.params.employeeId,
      req.params.roadmapId,
      designationId,
    );
    return res.json({ success: true, data: gaps });
  }),
);

// ─── Admin: bulk-upsert nodes from roadmap.sh import ─────────────────────────

// POST /api/skill-roadmap/admin/nodes/:roadmapId
skillRoadmapRouter.post(
  "/admin/nodes/:roadmapId",
  requireRole("super_admin", "admin"),
  h(async (req, res) => {
    const nodes = req.body as Array<{
      slug: string;
      label: string;
      description?: string;
      sortOrder: number;
    }>;
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "nodes array required" });
    }
    await skillRoadmapService.bulkUpsertNodes(req.params.roadmapId, nodes);
    return res.json({ success: true, imported: nodes.length });
  }),
);
