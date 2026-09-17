import { existsSync, mkdirSync } from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { paymentVoucherService, PaymentVoucherError } from "./payment-voucher.service.js";

/**
 * Payment Voucher API — own prefix (/api/finance/payment-vouchers), matching imprest.routes.ts's
 * rationale: nothing here can ever be shadowed by grnRouter's ":id"-shaped routes.
 *
 * Role model (revised 2026-09-10): Finance Head both raises AND releases — VOUCHER_RAISE_ROLES
 * and VOUCHER_RELEASE_ROLES are the SAME set now, by deliberate business decision, not an
 * oversight. CEO approval (VOUCHER_CEO_ROLES) is the one blocking gate between raise and
 * release; VOUCHER_REVIEW_ROLES (Accounts Head) is a non-blocking sign-off AFTER release — see
 * payment-voucher.service.ts's reviewRelease(). The maker-checker enforcement that still applies
 * (raised_by != ceo_approved_by) lives in payment-voucher.service.ts.
 */
export const VOUCHER_RAISE_ROLES = ["finance_head", "super_admin"] as const;
export const VOUCHER_CEO_ROLES = ["ceo", "super_admin"] as const;
export const VOUCHER_RELEASE_ROLES = ["finance_head", "super_admin"] as const;
export const VOUCHER_REVIEW_ROLES = ["accounts_head", "super_admin"] as const;
export const VOUCHER_READ_ROLES = [
  ...new Set([...VOUCHER_RAISE_ROLES, ...VOUCHER_CEO_ROLES, ...VOUCHER_RELEASE_ROLES, ...VOUCHER_REVIEW_ROLES, "branch_head", "admin", "finance"]),
] as const;

export const paymentVoucherRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  return { id, role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown") };
}

const fail = (res: any, error: unknown, fallback: string) => {
  const statusCode = error instanceof PaymentVoucherError ? error.statusCode : 400;
  res.status(statusCode).json({
    success: false,
    error: error instanceof Error ? error.message : fallback,
  });
};

// Mirrors grn.routes.ts's own attachment upload exactly (same size limit, same allowed
// extensions/mimetypes) — a supporting document is a supporting document regardless of which
// finance record it hangs off.
const ATTACHMENT_UPLOAD_DIR = "uploads/payment-voucher-attachments";
if (!existsSync(ATTACHMENT_UPLOAD_DIR)) mkdirSync(ATTACHMENT_UPLOAD_DIR, { recursive: true });
const attachmentUpload = multer({
  dest: ATTACHMENT_UPLOAD_DIR,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, allowedExtensions.includes(extension) && allowedMimeTypes.includes(file.mimetype));
  },
});

paymentVoucherRouter.use(requireAuth);

