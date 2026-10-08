/**
 * HR actions on candidate responses (mounted on heRouter): manual confirm after an off-system call, classify a free-text reply,
 * ignore one. WRITE roles only; scope is the caller's branch (outside scope answers 404). Errors carry fixed messages.
 */
import type { Request, Response, Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import { branchScopeOf } from "./he-stream.routes.js";
import { classifyResponse, ignoreResponse, manualResponse, ResponseActionError, type ManualAnswer, type ManualVia } from "./response-actions.service.js";
import type { ResponseAnswer } from "./response-normalise.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const NUM_RE = /^\d{1,18}$/;
const MANUAL: readonly string[] = ["confirm", "decline", "reschedule"];
const VIA: readonly string[] = ["phone_call", "walk_in_desk", "other"];
const ANSWERS: readonly string[] = ["confirm", "decline", "reschedule", "question", "unsubscribe", "no_answer", "on_my_way", "wrong_person", "other"];
const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function fail(res: Response, err: unknown, what: string): void {
  if (err instanceof ResponseActionError) { res.status(err.status).json({ success: false, message: err.message }); return; }
  logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, `[he-responses] ${what} failed`);
  res.status(500).json({ success: false, message: "Could not save. Please try again." });
}
const bad = (res: Response, message: string) => res.status(400).json({ success: false, message });

export function registerResponseRoutes(r: Router, roles: { view: readonly string[]; write: readonly string[] }): void {
  r.post("/responses/manual", requireAuth, requireRole(...roles.write), async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.requisitionId !== "string" || !UUID_RE.test(b.requisitionId)) return void bad(res, "Pick a requisition");
    if (!MANUAL.includes(String(b.answer))) return void bad(res, "Pick confirm, cannot come or another time");
    if (!VIA.includes(String(b.via))) return void bad(res, "Say how the candidate answered");
    if (typeof b.note !== "string") return void bad(res, "A note is required");
    const leadId = optStr(b.leadId), metaLeadId = optStr(b.metaLeadId);
    if ((leadId && !UUID_RE.test(leadId)) || (metaLeadId && !UUID_RE.test(metaLeadId))) return void bad(res, "Invalid id");
    try {
      const areq = req as AuthenticatedRequest;
      const out = await manualResponse({ actor: areq.authUser.id, mobile10: optStr(b.mobile10), leadId, metaLeadId, requisitionId: b.requisitionId,
        answer: b.answer as ManualAnswer, note: b.note, via: b.via as ManualVia }, await branchScopeOf(areq));
      res.json({ success: true, data: out });
    } catch (err) { fail(res, err, "manual"); }
  });

  r.post("/responses/:id/classify", requireAuth, requireRole(...roles.write), async (req: Request, res: Response) => {
    const id = String(req.params.id), b = (req.body ?? {}) as Record<string, unknown>;
    if (!NUM_RE.test(id)) return void bad(res, "Invalid id");
    if (!ANSWERS.includes(String(b.answer))) return void bad(res, "Unknown answer");
    try {
      const areq = req as AuthenticatedRequest;
      res.json({ success: true, data: await classifyResponse({ actor: areq.authUser.id, responseId: Number(id), answer: b.answer as ResponseAnswer, apply: b.apply !== false }, await branchScopeOf(areq)) });
    } catch (err) { fail(res, err, "classify"); }
  });

  r.post("/responses/:id/ignore", requireAuth, requireRole(...roles.write), async (req: Request, res: Response) => {
    const id = String(req.params.id), b = (req.body ?? {}) as Record<string, unknown>;
    if (!NUM_RE.test(id)) return void bad(res, "Invalid id");
    try {
      const areq = req as AuthenticatedRequest;
      await ignoreResponse({ actor: areq.authUser.id, responseId: Number(id), reason: String(b.reason ?? "") }, await branchScopeOf(areq));
      res.json({ success: true });
    } catch (err) { fail(res, err, "ignore"); }
  });
}
