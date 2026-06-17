import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  ExpenseStatus,
  type ExpenseClaim,
  type ExpenseItem,
  type AddExpenseItemDto,
  type ExpenseClaimWithDetails
} from './expense.model.js';
import { expenseCategoryService } from './expenseCategory.service.js';

class ExpenseService {
  private async generateClaimNumber(insertId: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `EXP-${year}-${month}`;
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT COUNT(*) as cnt FROM expense_claims WHERE claim_number LIKE ? AND id <= ?',
      [`${prefix}%`, insertId]
    );
    const sequence = rows[0].cnt;
    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  async createDraftClaim(employeeId: number, processId: number, branchId: number): Promise<ExpenseClaim> {
    const [result] = await db.query<ResultSetHeader>(
      'INSERT INTO expense_claims (claim_number, employee_id, process_id, branch_id, status, total_amount) VALUES (?, ?, ?, ?, ?, 0)',
      ['PENDING', employeeId, processId, branchId, ExpenseStatus.DRAFT]
    );
    const claimNumber = await this.generateClaimNumber(result.insertId);
    await db.query('UPDATE expense_claims SET claim_number = ? WHERE id = ?', [claimNumber, result.insertId]);
    const claim = await this.getClaimById(result.insertId);
    if (!claim) throw new Error('Failed to create claim');
    return claim;
  }

  async getClaimById(id: number): Promise<ExpenseClaim | null> {
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM expense_claims WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    return this.mapRowToClaim(rows[0]);
  }

  async getClaimWithDetails(id: number): Promise<ExpenseClaimWithDetails | null> {
    const claim = await this.getClaimById(id);
    if (!claim) return null;
    const items = await this.getClaimItems(id);
    const [approvalRows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_approvals WHERE expense_claim_id = ? ORDER BY action_date DESC', [id]
    );
    const [paymentRows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_payments WHERE expense_claim_id = ?', [id]
    );
    return {
      ...claim, items,
      approvals: approvalRows.map(r => ({
        id: r.id, expense_claim_id: r.expense_claim_id, approver_id: r.approver_id,
        approval_type: r.approval_type, action: r.action, comments: r.comments,
        action_date: new Date(r.action_date)
      })),
      payment: paymentRows.length > 0 ? {
        id: paymentRows[0].id, expense_claim_id: paymentRows[0].expense_claim_id,
        payment_reference: paymentRows[0].payment_reference,
        payment_date: new Date(paymentRows[0].payment_date),
        payment_method: paymentRows[0].payment_method,
        processed_by: paymentRows[0].processed_by,
        created_at: new Date(paymentRows[0].created_at)
      } : undefined
    };
  }

  async addExpenseItem(claimId: number, itemData: AddExpenseItemDto): Promise<ExpenseItem> {
    const claim = await this.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.DRAFT) throw new Error('Can only add items to draft claims');
    const category = await expenseCategoryService.getCategoryById(itemData.category_id);
    if (!category || !category.is_active) throw new Error('Category not found or inactive');
    const [result] = await db.query<ResultSetHeader>(
      'INSERT INTO expense_items (expense_claim_id, category_id, expense_date, amount, description, vendor_name) VALUES (?, ?, ?, ?, ?, ?)',
      [claimId, itemData.category_id, itemData.expense_date, itemData.amount, itemData.description, itemData.vendor_name || null]
    );
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM expense_items WHERE id = ?', [result.insertId]);
    return this.mapRowToItem(rows[0]);
  }

  async getClaimItems(claimId: number): Promise<ExpenseItem[]> {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_items WHERE expense_claim_id = ? ORDER BY expense_date DESC', [claimId]
    );
    return rows.map(r => this.mapRowToItem(r));
  }

  async updateItemReceipt(itemId: number, receiptPath: string): Promise<void> {
    await db.query('UPDATE expense_items SET receipt_file_path = ? WHERE id = ?', [receiptPath, itemId]);
  }

  async calculateClaimTotal(claimId: number): Promise<number> {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT SUM(amount) as total FROM expense_items WHERE expense_claim_id = ?', [claimId]
    );
    return rows[0].total || 0;
  }

  async submitClaim(claimId: number): Promise<ExpenseClaim> {
    const claim = await this.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.DRAFT) throw new Error('Can only submit draft claims');
    const items = await this.getClaimItems(claimId);
    if (items.length === 0) throw new Error('Claim must have at least one expense item');
    const itemsWithoutReceipts = items.filter(item => !item.receipt_file_path);
    if (itemsWithoutReceipts.length > 0) throw new Error('All expense items must have receipts');
    const total = await this.calculateClaimTotal(claimId);
    await db.query(
      'UPDATE expense_claims SET status = ?, total_amount = ?, submitted_date = NOW() WHERE id = ?',
      [ExpenseStatus.SUBMITTED, total, claimId]
    );
    const updatedClaim = await this.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to submit claim');
    return updatedClaim;
  }

  async getEmployeeClaims(
    employeeId: number,
    status?: ExpenseStatus,
    page = 1,
    limit = 20
  ): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM expense_claims WHERE employee_id = ?';
    const params: any[] = [employeeId];
    if (status) { query += ' AND status = ?'; params.push(status); }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const [rows] = await db.query<RowDataPacket[]>(query, params);
    const countQuery = status
      ? 'SELECT COUNT(*) as total FROM expense_claims WHERE employee_id = ? AND status = ?'
      : 'SELECT COUNT(*) as total FROM expense_claims WHERE employee_id = ?';
    const countParams = status ? [employeeId, status] : [employeeId];
    const [countRows] = await db.query<RowDataPacket[]>(countQuery, countParams);
    return { claims: rows.map(r => this.mapRowToClaim(r)), total: countRows[0].total };
  }

  async deleteExpenseItem(itemId: number): Promise<void> {
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT ec.status FROM expense_items ei JOIN expense_claims ec ON ei.expense_claim_id = ec.id WHERE ei.id = ?', [itemId]
    );
    if (rows.length === 0) throw new Error('Expense item not found');
    if (rows[0].status !== ExpenseStatus.DRAFT) throw new Error('Can only delete items from draft claims');
    await db.query('DELETE FROM expense_items WHERE id = ?', [itemId]);
  }

  mapRowToClaim(row: any): ExpenseClaim {
    return {
      id: row.id, claim_number: row.claim_number, employee_id: row.employee_id,
      process_id: row.process_id, branch_id: row.branch_id,
      total_amount: parseFloat(row.total_amount), currency: row.currency,
      status: row.status as ExpenseStatus,
      submitted_date: row.submitted_date ? new Date(row.submitted_date) : undefined,
      manager_approved_date: row.manager_approved_date ? new Date(row.manager_approved_date) : undefined,
      finance_approved_date: row.finance_approved_date ? new Date(row.finance_approved_date) : undefined,
      paid_date: row.paid_date ? new Date(row.paid_date) : undefined,
      rejection_reason: row.rejection_reason,
      created_at: new Date(row.created_at), updated_at: new Date(row.updated_at)
    };
  }

  mapRowToItem(row: any): ExpenseItem {
    return {
      id: row.id, expense_claim_id: row.expense_claim_id, category_id: row.category_id,
      expense_date: new Date(row.expense_date), amount: parseFloat(row.amount),
      description: row.description, vendor_name: row.vendor_name,
      receipt_file_path: row.receipt_file_path,
      created_at: new Date(row.created_at), updated_at: new Date(row.updated_at)
    };
  }
}

export const expenseService = new ExpenseService();
