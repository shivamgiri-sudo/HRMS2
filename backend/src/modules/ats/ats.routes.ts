import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { atsController as c } from "./ats.controller.js";
import { convertCandidateToEmployee } from "./ats.convert.service.js";

export const atsRouter = Router();
atsRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Candidates
atsRouter.get("/candidates",                     h(c.listCandidates.bind(c)));
atsRouter.post("/candidates",                    h(c.createCandidate.bind(c)));
atsRouter.get("/candidates/:id",                 h(c.getCandidate.bind(c)));
atsRouter.put("/candidates/:id",                 h(c.updateCandidate.bind(c)));
atsRouter.post("/candidates/:id/move-stage",     h(c.moveStage.bind(c)));
atsRouter.get("/candidates/:id/stage-logs",      h(c.listStageLogs.bind(c)));

// Candidate → Employee conversion
atsRouter.post(
  "/convert/:candidateId",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const result = await convertCandidateToEmployee(
      req.params.candidateId,
      req.authUser!.id
    );
    return res.status(201).json({ success: true, data: result });
  })
);

// Onboarding bridge
atsRouter.post("/onboarding-bridge",             h(c.createOnboardingBridge.bind(c)));
atsRouter.patch("/onboarding-bridge/:id",        h(c.updateOnboardingBridge.bind(c)));

// Reference data
atsRouter.get("/sourcing-channels",              h(c.listSourcingChannels.bind(c)));
atsRouter.get("/stats",                          h(c.getDashboardStats.bind(c)));

// Walk-in queue — candidates who arrived via Walk-In channel, sorted by walk_in_date desc
atsRouter.get("/walkin-queue",                   h(async (req: any, res: any) => {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    `SELECT c.*, e.full_name AS assigned_to_name
     FROM ats_candidate c
     LEFT JOIN employees e ON e.id = c.created_by
     WHERE c.sourcing_channel = 'Walk-In' AND c.active_status = 1
     ORDER BY c.walk_in_date DESC, c.created_at DESC
     LIMIT 100`,
    []
  ) as any[];
  return res.json({ success: true, data: rows });
}));

// Alias: waiting-queue = walkin-queue (used by NativeATSWaitingQueue page)
atsRouter.get("/waiting-queue",                  h(async (req: any, res: any) => {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    `SELECT c.* FROM ats_candidate c
     WHERE c.current_stage IN ('New','Screening') AND c.active_status = 1
     ORDER BY c.walk_in_date DESC, c.created_at DESC
     LIMIT 100`,
    []
  ) as any[];
  return res.json({ success: true, data: rows });
}));
