import { randomUUID } from "crypto";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { Router, type NextFunction, type Response } from "express";
import multer from "multer";
import {
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { assertFinanceRecordBranch } from "./finance-access-scope.js";
import { resolveFinanceStageRole } from "./finance-workflow-role.js";
import { grnService } from "./grn.service.js";
import { grnSmartService } from "./grn-smart.service.js";
import { grnValidationControlService } from "./grn-validation-control.service.js";

const SMART_READ_ROLES = [
  "accounts_head",
  "finance_head",
  "super_admin",
  "admin",
  "branch_head",
  "branch_admin",
  "finance",
  "hr_admin",
] as const;
const SMART_WRITE_ROLES = [
  "accounts_head",
  "finance_head",
  "super_admin",
  "admin",
  "branch_head",
  "branch_admin",
] as const;
const SMART_REVIEW_ROLES = ["branch_head", "finance_head", "super_admin"] as const;
const SMART_OVERRIDE_ROLES = ["finance_head", "super_admin"] as const;

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "grn-documents");
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter(_req, file, callback) {
    const extensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const mimeTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    callback(
      null,
      extensions.includes(path.extname(file.originalname).toLowerCase())
        && mimeTypes.includes(file.mimetype)
    );
  },
});

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  return {
    id,
    role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: req.userRoles ?? [],
  };
}

type SmartRequest = AuthenticatedRequest & { financeGrn?: any };

async function authorizeGrn(
  req: SmartRequest,
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
      recordBranchId: String(grn.branch_id),
    });
    req.financeGrn = grn;
    next();
  } catch (error) {
    res.status(403).json({
      success: false,
      error: error instanceof Error ? error.message : "GRN access denied",
    });
  }
}

async function onlyWhenSmart(req: SmartRequest, _res: Response, next: NextFunction) {
  try {
    if (!(await grnSmartService.hasAllocations(req.params.id))) {
      next("router");
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

// P0-1: Submit must never fall through to the weaker legacy path — zero allocation rows mean
// the GRN is incomplete, not that it should bypass Smart validations.  Return ALLOCATIONS_REQUIRED
// rather than calling next("router"), so invoice / duplicate / statutory / budget / FY checks
// cannot be skipped simply by omitting cost allocations.
async function requireAllocationsForSubmit(req: SmartRequest, res: Response, next: NextFunction) {
  try {
    if (!(await grnSmartService.hasAllocations(req.params.id))) {
      res.status(400).json({
        success: false,
        code: "ALLOCATIONS_REQUIRED",
        error: "At least one approved budget allocation is required before submission. "
          + "Add cost-centre allocations via the Smart GRN workspace.",
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export const smartGrnRouter = Router();

smartGrnRouter.get(
  "/:id/workspace",
  requireRole(...SMART_READ_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const data = await grnSmartService.getWorkspace(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to load GRN workspace",
      });
    }
  }
);

smartGrnRouter.put(
  "/:id/allocations",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnSmartService.saveAllocations(
        req.params.id,
        req.body,
        user.id,
        user.role
      );
      res.json({ success: true, data });
    } catch (error) {
      // a recognition override refused for role is a 403, not a bad request
      const status = (error as { statusCode?: number })?.statusCode ?? 400;
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to save allocations",
      });
    }
  }
);

smartGrnRouter.put(
  "/:id/invoice-components",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      // 3-D: Period-end cut-off — non-finance roles are flagged (not blocked) for invoices older
      // than 30 days. They must supply a lateInvoiceReason; Finance Head sees the flag in the
      // approval queue. Hard block replaced with a soft require-reason gate.
      const grn = req.financeGrn;
      if (grn?.bill_date) {
        const billDateMs = new Date(String(grn.bill_date)).getTime();
        const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const isRestrictedRole = ["branch_admin", "branch_head"].includes(user.role)
          && !user.roles.some((r: string) => ["finance_head", "accounts_head", "super_admin"].includes(r));
        if (isRestrictedRole && billDateMs < cutoffMs) {
          const lateReason = req.body?.lateInvoiceReason?.toString().trim();
          if (!lateReason) {
            res.status(400).json({
              success: false,
              error: "LATE_INVOICE_REASON_REQUIRED: This invoice is older than 30 days. Please provide a reason in the 'lateInvoiceReason' field (e.g. 'Invoice received late from vendor').",
            });
            return;
          }
        }
      }
      // Strip accountingPeriod for callers without finance-level authorization.
      // UI gate alone is not security — enforce at the API layer.
      const canOverridePeriod = user.roles.some((r: string) =>
        ["finance_head", "accounts_head", "super_admin"].includes(r)
      );
      const body = canOverridePeriod ? req.body : { ...req.body, accountingPeriod: undefined };
      const data = await grnSmartService.saveComponentAllocations(
        req.params.id,
        body,
        user.id,
        user.role
      );
      res.json({ success: true, data });
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode ?? 400;
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to save invoice components",
      });
    }
  }
);

smartGrnRouter.post(
  "/:id/documents",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  upload.array("files", 10),
  async (req: SmartRequest, res) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!files.length) {
        res.status(400).json({ success: false, error: "At least one PDF or image is required" });
        return;
      }
      const user = actor(req);
      const type = String(req.body?.documentType ?? "invoice") as
        | "invoice" | "receipt" | "po" | "contract" | "supporting" | "other";
      const data = await grnSmartService.registerDocuments(
        req.params.id,
        files.map((file, index) => ({
          originalName: file.originalname,
          storedPath: file.path,
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
          documentType: type,
          isPrimary: String(req.body?.primaryIndex ?? "0") === String(index),
        })),
        user.id
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Document upload failed",
      });
    }
  }
);

