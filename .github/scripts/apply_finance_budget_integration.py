from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if new in content:
        return
    if old not in content:
        raise RuntimeError(f"Required anchor not found in {path}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def regex_replace_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    content = read(path)
    next_content, count = re.subn(pattern, replacement, content, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Expected one regex match in {path}, found {count}: {pattern[:120]}")
    write(path, next_content)


MIGRATION = r'''-- 411_branch_budget_grn_approval_flow.sql
-- Tax-aware branch budgets, approved-budget GRN linkage and staged vendor-payment flow.
-- Additive and idempotent for the existing 310/405 finance schema.

CREATE TABLE IF NOT EXISTS finance_budget_header (
  id CHAR(36) PRIMARY KEY,
  budget_number VARCHAR(80) NOT NULL UNIQUE,
  branch_id CHAR(36) NOT NULL,
  period_code CHAR(7) NOT NULL,
  financial_year VARCHAR(10) NOT NULL,
  status ENUM('draft','submitted','branch_head_approved','finance_head_approved','accounts_head_approved','active','rejected','revision_required','closed') NOT NULL DEFAULT 'draft',
  base_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  pnl_budget_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  submitted_by CHAR(36) NULL,
  submitted_at DATETIME NULL,
  branch_head_approved_by CHAR(36) NULL,
  branch_head_approved_at DATETIME NULL,
  finance_head_approved_by CHAR(36) NULL,
  finance_head_approved_at DATETIME NULL,
  accounts_head_approved_by CHAR(36) NULL,
  accounts_head_approved_at DATETIME NULL,
  rejection_reason TEXT NULL,
  revision_no INT NOT NULL DEFAULT 1,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_budget_branch_period (branch_id, period_code),
  INDEX idx_budget_status (status),
  INDEX idx_budget_fy (financial_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_budget_line (
  id CHAR(36) PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  cost_centre_id CHAR(36) NULL,
  process_id CHAR(36) NULL,
  head VARCHAR(255) NOT NULL,
  sub_head VARCHAR(255) NULL,
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT NULL,
  quantity DECIMAL(18,4) NOT NULL DEFAULT 1,
  unit VARCHAR(60) NOT NULL,
  unit_rate DECIMAL(18,4) NOT NULL DEFAULT 0,
  tax_treatment ENUM('inclusive','exclusive','exempt','reverse_charge','non_gst') NOT NULL DEFAULT 'exclusive',
  gst_rate DECIMAL(7,4) NOT NULL DEFAULT 18,
  gst_type ENUM('cgst_sgst','igst','none') NOT NULL DEFAULT 'cgst_sgst',
  recoverable_tax_pct DECIMAL(7,4) NOT NULL DEFAULT 100,
  cgst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  sgst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  igst_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  base_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  gross_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  recoverable_tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  pnl_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  preferred_vendor_id CHAR(36) NULL,
  allocation_driver VARCHAR(60) NULL,
  justification TEXT NOT NULL,
  reserved_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  consumed_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_budget_line_header FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_budget_line_budget (budget_id),
  INDEX idx_budget_line_attribution (cost_centre_id, process_id),
  INDEX idx_budget_line_head (head, sub_head),
  INDEX idx_budget_line_vendor (preferred_vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_budget_approval_log (
  id CHAR(36) PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(60) NULL,
  to_status VARCHAR(60) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  actor_role VARCHAR(80) NOT NULL,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_budget_approval_header FOREIGN KEY (budget_id) REFERENCES finance_budget_header(id) ON DELETE CASCADE,
  INDEX idx_budget_approval_budget (budget_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add one column per guarded statement. This avoids a partially-applied multi-column ALTER.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='budget_id')=0,
  'ALTER TABLE grn_request ADD COLUMN budget_id CHAR(36) NULL AFTER financial_year', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='budget_line_id')=0,
  'ALTER TABLE grn_request ADD COLUMN budget_line_id CHAR(36) NULL AFTER budget_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='quantity')=0,
  'ALTER TABLE grn_request ADD COLUMN quantity DECIMAL(18,4) NOT NULL DEFAULT 1 AFTER sub_head', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='unit')=0,
  'ALTER TABLE grn_request ADD COLUMN unit VARCHAR(60) NULL AFTER quantity', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='unit_rate')=0,
  'ALTER TABLE grn_request ADD COLUMN unit_rate DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER unit', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='tax_treatment')=0,
  'ALTER TABLE grn_request ADD COLUMN tax_treatment ENUM(''inclusive'',''exclusive'',''exempt'',''reverse_charge'',''non_gst'') NOT NULL DEFAULT ''exclusive'' AFTER unit_rate', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='gst_rate')=0,
  'ALTER TABLE grn_request ADD COLUMN gst_rate DECIMAL(7,4) NOT NULL DEFAULT 18 AFTER tax_treatment', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='gst_type')=0,
  'ALTER TABLE grn_request ADD COLUMN gst_type ENUM(''cgst_sgst'',''igst'',''none'') NOT NULL DEFAULT ''cgst_sgst'' AFTER gst_rate', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='recoverable_tax_pct')=0,
  'ALTER TABLE grn_request ADD COLUMN recoverable_tax_pct DECIMAL(7,4) NOT NULL DEFAULT 100 AFTER gst_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='amount_without_tax')=0,
  'ALTER TABLE grn_request ADD COLUMN amount_without_tax DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER recoverable_tax_pct', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='tax_amount')=0,
  'ALTER TABLE grn_request ADD COLUMN tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER amount_without_tax', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='amount_with_tax')=0,
  'ALTER TABLE grn_request ADD COLUMN amount_with_tax DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER tax_amount', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='pnl_cost_amount')=0,
  'ALTER TABLE grn_request ADD COLUMN pnl_cost_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER amount_with_tax', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='branch_head_reviewed_by')=0,
  'ALTER TABLE grn_request ADD COLUMN branch_head_reviewed_by CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='branch_head_reviewed_at')=0,
  'ALTER TABLE grn_request ADD COLUMN branch_head_reviewed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='branch_head_review_note')=0,
  'ALTER TABLE grn_request ADD COLUMN branch_head_review_note TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='finance_head_reviewed_by')=0,
  'ALTER TABLE grn_request ADD COLUMN finance_head_reviewed_by CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='finance_head_reviewed_at')=0,
  'ALTER TABLE grn_request ADD COLUMN finance_head_reviewed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='finance_head_review_note')=0,
  'ALTER TABLE grn_request ADD COLUMN finance_head_review_note TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grn_request' AND column_name='accounts_payment_status')=0,
  'ALTER TABLE grn_request ADD COLUMN accounts_payment_status ENUM(''not_required'',''pending'',''scheduled'',''partially_paid'',''paid'',''on_hold'',''failed'',''cancelled'') NOT NULL DEFAULT ''not_required''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE grn_request
  MODIFY COLUMN status ENUM('draft','submitted','branch_head_approved','finance_head_approved','pending_accounts_payment','payment_scheduled','partially_paid','paid','approved','rejected','cancelled') NOT NULL DEFAULT 'draft';

SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='grn_request' AND index_name='idx_grn_budget_line')=0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_budget_line (budget_line_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='grn_request' AND index_name='idx_grn_budget')=0,
  'ALTER TABLE grn_request ADD INDEX idx_grn_budget (budget_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='budget_id')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN budget_id CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='budget_line_id')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN budget_line_id CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='amount_without_tax')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN amount_without_tax DECIMAL(18,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='tax_amount')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='vendor_payment_tracking' AND column_name='amount_with_tax')=0,
  'ALTER TABLE vendor_payment_tracking ADD COLUMN amount_with_tax DECIMAL(18,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE grn_request
   SET amount_without_tax = CASE WHEN amount_without_tax = 0 THEN amount ELSE amount_without_tax END,
       amount_with_tax = CASE WHEN amount_with_tax = 0 THEN amount ELSE amount_with_tax END,
       pnl_cost_amount = CASE WHEN pnl_cost_amount = 0 THEN amount ELSE pnl_cost_amount END
 WHERE amount > 0;

UPDATE vendor_payment_tracking v
JOIN grn_request g ON g.id = v.grn_request_id
   SET v.budget_id = COALESCE(v.budget_id, g.budget_id),
       v.budget_line_id = COALESCE(v.budget_line_id, g.budget_line_id),
       v.amount_without_tax = CASE WHEN v.amount_without_tax = 0 THEN COALESCE(NULLIF(g.amount_without_tax,0), g.amount) ELSE v.amount_without_tax END,
       v.tax_amount = CASE WHEN v.tax_amount = 0 THEN COALESCE(g.tax_amount,0) ELSE v.tax_amount END,
       v.amount_with_tax = CASE WHEN v.amount_with_tax = 0 THEN COALESCE(NULLIF(g.amount_with_tax,0), g.amount) ELSE v.amount_with_tax END;

SELECT '411_branch_budget_grn_approval_flow.sql applied' AS migration_status;
'''

BRANCH_BUDGET_SERVICE = r'''import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";

export type BudgetTaxTreatment = "inclusive" | "exclusive" | "exempt" | "reverse_charge" | "non_gst";
export type BudgetGstType = "cgst_sgst" | "igst" | "none";
export type BudgetStatus =
  | "draft"
  | "submitted"
  | "branch_head_approved"
  | "finance_head_approved"
  | "accounts_head_approved"
  | "active"
  | "rejected"
  | "revision_required"
  | "closed";

export interface BudgetLineInput {
  id?: string;
  costCentreId?: string | null;
  processId?: string | null;
  head: string;
  subHead?: string | null;
  itemName: string;
  itemDescription?: string | null;
  quantity: number;
  unit: string;
  unitRate: number;
  taxTreatment: BudgetTaxTreatment;
  gstRate: number;
  gstType?: BudgetGstType;
  recoverableTaxPct?: number;
  preferredVendorId?: string | null;
  allocationDriver?: string | null;
  justification: string;
}

export interface SaveBudgetInput {
  id?: string;
  branchId: string;
  periodCode: string;
  financialYear: string;
  lines: BudgetLineInput[];
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function calculateBudgetLine(line: BudgetLineInput) {
  const quantity = Number(line.quantity || 0);
  const unitRate = Number(line.unitRate || 0);
  const gstRate = Number(line.gstRate || 0);
  const quoted = roundMoney(quantity * unitRate);
  let baseAmount = quoted;
  let taxAmount = 0;
  let grossAmount = quoted;

  if (line.taxTreatment === "inclusive" && gstRate > 0) {
    baseAmount = roundMoney(quoted / (1 + gstRate / 100));
    taxAmount = roundMoney(quoted - baseAmount);
  } else if (["exclusive", "reverse_charge"].includes(line.taxTreatment) && gstRate > 0) {
    taxAmount = roundMoney(quoted * gstRate / 100);
    grossAmount = roundMoney(quoted + taxAmount);
  }

  if (["exempt", "non_gst"].includes(line.taxTreatment)) {
    taxAmount = 0;
    grossAmount = baseAmount;
  }

  const gstType: BudgetGstType = taxAmount === 0 ? "none" : (line.gstType ?? "cgst_sgst");
  const recoverablePct = clamp(Number(line.recoverableTaxPct ?? 100), 0, 100);
  const recoverableTaxAmount = roundMoney(taxAmount * recoverablePct / 100);
  const pnlCostAmount = roundMoney(baseAmount + taxAmount - recoverableTaxAmount);
  const cgstAmount = gstType === "cgst_sgst" ? roundMoney(taxAmount / 2) : 0;
  const sgstAmount = gstType === "cgst_sgst" ? roundMoney(taxAmount - cgstAmount) : 0;
  const igstAmount = gstType === "igst" ? taxAmount : 0;

  return {
    baseAmount,
    taxAmount,
    grossAmount,
    recoverableTaxAmount,
    pnlCostAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    gstType,
    recoverablePct,
  };
}

function validateLine(line: BudgetLineInput, index: number) {
  if (!line.head?.trim()) throw new Error(`Budget line ${index + 1}: head is required`);
  if (!line.itemName?.trim()) throw new Error(`Budget line ${index + 1}: item/service is required`);
  if (!line.unit?.trim()) throw new Error(`Budget line ${index + 1}: unit is required`);
  if (!line.justification?.trim()) throw new Error(`Budget line ${index + 1}: justification is required`);
  if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) throw new Error(`Budget line ${index + 1}: quantity must be greater than zero`);
  if (!Number.isFinite(Number(line.unitRate)) || Number(line.unitRate) < 0) throw new Error(`Budget line ${index + 1}: unit rate cannot be negative`);
  if (!Number.isFinite(Number(line.gstRate)) || Number(line.gstRate) < 0 || Number(line.gstRate) > 100) throw new Error(`Budget line ${index + 1}: invalid GST rate`);
}

async function validateAttribution(connection: PoolConnection, branchId: string, line: BudgetLineInput) {
  let processId = line.processId?.trim() || null;
  const costCentreId = line.costCentreId?.trim() || null;

  if (costCentreId) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, process_id FROM cost_centre_master WHERE id = ? LIMIT 1`,
      [costCentreId]
    );
    if (!rows[0]) throw new Error("Selected cost centre was not found");
    const mappedProcessId = rows[0].process_id ? String(rows[0].process_id) : null;
    if (processId && mappedProcessId && processId !== mappedProcessId) {
      throw new Error("Selected cost centre is mapped to a different process");
    }
    processId = processId ?? mappedProcessId;
  }

  if (processId) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, branch_id FROM process_master WHERE id = ? LIMIT 1`,
      [processId]
    );
    if (!rows[0]) throw new Error("Selected process was not found");
    if (rows[0].branch_id && String(rows[0].branch_id) !== branchId) {
      throw new Error("Selected process belongs to a different branch");
    }
  }

  return { processId, costCentreId };
}

async function generateBudgetNumber(connection: PoolConnection, branchId: string, periodCode: string, id: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT branch_seq FROM branch_master WHERE id = ? LIMIT 1`,
    [branchId]
  );
  if (!rows[0]) throw new Error("Selected branch was not found");
  const branchSeq = Number(rows[0].branch_seq ?? 0);
  return `BUD/${branchSeq}/${periodCode.replace("-", "")}/${id.slice(0, 8).toUpperCase()}`;
}

async function audit(
  budgetId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string,
  actorId: string,
  actorRole: string,
  remarks?: string | null
) {
  await db.execute(
    `INSERT INTO finance_budget_approval_log
      (id, budget_id, action, from_status, to_status, actor_user_id, actor_role, remarks)
     VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(), budgetId, action, fromStatus, toStatus, actorId, actorRole, remarks ?? null]
  );
}

async function lockBudgetLine(connection: PoolConnection, lineId: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT l.*, h.status AS budget_status, h.branch_id, h.period_code
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE l.id = ?
      FOR UPDATE`,
    [lineId]
  );
  if (!rows[0]) throw new Error("Approved budget line not found");
  if (rows[0].budget_status !== "active") throw new Error("GRN can only use an active, fully approved budget");
  return rows[0];
}

export const branchBudgetService = {
  async list(filters: { period?: string; branchId?: string; status?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.period) { where.push("h.period_code = ?"); params.push(filters.period); }
    if (filters.branchId) { where.push("h.branch_id = ?"); params.push(filters.branchId); }
    if (filters.status) { where.push("h.status = ?"); params.push(filters.status); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT h.*, bm.branch_name,
              COUNT(l.id) AS line_count,
              COALESCE(SUM(l.reserved_amount),0) AS reserved_amount,
              COALESCE(SUM(l.consumed_amount),0) AS consumed_amount
       FROM finance_budget_header h
       LEFT JOIN branch_master bm ON bm.id = h.branch_id
       LEFT JOIN finance_budget_line l ON l.budget_id = h.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY h.id, bm.branch_name
       ORDER BY h.period_code DESC, h.created_at DESC`,
      params
    );
    return rows;
  },

  async get(id: string) {
    const [headers] = await db.execute<RowDataPacket[]>(
      `SELECT h.*, bm.branch_name
         FROM finance_budget_header h
         LEFT JOIN branch_master bm ON bm.id = h.branch_id
        WHERE h.id = ? LIMIT 1`,
      [id]
    );
    if (!headers[0]) throw new Error("Budget not found");
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT l.*, pm.process_name, ccm.cost_centre_name, vm.vendor_name AS preferred_vendor_name,
              (l.gross_amount-l.reserved_amount-l.consumed_amount) AS available_gross_amount
         FROM finance_budget_line l
         LEFT JOIN process_master pm ON pm.id = l.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = l.cost_centre_id
         LEFT JOIN vendor_master vm ON vm.id = l.preferred_vendor_id
        WHERE l.budget_id = ? ORDER BY l.created_at, l.id`,
      [id]
    );
    const [approvals] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM finance_budget_approval_log WHERE budget_id = ? ORDER BY created_at`,
      [id]
    );
    return { ...headers[0], lines, approvals };
  },

  async saveDraft(input: SaveBudgetInput, actorId: string) {
    if (!input.branchId || !/^\d{4}-\d{2}$/.test(input.periodCode) || !input.financialYear) {
      throw new Error("Branch, valid period and financial year are required");
    }
    if (!input.lines?.length) throw new Error("At least one detailed budget line is required");
    input.lines.forEach(validateLine);

    const id = input.id || randomUUID();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT status, branch_id FROM finance_budget_header WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (existing[0] && !["draft", "revision_required"].includes(String(existing[0].status))) {
        throw new Error(`Only draft or revision-required budgets can be edited. Current status: ${existing[0].status}`);
      }

      const calculated: Array<{ line: BudgetLineInput; values: ReturnType<typeof calculateBudgetLine>; attribution: { processId: string | null; costCentreId: string | null } }> = [];
      for (const line of input.lines) {
        calculated.push({ line, values: calculateBudgetLine(line), attribution: await validateAttribution(connection, input.branchId, line) });
      }
      const totals = calculated.reduce((acc, item) => ({
        base: roundMoney(acc.base + item.values.baseAmount),
        tax: roundMoney(acc.tax + item.values.taxAmount),
        gross: roundMoney(acc.gross + item.values.grossAmount),
        pnl: roundMoney(acc.pnl + item.values.pnlCostAmount),
      }), { base: 0, tax: 0, gross: 0, pnl: 0 });

      if (!existing[0]) {
        const number = await generateBudgetNumber(connection, input.branchId, input.periodCode, id);
        await connection.execute(
          `INSERT INTO finance_budget_header
           (id,budget_number,branch_id,period_code,financial_year,status,base_budget_amount,tax_budget_amount,gross_budget_amount,pnl_budget_amount,created_by)
           VALUES (?,?,?,?,?,'draft',?,?,?,?,?)`,
          [id, number, input.branchId, input.periodCode, input.financialYear, totals.base, totals.tax, totals.gross, totals.pnl, actorId]
        );
      } else {
        await connection.execute(
          `UPDATE finance_budget_header
              SET branch_id=?, period_code=?, financial_year=?, status='draft',
                  base_budget_amount=?, tax_budget_amount=?, gross_budget_amount=?, pnl_budget_amount=?,
                  rejection_reason=NULL, revision_no=revision_no+1
            WHERE id=?`,
          [input.branchId, input.periodCode, input.financialYear, totals.base, totals.tax, totals.gross, totals.pnl, id]
        );
        await connection.execute(`DELETE FROM finance_budget_line WHERE budget_id = ?`, [id]);
      }

      for (const item of calculated) {
        const l = item.line;
        const v = item.values;
        await connection.execute(
          `INSERT INTO finance_budget_line
           (id,budget_id,cost_centre_id,process_id,head,sub_head,item_name,item_description,quantity,unit,unit_rate,
            tax_treatment,gst_rate,gst_type,recoverable_tax_pct,cgst_amount,sgst_amount,igst_amount,base_amount,tax_amount,
            gross_amount,recoverable_tax_amount,pnl_cost_amount,preferred_vendor_id,allocation_driver,justification)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [l.id || randomUUID(), id, item.attribution.costCentreId, item.attribution.processId, l.head.trim(), l.subHead?.trim() || null,
           l.itemName.trim(), l.itemDescription?.trim() || null, Number(l.quantity), l.unit.trim(), Number(l.unitRate), l.taxTreatment,
           Number(l.gstRate), v.gstType, v.recoverablePct, v.cgstAmount, v.sgstAmount, v.igstAmount, v.baseAmount, v.taxAmount,
           v.grossAmount, v.recoverableTaxAmount, v.pnlCostAmount, l.preferredVendorId ?? null, l.allocationDriver ?? null, l.justification.trim()]
        );
      }
      await connection.commit();
      return this.get(id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async submit(id: string, actorId: string, actorRole: string) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT status FROM finance_budget_header WHERE id=? LIMIT 1`, [id]);
    if (!rows[0]) throw new Error("Budget not found");
    if (!["draft", "revision_required"].includes(String(rows[0].status))) throw new Error("Only draft budgets can be submitted");
    await db.execute(`UPDATE finance_budget_header SET status='submitted', submitted_by=?, submitted_at=NOW() WHERE id=?`, [actorId, id]);
    await audit(id, "SUBMIT", String(rows[0].status), "submitted", actorId, actorRole);
    return this.get(id);
  },

  async review(id: string, decision: "approve" | "reject" | "revision", actorId: string, actorRole: string, remarks?: string) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT status FROM finance_budget_header WHERE id=? LIMIT 1`, [id]);
    if (!rows[0]) throw new Error("Budget not found");
    const current = String(rows[0].status) as BudgetStatus;
    const role = actorRole.toLowerCase();
    const expected = role === "branch_head" ? "submitted" : role === "finance_head" ? "branch_head_approved" : role === "accounts_head" ? "finance_head_approved" : null;
    if (!expected || current !== expected) throw new Error(`Role ${actorRole} cannot review budget in status ${current}`);
    if (decision !== "approve" && !remarks?.trim()) throw new Error("Remarks are required for rejection or revision");

    let next: BudgetStatus;
    if (decision === "reject") next = "rejected";
    else if (decision === "revision") next = "revision_required";
    else next = role === "branch_head" ? "branch_head_approved" : role === "finance_head" ? "finance_head_approved" : "active";

    const approvalColumn = role === "branch_head" ? "branch_head_approved" : role === "finance_head" ? "finance_head_approved" : "accounts_head_approved";
    await db.execute(
      `UPDATE finance_budget_header SET status=?, ${approvalColumn}_by=?, ${approvalColumn}_at=NOW(), rejection_reason=? WHERE id=?`,
      [next, actorId, decision === "approve" ? null : remarks?.trim() ?? null, id]
    );
    await audit(id, decision.toUpperCase(), current, next, actorId, actorRole, remarks);
    return this.get(id);
  },

  async availableLines(filters: { branchId: string; processId?: string; costCentreId?: string; period?: string }) {
    if (!filters.branchId) throw new Error("Branch is required");
    const conditions = ["h.branch_id = ?", "h.status = 'active'"];
    const params: unknown[] = [filters.branchId];
    if (filters.period) { conditions.push("h.period_code = ?"); params.push(filters.period); }
    if (filters.processId) { conditions.push("(l.process_id = ? OR l.process_id IS NULL)"); params.push(filters.processId); }
    if (filters.costCentreId) { conditions.push("(l.cost_centre_id = ? OR l.cost_centre_id IS NULL)"); params.push(filters.costCentreId); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.*, h.budget_number, h.period_code, h.branch_id,
              pm.process_name, ccm.cost_centre_name, vm.vendor_name AS preferred_vendor_name,
              (l.gross_amount-l.reserved_amount-l.consumed_amount) AS available_gross_amount
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id=l.budget_id
         LEFT JOIN process_master pm ON pm.id=l.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id=l.cost_centre_id
         LEFT JOIN vendor_master vm ON vm.id=l.preferred_vendor_id
        WHERE ${conditions.join(" AND ")}
        HAVING available_gross_amount > 0
        ORDER BY l.head,l.sub_head,l.item_name`,
      params
    );
    return rows;
  },

  async getLineForGrn(lineId: string, branchId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.*, h.status AS budget_status, h.branch_id, h.period_code,
              (l.gross_amount-l.reserved_amount-l.consumed_amount) AS available_gross_amount
         FROM finance_budget_line l
         JOIN finance_budget_header h ON h.id=l.budget_id
        WHERE l.id=? AND h.branch_id=? AND h.status='active'
        LIMIT 1`,
      [lineId, branchId]
    );
    if (!rows[0]) throw new Error("The selected approved budget line is unavailable for this branch");
    return rows[0];
  },

  async reserveLine(connection: PoolConnection, lineId: string, amount: number) {
    const line = await lockBudgetLine(connection, lineId);
    const available = roundMoney(Number(line.gross_amount) - Number(line.reserved_amount) - Number(line.consumed_amount));
    if (roundMoney(amount) > available) throw new Error(`GRN exceeds available budget by ${roundMoney(amount - available).toFixed(2)}`);
    await connection.execute(`UPDATE finance_budget_line SET reserved_amount=reserved_amount+? WHERE id=?`, [roundMoney(amount), lineId]);
  },

  async consumeLine(connection: PoolConnection, lineId: string, amount: number) {
    const line = await lockBudgetLine(connection, lineId);
    const reserved = Number(line.reserved_amount);
    if (reserved + 0.01 < amount) throw new Error("Reserved budget is lower than the GRN amount");
    await connection.execute(
      `UPDATE finance_budget_line SET reserved_amount=GREATEST(0,reserved_amount-?), consumed_amount=consumed_amount+? WHERE id=?`,
      [roundMoney(amount), roundMoney(amount), lineId]
    );
  },

  async releaseLine(connection: PoolConnection, lineId: string, amount: number) {
    await lockBudgetLine(connection, lineId);
    await connection.execute(
      `UPDATE finance_budget_line SET reserved_amount=GREATEST(0,reserved_amount-?) WHERE id=?`,
      [roundMoney(amount), lineId]
    );
  },
};
'''

GRN_SERVICE = r'''import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { branchBudgetService, calculateBudgetLine, type BudgetTaxTreatment, type BudgetGstType } from "../process-pnl/branch-budget.service.js";
import { vendorPaymentService } from "./vendor-payment.service.js";

export type GrnType = "vendor" | "imprest";
export type GrnStatus = "draft" | "submitted" | "branch_head_approved" | "finance_head_approved" | "pending_accounts_payment" | "payment_scheduled" | "partially_paid" | "paid" | "approved" | "rejected" | "cancelled";

export interface CreateGrnPayload {
  grnType: GrnType;
  branchId: string;
  budgetLineId: string;
  processId?: string;
  costCentreId?: string;
  vendorId?: string;
  vendorName?: string;
  quantity: number;
  unitRate?: number;
  billDate?: string;
  paymentTermsDays?: number;
  remarks?: string;
  financialYear?: string;
}

export interface SubmitGrnPayload { remarks?: string; }
export interface ReviewGrnPayload { decision: "approved" | "rejected"; reviewNote?: string; }

async function generateGrnNumber(branchId: string, financialYear: string): Promise<string> {
  const [branchRows] = await db.execute<RowDataPacket[]>(`SELECT branch_seq FROM branch_master WHERE id = ? LIMIT 1`, [branchId]);
  if (!branchRows[0]) throw new Error("Selected branch was not found");
  const branchSeq = Number(branchRows[0].branch_seq ?? 0);
  const yy = financialYear.slice(2, 4);
  const [seqRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM grn_request WHERE branch_id = ? AND financial_year = ?`,
    [branchId, financialYear]
  );
  return `Mas/${branchSeq}/${yy}/${Number(seqRows[0]?.cnt ?? 0) + 1}`;
}

async function writeGrnAudit(action: string, grnId: string, actorId: string, actorRole: string, changes: Record<string, unknown>) {
  await logSensitiveAction({
    actor_user_id: actorId,
    actor_role: actorRole,
    action_type: `GRN_${action}`,
    module_key: "FINANCE",
    entity_type: "grn_request",
    entity_id: grnId,
    change_summary: changes,
  });
}

export const grnService = {
  async createDraft(payload: CreateGrnPayload, actorUserId: string, actorRole: string) {
    if (!payload.branchId) throw new Error("Branch is required");
    if (!payload.budgetLineId) throw new Error("An approved budget line is required");
    if (!Number.isFinite(Number(payload.quantity)) || Number(payload.quantity) <= 0) throw new Error("Quantity must be greater than zero");
    if (payload.grnType === "vendor" && !payload.vendorId && !payload.vendorName?.trim()) throw new Error("Vendor is required for vendor GRN");

    const budgetLine = await branchBudgetService.getLineForGrn(payload.budgetLineId, payload.branchId) as any;
    const quantity = Number(payload.quantity);
    const unitRate = payload.unitRate == null ? Number(budgetLine.unit_rate) : Number(payload.unitRate);
    if (!Number.isFinite(unitRate) || unitRate < 0) throw new Error("Unit rate cannot be negative");
    if (unitRate > Number(budgetLine.unit_rate) + 0.0001) throw new Error("GRN unit rate exceeds the approved budget rate");

    const values = calculateBudgetLine({
      head: String(budgetLine.head),
      subHead: budgetLine.sub_head,
      itemName: String(budgetLine.item_name),
      quantity,
      unit: String(budgetLine.unit),
      unitRate,
      taxTreatment: String(budgetLine.tax_treatment) as BudgetTaxTreatment,
      gstRate: Number(budgetLine.gst_rate),
      gstType: String(budgetLine.gst_type) as BudgetGstType,
      recoverableTaxPct: Number(budgetLine.recoverable_tax_pct),
      justification: String(budgetLine.justification || "Approved budget line"),
    });
    if (values.grossAmount > Number(budgetLine.available_gross_amount) + 0.01) throw new Error("GRN amount exceeds the available approved budget");

    const id = randomUUID();
    const fy = payload.financialYear ?? getCurrentFinancialYear();
    const grnNumber = await generateGrnNumber(payload.branchId, fy);
    const dueDate = payload.billDate && payload.paymentTermsDays != null ? addDays(payload.billDate, payload.paymentTermsDays) : null;
    const costClass: "direct" | "indirect" = budgetLine.process_id ? "direct" : "indirect";

    await db.execute(
      `INSERT INTO grn_request
       (id,grn_number,grn_type,branch_id,process_id,cost_centre_id,cost_class,vendor_id,vendor_name,head,sub_head,
        quantity,unit,unit_rate,tax_treatment,gst_rate,gst_type,recoverable_tax_pct,amount_without_tax,tax_amount,amount_with_tax,pnl_cost_amount,amount,
        bill_date,payment_terms_days,due_date,description,remarks,status,financial_year,budget_id,budget_line_id,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft',?,?,?,?,NOW())`,
      [id, grnNumber, payload.grnType, payload.branchId, budgetLine.process_id ?? null, budgetLine.cost_centre_id ?? null, costClass,
       payload.vendorId ?? budgetLine.preferred_vendor_id ?? null, payload.vendorName?.trim() || budgetLine.preferred_vendor_name || null,
       budgetLine.head, budgetLine.sub_head ?? "", quantity, budgetLine.unit, unitRate, budgetLine.tax_treatment, budgetLine.gst_rate,
       budgetLine.gst_type, budgetLine.recoverable_tax_pct, values.baseAmount, values.taxAmount, values.grossAmount, values.pnlCostAmount,
       values.grossAmount, payload.billDate ?? null, payload.paymentTermsDays ?? 0, dueDate, budgetLine.item_name,
       payload.remarks?.trim() || null, fy, budgetLine.budget_id, budgetLine.id, actorUserId]
    );

    await writeGrnAudit("CREATE_DRAFT", id, actorUserId, actorRole, {
      grn_number: grnNumber,
      budget_id: budgetLine.budget_id,
      budget_line_id: budgetLine.id,
      amount_without_tax: values.baseAmount,
      tax_amount: values.taxAmount,
      amount_with_tax: values.grossAmount,
    });
    return { id, grnNumber };
  },

  async submitForApproval(grnId: string, payload: SubmitGrnPayload, actorUserId: string, actorRole: string) {
    const grn = await getGrnOrThrow(grnId);
    if (grn.status !== "draft") throw new Error(`GRN is already ${grn.status}, cannot submit`);
    if (!grn.budget_line_id) throw new Error("GRN is not linked to an approved budget line");
    if (!grn.attachment_path && !grn.attachment_file_path) throw new Error("Invoice / supporting attachment is required before submission");
    await db.execute(
      `UPDATE grn_request SET status='submitted', submitted_by=?, submitted_at=NOW(), remarks=COALESCE(?,remarks) WHERE id=?`,
      [actorUserId, payload.remarks ?? null, grnId]
    );
    await writeGrnAudit("SUBMIT", grnId, actorUserId, actorRole, { remarks: payload.remarks });
    return { success: true, newStatus: "submitted" };
  },

  async reviewGrn(grnId: string, payload: ReviewGrnPayload, actorUserId: string, actorRole: string) {
    const role = actorRole.toLowerCase();
    const connection = await db.getConnection();
    let paymentId: string | null = null;
    let newStatus: GrnStatus;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM grn_request WHERE id=? FOR UPDATE`, [grnId]);
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");

      const effectiveStage = role === "super_admin"
        ? (grn.status === "submitted" ? "branch_head" : grn.status === "branch_head_approved" ? "finance_head" : null)
        : role;
      if (effectiveStage === "branch_head") {
        if (grn.status !== "submitted") throw new Error(`Branch Head can only review submitted GRNs. Current status: ${grn.status}`);
        if (payload.decision === "approved") {
          await branchBudgetService.reserveLine(connection, grn.budget_line_id, Number(grn.amount_with_tax || grn.amount));
          newStatus = "branch_head_approved";
        } else {
          newStatus = "rejected";
        }
        await connection.execute(
          `UPDATE grn_request SET status=?, branch_head_reviewed_by=?, branch_head_reviewed_at=NOW(), branch_head_review_note=?, reviewed_by=?, reviewed_at=NOW(), review_note=? WHERE id=?`,
          [newStatus, actorUserId, payload.reviewNote ?? null, actorUserId, payload.reviewNote ?? null, grnId]
        );
      } else if (effectiveStage === "finance_head") {
        if (grn.status !== "branch_head_approved") throw new Error(`Finance Head can only review Branch Head-approved GRNs. Current status: ${grn.status}`);
        if (payload.decision === "approved") {
          await branchBudgetService.consumeLine(connection, grn.budget_line_id, Number(grn.amount_with_tax || grn.amount));
          newStatus = grn.grn_type === "vendor" ? "pending_accounts_payment" : "approved";
          await connection.execute(
            `UPDATE grn_request SET status=?, accounts_payment_status=?, finance_head_reviewed_by=?, finance_head_reviewed_at=NOW(), finance_head_review_note=?, reviewed_by=?, reviewed_at=NOW(), review_note=?, approved_by=?, approved_at=NOW() WHERE id=?`,
            [newStatus, grn.grn_type === "vendor" ? "pending" : "not_required", actorUserId, payload.reviewNote ?? null,
             actorUserId, payload.reviewNote ?? null, actorUserId, grnId]
          );
          if (grn.grn_type === "vendor") paymentId = await vendorPaymentService.createFromGrn(grnId, actorUserId, connection);
        } else {
          await branchBudgetService.releaseLine(connection, grn.budget_line_id, Number(grn.amount_with_tax || grn.amount));
          newStatus = "rejected";
          await connection.execute(
            `UPDATE grn_request SET status='rejected', finance_head_reviewed_by=?, finance_head_reviewed_at=NOW(), finance_head_review_note=?, reviewed_by=?, reviewed_at=NOW(), review_note=? WHERE id=?`,
            [actorUserId, payload.reviewNote ?? null, actorUserId, payload.reviewNote ?? null, grnId]
          );
        }
      } else {
        throw new Error(`Role ${actorRole} is not permitted to review GRNs`);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeGrnAudit(payload.decision.toUpperCase(), grnId, actorUserId, actorRole, { review_note: payload.reviewNote, new_status: newStatus! });
    if (paymentId) await vendorPaymentService.notifyPaymentPending(paymentId).catch(() => undefined);
    return { success: true, newStatus: newStatus!, paymentId };
  },

  async cancelGrn(grnId: string, actorUserId: string, actorRole: string) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM grn_request WHERE id=? FOR UPDATE`, [grnId]);
      const grn = rows[0] as any;
      if (!grn) throw new Error("GRN not found");
      if (["finance_head_approved", "pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "approved", "cancelled"].includes(grn.status)) {
        throw new Error(`Cannot cancel a GRN with status '${grn.status}'`);
      }
      if (grn.status === "branch_head_approved" && grn.budget_line_id) {
        await branchBudgetService.releaseLine(connection, grn.budget_line_id, Number(grn.amount_with_tax || grn.amount));
      }
      await connection.execute(`UPDATE grn_request SET status='cancelled', reviewed_by=?, reviewed_at=NOW() WHERE id=?`, [actorUserId, grnId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeGrnAudit("CANCEL", grnId, actorUserId, actorRole, {});
    return { success: true };
  },

  async listGrns(filters: { branchId?: string; processId?: string; costCentreId?: string; costClass?: string; status?: string; financialYear?: string; grnType?: string; search?: string; page?: number; limit?: number }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.branchId) { conditions.push("g.branch_id = ?"); params.push(filters.branchId); }
    if (filters.processId) { conditions.push("g.process_id = ?"); params.push(filters.processId); }
    if (filters.costCentreId) { conditions.push("g.cost_centre_id = ?"); params.push(filters.costCentreId); }
    if (filters.costClass) { conditions.push("g.cost_class = ?"); params.push(filters.costClass); }
    if (filters.status) { conditions.push("g.status = ?"); params.push(filters.status); }
    if (filters.financialYear) { conditions.push("g.financial_year = ?"); params.push(filters.financialYear); }
    if (filters.grnType) { conditions.push("g.grn_type = ?"); params.push(filters.grnType); }
    if (filters.search) {
      conditions.push("(g.grn_number LIKE ? OR g.vendor_name LIKE ? OR g.head LIKE ? OR g.description LIKE ?)");
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
    const offset = (page - 1) * limit;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*, bm.branch_name, pm.process_name, ccm.cost_centre_name,
              h.budget_number, l.item_name AS budget_item_name,
              CONCAT(cb.first_name,' ',cb.last_name) AS created_by_name,
              CONCAT(rb.first_name,' ',rb.last_name) AS reviewed_by_name
         FROM grn_request g
         LEFT JOIN branch_master bm ON bm.id=g.branch_id
         LEFT JOIN process_master pm ON pm.id=g.process_id
         LEFT JOIN cost_centre_master ccm ON ccm.id=g.cost_centre_id
         LEFT JOIN finance_budget_header h ON h.id=g.budget_id
         LEFT JOIN finance_budget_line l ON l.id=g.budget_line_id
         LEFT JOIN auth_user cb ON cb.id=g.created_by
         LEFT JOIN auth_user rb ON rb.id=g.reviewed_by
         ${where}
        ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM grn_request g ${where}`, params);
    return { data: rows, total: Number(countRows[0]?.total ?? 0), page, limit };
  },

  async getGrn(grnId: string) { return getGrnOrThrow(grnId); },

  async saveAttachment(grnId: string, filePath: string, originalName: string, actorUserId: string) {
    await db.execute(`UPDATE grn_request SET attachment_path=?, attachment_original_name=? WHERE id=?`, [filePath, originalName, grnId]);
    await logSensitiveAction({ actor_user_id: actorUserId, action_type: "GRN_ATTACHMENT_SAVED", module_key: "finance", entity_type: "grn_request", entity_id: grnId, change_summary: { filePath } });
  },
};

async function getGrnOrThrow(grnId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM grn_request WHERE id=? LIMIT 1`, [grnId]);
  if (!rows[0]) throw new Error("GRN not found");
  return rows[0] as any;
}

function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() + 1 >= 4 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
'''

BUDGET_LINKED_GRN_FORM = r'''import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, FilePlus, IndianRupee, Loader2, Save, Send, Upload, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { calculateBudgetLine } from "@/hooks/useBranchBudget";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function currentPeriod() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`; }
function currentFy() { const now = new Date(); const y=now.getFullYear(); return now.getMonth()+1>=4?`${y}-${String(y+1).slice(2)}`:`${y-1}-${String(y).slice(2)}`; }
function money(value: number) { return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(value||0); }

export function BudgetLinkedGrnForm() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form,setForm]=useState({grnType:"vendor",branchId:"",budgetLineId:"",vendorId:"",vendorName:"",quantity:1,unitRate:0,billDate:"",paymentTermsDays:30,remarks:"",financialYear:currentFy()});
  const [file,setFile]=useState<File|null>(null);
  const [created,setCreated]=useState<{id:string;grnNumber:string}|null>(null);
  const period=form.billDate?form.billDate.slice(0,7):currentPeriod();

  const {data:branchResponse}=useQuery({queryKey:["grn-budget-branches"],queryFn:()=>hrmsApi.get<any>("/api/org/branches?limit=200")});
  const {data:vendorResponse}=useQuery({queryKey:["grn-budget-vendors"],queryFn:()=>hrmsApi.get<any>("/api/erp/vendors?limit=500")});
  const branches:any[]=branchResponse?.data??branchResponse??[];
  const vendors:any[]=vendorResponse?.data??vendorResponse??[];
  const {data:lineResponse,isLoading:linesLoading}=useQuery({
    queryKey:["available-budget-lines",form.branchId,period],
    enabled:Boolean(form.branchId),
    queryFn:()=>hrmsApi.get<any>(`/api/finance/pnl/budget-lines/available?branchId=${encodeURIComponent(form.branchId)}&period=${encodeURIComponent(period)}`),
  });
  const budgetLines:any[]=lineResponse?.data??lineResponse??[];
  const selected=budgetLines.find((line)=>line.id===form.budgetLineId);
  const calc=useMemo(()=>selected?calculateBudgetLine({head:selected.head,itemName:selected.item_name,quantity:Number(form.quantity),unit:selected.unit,unitRate:Number(form.unitRate),taxTreatment:selected.tax_treatment,gstRate:Number(selected.gst_rate),gstType:selected.gst_type,recoverableTaxPct:Number(selected.recoverable_tax_pct),justification:selected.justification}):null,[selected,form.quantity,form.unitRate]);

  const saveMutation=useMutation({
    mutationFn:async(submit:boolean)=>{
      if(!form.branchId) throw new Error("Select branch");
      if(!selected) throw new Error("Select an approved budget line");
      if(!file) throw new Error("Invoice / supporting attachment is mandatory");
      if(form.grnType==="vendor"&&!form.vendorId&&!form.vendorName.trim()) throw new Error("Select or enter vendor");
      const result=await hrmsApi.post<{id:string;grnNumber:string}>("/api/finance/grns",{
        grnType:form.grnType,branchId:form.branchId,budgetLineId:selected.id,processId:selected.process_id??undefined,costCentreId:selected.cost_centre_id??undefined,
        vendorId:form.vendorId||undefined,vendorName:form.vendorName||undefined,quantity:Number(form.quantity),unitRate:Number(form.unitRate),
        billDate:form.billDate||undefined,paymentTermsDays:Number(form.paymentTermsDays),remarks:form.remarks||undefined,financialYear:form.financialYear,
      });
      const fd=new FormData(); fd.append("file",file); await hrmsApi.postForm(`/api/finance/grns/${result.id}/attachment`,fd);
      if(submit) await hrmsApi.post(`/api/finance/grns/${result.id}/submit`,{});
      return result;
    },
    onSuccess:(result,submit)=>{setCreated(result);toast({title:submit?"GRN submitted to Branch Head":"GRN draft saved",description:result.grnNumber});setFile(null);void qc.invalidateQueries({queryKey:["grn-list"]});void qc.invalidateQueries({queryKey:["available-budget-lines"]});},
    onError:(error:Error)=>toast({title:"GRN could not be saved",description:error.message,variant:"destructive"}),
  });

  return <div className="mx-auto max-w-5xl space-y-5">
    {created&&<div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="h-5 w-5 text-emerald-600"/><div><p className="font-semibold text-emerald-900">{created.grnNumber}</p><p className="text-xs text-emerald-700">Budget-linked GRN saved successfully.</p></div></div>}
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100"><CardTitle className="flex items-center gap-2 text-base"><FilePlus className="h-4 w-4 text-[#073f78]"/>Create GRN against approved budget</CardTitle></CardHeader>
      <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2"><Label>GRN type *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.grnType} onChange={e=>setForm(v=>({...v,grnType:e.target.value}))}><option value="vendor">Vendor GRN</option><option value="imprest">Imprest GRN</option></select></div>
        <div className="space-y-2"><Label>Branch *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.branchId} onChange={e=>setForm(v=>({...v,branchId:e.target.value,budgetLineId:""}))}><option value="">Select branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.branch_name??b.name}</option>)}</select></div>
        <div className="space-y-2"><Label>Bill date</Label><Input type="date" value={form.billDate} onChange={e=>setForm(v=>({...v,billDate:e.target.value,budgetLineId:""}))}/></div>
        <div className="space-y-2"><Label>Financial year</Label><Input value={form.financialYear} onChange={e=>setForm(v=>({...v,financialYear:e.target.value}))}/></div>
        <div className="space-y-2 md:col-span-2 xl:col-span-4"><div className="flex items-center justify-between"><Label>Approved budget line *</Label><Button asChild variant="link" size="sm" className="h-auto p-0"><Link to="/finance/branch-budget">Open branch budget</Link></Button></div><select className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={!form.branchId||linesLoading} value={form.budgetLineId} onChange={e=>{const line=budgetLines.find(x=>x.id===e.target.value);setForm(v=>({...v,budgetLineId:e.target.value,unitRate:Number(line?.unit_rate??0),vendorId:line?.preferred_vendor_id??v.vendorId,vendorName:line?.preferred_vendor_name??v.vendorName}))}}><option value="">{linesLoading?"Loading approved lines…":"Select approved budget line"}</option>{budgetLines.map(line=><option key={line.id} value={line.id}>{line.budget_number} · {line.head} / {line.sub_head||"General"} · {line.item_name} · Available {money(Number(line.available_gross_amount))}</option>)}</select></div>
        {form.branchId&&!linesLoading&&!budgetLines.length&&<div className="md:col-span-2 xl:col-span-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertCircle className="mt-0.5 h-4 w-4"/>No active approved budget line is available for {period}. Complete Branch Head, Finance Head and Accounts Head approval first.</div>}
        {selected&&<>
          <div className="space-y-2 xl:col-span-2"><Label>Budget item</Label><Input value={`${selected.head} / ${selected.sub_head||"General"} — ${selected.item_name}`} readOnly/></div>
          <div className="space-y-2"><Label>Cost centre</Label><Input value={selected.cost_centre_name??"Branch/common"} readOnly/></div>
          <div className="space-y-2"><Label>Process</Label><Input value={selected.process_name??"Shared/all processes"} readOnly/></div>
          <div className="space-y-2"><Label>Quantity *</Label><Input type="number" min="0.0001" step="0.01" value={form.quantity} onChange={e=>setForm(v=>({...v,quantity:Number(e.target.value)}))}/></div>
          <div className="space-y-2"><Label>Unit</Label><Input value={selected.unit} readOnly/></div>
          <div className="space-y-2"><Label>Unit rate *</Label><Input type="number" min="0" step="0.01" max={Number(selected.unit_rate)} value={form.unitRate} onChange={e=>setForm(v=>({...v,unitRate:Number(e.target.value)}))}/><p className="text-[11px] text-slate-500">Approved maximum: {money(Number(selected.unit_rate))}</p></div>
          <div className="space-y-2"><Label>Tax</Label><Input value={`${String(selected.tax_treatment).replaceAll("_"," ")} · ${Number(selected.gst_rate)}% · ${String(selected.gst_type).replaceAll("_"," + ")}`} readOnly/></div>
        </>}
        {form.grnType==="vendor"&&<><div className="space-y-2 xl:col-span-2"><Label>Vendor *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.vendorId} onChange={e=>{const vendor=vendors.find(v=>v.id===e.target.value);setForm(v=>({...v,vendorId:e.target.value,vendorName:vendor?.vendor_name??vendor?.name??""}))}}><option value="">Select vendor</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_name??v.name}</option>)}</select></div><div className="space-y-2 xl:col-span-2"><Label>Vendor name / fallback</Label><Input value={form.vendorName} onChange={e=>setForm(v=>({...v,vendorName:e.target.value}))}/></div></>}
        <div className="space-y-2"><Label>Payment terms</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.paymentTermsDays} onChange={e=>setForm(v=>({...v,paymentTermsDays:Number(e.target.value)}))}>{[0,7,15,30,45,60,90].map(d=><option key={d} value={d}>{d===0?"Immediate":`${d} days`}</option>)}</select></div>
        <div className="space-y-2 md:col-span-1 xl:col-span-3"><Label>Invoice / supporting proof *</Label><label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-600"><Upload className="h-4 w-4"/><span className="truncate">{file?.name??"Upload PDF or image"}</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e=>setFile(e.target.files?.[0]??null)}/>{file&&<X className="ml-auto h-4 w-4"/>}</label></div>
        <div className="space-y-2 md:col-span-2 xl:col-span-4"><Label>Remarks</Label><Textarea value={form.remarks} onChange={e=>setForm(v=>({...v,remarks:e.target.value}))} placeholder="Purpose, receipt details and any exception note"/></div>
        {calc&&<div className="md:col-span-2 xl:col-span-4 grid gap-3 sm:grid-cols-4">{[["Without tax",calc.base],["Tax",calc.tax],["With tax",calc.gross],["P&L cost",calc.pnlCost]].map(([label,value])=><div key={String(label)} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 flex items-center font-bold text-slate-900"><IndianRupee className="h-3.5 w-3.5"/>{Number(value).toLocaleString("en-IN",{maximumFractionDigits:2})}</p></div>)}</div>}
      </CardContent>
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-slate-50/60 p-5"><Button variant="outline" onClick={()=>saveMutation.mutate(false)} disabled={saveMutation.isPending}><Save className="mr-2 h-4 w-4"/>Save draft</Button><Button className="bg-[#073f78] hover:bg-[#052d57]" onClick={()=>saveMutation.mutate(true)} disabled={saveMutation.isPending}>{saveMutation.isPending?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Send className="mr-2 h-4 w-4"/>}Save & submit</Button></div>
    </Card>
  </div>;
}
'''

BRANCH_BUDGET_PAGE = r'''import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, CheckCircle2, IndianRupee, Plus, Save, Send, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { calculateBudgetLine, type BranchBudgetLineInput, useBranchBudgets } from "@/hooks/useBranchBudget";
import { hrmsApi } from "@/lib/hrmsApi";

const HEADS=["Business Promotion Expenses","Communication & Connectivity","Contract Fees Facilities","CONTRACT FEES","Donation-Charitable Trust","Electricity","Fee & Subscription","Hiring Charges","Insurance Expenses","Legal/Consultancy Charges","Office Rent","Office Maintenance A/c","Printing & Stationery Expenses","Repairs & Maintenance","Security Service Charges","Spot/Floor/Field Incentive","Staff Welfare","Staff Training & Recruitment","Tours, Travelling & Conveyance","Tour Expenses"];
const UNITS=["Nos","Seat","User","Month","Candidate","Service","Sq. Ft.","Connection","Device","Litre","Unit"];
const GST_RATES=[0,5,12,18,28];
function periodNow(){const n=new Date();return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`}
function fyFromPeriod(p:string){const[y,m]=p.split("-").map(Number);return m>=4?`${y}-${String(y+1).slice(-2)}`:`${y-1}-${String(y).slice(-2)}`}
function money(v:number){return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(v||0)}
function blankLine():BranchBudgetLineInput{return{head:"",subHead:"",itemName:"",quantity:1,unit:"Nos",unitRate:0,taxTreatment:"exclusive",gstRate:18,gstType:"cgst_sgst",recoverableTaxPct:100,allocationDriver:"agent_headcount",justification:""}}

export default function BranchBudgetManagementPage(){
 const[period,setPeriod]=useState(periodNow());const[branchId,setBranchId]=useState("");const[lines,setLines]=useState<BranchBudgetLineInput[]>([blankLine()]);const[savedBudgetId,setSavedBudgetId]=useState<string|null>(null);const[remarks,setRemarks]=useState("");
 const{budgetsQuery,saveBudget,submitBudget,reviewBudget}=useBranchBudgets({period,branchId:branchId||undefined});
 const{data:branchResponse}=useQuery({queryKey:["budget-branches"],queryFn:()=>hrmsApi.get<any>("/api/org/branches?limit=200")});
 const{data:processResponse}=useQuery({queryKey:["budget-processes"],queryFn:()=>hrmsApi.get<any>("/api/org/processes?limit=500")});
 const{data:costCentreResponse}=useQuery({queryKey:["budget-cost-centres"],queryFn:()=>hrmsApi.get<any>("/api/org/cost-centres?limit=500")});
 const{data:vendorResponse}=useQuery({queryKey:["budget-vendors"],queryFn:()=>hrmsApi.get<any>("/api/erp/vendors?limit=500")});
 const branches:any[]=branchResponse?.data??branchResponse??[];const processes:any[]=(processResponse?.data??processResponse??[]).filter((x:any)=>!branchId||x.branch_id===branchId);const costCentres:any[]=(costCentreResponse?.data??costCentreResponse??[]).filter((x:any)=>!branchId||x.branch_id===branchId);const vendors:any[]=vendorResponse?.data??vendorResponse??[];
 const totals=useMemo(()=>lines.reduce((a,l)=>{const v=calculateBudgetLine(l);a.base+=v.base;a.tax+=v.tax;a.gross+=v.gross;a.pnl+=v.pnlCost;return a},{base:0,tax:0,gross:0,pnl:0}),[lines]);
 const updateLine=(i:number,p:Partial<BranchBudgetLineInput>)=>setLines(c=>c.map((l,n)=>n===i?{...l,...p}:l));
 async function save(submit=false){try{if(!branchId)throw new Error("Select branch");lines.forEach((l,i)=>{if(!l.head||!l.itemName||!l.unit||!l.justification)throw new Error(`Complete mandatory details in line ${i+1}`)});const result:any=await saveBudget.mutateAsync({id:savedBudgetId||undefined,branchId,periodCode:period,financialYear:fyFromPeriod(period),lines});const id=result?.id??result?.data?.id??savedBudgetId;if(id)setSavedBudgetId(id);if(submit&&id)await submitBudget.mutateAsync(id);toast.success(submit?"Budget submitted to Branch Head":"Budget draft saved")}catch(e){toast.error(e instanceof Error?e.message:"Budget could not be saved")}}
 async function review(id:string,decision:"approve"|"reject"|"revision"){try{await reviewBudget.mutateAsync({id,decision,remarks:remarks||undefined});toast.success(decision==="approve"?"Budget advanced to the next approval stage":"Budget decision recorded");setRemarks("")}catch(e){toast.error(e instanceof Error?e.message:"Budget review failed")}}
 return <DashboardLayout><div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_26%),linear-gradient(180deg,_#f8fafc_0%,_#ffffff_44%,_#f5f7fb_100%)]"><div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
 <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"><div className="grid gap-8 p-6 lg:grid-cols-[1.5fr_0.8fr] lg:p-8"><div className="space-y-4"><div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200"><ShieldCheck className="h-3.5 w-3.5"/>Branch Budget Control</div><div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Approve every cost at line-item depth before GRN consumption.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">Branch → cost centre → process attribution, quantity, rate, GST recoverability and approval governance are captured together.</p></div><div className="flex flex-wrap gap-3"><Button onClick={()=>void save(false)} disabled={saveBudget.isPending}><Save className="mr-2 h-4 w-4"/>Save draft</Button><Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={()=>void save(true)}><Send className="mr-2 h-4 w-4"/>Submit to Branch Head</Button><Button asChild variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10"><Link to="/finance/grn">Open GRN Management</Link></Button></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">{[["Without tax",totals.base],["Tax budget",totals.tax],["With tax",totals.gross],["P&L cost",totals.pnl]].map(([l,v])=><Card key={String(l)} className="border-white/10 bg-white/5 text-white shadow-none"><CardContent className="p-4"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">{l}</p><p className="mt-2 text-2xl font-black">{money(Number(v))}</p></CardContent></Card>)}</div></div></section>
 <Tabs defaultValue="create" className="space-y-5"><TabsList className="h-auto flex-wrap rounded-2xl bg-white p-1 shadow-sm"><TabsTrigger value="create">Create budget</TabsTrigger><TabsTrigger value="queue">Approval queue</TabsTrigger></TabsList>
 <TabsContent value="create" className="space-y-5"><Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="grid gap-4 p-5 md:grid-cols-3"><div className="space-y-2"><Label>Period</Label><Input type="month" value={period} onChange={e=>{setPeriod(e.target.value);setSavedBudgetId(null)}}/></div><div className="space-y-2"><Label>Branch</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={branchId} onChange={e=>{setBranchId(e.target.value);setSavedBudgetId(null)}}><option value="">Select branch</option>{branches.map((b:any)=><option key={b.id} value={b.id}>{b.branch_name??b.name}</option>)}</select></div><div className="space-y-2"><Label>Financial year</Label><Input value={fyFromPeriod(period)} readOnly/></div></CardContent></Card>
 <div className="space-y-4">{lines.map((line,index)=>{const calc=calculateBudgetLine(line);return <Card key={index} className="rounded-3xl border-slate-200 shadow-sm"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Budget line {index+1}</CardTitle><Button variant="ghost" size="icon" onClick={()=>setLines(c=>c.length===1?c:c.filter((_,i)=>i!==index))}><Trash2 className="h-4 w-4 text-rose-500"/></Button></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
 <div className="space-y-2"><Label>Cost centre</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.costCentreId??""} onChange={e=>updateLine(index,{costCentreId:e.target.value||null})}><option value="">Branch/common</option>{costCentres.map((x:any)=><option key={x.id} value={x.id}>{x.cost_centre_name??x.name}</option>)}</select></div><div className="space-y-2"><Label>Process</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.processId??""} onChange={e=>updateLine(index,{processId:e.target.value||null})}><option value="">Shared/all processes</option>{processes.map((x:any)=><option key={x.id} value={x.id}>{x.process_name??x.name}</option>)}</select></div><div className="space-y-2"><Label>Head *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.head} onChange={e=>updateLine(index,{head:e.target.value,subHead:""})}><option value="">Select head</option>{HEADS.map(h=><option key={h}>{h}</option>)}</select></div><div className="space-y-2"><Label>Sub-head</Label><Input value={line.subHead??""} onChange={e=>updateLine(index,{subHead:e.target.value})}/></div>
 <div className="space-y-2 xl:col-span-2"><Label>Item / service *</Label><Input value={line.itemName} onChange={e=>updateLine(index,{itemName:e.target.value})}/></div><div className="space-y-2"><Label>Preferred vendor</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.preferredVendorId??""} onChange={e=>updateLine(index,{preferredVendorId:e.target.value||null})}><option value="">Not fixed</option>{vendors.map((v:any)=><option key={v.id} value={v.id}>{v.vendor_name??v.name}</option>)}</select></div><div className="space-y-2"><Label>Allocation driver</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.allocationDriver??""} onChange={e=>updateLine(index,{allocationDriver:e.target.value})}>{[["agent_headcount","Agent headcount"],["total_manpower","Total manpower"],["revenue_share","Revenue share"],["seat_count","Seat count"],["device_count","Device count"],["floor_area","Floor area"],["direct_tagging","Direct tagging"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
 <div className="space-y-2"><Label>Quantity *</Label><Input type="number" min="0.0001" step="0.01" value={line.quantity} onChange={e=>updateLine(index,{quantity:Number(e.target.value)})}/></div><div className="space-y-2"><Label>Unit *</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.unit} onChange={e=>updateLine(index,{unit:e.target.value})}>{UNITS.map(u=><option key={u}>{u}</option>)}</select></div><div className="space-y-2"><Label>Unit rate *</Label><Input type="number" min="0" step="0.01" value={line.unitRate} onChange={e=>updateLine(index,{unitRate:Number(e.target.value)})}/></div><div className="space-y-2"><Label>Tax treatment</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.taxTreatment} onChange={e=>updateLine(index,{taxTreatment:e.target.value as any})}><option value="exclusive">Tax exclusive</option><option value="inclusive">Tax inclusive</option><option value="exempt">Exempt</option><option value="reverse_charge">Reverse charge</option><option value="non_gst">Non-GST</option></select></div>
 <div className="space-y-2"><Label>GST rate</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.gstRate} onChange={e=>updateLine(index,{gstRate:Number(e.target.value)})}>{GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}</select></div><div className="space-y-2"><Label>GST type</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={line.gstType} onChange={e=>updateLine(index,{gstType:e.target.value as any})}><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option><option value="none">None</option></select></div><div className="space-y-2"><Label>Recoverable GST %</Label><Input type="number" min="0" max="100" value={line.recoverableTaxPct} onChange={e=>updateLine(index,{recoverableTaxPct:Number(e.target.value)})}/></div><div className="space-y-2"><Label>Line gross</Label><Input value={money(calc.gross)} readOnly/></div>
 <div className="space-y-2 md:col-span-2 xl:col-span-4"><Label>Justification *</Label><Textarea value={line.justification} onChange={e=>updateLine(index,{justification:e.target.value})}/></div><div className="md:col-span-2 xl:col-span-4 grid gap-3 sm:grid-cols-4">{[["Without tax",calc.base],["Tax",calc.tax],["With tax",calc.gross],["P&L cost",calc.pnlCost]].map(([l,v])=><div key={String(l)} className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{l}</p><p className="font-bold">{money(Number(v))}</p></div>)}</div>
 </CardContent></Card>})}</div><Button variant="outline" className="w-full rounded-2xl border-dashed py-6" onClick={()=>setLines(c=>[...c,blankLine()])}><Plus className="mr-2 h-4 w-4"/>Add budget line</Button></TabsContent>
 <TabsContent value="queue" className="space-y-4"><Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle>Budget approval queue</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex gap-3"><Input placeholder="Approval remarks for reject/revision" value={remarks} onChange={e=>setRemarks(e.target.value)}/></div>{(budgetsQuery.data??[]).map(b=><div key={b.id} className="grid gap-3 rounded-2xl border border-slate-200 p-4 lg:grid-cols-[1.3fr_1fr_1fr_auto]"><div><p className="font-semibold">{b.budget_number}</p><p className="text-sm text-slate-500">{b.branch_name} · {b.period_code} · {b.line_count} lines</p></div><div><p className="text-xs text-slate-500">With tax / P&L</p><p className="font-semibold">{money(Number(b.gross_budget_amount))}</p></div><div><p className="text-xs text-slate-500">Reserved / consumed</p><p className="font-semibold">{money(Number(b.reserved_amount))} / {money(Number(b.consumed_amount))}</p></div><div className="flex flex-wrap items-center justify-end gap-2"><Badge variant="outline">{b.status.replaceAll("_"," ")}</Badge>{["submitted","branch_head_approved","finance_head_approved"].includes(b.status)&&<Button size="sm" onClick={()=>void review(b.id,"approve")}><CheckCircle2 className="mr-1 h-3.5 w-3.5"/>Approve</Button>}{["submitted","branch_head_approved","finance_head_approved"].includes(b.status)&&<Button size="sm" variant="outline" onClick={()=>void review(b.id,"revision")}><XCircle className="mr-1 h-3.5 w-3.5"/>Revision</Button>}</div></div>)}{!budgetsQuery.isLoading&&!(budgetsQuery.data??[]).length&&<div className="py-12 text-center text-slate-500"><Building2 className="mx-auto mb-3 h-10 w-10"/>No budget found.</div>}</CardContent></Card></TabsContent>
 </Tabs></div></div></DashboardLayout>;
}
'''

TEST_FILE = r'''import { describe, expect, it } from "vitest";
import { calculateBudgetLine } from "../branch-budget.service.js";

const base = {
  head: "IT",
  itemName: "Laptop hire",
  quantity: 10,
  unit: "Device",
  unitRate: 1000,
  taxTreatment: "exclusive" as const,
  gstRate: 18,
  gstType: "cgst_sgst" as const,
  recoverableTaxPct: 100,
  justification: "Monthly plan",
};

describe("branch budget tax calculation", () => {
  it("adds tax for an exclusive quote", () => {
    expect(calculateBudgetLine(base)).toMatchObject({ baseAmount: 10000, taxAmount: 1800, grossAmount: 11800, pnlCostAmount: 10000, cgstAmount: 900, sgstAmount: 900 });
  });

  it("backs tax out of an inclusive quote", () => {
    const result = calculateBudgetLine({ ...base, unitRate: 1180, taxTreatment: "inclusive" });
    expect(result).toMatchObject({ baseAmount: 10000, taxAmount: 1800, grossAmount: 11800, pnlCostAmount: 10000 });
  });

  it("adds non-recoverable tax to P&L cost", () => {
    const result = calculateBudgetLine({ ...base, recoverableTaxPct: 0 });
    expect(result.pnlCostAmount).toBe(11800);
  });

  it("keeps exempt lines tax free", () => {
    const result = calculateBudgetLine({ ...base, taxTreatment: "exempt", gstRate: 18 });
    expect(result).toMatchObject({ baseAmount: 10000, taxAmount: 0, grossAmount: 10000, pnlCostAmount: 10000, gstType: "none" });
  });
});
'''

# Replace and add new implementation files.
write("backend/sql/411_branch_budget_grn_approval_flow.sql", MIGRATION)
old_migration = ROOT / "backend/sql/410_branch_budget_grn_approval_flow.sql"
if old_migration.exists():
    old_migration.unlink()
write("backend/src/modules/process-pnl/branch-budget.service.ts", BRANCH_BUDGET_SERVICE)
write("backend/src/modules/finance/grn.service.ts", GRN_SERVICE)
write("src/components/finance/grn/BudgetLinkedGrnForm.tsx", BUDGET_LINKED_GRN_FORM)
write("src/pages/finance/BranchBudgetManagementPage.tsx", BRANCH_BUDGET_PAGE)
write("backend/src/modules/process-pnl/__tests__/branch-budget.calculation.test.ts", TEST_FILE)

# Register migration in both canonical and manual runners.
replace_once(
    "backend/src/db/runPendingMigrations.ts",
    '  "409_visitor_management_foundation.sql",\n',
    '  "409_visitor_management_foundation.sql",\n  "411_branch_budget_grn_approval_flow.sql",\n',
)
replace_once(
    "backend/sql/000_run_all.sql",
    "-- ── ATS candidate assessment engine (408) ───────────────────────────────────\nSOURCE sql/408_ats_candidate_assessment_engine.sql;\n",
    "-- ── Finance attribution, P&L controls and budget-linked GRN (405–411) ────────\nSOURCE sql/405_finance_grn_vendor_cost_attribution.sql;\nSOURCE sql/406_process_pnl_financial_controls.sql;\nSOURCE sql/408_ats_candidate_assessment_engine.sql;\nSOURCE sql/409_visitor_management_foundation.sql;\nSOURCE sql/411_branch_budget_grn_approval_flow.sql;\n",
)

# Add budget endpoints before the P&L-wide role gate, preserving least privilege.
replace_once(
    "backend/src/modules/process-pnl/process-pnl.routes.ts",
    'import { processPnlService } from "./process-pnl.service.js";\n',
    'import { processPnlService } from "./process-pnl.service.js";\nimport { branchBudgetService } from "./branch-budget.service.js";\n',
)
replace_once(
    "backend/src/modules/process-pnl/process-pnl.routes.ts",
    "router.use(requireAuth);\nrouter.use(requireRole(...PNL_READ_ROLES));\n",
    '''const BUDGET_READ_ROLES = ["super_admin","admin","branch_admin","branch_head","finance","finance_head","accounts_head"] as const;
const BUDGET_CREATE_ROLES = ["super_admin","admin","branch_admin"] as const;
const BUDGET_REVIEW_ROLES = ["branch_head","finance_head","accounts_head"] as const;

router.use(requireAuth);

router.get("/pnl/budgets", requireRole(...BUDGET_READ_ROLES), h(async (req, res) => {
  const data = await branchBudgetService.list({
    period: req.query.period ? String(req.query.period) : undefined,
    branchId: req.query.branchId ? String(req.query.branchId) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
  });
  res.json({ success: true, data });
}));

router.get("/pnl/budgets/:id", requireRole(...BUDGET_READ_ROLES), h(async (req, res) => {
  const data = await branchBudgetService.get(req.params.id);
  res.json({ success: true, data });
}));

router.get("/pnl/budget-lines/available", requireRole(...BUDGET_READ_ROLES), h(async (req, res) => {
  const data = await branchBudgetService.availableLines({
    branchId: req.query.branchId ? String(req.query.branchId) : "",
    processId: req.query.processId ? String(req.query.processId) : undefined,
    costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
    period: req.query.period ? String(req.query.period) : undefined,
  });
  res.json({ success: true, data });
}));

router.post("/pnl/budgets", requireWriteAccess, requireRole(...BUDGET_CREATE_ROLES), h(async (req, res) => {
  const data = await branchBudgetService.saveDraft(req.body, req.authUser.id);
  res.status(201).json({ success: true, data });
}));

router.post("/pnl/budgets/:id/submit", requireWriteAccess, requireRole(...BUDGET_CREATE_ROLES), h(async (req, res) => {
  const data = await branchBudgetService.submit(req.params.id, req.authUser.id, req.authUser.role);
  res.json({ success: true, data });
}));

router.post("/pnl/budgets/:id/review", requireWriteAccess, requireRole(...BUDGET_REVIEW_ROLES), h(async (req, res) => {
  const decision = String(req.body?.decision ?? "") as "approve" | "reject" | "revision";
  if (!["approve","reject","revision"].includes(decision)) throw new Error("Invalid budget decision");
  const data = await branchBudgetService.review(req.params.id, decision, req.authUser.id, req.authUser.role, req.body?.remarks ? String(req.body.remarks) : undefined);
  res.json({ success: true, data });
}));

router.use(requireRole(...PNL_READ_ROLES));
''',
)

# Correct staged GRN review permissions.
replace_once(
    "backend/src/modules/finance/grn.routes.ts",
    'const GRN_REVIEW_ROLES = ["accounts_head", "finance_head", "super_admin"];',
    'const GRN_REVIEW_ROLES = ["branch_head", "finance_head", "super_admin"];',
)

# Make vendor-payment creation transactional and map payment status back to GRN.
vp_path = "backend/src/modules/finance/vendor-payment.service.ts"
replace_once(vp_path, 'import type { RowDataPacket } from "mysql2";\n', 'import type { RowDataPacket } from "mysql2";\nimport type { PoolConnection } from "mysql2/promise";\n')
vp = read(vp_path)
start = vp.index("  async createFromGrn(")
end = vp.rindex("\n};")
new_tail = r'''  async createFromGrn(grnId: string, actorUserId: string, connection?: PoolConnection) {
    const executor = connection ?? db;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT g.*, b.branch_name AS branch_name
         FROM grn_request g
         LEFT JOIN branch_master b ON b.id = g.branch_id
        WHERE g.id = ? AND g.grn_type = 'vendor'
          AND g.status IN ('pending_accounts_payment','finance_head_approved','approved')
        LIMIT 1`,
      [grnId]
    );
    const grn = rows[0] as any;
    if (!grn) throw new Error("Finance-approved vendor GRN not found");
    const [existing] = await executor.execute<RowDataPacket[]>("SELECT id FROM vendor_payment_tracking WHERE grn_request_id = ? LIMIT 1", [grnId]);
    if (existing.length > 0) return String(existing[0].id);

    const id = randomUUID();
    const dueAmount = Number(grn.amount_with_tax || grn.amount || 0);
    await executor.execute(
      `INSERT INTO vendor_payment_tracking
       (id,grn_request_id,grn_number,branch_id,process_id,cost_centre_id,cost_class,vendor_id,vendor_name,head,sub_head,
        due_amount,due_date,grn_file_name,grn_file_path,grn_file_mime,paid_amount,balance_amount,payment_status,financial_year,
        budget_id,budget_line_id,amount_without_tax,tax_amount,amount_with_tax)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'Payment Pending',?,?,?,?,?,?)`,
      [id,grnId,grn.grn_number,grn.branch_id,grn.process_id??null,grn.cost_centre_id??null,grn.cost_class??"indirect",
       grn.vendor_id??null,grn.vendor_name??null,grn.head,grn.sub_head,dueAmount,grn.due_date??grn.bill_date??null,
       grn.attachment_original_name??grn.attachment_file_name??null,grn.attachment_path??grn.attachment_file_path??null,
       grn.attachment_mime??grn.attachment_file_mime??null,dueAmount,grn.financial_year??null,grn.budget_id??null,
       grn.budget_line_id??null,Number(grn.amount_without_tax||grn.amount||0),Number(grn.tax_amount||0),dueAmount]
    );
    await executor.execute(`UPDATE grn_request SET status='pending_accounts_payment', accounts_payment_status='pending' WHERE id=?`, [grnId]);
    await writeFinanceAudit("VENDOR_PAYMENT_ROW_CREATED", id, actorUserId, undefined, {
      grn_id: grnId, grn_number: grn.grn_number, due_amount: dueAmount,
      budget_id: grn.budget_id??null, budget_line_id: grn.budget_line_id??null,
      process_id: grn.process_id??null, cost_centre_id: grn.cost_centre_id??null,
    });
    return id;
  },

  async notifyPaymentPending(id: string) {
    const payment = await this.getPayment(id);
    if (!payment) return;
    const [accountsUsers] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT u.id FROM auth_user u
       JOIN user_role_assignment ura ON ura.user_id=u.id
       WHERE ura.role_name='accounts_head' AND u.active_status=1 LIMIT 20`
    );
    for (const user of accountsUsers) {
      await inboxService.createItem({
        user_id: String(user.id), type: "VENDOR_PAYMENT_PENDING",
        title: `Vendor Payment Pending - GRN ${payment.grn_number ?? payment.grn_request_id}`,
        description: `Branch: ${payment.branch_name ?? payment.branch_id} | Vendor: ${payment.vendor_name ?? "N/A"} | Due: Rs ${Number(payment.due_amount).toLocaleString("en-IN")} | Due Date: ${payment.due_date ?? "TBD"}`,
        entity_type: "vendor_payment_tracking", entity_id: id, action_url: "/finance/vendor-payment-tracking", priority: "high",
      });
    }
  },
'''
write(vp_path, vp[:start] + new_tail + vp[end:])

replace_once(
    vp_path,
    '''    if (existing.grn_request_id) {
      await db.execute(
        `UPDATE grn_request
            SET process_id = ?,
                cost_centre_id = ?,
                cost_class = ?
          WHERE id = ?`,
        [attribution.processId, attribution.costCentreId, attribution.costClass, existing.grn_request_id]
      ).catch(() => undefined);
    }
''',
    '''    if (existing.grn_request_id) {
      const normalized = String(paymentStatus);
      const grnStatus = normalized === "Paid" ? "paid" : normalized === "Partially Paid" ? "partially_paid" : "pending_accounts_payment";
      const accountsStatus = normalized === "Paid" ? "paid" : normalized === "Partially Paid" ? "partially_paid" : normalized === "On Hold" ? "on_hold" : "pending";
      await db.execute(
        `UPDATE grn_request
            SET process_id=?, cost_centre_id=?, cost_class=?, status=?, accounts_payment_status=?
          WHERE id=?`,
        [attribution.processId, attribution.costCentreId, attribution.costClass, grnStatus, accountsStatus, existing.grn_request_id]
      );
    }
''',
)

# Expose the new page and grant branch roles only to budget/GRN surfaces.
replace_once(
    "src/App.tsx",
    'const PnlPeriodClosePage            = lazy(() => import("./pages/finance/PnlPeriodClosePage"));\n',
    'const PnlPeriodClosePage            = lazy(() => import("./pages/finance/PnlPeriodClosePage"));\nconst BranchBudgetManagementPage     = lazy(() => import("./pages/finance/BranchBudgetManagementPage"));\n',
)
replace_once(
    "src/App.tsx",
    '<Route path="/finance/grn" element={<ProtectedRoute roles={[\'super_admin\',\'admin\',\'finance\',\'finance_head\',\'accounts_head\',\'payroll_head\']}><NativeGRNManagement /></ProtectedRoute>} />',
    '<Route path="/finance/grn" element={<ProtectedRoute roles={[\'super_admin\',\'admin\',\'branch_admin\',\'branch_head\',\'finance\',\'finance_head\',\'accounts_head\',\'payroll_head\']}><NativeGRNManagement /></ProtectedRoute>} />\n              <Route path="/finance/branch-budget" element={<ProtectedRoute roles={[\'super_admin\',\'admin\',\'branch_admin\',\'branch_head\',\'finance\',\'finance_head\',\'accounts_head\']}><BranchBudgetManagementPage /></ProtectedRoute>} />',
)

# Use the approved-budget form inside the existing GRN page and expose staged statuses.
replace_once(
    "src/pages/NativeGRNManagement.tsx",
    'import { DashboardLayout } from "@/components/layout/DashboardLayout";\n',
    'import { DashboardLayout } from "@/components/layout/DashboardLayout";\nimport { BudgetLinkedGrnForm } from "@/components/finance/grn/BudgetLinkedGrnForm";\n',
)
replace_once("src/pages/NativeGRNManagement.tsx", "              <CreateGrnTab />", "              <BudgetLinkedGrnForm />")
replace_once(
    "src/pages/NativeGRNManagement.tsx",
    '''  approved: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Approved",
  },
''',
    '''  branch_head_approved: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 border-blue-200", label: "Branch Head Approved" },
  pending_accounts_payment: { dot: "bg-violet-500", badge: "bg-violet-50 text-violet-700 border-violet-200", label: "Pending Accounts Payment" },
  partially_paid: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 border-amber-200", label: "Partially Paid" },
  paid: { dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Paid" },
  approved: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Approved",
  },
''',
)
replace_once(
    "src/pages/NativeGRNManagement.tsx",
    '''  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
''',
    '''  { value: "submitted", label: "Branch Head Queue" },
  { value: "branch_head_approved", label: "Finance Head Queue" },
  { value: "pending_accounts_payment", label: "Accounts Payment" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
''',
)
replace_once("src/pages/NativeGRNManagement.tsx", '{r.status === "submitted" && (', '{["submitted", "branch_head_approved"].includes(r.status) && (')
replace_once(
    "src/pages/NativeGRNManagement.tsx",
    '''                      Approving this vendor GRN will automatically create a
                      payment tracking entry in Vendor Payment Tracking.''',
    '''                      Branch Head approval reserves the budget. Finance Head approval consumes it and creates the Accounts payment task.''',
)

# Hook response typing and detail query.
hook = read("src/hooks/useBranchBudget.ts")
hook = hook.replace("  gross_budget_amount: number;\n", "  gross_budget_amount: number;\n  pnl_budget_amount?: number;\n")
hook = hook.replace("  return { budgetsQuery, saveBudget, submitBudget, reviewBudget };", '''  const budgetDetail = (id: string) => hrmsApi.get<{ success: boolean; data: unknown }>(`/api/finance/pnl/budgets/${id}`);
  return { budgetsQuery, saveBudget, submitBudget, reviewBudget, budgetDetail };''')
write("src/hooks/useBranchBudget.ts", hook)

# Remove temporary automation files after successful patch; the workflow tests before committing.
for temporary in [ROOT / ".github/scripts/apply_finance_budget_integration.py", ROOT / ".github/workflows/apply-finance-budget-integration.yml"]:
    if temporary.exists():
        temporary.unlink()

print("Finance budget/GRN/vendor integration patch applied successfully")
