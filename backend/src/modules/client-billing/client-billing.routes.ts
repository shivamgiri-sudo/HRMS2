import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { loadBranchPolicy } from "../../shared/branchDecisionScope.js";
import { clientBillingService } from "./client-billing.service.js";
import { clientBillingApprovalService } from "./client-billing-approval.service.js";
import { clientBillingCreditNoteService } from "./client-billing-credit-note.service.js";
import { clientBillingPdfService } from "./client-billing-pdf.service.js";
import { clientBillingEditService } from "./client-billing-edit.service.js";
import { clientBillingSubmitService } from "./client-billing-submit.service.js";
import { clientBillingChangeRequestService } from "./client-billing-change-request.service.js";
import { checkPoCoverage, listAvailablePos } from "./client-billing-po.js";
import { clientBillingProvisionService, provisionRequired } from "./client-billing-provision.service.js";
import { ownCompanyCostCentreSql } from "../../shared/ownCompanyCostCentre.js";
import { clientBillingPoGrnService } from "./client-billing-po-grn.service.js";
import { clientBillingReceiptService, legacyBillsAllowed } from "./client-billing-receipt.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

router.use(requireAuth);

const ALLOWED_ROLES = ["admin", "finance", "finance_head", "accounts_head"];

/**
 * Shared display-name SQL expression for `cost_centre_master.billing_client_name`,
 * falling back to `company_name` — same rule the PDF service uses. Some
 * `billing_client_name` values (the `LEGACY-UNMAPPED-VODAFONE-2015-17` placeholder,
 * migration 1309) are deliberately long internal audit notes, not a client name — e.g.
 * "Vodafone Mobile Services Ltd. — client confirmed, specific sub-team UNKNOWN...". Found
 * live 2026-08-21 leaking verbatim into this list/export SQL (the PDF renderer already
 * had the matching fix via `printableClientName()`); truncates at the same " — " marker
 * so a table cell or CSV export never shows the raw disclosure sentence.
 */
const COST_CENTRE_DISPLAY_NAME_SQL = `
  CASE
    WHEN LOCATE(' — ', COALESCE(NULLIF(cc.billing_client_name, ''), cc.company_name)) > 0
     AND LENGTH(COALESCE(NULLIF(cc.billing_client_name, ''), cc.company_name)) > 60
    THEN SUBSTRING_INDEX(COALESCE(NULLIF(cc.billing_client_name, ''), cc.company_name), ' — ', 1)
    ELSE COALESCE(NULLIF(cc.billing_client_name, ''), cc.company_name)
  END
`.trim();

/**
 * CSV cell escaping for both export routes.
 *
 * Beyond the usual quote-doubling, this neutralises spreadsheet formula injection: Excel,
 * LibreOffice and Google Sheets all evaluate a cell whose text begins with `=`, `+`, `-`,
 * `@`, or a leading tab/CR as a formula, so a value like `=HYPERLINK(...)` or `=cmd|...`
 * stored in a client name or line particular executes when the finance team opens the
 * export. Several fields reaching these two exports are free text an operator typed
 * (`category`, `month_label`) or that arrived from the legacy `db_bill` cutover
 * (`billing_client_name`, `company_name`), so none of them can be assumed safe.
 *
 * Prefixing a single quote is the standard mitigation: the spreadsheet treats the cell as
 * literal text and does not display the quote, so the exported value still reads correctly.
 */
function escape(value: unknown): string {
  const raw = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

router.post(
  "/proformas",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      costCentreId?: string; category?: string; financeYear?: string; monthLabel?: string;
      invoiceDate?: string; description?: string; applyGst?: boolean; applyTaxCalc?: boolean; invoiceType?: string;
      lines?: Array<{ particulars: string; qty: number; rate: number; lineType?: "charge" | "deduction" }>;
      poNumbers?: string[]; grnNo?: string; grnDate?: string;
      jccNo?: string; jccDate?: string; rcmApplicable?: boolean;
    };
    if (!body.costCentreId || !body.category || !body.financeYear || !body.monthLabel || !body.invoiceDate) {
      return res.status(400).json({ error: "costCentreId, category, financeYear, monthLabel, and invoiceDate are required" });
    }
    const hasRefs = body.poNumbers?.length || body.grnNo || body.jccNo || body.rcmApplicable !== undefined;
    const references = hasRefs
      ? { poNumbers: body.poNumbers, grnNo: body.grnNo, grnDate: body.grnDate, jccNo: body.jccNo, jccDate: body.jccDate, rcmApplicable: body.rcmApplicable }
      : undefined;
    const data = await clientBillingService.createProforma({
      costCentreId: body.costCentreId,
      category: body.category,
      financeYear: body.financeYear,
      monthLabel: body.monthLabel,
      invoiceDate: body.invoiceDate,
      description: body.description,
      applyGst: body.applyGst,
      applyTaxCalc: body.applyTaxCalc,
      invoiceType: body.invoiceType,
      lines: body.lines ?? [],
      createdBy: req.authUser!.id,
      ...(references ? { references } : {}),
    } as Parameters<typeof clientBillingService.createProforma>[0]);
    res.status(201).json({ success: true, data });
  })
);

/**
 * Shared WHERE-builder for the proformas/invoices list + its CSV export, so the two
 * never drift apart (a filter that works on screen but not in the export is a classic
 * "the export doesn't match what I'm looking at" bug). Mirrors the filter/pagination
 * shape already established in grn.service.ts's listGrns.
 */
