/**
 * Off-cycle / arrears payment ledger routes. See arrears-payment.service.ts for the full
 * rationale — this is the first real mechanism for paying money owed from a closed payroll run.
 */
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { arrearsPaymentService, ArrearsPaymentError, type ArrearsStatus } from "./arrears-payment.service.js";

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);

function handleError(err: unknown, res: any): boolean {
  if (err instanceof ArrearsPaymentError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export const arrearsPaymentRouter = Router();
arrearsPaymentRouter.use(requireAuth);

// Anyone who can touch payroll may request one — mirrors the incentive upload gate.
arrearsPaymentRouter.post(
  "/",
  requireRole("admin", "finance", "payroll", "payroll_head", "hr"),
  h(async (req, res) => {
    try {
      const { employeeId, amount, reason, basisNote, sourceRunId, targetRunId } = req.body ?? {};
      const created = await arrearsPaymentService.create(
        { employeeId, amount: Number(amount), reason, basisNote, sourceRunId, targetRunId },
        req.authUser.id,
      );
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  }),
);

// Approval/rejection is a payroll sign-off, same gate as incentive batch approval.
arrearsPaymentRouter.post(
  "/:id/approve",
  requireRole("admin", "finance", "payroll_head"),
  h(async (req, res) => {
    try {
      const updated = await arrearsPaymentService.approve(req.params.id, req.authUser.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  }),
);

arrearsPaymentRouter.post(
  "/:id/reject",
  requireRole("admin", "finance", "payroll_head"),
  h(async (req, res) => {
    try {
      const updated = await arrearsPaymentService.reject(req.params.id, req.authUser.id, req.body?.reason);
      res.json({ success: true, data: updated });
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  }),
);

// Marking paid documents a manual transfer already made outside this system — finance-only.
arrearsPaymentRouter.post(
  "/:id/mark-paid",
  requireRole("admin", "finance"),
  h(async (req, res) => {
    try {
      const updated = await arrearsPaymentService.markPaid(req.params.id, req.authUser.id, req.body?.paymentReference);
      res.json({ success: true, data: updated });
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  }),
);

arrearsPaymentRouter.get(
  "/",
  requireRole("admin", "finance", "payroll", "payroll_head", "hr"),
  h(async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as ArrearsStatus) : undefined;
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const data = await arrearsPaymentService.list({ status, employeeId });
    res.json({ success: true, data });
  }),
);

arrearsPaymentRouter.get(
  "/:id",
  requireRole("admin", "finance", "payroll", "payroll_head", "hr"),
  h(async (req, res) => {
    const row = await arrearsPaymentService.getById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Arrears payment not found." });
    res.json({ success: true, data: row });
  }),
);
