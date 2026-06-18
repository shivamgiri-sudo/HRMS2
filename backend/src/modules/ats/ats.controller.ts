import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { atsService } from "./ats.service.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
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
    // Convert numeric boolean fields to strings for CreateCandidateInput type compatibility
    const normalizedInput = {
      ...input,
      rotationalShift: input.rotationalShift != null ? String(input.rotationalShift) : input.rotationalShift,
      nightShiftOk: input.nightShiftOk != null ? String(input.nightShiftOk) : input.nightShiftOk,
      leavesIn3months: input.leavesIn3months != null ? String(input.leavesIn3months) : input.leavesIn3months,
      ownsTwoWheeler: input.ownsTwoWheeler != null ? String(input.ownsTwoWheeler) : input.ownsTwoWheeler,
      idProofAvailable: input.idProofAvailable != null ? String(input.idProofAvailable) : input.idProofAvailable,
      educationProofAvailable: input.educationProofAvailable != null ? String(input.educationProofAvailable) : input.educationProofAvailable,
    };
    // Normalization handled inside atsService.createCandidate
    const data  = await atsService.createCandidate(normalizedInput, req.authUser?.id ?? null);
    return res.status(201).json({ success: true, data, message: "Candidate registered" });
  },

  async updateCandidate(req: AuthenticatedRequest, res: Response) {
    const input = updateCandidateSchema.parse(req.body);
    // Convert numeric boolean fields to strings for CreateCandidateInput type compatibility
    const normalizedInput = {
      ...input,
      rotationalShift: input.rotationalShift != null ? String(input.rotationalShift) : input.rotationalShift,
      nightShiftOk: input.nightShiftOk != null ? String(input.nightShiftOk) : input.nightShiftOk,
      leavesIn3months: input.leavesIn3months != null ? String(input.leavesIn3months) : input.leavesIn3months,
      ownsTwoWheeler: input.ownsTwoWheeler != null ? String(input.ownsTwoWheeler) : input.ownsTwoWheeler,
      idProofAvailable: input.idProofAvailable != null ? String(input.idProofAvailable) : input.idProofAvailable,
      educationProofAvailable: input.educationProofAvailable != null ? String(input.educationProofAvailable) : input.educationProofAvailable,
    };
    const data  = await atsService.updateCandidate(req.params.id, normalizedInput, req.authUser!.id);
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

  async listOnboardingBridges(req: AuthenticatedRequest, res: Response) {
    const scopeFilter = await buildScopeWhereClause(
      req.authUser!.id,
      ["hr"],
      {
        branchId: "COALESCE(br.id, c.applied_for_branch)",
        processId: "c.applied_for_process",
      },
      { allowAdminBypass: true }
    );
    const data = await atsService.listOnboardingBridges(scopeFilter);
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
