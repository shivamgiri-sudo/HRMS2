import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Bank directory master (bank_master, 310_vendor_payment_tracking.sql) — until now this table
 * was DB-seed-only (20 hardcoded Indian banks): read from two places
 * (company-bank-account.routes.ts's "/banks" dropdown, vendor-payment.service.ts's listBanks()),
 * written from nowhere. This service is the first write path, so a bank not in the original
 * seed (e.g. a smaller regional bank, or a new NBFC) can be added without a raw SQL INSERT.
 */

export class BankMasterError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const IFSC_PREFIX_RE = /^[A-Z]{4}$/;

function normalizeIfscPrefix(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const upper = value.trim().toUpperCase();
  if (!IFSC_PREFIX_RE.test(upper)) {
    throw new BankMasterError("IFSC prefix must be exactly 4 letters (e.g. HDFC, SBIN) — the first 4 characters of any branch IFSC code at this bank.");
  }
  return upper;
}

export interface BankMasterInput {
  bankName: string;
  bankCode?: string | null;
  ifscPrefix?: string | null;
}

export const bankMasterService = {
  async list(includeInactive = false): Promise<RowDataPacket[]> {
    const where = includeInactive ? "" : "WHERE active_status = 1";
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM bank_master ${where} ORDER BY bank_name`);
    return rows as RowDataPacket[];
  },

  async create(input: BankMasterInput): Promise<{ id: string }> {
    const bankName = input.bankName?.trim();
    if (!bankName) throw new BankMasterError("Bank name is required.");
    const ifscPrefix = normalizeIfscPrefix(input.ifscPrefix);
    const bankCode = input.bankCode?.trim() || null;

    const id = randomUUID();
    try {
      await db.execute<ResultSetHeader>(
        `INSERT INTO bank_master (id, bank_name, bank_code, ifsc_prefix) VALUES (?, ?, ?, ?)`,
        [id, bankName, bankCode, ifscPrefix],
      );
    } catch (error: any) {
      if (error?.code === "ER_DUP_ENTRY") throw new BankMasterError("A bank with this name already exists.", 409);
      throw error;
    }
    return { id };
  },

  async update(id: string, input: { bankName?: string; bankCode?: string | null; ifscPrefix?: string | null; activeStatus?: boolean }): Promise<void> {
    const ifscPrefix = input.ifscPrefix !== undefined ? normalizeIfscPrefix(input.ifscPrefix) : undefined;
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bank_master
          SET bank_name = COALESCE(?, bank_name),
              bank_code = COALESCE(?, bank_code),
              ifsc_prefix = COALESCE(?, ifsc_prefix),
              active_status = COALESCE(?, active_status)
        WHERE id = ?`,
      [
        input.bankName?.trim() ?? null,
        input.bankCode?.trim() ?? null,
        ifscPrefix ?? null,
        input.activeStatus === undefined ? null : (input.activeStatus ? 1 : 0),
        id,
      ],
    );
    if (result.affectedRows !== 1) throw new BankMasterError("Bank not found.", 404);
  },
};