smartGrnRouter.post(
  "/:id/documents/:documentId/analyze",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnSmartService.analyzeDocument(
        req.params.id,
        req.params.documentId,
        user.id
      );
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Document analysis failed",
      });
    }
  }
);

smartGrnRouter.post(
  "/:id/extraction/confirm",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnSmartService.confirmExtraction(
        req.params.id,
        req.body?.fields ?? {},
        user.id,
        user.role
      );
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to confirm extraction",
      });
    }
  }
);

smartGrnRouter.post(
  "/:id/revalidate",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const data = await grnValidationControlService.effectiveValidation(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "GRN validation failed",
      });
    }
  }
);

smartGrnRouter.post(
  "/:id/validations/:validationCode/override",
  requireWriteAccess,
  requireRole(...SMART_OVERRIDE_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnValidationControlService.overrideValidation(
        req.params.id,
        req.params.validationCode,
        String(req.body?.reason ?? ""),
        user.id,
        user.role
      );
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to approve validation override",
      });
    }
  }
);

smartGrnRouter.post(
  "/:id/validations/:validationCode/revoke",
  requireWriteAccess,
  requireRole(...SMART_OVERRIDE_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnValidationControlService.revokeOverride(
        req.params.id,
        req.params.validationCode,
        String(req.body?.reason ?? ""),
        user.id,
        user.role
      );
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to revoke validation override",
      });
    }
  }
);

smartGrnRouter.get(
  "/:id/documents/:documentId/file",
  requireRole(...SMART_READ_ROLES),
  authorizeGrn,
  async (req: SmartRequest, res) => {
    try {
      const workspace = await grnSmartService.getWorkspace(req.params.id);
      const document = (workspace.documents as any[]).find(
        (item) => String(item.id) === req.params.documentId
      );
      if (!document || !existsSync(String(document.stored_path))) {
        res.status(404).json({ success: false, error: "Document not found" });
        return;
      }
      res.setHeader("Content-Type", document.mime_type ?? "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${String(document.original_name).replace(/[\r\n"]/g, "_")}"`
      );
      res.sendFile(path.resolve(String(document.stored_path)));
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to read document",
      });
    }
  }
);

// P0-1: All GRN submissions go through Smart validation. Zero allocation rows are an error
// (ALLOCATIONS_REQUIRED), not a signal to fall through to the legacy path.
smartGrnRouter.post(
  "/:id/submit",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  requireAllocationsForSubmit,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnValidationControlService.submit(
        req.params.id,
        user.id,
        user.role,
        req.body?.remarks ? String(req.body.remarks) : undefined
      );
      res.json(data);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to submit smart GRN",
      });
    }
  }
);

// requireRole runs AFTER onlyWhenSmart here, unlike the sibling routes above.
//
// onlyWhenSmart calls next("router") for a GRN with no allocations, handing it to the legacy
// grnRouter mounted after this one. With the role gate in front of that decision, this router's
// narrower SMART_REVIEW_ROLES was applied to legacy GRNs too, and a role that only the legacy
// list grants was 403'd before it could ever fall through. Today that set is exactly
// {accounts_head} — see GRN_REVIEW_ROLES in grn.routes.ts — and accounts_head is separately
// unable to complete a review anyway (resolveFinanceStageRole for workflow "grn" yields only
// branch_head or finance_head), so nothing user-visible changes right now. It is still the wrong
// order: a router that intends to intercept must decide whether it is intercepting before it
// applies its own authorization. requireWriteAccess and authorizeGrn stay in front, so an
// unauthenticated or out-of-branch caller is still refused before any lookup of substance.
smartGrnRouter.post(
  "/:id/review",
  requireWriteAccess,
  authorizeGrn,
  onlyWhenSmart,
  requireRole(...SMART_REVIEW_ROLES),
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const effectiveRole = resolveFinanceStageRole({
        primaryRole: user.role,
        userRoles: user.roles,
        currentStatus: String(req.financeGrn?.status ?? ""),
        workflow: "grn",
      });
      const decision = String(req.body?.decision ?? "") as "approved" | "rejected";
      if (!("approved,rejected".split(",")).includes(decision)) {
        throw new Error("Decision must be approved or rejected");
      }
      const data = await grnValidationControlService.review(
        req.params.id,
        decision,
        req.body?.reviewNote ? String(req.body.reviewNote) : undefined,
        user.id,
        effectiveRole
      );
      if (data.paymentId) {
        await import("./vendor-payment.service.js")
          .then(({ vendorPaymentService }) =>
            vendorPaymentService.auditCreatedPayment(data.paymentId!, user.id)
          )
          .catch(() => undefined);
      }
      res.json(data);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to review smart GRN",
      });
    }
  }
);

smartGrnRouter.post(
  "/:id/cancel",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  onlyWhenSmart,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnSmartService.cancel(req.params.id, user.id, user.role);
      res.json(data);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to cancel smart GRN",
      });
    }
  }
);

smartGrnRouter.post(
  "/:id/reopen",
  requireWriteAccess,
  requireRole(...SMART_WRITE_ROLES),
  authorizeGrn,
  onlyWhenSmart,
  async (req: SmartRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnSmartService.reopen(req.params.id, user.id, user.role, user.roles);
      res.json(data);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to reopen GRN",
      });
    }
  }
);
