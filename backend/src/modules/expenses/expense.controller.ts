import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { expenseService } from './expense.service.js';
import { expenseCategoryService } from './expenseCategory.service.js';
import { expenseApprovalService } from './expenseApproval.service.js';
import { expenseReportService } from './expenseReport.service.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import { getUserRoleContext } from '../../shared/roleResolver.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type {
  CreateExpenseClaimDto,
  AddExpenseItemDto,
  ApproveClaimDto,
  RejectClaimDto,
  MarkPaidDto,
  ExpenseReportQuery
} from './expense.model.js';

function parseId(val: string): number {
  const n = parseInt(val, 10);
  if (isNaN(n)) throw Object.assign(new Error('Invalid ID'), { statusCode: 400 });
  return n;
}

async function getFullEmployee(userId: string): Promise<{ id: number; process_id: number; branch_id: number }> {
  const base = await getEmployeeForUser(userId);
  if (!base) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id, process_id, branch_id FROM employees WHERE id = ? LIMIT 1',
    [base.id]
  );
  if (rows.length === 0) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
  return { id: Number(rows[0].id), process_id: Number(rows[0].process_id), branch_id: Number(rows[0].branch_id) };
}

class ExpenseController {
  async listCategories(req: AuthenticatedRequest, res: Response) {
    const includeInactive = req.query.includeInactive === 'true';
    res.json({ categories: await expenseCategoryService.listCategories(includeInactive) });
  }

  async createCategory(req: AuthenticatedRequest, res: Response) {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string') { res.status(400).json({ error: 'name is required' }); return; }
    res.status(201).json({ category: await expenseCategoryService.createCategory(name, description) });
  }

  async updateCategory(req: AuthenticatedRequest, res: Response) {
    res.json({ category: await expenseCategoryService.updateCategory(parseId(req.params.id), req.body) });
  }

  async deleteCategory(req: AuthenticatedRequest, res: Response) {
    await expenseCategoryService.deleteCategory(parseId(req.params.id));
    res.json({ success: true });
  }

  async createClaim(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    const { process_id, branch_id } = req.body as CreateExpenseClaimDto;
    res.status(201).json({
      claim: await expenseService.createDraftClaim(
        employee.id,
        process_id || employee.process_id,
        branch_id || employee.branch_id
      )
    });
  }

