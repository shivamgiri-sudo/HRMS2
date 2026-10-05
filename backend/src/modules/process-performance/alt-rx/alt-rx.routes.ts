import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../../middleware/authMiddleware.js";
import { requireRole } from "../../../middleware/requireRole.js";
import { writeAuditLog } from "../../../shared/auditLog.js";
import { buildMisModel, toFacts, type DumpRow } from "./alt-rx.engine.js";
import { buildAltRxMisWorkbook } from "./alt-rx.mis.js";
import { loadStoredDump } from "./alt-rx.dump-store.js";

/**
 * ALT RX dashboard and MIS. Both read the saved Dump in db_masmis.altdump, which the Uploader
 * fills through the bulk-upload pipeline (ALT_RX_DUMP_MASMIS). No file is handled here.
 */
const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

// Same viewers as the other process dashboards and their Excel exports.
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Optional ?from= and ?to= (YYYY-MM-DD, inclusive) on created day. Missing or invalid values mean
 * "no limit"; a reversed range is swapped, so the screen and the download always agree.
 */
function rangeFromQuery(q: Record<string, unknown>): { from: string | null; to: string | null } {
  const pick = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : null);
  let from = pick(q.from);
  let to = pick(q.to);
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

/** Rows whose created day falls in [from, to]. */
function inRange(rows: DumpRow[], from: string | null, to: string | null): DumpRow[] {
  if (!from && !to) return rows;
  return rows.filter((r) => {
    const day = toFacts(r)?.createdDay;
    if (!day) return false;
    return (!from || day >= from) && (!to || day <= to);
  });
}

/** First and last created day in the whole Dump, so the screen can offer the full span. */
function fullSpan(rows: DumpRow[]): { from: string | null; to: string | null } {
  const days = rows.map((r) => toFacts(r)?.createdDay).filter((d): d is string => Boolean(d)).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

/** Default period when no range is sent: the 1st of the current month through today. */
function defaultRange(_span: { from: string | null; to: string | null }, now: Date): { from: string; to: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  const from = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
  const to = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return { from, to };
}

/** Dashboard data: the saved Dump for the selected period, summarised for the screen. */
router.get("/alt-rx/data", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const stored = await loadStoredDump();
  if (!stored.batch || stored.rows.length === 0) {
    res.json({ success: true, data: null, batch: null, available: null, selected: null });
    return;
  }
  const available = fullSpan(stored.rows);
  const asked = rangeFromQuery(req.query as Record<string, unknown>);
  const range = asked.from || asked.to ? asked : defaultRange(available, new Date());
  const rows = inRange(stored.rows, range.from, range.to);
  const model = buildMisModel(rows);
  const { tickets: _omit, ...summary } = model;
  void _omit;
  res.json({
    success: true,
    batch: stored.batch,
    available,
    selected: { from: range.from, to: range.to },
    data: {
      file: {
        name: stored.batch.fileName, sheet: "altdump", rows: rows.length, columns: stored.columns.length,
        missingExpected: [], unexpected: [], expectedColumns: stored.columns,
      },
      ...summary,
    },
  });
}));

/** MIS download for the selected period: the saved Dump as the MIS workbook. Only from the MIS page. */
router.get("/alt-rx/mis-export", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const stored = await loadStoredDump();
  if (!stored.batch || stored.rows.length === 0) {
    res.status(404).json({ success: false, error: "No ALT RX Dump has been uploaded yet. Upload it on the Uploader page first." });
    return;
  }
  const asked = rangeFromQuery(req.query as Record<string, unknown>);
  const range = asked.from || asked.to ? asked : defaultRange(fullSpan(stored.rows), new Date());
  const rows = inRange(stored.rows, range.from, range.to);
  if (rows.length === 0) {
    res.status(404).json({ success: false, error: "No tickets were created in the selected date range." });
    return;
  }
  const model = buildMisModel(rows);
  const wb = await buildAltRxMisWorkbook(model, rows, stored.columns);
  const first = model.days[0];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = first ? `${monthNames[Number(first.slice(5, 7)) - 1]}'${first.slice(2, 4)}` : "Report";
  const fileName = `AltRx Dashboard ${label}.xlsx`;

  await writeAuditLog({
    actor_user_id: req.authUser.id,
    actor_role: req.authUser.role,
    action_type: "ALT_RX_MIS_EXPORT",
    module_key: "process_performance",
    entity_type: "altdump",
    entity_id: stored.batch.batchId,
    metadata: { rows: stored.rows.length, tickets: model.headline.tickets, from: model.days[0] ?? null, to: model.days[model.days.length - 1] ?? null },
    req,
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/"/g, "")}"`);
  await wb.xlsx.write(res);
  res.end();
}));

export { router as altRxRouter };
