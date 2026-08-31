import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  approveSalaryProposal,
  generateEmployeeCode,
  getJoiningControlRoomCandidate,
  listJoiningControlRoomQueue,
  lockSalaryRegister,
  requestDpdpWithdrawal,
  saveJclrDetails,
  savePayrollControlRoomDetails,
  saveStatutoryDeclaration,
  upsertDpdpConsent,
  validateReadiness,
} from "./joining-control-room.service.js";

export const joiningControlRoomRouter = Router();

import type { RoleKey } from "../../platform/policy/index.js";
/*
 * These four roles, and not the eight this list used to carry.
 *
 * The only consumer of these endpoints is SecureDocumentList / SecureDocumentViewer, rendered
 * solely by NativeJoiningControlRoom. That page admits exactly ['admin','hr','payroll_hr',
 * 'super_admin'] — in its ProtectedRoute (recruitment.routes.tsx) and again in its navConfig
 * entry. The list here additionally carried branch_head, finance, operations_manager and it,
 * none of which can reach the page at all.
 *
 * That is capability drift in the dangerous direction: the UI was the narrower gate and the API
 * the wider one, so the extra four could not see the screen but could call the endpoints
 * directly — streaming or downloading ANY candidate's identity documents by id, and reading the
 * access log of who else had viewed them.
 *
 * There is no row scope behind this list to soften it. actorId reaches only
 * auditDocumentAccess; nothing in the service checks ownership, assignment or branch. The role
 * list IS the whole access control, which is why it has to match the surface that uses it.
 *
 * A candidate-level ownership check would be better still, but it is a separate decision: this
 * is the only candidate-document API in the codebase, so there is no established rule to copy,
 * and the obvious scope is unusable because job_requisition.branch_id is NULL on every row.
 */
const roles: RoleKey[] = ["super_admin", "admin", "hr", "payroll_hr"];
// requireRole only reads req.authUser (set by requireAuth decoding the JWT) — without
// requireAuth running first, req.authUser is always undefined and every request here
// 401s regardless of a valid Bearer token. This mount had requireRole with no requireAuth
// in front of it, so /api/ats/joining-control-room/* was completely unreachable for every
// role, every time. Sibling routers (e.g. ats.joiningDocumentsTracker.routes.ts) call both.
joiningControlRoomRouter.use(requireAuth);
joiningControlRoomRouter.use(requireRole(...roles));

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (
  req: AuthenticatedRequest,
  res: any,
  next: any,
) => fn(req, res).catch(next);

joiningControlRoomRouter.get("/queue", h(async (req, res) => {
  const data = await listJoiningControlRoomQueue(String(req.query.search || ""));
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.get("/candidates/:candidateId", h(async (req, res) => {
  const data = await getJoiningControlRoomCandidate(req.params.candidateId);
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.put("/candidates/:candidateId/payroll", h(async (req, res) => {
  const data = await savePayrollControlRoomDetails(req.params.candidateId, req.body || {}, req.authUser!.id);
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.put("/candidates/:candidateId/jclr", h(async (req, res) => {
  const data = await saveJclrDetails(req.params.candidateId, req.body || {}, req.authUser!.id);
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.put("/candidates/:candidateId/statutory", h(async (req, res) => {
  const data = await saveStatutoryDeclaration(req.params.candidateId, req.body || {}, req.authUser!.id);
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.post("/candidates/:candidateId/dpdp-consent", h(async (req, res) => {
  const data = await upsertDpdpConsent(req.params.candidateId, req.body || {}, req.authUser!.id);
  return res.status(201).json({ success: true, data });
}));

joiningControlRoomRouter.post("/candidates/:candidateId/dpdp-withdrawal", h(async (req, res) => {
  const data = await requestDpdpWithdrawal(req.params.candidateId, req.body || {}, req.authUser!.id);
  return res.status(201).json({ success: true, data });
}));

joiningControlRoomRouter.post("/candidates/:candidateId/readiness", h(async (req, res) => {
  const data = await validateReadiness(req.params.candidateId);
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.post("/candidates/:candidateId/salary-register/lock", h(async (req, res) => {
  const data = await lockSalaryRegister(req.params.candidateId, req.authUser!.id);
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.post("/candidates/:candidateId/salary-proposal/approve", h(async (req, res) => {
  const data = await approveSalaryProposal(req.params.candidateId, req.body || {}, req.authUser!.id);
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.post("/candidates/:candidateId/employee-code", h(async (req, res) => {
  const data = await generateEmployeeCode(req.params.candidateId, req.authUser!.id);
  return res.status(201).json({ success: true, data });
}));
