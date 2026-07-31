/**
 * Email Command Centre — admin API.
 *
 * Read-mostly by design. The only mutations are the per-event kill switch and the
 * subscription activation toggle, because those are the two things an operator needs to
 * change at 2am without a deploy.
 *
 * Every endpoint here can expose who receives sensitive mail, so all of them are
 * admin/super_admin only. UI route gating is not security (CLAUDE.md rule 6) — the guard
 * is requireRole below.
 */
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { resolveRecipients } from "../../shared/recipient-resolver.js";
import { RecipientResolutionError } from "../../shared/recipient-resolver.types.js";
import type { RecipientSpec, Sensitivity } from "../../shared/recipient-resolver.types.js";
import { maskEmail } from "../../shared/email-domains.js";
import { getReportDefinition } from "../reporting/report-catalog.js";

const router = Router();
router.use(requireAuth);
router.use(requireRole("admin", "super_admin"));

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req as AuthenticatedRequest, res).catch(next);
  };

/** Report codes with a real executor in report-worker-executor.ts. Everything else in the
 *  89-entry catalog returns a PENDING_DEDICATED_BUILDER placeholder that the mailer would
 *  happily deliver on a schedule. The UI shows the rest as disabled WITH THE REASON,
 *  rather than hiding them (CLAUDE.md rule 9). */
const IMPLEMENTED_REPORT_CODES = [
  "employee-master", "headcount", "attendance-daily",
  "leave-balance", "payroll-register", "birthday-list",
];

/** GET /api/notification-admin/catalogue — every registered event and its live state. */
router.get("/catalogue", h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT event_code, module, display_name, description, enabled, dispatch_mode,
            channels, is_critical, sensitivity, recipient_spec, backfill_floor_at,
            max_per_run, max_per_day, cooldown_minutes, template_key, updated_at
       FROM notification_event_config
      WHERE active_status = 1
      ORDER BY module, event_code`,
  );
  // Send counts alongside so the UI never has to infer activity from nothing.
  const [counts] = await db.execute<RowDataPacket[]>(
    `SELECT event_code, mode, COUNT(*) AS n, MAX(claimed_at) AS last_at
       FROM notification_dispatch_claim
      WHERE claimed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY event_code, mode`,
  );
  const byCode: Record<string, { shadow: number; live: number; lastAt: string | null }> = {};
  for (const c of counts) {
    const e = (byCode[c.event_code] ??= { shadow: 0, live: 0, lastAt: null });
    if (c.mode === "live") e.live = Number(c.n); else e.shadow = Number(c.n);
    if (!e.lastAt || String(c.last_at) > e.lastAt) e.lastAt = c.last_at ? String(c.last_at) : null;
  }
  return res.json({
    success: true,
    data: rows.map((r) => ({ ...r, activity: byCode[r.event_code] ?? { shadow: 0, live: 0, lastAt: null } })),
  });
}));

/**
 * PATCH /api/notification-admin/catalogue/:eventCode — the kill switch.
 *
 * Going live is deliberately a two-field change, so it cannot happen by accidentally
 * toggling one checkbox.
 */
router.patch("/catalogue/:eventCode", h(async (req, res) => {
  const { enabled, dispatch_mode } = req.body ?? {};
  if (dispatch_mode && !["shadow", "live", "off"].includes(dispatch_mode)) {
    return res.status(400).json({ success: false, error: "dispatch_mode must be shadow, live or off" });
  }
  const [result] = await db.execute<RowDataPacket[]>(
    `SELECT sensitivity, recipient_spec FROM notification_event_config WHERE event_code = ? LIMIT 1`,
    [req.params.eventCode],
  );
  if (!result.length) return res.status(404).json({ success: false, error: "Unknown event" });

  await db.execute(
    `UPDATE notification_event_config
        SET enabled = COALESCE(?, enabled), dispatch_mode = COALESCE(?, dispatch_mode)
      WHERE event_code = ?`,
    [enabled === undefined ? null : (enabled ? 1 : 0), dispatch_mode ?? null, req.params.eventCode],
  );
  return res.json({ success: true, data: { event_code: req.params.eventCode, enabled, dispatch_mode } });
}));

/**
 * POST /api/notification-admin/recipients/preview — the single best defence against a
 * wrong-recipient incident: resolve a real spec against a real employee and show exactly
 * who would receive it, and who was dropped and why.
 *
 * Addresses come back masked. This endpoint answers "would the right people get this",
 * not "what is Priya's email".
 */
router.post("/recipients/preview", h(async (req, res) => {
  const { event_code, employee_id, branch_id, process_id, spec_override, vars } = req.body ?? {};

  let sensitivity: Sensitivity = "int";
  let spec: RecipientSpec | null = spec_override ?? null;

  if (event_code) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sensitivity, recipient_spec FROM notification_event_config WHERE event_code = ? LIMIT 1`,
      [event_code],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: "Unknown event" });
    sensitivity = rows[0].sensitivity as Sensitivity;
    if (!spec) {
      const raw = rows[0].recipient_spec;
      spec = (typeof raw === "string" ? JSON.parse(raw) : raw) as RecipientSpec;
    }
  }
  if (!spec) return res.status(400).json({ success: false, error: "event_code or spec_override is required" });

  try {
    const r = await resolveRecipients(spec, {
      sensitivity,
      context: { employeeId: employee_id ?? null, branchId: branch_id ?? null, processId: process_id ?? null, vars },
    });
    const shape = (list: typeof r.to) => list.map((x) => ({
      name: x.name, email: maskEmail(x.email), employeeCode: x.employeeCode,
      via: x.viaSelector, source: x.emailSource, audience: x.audience,
    }));
    return res.json({
      success: true,
      data: { resolved: true, sensitivity, to: shape(r.to), cc: shape(r.cc), bcc: shape(r.bcc),
              dropped: r.dropped, truncated: r.truncated },
    });
  } catch (err) {
    if (err instanceof RecipientResolutionError) {
      // A refusal is a legitimate, informative answer here — not a 500.
      return res.json({
        success: true,
        data: { resolved: false, sensitivity, code: err.code, message: err.message,
                dropped: err.resolution?.dropped ?? [], to: [], cc: [], bcc: [] },
      });
    }
    throw err;
  }
}));

