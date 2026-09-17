import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getBatchJob, readBatchProgress } from "./batch-job.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { loadRowsWithLiveStatus, reconcileStuckRows } from "./bulk-approval.service.js";
import { withDeadlockRetry } from "../../shared/deadlockRetry.js";
import { dispatchImport, assertGatedUploader, assertDepartmentStructureUploader } from "./bulk-dispatch.js";

/**
 * A batch left in 'importing' for longer than this is assumed to be from an API that
 * died mid-import, and is released so the uploader can retry.
 */
const STALE_IMPORT_MINUTES = 15;

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: import("express").Request, res: Response, next: NextFunction) => fn(req as AuthenticatedRequest, res).catch(next);

interface UploadBatchRow extends RowDataPacket {
  id: string;
}
router.use(requireAuth);

router.get("/templates", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM upload_template_master WHERE active_status = 1 ORDER BY upload_type_code ASC"
    );
    res.json({ success: true, data: rows });
  } catch (err: unknown) {
    // Table may not exist yet â€” return empty array gracefully
    if (typeof err === "object" && err !== null) {
      const code = String((err as { code?: unknown }).code ?? "");
      const message = String((err as { message?: unknown }).message ?? "");
      if (code === "ER_NO_SUCH_TABLE" || message.includes("doesn't exist")) {
        return res.json({ success: true, data: [] });
      }
    }
    throw err;
  }
}));

/**
 * Aggregate counters for Process Performance V2's landing page header
 * ("Total Files Uploaded" / "Active Users") -- real COUNT/COUNT DISTINCT
 * queries against upload_batch, not invented numbers. Scoped to exactly
 * the upload_type_codes this page's own uploader arrays write (kept in
 * sync by hand with src/pages/ProcessPerformanceV2Page.tsx -- 41 codes as
 * of 2026-09-16), so this reflects only Process Performance V2's own
 * uploads, not every bulk-upload feature in the app. Same row-level
 * scoping as GET /batches above, so a branch-scoped user sees counts for
 * their own branch/process, not the whole company's.
 */
const PROCESS_PERFORMANCE_V2_UPLOAD_TYPE_CODES = [
  "AW_BILLING_MASMIS", "AW_INBOUND_MASMIS", "AW_MANDATE_MASMIS", "AW_NEW_CDR_MASMIS", "AW_OUT_MASMIS",
  "BB_APR_MASMIS", "BB_CART_MASMIS", "BB_CHAT_MASMIS", "BB_SALE_MASMIS",
  "BIRLANU_APR_MASMIS", "BIRLANU_SALE_MASMIS",
  "CL_APR_MASMIS", "CL_CHAT_MASMIS", "CL_DISPO_MASMIS", "CL_EMAIL_RAW_MASMIS", "CL_FEEDBACK_MASMIS",
  "CL_IB_CDR_MASMIS", "CL_OUTBOUND_MASMIS", "CL_QUALITY_MASMIS", "CL_RECHURN_CALL_MASMIS",
  "GNC_ALLOCATION_MASMIS", "GNC_APR", "GNC_CHAT_MASMIS", "GNC_SALE_MASMIS",
  "LP_FEEDBACK_APR_MASMIS", "LP_FEEDBACK_CDR_MASMIS", "LP_ONBOARDING_APR_MASMIS", "LP_ONBOARDING_CDR_MASMIS",
  "NEEMANS_AGENT_DETAILS_MASMIS", "NEEMANS_ALLOCATION_MASMIS", "NEEMANS_APR_MASMIS", "NEEMANS_CHAT_MASMIS",
  "NEEMANS_MONTH_TARGET_MASMIS", "NEEMANS_SALE_RAW_MASMIS",
  "OWNER_AGENT_DETAILS_MASMIS", "OWNER_CDR_MASMIS", "OWNER_SALE_MASMIS",
  "PRE_AGENT_DETAILS_MASMIS", "PRE_CDR_MASMIS", "PRE_SALE_MASMIS",
  "SATYA_ALLOCATION_MASMIS", "SATYA_CDR_MASMIS",
];