function buildInvoiceListQuery(query: Record<string, unknown>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const status = typeof query.status === "string" ? query.status : undefined;
  if (status && ["proforma", "approved", "rejected"].includes(status)) {
    conditions.push("ci.invoice_status = ?");
    params.push(status);
  }
  if (typeof query.fromDate === "string" && query.fromDate) {
    conditions.push("ci.invoice_date >= ?");
    params.push(query.fromDate);
  }
  if (typeof query.toDate === "string" && query.toDate) {
    conditions.push("ci.invoice_date <= ?");
    params.push(query.toDate);
  }
  if (typeof query.costCentreId === "string" && query.costCentreId) {
    conditions.push("ci.cost_centre_id = ?");
    params.push(query.costCentreId);
  }
  if (typeof query.branchId === "string" && query.branchId) {
    conditions.push("cc.branch_id = ?");
    params.push(query.branchId);
  }
  if (typeof query.companyName === "string" && query.companyName) {
    conditions.push("cc.company_name = ?");
    params.push(query.companyName);
  }
  if (typeof query.financeYear === "string" && query.financeYear) {
    conditions.push("ci.finance_year = ?");
    params.push(query.financeYear);
  }
  if (typeof query.invoiceType === "string" && query.invoiceType) {
    conditions.push("ci.invoice_type = ?");
    params.push(query.invoiceType);
  }
  // Legacy two-step approval queues: "View & Approve Proforma" vs "Invoice Approval".
  if (query.stage === "proforma_approval") {
    conditions.push("ci.invoice_status = 'proforma' AND ci.proforma_approved_at IS NULL");
  } else if (query.stage === "invoice_approval") {
    conditions.push("ci.invoice_status = 'proforma' AND ci.proforma_approved_at IS NOT NULL");
  }
  if (typeof query.search === "string" && query.search.trim()) {
    conditions.push(
      "(ci.proforma_no LIKE ? OR ci.bill_no LIKE ? OR cc.billing_client_name LIKE ? OR cc.company_name LIKE ?)"
    );
    const like = `%${query.search.trim()}%`;
    params.push(like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

router.get(
  "/proformas",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Resolves cost_centre_id -> a display name via one join, so the list/table doesn't
    // have to show a raw UUID (2026-08-21 fix). ci.* keeps every existing field name
    // intact for the frontend's current InvoiceRow shape; the two extra columns are
    // additive. Server-side filter + pagination added 2026-08-21 (Phase 2) — the page
    // used to fetch the entire table and filter client-side.
    //
    // ORDER BY fixed 2026-08-27 — two separate defects in one clause:
    //
    // 1. It sorted by `created_at`, which for 10,794 of 10,794 rows is the CUTOVER LOAD
    //    timestamp, not a business date. The final backfill batch (migration 1309's
    //    LEGACY-UNMAPPED-VODAFONE-2015-17 rows) loaded last, so page 1 of the Invoices tab
    //    opened on 2015-16/2016-17 Vodafone bills — the OLDEST invoices in the book shown
    //    as the newest — while this month's invoices sat somewhere inside 432 pages.
    //    Confirmed live in the browser before the fix. `invoice_date` is what a finance
    //    user means by "latest".
    // 2. `created_at` is `datetime(0)` and the bulk load wrote up to 30 rows in the same
    //    second, so the sort key was massively non-unique with NO tiebreaker. MySQL does
    //    not guarantee a stable order across separate LIMIT/OFFSET queries when the
    //    ORDER BY key ties, so paging could show one invoice twice and skip another
    //    entirely. `ci.id` is the primary key, so appending it makes the order total.
    //
    // The export below uses the identical ordering — see buildInvoiceListQuery's note on
    // why the two must never drift.
    const { where, params } = buildInvoiceListQuery(req.query as Record<string, unknown>);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    // .query() not .execute(): mysql2 on this server throws ER_WRONG_ARGUMENTS binding
    // LIMIT/OFFSET via the prepared-statement protocol (same issue documented in
    // grn.service.ts's listGrns). limit/offset are server-clamped numbers above, never
    // raw user input, so the text protocol is safe here.
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ci.*, ${COST_CENTRE_DISPLAY_NAME_SQL} AS cost_centre_display_name,
              cc.cost_centre_code AS cost_centre_code, cc.company_name AS company_name,
              b.branch_name AS branch_name
       FROM client_invoice ci
       LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       ${where}
       ORDER BY ci.invoice_date DESC, ci.created_at DESC, ci.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM client_invoice ci LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id ${where}`,
      params
    );
    res.json({
      success: true,
      data: rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    });
  })
);

router.get(
  "/proformas/export",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Registered before /proformas/:id — Express matches by registration order and
    // :id would otherwise swallow "export" as an id, 404ing this route (the exact trap
    // already documented next to the GRN aging route in vendor-payment.routes.ts).
    const { where, params } = buildInvoiceListQuery(req.query as Record<string, unknown>);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ci.proforma_no, ci.bill_no, ci.invoice_status, ci.category, ci.finance_year, ci.month_label,
              ci.invoice_date, ci.gst_type, ci.total_amount, ci.igst_amount, ci.cgst_amount, ci.sgst_amount,
              ci.grand_total, ci.created_at,
              ${COST_CENTRE_DISPLAY_NAME_SQL} AS cost_centre_display_name,
              cc.cost_centre_code
       FROM client_invoice ci
       LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
       ${where}
       ORDER BY ci.invoice_date DESC, ci.created_at DESC, ci.id DESC`,
      params
    );

    const columns = [
      "Proforma No", "Bill No", "Status", "Category", "Finance Year", "Month", "Invoice Date",
      "Cost Centre Code", "Cost Centre", "GST Type", "Taxable Value", "IGST", "CGST", "SGST",
      "Grand Total", "Created At",
    ];
    const csvRows = [
      columns.map(escape).join(","),
      ...rows.map((r) =>
        [
          r.proforma_no, r.bill_no, r.invoice_status, r.category, r.finance_year, r.month_label,
          r.invoice_date, r.cost_centre_code, r.cost_centre_display_name, r.gst_type, r.total_amount,
          r.igst_amount, r.cgst_amount, r.sgst_amount, r.grand_total, r.created_at,
        ].map(escape).join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="client-billing-invoices-export.csv"');
    res.send(csvRows.join("\n"));
  })
);

router.get(
  "/summary",
  requireRole(...ALLOWED_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    // Aggregated in SQL, not summed from a fetched page — listProformas/listCreditNotes
    // are paginated (limit clamped to 200), so summing a page silently under-reports on
    // any dataset larger than that, same reasoning as grn.service.ts's getGrnSummary.
    // The four aggregates are independent read-only queries, so they run concurrently.
    const [[invoiceRows], [creditNoteRows], [[thisMonth]], [[pendingActionable]], [[pendingProvisions]]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT invoice_status, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
       FROM client_invoice GROUP BY invoice_status`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT credit_status, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
       FROM client_credit_note GROUP BY credit_status`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
       FROM client_invoice
       WHERE invoice_status = 'approved'
         AND DATE_FORMAT(invoice_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
      ),
      // "Pending approval" must count only proformas somebody can ACT on. Both
      // approveInvoice and rejectInvoice refuse any row with is_migrated = 1 (design §3 —
      // a migrated historical record is read-only through the live workflow), so counting
      // migrated proformas here produced a work queue that could never reach zero.
      // The list endpoint still returns those rows — they are legitimate history to read —
      // this only stops them being reported as outstanding work.
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(proforma_approved_at IS NULL), 0) AS awaitingProforma,
                COALESCE(SUM(proforma_approved_at IS NOT NULL), 0) AS awaitingInvoice
       FROM client_invoice
       WHERE invoice_status = 'proforma' AND is_migrated = 0`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM client_provision WHERE provision_status = 'pending'`
      ),
    ]);

    const invoices: Record<string, { count: number; total: number }> = {
      proforma: { count: 0, total: 0 }, approved: { count: 0, total: 0 }, rejected: { count: 0, total: 0 },
    };
    for (const row of invoiceRows) {
      invoices[String(row.invoice_status)] = { count: Number(row.count), total: Number(row.total) };
    }
    const creditNotes: Record<string, { count: number; total: number }> = {
      draft: { count: 0, total: 0 }, approved: { count: 0, total: 0 },
    };
    for (const row of creditNoteRows) {
      creditNotes[String(row.credit_status)] = { count: Number(row.count), total: Number(row.total) };
    }

    res.json({
      success: true,
      data: {
        invoices,
        creditNotes,
        thisMonthBilled: { count: Number(thisMonth?.count ?? 0), total: Number(thisMonth?.total ?? 0) },
        pendingApprovalCount: Number(pendingActionable?.count ?? 0),
        // Legacy two-step queues + pending provisions, for the step bar.
        awaitingProformaApprovalCount: Number(pendingActionable?.awaitingProforma ?? 0),
        awaitingInvoiceApprovalCount: Number(pendingActionable?.awaitingInvoice ?? 0),
        pendingProvisionCount: Number(pendingProvisions?.count ?? 0),
      },
    });
  })
);

