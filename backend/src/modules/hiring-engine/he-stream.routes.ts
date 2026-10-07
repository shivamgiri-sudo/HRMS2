/**
 * Source stream, readiness and "Plan now" routes (mounted on heRouter). Reads need VIEW roles, changes and Plan now WRITE roles.
 * A requisition outside the caller's branch answers 404 (never 403). Errors carry fixed messages; the real error is logged
 * without candidate data and never sent to the client.
 */
import type { Request, Response, Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { resolveBranchScope, type BranchScope } from "../meta-campaign/meta-access.js";
import { getRequisitionReadiness } from "./he-readiness.service.js";
import { nextWorkingDay } from "./he-plan.service.js";
import { planStreamsForDay } from "./he-stream-plan.service.js";
import { getRequisitionSources } from "./he-requisition-sources.service.js";
import type { SourceType } from "./qualified-followup.types.js";
import {
  StreamError, getStream, listStreamEvents, listStreams, loadActiveStreams, toWindow, tryChangeStream, tryCreateStream,
  type StreamActor, type StreamChangeInput, type StreamFail,
} from "./requisition-stream.service.js";
import { NEVER_OVERRIDE } from "./requisition-readiness.js";
import { addDays, coversDay, istToday } from "./requisition-stream.window.js";

export interface StreamRoles { view: readonly string[]; write: readonly string[]; admin: readonly string[] }

const ID_RE = /^[0-9a-f-]{36}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES: readonly string[] = ["meta_live", "meta_old", "he"];
const ACTIONS: readonly string[] = ["open", "pause", "close", "reopen", "extend", "extend_to", "add_day", "skip_day", "shorten"];
const PLAN_MAX_AHEAD = 7;

export async function branchScopeOf(req: AuthenticatedRequest): Promise<BranchScope> {
  const held = (req as unknown as { userRoles?: string[] }).userRoles;
  return resolveBranchScope(req.authUser.id, (held?.length ? held : [req.authUser.role ?? ""]).filter(Boolean));
}

const rolesOf = (req: AuthenticatedRequest): string[] => {
  const held = (req as unknown as { userRoles?: string[] }).userRoles;
  return (held?.length ? held : [req.authUser.role ?? ""]).filter(Boolean);
};

/** Logged error text: first line, long digit runs masked (a driver message can echo values). */
const logText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split("\n")[0].replace(/\d{6,}/g, "#").slice(0, 200);

function sendFail(res: Response, f: Pick<StreamFail, "statusCode" | "message" | "problems">, generic: string): void {
  if (f.statusCode === 500) { res.status(500).json({ success: false, message: generic }); return; }
  res.status(f.statusCode).json({ success: false, message: f.message, ...(f.problems ? { problems: f.problems } : {}) });
}

function sendError(res: Response, err: unknown, generic: string, what: string): void {
  if (err instanceof StreamError) { sendFail(res, err, generic); return; }
  logger.error({ err: logText(err) }, `[he-streams] ${what} failed`);
  res.status(500).json({ success: false, message: generic });
}

/** True when the requisition exists and the caller's branch scope covers it; false means answer 404. */
async function requisitionInScope(id: string, scope: BranchScope): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1", [id]);
  if (!rows[0]) return false;
  if (scope.all) return true;
  return scope.branchName != null && String(rows[0].branch_name) === scope.branchName;
}

const bodyOf = (req: Request): Record<string, unknown> => (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {});
const bad = (res: Response, message: string): void => { res.status(400).json({ success: false, message }); };

