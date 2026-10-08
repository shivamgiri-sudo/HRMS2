import { Router } from "express";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { describeSkip, sendPendencyReminders } from "../payroll/pendency/pendency.service.js";
import {
  approveSalaryProposal,
  generateEmployeeCode,
  getJoiningControlRoomCandidate,
  listJoiningControlRoomQueue,
  lockSalaryRegister,
  recheckEsignStatus,
  requestDpdpWithdrawal,
  redispatchDeadEsignKit,
  resendEsignLink,
  syncBankDetailFromOnboarding,
  syncDpdpConsentFromOnboarding,
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

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

/**
 * Branch RBAC for this screen. Same rule as the appointment-letter pages: a user's role scope rows
 * decide which branches they may see ("1=1" for org-wide / super_admin), and the optional
 * ?branch_id= filter can only narrow within that, never widen it.
 */
async function branchScopeFor(req: AuthenticatedRequest) {
  return buildScopeWhereClause(req.authUser!.id, [...roles], { branchId: "b.id" });
}

/** null = unrestricted; otherwise every id and name of the allowed branches. */
async function allowedBranchKeys(req: AuthenticatedRequest, requested?: string): Promise<string[] | null> {
  const scope = await branchScopeFor(req);
  const wanted = requested?.trim() || "";
  if (scope.sql === "1=1" && !wanted) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.id, b.branch_name FROM branch_master b WHERE (${scope.sql})${wanted ? " AND b.id = ?" : ""}`,
    wanted ? [...scope.params, wanted] : scope.params,
  );
  return (rows as RowDataPacket[]).flatMap((r) => [String(r.id), String(r.branch_name ?? "")].filter(Boolean));
}

// Every /candidates/:candidateId/* route takes an id from the URL, so list scoping alone would leave
// the whole screen reachable by id from another branch. Checked once here, for all of them.
joiningControlRoomRouter.param("candidateId", async (req, res, next, candidateId) => {
  try {
    const scope = await branchScopeFor(req as AuthenticatedRequest);
    if (scope.sql === "1=1") return next();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 AS ok FROM ats_candidate c
         JOIN branch_master b ON b.id = c.applied_for_branch OR b.branch_name = c.applied_for_branch
        WHERE c.id = ? AND (${scope.sql}) LIMIT 1`,
      [candidateId, ...scope.params],
    );
    if (!(rows as RowDataPacket[]).length) {
      return res.status(403).json({ success: false, message: "Forbidden: this candidate is outside your assigned branch scope" });
    }
    return next();
  } catch (error) {
    return next(error);
  }
});

joiningControlRoomRouter.get("/queue", h(async (req, res) => {
  const branchKeys = await allowedBranchKeys(req, typeof req.query.branch_id === "string" ? req.query.branch_id : undefined);
  const data = await listJoiningControlRoomQueue(String(req.query.search || ""), branchKeys);
  return res.json({ success: true, data });
}));

joiningControlRoomRouter.get(
  "/candidates/:candidateId",
  h(async (req, res) => {
    const data = await getJoiningControlRoomCandidate(req.params.candidateId);
    return res.json({ success: true, data });
  }),
);

joiningControlRoomRouter.put(
  "/candidates/:candidateId/payroll",
  h(async (req, res) => {
    const data = await savePayrollControlRoomDetails(
      req.params.candidateId,
      req.body || {},
      req.authUser!.id,
      req.authUser!.roles,
    );
    return res.json({ success: true, data });
  }),
);

joiningControlRoomRouter.put(
  "/candidates/:candidateId/jclr",
  h(async (req, res) => {
    const data = await saveJclrDetails(
      req.params.candidateId,
      req.body || {},
      req.authUser!.id,
    );
    return res.json({ success: true, data });
  }),
);

joiningControlRoomRouter.put(
  "/candidates/:candidateId/statutory",
  h(async (req, res) => {
    const data = await saveStatutoryDeclaration(
      req.params.candidateId,
      req.body || {},
      req.authUser!.id,
    );
    return res.json({ success: true, data });
  }),
);

joiningControlRoomRouter.post(
  "/candidates/:candidateId/dpdp-consent",
  h(async (req, res) => {
    const data = await upsertDpdpConsent(
      req.params.candidateId,
      req.body || {},
      req.authUser!.id,
    );
    return res.status(201).json({ success: true, data });
  }),
);

joiningControlRoomRouter.post(
  "/candidates/:candidateId/dpdp-withdrawal",
  h(async (req, res) => {
    const data = await requestDpdpWithdrawal(
      req.params.candidateId,
      req.body || {},
      req.authUser!.id,
    );
    return res.status(201).json({ success: true, data });
  }),
);

joiningControlRoomRouter.post(
  "/candidates/:candidateId/readiness",
  h(async (req, res) => {
    const data = await validateReadiness(req.params.candidateId);
    return res.json({ success: true, data });
  }),
);

