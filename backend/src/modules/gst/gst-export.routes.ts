/**
 * GST export staging routes.
 *
 * Read is open to the finance reading set; generating and marking a batch downloaded are
 * restricted to the roles that actually own filing, because a generated batch is the artefact a
 * return is prepared from and superseding one rewrites what a period looks like.
 */

import { Router, type Response } from "express";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { gstExportService, type GstExportType } from "./gst-export.service.js";

const GST_WRITE_ROLES = ["accounts_head", "finance_head", "super_admin"] as const;
const GST_READ_ROLES = [...GST_WRITE_ROLES, "admin", "finance", "branch_admin"] as const;

const EXPORT_TYPES: GstExportType[] = ["GSTR1", "GSTR3B_OUTWARD", "TALLY_SALES"];

const router = Router();
const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: any) =>
    fn(req, res).catch(next);

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  return { id, role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown") };
}

router.use(requireAuth);

/** GET /api/gst/registrations — the (entity, GSTIN) pairs a batch can be generated for. */
router.get(
  "/registrations",
  requireRole(...GST_READ_ROLES),
  h(async (_req, res) => {
    const data = await gstExportService.listRegistrations();
    return res.json({ success: true, data });
  })
);

/** POST /api/gst/exports — generate a batch for one registration + month. */
router.post(
  "/exports",
  requireWriteAccess,
  requireRole(...GST_WRITE_ROLES),
  h(async (req, res) => {
    const exportType = String(req.body?.exportType ?? "") as GstExportType;
    if (!EXPORT_TYPES.includes(exportType)) {
      return res.status(400).json({ success: false, error: `exportType must be one of ${EXPORT_TYPES.join(", ")}` });
    }
    const user = actor(req);
    try {
      const data = await gstExportService.generateBatch(
        {
          exportType,
          companyGstin: String(req.body?.companyGstin ?? ""),
          periodMonth: String(req.body?.periodMonth ?? ""),
          notes: req.body?.notes ? String(req.body.notes) : undefined,
        },
        user.id,
        user.role
      );
      return res.json({ success: true, ...data });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to generate GST export batch",
      });
    }
  })
);

/** GET /api/gst/exports — list batches. */
router.get(
  "/exports",
  requireRole(...GST_READ_ROLES),
  h(async (req, res) => {
    const data = await gstExportService.listBatches({
      exportType: req.query.exportType ? String(req.query.exportType) : undefined,
      companyGstin: req.query.companyGstin ? String(req.query.companyGstin) : undefined,
      periodMonth: req.query.periodMonth ? String(req.query.periodMonth) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.json({ success: true, data });
  })
);

/** GET /api/gst/exports/:id — batch header plus every staged row. */
router.get(
  "/exports/:id",
  requireRole(...GST_READ_ROLES),
  h(async (req, res) => {
    try {
      const data = await gstExportService.getBatch(String(req.params.id));
      return res.json({ success: true, ...data });
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error instanceof Error ? error.message : "GST export batch not found",
      });
    }
  })
);

/**
 * GET /api/gst/exports/:id/exceptions — the preparer's worklist.
 * This is the endpoint that replaces reconciling a spreadsheet by hand.
 */
router.get(
  "/exports/:id/exceptions",
  requireRole(...GST_READ_ROLES),
  h(async (req, res) => {
    const data = await gstExportService.getExceptions(String(req.params.id));
    return res.json({ success: true, count: data.length, data });
  })
);

/**
 * GET /api/gst/exports/:id/csv — the Tally / preparer hand-off file.
 *
 * Refuses to emit a batch that still carries blocking exceptions unless the caller explicitly
 * passes ?includeExceptions=true. The legacy sheet had no such gate, which is precisely how a
 * short return gets prepared from a file that looked complete.
 */
router.get(
  "/exports/:id/csv",
  requireRole(...GST_READ_ROLES),
  h(async (req, res) => {
    const includeExceptions = String(req.query.includeExceptions ?? "") === "true";
    const { batch, rows } = await gstExportService.getBatch(String(req.params.id));
    if (Number((batch as any).exception_rows) > 0 && !includeExceptions) {
      return res.status(409).json({
        success: false,
        error: `This batch has ${(batch as any).exception_rows} row(s) that cannot be filed. Resolve them, or re-request with includeExceptions=true to export anyway.`,
      });
    }

    const cols = [
      "sequence_no", "source_type", "bill_no", "invoice_date", "financial_year", "month_label",
      "company_name", "company_gstin", "branch_name", "branch_state_code",
      "client_name", "client_gstin", "client_state_code", "place_of_supply",
      "process_code", "po_no", "grn_no", "hsn_sac_code",
      "supply_type", "gst_type", "gst_rate", "taxable_value",
      "igst_amount", "cgst_amount", "sgst_amount", "other_charges", "round_off_amount",
      "invoice_value", "tally_head", "validation_status",
    ];
    // Excel turns a leading = + - @ into a formula. Prefixing with a single quote is the standard
    // defence and is what every other CSV export in this codebase does.
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [cols.join(",")];
    for (const r of rows as any[]) lines.push(cols.map((c) => cell(r[c])).join(","));

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(batch as any).export_type}-${(batch as any).company_gstin}-${(batch as any).period_month}.csv"`
    );
    return res.send(lines.join("\n"));
  })
);

/** POST /api/gst/exports/:id/downloaded — stamp the download audit trail. */
router.post(
  "/exports/:id/downloaded",
  requireWriteAccess,
  requireRole(...GST_WRITE_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    try {
      await gstExportService.markDownloaded(String(req.params.id), user.id, user.role);
      return res.json({ success: true, batchId: String(req.params.id) });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to mark batch downloaded",
      });
    }
  })
);

export { router as gstExportRouter };
