/**
 * Vendor payee bank details — HTTP surface.
 *
 * Every route is gated to finance_head / accounts_head. Deliberately NOT admin or
 * super_admin: hasOrgWideScope() already lets `admin` past org-wide checks with no scope
 * row at all, and a payee bank account is precisely the thing that should not inherit
 * access from a general-purpose administrative role.
 *
 * Separation of duties is enforced in the service, not here. A route guard proves a
 * ROLE; it cannot prove two different PEOPLE.
 */
import { Router, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  VendorBankError,
  approveBankChange,
  getActiveBankDetail,
  getBankChangeLog,
  listPendingRequests,
  rejectBankChange,
  requestBankChange,
} from "./vendor-bank.service.js";

export const vendorBankRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);

const BANK_ROLES = ["finance_head", "accounts_head"] as const;

function fail(res: Response, err: unknown): Response {
  if (err instanceof VendorBankError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  throw err;
}

function actorOf(req: AuthenticatedRequest) {
  return {
    userId: String((req as any).user?.id ?? (req as any).user?.userId ?? ""),
    role: (req as any).user?.role ?? null,
    ip: req.ip ?? null,
    userAgent: req.get?.("user-agent") ?? null,
  };
}

vendorBankRouter.use(requireAuth);

/** GET /api/finance/vendors/:vendorId/bank — the active account, masked. */
vendorBankRouter.get(
  "/vendors/:vendorId/bank",
  requireRole(...BANK_ROLES),
  h(async (req, res) => {
    const detail = await getActiveBankDetail(String(req.params.vendorId));
    return res.json({ success: true, data: detail });
  }),
);

/** GET /api/finance/vendors/:vendorId/bank/log — the change log for the drill-down. */
vendorBankRouter.get(
  "/vendors/:vendorId/bank/log",
  requireRole(...BANK_ROLES),
  h(async (req, res) => {
    const rows = await getBankChangeLog(String(req.params.vendorId));
    return res.json({ success: true, data: rows });
  }),
);

/** POST /api/finance/vendors/:vendorId/bank/requests — raise a change. */
vendorBankRouter.post(
  "/vendors/:vendorId/bank/requests",
  requireRole(...BANK_ROLES),
  h(async (req, res) => {
    try {
      const out = await requestBankChange(
        String(req.params.vendorId),
        req.body ?? {},
        actorOf(req),
      );
      return res.status(201).json({ success: true, data: out });
    } catch (err) {
      return fail(res, err);
    }
  }),
);

/** GET /api/finance/vendor-bank/requests — the approval queue. */
vendorBankRouter.get(
  "/vendor-bank/requests",
  requireRole(...BANK_ROLES),
  h(async (req, res) => {
    const vendorId = req.query.vendorId ? String(req.query.vendorId) : undefined;
    const rows = await listPendingRequests(vendorId);
    return res.json({ success: true, data: rows });
  }),
);

/** POST /api/finance/vendor-bank/requests/:id/approve — the checker half. */
vendorBankRouter.post(
  "/vendor-bank/requests/:id/approve",
  requireRole(...BANK_ROLES),
  h(async (req, res) => {
    try {
      const out = await approveBankChange(
        String(req.params.id),
        actorOf(req),
        (req.body ?? {}).reason,
      );
      return res.json({ success: true, data: out });
    } catch (err) {
      return fail(res, err);
    }
  }),
);

/** POST /api/finance/vendor-bank/requests/:id/reject — reject, or cancel your own. */
vendorBankRouter.post(
  "/vendor-bank/requests/:id/reject",
  requireRole(...BANK_ROLES),
  h(async (req, res) => {
    try {
      await rejectBankChange(String(req.params.id), actorOf(req), (req.body ?? {}).reason);
      return res.json({ success: true });
    } catch (err) {
      return fail(res, err);
    }
  }),
);
