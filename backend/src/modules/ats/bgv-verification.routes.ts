import { Router, type Request, type Response, type NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasScopedAccess, buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { env } from "../../config/env.js";
import {
  getBgvStatusByToken,
  getBgvStatusForCandidate,
  listBgvQueueScoped,
  manualReview,
  providerCallback,
  saveBgvConsentByToken,
  startDigilockerByToken,
  verifyAadhaarOfflineByToken,
  verifyBankByToken,
  verifyBankForCandidate,
  verifyPanByToken,
  verifyPanForCandidate,
  waiveCheck,
} from "./bgv-verification.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { atsService } from "./ats.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") ?? undefined });

async function requireBgvCandidateScope(req: AuthenticatedRequest, candidateId: string): Promise<void> {
  const candidate = await atsService.getCandidate(candidateId);
  const allowed = await hasScopedAccess(req.authUser!.id, ["admin", "hr", "recruiter"], { branchId: candidate.applied_for_branch ?? undefined, processId: candidate.applied_for_process ?? undefined }, { allowAdminBypass: true });
  if (!allowed) throw Object.assign(new Error("Access denied"), { statusCode: 403 });
}

// Public token-driven candidate BGV routes. Mount before global requireAuth.
router.post("/consent", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.status(201).json({ success: true, data: await saveBgvConsentByToken(token, req.body, meta(req)) });
}));

router.get("/status", h(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await getBgvStatusByToken(token) });
}));

router.post("/verify/pan", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await verifyPanByToken(token, req.body, meta(req)) });
}));

router.post("/verify/bank", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await verifyBankByToken(token, req.body, meta(req)) });
}));

router.post("/verify/aadhaar-offline", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await verifyAadhaarOfflineByToken(token, req.body, meta(req)) });
}));

router.post("/digilocker/start", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await startDigilockerByToken(token, Array.isArray(req.body.requestedDocuments) ? req.body.requestedDocuments : [], meta(req)) });
}));

// CI-BGV-01: HMAC-SHA256 signature validation
router.post("/provider/callback", h(async (req: Request & { rawBody?: Buffer }, res) => {
  const secret = env.BGV_WEBHOOK_SECRET;
  if (!secret) {
    if (env.NODE_ENV === "production") return res.status(503).json({ success: false, message: "Webhook not configured" });
    console.warn("[BGV] BGV_WEBHOOK_SECRET not set — skipping signature check in non-production mode");
  } else {
    const sigHeader = req.get("x-bgv-signature") ?? "";
    if (!sigHeader) return res.status(401).json({ success: false, message: "Missing x-bgv-signature header" });
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    let match = false;
    try {
      match = timingSafeEqual(Buffer.from(sigHeader, "hex"), Buffer.from(expected, "hex"));
    } catch {
      match = false;
    }
    if (!match) return res.status(401).json({ success: false, message: "Invalid webhook signature" });
  }
  return res.json({ success: true, data: await providerCallback(req.body) });
}));

// HR/BGV/Admin protected routes — all have role check + row-scope
router.get("/queue", requireAuth, requireRole("admin", "hr", "recruiter"), h(async (req: AuthenticatedRequest, res) => {
  const scoped = await buildScopeWhereClause(req.authUser!.id, ["admin", "hr", "recruiter"], { branchId: "c.applied_for_branch", processId: "c.applied_for_process" }, { allowAdminBypass: true });
  return res.json({ success: true, data: await listBgvQueueScoped(req.query.status as string | undefined, scoped) });
}));

router.get("/candidates/:candidateId", requireAuth, requireRole("admin", "hr", "recruiter"), h(async (req: AuthenticatedRequest, res) => {
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await getBgvStatusForCandidate(req.params.candidateId) });
}));

router.post("/candidates/:candidateId/verify/pan", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await verifyPanForCandidate(req.params.candidateId, req.body, { actorType: "hr", actorId: req.authUser!.id }) });
}));

router.post("/candidates/:candidateId/verify/bank", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await verifyBankForCandidate(req.params.candidateId, req.body, { actorType: "hr", actorId: req.authUser!.id }) });
}));

router.post("/candidates/:candidateId/manual-review", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!req.body.remarks) return res.status(400).json({ success: false, message: "remarks required" });
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await manualReview(req.params.candidateId, req.body, req.authUser!.id) });
}));

router.post("/candidates/:candidateId/waive", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!req.body.reason) return res.status(400).json({ success: false, message: "reason required" });
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await waiveCheck(req.params.candidateId, req.body, req.authUser!.id) });
}));

export default router;
