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
import { callerBranchScope } from "../finance/finance-branch-guard.js";
import { splitByLock, tallyExportLock } from "../finance/tally-export-lock.service.js";
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

/**
 * GET /api/gst/registrations — the GSTINs a batch can be generated for.
 *
 * The picker on the export page has always called this; it had no route until now and
 * answered 401 (a missing /api/* path lands on the authenticated catch-all here, not on a
 * 404), so the page opened with an empty registration list and nothing could be generated.
 */
router.get(
  "/registrations",
  requireRole(...GST_READ_ROLES),
  h(async (req, res) => {
    const data = await gstExportService.listRegistrations(await callerBranchScope(req));
    return res.json({ success: true, data });
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
    }, await callerBranchScope(req));
    return res.json({ success: true, data });
  })
);

/** GET /api/gst/exports/:id — batch header plus every staged row. */
router.get(
  "/exports/:id",
  requireRole(...GST_READ_ROLES),
  h(async (req, res) => {
    const scope = await callerBranchScope(req);
    try {
      const data = await gstExportService.getBatch(String(req.params.id), scope);
      return res.json({ success: true, ...data });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode === 403 ? 403 : 404;
      return res.status(statusCode).json({
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
    const data = await gstExportService.getExceptions(String(req.params.id), await callerBranchScope(req));
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
    const { batch, rows } = await gstExportService.getBatch(String(req.params.id), await callerBranchScope(req));
    if (Number((batch as any).exception_rows) > 0 && !includeExceptions) {
      return res.status(409).json({
        success: false,
        error: `This batch has ${(batch as any).exception_rows} row(s) that cannot be filed. Resolve them, or re-request with includeExceptions=true to export anyway.`,
      });
    }

    // Tally-bound: every invoice is locked as it is pulled, so a regenerated batch for the same
    // period cannot hand the same invoice over a second time (Tally would import it twice).
    const gstin = String((batch as any).company_gstin);
    const user = actor(req);
    const reexport = String(req.query.reexport ?? "") === "true";
    const keyOf = (r: any) => `${r.source_type}:${r.source_id}`;
    const items = (rows as any[]).map((r) => ({ key: keyOf(r), label: String(r.bill_no ?? "") }));
    const { fresh, locked } = await splitByLock("gst_sales", gstin, items);
    let exportRows = rows as any[];
    let claimed: string[] = [];
    try {
      if (reexport) {
        const why = tallyExportLock.assertReexport(req.query.reason, (req as any).userRoles, user.role);
        await tallyExportLock.recordReexport("gst_sales", gstin, locked, user.id, user.role, why, "csv");
        claimed = await tallyExportLock.lock("gst_sales", gstin, fresh, user.id, "csv");
      } else {
        if (!fresh.length && items.length) {
          return res.status(409).json({
            success: false, code: "ALL_LOCKED",
            error: `All ${locked.length} invoice(s) in this batch were already pulled out for Tally. Importing them again would duplicate them. A finance head can re-export with a reason.`,
          });
        }
        claimed = await tallyExportLock.lock("gst_sales", gstin, fresh, user.id, "csv");
        if (claimed.length !== fresh.length) {
          await tallyExportLock.release("gst_sales", gstin, claimed, user.id, user.role, "Export aborted: another export took some invoices at the same moment").catch(() => undefined);
          return res.status(409).json({ success: false, code: "RACE", error: "Another export took some of these invoices at the same moment. Try again." });
        }
        const lockedKeys = new Set(locked.map((l) => l.key));
        exportRows = (rows as any[]).filter((r) => !lockedKeys.has(keyOf(r)));
      }
    } catch (error) {
      return res.status(403).json({ success: false, error: error instanceof Error ? error.message : "Not allowed" });
    }
    res.setHeader("X-Tally-Skipped-Already-Exported", String(reexport ? 0 : locked.length));

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
    for (const r of exportRows) lines.push(cols.map((c) => cell(r[c])).join(","));

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
