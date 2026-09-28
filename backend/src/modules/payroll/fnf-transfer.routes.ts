/**
 * Full & Final settlement disbursement routes — mounted at /api/payroll/fnf-transfer.
 *
 *   GET   /eligible                — settlements ready for a new export, plus who is withheld and why
 *   GET   /export                  — generate + download the bank file (full account numbers)
 *   GET   /reexport                — same, but only corrected_ready items
 *   GET   /items                   — the workflow queue: exported / rejected / corrected_ready / confirmed
 *   PATCH /items/reject             — bulk-mark items rejected with a reason
 *   PATCH /items/:itemId/mark-corrected-ready
 *   POST  /import/preview          — parse a Transfer Number Update File, never writes
 *   POST  /import/commit           — commit a previewed import; confirms transfers AND marks the
 *                                     matching full_final_calculation rows paid
 *
 * Deliberately mirrors bank-payment-readiness.routes.ts's salary-transfer endpoints
 * route-for-route: same role gates, same org-wide-scope requirement on the full-number export,
 * same GET+POST pair for export (a large selection can exceed a GET query string), same
 * multipart CSV upload for the import. A payroll operator who already knows the salary-transfer
 * screen should recognise this one.
 *
 * ROLE GATE
 *   No new role set invented. PAYROLL_EXPORT_ROLES / MANAGE_ROLES are the same lists
 *   bank-payment-readiness.routes.ts already gates salary disbursement on — this is the same
 *   money movement (a bank-file export with full account numbers, requiring the identical
 *   org-wide scope), not a different one that would need different people trusted with it.
 */
import { Router } from "express";
import type { Response } from "express";
import { createHash } from "crypto";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { hasAnyRole, getUserAssignmentScopes } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  getEligibleFnfTransferRows,
  generateFnfTransferBatch,
  rejectFnfTransferItems,
  markFnfItemCorrectedReady,
  parseTransferNumberCsv,
  previewFnfTransferNumberImport,
  commitFnfTransferNumberImport,
  type FnfTransferImportPreviewRow,
} from "./fnf-transfer.service.js";
import { rejectionReasonLabel, REJECTION_REASONS } from "./salary-transfer.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export const fnfTransferRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

fnfTransferRouter.use(requireAuth);

/** Same list bank-payment-readiness.routes.ts gates the salary-transfer export on. */
const PAYROLL_EXPORT_ROLES = ["finance", "payroll", "finance_head", "payroll_head", "payroll_admin"];
/** Same list bank-payment-readiness.routes.ts gates rejection/correction/import on. */
const MANAGE_ROLES = ["super_admin", "admin", "payroll_head", "payroll", "payroll_admin", "finance_head", "hr"];
/** Read-only queue access — the same wider list the salary-transfer items queue admits. */
const READ_ROLES = [
  "super_admin", "admin", "payroll_head", "payroll", "payroll_admin", "payroll_branch",
  "payroll_hr", "finance", "finance_head", "hr",
];

const ORG_WIDE_REQUIRED_MSG =
  "Organisation-wide payroll scope is required to read full bank account numbers for a " +
  "Full & Final disbursement export. Your access is limited to a subset of branches.";

/** Identical shape and reasoning to hasExportScope in bank-payment-readiness.routes.ts. */
async function hasExportScope(userId: string): Promise<boolean> {
  if (await hasAnyRole(userId, "super_admin")) return true;
  if (!(await hasAnyRole(userId, ...PAYROLL_EXPORT_ROLES))) return false;
  const scopes = await getUserAssignmentScopes(userId, PAYROLL_EXPORT_ROLES);
  return scopes.some((s) => s.scope_type === "all");
}

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * GET /eligible — the settlement-selection grid: approved + non-provisional + NOC cleared +
 * not already open. Read-only, and reports the withheld list alongside it (see
 * getEligibleFnfTransferRows for why NOC is mandatory here, unlike the salary export's kill
 * switch).
 */