router.get(
  "/proformas/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [invoiceRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    const invoice = invoiceRows[0];
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice_line WHERE invoice_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...invoice, lines: lineRows } });
  })
);

router.get(
  "/proformas/:id/pdf",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const lhVal = req.query.letterhead; const withLetterhead = lhVal !== "false" && lhVal !== "0";
    const pdf = await clientBillingPdfService.generateInvoicePdf(req.params.id, withLetterhead);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  })
);

/**
 * DECIDE guard (owner policy 2026-10-01; same predicate as the Approval Center popup). Finance roles are org-wide
 * (isOrgWideUser); `admin` may only decide an invoice / credit note whose cost centre sits in the branch of their OWN
 * employees record. Fails closed when the cost centre has no branch. A row that does not exist falls through so the
 * service keeps its usual "not found" answer.
 */
async function guardDecide(req: AuthenticatedRequest, res: Response, kind: "invoice" | "creditNote"): Promise<boolean> {
  const policy = await loadBranchPolicy(req.authUser!.id);
  if (policy.orgWide) return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    kind === "invoice"
      ? `SELECT cc.branch_id FROM client_invoice ci LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id WHERE ci.id = ? LIMIT 1`
      : `SELECT cc.branch_id FROM client_credit_note ccn LEFT JOIN client_invoice ci ON ci.id = ccn.invoice_id LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id WHERE ccn.id = ? LIMIT 1`,
    [req.params.id],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return true;
  if (policy.allows(row.branch_id)) return true;
  res.status(403).json({ success: false, error: "Forbidden: this billing record is outside your branch / assigned scope" });
  return false;
}

