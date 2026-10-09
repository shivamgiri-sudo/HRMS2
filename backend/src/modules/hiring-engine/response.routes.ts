/**
 * Candidate responses (mounted on heRouter). Reads (VIEW roles): the response list, the HR review queue, the per-channel summary, one
 * person's timeline and a drive's "confirmed to attend" list. HR actions (WRITE roles): manual confirm after an off-system call, classify a
 * free-text reply, ignore one. Scope is the caller's branch (outside scope answers 404). Errors carry fixed messages.
 */
import type { Request, Response, Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import { branchScopeOf, isIsoDate } from "./he-stream.routes.js";
import { normalizeMobile10 } from "./he-phone.js";
import { CHANNELS, MAX_LIMIT, driveConfirmed, listResponses, responseQueue, responseSummary, type ListQuery } from "./response-read.service.js";
import { personTimeline, type TimelineKey } from "./response-timeline.service.js";
import { addDays, istToday } from "./requisition-stream.window.js";
import { classifyResponse, ignoreResponse, manualResponse, ResponseActionError, type ManualAnswer, type ManualVia } from "./response-actions.service.js";
import type { ResponseAnswer } from "./response-normalise.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const NUM_RE = /^\d{1,18}$/;
const MANUAL: readonly string[] = ["confirm", "decline", "reschedule"];
const VIA: readonly string[] = ["phone_call", "walk_in_desk", "other"];
const ANSWERS: readonly string[] = ["confirm", "decline", "reschedule", "question", "unsubscribe", "no_answer", "on_my_way", "wrong_person", "other"];
const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const STATUSES: readonly string[] = ["applied", "needs_review", "ignored", "duplicate", "recorded"];
const TYPES: readonly string[] = ["meta_live", "meta_old", "he"];
const MAX_DAYS = 92;
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Validated list / summary filters, or the 400 message. Window: default the last 7 days (IST), at most 92 days. */
function filtersOf(q: Record<string, unknown>): Omit<ListQuery, "cursor" | "limit"> | string {
  const one = (k: string): string | undefined => (typeof q[k] === "string" && (q[k] as string) !== "" ? (q[k] as string) : undefined);
  const from0 = one("from"), to0 = one("to");
  if ((from0 && !isIsoDate(from0)) || (to0 && !isIsoDate(to0))) return "Pick valid dates";
  const to = to0 ?? istToday(), from = from0 ?? addDays(to, -6);
  if (from > to || dayDiff(from, to) + 1 > MAX_DAYS) return "Pick a range of at most 92 days";
  const ids: Record<string, string | null> = {};
  for (const k of ["campaignId", "requisitionId", "driveId"]) { const v = one(k); if (v && !UUID_RE.test(v)) return "Invalid id"; ids[k] = v ?? null; }
  const pickOf = (k: string, allowed: readonly string[]): string | null | false => { const v = one(k); return v === undefined ? null : allowed.includes(v) ? v : false; };
  const driveType = pickOf("driveType", TYPES), channel = pickOf("channel", CHANNELS), answer = pickOf("answer", ANSWERS), status = pickOf("status", STATUSES);
  if (driveType === false || channel === false || answer === false || status === false) return "Unknown filter value";
  const qText = one("q");
  const mobile10 = qText ? normalizeMobile10(qText) : null;
  if (qText && !mobile10) return "Search by a 10-digit mobile number";
  return { from, to, ...ids, driveType, channel, answer, status, mobile10 } as Omit<ListQuery, "cursor" | "limit">;
}
function readFail(res: Response, err: unknown, what: string): void {
  logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, `[he-responses] ${what} read failed`);
  res.status(500).json({ success: false, message: "Could not load the responses. Please try again." });
}

function fail(res: Response, err: unknown, what: string): void {
  if (err instanceof ResponseActionError) { res.status(err.status).json({ success: false, message: err.message }); return; }
  logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, `[he-responses] ${what} failed`);
  res.status(500).json({ success: false, message: "Could not save. Please try again." });
}
const bad = (res: Response, message: string) => res.status(400).json({ success: false, message });