paymentVoucherRouter.get(
  "/",
  requireRole(...VOUCHER_READ_ROLES),
  h(async (req, res) => {
    const data = await paymentVoucherService.list({
      status: req.query.status ? String(req.query.status) : undefined,
      sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
      bankAccountId: req.query.bankAccountId ? String(req.query.bankAccountId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
  }),
);

/** MUST be registered before the bare "/:id" route below — Express matches routes in
 *  registration order, and "/:id" is a single-segment wildcard that would otherwise swallow
 *  "/export" as if it were a voucher id (the same route-shadowing this repo has hit before —
 *  see company-bank-account.routes.ts's "/balance-change-requests" comment for the pattern). */
paymentVoucherRouter.get(
  "/export",
  requireRole(...VOUCHER_READ_ROLES),
  h(async (req, res) => {
    const csv = await paymentVoucherService.toCsv({
      status: req.query.status ? String(req.query.status) : undefined,
      sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
      bankAccountId: req.query.bankAccountId ? String(req.query.bankAccountId) : undefined,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="payment-vouchers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }),
);

paymentVoucherRouter.get(
  "/:id",
  requireRole(...VOUCHER_READ_ROLES),
  h(async (req, res) => {
    const data = await paymentVoucherService.get(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: "Payment voucher not found" });
    res.json({ success: true, data });
  }),
);

paymentVoucherRouter.post(
  "/",
  requireWriteAccess,
  requireRole(...VOUCHER_RAISE_ROLES),
  h(async (req, res) => {
    try {
      const a = actor(req);
      const data = await paymentVoucherService.raise(req.body, a.id, a.role);
      res.status(201).json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to raise the payment voucher");
    }
  }),
);

paymentVoucherRouter.post(
  "/:id/ceo-approve",
  requireWriteAccess,
  requireRole(...VOUCHER_CEO_ROLES),
  h(async (req, res) => {
    try {
      const a = actor(req);
      const data = await paymentVoucherService.ceoApprove(req.params.id, a.id, a.role, "approve", req.body?.note ?? null);
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to approve the payment voucher");
    }
  }),
);

paymentVoucherRouter.post(
  "/:id/reject",
  requireWriteAccess,
  requireRole(...VOUCHER_CEO_ROLES),
  h(async (req, res) => {
    try {
      const a = actor(req);
      const data = await paymentVoucherService.ceoApprove(req.params.id, a.id, a.role, "reject", req.body?.note ?? null);
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to reject the payment voucher");
    }
  }),
);

paymentVoucherRouter.post(
  "/:id/request-changes",
  requireWriteAccess,
  requireRole(...VOUCHER_CEO_ROLES),
  h(async (req, res) => {
    try {
      const a = actor(req);
      const data = await paymentVoucherService.ceoApprove(req.params.id, a.id, a.role, "request_changes", req.body?.note ?? null);
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to request changes on the payment voucher");
    }
  }),
);

// Withdraw/recall — the route gate admits everyone who could plausibly be authorized for
// EITHER case (raiser withdrawing their own 'raised' voucher, or finance_head/super_admin/ceo
// recalling a 'ceo_approved' one); withdraw() itself enforces exactly who, tied to the
// voucher's specific raised_by/ceo_approved_by, not just a role check.
paymentVoucherRouter.post(
  "/:id/withdraw",
  requireWriteAccess,
  requireRole(...VOUCHER_RAISE_ROLES, ...VOUCHER_CEO_ROLES),
  h(async (req, res) => {
    try {
      const a = actor(req);
      const data = await paymentVoucherService.withdraw(req.params.id, a.id, a.role, String(req.body?.reason ?? ""));
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to withdraw the payment voucher");
    }
  }),
);

// Supporting-document attachment — upload gated to whoever could plausibly be acting on a
// not-yet-released voucher (same set as withdraw); saveAttachment() itself refuses once
// released. Download uses VOUCHER_READ_ROLES, same as viewing the voucher itself.
paymentVoucherRouter.post(
  "/:id/attachment",
  requireWriteAccess,
  requireRole(...VOUCHER_RAISE_ROLES, ...VOUCHER_CEO_ROLES),
  attachmentUpload.single("file"),
  h(async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: "A PDF or supported image file is required" });
        return;
      }
      const a = actor(req);
      const data = await paymentVoucherService.saveAttachment(req.params.id, req.file.path, req.file.originalname, a.id, req.file.mimetype);
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Attachment upload failed");
    }
  }),
);

paymentVoucherRouter.get(
  "/:id/attachment",
  requireRole(...VOUCHER_READ_ROLES),
  h(async (req, res) => {
    const voucher = await paymentVoucherService.get(req.params.id);
    const filePath = (voucher as any)?.attachment_path;
    const fileName = (voucher as any)?.attachment_original_name ?? "payment-voucher-attachment";
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ success: false, error: "No attachment on this voucher" });
      return;
    }
    res.download(filePath, fileName);
  }),
);


paymentVoucherRouter.post(
  "/:id/resubmit",
  requireWriteAccess,
  requireRole(...VOUCHER_RAISE_ROLES),
  h(async (req, res) => {
    try {
      const a = actor(req);
      const data = await paymentVoucherService.resubmit(req.params.id, a.id, a.role, {
        bankAccountId: req.body?.bankAccountId,
        payableAccountId: req.body?.payableAccountId,
        amount: req.body?.amount !== undefined ? Number(req.body.amount) : undefined,
        remarks: req.body?.remarks,
      });
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to resubmit the payment voucher");
    }
  }),
);

paymentVoucherRouter.post(
  "/:id/release",
  requireWriteAccess,
  requireRole(...VOUCHER_RELEASE_ROLES),
  h(async (req, res) => {
    try {
      const a = actor(req);
      const data = await paymentVoucherService.release(req.params.id, a.id, a.role, {
        paymentMode: req.body?.paymentMode,
        paymentDate: req.body?.paymentDate,
        transactionRef: req.body?.transactionRef ?? null,
      });
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to release the payment voucher");
    }
  }),
);

/** Accounts Head's post-release sign-off — non-blocking, never gates or reverses the release. */
paymentVoucherRouter.post(
  "/:id/review",
  requireWriteAccess,
  requireRole(...VOUCHER_REVIEW_ROLES),
  h(async (req, res) => {
    try {
      const a = actor(req);
      const data = await paymentVoucherService.reviewRelease(req.params.id, a.id, a.role, req.body?.note ?? null);
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to record the review");
    }
  }),
);
