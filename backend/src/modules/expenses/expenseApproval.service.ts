import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  ExpenseStatus,
  type ExpenseClaim,
  type ApproveClaimDto,
  type RejectClaimDto,
  type MarkPaidDto
} from './expense.model.js';
import { expenseService } from './expense.service.js';

/*
 * Backed by expense_claim - see the header of expense.service.ts for why the four tables this
 * module was written against do not exist and are not being created.
 *
 * The two approval stages map onto the columns the table already keeps for them:
 *   manager stage  -> approval_level = 1, reviewed_by / reviewed_at
 *   finance stage  -> status 'approved', approval_level = 2, approved_by / approved_at
 *
 * There is no expense_approvals table, so a rejection reason is written to the claim's remarks and
 * the approver of record is the stage column. That is one actor per stage rather than an append
 * only history; nothing here pretends otherwise.
 */
class ExpenseApprovalService {
  async getManagerPendingClaims(managerId: string, processId?: string | null): Promise<ExpenseClaim[]> {
    const params: unknown[] = [managerId];
    let processFilter = '';
    if (processId) { processFilter = ' AND e.process_id = ?'; params.push(processId); }
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ec.id, ec.employee_id, ec.branch_id, ec.status, ec.approval_level,
              ec.amount, ec.currency, ec.category, ec.expense_date, ec.description,
              ec.receipt_ref, ec.remarks, ec.reviewed_by, ec.reviewed_at,
              ec.approved_by, ec.approved_at, ec.payment_status, ec.created_at, ec.updated_at
         FROM expense_claim ec
         JOIN employees e ON ec.employee_id = e.id
        WHERE e.reporting_manager_id = ?${processFilter}
          AND ec.expense_type = 'employee_claim'
          AND ec.status = 'submitted'
          AND COALESCE(ec.approval_level, 0) = 0
        ORDER BY ec.created_at ASC`,
      params
    );
    return rows.map(r => expenseService.mapRowToClaim(r));
  }

  async managerApprove(claimId: string, managerId: string, dto: ApproveClaimDto): Promise<ExpenseClaim> {
    await this.verifyManagerAccess(claimId, managerId);
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.SUBMITTED) throw new Error('Can only approve submitted claims');
    // Stays 'submitted'; approval_level 1 is what makes it manager-approved and moves it to the
    // finance queue.
    await db.query(
      `UPDATE expense_claim
          SET approval_level = 1, reviewed_by = ?, reviewed_at = NOW(),
              remarks = COALESCE(?, remarks), updated_at = NOW()
        WHERE id = ?`,
      [managerId, dto.comments || null, claimId]
    );
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to approve claim');
    return updatedClaim;
  }

  async rejectClaim(claimId: string, approverId: string, dto: RejectClaimDto): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (![ExpenseStatus.SUBMITTED, ExpenseStatus.MANAGER_APPROVED].includes(claim.status)) {
      throw new Error('Can only reject submitted or manager-approved claims');
    }
    const isManagerStage = claim.status === ExpenseStatus.SUBMITTED;
    if (isManagerStage) await this.verifyManagerAccess(claimId, approverId);
    // The reason goes to remarks - the only column that holds it - and the rejecting actor is
    // recorded on the stage that rejected.
    const actorColumn = isManagerStage ? 'reviewed_by = ?, reviewed_at = NOW()' : 'approved_by = ?, approved_at = NOW()';
    await db.query(
      `UPDATE expense_claim
          SET status = 'rejected', ${actorColumn}, remarks = ?, updated_at = NOW()
        WHERE id = ?`,
      [approverId, dto.rejection_reason, claimId]
    );
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to reject claim');
    return updatedClaim;
  }

  async getFinanceQueue(
    processId?: string | null,
    status: ExpenseStatus = ExpenseStatus.MANAGER_APPROVED,
    page = 1,
    limit = 20
  ): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || 20, 100));
    const safePage = Math.max(1, Math.trunc(Number(page)) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const where = ["ec.expense_type = 'employee_claim'"];
    const params: unknown[] = [];
    if (status === ExpenseStatus.MANAGER_APPROVED) {
      where.push("ec.status = 'submitted'", 'COALESCE(ec.approval_level, 0) = 1');
    } else if (status === ExpenseStatus.FINANCE_APPROVED) {
      where.push("ec.status = 'approved'");
    } else if (status === ExpenseStatus.PAID) {
      where.push("ec.status = 'paid'");
    }
    if (processId) { where.push('e.process_id = ?'); params.push(processId); }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ec.id, ec.employee_id, ec.branch_id, ec.status, ec.approval_level,
              ec.amount, ec.currency, ec.category, ec.expense_date, ec.description,
              ec.receipt_ref, ec.remarks, ec.reviewed_by, ec.reviewed_at,
              ec.approved_by, ec.approved_at, ec.payment_status, ec.created_at, ec.updated_at
         FROM expense_claim ec
         LEFT JOIN employees e ON e.id = ec.employee_id
        ${whereSql}
        ORDER BY ec.reviewed_at ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );
    const [countRows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total
         FROM expense_claim ec
         LEFT JOIN employees e ON e.id = ec.employee_id
        ${whereSql}`,
      params
    );
    return { claims: rows.map(r => expenseService.mapRowToClaim(r)), total: countRows[0].total };
  }

  async financeApprove(claimId: string, financeUserId: string, dto: ApproveClaimDto): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.MANAGER_APPROVED) {
      throw new Error('Can only finance-approve manager-approved claims');
    }
    await db.query(
      `UPDATE expense_claim
          SET status = 'approved', approval_level = 2, approved_by = ?, approved_at = NOW(),
              payment_status = 'pending', remarks = COALESCE(?, remarks), updated_at = NOW()
        WHERE id = ?`,
      [financeUserId, dto.comments || null, claimId]
    );
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to finance-approve claim');
    return updatedClaim;
  }

  async markAsPaid(claimId: string, _financeUserId: string, dto: MarkPaidDto): Promise<ExpenseClaim> {
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== ExpenseStatus.FINANCE_APPROVED) {
      throw new Error('Can only mark finance-approved claims as paid');
    }
    // No payments table: the claim carries payment_status, and the payment reference is kept in
    // remarks because there is no dedicated column for it.
    await db.query(
      `UPDATE expense_claim
          SET status = 'paid', payment_status = 'paid',
              remarks = CONCAT_WS(' | ', remarks, ?), updated_at = NOW()
        WHERE id = ?`,
      [`Payment ${dto.payment_reference} on ${dto.payment_date} via ${dto.payment_method}`, claimId]
    );
    const updatedClaim = await expenseService.getClaimById(claimId);
    if (!updatedClaim) throw new Error('Failed to mark claim as paid');
    return updatedClaim;
  }

  private async verifyManagerAccess(claimId: string, managerId: string): Promise<void> {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT e.reporting_manager_id
         FROM expense_claim ec JOIN employees e ON ec.employee_id = e.id
        WHERE ec.id = ?`,
      [claimId]
    );
    if (rows.length === 0) throw new Error('Claim not found');
    // The claim has no process column, so the process cross-check the old code attempted
    // (ec.process_id vs e.process_id) has no counterpart here; the employee's manager is the
    // authority.
    if (String(rows[0].reporting_manager_id ?? '') !== String(managerId)) {
      throw new Error('Not authorized to approve this claim');
    }
  }
}

export const expenseApprovalService = new ExpenseApprovalService();
