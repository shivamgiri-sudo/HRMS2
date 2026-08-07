import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import multer from "multer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { performanceGovernanceService } from "./performance-governance.service.js";
import {
  buildCsv,
  buildManualUploadTemplate,
  inspectManualUploadFile,
  performanceDatasetMaxRows,
  requiredColumnsForMapping,
} from "./performance-manual-upload.service.js";
import { verifyPerformanceRun } from "./performance-manual-upload-verification.service.js";
import type {
  DatasetMapping,
  PerformanceDataset,
  PerformanceSourceType,
} from "./performance-ingestion.types.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

const sourceReaders = [
  "super_admin",
  "admin",
  "hr",
  "process_manager",
  "qa_manager",
  "quality_lead",
] as const;

function asyncHandler(
  handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>,
): RequestHandler {
  return (req, res, next: NextFunction) => {
    Promise.resolve(handler(req as AuthenticatedRequest, res)).catch(next);
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

async function loadDataset(datasetId: string): Promise<PerformanceDataset> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *
       FROM performance_source_dataset
      WHERE id = ? OR dataset_key = ?
      LIMIT 1`,
    [datasetId, datasetId],
  );
  const row = rows[0];
  if (!row) {
    throw Object.assign(new Error("Performance dataset not found"), { statusCode: 404 });
  }
  return {
    id: String(row.id),
    datasetKey: String(row.dataset_key),
    datasetName: String(row.dataset_name),
    sourceType: String(row.source_type) as PerformanceSourceType,
    connectorKey: row.connector_key ? String(row.connector_key) : null,
    sourceEntity: row.source_entity ? String(row.source_entity) : null,
    processId: row.process_id ? String(row.process_id) : null,
    branchId: row.branch_id ? String(row.branch_id) : null,
    timezoneName: String(row.timezone_name ?? "Asia/Kolkata"),
    config: parseJson(row.config_json, {}),
    mapping: parseJson<DatasetMapping>(row.mapping_json, {
      employeeIdentifierField: "employee_code",
      eventDateField: "date",
      metrics: [],
    }),
    approvalStatus: String(row.approval_status ?? "draft"),
    activeStatus: Number(row.active_status ?? 0) === 1,
  };
}

function assertManualSource(dataset: PerformanceDataset): void {
  if (dataset.sourceType !== "excel" && dataset.sourceType !== "csv") {
    throw Object.assign(
      new Error("Manual upload certification only applies to Excel and CSV datasets"),
      { statusCode: 409 },
    );
  }
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "performance";
}

router.use(requireAuth);
router.use(requireRole(...sourceReaders));

router.get(
  "/datasets/:id/manual-schema",
  asyncHandler(async (req, res) => {
    await performanceGovernanceService.assertDatasetAccess(req.authUser!.id, req.params.id);
    const dataset = await loadDataset(req.params.id);
    assertManualSource(dataset);
    return res.json({
      success: true,
      data: {
        datasetId: dataset.id,
        datasetKey: dataset.datasetKey,
        datasetName: dataset.datasetName,
        sourceType: dataset.sourceType,
        acceptedExtensions: dataset.sourceType === "csv" ? [".csv"] : [".xlsx", ".xls"],
        maximumFileBytes: 20 * 1024 * 1024,
        maxRows: performanceDatasetMaxRows(dataset),
        sheetName: String((dataset.config as { sheetName?: string }).sheetName ?? "").trim() || null,
        requiredColumns: requiredColumnsForMapping(dataset.mapping),
        mapping: dataset.mapping,
      },
    });
  }),
);

router.get(
  "/datasets/:id/manual-template.csv",
  asyncHandler(async (req, res) => {
    await performanceGovernanceService.assertDatasetAccess(req.authUser!.id, req.params.id);
    const dataset = await loadDataset(req.params.id);
    assertManualSource(dataset);
    const fileName = `${safeFilePart(dataset.datasetKey)}-manual-upload-template.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(`\uFEFF${buildManualUploadTemplate(dataset)}`);
  }),
);

router.post(
  "/datasets/:id/manual-preflight",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    await performanceGovernanceService.assertDatasetAccess(req.authUser!.id, req.params.id);
    const dataset = await loadDataset(req.params.id);
    assertManualSource(dataset);
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: "Select an Excel or CSV file" });
    }
    const inspection = inspectManualUploadFile(dataset, req.file.buffer, req.file.originalname);
    return res.json({
      success: true,
      data: {
        fileName: inspection.fileName,
        fileHash: inspection.fileHash,
        fileSize: inspection.fileSize,
        sheetName: inspection.sheetName,
        rowCount: inspection.rowCount,
        maxRows: inspection.maxRows,
        columns: inspection.columns,
        requiredColumns: inspection.requiredColumns,
        missingColumns: inspection.missingColumns,
        duplicateColumns: inspection.duplicateColumns,
        warnings: inspection.warnings,
        sample: inspection.rows.slice(0, 10),
      },
    });
  }),
);

router.get(
  "/runs/:runId/validation-errors.csv",
  asyncHandler(async (req, res) => {
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT dataset_id
         FROM performance_ingestion_run
        WHERE id = ?
        LIMIT 1`,
      [req.params.runId],
    );
    if (!runRows[0]) {
      throw Object.assign(new Error("Performance ingestion run not found"), { statusCode: 404 });
    }
    const datasetId = String(runRows[0].dataset_id);
    await performanceGovernanceService.assertDatasetAccess(req.authUser!.id, datasetId);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT vr.raw_record_id,
              pr.source_event_date,
              pr.external_employee_identifier,
              pr.external_process_identifier,
              vr.validation_code,
              vr.severity,
              vr.field_name,
              vr.invalid_value,
              vr.validation_message,
              vr.resolution_status
         FROM performance_validation_result vr
         LEFT JOIN performance_raw_record pr ON pr.id = vr.raw_record_id
        WHERE vr.run_id = ?
        ORDER BY vr.raw_record_id ASC, vr.id ASC`,
      [req.params.runId],
    );

    const csv = buildCsv(
      [
        "raw_record_id",
        "source_event_date",
        "external_employee_identifier",
        "external_process_identifier",
        "validation_code",
        "severity",
        "field_name",
        "invalid_value",
        "validation_message",
        "resolution_status",
      ],
      rows.map((row) => [
        row.raw_record_id,
        row.source_event_date,
        row.external_employee_identifier,
        row.external_process_identifier,
        row.validation_code,
        row.severity,
        row.field_name,
        row.invalid_value,
        row.validation_message,
        row.resolution_status,
      ]),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="performance-run-${safeFilePart(req.params.runId)}-errors.csv"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(`\uFEFF${csv}`);
  }),
);

router.get(
  "/runs/:runId/certification",
  asyncHandler(async (req, res) => {
    const certification = await verifyPerformanceRun(req.params.runId);
    await performanceGovernanceService.assertDatasetAccess(
      req.authUser!.id,
      certification.datasetId,
    );
    return res.json({ success: true, data: certification });
  }),
);

export const performanceManualUploadRouter = router;
