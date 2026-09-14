import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  ExpenseStatus,
  type ExpenseClaim,
  type ExpenseItem,
  type AddExpenseItemDto,
  type ExpenseClaimWithDetails
} from './expense.model.js';
import { expenseCategoryService } from './expenseCategory.service.js';

/*
 * Backed by expense_claim, the table that exists.
 *
 * This service targeted expense_claims, expense_items, expense_approvals and expense_payments.
 * None of those is a table in mas_hrms - the module was written against a claims-plus-line-items
 * schema that was never created - so every operation raised ER_NO_SUCH_TABLE and no expense claim
 * has ever been created, submitted or approved through it.
 *
 * expense_claim is the real store (5,634 rows; 100 of them expense_type = 'employee_claim') and
 * erp.service.ts already reads and writes it correctly. Creating the four missing tables would
 * have given the same domain two competing stores, so the module is moved onto the existing one
 * instead.
 *
 * ONE CLAIM IS ONE EXPENSE. That is the shape of the real data - the row carries expense_date,
 * category, amount and description itself - so an "item" here is a view over the claim rather than
 * a child row. addExpenseItem fills those fields in; a second item is refused explicitly rather
 * than silently overwriting the first.
 *
 * The six module states survive on a five-value enum because the table carries approval_level for
 * exactly this:
 *   DRAFT            status='draft'
 *   SUBMITTED        status='submitted', approval_level 0
 *   MANAGER_APPROVED status='submitted', approval_level 1, reviewed_by/reviewed_at set
 *   FINANCE_APPROVED status='approved',  approval_level 2, approved_by/approved_at set
 *   PAID             status='paid'
 *   REJECTED         status='rejected',  remarks carries the reason
 *
 * Columns that simply do not exist are not invented: there is no claim_number (the id is the
 * reference), no process_id on the claim (the employee's process is used for reporting), and no
 * per-stage date columns beyond reviewed_at/approved_at.
 */

/** Fields every read needs, aliased into the shape mapRowToClaim expects. */
const CLAIM_SELECT = `
  ec.id, ec.employee_id, ec.branch_id, ec.status, ec.approval_level,
  ec.amount, ec.currency, ec.category, ec.expense_date, ec.description,
  ec.receipt_ref, ec.remarks, ec.reviewed_by, ec.reviewed_at,
  ec.approved_by, ec.approved_at, ec.payment_status, ec.created_at, ec.updated_at`;

class ExpenseService {
  async createDraftClaim(
    employeeId: string,
    _processId?: string | null,
    branchId?: string | null
  ): Promise<ExpenseClaim> {
    // expense_date and amount are NOT NULL with no default, so a draft starts as today/0 and is
    // filled in by addExpenseItem. expense_type is set so the reporting queries, which scope to
    // employee_claim, pick this row up.
    const id = randomUUID();
    await db.query(
      `INSERT INTO expense_claim
         (id, employee_id, branch_id, expense_date, amount, status, expense_type)
       VALUES (?, ?, ?, CURDATE(), 0, 'draft', 'employee_claim')`,
      [id, employeeId, branchId ?? null]
    );
    const claim = await this.getClaimById(id);
    if (!claim) throw new Error('Failed to create claim');
    return claim;
  }

