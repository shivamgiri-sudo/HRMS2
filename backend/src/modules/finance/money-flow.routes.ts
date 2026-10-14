// backend/src/modules/finance/money-flow.routes.ts
/**
 * Ledger Analytics "Money Flow" (read-only). Readable by the finance roles plus the leadership and
 * branch roles that can open /finance/ledger; anyone not org-wide (isOrgWideUser) sees only their
 * own branch, the same rule Client Billing receipts use.
 */
import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { loadBranchPolicy } from "../../shared/branchDecisionScope.js";
import { DRILL_KEYS, moneyFlowService, type DrillKey, type MoneyFlowQuery } from "./money-flow.service.js";

export const MONEY_FLOW_ROLES = [
  "super_admin", "admin", "finance", "finance_head", "accounts_head", "ceo", "coo",
  "payroll_head", "branch_head", "branch_admin",
] as const;

export const moneyFlowRouter = Router();
moneyFlowRouter.use(requireAuth);
moneyFlowRouter.use(requireRole(...MONEY_FLOW_ROLES));

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) =>
    fn(req, res).catch((e) => {
      if (e?.statusCode === 400) return res.status(400).json({ success: false, message: e.message });
      next(e);
    });

async function query(req: AuthenticatedRequest): Promise<MoneyFlowQuery> {
  const q = req.query as Record<string, string | undefined>;
  const policy = await loadBranchPolicy(req.authUser!.id);
  const branchIds = policy.orgWide ? null : policy.ownBranchId ? [policy.ownBranchId] : [];
  return {
    financeYear: q.financeYear?.trim() || undefined,
    branchId: q.branchId?.trim() || undefined,
    client: q.client?.trim() || undefined,
    branchIds,
  };
}

moneyFlowRouter.get("/", h(async (req, res) => {
  res.json({ success: true, data: await moneyFlowService.summary(await query(req)) });
}));

moneyFlowRouter.get("/options", h(async (req, res) => {
  res.json({ success: true, data: await moneyFlowService.options(await query(req)) });
}));

moneyFlowRouter.get("/rows/:key", h(async (req, res) => {
  const key = req.params.key as DrillKey;
  if (!DRILL_KEYS.includes(key)) return res.status(400).json({ success: false, message: `Unknown figure ${key}` });
  res.json({ success: true, data: await moneyFlowService.rows(await query(req), key) });
}));
