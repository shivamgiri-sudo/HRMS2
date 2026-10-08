import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { DetailPayload, LobPayload, PeriodBreakdown } from "./clovia-lob.shared.js";
import { getRecord } from "./clovia-lob.detail.js";
import { getEmailDetail, getEmailLob, getEmailPeriods } from "./clovia-lob-email.service.js";
import { getChatDetail, getChatLob, getChatPeriods } from "./clovia-lob-chat.service.js";
import { getOutboundDetail, getOutboundLob, getOutboundPeriods } from "./clovia-lob-outbound.service.js";
import { getInboundExtras, getInboundExtrasDetail, getInboundExtrasPeriods } from "./clovia-lob-inbound.service.js";
import { getOverview, getOverviewDetail, getOverviewPeriods } from "./clovia-lob-overview.service.js";
import { getCloviaOverviewDashboard } from "./clovia-overview-dashboard.service.js";

/**
 * Clovia per-LOB dashboards (read-only).
 *   GET /api/process-performance/clovia-lob/:lob?from&to[&dept|campaign]         report spec
 *   GET /api/process-performance/clovia-lob/:lob/periods?from&to[&...]           Value + week + date columns
 *   GET /api/process-performance/clovia-lob/:lob/detail?kind&key&from&to[&...]   slide-over detail
 *   GET /api/process-performance/clovia-record?type&id                           one stored record
 * :lob = overview | inbound (add-ons: CSAT, quality, rechurn, tickets) | email | chat | outbound.
 * Same audience as every other Process Performance dashboard; customer phone
 * numbers are masked and chat transcripts are never returned.
 */

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);
router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];
const LOBS = ["overview", "inbound", "email", "chat", "outbound"] as const;
type Lob = (typeof LOBS)[number];
const q = (v: unknown, max = 80) => String(v ?? "").slice(0, max);
const isLob = (v: string): v is Lob => (LOBS as readonly string[]).includes(v);

/** Range / filter problems are the caller's (400); anything else is a real failure. */
function badInput(err: unknown): string | null {
  const m = err instanceof Error ? err.message : "";
  return /limited to|Unknown (department|campaign)/.test(m) ? m : null;
}

// Registered before the generic :lob route so "overview-dashboard" is never read as a LOB name.
router.get("/clovia-lob/overview-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  try {
    const data = await getCloviaOverviewDashboard(q(req.query.from, 10), q(req.query.to, 10));
    res.json({ success: true, data });
  } catch (err) {
    const m = badInput(err);
    if (m) { res.status(400).json({ success: false, error: m }); return; }
    throw err;
  }
}));

router.get("/clovia-lob/:lob", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const lob = String(req.params.lob);
  if (!isLob(lob)) { res.status(404).json({ success: false, error: "Unknown Clovia LOB" }); return; }
  const from = q(req.query.from, 10); const to = q(req.query.to, 10);
  try {
    const data: LobPayload =
      lob === "email" ? await getEmailLob(from, to)
        : lob === "chat" ? await getChatLob(from, to, q(req.query.dept))
          : lob === "outbound" ? await getOutboundLob(from, to, q(req.query.campaign))
            : lob === "inbound" ? await getInboundExtras(from, to)
              : await getOverview(from, to);
    res.json({ success: true, data });
  } catch (err) {
    const m = badInput(err);
    if (m) { res.status(400).json({ success: false, error: m }); return; }
    throw err;
  }
}));

router.get("/clovia-lob/:lob/periods", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const lob = String(req.params.lob);
  if (!isLob(lob)) { res.status(404).json({ success: false, error: "Unknown Clovia LOB" }); return; }
  const from = q(req.query.from, 10); const to = q(req.query.to, 10);
  try {
    const data: PeriodBreakdown =
      lob === "email" ? await getEmailPeriods(from, to)
        : lob === "chat" ? await getChatPeriods(from, to, q(req.query.dept))
          : lob === "outbound" ? await getOutboundPeriods(from, to, q(req.query.campaign))
            : lob === "inbound" ? await getInboundExtrasPeriods(from, to)
              : await getOverviewPeriods(from, to);
    res.json({ success: true, data });
  } catch (err) {
    const m = badInput(err);
    if (m) { res.status(400).json({ success: false, error: m }); return; }
    throw err;
  }
}));

router.get("/clovia-lob/:lob/detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const lob = String(req.params.lob);
  if (!isLob(lob)) { res.status(404).json({ success: false, error: "Unknown Clovia LOB" }); return; }
  const kind = q(req.query.kind, 40); const key = q(req.query.key, 200);
  const from = q(req.query.from, 10); const to = q(req.query.to, 10);
  if (!kind || !key) { res.status(400).json({ success: false, error: "kind and key are required" }); return; }
  try {
    const data: DetailPayload | null =
      lob === "email" ? await getEmailDetail(kind, key, from, to)
        : lob === "chat" ? await getChatDetail(kind, key, from, to, q(req.query.dept))
          : lob === "outbound" ? await getOutboundDetail(kind, key, from, to, q(req.query.campaign))
            : lob === "inbound" ? await getInboundExtrasDetail(kind, key, from, to)
              : await getOverviewDetail(kind, key, from, to);
    if (!data) { res.status(404).json({ success: false, error: "Nothing found for that selection" }); return; }
    res.json({ success: true, data });
  } catch (err) {
    const m = badInput(err);
    if (m) { res.status(400).json({ success: false, error: m }); return; }
    throw err;
  }
}));

router.get("/clovia-record", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getRecord(q(req.query.type, 20), Number(req.query.id));
  if (!data) { res.status(404).json({ success: false, error: "Record not found" }); return; }
  res.json({ success: true, data });
}));

export { router as cloviaLobDashboardRouter };