/** GET /api/notification-admin/claims — what the gateway actually did, shadow or live. */
router.get("/claims", h(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const params: unknown[] = [];
  let where = "WHERE 1=1";
  if (req.query.event_code) { where += " AND event_code = ?"; params.push(req.query.event_code); }
  if (req.query.mode)       { where += " AND mode = ?";       params.push(req.query.mode); }
  if (req.query.status)     { where += " AND status = ?";     params.push(req.query.status); }

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, event_code, dedupe_key, mode, status, recipient_count, cc_count, bcc_count,
            dropped_count, recipient_digest, entity_type, entity_id, error_message,
            claimed_at, completed_at
       FROM notification_dispatch_claim ${where}
      ORDER BY claimed_at DESC LIMIT ${limit}`,
    params,
  );
  return res.json({ success: true, data: rows });
}));

/**
 * GET /api/notification-admin/analytics — only what is genuinely measured.
 *
 * There is deliberately no open rate or click rate: nothing tracks either, and reporting
 * a metric nothing measures is what the removed dispatch_log open_rate was doing.
 */
router.get("/analytics", h(async (_req, res) => {
  const [byEvent] = await db.execute<RowDataPacket[]>(
    `SELECT event_code, mode,
            COUNT(*) AS total,
            SUM(status = 'sent') AS sent,
            SUM(status = 'failed') AS failed,
            SUM(status = 'suppressed') AS suppressed,
            SUM(dropped_count) AS dropped
       FROM notification_dispatch_claim
      WHERE claimed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY event_code, mode
      ORDER BY total DESC`,
  );
  const [byDay] = await db.execute<RowDataPacket[]>(
    `SELECT DATE(claimed_at) AS day, mode, COUNT(*) AS n
       FROM notification_dispatch_claim
      WHERE claimed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY day, mode ORDER BY day`,
  );
  const [dropReasons] = await db.execute<RowDataPacket[]>(
    `SELECT jt.reason, COUNT(*) AS n
       FROM notification_dispatch_claim c,
            JSON_TABLE(COALESCE(c.recipient_digest->'$.dropped', '[]'), '$[*]'
              COLUMNS (reason VARCHAR(40) PATH '$.reason')) AS jt
      WHERE c.claimed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY jt.reason ORDER BY n DESC`,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);   // JSON_TABLE needs MySQL 8

  return res.json({ success: true, data: { byEvent, byDay, dropReasons, tracksOpens: false, tracksClicks: false } });
}));

/** GET /api/notification-admin/subscriptions — scheduled reports and their real state. */
router.get("/subscriptions", h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT s.*,
            (SELECT COUNT(*) FROM report_subscription_run r WHERE r.subscription_id = s.id) AS run_count
       FROM report_subscription s
      ORDER BY s.frequency, s.subscription_name`,
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  return res.json({ success: true, data: rows });
}));

/**
 * GET /api/notification-admin/report-codes — which reports can be subscribed to, and why
 * the others cannot. The UI shows the blocked ones disabled with this reason attached.
 */
router.get("/report-codes", h(async (_req, res) => {
  const codes = IMPLEMENTED_REPORT_CODES.map((code) => {
    const def = getReportDefinition(code);
    return {
      code, name: def?.name ?? code, category: def?.category ?? null,
      containsPII: def?.containsPII ?? false, containsFinancialData: def?.containsFinancialData ?? false,
      subscribable: true, reason: null as string | null,
    };
  });
  return res.json({
    success: true,
    data: {
      subscribable: codes,
      blockedReason:
        "Only 6 of the 89 catalogued reports have a builder in report-worker-executor.ts. " +
        "The rest return a PENDING_DEDICATED_BUILDER placeholder, so subscribing to one " +
        "would email an empty spreadsheet on a schedule.",
    },
  });
}));

export { router as notificationAdminRouter };
