import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { canAccessCandidate, resolveCandidateScope } from "./candidate-access.js";
import { getCurrentDra, getDraHistory, listDraCandidates, recordHrDraDecision } from "./dra-certificate.service.js";

/** HR / admin view of SBI DRA certificates. Mounted at /api/ats/dra-certificates. */
export const draCertificateRouter = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};
draCertificateRouter.use(requireAuth);
draCertificateRouter.use(requireRole("admin", "super_admin", "hr", "payroll_hr", "branch_head", "recruiter", "ta_manager"));

// 404 (not 403) for a candidate outside the caller's branch scope, matching the other ATS routes.
draCertificateRouter.param("candidateId", (req, res, next, candidateId) => {
  void canAccessCandidate((req as AuthenticatedRequest).authUser!.id, String(candidateId))
    .then((ok) => (ok ? next() : res.status(404).json({ success: false, message: "Candidate not found" })))
    .catch(next);
});

/** GET /?status=pending|verified|invalid|expired|mismatch|not_uploaded */
draCertificateRouter.get("/", h(async (req, res) => {
  const scope = await resolveCandidateScope(req.authUser!.id, "c");
  const rows = await listDraCandidates({
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    scopeSql: scope.sql, scopeParams: scope.params, limit: Number(req.query.limit ?? 200),
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return res.json({ success: true, data: { rows, counts } });
}));

draCertificateRouter.get("/:candidateId", h(async (req, res) => {
  const id = String(req.params.candidateId);
  return res.json({ success: true, data: { current: await getCurrentDra(id), history: await getDraHistory(id) } });
}));

/** POST /:candidateId/decision  { result: 'verified'|'invalid'|'mismatch', note?, registrationNo?, serialNo?, securityCode?, certificateDate?, validUntil? } */
draCertificateRouter.post("/:candidateId/decision", h(async (req, res) => {
  const b = (req.body ?? {}) as Record<string, string>;
  const data = await recordHrDraDecision(String(req.params.candidateId), req.authUser!.id, {
    result: b.result as "verified" | "invalid" | "mismatch", note: b.note,
    registrationNo: b.registrationNo, serialNo: b.serialNo, securityCode: b.securityCode,
    certificateDate: b.certificateDate, validUntil: b.validUntil,
  });
  return res.json({ success: true, data });
}));
