import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  ExpenseStatus,
  ApprovalType,
  ApprovalAction,
  type ExpenseClaim,
  type ApproveClaimDto,
  type RejectClaimDto,
  type MarkPaidDto
} from './expense.model.js';
import { expenseService } from './expense.service.js';

class ExpenseApprovalService {
  async getManagerPendingClaims(managerId: number, processId: number): Promise<ExpenseClaim[]> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ec.* FROM expense_claims ec
       JOIN employees e ON ec.employee_id = e.id
       WHERE e.reporting_manager_id = ? AND e.process_id = ? AND ec.status = ?
       ORDER BY ec.submitted_date ASC`,
      [managerId, processId, ExpenseStatus.SUBMITTED]
    );
    return rows.map(r => expenseService.mapRowToClaim(r));
  }

  async managerApprove(claimId: number, managerId: number, dto: ApproveClaimDto): Promise<ExpenseClaim> {
    await this.verifyManagerAccess(claimId, managerId);
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.SUBMITTED) throw new Error('Can only approve submitted claims');
    await db.query(
      'UPDATE expense_claims SET status = ?, manager_approved_date = NOW() WHERE id = ?',
      [ExpenseStatus.MANAGER_APPROVED, claimId]
    );
    await db.query(
      'INSERT INTO expense_approvals (expense_claim_id, approver_id, approval_type, action, comments) VALUES (?, ?, ?, ?, ?)',
      [claimId, managerId, ApprovalType.MANAGER, ApprovalAction.APPROVED, dto.comments || null]
    );
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to approve claim');
    return updatedClaim;
  }

  async rejectClaim(claimId: number, approverId: number, dto: RejectClaimDto): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (![ExpenseStatus.SUBMITTED, ExpenseStatus.MANAGER_APPROVED].includes(claim.status)) {
      throw new Error('Can only reject submitted or manager-approved claims');
    }
    const approvalType = claim.status === ExpenseStatus.SUBMITTED ? ApprovalType.MANAGER : ApprovalType.FINANCE;
    if (approvalType === ApprovalType.MANAGER) await this.verifyManagerAccess(claimId, approverId);
    await db.query(
      'UPDATE expense_claims SET status = ?, rejection_reason = ? WHERE id = ?',
      [ExpenseStatus.REJECTED, dto.rejection_reason, claimId]
    );
    await db.query(
      'INSERT INTO expense_approvals (expense_claim_id, approver_id, approval_type, action, comments) VALUES (?, ?, ?, ?, ?)',
      [claimId, approverId, approvalType, ApprovalAction.REJECTED, dto.rejection_reason]
    );
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to reject claim');
    return updatedClaim;
  }

  async getFinanceQueue(
    processId: number,
    status: ExpenseStatus = ExpenseStatus.MANAGER_APPROVED,
    page = 1,
    limit = 20
  ): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const offset = (page - 1) * limit;
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM expense_claims WHERE process_id = ? AND status = ? ORDER BY manager_approved_date ASC LIMIT ? OFFSET ?',
      [processId, status, limit, offset]
    );
    const [countRows] = await db.query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM expense_claims WHERE process_id = ? AND status = ?',
      [processId, status]
    );
    return { claims: rows.map(r => expenseService.mapRowToClaim(r)), total: countRows[0].total };
  }

  async financeApprove(claimId: number, financeUserId: number, dto: ApproveClaimDto): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.MANAGER_APPROVED) {
      throw new Error('Can only finance-approve manager-approved claims');
    }
    await db.query(
      'UPDATE expense_claims SET status = ?, finance_approved_date = NOW() WHERE id = ?',
      [ExpenseStatus.FINANCE_APPROVED, claimId]
    );
    await db.query(
      'INSERT INTO expense_approvals (expense_claim_id, approver_id, approval_type, action, comments) VALUES (?, ?, ?, ?, ?)',
      [claimId, financeUserId, ApprovalType.FINANCE, ApprovalAction.APPROVED, dto.comments || null]
    );
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to finance-approve claim');
    return updatedClaim;
  }

  async markAsPaid(claimId: number, financeUserId: number, dto: MarkPaidDto): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.FINANCE_APPROVED) {
      throw new Error('Can only mark finance-approved claims as paid');
    }
    await db.query(
      'UPDATE expense_claims SET status = ?, paid_date = NOW() WHERE id = ?',
      [ExpenseStatus.PAID, claimId]
    );
    await db.query(
      'INSERT INTO expense_payments (expense_claim_id, payment_reference, payment_date, payment_method, processed_by) VALUES (?, ?, ?, ?, ?)',
      [claimId, dto.payment_reference, dto.payment_date, dto.payment_method, financeUserId]
    );
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to mark claim as paid');
    return updatedClaim;
  }

  private async verifyManagerAccess(claimId: number, managerId: number): Promise<void> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT e.reporting_manager_id, e.process_id, ec.process_id as claim_process_id
       FROM expense_claims ec JOIN employees e ON ec.employee_id = e.id WHERE ec.id = ?`,
      [claimId]
    );
    if (rows.length === 0) throw new Error('Claim not found');
    if (rows[0].reporting_manager_id !== managerId) throw new Error('Not authorized to approve this claim');
    if (rows[0].process_id !== rows[0].claim_process_id) throw new Error('Process access denied');
  }
}

export const expenseApprovalService = new ExpenseApprovalService();
