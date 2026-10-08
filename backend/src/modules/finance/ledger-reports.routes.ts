import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { BANK_ACCOUNT_READ_ROLES } from "./company-bank-account.routes.js";
import { callerBranchScope } from "./finance-branch-guard.js";
import { ledgerReportsService, startTrialBalanceWarmer } from "./ledger-reports.service.js";
import { financialStatements } from "./financial-statements.service.js";

/**
 * Own prefix (/api/finance/ledger-reports), same rationale as every other finance router that
 * takes an own prefix in this codebase (payment-voucher.routes.ts, bank-reconciliation.routes.ts,
 * imprest.routes.ts) — never shadowed by grnRouter's ":id"-shaped routes.
 *
 * Read-only: reuses BANK_ACCOUNT_READ_ROLES rather than introducing a new role list, since
 * "who can see the bank ledger" and "who can see the trial balance/vendor ledger/head-subhead
 * ledger" are the same people in every finance role model this codebase already has.
 */
startTrialBalanceWarmer();

export const ledgerReportsRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

ledgerReportsRouter.use(requireAuth);

ledgerReportsRouter.get(
  "/filter-options",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const result = await ledgerReportsService.filterOptions(await callerBranchScope(req));
    res.json({ success: true, data: result });
  }),
);

ledgerReportsRouter.get(
  "/trial-balance",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const asOfDate = req.query.asOfDate ? String(req.query.asOfDate) : undefined;
    const filters = {
      branchId: req.query.branchId ? String(req.query.branchId) : undefined,
      costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
      processId: req.query.processId ? String(req.query.processId) : undefined,
    };
    // ?branchId only narrows: outside the caller's scope it is a 403 (see callerBranchScope).
    const scope = await callerBranchScope(req, filters.branchId);
    const result = await ledgerReportsService.trialBalance(asOfDate, filters, scope);
    res.json({ success: true, data: result });
  }),
);

ledgerReportsRouter.get(
  "/vendor-ledger/:vendorId",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const result = await ledgerReportsService.vendorLedger(String(req.params.vendorId), from, to, await callerBranchScope(req));
    res.json({ success: true, data: result });
  }),
);

/** Outstanding bills with ageing for one vendor. */
ledgerReportsRouter.get(
  "/vendor-outstanding/:vendorId",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const asOf = req.query.asOf && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.asOf)) ? String(req.query.asOf) : undefined;
    const result = await ledgerReportsService.vendorOutstanding(String(req.params.vendorId), asOf, await callerBranchScope(req));
    res.json({ success: true, data: result });
  }),
);

/** Tally-style statement: opening balance, voucher rows, totals, closing Dr/Cr. */
ledgerReportsRouter.get(
  "/vendor-statement/:vendorId",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const result = await ledgerReportsService.vendorStatement(String(req.params.vendorId), from, to, await callerBranchScope(req));
    if (!result) return res.status(404).json({ success: false, message: "Vendor not found" });
    res.json({ success: true, data: result });
  }),
);

ledgerReportsRouter.get(
  "/head-subhead-ledger",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const filters = {
      branchId: req.query.branchId ? String(req.query.branchId) : undefined,
      costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
      processId: req.query.processId ? String(req.query.processId) : undefined,
    };
    const scope = await callerBranchScope(req, filters.branchId);
    const result = await ledgerReportsService.headSubHeadLedger(from, to, filters, scope);
    res.json({ success: true, data: result });
  }),
);

/** Balance sheet and profit and loss, built from the trial balance (see financial-statements.ts). */
ledgerReportsRouter.get(
  "/financial-statements",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const raw = req.query.asOfDate ? String(req.query.asOfDate) : undefined;
    const asOfDate = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
    const scope = await callerBranchScope(req);
    res.json({ success: true, data: await financialStatements(asOfDate, scope) });
  }),
);

const ACCOUNT_TYPES = ["bank_account", "vendor", "expense_sub_head", "payable_account"] as const;

// Generic drill-down behind Trial Balance and Head/Subhead Ledger rows (the Drill-Down
// Mandate) — same query vendor-ledger/:vendorId already ran, generalized to any account type
// rather than duplicating it under each report.
ledgerReportsRouter.get(
  "/account-ledger/:accountType/:accountId",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const accountType = String(req.params.accountType);
    if (!(ACCOUNT_TYPES as readonly string[]).includes(accountType)) {
      res.status(400).json({ success: false, message: `Unknown account type "${accountType}"` });
      return;
    }
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const scope = await callerBranchScope(req);
    const accountId = String(req.params.accountId);
    // The balancing rows on the Trial Balance have no sub-ledger of their own.
    if (accountId.startsWith("synthetic:")) { res.json({ success: true, data: { entries: [], closingBalance: 0 } }); return; }
    const result = accountType === "vendor"
      ? await ledgerReportsService.vendorAsAccountLedger(accountId, from, to, scope)
      : await ledgerReportsService.accountLedger(accountType as (typeof ACCOUNT_TYPES)[number], accountId, from, to, scope);
    res.json({ success: true, data: result });
  }),
);
