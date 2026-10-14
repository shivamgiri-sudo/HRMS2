import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import {
  missingConfig,
  readGrnTallyConfig,
  runGrnTallyExport,
} from "./grn-tally-export.service.js";
import {
  buildGrnTallyCheckXlsx,
  buildGrnTallyCsv,
  buildGrnTallyXlsx,
  buildGrnTallyXml,
  grnTallyDownloadSummary,
  loadGrnTallyDownload,
  type GrnTallyDownloadFormat,
} from "./grn-tally-download.service.js";
import { resolveFinanceBranchScopeSet } from "./finance-access-scope.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/** Approved-GRN export for Tally. Mounted at /api/finance/grn-tally. */
export const GRN_TALLY_READ_ROLES = [
  "finance_head",
  "accounts_head",
  "ceo",
  "finance",
  "admin",
  "super_admin",
] as const;
export const GRN_TALLY_RUN_ROLES = [
  "finance_head",
  "accounts_head",
  "super_admin",
] as const;

export const grnTallyRouter = Router();
grnTallyRouter.use(requireAuth);

grnTallyRouter.get(
  "/status",
  requireRole(...GRN_TALLY_READ_ROLES),
  async (_req, res) => {
    try {
      const config = readGrnTallyConfig();
      const missing = missingConfig(config);
      const [last] = await db.execute<RowDataPacket[]>(
        `SELECT id, file_name, target_dir, voucher_count, total_amount, exception_count, status, trigger_source, created_at, written_at, error_message
         FROM grn_tally_export_batch ORDER BY created_at DESC LIMIT 5`,
      );
      const preview = missing.length
        ? null
        : await runGrnTallyExport({ trigger: "manual", dryRun: true });
      res.json({
        success: true,
        data: {
          configured: missing.length === 0,
          missing,
          folder: config.dir,
          exportFrom: config.from,
          recentBatches: last,
          waiting:
            preview && preview.status === "dry_run"
              ? {
                  vouchers: preview.wouldExport,
                  exceptions: preview.exceptions,
                }
              : null,
        },
      });
    } catch (error) {
      console.error("[grn-tally] status failed", error);
      res.status(500).json({
        success: false,
        error: "Unable to load the Tally export status",
      });
    }
  },
);

grnTallyRouter.post(
  "/run",
  requireWriteAccess,
  requireRole(...GRN_TALLY_RUN_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await runGrnTallyExport({
        trigger: "manual",
        actorUserId: req.authUser?.id ?? null,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error("[grn-tally] manual run failed", error);
      res.status(500).json({
        success: false,
        error:
          "The export could not be written. Nothing was marked as exported.",
      });
    }
  },
);

grnTallyRouter.get(
  "/batches",
  requireRole(...GRN_TALLY_READ_ROLES),
  async (req, res) => {
    try {
      const limit = Math.min(
        Math.max(Math.trunc(Number(req.query.limit)) || 30, 1),
        200,
      );
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, file_name, voucher_count, total_amount, exception_count, status, trigger_source, created_at, written_at, error_message
         FROM grn_tally_export_batch ORDER BY created_at DESC LIMIT ${limit}`,
      );
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error("[grn-tally] batches failed", error);
      res.status(500).json({
        success: false,
        error: "Unable to load the Tally export batches",
      });
    }
  },
);

/*
 * On-demand test download (grn-tally-download.service.ts): HRMS GRNs that have a GRN number, as
 * Tally XML, Excel or CSV. Read-only — it never reserves a GRN in grn_tally_export, so it cannot
 * hold anything back from the connector feed above. Every download is audited.
 */
const DOWNLOAD_FORMATS: Record<
  GrnTallyDownloadFormat,
  { contentType: string; ext: string }
> = {
  xml: { contentType: "application/xml; charset=utf-8", ext: "xml" },
  xlsx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
  csv: { contentType: "text/csv; charset=utf-8", ext: "csv" },
  check: {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
};

async function downloadFilters(req: AuthenticatedRequest) {
  const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
  const month = req.query.month ? String(req.query.month) : undefined;
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw Object.assign(new Error("month must be YYYY-MM"), { status: 400 });
  }
  const rawType = req.query.grnType ? String(req.query.grnType) : "vendor";
  if (!["vendor", "imprest", "all"].includes(rawType)) {
    throw Object.assign(new Error("grnType must be vendor, imprest or all"), { status: 400 });
  }
  const grnType = rawType as "vendor" | "imprest" | "all";
  const userId = req.authUser?.id;
  if (!userId) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const branchScope = await resolveFinanceBranchScopeSet({
    userId,
    primaryRole: req.authUser?.role,
    userRoles: req.userRoles,
    requestedBranchId: branchId,
  }).catch((error: Error) => {
    // The only throw is a branch outside the caller's scope.
    throw Object.assign(error, { status: 403 });
  });
  return { branchScope, branchId, month, grnType };
}

const statusOf = (error: unknown) =>
  Number((error as { status?: number })?.status) || 500;

grnTallyRouter.get(
  "/download/summary",
  requireRole(...GRN_TALLY_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await loadGrnTallyDownload(await downloadFilters(req));
      res.json({ success: true, data: grnTallyDownloadSummary(data) });
    } catch (error) {
      const status = statusOf(error);
      if (status === 500) console.error("[grn-tally] download summary failed", error);
      res.status(status).json({
        success: false,
        error: status === 500 ? "Unable to count the GRNs for export" : (error as Error).message,
      });
    }
  },
);

grnTallyRouter.get(
  "/download",
  requireRole(...GRN_TALLY_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const format = String(req.query.format ?? "") as GrnTallyDownloadFormat;
      const spec = Object.hasOwn(DOWNLOAD_FORMATS, format) ? DOWNLOAD_FORMATS[format] : undefined;
      if (!spec) {
        return res
          .status(400)
          .json({ success: false, error: "format must be xml, xlsx, csv or check" });
      }
      const filters = await downloadFilters(req);
      const data = await loadGrnTallyDownload(filters);
      const body =
        format === "xml"
          ? Buffer.from(buildGrnTallyXml(data), "utf8")
          : format === "csv"
            ? Buffer.from("\uFEFF" + buildGrnTallyCsv(data), "utf8")
            : format === "check"
              ? await buildGrnTallyCheckXlsx(data)
              : await buildGrnTallyXlsx(data);
      const summary = grnTallyDownloadSummary(data);
      await logSensitiveAction({
        actor_user_id: req.authUser!.id,
        action_type: "grn_tally_test_download",
        module_key: "finance",
        entity_type: "grn_request",
        req,
        change_summary: {
          format,
          month: filters.month ?? null,
          grnType: filters.grnType,
          branchId: filters.branchId ?? null,
          ...summary,
        },
      });
      const fileName = `GRN_Tally_${format === "check" ? "Check_" : ""}${filters.grnType === "vendor" ? "" : `${filters.grnType}_`}${filters.month ?? "all-months"}_${new Date().toISOString().slice(0, 10)}.${spec.ext}`;
      res.setHeader("Content-Type", spec.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("X-Grn-Count", String(summary.grns));
      res.setHeader("X-Grn-In-Xml", String(summary.inXml));
      res.send(body);
    } catch (error) {
      const status = statusOf(error);
      if (status === 500) console.error("[grn-tally] download failed", error);
      res.status(status).json({
        success: false,
        error: status === 500 ? "Unable to build the GRN export file" : (error as Error).message,
      });
    }
  },
);