export function registerResponseRoutes(r: Router, roles: { view: readonly string[]; write: readonly string[] }): void {
  const view = [requireAuth, requireRole(...roles.view)] as const;
  // The list and the summary read filters from the query string; a mobile search comes only in a POST body (never in a URL, so never in
  // an access log), and a GET carrying q is refused.
  const list = async (req: Request, res: Response, src: Record<string, unknown>) => {
    const f = filtersOf(src);
    if (typeof f === "string") return void bad(res, f);
    const lim = src.limit === undefined ? 50 : Number(src.limit), cursor = optStr(src.cursor);
    if (!Number.isInteger(lim) || lim < 1 || lim > MAX_LIMIT) return void bad(res, "Invalid limit");
    if (cursor && cursor.length > 80) return void bad(res, "Invalid cursor");
    try { res.json({ success: true, data: await listResponses({ ...f, limit: lim, cursor: cursor ?? null }, await branchScopeOf(req as AuthenticatedRequest)) }); }
    catch (err) { readFail(res, err, "list"); }
  };
  const summary = async (req: Request, res: Response, src: Record<string, unknown>) => {
    const f = filtersOf(src);
    if (typeof f === "string") return void bad(res, f);
    try { res.json({ success: true, data: await responseSummary(f, await branchScopeOf(req as AuthenticatedRequest)) }); } catch (err) { readFail(res, err, "summary"); }
  };
  const urlQuery = (req: Request, res: Response): Record<string, unknown> | null => {
    if ((req.query as Record<string, unknown>).q !== undefined) { bad(res, "Send the mobile search in the request body"); return null; }
    return req.query as Record<string, unknown>;
  };
  const bodyQuery = (req: Request, res: Response): Record<string, unknown> | null => {
    const b = req.body;
    if (!b || typeof b !== "object" || Array.isArray(b)) { bad(res, "Invalid search"); return null; }
    for (const v of Object.values(b)) if (v !== null && v !== undefined && typeof v !== "string" && typeof v !== "number") { bad(res, "Invalid search"); return null; }
    return b as Record<string, unknown>;
  };
  r.get("/responses", ...view, async (req: Request, res: Response) => { const q = urlQuery(req, res); if (q) await list(req, res, q); });
  r.post("/responses/search", ...view, async (req: Request, res: Response) => { const q = bodyQuery(req, res); if (q) await list(req, res, q); });
  r.get("/responses/queue", ...view, async (req: Request, res: Response) => {
    try { res.json({ success: true, data: await responseQueue(await branchScopeOf(req as AuthenticatedRequest)) }); } catch (err) { readFail(res, err, "queue"); }
  });
  r.get("/responses/summary", ...view, async (req: Request, res: Response) => { const q = urlQuery(req, res); if (q) await summary(req, res, q); });
  r.post("/responses/summary/search", ...view, async (req: Request, res: Response) => { const q = bodyQuery(req, res); if (q) await summary(req, res, q); });
  // One person's timeline by a response, match or lead id (never a mobile in the URL); exactly one key.
  r.get("/responses/timeline", ...view, async (req: Request, res: Response) => {
    const rid = optStr(req.query.responseId), mid = optStr(req.query.matchId), lid = optStr(req.query.leadId);
    if ([rid, mid, lid].filter(Boolean).length !== 1) return void bad(res, "Give one of responseId, matchId or leadId");
    if ((rid && !NUM_RE.test(rid)) || (mid && !UUID_RE.test(mid)) || (lid && !UUID_RE.test(lid))) return void bad(res, "Invalid id");
    const key: TimelineKey = rid ? { responseId: Number(rid) } : mid ? { matchId: mid } : { leadId: lid as string };
    try {
      const t = await personTimeline(key, await branchScopeOf(req as AuthenticatedRequest));
      if (!t) return void res.status(404).json({ success: false, message: "Candidate not found" });
      res.json({ success: true, data: t });
    } catch (err) { readFail(res, err, "timeline"); }
  });
  // Confirmed to attend (also the arrival checklist); a drive outside the caller's branch is 404.
  r.get("/drives/:id/confirmed", ...view, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) return void res.status(404).json({ success: false, message: "Drive not found" });
    try {
      const d = await driveConfirmed(id, await branchScopeOf(req as AuthenticatedRequest));
      if (!d) return void res.status(404).json({ success: false, message: "Drive not found" });
      res.json({ success: true, data: d });
    } catch (err) { readFail(res, err, "confirmed list"); }
  });

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