/** Step 1 of 2 — legacy "View & Approve Proforma" (no bill number yet). */
router.post(
  "/proformas/:id/approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardDecide(req, res, "invoice"))) return;
    const data = await clientBillingApprovalService.approveProforma({
      invoiceId: req.params.id,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

/** Step 2 of 2 — legacy "Invoice Approval": mints the bill number. */
router.post(
  "/invoices/:id/approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardDecide(req, res, "invoice"))) return;
    const body = req.body as { poNumbers?: string[] };
    const data = await clientBillingApprovalService.approveInvoice({
      invoiceId: req.params.id,
      poNumbers: body.poNumbers,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

router.post(
  "/invoices/:id/reject",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardDecide(req, res, "invoice"))) return;
    const body = req.body as { reason?: string };
    if (!body.reason || body.reason.trim().length === 0) {
      return res.status(400).json({ error: "reason is required" });
    }
    const data = await clientBillingApprovalService.rejectInvoice({
      invoiceId: req.params.id,
      reason: body.reason,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

router.get(
  "/invoices/:id/audit-log",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice_audit_log WHERE invoice_id = ? ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  })
);

router.get(
  "/invoices/:id/pdf",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const lhVal = req.query.letterhead; const withLetterhead = lhVal !== "false" && lhVal !== "0";
    const pdf = await clientBillingPdfService.generateInvoicePdf(req.params.id, withLetterhead);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  })
);

router.post(
  "/credit-notes",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      invoiceId?: string; category?: string; financeYear?: string; monthLabel?: string;
      creditDate?: string; description?: string; applyGst?: boolean;
      lines?: Array<{ particulars: string; qty: number; rate: number }>;
    };
    if (!body.invoiceId || !body.category || !body.financeYear || !body.monthLabel || !body.creditDate) {
      return res.status(400).json({ error: "invoiceId, category, financeYear, monthLabel, and creditDate are required" });
    }
    const data = await clientBillingCreditNoteService.createCreditNote({
      invoiceId: body.invoiceId, category: body.category, financeYear: body.financeYear,
      monthLabel: body.monthLabel, creditDate: body.creditDate, description: body.description,
      applyGst: body.applyGst, lines: body.lines ?? [], userId: req.authUser!.id,
    });
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/credit-notes/:id/approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardDecide(req, res, "creditNote"))) return;
    const data = await clientBillingCreditNoteService.approveCreditNote({
      creditNoteId: req.params.id, userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

/** Shared WHERE-builder for the credit-notes list + its CSV export — same reasoning as
 *  buildInvoiceListQuery. */
function buildCreditNoteListQuery(query: Record<string, unknown>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const status = typeof query.status === "string" ? query.status : undefined;
  if (status && ["draft", "approved"].includes(status)) {
    conditions.push("ccn.credit_status = ?");
    params.push(status);
  }
  if (typeof query.fromDate === "string" && query.fromDate) {
    conditions.push("ccn.credit_date >= ?");
    params.push(query.fromDate);
  }
  if (typeof query.toDate === "string" && query.toDate) {
    conditions.push("ccn.credit_date <= ?");
    params.push(query.toDate);
  }
  if (typeof query.costCentreId === "string" && query.costCentreId) {
    conditions.push("ccn.cost_centre_id = ?");
    params.push(query.costCentreId);
  }
  if (typeof query.search === "string" && query.search.trim()) {
    conditions.push(
      "(ccn.credit_no LIKE ? OR cc.billing_client_name LIKE ? OR cc.company_name LIKE ? OR ci.bill_no LIKE ?)"
    );
    const like = `%${query.search.trim()}%`;
    params.push(like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

router.get(
  "/credit-notes",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Same display-name join as /proformas, plus the referenced invoice's own printable
    // number so the table can show "against 09-100/26-27" instead of a raw invoice UUID.
    // Server-side filter + pagination added 2026-08-21 (Phase 2), same shape as /proformas.
    const { where, params } = buildCreditNoteListQuery(req.query as Record<string, unknown>);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ccn.*, ${COST_CENTRE_DISPLAY_NAME_SQL} AS cost_centre_display_name,
              COALESCE(ci.bill_no, ci.proforma_no) AS against_invoice_number
       FROM client_credit_note ccn
       LEFT JOIN cost_centre_master cc ON cc.id = ccn.cost_centre_id
       LEFT JOIN client_invoice ci ON ci.id = ccn.invoice_id
       ${where}
       ORDER BY ccn.credit_date DESC, ccn.created_at DESC, ccn.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM client_credit_note ccn
       LEFT JOIN cost_centre_master cc ON cc.id = ccn.cost_centre_id
       LEFT JOIN client_invoice ci ON ci.id = ccn.invoice_id ${where}`,
      params
    );
    res.json({
      success: true,
      data: rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    });
  })
);

router.get(
  "/credit-notes/export",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Registered before /credit-notes/:id — same route-ordering reason as /proformas/export.
    const { where, params } = buildCreditNoteListQuery(req.query as Record<string, unknown>);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ccn.credit_no, COALESCE(ci.bill_no, ci.proforma_no) AS against_invoice_number,
              ccn.credit_status, ccn.category, ccn.finance_year, ccn.month_label, ccn.credit_date,
              ccn.gst_type, ccn.total_amount, ccn.igst_amount, ccn.cgst_amount, ccn.sgst_amount,
              ccn.grand_total, ccn.created_at,
              ${COST_CENTRE_DISPLAY_NAME_SQL} AS cost_centre_display_name,
              cc.cost_centre_code
       FROM client_credit_note ccn
       LEFT JOIN cost_centre_master cc ON cc.id = ccn.cost_centre_id
       LEFT JOIN client_invoice ci ON ci.id = ccn.invoice_id
       ${where}
       ORDER BY ccn.credit_date DESC, ccn.created_at DESC, ccn.id DESC`,
      params
    );

    const columns = [
      "Credit Note No", "Against Invoice", "Status", "Category", "Finance Year", "Month",
      "Credit Date", "Cost Centre Code", "Cost Centre", "GST Type", "Taxable Value", "IGST",
      "CGST", "SGST", "Grand Total", "Created At",
    ];
    const csvRows = [
      columns.map(escape).join(","),
      ...rows.map((r) =>
        [
          r.credit_no, r.against_invoice_number, r.credit_status, r.category, r.finance_year,
          r.month_label, r.credit_date, r.cost_centre_code, r.cost_centre_display_name, r.gst_type,
          r.total_amount, r.igst_amount, r.cgst_amount, r.sgst_amount, r.grand_total, r.created_at,
        ].map(escape).join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="client-billing-credit-notes-export.csv"');
    res.send(csvRows.join("\n"));
  })
);

router.get(
  "/credit-notes/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM client_credit_note WHERE id = ? LIMIT 1`, [req.params.id]);
    const creditNote = rows[0];
    if (!creditNote) return res.status(404).json({ error: "Credit note not found" });
    const [lineRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM client_credit_note_line WHERE credit_note_id = ?`, [req.params.id]);
    res.json({ success: true, data: { ...creditNote, lines: lineRows } });
  })
);

router.get(
  "/credit-notes/:id/pdf",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const lhVal = req.query.letterhead; const withLetterhead = lhVal !== "false" && lhVal !== "0";
    const pdf = await clientBillingPdfService.generateCreditNotePdf(req.params.id, withLetterhead);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  })
);

// ── P5: edit proforma ──────────────────────────────────────────────────────────
router.put(
  "/proformas/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await clientBillingEditService.updateProforma({
      invoiceId: req.params.id,
      userId: req.authUser!.id,
      ...req.body,
    });
    res.json({ success: true, data });
  })
);

// ── P5: PO / GRN / JCC helpers ────────────────────────────────────────────────
router.get(
  "/po/available",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { costCentreId, invoiceDate } = req.query as Record<string, string>;
    if (!costCentreId || !invoiceDate) {
      return res.status(400).json({ error: "costCentreId and invoiceDate are required" });
    }
    const rows = await listAvailablePos(costCentreId, invoiceDate);
    res.json({ success: true, data: rows });
  })
);

router.get(
  "/po/check",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { costCentreId, invoiceDate, grandTotal, poNumbers } = req.query as Record<string, string>;
    if (!costCentreId || !invoiceDate || !grandTotal) {
      return res.status(400).json({ error: "costCentreId, invoiceDate, and grandTotal are required" });
    }
    const parsedPoNumbers = String(poNumbers ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const { usableRows: _, ...result } = await checkPoCoverage({
      costCentreId,
      invoiceDate,
      grandTotal: Number(grandTotal),
      poNumbers: parsedPoNumbers,
    });
    res.json({ success: true, data: result });
  })
);

// ── P5: bulk approve ───────────────────────────────────────────────────────────
// Registered BEFORE /invoices/:id so Express does not try to match "bulk-approve" as an id.
router.post(
  "/invoices/bulk-approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { invoiceIds } = req.body as { invoiceIds: string[] };
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: "invoiceIds must be a non-empty array" });
    }
    const results = await clientBillingChangeRequestService.bulkApprove(
      invoiceIds,
      req.authUser!.id,
    );
    const approved = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    res.json({ success: true, data: { approved, failed, results } });
  })
);

// ── P5: submit to client ───────────────────────────────────────────────────────
router.get(
  "/invoices/:id/submissions",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const rows = await clientBillingSubmitService.listSubmissions(req.params.id);
    res.json({ success: true, data: rows });
  })
);

router.post(
  "/invoices/:id/submit-to-client",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      to: string[] | string;
      cc?: string[] | string;
      subject?: string;
      message?: string;
      letterhead?: boolean;
    };
    const result = await clientBillingSubmitService.submitToClient({
      invoiceId: req.params.id,
      to: body.to,
      cc: body.cc,
      subject: body.subject,
      message: body.message,
      letterhead: body.letterhead !== false,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data: result });
  })
);

// ── P5: change requests ────────────────────────────────────────────────────────
router.post(
  "/invoices/:id/change-requests",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { requestType: string; reason: string; requestedValue?: string };
    if (!body.requestType || !body.reason) {
      return res.status(400).json({ error: "requestType and reason are required" });
    }
    const data = await clientBillingChangeRequestService.createChangeRequest({
      invoiceId: req.params.id,
      requestType: body.requestType as "void" | "status_change",
      reason: body.reason,
      requestedValue: body.requestedValue,
      userId: req.authUser!.id,
    });
    res.status(201).json({ success: true, data });
  })
);

router.get(
  "/invoices/:id/change-requests",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cicr.*, u.name AS requested_by_name
       FROM client_invoice_change_request cicr
       LEFT JOIN users u ON u.id = cicr.requested_by
       WHERE cicr.invoice_id = ?
       ORDER BY cicr.created_at DESC`,
      [req.params.id],
    );
    res.json({ success: true, data: rows });
  })
);

router.get(
  "/change-requests",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) { conditions.push("cicr.request_status = ?"); params.push(status); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT cicr.*,
              COALESCE(ci.bill_no, ci.proforma_no) AS invoice_ref, ci.bill_no, ci.proforma_no,
              ci.invoice_status, ci.grand_total, ci.month_label,
              ${COST_CENTRE_DISPLAY_NAME_SQL} AS cost_centre_display_name
       FROM client_invoice_change_request cicr
       LEFT JOIN client_invoice ci ON ci.id = cicr.invoice_id
       LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
       ${where}
       ORDER BY cicr.created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM client_invoice_change_request cicr ${where}`,
      params,
    );
    res.json({ success: true, data: rows, total: Number(total), page: pageNum, limit: limitNum });
  })
);

router.get(
  "/change-requests/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cicr.*,
              COALESCE(ci.bill_no, ci.proforma_no) AS invoice_ref, ci.bill_no, ci.proforma_no,
              ci.invoice_status, ci.grand_total, ci.category, ci.finance_year,
              ci.invoice_date, ci.month_label,
              ${COST_CENTRE_DISPLAY_NAME_SQL} AS cost_centre_display_name
       FROM client_invoice_change_request cicr
       LEFT JOIN client_invoice ci ON ci.id = cicr.invoice_id
       LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
       WHERE cicr.id = ? LIMIT 1`,
      [req.params.id],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "Change request not found" });
    const [auditLog] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice_audit_log WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 20`,
      [row.invoice_id],
    );
    res.json({ success: true, data: { ...row, audit_log: auditLog } });
  })
);

router.post(
  "/change-requests/:id/approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await clientBillingChangeRequestService.decideChangeRequest({
      requestId: req.params.id,
      decision: "approve",
      note: req.body?.note,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

router.post(
  "/change-requests/:id/decline",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await clientBillingChangeRequestService.decideChangeRequest({
      requestId: req.params.id,
      decision: "decline",
      note: req.body?.note,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

// ── Legacy sequence: filter options (Company / Branch / cost centres) ──────────
router.get(
  "/filter-options",
  requireRole(...ALLOWED_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cc.id, cc.cost_centre_code, cc.cost_centre_name, cc.company_name, cc.branch_id,
              b.branch_name, ${COST_CENTRE_DISPLAY_NAME_SQL} AS client_name,
              b.gst_state_code AS state_code, cc.gst_type, cc.vendor_gst_no
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE ${ownCompanyCostCentreSql("cc")} AND cc.active_status = 1
       ORDER BY cc.company_name, b.branch_name, cc.cost_centre_code`,
    );
    const companies = [...new Set(rows.map((r) => String(r.company_name ?? "").trim()).filter(Boolean))];
    const branchMap = new Map<string, string>();
    for (const r of rows) if (r.branch_id) branchMap.set(String(r.branch_id), String(r.branch_name ?? r.branch_id));
    const branches = [...branchMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, data: { companies, branches, costCentres: rows } });
  })
);

