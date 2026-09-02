import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { startBatchJob, getBatchJob, readBatchProgress } from "./batch-job.js";

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
    // Table may not exist yet — return empty array gracefully
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

router.get("/batches", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM upload_batch ORDER BY created_at DESC LIMIT 50"
  );
  res.json({ success: true, data: rows });
}));

router.get("/batches/:id/rows", requireRole("admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? ORDER BY row_no ASC",
    [req.params.id]
  );
  res.json({ success: true, data: rows });
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
  await db.execute(
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
  );
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
  // A single multi-row INSERT instead of one round trip per row — with a few
  // hundred rows the old per-row loop alone could take longer than the
  // frontend's 30s request timeout, which is what produced the "batch didn't
  // upload" report even though staging had actually succeeded.
  const values: unknown[] = [];
  const placeholders: string[] = [];
  for (const row of rows) {
    placeholders.push("(?, ?, ?, ?, ?, ?, ?)");
    values.push(
      randomUUID(), req.params.id, row.row_no,
      row.raw_data ? JSON.stringify(row.raw_data) : null,
      row.normalized_data ? JSON.stringify(row.normalized_data) : null,
      row.row_status ?? "pending",
      row.error_messages ? JSON.stringify(row.error_messages) : null
    );
  }
  await db.execute(
    `INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status, error_messages)
     VALUES ${placeholders.join(", ")}`,
    values
  );
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
]);

// POST /batches/:id/import — dispatch import by rpc_name
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
  // Without this, a client retry after a false request-timeout — the import
  // itself keeps running server-side even after the client gives up — can fire
  // a second concurrent import of the same batch. The second call finds no
  // 'valid'/'pending' rows left (the first call already flipped them), computes
  // 0 imported / 0 errors, and overwrites the first call's correct summary with
  // a misleading "imported, 0 rows" — which is exactly what happened to
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
      error: "This batch is already being imported. Wait for it to finish, then refresh the page — do not resubmit.",
    });
  }

  // The permission checks have to run before the request is answered — a 202 must
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

  // Importing runs a domain engine per row — submitRegularization and
  // submitRequest each open a transaction — so a few hundred rows take minutes.
  // Waiting for that inside the request meant nginx closed the connection at 60s
  // and the uploader saw a 502 while the import was still running fine. Detach it
  // and let the page poll /batches/:id/import-status instead.
  const [pending] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')`,
    [id]
  );

  startBatchJob(
    id,
    "import",
    () => dispatchImport(rpc_name, id, req.authUser!.id),
    async (err) => {
      await db.execute(
        `UPDATE upload_batch SET batch_status = 'failed', error_summary = ?, updated_at = NOW() WHERE id = ?`,
        [String((err as Error)?.message ?? "Import failed").slice(0, 1000), id]
      );
    },
  );

  return res.status(202).json({
    success: true,
    processing: true,
    job: "import",
    batch_id: id,
    total_rows: Number((pending as RowDataPacket[])[0]?.n ?? 0),
    message: "Import started. Large files are processed a row at a time — the page will keep itself updated.",
  });
}));

/**
 * GET /batches/:id/import-status — where the upload page collects the import result.
 *
 * Terminal state comes from upload_batch rather than the in-process job map, so a
 * page reloaded (or an API restarted) mid-import still reports the truth.
 */
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

/**
 * The four approval-gated types write leave balances, attendance and payroll
 * deductions. The generic import guard above admits hr/payroll/admin as well, which is
 * right for a master-data import and wrong here: the agreed uploaders are Super Admin
 * and branch WFM only, and widening that silently would put a deduction upload in
 * reach of roles that were never meant to raise one.
 */
async function assertGatedUploader(rpc_name: string, userId: string): Promise<void> {
  const gated = new Set([
    "import_attendance_regularization_batch",
    "import_leave_application_batch",
    "import_incentive_bulk_batch",
    "import_deduction_bulk_batch",
  ]);
  if (!gated.has(rpc_name)) return;
  const { hasAnyRole } = await import("../../shared/scopeAccess.js");
  const { UPLOADER_ROLES } = await import("./bulk-approval.service.js");
  if (!(await hasAnyRole(userId, ...UPLOADER_ROLES))) {
    throw Object.assign(
      new Error("Only a Super Admin or branch WFM can upload leave, regularization, incentive or deduction batches."),
      { statusCode: 403 },
    );
  }
}

/**
 * department_master writes are super_admin-only everywhere else (requireDepartmentWrite in
 * org.routes.ts), and a spreadsheet is not an exemption.
 *
 * import_department_upload_batch INSERTs ... ON DUPLICATE KEY UPDATE dept_name = VALUES(dept_name),
 * so a row carrying an existing dept_code does not just add a department — it RENAMES one. The
 * generic import guard above admits admin/hr/wfm/wfm_analyst/payroll/payroll_hr, which would have
 * left every role locked out of the Departments UI still able to rename a department by uploading
 * a file. That is the same structure change by another door, so it takes the same gate.
 *
 * Deliberately stricter than assertGatedUploader: that one admits branch WFM alongside Super
 * Admin, which is right for leave and deduction batches and wrong for the org chart.
 */
