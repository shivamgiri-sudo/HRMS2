import { Router } from "express";
import type { Response } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { apiError, apiSuccess } from "../../shared/apiResponse.js";
import {
  approveDraftRoster,
  createDraftRoster,
  getAssistantContext,
  getAttendanceExceptionSummary,
  getCeoCommandCenter,
  getCosecLatestPunches,
  getCosecSyncErrors,
  getCosecSyncRuns,
  getCosecSyncStatus,
  getEmployee360,
  getEmployeeAssistantSummary,
  getEnterpriseReports,
  getPayrollReadiness,
  getWorkforcePlanning,
  listAttendanceExceptions,
  scanAttendanceExceptions,
  scanPayrollReadiness,
  simulateRoster,
  updateAttendanceExceptionStatus,
  updatePayrollHold,
} from "./peopleos.service.js";

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => fn(req, res).catch(next);

function actor(req: AuthenticatedRequest) {
  return req.authUser!;
}

function sendError(res: Response, err: unknown) {
  const status = Number((err as Error & { status?: number }).status ?? 500);
  const message = err instanceof Error ? err.message : "Request failed";
  return res.status(status).json(apiError(status === 403 ? "FORBIDDEN" : "REQUEST_FAILED", message, status));
}

export const managementCommandCenterRouter = Router();
managementCommandCenterRouter.use(requireAuth);
managementCommandCenterRouter.get(
  "/ceo-command-center",
  requireRole("admin", "hr", "ceo", "finance", "process_manager", "manager"),
  h(async (req, res) => res.json(apiSuccess(await getCeoCommandCenter(actor(req), req.query)))),
);

export const employee360Router = Router();
employee360Router.use(requireAuth);
employee360Router.get(
  "/:id/360",
  h(async (req, res) => {
    try {
      return res.json(apiSuccess(await getEmployee360(actor(req), req.params.id, req)));
    } catch (err) {
      return sendError(res, err);
    }
  }),
);

export const attendanceExceptionRouter = Router();
attendanceExceptionRouter.use(requireAuth);
attendanceExceptionRouter.get(
  "/summary",
  requireRole("admin", "hr", "ceo", "wfm", "process_manager", "manager", "team_leader"),
  h(async (req, res) => res.json(apiSuccess(await getAttendanceExceptionSummary(actor(req), req.query)))),
);
attendanceExceptionRouter.get(
  "/list",
  requireRole("admin", "hr", "ceo", "wfm", "process_manager", "manager", "team_leader"),
  h(async (req, res) => res.json(apiSuccess(await listAttendanceExceptions(actor(req), req.query)))),
);
attendanceExceptionRouter.get(
  "/employee/:employeeId",
  h(async (req, res) => res.json(apiSuccess(await listAttendanceExceptions(actor(req), { ...req.query, employee_id: req.params.employeeId })))),
);
attendanceExceptionRouter.post(
  "/scan",
  requireWriteAccess,
  requireRole("admin", "hr", "wfm"),
  h(async (req, res) => res.json(apiSuccess(await scanAttendanceExceptions(actor(req), { ...req.query, ...req.body }, req)))),
);
attendanceExceptionRouter.post(
  "/:id/assign",
  requireWriteAccess,
  requireRole("admin", "hr", "wfm", "process_manager", "manager"),
  h(async (req, res) => res.json(apiSuccess(await updateAttendanceExceptionStatus(actor(req), req.params.id, "assigned", req.body, req)))),
);
attendanceExceptionRouter.post(
  "/:id/resolve",
  requireWriteAccess,
  requireRole("admin", "hr", "wfm", "process_manager", "manager"),
  h(async (req, res) => res.json(apiSuccess(await updateAttendanceExceptionStatus(actor(req), req.params.id, "resolved", req.body, req)))),
);
attendanceExceptionRouter.post(
  "/:id/reopen",
  requireWriteAccess,
  requireRole("admin", "hr", "wfm"),
  h(async (req, res) => res.json(apiSuccess(await updateAttendanceExceptionStatus(actor(req), req.params.id, "reopened", req.body, req)))),
);

// Aligned with the page gate: role_page_access grants WFM_LIVE_TRACKER (this router's
// pageCode) to super_admin, branch_head, branch_wfm, manager, process_manager and wfm in
// the live DB (verified 2026-08-27). admin/hr/ceo are kept on top — admin's page grant
// row exists but is inactive and hr has none at all, yet both already had API access
// before this change, so the union only adds roles, never removes one.
//
// /sync-status, /sync-runs and /sync-errors are device/run health with no per-employee
// rows, so the full union is safe for all three. /latest-punches DOES join to employees
// and return per-employee rows, so it keeps the narrower pre-existing role list on the
// route itself rather than inheriting the router-level union — a branch-scoped role
// (branch_head, branch_wfm, manager, process_manager) must not read another branch's
// punches through this merged console. requireRole runs router-level then route-level,
// so a role outside the narrow list still gets 403 on this one route even though it
// passed the router-level check.
const COSEC_RUN_ROLES = [
  "super_admin", "branch_head", "branch_wfm", "manager", "process_manager", "wfm",
  "admin", "hr", "ceo",
] as const;
const COSEC_PUNCH_ROLES = ["admin", "hr", "ceo", "wfm", "super_admin"] as const;

