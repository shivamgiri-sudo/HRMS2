import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";

/**
 * Payable Account (chart-of-accounts) master — plain CRUD, same write-role set as the bank
 * account master (1702_payable_account_master.sql). Mounted at its own prefix
 * (/api/finance/payable-accounts) for the same reason as every other narrow finance router:
 * nothing here has an unscoped path-less middleware, but keeping the convention consistent
 * avoids ever having to move it later if that changes.
 */
const WRITE_ROLES = ["finance_head", "accounts_head", "super_admin"] as const;
const READ_ROLES = [...WRITE_ROLES, "ceo", "branch_head", "admin", "finance"] as const;

export const payableAccountRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

const ACCOUNT_TYPES = new Set(["expense", "payable", "receivable", "income", "bank_charge", "other"]);

payableAccountRouter.use(requireAuth);

payableAccountRouter.get(
  "/",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const where = req.query.includeInactive === "1" ? "" : "WHERE active_status = 1";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM payable_account_master ${where} ORDER BY account_name`,
    );
    res.json({ success: true, data: rows });
  }),
);

payableAccountRouter.post(
  "/",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const { accountName, accountType, tallyLedgerName } = req.body ?? {};
    if (!accountName?.trim()) return res.status(400).json({ success: false, error: "Account name is required" });
    if (!ACCOUNT_TYPES.has(accountType)) return res.status(400).json({ success: false, error: "Invalid account type" });
    if (!tallyLedgerName?.trim()) return res.status(400).json({ success: false, error: "Tally ledger name is required" });

    const id = randomUUID();
    try {
      await db.execute(
        `INSERT INTO payable_account_master (id, account_name, account_type, tally_ledger_name)
         VALUES (?, ?, ?, ?)`,
        [id, accountName.trim(), accountType, tallyLedgerName.trim()],
      );
    } catch (error: any) {
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ success: false, error: "An account with this name already exists" });
      }
      throw error;
    }
    res.status(201).json({ success: true, data: { id } });
  }),
);

payableAccountRouter.put(
  "/:id",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const { accountName, accountType, tallyLedgerName, activeStatus } = req.body ?? {};
    if (accountType != null && !ACCOUNT_TYPES.has(accountType)) {
      return res.status(400).json({ success: false, error: "Invalid account type" });
    }
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE payable_account_master
          SET account_name = COALESCE(?, account_name),
              account_type = COALESCE(?, account_type),
              tally_ledger_name = COALESCE(?, tally_ledger_name),
              active_status = COALESCE(?, active_status)
        WHERE id = ?`,
      [
        accountName?.trim() ?? null,
        accountType ?? null,
        tallyLedgerName?.trim() ?? null,
        activeStatus == null ? null : (activeStatus ? 1 : 0),
        req.params.id,
      ],
    );
    if (result.affectedRows !== 1) return res.status(404).json({ success: false, error: "Payable account not found" });
    res.json({ success: true });
  }),
);
