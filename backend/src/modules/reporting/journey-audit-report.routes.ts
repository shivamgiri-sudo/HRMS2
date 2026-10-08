import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { resolveBranchScope } from "./reporting.scope.js";
import { journeyAuditReportService } from "./journey-audit-report.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

const JOURNEY_ROLES = [
  "super_admin", "admin", "ceo", "coo", "hr", "hr_head", "branch_hr", "hr_branch",
  "recruiter", "recruitment_head", "trainer", "training", "operations_manager",
  "process_manager", "manager", "branch_head", "quality", "qa", "compliance", "auditor",
] as const;

router.use(requireAuth);
router.use(requireRole(...JOURNEY_ROLES));

function filters(req: AuthenticatedRequest) {
  return {
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    employeeCode: req.query.employeeCode ? String(req.query.employeeCode) : undefined,
    candidateId: req.query.candidateId ? String(req.query.candidateId) : undefined,
    branchId: req.query.branchId ? String(req.query.branchId) : undefined,
    module: req.query.module ? String(req.query.module) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  };
}

router.get("/source-verification", h(async (_req, res) => {
  const data = await journeyAuditReportService.verifySources();
  res.json({ success: true, data });
}));

router.get("/interview-to-exit", h(async (req, res) => {
  const scope = await resolveBranchScope(req.authUser!.id);
  const data = await journeyAuditReportService.journey(filters(req), scope);
  res.json({ success: true, data });
}));

router.get("/audit-compliance-ledger", h(async (req, res) => {
  const scope = await resolveBranchScope(req.authUser!.id);
  const data = await journeyAuditReportService.compliance(filters(req), scope);
  res.json({ success: true, data });
}));

export { router as journeyAuditReportRouter };