export const cosecMonitoringRouter = Router();
cosecMonitoringRouter.use(requireAuth);
cosecMonitoringRouter.use(requireRole(...COSEC_RUN_ROLES));
cosecMonitoringRouter.get("/sync-status", h(async (req, res) => res.json(apiSuccess(await getCosecSyncStatus(actor(req))))));
cosecMonitoringRouter.get("/sync-runs", h(async (req, res) => res.json(apiSuccess(await getCosecSyncRuns(actor(req))))));
cosecMonitoringRouter.get("/sync-errors", h(async (req, res) => res.json(apiSuccess(await getCosecSyncErrors(actor(req))))));
cosecMonitoringRouter.get(
  "/latest-punches",
  requireRole(...COSEC_PUNCH_ROLES),
  h(async (req, res) => res.json(apiSuccess(await getCosecLatestPunches(actor(req))))),
);

export const payrollReadinessRouter = Router();
payrollReadinessRouter.use(requireAuth);
payrollReadinessRouter.use(requireRole("admin", "hr", "ceo", "finance", "payroll"));
payrollReadinessRouter.get("/summary", h(async (req, res) => res.json(apiSuccess((await getPayrollReadiness(actor(req), req.query)).summary))));
payrollReadinessRouter.get("/blocked-employees", h(async (req, res) => res.json(apiSuccess((await getPayrollReadiness(actor(req), req.query)).blocked_employees))));
payrollReadinessRouter.get("/employee/:employeeId", h(async (req, res) => res.json(apiSuccess(await getPayrollReadiness(actor(req), { ...req.query, employee_id: req.params.employeeId })))));
payrollReadinessRouter.post("/scan", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await scanPayrollReadiness(actor(req), { ...req.query, ...req.body }, req)))));
payrollReadinessRouter.post("/mark-hold", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await updatePayrollHold(actor(req), String(req.body.employee_id), true, req.body.reason, req)))));
payrollReadinessRouter.post("/release-hold", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await updatePayrollHold(actor(req), String(req.body.employee_id), false, req.body.reason, req)))));

export const workforcePlanningRouter = Router();
workforcePlanningRouter.use(requireAuth);
workforcePlanningRouter.use(requireRole("admin", "hr", "ceo", "wfm", "process_manager", "manager"));
workforcePlanningRouter.get("/summary", h(async (req, res) => res.json(apiSuccess((await getWorkforcePlanning(actor(req), req.query)).summary))));
workforcePlanningRouter.get("/coverage", h(async (req, res) => res.json(apiSuccess((await getWorkforcePlanning(actor(req), req.query)).coverage))));
workforcePlanningRouter.get("/shortage", h(async (req, res) => res.json(apiSuccess((await getWorkforcePlanning(actor(req), req.query)).shortage))));
workforcePlanningRouter.get("/skill-matrix", h(async (req, res) => res.json(apiSuccess((await getWorkforcePlanning(actor(req), req.query)).skill_matrix))));
workforcePlanningRouter.get("/shift-gap", h(async (req, res) => res.json(apiSuccess((await getWorkforcePlanning(actor(req), req.query)).shift_gap))));
workforcePlanningRouter.post("/simulate-roster", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await simulateRoster(actor(req), req.body, req)))));
workforcePlanningRouter.post("/generate-draft-roster", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await createDraftRoster(actor(req), req.body, req)))));
workforcePlanningRouter.post("/manager-approval/:id", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await approveDraftRoster(actor(req), req.params.id, req.body.approved !== false, req)))));

export const enterpriseReportsRouter = Router();
enterpriseReportsRouter.use(requireAuth);
enterpriseReportsRouter.get(
  "/enterprise",
  requireRole("admin", "hr", "ceo", "finance", "payroll", "wfm", "process_manager", "manager"),
  h(async (req, res) => res.json(apiSuccess(await getEnterpriseReports(actor(req), req.query)))),
);

export const assistantContextRouter = Router();
assistantContextRouter.use(requireAuth);
assistantContextRouter.get("/me", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "me", req.query, req)))));
assistantContextRouter.get("/employee-summary/:employeeId", h(async (req, res) => res.json(apiSuccess(await getEmployeeAssistantSummary(actor(req), req.params.employeeId, req)))));
assistantContextRouter.get("/manager-team-summary", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "ceo-summary", req.query, req)))));
assistantContextRouter.get("/ceo-summary", requireRole("admin", "hr", "ceo"), h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "ceo-summary", req.query, req)))));
assistantContextRouter.get("/payroll-blockers", requireRole("admin", "hr", "finance", "payroll", "ceo"), h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "payroll-blockers", req.query, req)))));
assistantContextRouter.get("/attendance-risk", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "attendance-risk", req.query, req)))));
assistantContextRouter.get("/people-risk", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "people-risk", req.query, req)))));
assistantContextRouter.get("/support-risk", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "support-risk", req.query, req)))));
assistantContextRouter.get("/roster-risk", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "roster-risk", req.query, req)))));