// ── Legacy sequence: per-invoice Export (Download Initial Invoice → Export) ────
router.get(
  "/invoices/:id/export",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [invRows] = await db.execute<RowDataPacket[]>(
      `SELECT ci.*, ${COST_CENTRE_DISPLAY_NAME_SQL} AS cost_centre_display_name,
              cc.cost_centre_code, cc.company_name, b.branch_name
       FROM client_invoice ci
       LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE ci.id = ? LIMIT 1`,
      [req.params.id],
    );
    const inv = invRows[0];
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT line_type, particulars, qty, rate, amount FROM client_invoice_line
       WHERE invoice_id = ? ORDER BY created_at, id`,
      [req.params.id],
    );
    const header: Array<[string, unknown]> = [
      ["Company", inv.company_name], ["Branch", inv.branch_name], ["Cost Centre", inv.cost_centre_code],
      ["Client", inv.cost_centre_display_name], ["Bill No", inv.bill_no], ["Proforma No", inv.proforma_no],
      ["Invoice Date", inv.invoice_date ? String(inv.invoice_date instanceof Date ? inv.invoice_date.toISOString() : inv.invoice_date).slice(0, 10) : ""],
      ["Finance Year", inv.finance_year], ["Month", inv.month_label], ["Invoice Type", inv.invoice_type],
      ["Category", inv.category], ["Description", inv.description], ["PO No", inv.po_numbers],
      ["GRN No", inv.grn_no], ["JCC No", inv.jcc_no],
    ];
    const csv: string[] = header.map(([k, v]) => [k, v].map(escape).join(","));
    csv.push("");
    csv.push(["S.No", "Type", "Particulars", "Rate", "Qty", "Amount"].map(escape).join(","));
    lines.forEach((l, i) => {
      csv.push([i + 1, l.line_type, l.particulars, l.rate, l.qty, l.amount].map(escape).join(","));
    });
    csv.push("");
    csv.push(["Total", inv.total_amount].map(escape).join(","));
    if (Number(inv.igst_amount) > 0) csv.push(["IGST @ 18%", inv.igst_amount].map(escape).join(","));
    if (Number(inv.cgst_amount) > 0) csv.push(["CGST @ 9%", inv.cgst_amount].map(escape).join(","));
    if (Number(inv.sgst_amount) > 0) csv.push(["SGST @ 9%", inv.sgst_amount].map(escape).join(","));
    csv.push(["Grand Total", inv.grand_total].map(escape).join(","));
    const fileName = String(inv.bill_no || inv.proforma_no || inv.id).replace(/[^A-Za-z0-9._-]+/g, "_");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${fileName}.csv"`);
    res.send(csv.join("\n"));
  })
);