router.get("/process-performance-v2-stats", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const scope = await buildScopeWhereClause(
    userId,
    ["admin", "hr", "wfm", "wfm_analyst", "payroll", "payroll_hr", "branch_head", "branch_admin"],
    { branchId: "COALESCE(ub.branch_id, uploader_emp.branch_id)" },
    { allowAdminBypass: true },
  );

  // Optional ?codes=A,B,C narrows the same aggregate to one company's own
  // upload types (e.g. the BellaVita hub card asking only about BB_*),
  // instead of the whole page's 41-code total. Any code not in the known
  // list is dropped rather than passed to SQL — cheap guard since these
  // reach a raw IN(...) list, even though every value is parameterized.
  const requestedCodes = String(req.query.codes ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => PROCESS_PERFORMANCE_V2_UPLOAD_TYPE_CODES.includes(c));
  const typeCodes = requestedCodes.length ? requestedCodes : PROCESS_PERFORMANCE_V2_UPLOAD_TYPE_CODES;

  const typeCodePlaceholders = typeCodes.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total_files, COUNT(DISTINCT ub.uploaded_by) AS active_users
       FROM upload_batch ub
       LEFT JOIN employees uploader_emp ON uploader_emp.user_id = ub.uploaded_by
      WHERE ub.upload_type_code IN (${typeCodePlaceholders})
        AND (ub.uploaded_by = ? OR (${scope.sql}))`,
    [...typeCodes, userId, ...scope.params],
  );

  res.json({
    success: true,
    data: {
      totalFilesUploaded: Number(rows[0]?.total_files ?? 0),
      activeUsers: Number(rows[0]?.active_users ?? 0),
    },
  });
}));

/**
 * Upload Batch History.
 *
 * WHAT THIS USED TO DO. `SELECT * FROM upload_batch ORDER BY created_at DESC LIMIT 50` â€” no scope
 * of any kind. Every role on the guard above saw every other user's uploads, from every branch,
 * including the original file name and row counts of work that was none of their business.
 *
 * WHAT IT DOES NOW. A caller always sees their own uploads, plus whatever their assignment scope
 * entitles them to, and nothing else:
 *
 *   own            uploaded_by = me. Unconditional â€” you can always find the file you uploaded.
 *   scope          buildScopeWhereClause(), the same helper this module's approval service already
 *                  uses. super_admin resolves to 1=1; a branch-scoped user gets their branch; a
 *                  user with no assignment scope gets 1=0 and is left with their own uploads only.
 *
 * EFFECTIVE BRANCH. upload_batch.branch_id is populated on only 32 of 65 live rows, so scoping on
 * that column alone would hide two thirds of the history from a branch head â€” including uploads
 * genuinely belonging to their branch. The uploader's own branch is used as the fallback, which
 * resolves for all 65, so branch scope means what a reader expects rather than what happens to
 * have been stamped.
 *
 * WHO RAISED IT. auth_user carries no name (email only), so the display name comes from the
 * employee record joined on user_id â€” populated for all 65 rows â€” falling back to the login email.
 */
router.get("/batches", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const scope = await buildScopeWhereClause(
    userId,
    ["admin", "hr", "wfm", "wfm_analyst", "payroll", "payroll_hr", "branch_head", "branch_admin"],
    { branchId: "COALESCE(ub.branch_id, uploader_emp.branch_id)" },
    { allowAdminBypass: true },
  );

  const where: string[] = [`(ub.uploaded_by = ? OR (${scope.sql}))`];
  const params: unknown[] = [userId, ...scope.params];

  // Filters. Each is optional and additive; an absent filter never narrows the result.
  const uploadType = String(req.query.uploadType ?? "").trim();
  if (uploadType) { where.push("ub.upload_type_code = ?"); params.push(uploadType); }

  const status = String(req.query.status ?? "").trim();
  if (status) { where.push("ub.batch_status = ?"); params.push(status); }

  const uploadedBy = String(req.query.uploadedBy ?? "").trim();
  if (uploadedBy) { where.push("ub.uploaded_by = ?"); params.push(uploadedBy); }

  // Dates are compared on the date part so an inclusive "to" does not silently drop same-day rows.
  const from = String(req.query.from ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push("DATE(ub.created_at) >= ?"); params.push(from); }
  const to = String(req.query.to ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push("DATE(ub.created_at) <= ?"); params.push(to); }

  const search = String(req.query.search ?? "").trim();
  if (search) {
    where.push("(ub.upload_batch_no LIKE ? OR ub.original_file_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ub.*,
            COALESCE(NULLIF(TRIM(uploader_emp.full_name), ''), uploader_user.email, ub.uploaded_by)
              AS uploaded_by_name,
            uploader_emp.employee_code AS uploaded_by_code,
            COALESCE(ub.branch_id, uploader_emp.branch_id) AS effective_branch_id,
            bm.branch_name AS branch_name
       FROM upload_batch ub
       LEFT JOIN employees  uploader_emp  ON uploader_emp.user_id = ub.uploaded_by
       LEFT JOIN auth_user  uploader_user ON uploader_user.id     = ub.uploaded_by
       LEFT JOIN branch_master bm ON bm.id = COALESCE(ub.branch_id, uploader_emp.branch_id)
      WHERE ${where.join(" AND ")}
      ORDER BY ub.created_at DESC
      LIMIT ${limit}`,
    params,
  );
  res.json({ success: true, data: rows });
}));