fnfTransferRouter.get(
  "/eligible",
  requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"),
  h(async (req, res) => {
    if (!(await hasExportScope(req.authUser!.id))) {
      return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
    }
    const { rows, ineligible } = await getEligibleFnfTransferRows();
    return res.json({
      success: true,
      count: rows.length,
      total_amount: rows.reduce((s, r) => s + r.amount, 0),
      data: rows.map((r) => ({
        full_final_calculation_id: r.full_final_calculation_id,
        exit_request_id: r.exit_request_id,
        employee_id: r.employee_id,
        employee_code: r.employee_code,
        employee_name: r.employee_name,
        amount: r.amount,
        account_masked: r.account_masked,
        ifsc: r.ifsc,
        bank_name: r.bank_name,
      })),
      // A leaver without a signed NOC must not appear in the bank file — mandatory here, not a
      // kill switch, since every row is a leaver by construction. Reported, never dropped.
      ineligible,
    });
  }),
);

/**
 * run_id-free version of bank-payment-readiness.routes.ts's readExportParams — F&F selects by
 * full_final_calculation_id, not a payroll run. GET keeps a small selection working via a
 * query string; POST exists for the same reason the salary-transfer export has a POST
 * counterpart (a large selection can exceed a GET URL length limit).
 */
function readFnfExportParams(req: any): { fullFinalCalculationIds: string[] | null } {
  const raw = req.query.ids ?? req.body?.ids;
  let ids: string[] | null = null;
  if (Array.isArray(raw)) {
    ids = raw.map((s: unknown) => String(s).trim()).filter(Boolean);
  } else if (typeof raw === "string" && raw.trim()) {
    ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return { fullFinalCalculationIds: ids };
}

function handleFnfTransferExport() {
  return h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await hasExportScope(req.authUser!.id))) {
      return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
    }
    const { fullFinalCalculationIds } = readFnfExportParams(req);

    let result;
    try {
      result = await generateFnfTransferBatch({ userId: req.authUser!.id, fullFinalCalculationIds });
    } catch (err: any) {
      if (err?.code === "NO_ELIGIBLE_ROWS") {
        return res.status(409).json({ success: false, message: "No eligible F&F settlements to export." });
      }
      throw err;
    }

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "FNF_TRANSFER_FILE_GENERATED",
      module_key: "payroll",
      entity_type: "fnf_transfer_batch",
      entity_id: result.batch_id,
      change_summary: { row_count: result.row_count, total_amount: result.total_amount, excluded: result.excluded },
      req: req as never,
    });

    res.setHeader("Content-Type", "application/vnd.ms-excel");
    res.setHeader("Content-Disposition", `attachment; filename="${result.file_name}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Batch-Number", result.batch_number);
    res.setHeader("X-Row-Count", String(result.row_count));
    return res.send(result.buffer);
  });
}

fnfTransferRouter.get("/export", requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"), handleFnfTransferExport());
fnfTransferRouter.post("/export", requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"), handleFnfTransferExport());

/** GET /items — the workflow queue, same bucket derivation as the salary-transfer queue. */
fnfTransferRouter.get(
  "/items",
  requireRole(...READ_ROLES),
  h(async (_req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT i.id, i.batch_id, i.full_final_calculation_id, i.exit_request_id, i.employee_id,
              i.employee_code, i.amount, i.pay_mod, i.account_masked,
              i.status, i.rejection_reason, i.rejection_note, i.rejected_at,
              i.ecs_number, i.transfer_date, i.confirmed_at, i.created_at,
              b.batch_number, b.attempt_kind,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name
         FROM fnf_transfer_batch_item i
         JOIN fnf_transfer_batch b ON b.id = i.batch_id
         LEFT JOIN employees e ON e.id = i.employee_id
        ORDER BY i.created_at DESC`,
    );
    const bucketOf = (status: string): "ready_for_disbursal" | "disbursed" | "rejected" =>
      status === "confirmed" ? "disbursed" : status === "rejected" ? "rejected" : "ready_for_disbursal";

    return res.json({
      success: true,
      data: (rows as any[]).map((r) => ({
        ...r,
        bucket: bucketOf(r.status),
        rejection_reason_label: r.rejection_reason ? rejectionReasonLabel(r.rejection_reason) : null,
      })),
      rejection_reasons: REJECTION_REASONS.map((r) => ({ value: r, label: rejectionReasonLabel(r) })),
    });
  }),
);

