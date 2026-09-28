import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import {
  buildDashboardExcel, isKnownDashboard, normalizeSlides, type DashboardExcelRequest,
} from "./dashboard-export.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

// Same viewers who can open the process dashboards. The raw sheets can hold
// customer phone numbers/emails/addresses, so this is deliberately not wider.
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => String(v ?? "").slice(0, max);

/** Body -> validated request, or an error message for a 400. */
function parseBody(body: unknown): { ok: true; value: DashboardExcelRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const dashboard = str(b.dashboard, 60);
  if (!isKnownDashboard(dashboard)) return { ok: false, error: `Unknown dashboard "${dashboard}".` };
  // Validate the full value as sent -- truncating first would let "2026-09-01; --" through as "2026-09-01".
  const dateField = (v: unknown): string | undefined | null => {
    if (v === undefined || v === null || v === "") return undefined;
    return typeof v === "string" && DATE_RE.test(v.trim()) ? v.trim() : null;
  };
  const from = dateField(b.from);
  const to = dateField(b.to);
  if (from === null || to === null) return { ok: false, error: "from/to must be YYYY-MM-DD." };
  return {
    ok: true,
    value: {
      dashboard,
      reportTitle: str(b.reportTitle, 120) || "Process Performance Report",
      subtitle: b.subtitle ? str(b.subtitle, 120) : undefined,
      slides: normalizeSlides(b.slides),
      from: from && to ? (from <= to ? from : to) : from,
      to: from && to ? (from <= to ? to : from) : to,
      lob: b.lob ? str(b.lob, 60) : undefined,
    },
  };
}

router.post("/dashboard-export/excel", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const parsed = parseBody(req.body);
  if (!parsed.ok) { res.status(400).json({ success: false, error: parsed.error }); return; }
  const request = parsed.value;

  const tmpPath = path.join(os.tmpdir(), `dashboard-export-${randomUUID()}.xlsx`);
  const cleanup = () => { fs.promises.unlink(tmpPath).catch(() => undefined); };

  let raw;
  try {
    ({ raw } = await buildDashboardExcel(request, tmpPath));
  } catch (err) {
    cleanup();
    throw err;
  }

  await writeAuditLog({
    actor_user_id: req.authUser.id,
    actor_role: req.authUser.role,
    action_type: "DASHBOARD_EXCEL_EXPORT",
    module_key: "process_performance",
    entity_type: "dashboard",
    entity_id: request.dashboard,
    metadata: {
      from: request.from ?? null, to: request.to ?? null, lob: request.lob ?? null,
      rawSheets: raw.map((r) => ({ sheet: r.sheet, source: r.source, rows: r.rowsExported, truncated: r.truncated, error: r.error ?? null })),
    },
    req,
  });

  const failed = raw.filter((r) => r.error).length;
  const truncated = raw.filter((r) => r.truncated).length;
  // Surfaced to the browser so a partly-failed/truncated export is never silent.
  res.setHeader("Access-Control-Expose-Headers", "X-Export-Failed-Sheets, X-Export-Truncated-Sheets");
  res.setHeader("X-Export-Failed-Sheets", String(failed));
  res.setHeader("X-Export-Truncated-Sheets", String(truncated));

  const stamp = new Date().toISOString().slice(0, 10);
  const downloadName = `${request.dashboard}_${stamp}.xlsx`;
  res.download(tmpPath, downloadName, () => cleanup());
}));

export { router as dashboardExportRouter };
