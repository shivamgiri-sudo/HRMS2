import { Router } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { paymentVoucherService, PaymentVoucherError } from "./payment-voucher.service.js";

/**
 * Payment Voucher API — own prefix (/api/finance/payment-vouchers), matching imprest.routes.ts's
 * rationale: nothing here can ever be shadowed by grnRouter's ":id"-shaped routes, and the
 * three role sets below are deliberately disjoint at the write level (VOUCHER_RAISE_ROLES ∩
 * VOUCHER_CEO_ROLES ∩ VOUCHER_RELEASE_ROLES = {super_admin} only) — a route guard proves a
 * role, so keeping the ROLE sets themselves narrow is the first line of defence; the real
 * maker-checker enforcement (raised_by != ceo_approved_by != released_by) lives in
 * payment-voucher.service.ts and cannot be bypassed by any role combination a normal account
 * holds, since a real person cannot simultaneously be finance_head, ceo and accounts_head.
 */
export const VOUCHER_RAISE_ROLES = ["finance_head", "super_admin"] as const;
export const VOUCHER_CEO_ROLES = ["ceo", "super_admin"] as const;
export const VOUCHER_RELEASE_ROLES = ["accounts_head", "super_admin"] as const;
export const VOUCHER_READ_ROLES = [
  ...new Set([...VOUCHER_RAISE_ROLES, ...VOUCHER_CEO_ROLES, ...VOUCHER_RELEASE_ROLES, "branch_head", "admin", "finance"]),
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
