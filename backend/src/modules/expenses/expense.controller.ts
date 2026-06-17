import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { expenseService } from './expense.service.js';
import { expenseCategoryService } from './expenseCategory.service.js';
import { expenseApprovalService } from './expenseApproval.service.js';
import { expenseReportService } from './expenseReport.service.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
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
    res.status(201).json({ category: await expenseCategoryService.createCategory(name, description) });
  }

  async updateCategory(req: AuthenticatedRequest, res: Response) {
    res.json({ category: await expenseCategoryService.updateCategory(parseInt(req.params.id), req.body) });
  }

  async deleteCategory(req: AuthenticatedRequest, res: Response) {
    await expenseCategoryService.deleteCategory(parseInt(req.params.id));
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

  async addClaimItem(req: AuthenticatedRequest, res: Response) {
    res.status(201).json({
      item: await expenseService.addExpenseItem(parseInt(req.params.claimId), req.body as AddExpenseItemDto)
    });
  }

  async deleteClaimItem(req: AuthenticatedRequest, res: Response) {
    await expenseService.deleteExpenseItem(parseInt(req.params.itemId));
    res.json({ success: true });
  }

  async uploadReceipt(req: AuthenticatedRequest, res: Response) {
    const { receipt_path } = req.body;
    await expenseService.updateItemReceipt(parseInt(req.params.itemId), receipt_path);
    res.json({ success: true, receipt_path });
  }

  async submitClaim(req: AuthenticatedRequest, res: Response) {
    res.json({ claim: await expenseService.submitClaim(parseInt(req.params.claimId)) });
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
    const claim = await expenseService.getClaimWithDetails(parseInt(req.params.claimId));
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
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
        parseInt(req.params.claimId),
        employee.id,
        req.body as ApproveClaimDto
      )
    });
  }

  async rejectClaim(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({
      claim: await expenseApprovalService.rejectClaim(
        parseInt(req.params.claimId),
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
        parseInt(req.params.claimId),
        employee.id,
        req.body as ApproveClaimDto
      )
    });
  }

  async markAsPaid(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({
      claim: await expenseApprovalService.markAsPaid(
        parseInt(req.params.claimId),
        employee.id,
        req.body as MarkPaidDto
      )
    });
  }

  async exportForPayment(req: AuthenticatedRequest, res: Response) {
    const { status, process_id, start_date, end_date } = req.query;
    const data = await expenseReportService.exportForPayment(
      status as any,
      process_id ? parseInt(process_id as string) : undefined,
      start_date as string,
      end_date as string
    );
    if (data.length === 0) { res.json([]); return; }
    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map((row: any) => headers.map(h => row[h]).join(','))
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=expense-payment-export.csv');
    res.send(csvRows.join('\n'));
  }

  async getExpenseSummary(req: AuthenticatedRequest, res: Response) {
    res.json(await expenseReportService.getExpenseSummary(req.query as ExpenseReportQuery));
  }

  async getMonthlyTrends(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({
      trends: await expenseReportService.getMonthlyTrends(
        employee.process_id,
        parseInt(req.query.months as string) || 6
      )
    });
  }

  async getTopSpenders(req: AuthenticatedRequest, res: Response) {
    const employee = await getFullEmployee(req.authUser!.id);
    res.json({
      spenders: await expenseReportService.getTopSpenders(
        employee.process_id,
        parseInt(req.query.limit as string) || 10
      )
    });
  }
}

export const expenseController = new ExpenseController();
