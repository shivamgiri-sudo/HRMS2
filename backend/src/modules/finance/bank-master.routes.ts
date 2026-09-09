import { Router } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { bankMasterService, BankMasterError } from "./bank-master.service.js";

/**
 * Bank directory master — own prefix (/api/finance/bank-master), same convention as every
 * other narrow finance router. Same write-role set as payable-account.routes.ts, its closest
 * sibling: this and payable_account_master are the only two masters the Payment Voucher /
 * Bank Ledger / Bank Reconciliation system depends on.
 */
const WRITE_ROLES = ["finance_head", "accounts_head", "super_admin"] as const;
const READ_ROLES = [...WRITE_ROLES, "ceo", "branch_head", "admin", "finance"] as const;

export const bankMasterRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

function fail(res: any, error: unknown) {
  const statusCode = error instanceof BankMasterError ? error.statusCode : 400;
  res.status(statusCode).json({ success: false, error: error instanceof Error ? error.message : "Unexpected error" });
}

bankMasterRouter.use(requireAuth);

bankMasterRouter.get(
  "/",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const rows = await bankMasterService.list(req.query.includeInactive === "1");
    res.json({ success: true, data: rows });
  }),
);

bankMasterRouter.post(
  "/",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    try {
      const result = await bankMasterService.create(req.body ?? {});
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      fail(res, error);
    }
  }),
);

bankMasterRouter.put(
  "/:id",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    try {
      await bankMasterService.update(req.params.id, req.body ?? {});
      res.json({ success: true });
    } catch (error) {
      fail(res, error);
    }
  }),
);
