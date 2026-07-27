import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { performanceIngestionService } from "./performance-ingestion.service.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

const asyncHandler = (handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next: NextFunction) => Promise.resolve(handler(req as AuthenticatedRequest, res)).catch(next);

const metricBindingSchema = z.object({
  metricCode: z.string().trim().min(1).max(100),
  valueField: z.string().trim().max(255).optional(),
  numeratorField: z.string().trim().max(255).optional(),
  denominatorField: z.string().trim().max(255).optional(),
  aggregation: z.enum(["sum", "average", "ratio", "latest"]).optional(),
  ratioMultiplier: z.coerce.number().finite().optional(),
  sourceRecordCountField: z.string().trim().max(255).optional(),
}).superRefine((value, context) => {
  if (!value.valueField && !value.numeratorField) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["valueField"], message: "valueField or numeratorField is required" });
  }
  if (value.aggregation === "ratio" && (!value.numeratorField || !value.denominatorField)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["denominatorField"],
      message: "Ratio metrics require numeratorField and denominatorField",
    });
  }
});

const datasetSchema = z.object({
  id: z.string().trim().max(100).optional(),
  datasetKey: z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  datasetName: z.string().trim().min(2).max(255),
  sourceType: z.enum(["mysql", "mssql", "excel", "csv", "google_sheet"]),
  connectorKey: z.string().trim().max(100).nullable().optional(),
  sourceEntity: z.string().trim().max(255).nullable().optional(),
  processId: z.string().trim().max(100).nullable().optional(),
  branchId: z.string().trim().max(100).nullable().optional(),
  timezoneName: z.string().trim().max(64).optional(),
  config: z.record(z.unknown()),
  mapping: z.object({
    employeeIdentifierField: z.string().trim().min(1).max(255),
    employeeIdentifierType: z.string().trim().max(50).optional(),
    eventDateField: z.string().trim().min(1).max(255),
    sourceRecordKeyField: z.string().trim().max(255).optional(),
    externalProcessField: z.string().trim().max(255).optional(),
    branchField: z.string().trim().max(255).optional(),
    metrics: z.array(metricBindingSchema).min(1).max(100),
  }),
  activeStatus: z.boolean().optional(),
}).superRefine((value, context) => {
  if ((value.sourceType === "mysql" || value.sourceType === "mssql") && !value.connectorKey) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["connectorKey"],
      message: "Database sources require an encrypted connector key",
    });
  }
  if (value.sourceType === "mysql" && !String(value.config.queryMysql ?? "").trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["config", "queryMysql"],
      message: "MySQL sources require queryMysql",
    });
  }
  if (value.sourceType === "mssql" && !String(value.config.queryMssql ?? "").trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["config", "queryMssql"],
      message: "SQL Server sources require queryMssql",
    });
  }
  if (value.sourceType === "google_sheet" && !String(value.config.csvUrl ?? "").trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["config", "csvUrl"],
      message: "Google Sheet sources require a CSV export URL",
    });
  }
});

const runSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).superRefine((value, context) => {
  if (value.from > value.to) context.addIssue({ code: z.ZodIssueCode.custom, path: ["from"], message: "from must be on or before to" });
});

const approveSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const identityMapSchema = z.object({
  sourceKey: z.string().trim().min(1).max(100),
  externalIdentifier: z.string().trim().min(1).max(255),
  identifierType: z.string().trim().min(1).max(50).default("client_login"),
  employeeId: z.string().trim().min(1).max(100),
  processId: z.string().trim().max(100).nullable().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).superRefine((value, context) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveTo"], message: "effectiveTo must be on or after effectiveFrom" });
  }
});

const processMapSchema = z.object({
  sourceKey: z.string().trim().min(1).max(100),
  externalProcess: z.string().trim().min(1).max(255),
  processId: z.string().trim().min(1).max(100),
  branchId: z.string().trim().max(100).nullable().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).superRefine((value, context) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveTo"], message: "effectiveTo must be on or after effectiveFrom" });
  }
});

router.use(requireAuth);

router.get(
  "/datasets",
  requireRole("super_admin", "admin", "hr", "process_manager", "qa_manager", "quality_lead"),
  asyncHandler(async (_req, res) => res.json({ success: true, data: await performanceIngestionService.listDatasets() })),
);

router.get(
  "/datasets/:id",
  requireRole("super_admin", "admin", "hr", "process_manager", "qa_manager", "quality_lead"),
  asyncHandler(async (req, res) => res.json({ success: true, data: await performanceIngestionService.getDataset(req.params.id) })),
);