/**
 * The filter dropdown options, built from what this caller can actually see.
 *
 * Deliberately not a hardcoded list: CLAUDE.md's Form Input Rule requires option lists to come
 * from the real observed domain, and a type the user has never uploaded is noise in their filter.
 * Scoped identically to the list above, so the options can never hint at the existence of another
 * branch's uploads.
 */
router.get("/batches/filter-options", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const scope = await buildScopeWhereClause(
    userId,
    ["admin", "hr", "wfm", "wfm_analyst", "payroll", "payroll_hr", "branch_head", "branch_admin"],
    { branchId: "COALESCE(ub.branch_id, uploader_emp.branch_id)" },
    { allowAdminBypass: true },
  );
  const visible = `(ub.uploaded_by = ? OR (${scope.sql}))`;
  const params = [userId, ...scope.params];

  const [types] = await db.execute<RowDataPacket[]>(
    `SELECT ub.upload_type_code AS value, COUNT(*) AS n
       FROM upload_batch ub
       LEFT JOIN employees uploader_emp ON uploader_emp.user_id = ub.uploaded_by
      WHERE ${visible} GROUP BY ub.upload_type_code ORDER BY n DESC`, params);
  const [statuses] = await db.execute<RowDataPacket[]>(
    `SELECT ub.batch_status AS value, COUNT(*) AS n
       FROM upload_batch ub
       LEFT JOIN employees uploader_emp ON uploader_emp.user_id = ub.uploaded_by
      WHERE ${visible} GROUP BY ub.batch_status ORDER BY n DESC`, params);
  const [uploaders] = await db.execute<RowDataPacket[]>(
    `SELECT ub.uploaded_by AS value,
            COALESCE(NULLIF(TRIM(uploader_emp.full_name), ''), uploader_user.email, ub.uploaded_by) AS label,
            COUNT(*) AS n
       FROM upload_batch ub
       LEFT JOIN employees uploader_emp ON uploader_emp.user_id = ub.uploaded_by
       LEFT JOIN auth_user uploader_user ON uploader_user.id    = ub.uploaded_by
      WHERE ${visible} GROUP BY ub.uploaded_by, label ORDER BY n DESC`, params);

  res.json({ success: true, data: { types, statuses, uploaders } });
}));

/**
 * Each row now carries the ground truth alongside its own row_status:
 * `entity_created` â€” does a real record exist for this row at all â€” and
 * `entity_status` â€” that record's CURRENT status, read live from the table it
 * actually lives in (attendance_regularization / leave_request / the incentive or
 * deduction record). row_status is upload_batch_row's own bookkeeping and, before
 * this, was the only thing shown â€” see loadRowsWithLiveStatus's own comment for why
 * that alone was not trustworthy.
 */
router.get("/batches/:id/rows", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = await loadRowsWithLiveStatus(req.params.id);
  res.json({ success: true, data: rows });
}));

/**
 * On-demand healing for a batch stuck with rows that never reached a final outcome
 * (row_status still 'pending'/'valid' after the batch itself is already decided) â€”
 * the exact failure mode reconcileStuckRows exists to close off going forward. This
 * lets an admin repair a batch from BEFORE that fix shipped without needing direct
 * SQL access. It only ever force-resolves rows that are already stuck; it never
 * touches a row that has a real outcome.
 */
router.post("/batches/:id/reconcile", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const result = await reconcileStuckRows(req.params.id);
  res.json({ success: true, data: result });
}));