/** PATCH /items/reject — bulk-mark items rejected with a reason. */
fnfTransferRouter.patch(
  "/items/reject",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    const { item_ids, reason, note } = req.body as { item_ids?: string[]; reason?: string; note?: string | null };
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return res.status(400).json({ success: false, message: "item_ids must be a non-empty array" });
    }
    if (!REJECTION_REASONS.includes(reason as any)) {
      return res.status(400).json({ success: false, message: `reason must be one of ${REJECTION_REASONS.join(", ")}` });
    }
    const result = await rejectFnfTransferItems({ itemIds: item_ids, reason: reason as string, note: note ?? null, userId: req.authUser!.id });

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "FNF_TRANSFER_ITEM_REJECTED",
      module_key: "payroll",
      entity_type: "fnf_transfer_batch_item",
      entity_id: item_ids.join(","),
      change_summary: { reason, note: note ?? null, updated: result.updated },
      req: req as never,
    });

    return res.json({ success: true, message: `${result.updated} item(s) marked rejected`, data: result });
  }),
);

/** PATCH /items/:itemId/mark-corrected-ready — same one-way "link to the real correction flow" rule as salary. */
fnfTransferRouter.patch(
  "/items/:itemId/mark-corrected-ready",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    await markFnfItemCorrectedReady(req.params.itemId);
    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "FNF_TRANSFER_ITEM_CORRECTED_READY",
      module_key: "payroll",
      entity_type: "fnf_transfer_batch_item",
      entity_id: req.params.itemId,
      change_summary: {},
      req: req as never,
    });
    return res.json({ success: true, message: "Item marked ready for re-export" });
  }),
);

/** POST /import/preview — multipart CSV upload. Never writes. No run_id — F&F has none to scope by. */
fnfTransferRouter.post(
  "/import/preview",
  requireRole(...MANAGE_ROLES),
  csvUpload.single("file"),
  h(async (req: any, res) => {
    const file = req.file as { buffer: Buffer; originalname: string } | undefined;
    if (!file) return res.status(400).json({ success: false, message: "file is required" });
    const text = file.buffer.toString("utf8");
    let rows;
    try {
      rows = parseTransferNumberCsv(text);
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err?.message ?? "Could not parse CSV" });
    }
    if (rows.length === 0) return res.status(400).json({ success: false, message: "No data rows found" });

    const preview = await previewFnfTransferNumberImport(rows);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const summary = {
      total: preview.length,
      will_confirm: preview.filter((r) => r.outcome === "will_confirm").length,
      unmatched: preview.filter((r) => r.outcome === "unmatched").length,
      already_confirmed: preview.filter((r) => r.outcome === "already_confirmed").length,
      invalid: preview.filter((r) => r.outcome === "invalid").length,
    };
    return res.json({ success: true, file_name: file.originalname, file_sha256: sha256, summary, data: preview });
  }),
);

/**
 * POST /import/commit — confirms the transfer AND marks the matching full_final_calculation
 * rows paid (see commitFnfTransferNumberImport). ff_mark_paid_failures is surfaced explicitly
 * so a maker-checker refusal (the confirming user also approved the settlement) is visible to
 * act on, rather than silently disappearing into a success response.
 */
fnfTransferRouter.post(
  "/import/commit",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    const { file_name, file_sha256, preview } = req.body as {
      file_name?: string;
      file_sha256?: string;
      preview?: FnfTransferImportPreviewRow[];
    };
    if (!file_sha256 || !Array.isArray(preview) || preview.length === 0) {
      return res.status(400).json({ success: false, message: "file_sha256 and preview are required" });
    }
    const result = await commitFnfTransferNumberImport({
      preview,
      fileName: file_name ?? "fnf-transfer-numbers.csv",
      fileSha256: file_sha256,
      userId: req.authUser!.id,
    });

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "FNF_TRANSFER_NUMBER_IMPORT_COMMITTED",
      module_key: "payroll",
      entity_type: "fnf_transfer_import",
      entity_id: file_sha256,
      change_summary: { ...result },
      req: req as never,
    });

    return res.json({
      success: true,
      message: result.skipped > 0 && result.confirmed === 0
        ? "This file was already imported — no changes made (idempotent re-upload)."
        : `${result.confirmed} transfer number(s) recorded, ${result.ff_marked_paid} settlement(s) marked paid` +
          (result.ff_mark_paid_failures.length
            ? `, ${result.ff_mark_paid_failures.length} settlement(s) confirmed on the bank side but could NOT be marked paid (see ff_mark_paid_failures)`
            : ""),
      data: result,
    });
  }),
);