router.post(
  "/datasets",
  requireWriteAccess,
  requireRole("super_admin", "admin", "process_manager", "qa_manager"),
  asyncHandler(async (req, res) => {
    const parsed = datasetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    const id = await performanceIngestionService.saveDataset({ ...parsed.data, userId: req.authUser?.id ?? null });
    return res.status(201).json({ success: true, data: { id } });
  }),
);

router.post(
  "/datasets/:id/approve",
  requireWriteAccess,
  requireRole("super_admin", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    await performanceIngestionService.approveDataset(req.params.id, req.authUser!.id, parsed.data.effectiveFrom);
    return res.json({ success: true });
  }),
);

function runRoute(mode: "preview" | "publish"): RequestHandler[] {
  return [
    requireWriteAccess,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const parsed = runSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, error: "Validation failed", details: parsed.error.flatten() });
      const result = await performanceIngestionService.run({
        datasetId: req.params.id,
        mode,
        from: parsed.data.from,
        to: parsed.data.to,
        requestedBy: req.authUser?.id ?? null,
        uploadBuffer: req.file?.buffer ?? null,
        sourceFileName: req.file?.originalname ?? null,
      });
      return res.json({ success: true, data: result });
    }),
  ];
}

router.post(
  "/datasets/:id/preview",
  requireRole("super_admin", "admin", "hr", "process_manager", "qa_manager", "quality_lead"),
  ...runRoute("preview"),
);

router.post(
  "/datasets/:id/publish",
  requireRole("super_admin", "admin", "process_manager", "qa_manager"),
  ...runRoute("publish"),
);

router.get(
  "/runs/:runId",
  requireRole("super_admin", "admin", "hr", "process_manager", "qa_manager", "quality_lead"),
  asyncHandler(async (req, res) => res.json({ success: true, data: await performanceIngestionService.runDetail(req.params.runId) })),
);

router.post(
  "/identity-maps",
  requireWriteAccess,
  requireRole("super_admin", "admin", "hr", "process_manager", "qa_manager"),
  asyncHandler(async (req, res) => {
    const parsed = identityMapSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    await db.execute(
      `INSERT INTO performance_identity_map
         (id, source_key, external_identifier, identifier_type, employee_id, process_id,
          mapping_method, mapping_status, effective_from, effective_to, verified_by, verified_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, 'manual', 'verified', ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id), process_id = VALUES(process_id),
         identifier_type = VALUES(identifier_type), effective_to = VALUES(effective_to),
         mapping_status = 'verified', verified_by = VALUES(verified_by), verified_at = NOW(), updated_at = NOW()`,
      [parsed.data.sourceKey, parsed.data.externalIdentifier, parsed.data.identifierType, parsed.data.employeeId,
        parsed.data.processId ?? null, parsed.data.effectiveFrom, parsed.data.effectiveTo ?? null, req.authUser!.id],
    );
    return res.status(201).json({ success: true });
  }),
);

router.post(
  "/process-maps",
  requireWriteAccess,
  requireRole("super_admin", "admin", "hr", "process_manager", "qa_manager"),
  asyncHandler(async (req, res) => {
    const parsed = processMapSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    await db.execute(
      `INSERT INTO performance_process_map
         (id, source_key, external_process, process_id, branch_id, effective_from, effective_to,
          mapping_status, verified_by, verified_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'verified', ?, NOW())
       ON DUPLICATE KEY UPDATE process_id = VALUES(process_id), branch_id = VALUES(branch_id),
         effective_to = VALUES(effective_to), mapping_status = 'verified',
         verified_by = VALUES(verified_by), verified_at = NOW(), updated_at = NOW()`,
      [parsed.data.sourceKey, parsed.data.externalProcess, parsed.data.processId, parsed.data.branchId ?? null,
        parsed.data.effectiveFrom, parsed.data.effectiveTo ?? null, req.authUser!.id],
    );
    return res.status(201).json({ success: true });
  }),
);

router.get(
  "/mapping-exceptions",
  requireRole("super_admin", "admin", "hr", "process_manager", "qa_manager", "quality_lead"),
  asyncHandler(async (req, res) => {
    const status = String(req.query.status ?? "open");
    const [rows] = await db.execute(
      `SELECT * FROM integration_mapping_exception
        WHERE status = ?
        ORDER BY created_at DESC
        LIMIT 500`,
      [status],
    );
    return res.json({ success: true, data: rows });
  }),
);

export { router as performanceIngestionRouter };
