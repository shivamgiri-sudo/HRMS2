import { existsSync, mkdirSync } from "fs";
import path from "path";
import { Router, type NextFunction, type Response } from "express";
import multer from "multer";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { financeExpenseMasterService } from "../process-pnl/finance-expense-master.service.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScope,
} from "./finance-access-scope.js";
import { grnService } from "./grn.service.js";

const GRN_WRITE_ROLES = [
  "accounts_head",
  "finance_head",
  "super_admin",
  "admin",
  "branch_head",
  "branch_admin",
] as const;
const GRN_READ_ROLES = [...GRN_WRITE_ROLES, "finance", "hr_admin"] as const;
const GRN_REVIEW_ROLES = ["branch_head", "finance_head", "super_admin"] as const;
const EXPENSE_MASTER_READ_ROLES = [
  "super_admin",
  "admin",
  "branch_admin",
  "branch_head",
  "finance",
  "finance_head",
  "accounts_head",
] as const;
const EXPENSE_MASTER_WRITE_ROLES = ["super_admin", "finance_head"] as const;

const UPLOAD_DIR = "uploads/grn-attachments";
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const allowedMimeTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    const extension = path.extname(file.originalname).toLowerCase();
    callback(
      null,
      allowedExtensions.includes(extension) && allowedMimeTypes.includes(file.mimetype)
    );
  },
});

type ScopedGrnRequest = AuthenticatedRequest & { financeGrn?: any };

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  return {
    id,
    role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: req.userRoles ?? [],
  };
}

function userHasRole(req: AuthenticatedRequest, role: string) {
  return [req.authUser?.role, ...(req.userRoles ?? [])]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase() === role.toLowerCase());
}

function errorStatus(error: unknown, fallback: number) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("only access")
    || message.includes("cannot access")
    || message.includes("not mapped to an active employee branch")
  ) {
    return 403;
  }
  return fallback;
}

async function authorizeGrnBranch(
  req: ScopedGrnRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const user = actor(req);
    const grn = await grnService.getGrn(req.params.id);
    await assertFinanceRecordBranch({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      recordBranchId: grn.branch_id,
    });
    req.financeGrn = grn;
    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "GRN not found";
    res.status(errorStatus(error, 404)).json({ error: message });
  }
}

export const grnRouter = Router();
grNRouterUseAuth(grnRouter);

function grNRouterUseAuth(router: Router) {
  router.use(requireAuth);
}

// Configurable Head/Sub-Head master used by branch budget, GRN and P&L.
grNExpenseMasterRoutes(grnRouter);

function grNExpenseMasterRoutes(router: Router) {
  router.get(
    "/expense-masters",
    requireRole(...EXPENSE_MASTER_READ_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const includeInactive =
          (userHasRole(req, "finance_head") || userHasRole(req, "super_admin"))
          && String(req.query.includeInactive ?? "false") === "true";
        const data = await financeExpenseMasterService.list(includeInactive);
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to load expense master",
        });
      }
    }
  );

  router.post(
    "/expense-heads",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_WRITE_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const data = await financeExpenseMasterService.saveHead(
          req.body,
          req.authUser.id
        );
        res.status(req.body?.id ? 200 : 201).json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to save expense head",
        });
      }
    }
  );

  router.post(
    "/expense-sub-heads",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_WRITE_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const data = await financeExpenseMasterService.saveSubHead(
          req.body,
          req.authUser.id
        );
        res.status(req.body?.id ? 200 : 201).json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to save expense sub-head",
        });
      }
    }
  );
}

grnRouter.get(
  "/grns",
  requireRole(...GRN_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const branchId = await resolveFinanceBranchScope({
        userId: user.id,
        primaryRole: user.role,
        userRoles: user.roles,
        requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
      });
      const result = await grnService.listGrns({
        branchId,
        processId: req.query.processId ? String(req.query.processId) : undefined,
        costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
        costClass: req.query.costClass ? String(req.query.costClass) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        financialYear: req.query.financialYear
          ? String(req.query.financialYear)
          : undefined,
        grnType: req.query.grnType ? String(req.query.grnType) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to list GRNs";
      res.status(errorStatus(error, 400)).json({ error: message });
    }
  }
);

grnRouter.get(
  "/grns/:id",
  requireRole(...GRN_READ_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    res.json({ data: req.financeGrn });
  }
);

grnRouter.post(
  "/grns",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const branchId = await resolveFinanceBranchScope({
        userId: user.id,
        primaryRole: user.role,
        userRoles: user.roles,
        requestedBranchId: req.body?.branchId,
      });
      if (!branchId) throw new Error("Branch is required");
      const result = await grnService.createDraft(
        { ...req.body, branchId },
        user.id,
        user.role
      );
      res.status(201).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create GRN";
      res.status(errorStatus(error, 400)).json({ error: message });
    }
  }
);

grnRouter.post(
  "/grns/:id/submit",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.submitForApproval(
        req.params.id,
        req.body,
        user.id,
        user.role
      );
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to submit GRN";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.post(
  "/grns/:id/review",
  requireWriteAccess,
  requireRole(...GRN_REVIEW_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.reviewGrn(
        req.params.id,
        req.body,
        user.id,
        user.role
      );
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to review GRN";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.post(
  "/grns/:id/cancel",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.cancelGrn(req.params.id, user.id, user.role);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to cancel GRN";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.post(
  "/grns/:id/attachment",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  authorizeGrnBranch,
  upload.single("file"),
  async (req: ScopedGrnRequest, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "A PDF or supported image file is required" });
        return;
      }
      const user = actor(req);
      await grnService.saveAttachment(
        req.params.id,
        req.file.path,
        req.file.originalname,
        user.id,
        req.file.mimetype
      );
      res.json({ success: true, path: req.file.path });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Attachment upload failed";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.get(
  "/grns/:id/attachment",
  requireRole(...GRN_READ_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    const grn = req.financeGrn;
    const filePath = grn?.attachment_path ?? grn?.attachment_file_path;
    const fileName =
      grn?.attachment_original_name
      ?? grn?.attachment_file_name
      ?? "grn-attachment";
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ error: "GRN attachment not found" });
      return;
    }
    res.download(filePath, fileName);
  }
);