joiningControlRoomRouter.post(
  "/candidates/:candidateId/esign/recheck",
  h(async (req, res) => {
    const result = await recheckEsignStatus(req.params.candidateId);
    const data = await getJoiningControlRoomCandidate(req.params.candidateId);
    return res.json({ success: true, data: { ...data, recheck: result } });
  }),
);

joiningControlRoomRouter.post(
  "/candidates/:candidateId/esign/resend-link",
  h(async (req, res) => {
    const candidateId = req.params.candidateId;
    const result = await resendEsignLink(candidateId, req.authUser!.id);
    if (!result.resent) {
      // Non-2xx so the UI's generic action() helper surfaces this exact reason
      // instead of showing its fixed "Signing link re-sent" success toast for a
      // resend that did not actually happen — there was no kit awaiting a
      // signature, or the employee has no email on file, are common and real,
      // not exceptional.
      return res.status(409).json({ success: false, message: result.message });
    }
    const data = await getJoiningControlRoomCandidate(candidateId);
    return res.json({ success: true, data: { ...data, resend: result } });
  }),
);

// Real provider cost: a brand-new Luckpay signing session, for a kit whose
// existing one has already died. Never called by any worker — human-only,
// same discipline as dispatchJoiningKit's own no-retry rule.
joiningControlRoomRouter.post(
  "/candidates/:candidateId/esign/redispatch-dead-kit",
  h(async (req, res) => {
    const candidateId = req.params.candidateId;
    const result = await redispatchDeadEsignKit(candidateId, req.authUser!.id);
    const data = await getJoiningControlRoomCandidate(candidateId);
    return res.json({
      success: result.status === "sent",
      data: { ...data, redispatch: result },
    });
  }),
);

joiningControlRoomRouter.post(
  "/candidates/:candidateId/bank-detail/sync",
  h(async (req, res) => {
    const candidateId = req.params.candidateId;
    const [bridge] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM ats_onboarding_bridge WHERE candidate_id = ? LIMIT 1`,
      [candidateId],
    );
    const employeeId = (bridge as RowDataPacket[])[0]?.employee_id;
    if (!employeeId) {
      return res
        .status(409)
        .json({
          success: false,
          message: "No employee record exists yet for this candidate",
        });
    }
    const result = await syncBankDetailFromOnboarding(
      String(employeeId),
      candidateId,
      req.authUser!.id,
    );
    const data = await getJoiningControlRoomCandidate(candidateId);
    return res.json({ success: true, data: { ...data, bankSync: result } });
  }),
);

// Email the employee a link to finish DigiLocker verification. Reuses the existing onboarding
// link and never mints a new one (that would invalidate the link already in their inbox).
// Cooldown, cap and the pendency_reminder_log row come from the shared pendency service.
joiningControlRoomRouter.post("/candidates/:candidateId/digilocker/remind", h(async (req, res) => {
  const candidateId = req.params.candidateId;
  const [bridge] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM ats_onboarding_bridge WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  const employeeId = (bridge as RowDataPacket[])[0]?.employee_id;
  if (!employeeId) {
    return res.status(409).json({ success: false, message: "No employee record exists yet for this candidate" });
  }
  const [result] = await sendPendencyReminders({
    kind: "digilocker",
    employeeIds: [String(employeeId)],
    sentBy: req.authUser!.id,
    trigger: "manual",
  });
  if (result.status !== "sent") {
    return res.status(409).json({
      success: false,
      message: result.status === "failed" ? `Email could not be sent: ${result.reason ?? "unknown error"}` : describeSkip(result.reason),
    });
  }
  const data = await getJoiningControlRoomCandidate(candidateId);
  return res.json({ success: true, data: { ...data, digilockerReminder: result } });
}));

joiningControlRoomRouter.post("/candidates/:candidateId/dpdp-consent/sync", h(async (req, res) => {
  const candidateId = req.params.candidateId;
  const result = await syncDpdpConsentFromOnboarding(candidateId, req.authUser!.id);
  const data = await getJoiningControlRoomCandidate(candidateId);
  return res.json({ success: true, data: { ...data, dpdpSync: result } });
}));

joiningControlRoomRouter.post(
  "/candidates/:candidateId/salary-register/lock",
  h(async (req, res) => {
    const data = await lockSalaryRegister(
      req.params.candidateId,
      req.authUser!.id,
    );
    return res.json({ success: true, data });
  }),
);

joiningControlRoomRouter.post(
  "/candidates/:candidateId/salary-proposal/approve",
  h(async (req, res) => {
    const data = await approveSalaryProposal(
      req.params.candidateId,
      req.body || {},
      req.authUser!.id,
    );
    return res.json({ success: true, data });
  }),
);

joiningControlRoomRouter.post(
  "/candidates/:candidateId/employee-code",
  h(async (req, res) => {
    const data = await generateEmployeeCode(
      req.params.candidateId,
      req.authUser!.id,
    );
    return res.status(201).json({ success: true, data });
  }),
);
