/**
 * Drive Command Center reads (mounted on heRouter, registered before the legacy /qualified-followup/:id so /status is not taken as an id).
 * All need VIEW roles. A requisition or branch outside the caller's scope answers 404, never 403. Bodies carry counts, ids, statuses and
 * timestamps only; errors carry fixed messages and the real error is logged with digit runs masked.
 */
import type { Request, Response, Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { branchScopeOf, isIsoDate } from "./he-stream.routes.js";
import { getDriveAnalytics, MAX_AHEAD_DAYS, MAX_SPAN_DAYS, tidy } from "./he-drive-analytics.service.js";
import { getDrivePlan } from "./he-drive-plan.service.js";
import { listHeldOffers } from "./he-best-offer.service.js";
import { followupWorkerStatus } from "./qualified-followup.worker.js";
import { followupMode } from "./qualified-followup.schedule.js";
import type { FollowupMode } from "./qualified-followup.types.js";
import { addDays, istToday } from "./requisition-stream.window.js";

export interface FollowupStatus {
  mode: FollowupMode;
  callFiles: Array<{ id: string; createdAt: string; rows: number; status: string; error: string | null }>;
  report: { running: boolean; last: { slot: string; ok: boolean; tries: number } | null };
}

const ID_RE = /^[0-9a-f-]{36}$/i;
const DEFAULT_BACK = 13;
const bad = (res: Response, message: string): void => { res.status(400).json({ success: false, message }); };
const one = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Logged error text: first line, long digit runs masked (a driver message can echo values). */
const logText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split("\n")[0].replace(/\d{6,}/g, "#").slice(0, 200);
function fail(res: Response, err: unknown, generic: string, what: string): void {
  logger.error({ err: logText(err) }, `[he-command] ${what} failed`);
  res.status(500).json({ success: false, message: generic });
}
/** Stored send errors can echo an address or a number: keep the words only. */
const scrub = (s: string): string => s.replace(/[^\s@]+@[^\s@]+/g, "[email]").replace(/\d{6,}/g, "#").slice(0, 120);

async function callFiles(): Promise<FollowupStatus["callFiles"]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, created_at, row_count, status, error FROM qualified_followup_call_batch ORDER BY created_at DESC LIMIT 10");
    return rows.map((r) => ({
      id: String(r.id), createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ""),
      rows: Number(r.row_count ?? 0), status: String(r.status), error: r.error == null ? null : scrub(String(r.error)),
    }));
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ER_NO_SUCH_TABLE") return [];
    throw err;
  }
}

export function registerCommandRoutes(r: Router, roles: { view: readonly string[] }): void {
  const view = [requireAuth, requireRole(...roles.view)] as const;

  r.get("/drive-analytics", ...view, async (req: Request, res: Response) => {
    try {
      const { from: f, to: t, requisitionId: rid, branch } = req.query;
      const today = istToday();
      if ((f != null && !isIsoDate(f)) || (t != null && !isIsoDate(t))) return bad(res, "Pick a valid date range");
      const to = (t as string | undefined) ?? today;
      const from = (f as string | undefined) ?? addDays(to, -DEFAULT_BACK);
      if (from > to) return bad(res, "Pick a valid date range");
      if (dayDiff(from, to) + 1 > MAX_SPAN_DAYS || to > addDays(today, MAX_AHEAD_DAYS)) return bad(res, "The range can be at most 92 days, ending at most 14 days ahead");
      if (rid != null && (typeof rid !== "string" || !ID_RE.test(rid))) return bad(res, "Invalid id");
      if (branch != null && (typeof branch !== "string" || !branch || branch.length > 150)) return bad(res, "Invalid branch");
      const requisitionId = (rid as string | undefined) ?? null, br = (branch as string | undefined) ?? null;
      const data = await getDriveAnalytics({ from, to, requisitionId, branch: br }, await branchScopeOf(req as AuthenticatedRequest));
      if (data && "error" in data) return bad(res, "Invalid request");
      if (!data) return void res.status(404).json({ success: false, message: !requisitionId && br ? "Branch not found" : "Requisition not found" });
      res.json({ success: true, data });
    } catch (err) { fail(res, err, "Could not load the drive analytics", "analytics"); }
  });

  r.get("/drive-plan", ...view, async (req: Request, res: Response) => {
    try {
      const rid = one(req.query.requisitionId);
      if (!rid || !ID_RE.test(rid)) return bad(res, "requisitionId is required");
      if (req.query.from != null && !isIsoDate(req.query.from)) return bad(res, "Pick a valid date");
      const d = req.query.days;
      if (d != null && (typeof d !== "string" || !/^\d{1,2}$/.test(d) || Number(d) < 1 || Number(d) > 14)) return bad(res, "Days must be a whole number from 1 to 14");
      const data = await getDrivePlan({ requisitionId: rid, from: one(req.query.from) ?? null, days: d == null ? null : Number(d) }, await branchScopeOf(req as AuthenticatedRequest));
      if (!data) return void res.status(404).json({ success: false, message: "Requisition not found" });
      res.json({ success: true, data: tidy(data) }); // fill and rates as 4-decimal fractions, like the analytics response
    } catch (err) { fail(res, err, "Could not load the plan", "plan"); }
  });

  r.get("/qualified-followup/status", ...view, async (_req: Request, res: Response) => {
    try {
      const w = followupWorkerStatus();
      const data: FollowupStatus = { mode: followupMode(), callFiles: await callFiles(), report: { running: w.running, last: w.reports[0] ?? null } };
      res.json({ success: true, data });
    } catch (err) { fail(res, err, "Could not load the follow-up status", "status"); }
  });

  // Registered before the legacy /qualified-followup/:id (which would answer "held" with 400).
  r.get("/qualified-followup/held", ...view, async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await listHeldOffers(await branchScopeOf(req as AuthenticatedRequest)) });
    } catch (err) { fail(res, err, "Could not load the held offers", "held offers"); }
  });
}