async function assertDepartmentStructureUploader(rpc_name: string, userId: string): Promise<void> {
  if (rpc_name !== "import_department_upload_batch") return;
  const { hasAnyRole } = await import("../../shared/scopeAccess.js");
  if (!(await hasAnyRole(userId, "super_admin"))) {
    throw Object.assign(
      new Error("Only a Super Admin can create or rename departments, including by upload."),
      { statusCode: 403 },
    );
  }
}

/**
 * Run one import and return the payload the route used to send.
 *
 * It no longer writes the response itself: the import runs after the request has
 * already been answered with 202 (see the route below), so there is no response left
 * to write to by the time this finishes.
 */
async function dispatchImport(
  rpc_name: string,
  id: string,
  userId: string,
): Promise<Record<string, unknown>> {
  await assertGatedUploader(rpc_name, userId);
  await assertDepartmentStructureUploader(rpc_name, userId);

  if (rpc_name === "import_attendance_regularization_batch") {
    const { importRegularizationBatch } = await import(
      "./attendance-regularization-bulk.service.js"
    );
    const data = await importRegularizationBatch(id, userId);
    return { success: true, requires_approval: true, data };
  }

  if (rpc_name === "import_leave_application_batch") {
    const { importLeaveBatch } = await import("./leave-application-bulk.service.js");
    const data = await importLeaveBatch(id, userId);
    return { success: true, requires_approval: true, data };
  }

  if (rpc_name === "import_incentive_bulk_batch") {
    const { importIncentiveBatch } = await import("./incentive-bulk.service.js");
    const data = await importIncentiveBatch(id, userId);
    return { success: true, requires_approval: true, data };
  }

  if (rpc_name === "import_deduction_bulk_batch") {
    const { importDeductionBatch } = await import("./deduction-bulk.service.js");
    const data = await importDeductionBatch(id, userId);
    return { success: true, requires_approval: true, data };
  }

  if (rpc_name === "import_official_email_update_batch") {
    const { importOfficialEmailBatch } = await import(
      "../it-provisioning/it-provisioning.bulk.service.js"
    );
    const data = await importOfficialEmailBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_pf_uan_batch") {
    const { importPfUanBatch } = await import(
      "../bulk-upload/pf-uan-bulk.service.js"
    );
    const data = await importPfUanBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_reporting_manager_update_batch") {
    const { importReportingManagerBatch } = await import(
      "../bulk-upload/reporting-manager-bulk.service.js"
    );
    const data = await importReportingManagerBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_roster_assignment_batch") {
    const { importRosterAssignmentBatch } = await import(
      "../bulk-upload/roster-assignment-bulk.service.js"
    );
    const data = await importRosterAssignmentBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_weekoff_preference_batch") {
    const { importWeekOffPreferenceBatch } = await import(
      "../bulk-upload/weekoff-preference-bulk.service.js"
    );
    const data = await importWeekOffPreferenceBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_shift_rotation_type_batch") {
    const { importShiftRotationTypeBatch } = await import(
      "../bulk-upload/shift-rotation-type-bulk.service.js"
    );
    const data = await importShiftRotationTypeBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_shift_roster_batch") {
    const { importShiftRosterBatch } = await import(
      "../bulk-upload/shift-roster-bulk.service.js"
    );
    const data = await importShiftRosterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_upload_batch") {
    const { importEmployeeMasterBatch } = await import(
      "../bulk-upload/employee-master-bulk.service.js"
    );
    const data = await importEmployeeMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_process_upload_batch") {
    const { importProcessMasterBatch } = await import(
      "../bulk-upload/process-master-bulk.service.js"
    );
    const data = await importProcessMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_department_upload_batch") {
    const { importDepartmentMasterBatch } = await import(
      "../bulk-upload/department-master-bulk.service.js"
    );
    const data = await importDepartmentMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_asset_upload_batch") {
    const { importAssetMasterBatch } = await import(
      "../bulk-upload/asset-master-bulk.service.js"
    );
    const data = await importAssetMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_branch_upload_batch") {
    const { importBranchMasterBatch } = await import(
      "../bulk-upload/branch-master-bulk.service.js"
    );
    const data = await importBranchMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_lob_upload_batch") {
    const { importLobMasterBatch } = await import(
      "../bulk-upload/lob-master-bulk.service.js"
    );
    const data = await importLobMasterBatch(id, userId);
    return { success: true, data };
  }

  if (rpc_name === "import_designation_upload_batch") {
    const { importDesignationMasterBatch } = await import(
      "../bulk-upload/designation-master-bulk.service.js"
    );
    const data = await importDesignationMasterBatch(id, userId);
    return { success: true, data };
  }

  // Unreachable in practice — rpc_name is checked against KNOWN_IMPORT_RPCS
  // before this function is ever called — kept as a safety net so the caller's
  // try/catch still resets batch_status off 'importing' if it is ever hit.
  throw new Error(`Import function '${rpc_name}' for batch ${id} is not yet implemented in the MySQL backend.`);
}

export { router as bulkUploadRouter };