export function registerStreamRoutes(r: Router, roles: StreamRoles): void {
  const view = [requireAuth, requireRole(...roles.view)] as const;
  const write = [requireAuth, requireRole(...roles.write)] as const;
  const actorOf = async (req: Request): Promise<StreamActor> => {
    const areq = req as AuthenticatedRequest;
    return { userId: areq.authUser.id ?? null, isAdmin: rolesOf(areq).some((x) => roles.admin.includes(x)), scope: await branchScopeOf(areq) };
  };

  r.get("/requisition-streams", ...view, async (req, res) => {
    try {
      const rid = req.query.requisitionId;
      if (typeof rid !== "string" || !ID_RE.test(rid)) return bad(res, "requisitionId is required");
      res.json({ success: true, data: await listStreams(rid, await branchScopeOf(req as AuthenticatedRequest)) });
    } catch (err) { sendError(res, err, "Could not load streams", "list"); }
  });

  r.get("/requisition-streams/:id", ...view, async (req, res) => {
    try {
      if (!ID_RE.test(String(req.params.id))) return bad(res, "Invalid id");
      const s = await getStream(String(req.params.id), await branchScopeOf(req as AuthenticatedRequest));
      if (!s) return void res.status(404).json({ success: false, message: "Stream not found" });
      res.json({ success: true, data: s });
    } catch (err) { sendError(res, err, "Could not load streams", "get"); }
  });

  r.get("/requisition-streams/:id/events", ...view, async (req, res) => {
    try {
      if (!ID_RE.test(String(req.params.id))) return bad(res, "Invalid id");
      const ev = await listStreamEvents(String(req.params.id), await branchScopeOf(req as AuthenticatedRequest));
      if (!ev) return void res.status(404).json({ success: false, message: "Stream not found" });
      res.json({ success: true, data: ev });
    } catch (err) { sendError(res, err, "Could not load streams", "events"); }
  });

  r.post("/requisition-streams", ...write, async (req, res) => {
    try {
      const b = bodyOf(req);
      if (typeof b.requisitionId !== "string" || !ID_RE.test(b.requisitionId)) return bad(res, "Invalid id");
      if (typeof b.sourceType !== "string" || !SOURCES.includes(b.sourceType)) return bad(res, "Source type must be meta_live, meta_old or he");
      if (typeof b.originId !== "string" || !b.originId || b.originId.length > 64) return bad(res, "originId is required");
      if (typeof b.openFrom !== "string" || !ISO_RE.test(b.openFrom)) return bad(res, "Pick a valid date");
      if (typeof b.openDays !== "number" || !Number.isInteger(b.openDays) || b.openDays < 1 || b.openDays > 60) return bad(res, "Open days must be a whole number from 1 to 60");
      if (b.dailyInvites != null && (typeof b.dailyInvites !== "number" || !Number.isInteger(b.dailyInvites) || b.dailyInvites < 1 || b.dailyInvites > 500)) return bad(res, "Daily invites must be a whole number from 1 to 500");
      if (b.originLabel != null && (typeof b.originLabel !== "string" || b.originLabel.length > 200)) return bad(res, "Label is too long");
      if (b.reason != null && (typeof b.reason !== "string" || b.reason.length > 255)) return bad(res, "Reason must be at most 255 characters");
      const actor = await actorOf(req);
      // Only an admin may override a blocking readiness problem (the service also ignores it otherwise and never lifts NEVER_OVERRIDE codes).
      const out = await tryCreateStream({
        requisitionId: b.requisitionId, sourceType: b.sourceType as SourceType, originId: b.originId, originLabel: (b.originLabel as string | null | undefined) ?? null,
        openFrom: b.openFrom, openDays: b.openDays, dailyInvites: (b.dailyInvites as number | null | undefined) ?? null,
        open: b.open === true, override: b.override === true && actor.isAdmin, reason: (b.reason as string | null | undefined) ?? null,
      }, actor);
      if (!out.ok) return sendFail(res, out, "Could not update the stream");
      res.json({ success: true, data: out.stream });
    } catch (err) { sendError(res, err, "Could not update the stream", "create"); }
  });

  r.post("/requisition-streams/:id/change", ...write, async (req, res) => {
    try {
      if (!ID_RE.test(String(req.params.id))) return bad(res, "Invalid id");
      const b = bodyOf(req);
      if (typeof b.action !== "string" || !ACTIONS.includes(b.action)) return bad(res, "Unknown action");
      if (b.days != null && (typeof b.days !== "number" || !Number.isInteger(b.days))) return bad(res, "Days must be a whole number");
      for (const k of ["toDate", "day"] as const) if (b[k] != null && (typeof b[k] !== "string" || !ISO_RE.test(b[k] as string))) return bad(res, "Pick a valid date");
      if (b.reason != null && (typeof b.reason !== "string" || b.reason.length > 255)) return bad(res, "Reason must be at most 255 characters");
      const actor = await actorOf(req);
      const input: StreamChangeInput = {
        action: b.action as StreamChangeInput["action"], days: b.days as number | undefined, toDate: b.toDate as string | undefined,
        day: b.day as string | undefined, reason: (b.reason as string | null | undefined) ?? null, override: b.override === true && actor.isAdmin,
      };
      const out = await tryChangeStream(String(req.params.id), input, actor);
      if (!out.ok) return sendFail(res, out, "Could not update the stream");
      res.json({ success: true, changed: out.changed, data: out.stream });
    } catch (err) { sendError(res, err, "Could not update the stream", "change"); }
  });

  r.get("/requisitions/:id/readiness", ...view, async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!ID_RE.test(id)) return bad(res, "Invalid id");
      const st = req.query.sourceType;
      if (st != null && (typeof st !== "string" || !SOURCES.includes(st))) return bad(res, "Source type must be meta_live, meta_old or he");
      if (!(await requisitionInScope(id, await branchScopeOf(req as AuthenticatedRequest)))) return void res.status(404).json({ success: false, message: "Requisition not found" });
      const data = await getRequisitionReadiness(id, (st as SourceType | undefined) ?? null);
      if (!data) return void res.status(404).json({ success: false, message: "Requisition not found" });
      res.json({ success: true, data: { ...data, neverOverride: [...NEVER_OVERRIDE] } });
    } catch (err) { sendError(res, err, "Could not load streams", "readiness"); }
  });

  // Per-requisition source funnel (counts, labels and ids only). Outside the caller's branch answers 404, like the other stream reads.
  r.get("/requisition-sources", ...view, async (req, res) => {
    try {
      const rid = req.query.requisitionId;
      if (typeof rid !== "string" || !ID_RE.test(rid)) return bad(res, "requisitionId is required");
      const data = await getRequisitionSources(rid, await branchScopeOf(req as AuthenticatedRequest));
      if (!data) return void res.status(404).json({ success: false, message: "Requisition not found" });
      res.json({ success: true, data });
    } catch (err) { sendError(res, err, "Could not load sources", "sources"); }
  });

  r.post("/requisitions/:id/plan-now", ...write, async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!ID_RE.test(id)) return bad(res, "Invalid id");
      const b = bodyOf(req);
      if (b.date != null && (typeof b.date !== "string" || !ISO_RE.test(b.date) || Number.isNaN(Date.parse(`${b.date}T00:00:00Z`)))) return bad(res, "Pick a day after today, at most 7 days ahead");
      if (b.dryRun != null && typeof b.dryRun !== "boolean") return bad(res, "dryRun must be true or false");
      const date = (b.date as string | undefined) ?? nextWorkingDay();
      const today = istToday();
      if (date <= today || date > addDays(today, PLAN_MAX_AHEAD)) return bad(res, "Pick a day after today, at most 7 days ahead");
      if (!(await requisitionInScope(id, await branchScopeOf(req as AuthenticatedRequest)))) return void res.status(404).json({ success: false, message: "Requisition not found" });
      const covering = (await loadActiveStreams({ requisitionId: id })).some((s) => s.status === "open" && coversDay(toWindow(s), date));
      if (!covering) return void res.status(409).json({ success: false, message: "No open stream covers that day" });
      const out = await planStreamsForDay({ date, dryRun: b.dryRun === true, requisitionId: id });
      if (out.failed) { logger.error({ err: out.failed }, "[he-streams] plan now failed"); return void res.status(500).json({ success: false, message: "Could not plan the day" }); }
      res.json({ success: true, data: out.plans[0] ?? null, closed: out.closed });
    } catch (err) { sendError(res, err, "Could not plan the day", "plan now"); }
  });
}