router.post("/batches", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as {
    upload_batch_no?: string; upload_type_code: string; original_file_name?: string;
    file_path?: string; file_size_bytes?: number; total_rows: number; valid_rows: number;
    error_rows: number; batch_status?: string; error_summary?: string; metadata?: Record<string, unknown>;
  };
  if (!body.upload_type_code) {
    return res.status(400).json({ error: "upload_type_code is required" });
  }
  if (body.total_rows === undefined || body.valid_rows === undefined || body.error_rows === undefined) {
    return res.status(400).json({ error: "total_rows, valid_rows, and error_rows are required" });
  }
  const id = randomUUID();
  const batchNo = body.upload_batch_no || `BATCH-${Date.now()}`;
  // withDeadlockRetry is safe here: this is one autocommit statement (no explicit
  // transaction), and it is idempotent on retry â€” a lost deadlock rolls the whole INSERT
  // back (nothing partially written), and `id` was generated once above, so a retry
  // replays the exact same row rather than creating a duplicate.
  await withDeadlockRetry(() => db.execute(
    `INSERT INTO upload_batch (id, upload_batch_no, upload_type_code, original_file_name, file_path,
     file_size_bytes, total_rows, valid_rows, error_rows, batch_status, error_summary, metadata,
     uploaded_by, validated_by, validated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, batchNo, body.upload_type_code, body.original_file_name ?? null, body.file_path ?? null,
     body.file_size_bytes ?? null, body.total_rows, body.valid_rows, body.error_rows,
     body.batch_status ?? "pending", body.error_summary ?? null,
     body.metadata ? JSON.stringify(body.metadata) : null,
     req.authUser!.id,
     body.valid_rows > 0 ? req.authUser!.id : null,
     body.valid_rows > 0 ? new Date().toISOString().slice(0, 19).replace("T", " ") : null]
  ));
  const [rows] = await db.execute<UploadBatchRow[]>("SELECT * FROM upload_batch WHERE id = ? LIMIT 1", [id]);
  res.status(201).json({ success: true, data: rows[0] ?? null });
}));

router.post("/batches/:id/rows", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body as Array<{
    row_no: number;
    raw_data?: Record<string, unknown> | unknown[] | string | null;
    normalized_data?: Record<string, unknown> | unknown[] | string | null;
    row_status?: string;
    error_messages?: string[] | string | null;
  }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "rows array required" });
  }
  // Build pre-assigned row objects with IDs fixed before any chunking, so a deadlock
  // retry on any chunk replays the identical INSERT and never double-stages a row.
  // IDs are assigned here once â€” not inside the retry lambda â€” for the same reason.
  const staged: Array<unknown[]> = rows.map((row) => [
    randomUUID(), req.params.id, row.row_no,
    row.raw_data ? JSON.stringify(row.raw_data) : null,
    row.normalized_data ? JSON.stringify(row.normalized_data) : null,
    row.row_status ?? "pending",
    row.error_messages ? JSON.stringify(row.error_messages) : null,
  ]);

  // Large Onfido/POA files send 20k+ rows in a single call. One monolithic INSERT
  // of 20k rows and their JSON blobs can exceed MySQL's lock-wait timeout and collide
  // with sibling uploads on the same table (the 2026-09-14 DOC_RAW staging failures).
  // Chunk at 2 000 rows: each INSERT stays under ~4 MB, retries are fast, and the
  // full 20k completes in ~10 chunks instead of one slow giant statement.
  //
  // withDeadlockRetry is still correct per-chunk: each chunk is one autocommit
  // statement and its IDs were generated once above, so a retry is idempotent.
  const STAGE_CHUNK = 2000;
  for (let i = 0; i < staged.length; i += STAGE_CHUNK) {
    const slice = staged.slice(i, i + STAGE_CHUNK);
    const placeholders = slice.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = slice.flat();
    await withDeadlockRetry(() => db.execute(
      `INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status, error_messages)
       VALUES ${placeholders}`,
      values
    ), { attempts: 6, delayMs: 400 });
  }
  res.status(201).json({ success: true, count: rows.length });
}));

const KNOWN_IMPORT_RPCS = new Set([
  "import_official_email_update_batch",
  "import_pf_uan_batch",
  "import_reporting_manager_update_batch",
  "import_roster_assignment_batch",
  "import_weekoff_preference_batch",
  "import_shift_rotation_type_batch",
  "import_shift_roster_batch",
  "import_upload_batch",
  "import_process_upload_batch",
  "import_department_upload_batch",
  "import_asset_upload_batch",
  "import_branch_upload_batch",
  "import_lob_upload_batch",
  "import_designation_upload_batch",
  // Approval-gated types. These stage rows into their real domain tables in a pending
  // state; nothing applies until a Branch Head approves via /approvals/batches/:id/approve.
  "import_attendance_regularization_batch",
  "import_leave_application_batch",
  "import_incentive_bulk_batch",
  "import_deduction_bulk_batch",
  // Onfido process raw-data reports (DOC/POA volume, quality-audit, client-escalation) â€”
  // all seven share one generic import service; see onfido-report-configs.ts.
  "import_onfido_doc_raw_batch",
  "import_onfido_doc_quality_batch",
  "import_onfido_cre_batch",
  "import_onfido_crq_batch",
  "import_onfido_poa_raw_batch",
  "import_onfido_poa_trial_batch",
  "import_onfido_poa_quality_batch",
  "import_onfido_external_audit_batch",
  "import_onfido_doc_etm_batch",
  "import_onfido_poa_etm_batch",
  "import_onfido_task_skip_batch",
  "import_onfido_agent_daily_batch",
  // Bella Vita daily target plan - the one dataset no system emits. Sales,
  // cart leads, cancellations/RTO, call detail and inbound SLA are all NOT
  // Process-grain manual KPI feed - fills the gap left by db_masmis sales/allocation
  // tables that stopped being uploaded; see process-manual-kpi-bulk.service.ts.
  "import_process_manual_kpi_batch",
  // Per-process delivery actuals into process_delivery_actual, which the P&L already
  // Molecular Email / Reginald Men Email daily ticket actuals â€” the underlying
  // ticketing DB (molecular_db_email) does not exist anywhere in this project's
  // infrastructure. See email-ticket-daily-bulk.service.ts.
  "import_email_ticket_daily_batch",
  // LP WebConsole APR â€” dialer_db.apr_5/apr_137_235/apr_bla_bli_blu (where this
  // would otherwise land) are confirmed empty, a dead sync job. See
  // lp-apr-daily-bulk.service.ts.
  "import_lp_apr_daily_batch",
  // Clovia Email Dashboard, daily per agent â€” columns read verbatim from a
  // real sample ("Clovia Email Tracker Sept'26.xlsb"); no DB backing exists
  // Clovia Chat Performance, daily (Botlytics chat dump) â€” columns read
  // verbatim from a real sample; no DB backing exists anywhere. See
  // Clovia CRM Disposition, per ticket â€” columns read verbatim from a real
  // sample; no DB backing exists anywhere. See
  // clovia-crm-disposition-bulk.service.ts.
  "import_clovia_crm_disposition_batch",
  "import_clovia_feedback_batch",
  // Housing Premium's "Sale Raw" -- per its SOP, a manually-updated Google
  // Sheet with no DB backing anywhere. See
  // housing-premium-sale-raw-bulk.service.ts.
  "import_housing_premium_sale_raw_batch",
  // Housing Owner's "Sale Raw" -- per its SOP, sale data pasted "up to the
  // Discount % column" into a Google Sheet with no DB backing anywhere. See
  // LP BPO Leads (M) export, Regional/Non Regional dashboards -- columns read
  // verbatim from real samples; no DB backing exists anywhere. See
  // lp-leads-bulk.service.ts.
  "import_lp_leads_regional_batch",
  "import_lp_leads_non_regional_batch",
  // DU Digital's Agents Time details export, Korea/Thailand dashboards --
  // LP's Mascallnet NRGN Call History export, Regional/Non Regional
  // dashboards -- columns read verbatim from real samples; no DB backing
  // exists anywhere. See lp-cdr-cr-report-bulk.service.ts. (The sibling
  // BPO CR Reports/CDR sheet's own table, lp_cdr_raw, was RETRACTED
  // 2026-09-10 -- db_masmis.CR_lp_regional/CR_lp_non_regional already
  // carry that exact data live.)
  "import_lp_cr_report_regional_batch",
  "import_lp_cr_report_non_regional_batch",
  // DU Digital's Agent ID -> MAS employee code directory, Korea/Thailand
  // Housing Premium's per-agent monthly sales Target & Achievement --
  // found while auditing the same workbook used for Sale Raw; no DB
  // backing exists anywhere. See housing-premium-agent-target-bulk.service.ts.
  "import_housing_premium_agent_target_batch",
  // Housing Owner's per-agent monthly Incentive payout -- found while
  // auditing the same workbook used for Sale Raw/Call Logs; source is
  // partially corrupted (broken-formula cells), only clean cells are
  // imported. See housing-owner-incentive-bulk.service.ts.
  "import_housing_owner_incentive_batch",
  // Housing Owner's CRM lead/opportunity pipeline log (Look up Data) --
  // found while auditing the same workbook; the largest single sheet
  // found this session (398,363 rows). See
  // housing-owner-lead-pipeline-bulk.service.ts.
  "import_housing_owner_lead_pipeline_batch",
  // GNC's Agent Productivity Report -- writes into the SAME live
  // db_masmis.gnc_apr table Mydashboards already uses (confirmed real but
  // stale, last row 2026-05-30), per explicit user instruction. Reconciled
  // 2026-09-10 from an earlier new-table approach; see sql/1741 and
  // gnc-apr-masmis-bulk.service.ts.
  "import_gnc_apr_batch",
  // Bla Bli Blu's real Dial Desk complaint/query ticket export -- an HTML
  // export off the DialDesk website, no DB backing anywhere. See
  // bla-bli-blu-dd-tagging-bulk.service.ts.
  "import_bla_bli_blu_dd_tagging_batch",
  // GNC's "Date & Camp wise Overall Sale" sheet -- per explicit user
  // instruction, writes into the SAME already-live db_masmis.gnc_sale
  // table the separate My Dashboards tool (github.com/tausifansari-mcn/
  // Mydashboards) already uses, rather than a new mas_hrms table. See
  // gnc-sale-masmis-bulk.service.ts.
  "import_gnc_sale_masmis_batch",
  // Bla Bli Blu's real Auto Call Back / after-hours contact logs -- HTML
  // exports off the same DialDesk/Smartping websites as sql/1739's DD
  // Tagging file, found in the same local folder. See
  // bla-bli-blu-auto-callback-bulk.service.ts / bla-bli-blu-after-hour-
  // bulk.service.ts.
  // Reginald Men Abandoned Cart Dashboard's real Live Sales Google Form
  // export -- see sql/1752 / reginald-abandoned-cart-sales-bulk.service.ts.
  "import_reginald_abandoned_cart_sales_batch",
  "import_bla_bli_blu_auto_callback_batch",
  "import_bla_bli_blu_after_hour_batch",
  // Bla Bli Blu's real Smartping CDR export -- disposition/outcome fields
  // only (call metadata is already live in dialer_db.cdr_bla_bli_blu,
  // joined by Session Id = call_uuid). See
  // bla-bli-blu-call-disposition-bulk.service.ts.
  "import_bla_bli_blu_call_disposition_batch",
  // Bla Bli Blu's real direct Shopify order export, distinct from the
  // workbook's own curated Overall Sales Raw sheet (sql/1729). See
  // bla-bli-blu-shopify-sales-bulk.service.ts.
  "import_bla_bli_blu_shopify_sales_batch",
  // Bellavita's real "Sale" sheet -- writes into the SAME already-live
  // db_masmis.bb_sale table Mydashboards already uses. See
  // bb-sale-masmis-bulk.service.ts.
  "import_bb_sale_masmis_batch",
  "import_bb_apr_masmis_batch",
  "import_bb_cart_masmis_batch",
  "import_bb_chat_masmis_batch",
  // Bla Bli Blu Overall Sales (curated workbook sheet, distinct from the Shopify direct export)
  "import_bla_bli_blu_overall_sales_batch",
  "import_clovia_team_alignment_batch",
  // Dalmia uploads â€” after-hour contacts, DialDesk DD raw, outbound CDR
  "import_dalmia_after_hour_batch",
  "import_dalmia_dd_batch",
  "import_dalmia_outbound_batch",
  // Domestic Billing Approved Headcount â€” month/process/LOB-grain planning table.
  "import_domestic_billing_approved_hc_batch",
  // GS1 India â€” email GTIN processing daily actuals, DataKart task daily
  // actuals, and Approval/Audit quality review raw log. All three write into
  // dedicated mas_hrms tables; the GS1 process_id is resolved by name at
  // import time. See gs1-email-daily-bulk.service.ts,
  // gs1-datakart-daily-bulk.service.ts, gs1-approval-audit-bulk.service.ts.
  "import_gs1_email_daily_batch",
  "import_gs1_datakart_daily_batch",
  "import_gs1_approval_audit_batch",
  // Housing Owner, Pre, Clovia raw-format, Birlanu, Satya, LP Feedback/Onboarding and GNC Chat --
  // all into db_masmis, all already implemented, but missing from this set left them 501ing on
  // Process Performance V2 even though bulk-dispatch.ts now has a case for every one of them.
  "import_owner_sale_batch",
  "import_owner_cdr_batch",
  "import_owner_agent_details_batch",
  "import_pre_sale_batch",
  "import_pre_cdr_batch",
  "import_pre_agent_details_batch",
  "import_cl_apr_batch",
  "import_cl_chat_batch",
  "import_cl_dispo_batch",
  "import_cl_email_raw_batch",
  "import_cl_feedback_batch",
  "import_cl_ib_cdr_batch",
  "import_cl_outbound_batch",
  "import_cl_quality_batch",
  "import_cl_rechurn_call_batch",
  "import_birlanu_sale_batch",
  "import_birlanu_apr_batch",
  "import_satya_allocation_batch",
  "import_satya_cdr_batch",
  "import_lp_feedback_apr_batch",
  "import_lp_feedback_cdr_batch",
  "import_lp_onboarding_apr_batch",
  "import_lp_onboarding_cdr_batch",
  "import_gnc_chat_batch",
  "import_gnc_allocation_masmis_batch",
  "import_neemans_sale_raw_masmis_batch",
  "import_neemans_allocation_masmis_batch",
  "import_neemans_apr_masmis_batch",
  "import_aw_out_batch",
  "import_aw_billing_batch",
  "import_aw_mandate_batch",
  "import_aw_inbound_batch",
  "import_aw_new_cdr_batch",
  "import_neemans_month_target_batch",
  "import_neemans_agent_details_batch",
]);

// POST /batches/:id/import â€” dispatch import by rpc_name
router.post("/batches/:id/import", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { rpc_name } = req.body as { rpc_name?: string };

  if (!rpc_name || !KNOWN_IMPORT_RPCS.has(rpc_name)) {
    return res.status(501).json({
      success: false,
      error: `Import function '${rpc_name || "unknown"}' for batch ${id} is not yet implemented in the MySQL backend.`,
    });
  }

  // A claim left behind by a crashed or restarted API would otherwise block the batch
  // forever: the claim below refuses any batch already 'importing', and nothing ever
  // cleared it. Release one that has not been touched for STALE_IMPORT_MINUTES, the
  // same treatment the approval claim already gets in bulk-approval.service.ts.
  //
  // 'validated' is where a batch sits before an import, and re-importing it is safe:
  // the importers only pick up rows still in 'valid'/'pending', so whatever the dead
  // run managed to write is not written twice.
  await db.execute(
    `UPDATE upload_batch SET batch_status = 'validated', updated_at = NOW()
      WHERE id = ? AND batch_status = 'importing'
        AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [id, STALE_IMPORT_MINUTES]
  );

  // Atomically claim the batch before running the (possibly long-running) import.
  // Without this, a client retry after a false request-timeout â€” the import
  // itself keeps running server-side even after the client gives up â€” can fire
  // a second concurrent import of the same batch. The second call finds no
  // 'valid'/'pending' rows left (the first call already flipped them), computes
  // 0 imported / 0 errors, and overwrites the first call's correct summary with
  // a misleading "imported, 0 rows" â€” which is exactly what happened to
  // BATCH-1787062644877. Rejecting the concurrent call instead keeps the
  // summary that the completed import actually wrote.
  const [claim] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch SET batch_status = 'importing', updated_at = NOW()
     WHERE id = ? AND batch_status NOT IN ('importing')`,
    [id]
  );
  if (claim.affectedRows === 0) {
    return res.status(409).json({
      success: false,
      error: "This batch is already being imported. Wait for it to finish, then refresh the page â€” do not resubmit.",
    });
  }

  // The permission checks have to run before the request is answered â€” a 202 must
  // mean the import is genuinely under way, not that it will fail unseen.
  try {
    await assertGatedUploader(rpc_name, req.authUser!.id);
    await assertDepartmentStructureUploader(rpc_name, req.authUser!.id);
  } catch (err) {
    await db.execute(
      `UPDATE upload_batch SET batch_status = 'validated', updated_at = NOW() WHERE id = ?`,
      [id]
    );
    throw err;
  }

  // Importing runs a domain engine per row â€” submitRegularization and
  // submitRequest each open a transaction â€” so a few hundred rows take minutes.
  // Waiting for that inside the request meant nginx closed the connection at 60s
  // and the uploader saw a 502 while the import was still running fine. Detach it
  // and let the page poll /batches/:id/import-status instead.
  const [pending] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')`,
    [id]
  );

  /*
   * Guard against BATCH-1788948395588-R6909's failure mode: a batch that claims valid
   * rows (from its own creation payload) but has ZERO rows actually staged in
   * upload_batch_row â€” at ANY status, not just 'valid'/'pending' â€” used to run the
   * import anyway, find nothing to do, and report a clean "imported, 0 rows" success,
   * because every importer only checks for ERRORS, never for whether it did anything
   * at all. Root cause there was the staging INSERT (POST /batches/:id/rows) losing a
   * database deadlock after the batch header already claimed "14 valid" â€” the two are
   * separate requests, so one can succeed while the other silently fails.
   *
   * This must NOT fire for the ordinary, legitimate case of re-importing a batch whose
   * rows already all got consumed by an earlier successful run â€” those rows still
   * exist, just as 'imported'/'error', which is exactly why `pending` above is 0 for
   * that case too. The only reliable way to tell "nothing left to do" apart from
   * "nothing was ever there" is whether upload_batch_row holds ANY row for this batch,
   * regardless of status â€” so that is checked separately, only in this already-rare
   * pending===0 branch.
   */
  if (Number((pending as RowDataPacket[])[0]?.n ?? 0) === 0) {
    const [batchRows] = await db.execute<RowDataPacket[]>(
      `SELECT valid_rows FROM upload_batch WHERE id = ? LIMIT 1`, [id]
    );
    const [stagedRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM upload_batch_row WHERE upload_batch_id = ?`, [id]
    );
    const validRows = Number((batchRows as RowDataPacket[])[0]?.valid_rows ?? 0);
    const stagedCount = Number((stagedRows as RowDataPacket[])[0]?.n ?? 0);
    if (validRows > 0 && stagedCount === 0) {
      const message = `This batch claims ${validRows} valid row(s), but none were ever saved to the `
        + `database â€” the upload's row-staging step likely failed or timed out partway through. `
        + `There is nothing here to import. Re-upload the file (or redo Edit & Resubmit) instead.`;
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'validation_failed', error_summary = ?, updated_at = NOW() WHERE id = ?`,
        [message.slice(0, 1000), id]
      );
      return res.status(409).json({ success: false, error: message });
    }
  }

  // Hand off to hrms-workers via the DB queue. The worker polls bulk_import_queue
  // every few seconds, claims this row, and runs dispatchImport â€” completely off
  // the API process, zero impact on live users during large imports.
  await db.execute(
    `INSERT INTO bulk_import_queue (id, batch_id, rpc_name, user_id, queued_at)
     VALUES (UUID(), ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE rpc_name = VALUES(rpc_name), user_id = VALUES(user_id), queued_at = NOW(), claimed_at = NULL`,
    [id, rpc_name, req.authUser!.id]
  );

  return res.status(202).json({
    success: true,
    processing: true,
    job: "import",
    batch_id: id,
    total_rows: Number((pending as RowDataPacket[])[0]?.n ?? 0),
    message: "Import started. Large files are processed a row at a time â€” the page will keep itself updated.",
  });
}));

/**
 * GET /batches/:id/import-status â€” where the upload page collects the import result.
 *
 * Terminal state comes from upload_batch rather than the in-process job map, so a
 * page reloaded (or an API restarted) mid-import still reports the truth.
 */
/**
 * GET /batches/active â€” batches owned by this user currently in 'importing' state.
 *
 * The UI calls this on page mount so a user who closed the page mid-import can pick
 * up the progress bar where they left off, rather than having to know the batch ID or
 * wait for the next refresh.
 *
 * Returns at most the last 5 in-flight batches for this user. The batch_status check
 * includes 'importing' (import in progress) and 'pending_approval' when
 * approval_status is NULL (import still claiming) to cover the edge case where the
 * claim was recorded but the job map was lost in a restart.
 */
router.get("/batches/active", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, upload_batch_no, upload_type_code, batch_status, approval_status,
            total_rows, valid_rows, imported_rows, error_rows, updated_at
       FROM upload_batch
      WHERE uploaded_by = ?
        AND batch_status = 'importing'
      ORDER BY updated_at DESC
      LIMIT 5`,
    [req.authUser!.id],
  );
  res.json({ success: true, data: rows });
}));

