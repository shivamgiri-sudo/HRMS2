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