  private async assertClaimOwner(
    claimId: number,
    userId: string,
    res: Response
  ): Promise<{ employee: { id: number; process_id: number; branch_id: number } } | false> {
    const employee = await getFullEmployee(userId);
    const claim = await expenseService.getClaimById(claimId);
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return false; }
    if (claim.employee_id !== employee.id) { res.status(403).json({ error: 'Access denied' }); return false; }
    return { employee };
  }

  async addClaimItem(req: AuthenticatedRequest, res: Response) {
    const claimId = parseId(req.params.claimId);
    const result = await this.assertClaimOwner(claimId, req.authUser!.id, res);
    if (result === false) return;
    res.status(201).json({
      item: await expenseService.addExpenseItem(claimId, req.body as AddExpenseItemDto)
    });
  }

  async deleteClaimItem(req: AuthenticatedRequest, res: Response) {
    const claimId = parseId(req.params.claimId);
    const itemId = parseId(req.params.itemId);
    const result = await this.assertClaimOwner(claimId, req.authUser!.id, res);
    if (result === false) return;
    await expenseService.deleteExpenseItem(itemId);
    res.json({ success: true });
  }

  async uploadReceipt(req: AuthenticatedRequest, res: Response) {
    const claimId = parseId(req.params.claimId);
    const itemId = parseId(req.params.itemId);
    const result = await this.assertClaimOwner(claimId, req.authUser!.id, res);
    if (result === false) return;
    const { receipt_path } = req.body;
    await expenseService.updateItemReceipt(itemId, receipt_path);
    res.json({ success: true, receipt_path });
  }

  async submitClaim(req: AuthenticatedRequest, res: Response) {
    const claimId = parseId(req.params.claimId);
    const result = await this.assertClaimOwner(claimId, req.authUser!.id, res);
    if (result === false) return;
    res.json({ claim: await expenseService.submitClaim(claimId) });
  }

  async getMyClaims(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    const { status, page, limit } = req.query;
    res.json(await expenseService.getEmployeeClaims(
      employee.id,
      status as any,
      parseInt(page as string) || 1,
      parseInt(limit as string) || 20
    ));
  }

  async getClaimDetails(req: AuthenticatedRequest, res: Response) {
    const claim = await expenseService.getClaimWithDetails(parseId(req.params.claimId));
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    const { primaryRole: role } = await getUserRoleContext((req as any).authUser?.id ?? '');
    if (!['finance', 'admin', 'manager'].includes(role)) {
      const employee = await getFullEmployee(req.authUser!.id);
      if (claim.employee_id !== employee.id) {
        res.status(403).json({ error: 'Access denied' }); return;
      }
    }
    res.json({ claim });
  }

  async getPendingApprovals(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({ claims: await expenseApprovalService.getManagerPendingClaims(employee.id, employee.process_id) });
  }

  async managerApprove(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({
      claim: await expenseApprovalService.managerApprove(
        parseId(req.params.claimId),
        employee.id,
        req.body as ApproveClaimDto
      )
    });
  }

  async rejectClaim(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({
      claim: await expenseApprovalService.rejectClaim(
        parseId(req.params.claimId),
        employee.id,
        req.body as RejectClaimDto
      )
    });
  }

  async getFinanceQueue(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    const { status, page, limit } = req.query;
    res.json(await expenseApprovalService.getFinanceQueue(
      employee.process_id,
      status as any,
      parseInt(page as string) || 1,
      parseInt(limit as string) || 20
    ));
  }

  async financeApprove(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({
      claim: await expenseApprovalService.financeApprove(
        parseId(req.params.claimId),
        employee.id,
        req.body as ApproveClaimDto
      )
    });
  }

  async markAsPaid(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({
      claim: await expenseApprovalService.markAsPaid(
        parseId(req.params.claimId),
        employee.id,
        req.body as MarkPaidDto
      )
    });
  }

  async exportForPayment(req: AuthenticatedRequest, res: Response) {
    const { status, start_date, end_date } = req.query;
    const { primaryRole: role } = await getUserRoleContext((req as any).authUser?.id ?? '');
    let processId: number | undefined;
    if (role !== 'admin') {
      const employee = await getFullEmployee(req.authUser!.id);
      processId = employee.process_id;
    }
    const data = await expenseReportService.exportForPayment(
      status as any,
      processId,
      start_date as string,
      end_date as string
    );
    if (data.length === 0) { res.json([]); return; }
    const headers = Object.keys(data[0]);
    const escapeCSV = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csvRows = [
      headers.join(','),
      ...data.map((row: any) => headers.map(h => escapeCSV(row[h])).join(','))
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=expense-payment-export.csv');
    res.send(csvRows.join('\n'));
  }

  async getExpenseSummary(req: AuthenticatedRequest, res: Response) {
    const { primaryRole: role } = await getUserRoleContext((req as any).authUser?.id ?? '');
    const query = req.query as ExpenseReportQuery;
    if (role !== 'admin') {
      const employee = await getFullEmployee(req.authUser!.id);
      (query as any).process_id = employee.process_id;
    }
    res.json(await expenseReportService.getExpenseSummary(query));
  }

  async getMonthlyTrends(req: AuthenticatedRequest, res: Response) {
    const { primaryRole: role } = await getUserRoleContext((req as any).authUser?.id ?? '');
    let processId: number;
    if (role !== 'admin') {
      const employee = await getFullEmployee(req.authUser!.id);
      processId = employee.process_id;
    } else {
      processId = parseInt(req.query.process_id as string) || 0;
    }
    res.json({
      trends: await expenseReportService.getMonthlyTrends(
        processId,
        parseInt(req.query.months as string) || 6
      )
    });
  }

  async getTopSpenders(req: AuthenticatedRequest, res: Response) {
    const { primaryRole: role } = await getUserRoleContext((req as any).authUser?.id ?? '');
    let processId: number;
    if (role !== 'admin') {
      const employee = await getFullEmployee(req.authUser!.id);
      processId = employee.process_id;
    } else {
      processId = parseInt(req.query.process_id as string) || 0;
    }
    res.json({
      spenders: await expenseReportService.getTopSpenders(
        processId,
        parseInt(req.query.limit as string) || 10
      )
    });
  }
}

export const expenseController = new ExpenseController();