router.get("/batches/:id/import-status", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const [batchRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, batch_status, approval_status, imported_rows, error_rows, total_rows, error_summary FROM upload_batch WHERE id = ? LIMIT 1",
    [id]
  );
  const batch = (batchRows as RowDataPacket[])[0];
  if (!batch) return res.status(404).json({ success: false, error: "Upload batch not found" });

  const job = getBatchJob(id);
  const progress = await readBatchProgress(id, "import");
  const running = batch.batch_status === "importing";
  const phase =
    running ? "running"
    : job?.phase === "failed" || batch.batch_status === "failed" ? "failed"
    : job?.phase === "done" || ["imported", "pending_approval"].includes(String(batch.batch_status)) ? "done"
    : "idle";

  return res.json({
    success: true,
    phase,
    job: "import",
    batch_status: batch.batch_status,
    approval_status: batch.approval_status,
    progress,
    error: job?.phase === "failed" ? job.error : undefined,
    message: job?.phase === "failed" ? job.error : (batch.error_summary ?? null),
    result: job?.phase === "done" ? job.result : undefined,
  });
}));


// DELETE /batches/:id — remove a batch log entry (does not undo already-imported rows)
router.delete("/batches/:id", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, batch_status FROM upload_batch WHERE id = ? LIMIT 1",
    [id]
  );
  const batch = rows[0];
  if (!batch) return res.status(404).json({ success: false, error: "Upload batch not found" });
  if (batch.batch_status === "importing") {
    return res.status(409).json({ success: false, error: "Cannot delete a batch that is currently importing" });
  }
  await db.query("DELETE FROM upload_batch_row WHERE upload_batch_id = ?", [id]);
  await db.query("DELETE FROM upload_batch WHERE id = ?", [id]);
  return res.json({ success: true });
}));

export { router as bulkUploadRouter };
