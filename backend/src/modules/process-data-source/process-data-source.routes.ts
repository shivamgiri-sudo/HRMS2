import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./process-data-source.service.js";
import { refreshConnectorMetric, type ConnectorAggregate } from "./connector-refresh.service.js";

/**
 * Where a process supplies the figures HRMS cannot measure itself.
 *
 * Role gates below say who may reach these routes at all; they are NOT the data
 * boundary. Every handler additionally calls assertProcessWritable, which
 * re-derives the caller's scope predicate in SQL — so holding
 * process_manager does not let someone write to a process that is not theirs,
 * even by editing the id in the URL.
 */

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
] as const;
const WRITER_ROLES = ["admin", "process_manager", "operations_manager"] as const;

/** Same local-date default as kpi-scorecard.routes.ts — see it for the IST/toISOString trap. */
function readRange(req: AuthenticatedRequest): { from: string; to: string } {
  const q = req.query as Record<string, string | undefined>;
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    from: q.from || iso(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: q.to || iso(today),
  };
}

const OUT_OF_SCOPE = { success: false, code: "OUT_OF_SCOPE", message: "That process is outside your scope." };

router.get("/:processId/values", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const { processId } = req.params;
  if (!(await svc.assertProcessWritable(req.authUser!.id, processId))) {
    return res.status(403).json(OUT_OF_SCOPE);
  }
  const { from, to } = readRange(req);
  res.json({ success: true, data: await svc.listProcessMetricValues(processId, from, to) });
}));

router.post("/:processId/values", requireAuth, requireRole(...WRITER_ROLES), h(async (req, res) => {
  const { processId } = req.params;
  if (!(await svc.assertProcessWritable(req.authUser!.id, processId))) {
    return res.status(403).json(OUT_OF_SCOPE);
  }
  const body = req.body as { metricKey?: string; scoreDate?: string; value?: number | string | null; note?: string };
  if (!body.metricKey || !body.scoreDate) {
    return res.status(400).json({ success: false, code: "MISSING_FIELDS", message: "metricKey and scoreDate are required." });
  }
  // An absent or blank value is a deliberate "no reading", stored as NULL.
  const raw = body.value;
  const value =
    raw === undefined || raw === null || String(raw).trim() === "" || Number.isNaN(Number(raw))
      ? null
      : Number(raw);
  try {
    const out = await svc.saveManualMetricValue({
      userId: req.authUser!.id, processId,
      metricKey: body.metricKey, scoreDate: body.scoreDate,
      value, note: body.note ?? null,
    });
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(400).json({ success: false, code: "INVALID_VALUE", message: (err as Error).message });
  }
}));

router.post("/:processId/import", requireAuth, requireRole(...WRITER_ROLES), h(async (req, res) => {
  const { processId } = req.params;
  if (!(await svc.assertProcessWritable(req.authUser!.id, processId))) {
    return res.status(403).json(OUT_OF_SCOPE);
  }
  const rows = (req.body as { rows?: svc.ImportRow[] }).rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ success: false, code: "NO_ROWS", message: "Send a non-empty rows array." });
  }
  if (rows.length > 2000) {
    return res.status(400).json({ success: false, code: "TOO_MANY_ROWS", message: "Import at most 2000 rows at a time." });
  }
  res.json({ success: true, data: await svc.importMetricRows({ userId: req.authUser!.id, processId, rows }) });
}));

router.post("/:processId/connector-refresh", requireAuth, requireRole(...WRITER_ROLES), h(async (req, res) => {
  const { processId } = req.params;
  if (!(await svc.assertProcessWritable(req.authUser!.id, processId))) {
    return res.status(403).json(OUT_OF_SCOPE);
  }
  const b = req.body as Record<string, string | undefined>;
  const required = ["connectorKey", "metricKey", "table", "valueColumn", "aggregate", "dateColumn", "from", "to"];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ success: false, code: "MISSING_FIELDS", message: `Missing: ${missing.join(", ")}` });
  }
  try {
    const out = await refreshConnectorMetric({
      connectorKey: b.connectorKey!, processId, metricKey: b.metricKey!,
      table: b.table!, valueColumn: b.valueColumn!,
      aggregate: b.aggregate as ConnectorAggregate,
      dateColumn: b.dateColumn!, from: b.from!, to: b.to!,
    });
    res.json({ success: true, data: out });
  } catch (err) {
    // The message names the real cause (bad identifier, unreachable host,
    // unknown column) so an ops user can fix their mapping without a log dive.
    res.status(400).json({ success: false, code: "REFRESH_FAILED", message: (err as Error).message });
  }
}));

export const processDataSourceRouter = router;
export default router;
