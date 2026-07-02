import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { atsService } from "./ats.service.js";
import {
  createCandidateSchema,
  updateCandidateSchema,
  moveStagingSchema,
  candidateFiltersSchema,
  createOnboardingBridgeSchema,
  updateOnboardingBridgeSchema,
} from "./ats.validation.js";

export const atsController = {
  async listCandidates(req: AuthenticatedRequest, res: Response) {
    const filters = candidateFiltersSchema.parse(req.query);
    // Pass scopeFilter from middleware
    const filtersWithScope = { ...filters, scopeFilter: (req as any).scopeFilter };
    const result  = await atsService.listCandidates(filtersWithScope);
    return res.json({ success: true, ...result });
  },

  async getCandidate(req: AuthenticatedRequest, res: Response) {
    const data = await atsService.getCandidate(req.params.id);
    return res.json({ success: true, data });
  },

  async createCandidate(req: AuthenticatedRequest, res: Response) {
    const input = createCandidateSchema.parse(req.body);
    // Public endpoint — authUser may be null for self-registering walk-in candidates
    const data  = await atsService.createCandidate(input, req.authUser?.id ?? null);
    return res.status(201).json({ success: true, data, message: "Candidate registered" });
  },

  async updateCandidate(req: AuthenticatedRequest, res: Response) {
    const input = updateCandidateSchema.parse(req.body);
    const data  = await atsService.updateCandidate(req.params.id, input, req.authUser!.id);
    return res.json({ success: true, data, message: "Candidate updated" });
  },

  async moveStage(req: AuthenticatedRequest, res: Response) {
    const input = moveStagingSchema.parse(req.body);
    const data  = await atsService.moveStage(
      req.params.id, input.toStage, req.authUser!.id, input.remarks ?? undefined
    );
    return res.json({ success: true, data, message: `Moved to ${input.toStage}` });
  },

  async listStageLogs(req: AuthenticatedRequest, res: Response) {
    const data = await atsService.listStageLogs(req.params.id);
    return res.json({ success: true, data });
  },

  async createOnboardingBridge(req: AuthenticatedRequest, res: Response) {
    const input = createOnboardingBridgeSchema.parse(req.body);
    const data  = await atsService.createOnboardingBridge(input, req.authUser!.id);
    return res.status(201).json({ success: true, data, message: "Onboarding bridge created" });
  },

  async updateOnboardingBridge(req: AuthenticatedRequest, res: Response) {
    const input = updateOnboardingBridgeSchema.parse(req.body);
    const data  = await atsService.updateOnboardingBridge(req.params.id, input, req.authUser!.id);
    return res.json({ success: true, data, message: "Onboarding bridge updated" });
  },

  async listSourcingChannels(_req: AuthenticatedRequest, res: Response) {
    const data = await atsService.listSourcingChannels();
    return res.json({ success: true, data });
  },

  async getDashboardStats(req: AuthenticatedRequest, res: Response) {
    const { fromDate, toDate, branch, process } = req.query as Record<string, string | undefined>;
    const data = await atsService.getDashboardStats({ fromDate, toDate, branch, process });
    return res.json({ success: true, data });
  },
};
