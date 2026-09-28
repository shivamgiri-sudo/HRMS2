import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { companyBankAccountService, CompanyBankAccountError } from "./company-bank-account.service.js";
import { bankLedgerService } from "./bank-ledger.service.js";
import { tallyExportService } from "./tally-export.service.js";

/**
 * Company Bank Account master — own prefix (/api/finance/bank-accounts), matching the
 * imprest.routes.ts / gst-export.routes.ts convention of never sharing bare /api/finance with
 * grnRouter's ":id"-shaped routes.
 */
export const BANK_ACCOUNT_WRITE_ROLES = ["finance_head", "accounts_head", "super_admin"] as const;
export const BANK_ACCOUNT_READ_ROLES = [
  ...BANK_ACCOUNT_WRITE_ROLES,
  "ceo",
  "branch_head",
  "admin",
  "finance",
] as const;

export const companyBankAccountRouter = Router();

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
  const statusCode = error instanceof CompanyBankAccountError ? error.statusCode : 400;
  res.status(statusCode).json({
    success: false,
    error: error instanceof Error ? error.message : fallback,
  });
};

companyBankAccountRouter.use(requireAuth);

/** Bank directory dropdown — reuses bank_master, the same list vendor-payment.service.ts's
 *  listBanks() already serves, so a new account picks from the identical set. */
companyBankAccountRouter.get(
  "/banks",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (_req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, bank_name, bank_code, ifsc_prefix FROM bank_master WHERE active_status = 1 ORDER BY bank_name`,
    );
    res.json({ success: true, data: rows });
  }),
);

companyBankAccountRouter.get(
  "/",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const data = await companyBankAccountService.list({
      includeInactive: req.query.includeInactive === "1",
    });
    res.json({ success: true, data });
  }),
);

companyBankAccountRouter.get(
  "/:id",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const data = await companyBankAccountService.get(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: "Bank account not found" });
    res.json({ success: true, data });
  }),
);

companyBankAccountRouter.get(
  "/:id/audit",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const data = await companyBankAccountService.getAuditTrail(req.params.id);
    res.json({ success: true, data });
  }),
);

/** Credit/Debit report (PRD §6.1) — the running bank book for one account. */
companyBankAccountRouter.get(
  "/:id/ledger",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const data = await bankLedgerService.getReport({
      bankAccountId: req.params.id,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
  }),
);

/** CSV fallback export (PRD §6.2.2) — same authenticated-blob-download idiom as
 *  gst-export.routes.ts / vendor-payment-tracking's export. */
companyBankAccountRouter.get(
  "/:id/ledger/export",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const csv = await bankLedgerService.toCsv({
      bankAccountId: req.params.id,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="bank-ledger-${req.params.id}.csv"`);
    res.send(csv);
  }),
);

/** Tally XML export (PRD §6.2.1) — see tally-export.service.ts for the ENVELOPE format and the
 *  sign-convention derivation. Read-only (generating/downloading it changes nothing), but
 *  still an explicit action worth the same role gate as the ledger itself. */
companyBankAccountRouter.get(
  "/:id/tally-export",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const result = await tallyExportService.exportAndLog(
      req.params.id,
      req.query.from ? String(req.query.from) : undefined,
      req.query.to ? String(req.query.to) : undefined,
      actor(req).id,
      actor(req).role,
    );
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tally-export-${req.params.id}.xml"`);
    res.setHeader("X-Tally-Export-Final", String(result.isFinal));
    res.setHeader("X-Tally-Export-Entry-Count", String(result.entryCount));
    res.send(result.xml);
  }),
);

companyBankAccountRouter.post(
  "/",
  requireWriteAccess,
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    try {
      const data = await companyBankAccountService.create(req.body, actor(req).id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to create the bank account");
    }
  }),
);

companyBankAccountRouter.put(
  "/:id",
  requireWriteAccess,
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    try {
      const data = await companyBankAccountService.update(req.params.id, req.body, actor(req).id);
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to update the bank account");
    }
  }),
);

companyBankAccountRouter.post(
  "/:id/close",
  requireWriteAccess,
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    try {
      const data = await companyBankAccountService.setActiveStatus(
        req.params.id,
        false,
        actor(req).id,
        req.body?.closedDate ?? null,
      );
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to close the bank account");
    }
  }),
);

companyBankAccountRouter.post(
  "/:id/reactivate",
  requireWriteAccess,
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    try {
      const data = await companyBankAccountService.setActiveStatus(req.params.id, true, actor(req).id);
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to reactivate the bank account");
    }
  }),
);
