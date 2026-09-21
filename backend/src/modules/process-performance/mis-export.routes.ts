import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { buildMisExcel, getMisCompanies } from "./mis-export.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

// Same viewer roles as the single-dashboard export (dashboard-export.routes.ts) --
// an MIS bundle is strictly the union of what those dashboards already show.
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-z_]{1,40}$/;

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const to = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { from, to };
}

router.get("/mis/companies", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const companies = await getMisCompanies();
  res.json({ success: true, data: companies });
}));

router.get("/mis/:company/excel", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const company = String(req.params.company ?? "");
  if (!KEY_RE.test(company)) { res.status(400).json({ success: false, error: "Invalid company key." }); return; }

  const fallback = currentMonthRange();
  const fromQ = String(req.query.from ?? "");
  const toQ = String(req.query.to ?? "");
  const from = DATE_RE.test(fromQ) ? fromQ : fallback.from;
  const to = DATE_RE.test(toQ) ? toQ : fallback.to;
  const [rangeFrom, rangeTo] = from <= to ? [from, to] : [to, from];
  const companyLabel = String(req.query.label ?? company).slice(0, 80);

  const tmpPath = path.join(os.tmpdir(), `mis-export-${randomUUID()}.xlsx`);
  const cleanup = () => { fs.promises.unlink(tmpPath).catch(() => undefined); };

  let result;
  try {
    result = await buildMisExcel(company, companyLabel, rangeFrom, rangeTo, tmpPath);
  } catch (err) {
    cleanup();
    if (err instanceof Error && err.message.startsWith("No MIS bundle")) {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }

  await writeAuditLog({
    actor_user_id: req.authUser.id,
    actor_role: req.authUser.role,
    action_type: "MIS_EXCEL_EXPORT",
    module_key: "process_performance",
    entity_type: "company",
    entity_id: company,
    metadata: {
      from: rangeFrom, to: rangeTo, sections: result.sections, skipped: result.skipped,
      rawSheets: result.raw.map((r) => ({ sheet: r.sheet, source: r.source, rows: r.rowsExported, truncated: r.truncated, error: r.error ?? null })),
    },
    req,
  });

  const failed = result.raw.filter((r) => r.error).length;
  const truncated = result.raw.filter((r) => r.truncated).length;
  res.setHeader("Access-Control-Expose-Headers", "X-Export-Failed-Sheets, X-Export-Truncated-Sheets, X-Export-Skipped-Sections");
  res.setHeader("X-Export-Failed-Sheets", String(failed));
  res.setHeader("X-Export-Truncated-Sheets", String(truncated));
  res.setHeader("X-Export-Skipped-Sections", String(result.skipped.length));

  const stamp = new Date().toISOString().slice(0, 10);
  const downloadName = `${company}_MIS_${stamp}.xlsx`;
  res.download(tmpPath, downloadName, () => cleanup());
}));

export { router as misExportRouter };
