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
  getCosecMonitoring,
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
  requireRole("admin", "hr", "super_admin", "ceo", "finance", "process_manager", "manager"),
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
  requireRole("admin", "hr", "super_admin", "ceo", "wfm", "process_manager", "manager", "team_leader", "tl"),
  h(async (req, res) => res.json(apiSuccess(await getAttendanceExceptionSummary(actor(req), req.query)))),
);
attendanceExceptionRouter.get(
  "/list",
  requireRole("admin", "hr", "super_admin", "ceo", "wfm", "process_manager", "manager", "team_leader", "tl"),
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

export const cosecMonitoringRouter = Router();
cosecMonitoringRouter.use(requireAuth);
cosecMonitoringRouter.use(requireRole("admin", "hr", "super_admin", "ceo", "wfm"));
cosecMonitoringRouter.get("/sync-status", h(async (req, res) => {
  const data = await getCosecMonitoring(actor(req));
  return res.json(apiSuccess({ status: data.status, latest_run: data.latest_run, data_confidence: data.data_confidence }));
}));
cosecMonitoringRouter.get("/sync-runs", h(async (req, res) => res.json(apiSuccess((await getCosecMonitoring(actor(req))).sync_runs))));
cosecMonitoringRouter.get("/sync-errors", h(async (req, res) => res.json(apiSuccess((await getCosecMonitoring(actor(req))).sync_errors))));
cosecMonitoringRouter.get("/latest-punches", h(async (req, res) => res.json(apiSuccess((await getCosecMonitoring(actor(req))).latest_punches))));

export const payrollReadinessRouter = Router();
payrollReadinessRouter.use(requireAuth);
payrollReadinessRouter.use(requireRole("admin", "hr", "super_admin", "ceo", "finance", "payroll", "payroll_hr", "branch_hr"));
payrollReadinessRouter.get("/summary", h(async (req, res) => res.json(apiSuccess((await getPayrollReadiness(actor(req), req.query)).summary))));
payrollReadinessRouter.get("/blocked-employees", h(async (req, res) => res.json(apiSuccess((await getPayrollReadiness(actor(req), req.query)).blocked_employees))));
payrollReadinessRouter.get("/employee/:employeeId", h(async (req, res) => res.json(apiSuccess(await getPayrollReadiness(actor(req), { ...req.query, employee_id: req.params.employeeId })))));
payrollReadinessRouter.post("/scan", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await scanPayrollReadiness(actor(req), { ...req.query, ...req.body }, req)))));
payrollReadinessRouter.post("/mark-hold", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await updatePayrollHold(actor(req), String(req.body.employee_id), true, req.body.reason, req)))));
payrollReadinessRouter.post("/release-hold", requireWriteAccess, h(async (req, res) => res.json(apiSuccess(await updatePayrollHold(actor(req), String(req.body.employee_id), false, req.body.reason, req)))));

export const workforcePlanningRouter = Router();
workforcePlanningRouter.use(requireAuth);
workforcePlanningRouter.use(requireRole("admin", "hr", "super_admin", "ceo", "wfm", "process_manager", "manager"));
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
  requireRole("admin", "hr", "super_admin", "ceo", "finance", "payroll", "wfm", "process_manager", "manager"),
  h(async (req, res) => res.json(apiSuccess(await getEnterpriseReports(actor(req), req.query)))),
);

export const assistantContextRouter = Router();
assistantContextRouter.use(requireAuth);
assistantContextRouter.get("/me", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "me", req.query, req)))));
assistantContextRouter.get("/employee-summary/:employeeId", h(async (req, res) => res.json(apiSuccess(await getEmployeeAssistantSummary(actor(req), req.params.employeeId, req)))));
assistantContextRouter.get("/manager-team-summary", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "ceo-summary", req.query, req)))));
assistantContextRouter.get("/ceo-summary", requireRole("admin", "hr", "super_admin", "ceo"), h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "ceo-summary", req.query, req)))));
assistantContextRouter.get("/payroll-blockers", requireRole("admin", "hr", "super_admin", "finance", "payroll", "ceo"), h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "payroll-blockers", req.query, req)))));
assistantContextRouter.get("/attendance-risk", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "attendance-risk", req.query, req)))));
assistantContextRouter.get("/people-risk", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "people-risk", req.query, req)))));
assistantContextRouter.get("/support-risk", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "support-risk", req.query, req)))));
assistantContextRouter.get("/roster-risk", h(async (req, res) => res.json(apiSuccess(await getAssistantContext(actor(req), "roster-risk", req.query, req)))));