// ── Legacy sequence: Provision (create → approve → drawn down by invoices) ────
async function guardProvisionDecide(req: AuthenticatedRequest, res: Response): Promise<boolean> {
  const policy = await loadBranchPolicy(req.authUser!.id);
  if (policy.orgWide) return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cc.branch_id FROM client_provision cp LEFT JOIN cost_centre_master cc ON cc.id = cp.cost_centre_id WHERE cp.id = ? LIMIT 1`,
    [req.params.id],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return true;
  if (policy.allows(row.branch_id)) return true;
  res.status(403).json({ success: false, error: "Forbidden: this provision is outside your branch / assigned scope" });
  return false;
}

router.get(
  "/provisions",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const data = await clientBillingProvisionService.listProvisions({
      financeYear: q.financeYear, monthLabel: q.monthLabel, costCentreId: q.costCentreId,
      branchId: q.branchId, companyName: q.companyName, status: q.status, search: q.search,
      page: Number(q.page) || 1, limit: Number(q.limit) || 50,
    });
    res.json({ success: true, data: data.rows, total: data.total, page: data.page, limit: data.limit });
  })
);

// Registered before /provisions/:id routes so "scope" / "upload" are never read as an id.
router.get(
  "/provisions/scope",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { costCentreId, financeYear, monthLabel } = req.query as Record<string, string>;
    if (!costCentreId || !financeYear || !monthLabel) {
      return res.status(400).json({ error: "costCentreId, financeYear and monthLabel are required" });
    }
    const data = await clientBillingProvisionService.getProvisionForScope(costCentreId, financeYear, monthLabel);
    res.json({ success: true, data, required: provisionRequired() });
  })
);

router.post(
  "/provisions/upload",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { rows } = req.body as { rows?: unknown };
    const results = await clientBillingProvisionService.uploadProvisions(
      rows as Parameters<typeof clientBillingProvisionService.uploadProvisions>[0],
      req.authUser!.id,
    );
    res.json({
      success: true,
      data: { created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results },
    });
  })
);

router.post(
  "/provisions",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as { costCentreId?: string; financeYear?: string; monthLabel?: string; amount?: number; remarks?: string; invoiceType?: string };
    if (!body.costCentreId || !body.financeYear || !body.monthLabel || body.amount === undefined) {
      return res.status(400).json({ error: "costCentreId, financeYear, monthLabel and amount are required" });
    }
    const data = await clientBillingProvisionService.createProvision({
      costCentreId: body.costCentreId, financeYear: body.financeYear, monthLabel: body.monthLabel,
      amount: Number(body.amount), remarks: body.remarks, invoiceType: body.invoiceType, userId: req.authUser!.id,
    });
    res.status(201).json({ success: true, data });
  })
);

router.put(
  "/provisions/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardProvisionDecide(req, res))) return;
    const body = req.body as { amount?: number; remarks?: string | null };
    const data = await clientBillingProvisionService.updateProvision({
      id: req.params.id,
      amount: body.amount === undefined ? undefined : Number(body.amount),
      remarks: body.remarks,
      userId: req.authUser!.id,
    });
    res.json({ success: true, data });
  })
);

router.post(
  "/provisions/:id/approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardProvisionDecide(req, res))) return;
    const data = await clientBillingProvisionService.approveProvision(req.params.id, req.authUser!.id);
    res.json({ success: true, data });
  })
);

/** Pending edit of an APPROVED provision (legacy provision_master_edit_request): approve / decline. */
router.post(
  "/provisions/:id/edit/:decision",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const decision = req.params.decision;
    if (decision !== "approve" && decision !== "decline") return res.status(404).json({ error: "Unknown decision" });
    if (!(await guardProvisionDecide(req, res))) return;
    const data = await clientBillingProvisionService.decideProvisionEdit(req.params.id, decision, req.authUser!.id);
    res.json({ success: true, data });
  })
);

router.post(
  "/provisions/:id/reject",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardProvisionDecide(req, res))) return;
    const reason = String((req.body as { reason?: string })?.reason ?? "");
    const data = await clientBillingProvisionService.rejectProvision(req.params.id, reason, req.authUser!.id);
    res.json({ success: true, data });
  })
);

// ── Legacy ADD PO / Approve PO / ADD GRN ──────────────────────────────────────
router.get(
  "/po",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const data = await clientBillingPoGrnService.listPos({ costCentreId: q.costCentreId, branchId: q.branchId, companyName: q.companyName, search: q.search });
    res.json({ success: true, data });
  })
);

router.post(
  "/po",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const b = req.body as { costCentreId?: string; poNumber?: string; periodFrom?: string; periodTo?: string; amount?: number };
    if (!b.costCentreId) return res.status(400).json({ error: "costCentreId is required" });
    const data = await clientBillingPoGrnService.createPo({
      costCentreId: b.costCentreId, poNumber: String(b.poNumber ?? ""), periodFrom: String(b.periodFrom ?? ""),
      periodTo: String(b.periodTo ?? ""), amount: Number(b.amount), userId: req.authUser!.id,
    });
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/invoices/:id/approve-po",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardDecide(req, res, "invoice"))) return;
    const data = await clientBillingPoGrnService.approvePo(req.params.id, req.authUser!.id);
    res.json({ success: true, data });
  })
);

router.put(
  "/invoices/:id/grn",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!(await guardDecide(req, res, "invoice"))) return;
    const b = req.body as { grnNo?: string; grnDate?: string | null };
    const data = await clientBillingPoGrnService.addGrn(req.params.id, { grnNo: String(b.grnNo ?? ""), grnDate: b.grnDate ?? null, userId: req.authUser!.id });
    res.json({ success: true, data });
  })
);

/** Header for the legacy proforma entry page: GST No, Vendor GST No, Bill To / Ship To. */
router.get(
  "/cost-centres/:id/billing-header",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cc.id, cc.cost_centre_code, cc.company_name, b.branch_name, b.gst_state_code AS state_code,
              ${COST_CENTRE_DISPLAY_NAME_SQL} AS client_name,
              cc.service_tax_no, cc.vendor_gst_no, cc.vendor_gst_state, cc.vendor_state_code, cc.gst_type,
              cc.bill_to_address1, cc.bill_to_address2, cc.bill_to_address3, cc.bill_to_address4, cc.bill_to_address5,
              cc.ship_to_address1, cc.ship_to_address2, cc.ship_to_address3, cc.ship_to_address4, cc.ship_to_address5
       FROM cost_centre_master cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.id = ? LIMIT 1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Cost centre not found" });
    res.json({ success: true, data: rows[0] });
  })
);

// ── Receipts: money received against bills (Receivables & Money Flow phase 1) ──
/** Branch-scoped callers see only their own branch; org-wide finance sees all (null). */
async function receiptBranchScope(req: AuthenticatedRequest): Promise<string[] | null> {
  const policy = await loadBranchPolicy(req.authUser!.id);
  if (policy.orgWide) return null;
  return policy.ownBranchId ? [policy.ownBranchId] : [];
}

/**
 * Whether Receipts is THE place to record client money. False until the I-Spark collections are
 * imported (CLIENT_BILLING_LEGACY_COLLECTIONS_IMPORTED=true): until then I-Spark bills cannot take
 * receipts here, so the Payment Vouchers "Record Receipt" stays the working path.
 */
router.get(
  "/receipts/settings",
  h(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, data: { receiptsAreSingleEntry: legacyBillsAllowed() } });
  })
);

router.get(
  "/receipts/outstanding",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const data = await clientBillingReceiptService.listOutstanding({
      clientName: q.clientName, costCentreId: q.costCentreId, branchId: q.branchId, companyName: q.companyName,
      search: q.search, branchIds: await receiptBranchScope(req),
    });
    res.json({ success: true, data });
  })
);

router.get(
  "/receipts",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const status = q.status && ["void", "in_bank", "voucher_rejected", "awaiting_bank"].includes(q.status) ? q.status : undefined;
    const data = await clientBillingReceiptService.listReceipts({
      fromDate: q.fromDate, toDate: q.toDate, branchId: q.branchId, companyName: q.companyName, search: q.search, status,
      page: Number(q.page) || 1, limit: Number(q.limit) || 50, branchIds: await receiptBranchScope(req),
    });
    res.json({ success: true, data: data.rows, total: data.total, page: data.page, limit: data.limit });
  })
);

router.get(
  "/receipts/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await clientBillingReceiptService.getReceipt(req.params.id);
    const scope = await receiptBranchScope(req);
    if (scope && !scope.includes(String(data.branch_id ?? ""))) return res.status(403).json({ error: "Outside your branch" });
    res.json({ success: true, data });
  })
);

router.post(
  "/receipts",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const b = req.body as {
      receiptDate?: string; bankAccountId?: string; paymentMode?: string; referenceNo?: string; remarks?: string;
      amountReceived?: number; allocations?: Array<{ invoiceId: string; received: number; tds?: number; deduction?: number }>;
    };
    const scope = await receiptBranchScope(req);
    if (scope && Array.isArray(b.allocations) && b.allocations.length) {
      const ids = b.allocations.map((a) => String(a.invoiceId));
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT cc.branch_id FROM client_invoice ci JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id WHERE ci.id IN (${ids.map(() => "?").join(",")})`, ids,
      );
      if (rows.some((r) => !scope.includes(String(r.branch_id ?? "")))) return res.status(403).json({ error: "A bill is outside your branch" });
    }
    const data = await clientBillingReceiptService.createReceipt({
      receiptDate: String(b.receiptDate ?? ""), bankAccountId: String(b.bankAccountId ?? ""), paymentMode: String(b.paymentMode ?? ""),
      referenceNo: b.referenceNo, remarks: b.remarks, amountReceived: b.amountReceived, allocations: b.allocations ?? [],
      userId: req.authUser!.id, userRole: req.authUser!.role,
    });
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/receipts/:id/void",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const current = await clientBillingReceiptService.getReceipt(req.params.id);
    const scope = await receiptBranchScope(req);
    if (scope && !scope.includes(String(current.branch_id ?? ""))) return res.status(403).json({ error: "Outside your branch" });
    const data = await clientBillingReceiptService.voidReceipt(req.params.id, String((req.body as { reason?: string })?.reason ?? ""), req.authUser!.id, req.authUser!.role);
    res.json({ success: true, data });
  })
);

export { router as clientBillingRouter };
