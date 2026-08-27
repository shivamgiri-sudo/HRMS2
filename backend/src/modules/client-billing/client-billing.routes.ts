import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { clientBillingService } from "./client-billing.service.js";
import { clientBillingApprovalService } from "./client-billing-approval.service.js";
import { clientBillingCreditNoteService } from "./client-billing-credit-note.service.js";
import { clientBillingPdfService } from "./client-billing-pdf.service.js";

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
      invoiceDate?: string; description?: string; applyGst?: boolean;
      lines?: Array<{ particulars: string; qty: number; rate: number; lineType?: "charge" | "deduction" }>;
    };
    if (!body.costCentreId || !body.category || !body.financeYear || !body.monthLabel || !body.invoiceDate) {
      return res.status(400).json({ error: "costCentreId, category, financeYear, monthLabel, and invoiceDate are required" });
    }
    const data = await clientBillingService.createProforma({
      costCentreId: body.costCentreId,
      category: body.category,
      financeYear: body.financeYear,
      monthLabel: body.monthLabel,
      invoiceDate: body.invoiceDate,
      description: body.description,
      applyGst: body.applyGst,
      lines: body.lines ?? [],
      createdBy: req.authUser!.id,
    });
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
              cc.cost_centre_code AS cost_centre_code
       FROM client_invoice ci
       LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id
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
    const [invoiceRows] = await db.execute<RowDataPacket[]>(
      `SELECT invoice_status, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
       FROM client_invoice GROUP BY invoice_status`
    );
    const [creditNoteRows] = await db.execute<RowDataPacket[]>(
      `SELECT credit_status, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
       FROM client_credit_note GROUP BY credit_status`
    );
    const [[thisMonth]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
       FROM client_invoice
       WHERE invoice_status = 'approved'
         AND DATE_FORMAT(invoice_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    );

    // "Pending approval" must count only proformas somebody can ACT on. Both
    // approveInvoice and rejectInvoice refuse any row with is_migrated = 1 (design §3 —
    // a migrated historical record is read-only through the live workflow), so counting
    // migrated proformas here produced a work queue that could never reach zero:
    // verified live 2026-08-27 that both of the 2 rows in this tile were is_migrated = 1,
    // and clicking Approve in the browser returned
    // "...is a migrated historical record (is_migrated=1) and cannot be approved".
    // The list endpoint still returns those rows — they are legitimate history to read —
    // this only stops them being reported as outstanding work.
    const [[pendingActionable]] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM client_invoice
       WHERE invoice_status = 'proforma' AND is_migrated = 0`
    );

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
    const withLetterhead = req.query.letterhead !== "false";
    const pdf = await clientBillingPdfService.generateInvoicePdf(req.params.id, withLetterhead);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  })
);

router.post(
  "/invoices/:id/approve",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
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
    const withLetterhead = req.query.letterhead !== "false";
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
    const withLetterhead = req.query.letterhead !== "false";
    const pdf = await clientBillingPdfService.generateCreditNotePdf(req.params.id, withLetterhead);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  })
);

export { router as clientBillingRouter };