  async getClaimById(id: string): Promise<ExpenseClaim | null> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ${CLAIM_SELECT} FROM expense_claim ec WHERE ec.id = ?`, [id]
    );
    if (rows.length === 0) return null;
    return this.mapRowToClaim(rows[0]);
  }

  async getClaimWithDetails(id: string): Promise<ExpenseClaimWithDetails | null> {
    const claim = await this.getClaimById(id);
    if (!claim) return null;
    const items = await this.getClaimItems(id);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ${CLAIM_SELECT} FROM expense_claim ec WHERE ec.id = ?`, [id]
    );
    const row = rows[0];

    /*
     * There is no approvals table, so the trail is reconstructed from the columns the claim
     * itself keeps: reviewed_by/reviewed_at for the manager stage and approved_by/approved_at for
     * finance. That is one entry per stage rather than a full history - the real table records the
     * latest actor per stage, not every action - which is stated here rather than faked.
     */
    const approvals: ExpenseClaimWithDetails['approvals'] = [];
    if (row?.reviewed_by) {
      approvals.push({
        id: `${id}:manager`, expense_claim_id: id, approver_id: String(row.reviewed_by),
        approval_type: 'MANAGER' as never,
        action: (claim.status === ExpenseStatus.REJECTED ? 'REJECTED' : 'APPROVED') as never,
        comments: row.remarks ?? undefined,
        action_date: row.reviewed_at ? new Date(row.reviewed_at) : new Date(row.updated_at)
      });
    }
    if (row?.approved_by) {
      approvals.push({
        id: `${id}:finance`, expense_claim_id: id, approver_id: String(row.approved_by),
        approval_type: 'FINANCE' as never,
        action: (claim.status === ExpenseStatus.REJECTED ? 'REJECTED' : 'APPROVED') as never,
        comments: row.remarks ?? undefined,
        action_date: row.approved_at ? new Date(row.approved_at) : new Date(row.updated_at)
      });
    }

    return {
      ...claim,
      items,
      approvals,
      // payment_status is a flag on the claim; there is no payment record to return.
      payment: row?.payment_status === 'paid' ? {
        id: `${id}:payment`, expense_claim_id: id,
        payment_reference: row.receipt_ref ?? '',
        payment_date: row.approved_at ? new Date(row.approved_at) : new Date(row.updated_at),
        payment_method: 'unspecified',
        processed_by: String(row.approved_by ?? ''),
        created_at: new Date(row.updated_at)
      } : undefined
    };
  }

  async addExpenseItem(claimId: string, itemData: AddExpenseItemDto): Promise<ExpenseItem> {
    const claim = await this.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.DRAFT) throw new Error('Can only add items to draft claims');
    const category = await expenseCategoryService.getCategoryById(itemData.category_id);
    if (!category || !category.is_active) throw new Error('Category not found or inactive');

    // One claim is one expense on this table, so the first item fills the claim in. A second is
    // refused rather than overwriting the first silently.
    if (Number(claim.total_amount) > 0) {
      throw Object.assign(
        new Error('This claim already has an expense. Raise a separate claim for another expense.'),
        { statusCode: 409 }
      );
    }

    await db.query(
      `UPDATE expense_claim
          SET category = ?, expense_date = ?, amount = ?, description = ?, updated_at = NOW()
        WHERE id = ?`,
      [this.toCategoryEnum(category.name), itemData.expense_date, itemData.amount,
       itemData.description ?? null, claimId]
    );
    const items = await this.getClaimItems(claimId);
    return items[0];
  }

  async getClaimItems(claimId: string): Promise<ExpenseItem[]> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ${CLAIM_SELECT} FROM expense_claim ec WHERE ec.id = ?`, [claimId]
    );
    if (rows.length === 0) return [];
    const row = rows[0];
    // A draft with nothing filled in yet has no item to show.
    if (Number(row.amount) === 0 && !row.description) return [];
    return [this.mapRowToItem(row)];
  }

  async updateItemReceipt(itemId: string, receiptPath: string): Promise<void> {
    // The item and the claim are the same row, so the receipt lands on the claim's receipt_ref.
    await db.query('UPDATE expense_claim SET receipt_ref = ?, updated_at = NOW() WHERE id = ?',
      [receiptPath, itemId]);
  }

  async calculateClaimTotal(claimId: string): Promise<number> {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT amount FROM expense_claim WHERE id = ?', [claimId]
    );
    return rows.length ? Number(rows[0].amount) || 0 : 0;
  }

  async submitClaim(claimId: string): Promise<ExpenseClaim> {
    const claim = await this.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.DRAFT) throw new Error('Can only submit draft claims');
    const items = await this.getClaimItems(claimId);
    if (items.length === 0) throw new Error('Claim must have at least one expense item');
    if (items.some(item => !item.receipt_file_path)) throw new Error('All expense items must have receipts');
    await db.query(
      `UPDATE expense_claim SET status = 'submitted', approval_level = 0, updated_at = NOW()
        WHERE id = ?`,
      [claimId]
    );
    const updatedClaim = await this.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to submit claim');
    return updatedClaim;
  }

  async getEmployeeClaims(
    employeeId: string,
    status?: ExpenseStatus,
    page = 1,
    limit = 20
  ): Promise<{ claims: ExpenseClaim[]; total: number }> {
    // LIMIT/OFFSET are clamped and interpolated - MySQL rejects a bound parameter there on a
    // prepared statement, and this must not depend on db.query vs db.execute.
    const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || 20, 100));
    const safePage = Math.max(1, Math.trunc(Number(page)) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const where = ["ec.employee_id = ?", "ec.expense_type = 'employee_claim'"];
    const params: unknown[] = [employeeId];
    const stored = status ? this.toStoredStatus(status) : null;
    if (stored) {
      where.push('ec.status = ?');
      params.push(stored.status);
      if (stored.approvalLevel !== null) { where.push('ec.approval_level = ?'); params.push(stored.approvalLevel); }
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ${CLAIM_SELECT} FROM expense_claim ec ${whereSql}
        ORDER BY ec.created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );
    const [countRows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM expense_claim ec ${whereSql}`, params
    );
    return { claims: rows.map(r => this.mapRowToClaim(r)), total: countRows[0].total };
  }

  async deleteExpenseItem(itemId: string): Promise<void> {
    const claim = await this.getClaimById(itemId);
    if (!claim) throw new Error('Expense item not found');
    if (claim.status !== ExpenseStatus.DRAFT) throw new Error('Can only delete items from draft claims');
    // Clears the expense back to an empty draft rather than deleting the claim, which is what
    // removing the only line item means when the claim and the line are one row.
    await db.query(
      `UPDATE expense_claim SET amount = 0, description = NULL, receipt_ref = NULL, updated_at = NOW()
        WHERE id = ?`,
      [itemId]
    );
  }

  /** expense_claim.category is an enum; the categories master is free text, so map by name. */
  private toCategoryEnum(name: string): string {
    const allowed = ['travel', 'accommodation', 'meals', 'transport', 'communication', 'office', 'other'];
    const normalized = String(name ?? '').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : 'other';
  }

  /** Module status -> what is actually stored. approvalLevel null means "do not filter on it". */
  private toStoredStatus(status: ExpenseStatus): { status: string; approvalLevel: number | null } {
    switch (status) {
      case ExpenseStatus.DRAFT: return { status: 'draft', approvalLevel: null };
      case ExpenseStatus.SUBMITTED: return { status: 'submitted', approvalLevel: 0 };
      case ExpenseStatus.MANAGER_APPROVED: return { status: 'submitted', approvalLevel: 1 };
      case ExpenseStatus.FINANCE_APPROVED: return { status: 'approved', approvalLevel: null };
      case ExpenseStatus.PAID: return { status: 'paid', approvalLevel: null };
      case ExpenseStatus.REJECTED: return { status: 'rejected', approvalLevel: null };
      default: return { status: 'draft', approvalLevel: null };
    }
  }

  /** What is stored -> the module's six states. */
  private fromStoredStatus(status: string, approvalLevel: number): ExpenseStatus {
    switch (String(status ?? '').toLowerCase()) {
      case 'draft': return ExpenseStatus.DRAFT;
      case 'submitted': return Number(approvalLevel) >= 1 ? ExpenseStatus.MANAGER_APPROVED : ExpenseStatus.SUBMITTED;
      case 'approved': return ExpenseStatus.FINANCE_APPROVED;
      case 'paid': return ExpenseStatus.PAID;
      case 'rejected': return ExpenseStatus.REJECTED;
      default: return ExpenseStatus.DRAFT;
    }
  }

  mapRowToClaim(row: any): ExpenseClaim {
    const status = this.fromStoredStatus(row.status, row.approval_level);
    return {
      id: String(row.id),
      // No claim_number column exists; the id is the claim's reference.
      claim_number: String(row.id),
      employee_id: String(row.employee_id),
      process_id: null,
      branch_id: row.branch_id ? String(row.branch_id) : null,
      total_amount: parseFloat(row.amount) || 0,
      currency: row.currency ?? 'INR',
      status,
      submitted_date: status === ExpenseStatus.DRAFT ? undefined : new Date(row.created_at),
      manager_approved_date: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      finance_approved_date: row.approved_at ? new Date(row.approved_at) : undefined,
      paid_date: status === ExpenseStatus.PAID && row.approved_at ? new Date(row.approved_at) : undefined,
      rejection_reason: status === ExpenseStatus.REJECTED ? (row.remarks ?? undefined) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }

  mapRowToItem(row: any): ExpenseItem {
    return {
      // The item and the claim are the same row.
      id: String(row.id),
      expense_claim_id: String(row.id),
      category_id: 0,
      expense_date: new Date(row.expense_date),
      amount: parseFloat(row.amount) || 0,
      description: row.description ?? '',
      vendor_name: undefined,
      receipt_file_path: row.receipt_ref ?? undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }
}

export const expenseService = new ExpenseService();
