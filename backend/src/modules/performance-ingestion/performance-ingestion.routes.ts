import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { performanceGovernanceService } from "./performance-governance.service.js";
import { performanceIngestionService } from "./performance-ingestion.service.js";

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
const sourceManagers = ["super_admin", "admin", "process_manager", "qa_manager"] as const;
const mappingManagers = ["super_admin", "admin", "hr", "process_manager", "qa_manager"] as const;

const asyncHandler = (
  handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>,
): RequestHandler => (req, res, next: NextFunction) =>
  Promise.resolve(handler(req as AuthenticatedRequest, res)).catch(next);

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
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["valueField"],
      message: "valueField or numeratorField is required",
    });
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
  if (value.from > value.to) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["from"],
      message: "from must be on or before to",
    });
  }
});

const approveSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const datasetStatusSchema = z.object({ activeStatus: z.boolean() });

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
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["effectiveTo"],
      message: "effectiveTo must be on or after effectiveFrom",
    });
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
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["effectiveTo"],
      message: "effectiveTo must be on or after effectiveFrom",
    });
  }
});

const exceptionResolutionSchema = z.object({
  action: z.enum(["map_employee", "map_process", "resolve", "ignore"]),
  notes: z.string().trim().max(2000).nullable().optional(),
  employeeId: z.string().trim().max(100).nullable().optional(),
  processId: z.string().trim().max(100).nullable().optional(),
  branchId: z.string().trim().max(100).nullable().optional(),
  identifierType: z.string().trim().max(50).nullable().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).superRefine((value, context) => {
  if (value.action === "map_employee" && !value.employeeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["employeeId"],
      message: "employeeId is required for employee mapping",
    });
  }
  if (value.action === "map_process" && !value.processId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["processId"],
      message: "processId is required for process mapping",
    });
  }
  if (value.effectiveTo && value.effectiveFrom && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["effectiveTo"],
      message: "effectiveTo must be on or after effectiveFrom",
    });
  }
});

function validationError(res: Response, error: z.ZodError) {
  return res.status(400).json({
    success: false,
    error: "Validation failed",
    details: error.flatten(),
  });
}

router.use(requireAuth);

router.get(
  "/reference-data",
  requireRole(...sourceReaders),
  asyncHandler(async (req, res) => {
    const data = await performanceGovernanceService.referenceData(
      req.authUser!.id,
      String(req.query.search ?? ""),
    );
    return res.json({ success: true, data });
  }),
);

router.get(
  "/datasets",
  requireRole(...sourceReaders),
  asyncHandler(async (req, res) => {
    const data = await performanceGovernanceService.listDatasets(req.authUser!.id);
    return res.json({ success: true, data });
  }),
);

router.get(
  "/datasets/:id",
  requireRole(...sourceReaders),
  asyncHandler(async (req, res) => {
    const data = await performanceGovernanceService.getDataset(req.authUser!.id, req.params.id);
    return res.json({ success: true, data });
  }),
);

router.post(
  "/datasets",
  requireWriteAccess,
  requireRole(...sourceManagers),
  asyncHandler(async (req, res) => {
    const parsed = datasetSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const id = await performanceGovernanceService.saveDataset(req.authUser!.id, parsed.data);
    return res.status(parsed.data.id ? 200 : 201).json({ success: true, data: { id } });
  }),
);

router.patch(
  "/datasets/:id/status",
  requireWriteAccess,
  requireRole(...sourceManagers),
  asyncHandler(async (req, res) => {
    const parsed = datasetStatusSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    await performanceGovernanceService.setDatasetActive(
      req.authUser!.id,
      req.params.id,
      parsed.data.activeStatus,
    );
    return res.json({ success: true });
  }),
);

router.post(
  "/datasets/:id/approve",
  requireWriteAccess,
  requireRole("super_admin", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const data = await performanceGovernanceService.approveDataset(
      req.authUser!.id,
      req.params.id,
      parsed.data.effectiveFrom,
    );
    return res.json({ success: true, data });
  }),
);

function runRoute(mode: "preview" | "publish"): RequestHandler[] {
  return [
    requireWriteAccess,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const parsed = runSchema.safeParse(req.body);
      if (!parsed.success) return validationError(res, parsed.error);
      await performanceGovernanceService.assertDatasetAccess(req.authUser!.id, req.params.id);
      const result = await performanceIngestionService.run({
        datasetId: req.params.id,
        mode,
        from: parsed.data.from,
        to: parsed.data.to,
        requestedBy: req.authUser!.id,
        uploadBuffer: req.file?.buffer ?? null,
        sourceFileName: req.file?.originalname ?? null,
      });
      return res.json({ success: true, data: result });
    }),
  ];
}

router.post(
  "/datasets/:id/preview",
  requireRole(...sourceReaders),
  ...runRoute("preview"),
);

router.post(
  "/datasets/:id/publish",
  requireRole(...sourceManagers),
  ...runRoute("publish"),
);

router.get(
  "/datasets/:id/runs",
  requireRole(...sourceReaders),
  asyncHandler(async (req, res) => {
    const data = await performanceGovernanceService.listRuns(
      req.authUser!.id,
      req.params.id,
      Number(req.query.page ?? 1),
      Number(req.query.pageSize ?? 25),
    );
    return res.json({ success: true, data });
  }),
);

router.get(
  "/runs/:runId",
  requireRole(...sourceReaders),
  asyncHandler(async (req, res) => {
    const data = await performanceGovernanceService.runDetail(req.authUser!.id, req.params.runId);
    return res.json({ success: true, data });
  }),
);

router.post(
  "/identity-maps",
  requireWriteAccess,
  requireRole(...mappingManagers),
  asyncHandler(async (req, res) => {
    const parsed = identityMapSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    await performanceGovernanceService.saveIdentityMap(req.authUser!.id, parsed.data);
    return res.status(201).json({ success: true });
  }),
);

router.post(
  "/process-maps",
  requireWriteAccess,
  requireRole(...mappingManagers),
  asyncHandler(async (req, res) => {
    const parsed = processMapSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    await performanceGovernanceService.saveProcessMap(req.authUser!.id, parsed.data);
    return res.status(201).json({ success: true });
  }),
);

router.get(
  "/mapping-exceptions",
  requireRole(...sourceReaders),
  asyncHandler(async (req, res) => {
    const status = String(req.query.status ?? "open").trim().toLowerCase();
    if (!["open", "resolved", "ignored"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid exception status" });
    }
    const data = await performanceGovernanceService.listMappingExceptions(req.authUser!.id, {
      status,
      datasetId: req.query.datasetId ? String(req.query.datasetId) : null,
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 25),
    });
    return res.json({ success: true, data });
  }),
);

router.post(
  "/mapping-exceptions/:id/resolve",
  requireWriteAccess,
  requireRole(...mappingManagers),
  asyncHandler(async (req, res) => {
    const parsed = exceptionResolutionSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    await performanceGovernanceService.resolveMappingException(
      req.authUser!.id,
      req.params.id,
      parsed.data,
    );
    return res.json({ success: true });
  }),
);

export { router as performanceIngestionRouter };
