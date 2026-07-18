import { Router } from "express";
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
const roles: RoleKey[] = ["super_admin", "admin", "hr", "payroll_hr", "branch_head", "finance", "operations", "it_admin"];
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
