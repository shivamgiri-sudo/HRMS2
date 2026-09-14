import { Router } from "express";
import multer from "multer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { BANK_ACCOUNT_READ_ROLES, BANK_ACCOUNT_WRITE_ROLES } from "./company-bank-account.routes.js";
import { bankStatementImportService, parseStatementRows, type ColumnMapping } from "./bank-statement-import.service.js";
import { bankReconciliationMatchService } from "./bank-reconciliation-match.service.js";
import { bankReconciliationPeriodService } from "./bank-reconciliation-period.service.js";

/**
 * Bank Reconciliation — own prefix (/api/finance/bank-reconciliation), same rationale as
 * payment-voucher.routes.ts/imprest.routes.ts: never shadowed by grnRouter's ":id"-shaped
 * routes. Write access follows BANK_ACCOUNT_WRITE_ROLES (finance_head, accounts_head,
 * super_admin) imported from company-bank-account.routes.ts — the Accounts Head does the
 * whole reconciliation cycle (upload, match, close), per the design's single-owner decision.
 */
export const bankReconciliationRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  return { id, role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown") };
}

bankReconciliationRouter.use(requireAuth);

// List reconciliation periods for a bank account, most recent first.
bankReconciliationRouter.get(
  "/periods",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM bank_reconciliation_period WHERE bank_account_id = ? ORDER BY from_date DESC`,
      [String(req.query.bankAccountId)],
    );
    res.json({ success: true, data: rows });
  }),
);

// Start a new open period for an account.
bankReconciliationRouter.post(
  "/periods",
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    const { bankAccountId, fromDate, toDate } = req.body;
    const result = await bankReconciliationPeriodService.create(bankAccountId, fromDate, toDate, actor(req).id);
    res.status(201).json({ success: true, data: result });
  }),
);

// All statement lines uploaded into a period so far, most recently uploaded import first.
bankReconciliationRouter.get(
  "/periods/:periodId/statement-lines",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT bsl.id, bsl.txn_date, bsl.description, bsl.reference, bsl.debit_amount, bsl.credit_amount, bsl.match_status
         FROM bank_statement_line bsl
         JOIN bank_statement_import bsi ON bsi.id = bsl.import_id
        WHERE bsi.period_id = ?
        ORDER BY bsi.imported_at DESC, bsl.txn_date ASC`,
      [req.params.periodId],
    );
    res.json({ success: true, data: rows });
  }),
);

// Upload + parse a statement into an open period, auto-match immediately.
bankReconciliationRouter.post(
  "/periods/:periodId/statements",
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  upload.single("file"),
  h(async (req, res) => {
    if (!req.file) { res.status(400).json({ success: false, message: "No file uploaded." }); return; }
    const bankAccountId = String(req.body.bankAccountId);
    const mapping: ColumnMapping = JSON.parse(req.body.columnMapping);
    const { headers, rows } = bankStatementImportService.parseWorkbook(req.file.buffer);
    const lines = parseStatementRows(headers, rows, mapping);
    const saved = await bankStatementImportService.saveImport(bankAccountId, req.params.periodId, req.file.originalname, mapping, lines, actor(req).id);
    const matchResult = await bankReconciliationMatchService.autoMatch(saved.importId);
    res.status(201).json({ success: true, data: { ...saved, ...matchResult } });
  }),
);

// Preview a workbook's header row before committing to a column mapping.
bankReconciliationRouter.post(
  "/statement-preview",
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  upload.single("file"),
  h(async (req, res) => {
    if (!req.file) { res.status(400).json({ success: false, message: "No file uploaded." }); return; }
    const { headers } = bankStatementImportService.parseWorkbook(req.file.buffer);
    res.json({ success: true, data: { headers } });
  }),
);

bankReconciliationRouter.post(
  "/statement-lines/:lineId/match",
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    await bankReconciliationMatchService.manualMatch(req.params.lineId, String(req.body.ledgerEntryId), actor(req).id);
    res.json({ success: true });
  }),
);

bankReconciliationRouter.post(
  "/statement-lines/:lineId/unmatch",
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    await bankReconciliationMatchService.unmatch(req.params.lineId, actor(req).id);
    res.json({ success: true });
  }),
);

bankReconciliationRouter.post(
  "/statement-lines/:lineId/adjustment",
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    const { bankAccountId, payableAccountId, narration } = req.body;
    const result = await bankReconciliationMatchService.postAdjustment({
      statementLineId: req.params.lineId, bankAccountId, payableAccountId, narration, actorUserId: actor(req).id,
    });
    res.json({ success: true, data: result });
  }),
);

// Candidate ledger entries for manually matching one statement line (nearby unmatched entries
// on the same account/amount side, for the frontend's picker dialog).
bankReconciliationRouter.get(
  "/statement-lines/:lineId/candidates",
  requireRole(...BANK_ACCOUNT_READ_ROLES),
  h(async (req, res) => {
    const [[line]] = await db.execute<RowDataPacket[]>(
      `SELECT bsl.debit_amount, bsl.credit_amount, bsi.bank_account_id FROM bank_statement_line bsl
         JOIN bank_statement_import bsi ON bsi.id = bsl.import_id WHERE bsl.id = ?`,
      [req.params.lineId],
    );
    if (!line) { res.status(404).json({ success: false, message: "Statement line not found." }); return; }
    const amountClause = Number(line.debit_amount) > 0 ? "debit_amount = ?" : "credit_amount = ?";
    const amountParam = Number(line.debit_amount) > 0 ? line.debit_amount : line.credit_amount;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, entry_date, debit_amount, credit_amount, narration FROM bank_account_ledger_entry
        WHERE bank_account_id = ? AND matched_statement_line_id IS NULL AND ${amountClause}
        ORDER BY entry_date DESC LIMIT 20`,
      [line.bank_account_id, amountParam],
    );
    res.json({ success: true, data: rows });
  }),
);

bankReconciliationRouter.post(
  "/periods/:periodId/close",
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    const result = await bankReconciliationPeriodService.close(req.params.periodId, Number(req.body.statementClosingBalance), actor(req).id);
    res.json({ success: true, data: result });
  }),
);

bankReconciliationRouter.post(
  "/periods/:periodId/reopen",
  requireRole(...BANK_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    await bankReconciliationPeriodService.reopen(req.params.periodId, String(req.body.reason ?? ""), actor(req).id);
    res.json({ success: true });
  }),
);
