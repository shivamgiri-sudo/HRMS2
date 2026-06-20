import { Router } from "express";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

router.get("/templates", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM upload_template_master WHERE active_status = 1 ORDER BY upload_type_code ASC"
    );
    res.json({ success: true, data: rows });
  } catch (err: any) {
    // Table may not exist yet — return empty array gracefully
    if (err.code === "ER_NO_SUCH_TABLE" || String(err.message).includes("doesn't exist")) {
      return res.json({ success: true, data: [] });
    }
    throw err;
  }
}));

router.get("/batches", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM upload_batch ORDER BY created_at DESC LIMIT 50"
  );
  res.json({ success: true, data: rows });
}));

router.get("/batches/:id/rows", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? ORDER BY row_no ASC",
    [req.params.id]
  );
  res.json({ success: true, data: rows });
}));

router.post("/batches", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as {
    upload_batch_no?: string; upload_type_code: string; original_file_name?: string;
    file_path?: string; file_size_bytes?: number; total_rows: number; valid_rows: number;
    error_rows: number; batch_status?: string; error_summary?: string; metadata?: any;
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
     body.valid_rows > 0 ? new Date().toISOString() : null]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM upload_batch WHERE id = ? LIMIT 1", [id]);
  res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

router.post("/batches/:id/rows", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body as Array<{
    row_no: number; raw_data?: any; normalized_data?: any; row_status?: string; error_messages?: any;
  }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "rows array required" });
  }
  for (const row of rows) {
    await db.execute(
      `INSERT INTO upload_batch_row (id, upload_batch_id, row_no, raw_data, normalized_data, row_status, error_messages)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), req.params.id, row.row_no,
       row.raw_data ? JSON.stringify(row.raw_data) : null,
       row.normalized_data ? JSON.stringify(row.normalized_data) : null,
       row.row_status ?? "pending",
       row.error_messages ? JSON.stringify(row.error_messages) : null]
    );
  }
  res.status(201).json({ success: true, count: rows.length });
}));

// POST /batches/:id/import — dispatch import by rpc_name
router.post("/batches/:id/import", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { rpc_name } = req.body as { rpc_name?: string };

  if (rpc_name === "import_official_email_update_batch") {
    const { importOfficialEmailBatch } = await import(
      "../it-provisioning/it-provisioning.bulk.service.js"
    );
    const data = await importOfficialEmailBatch(id, req.authUser!.id);
    return res.json({ success: true, data });
  }

  if (rpc_name === "import_reporting_manager_update_batch") {
    const { importReportingManagerBatch } = await import(
      "../bulk-upload/reporting-manager-bulk.service.js"
    );
    const data = await importReportingManagerBatch(id, req.authUser!.id);
    return res.json({ success: true, data });
  }

  if (rpc_name === "import_roster_assignment_batch") {
    const { importRosterAssignmentBatch } = await import(
      "../bulk-upload/roster-assignment-bulk.service.js"
    );
    const data = await importRosterAssignmentBatch(id, req.authUser!.id);
    return res.json({ success: true, data });
  }

  if (rpc_name === "import_weekoff_preference_batch") {
    const { importWeekOffPreferenceBatch } = await import(
      "../bulk-upload/weekoff-preference-bulk.service.js"
    );
    const data = await importWeekOffPreferenceBatch(id, req.authUser!.id);
    return res.json({ success: true, data });
  }

  if (rpc_name === "import_shift_rotation_type_batch") {
    const { importShiftRotationTypeBatch } = await import(
      "../bulk-upload/shift-rotation-type-bulk.service.js"
    );
    const data = await importShiftRotationTypeBatch(id, req.authUser!.id);
    return res.json({ success: true, data });
  }

  return res.status(501).json({
    success: false,
    error: `Import function '${rpc_name || "unknown"}' for batch ${id} is not yet implemented in the MySQL backend.`,
  });
}));

export { router as bulkUploadRouter };
