import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { ExpenseStatus, type ExpenseReportQuery } from './expense.model.js';

class ExpenseReportService {
  async getExpenseSummary(query: ExpenseReportQuery) {
    const { process_id, branch_id, start_date, end_date } = query;
    const params: any[] = [];
    const whereConditions: string[] = [];
    if (process_id) { whereConditions.push('ec.process_id = ?'); params.push(process_id); }
    if (branch_id) { whereConditions.push('ec.branch_id = ?'); params.push(branch_id); }
    if (start_date) { whereConditions.push('ec.created_at >= ?'); params.push(start_date); }
    if (end_date) { whereConditions.push('ec.created_at <= ?'); params.push(end_date); }
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const [totalRows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as claim_count, SUM(total_amount) as total_amount, AVG(total_amount) as avg_claim_amount
       FROM expense_claims ec ${whereClause}`,
      params
    );
    const [categoryRows] = await db.query<RowDataPacket[]>(
      `SELECT cat.name as category, SUM(ei.amount) as amount, COUNT(ei.id) as count
       FROM expense_items ei
       JOIN expense_categories cat ON ei.category_id = cat.id
       JOIN expense_claims ec ON ei.expense_claim_id = ec.id
       ${whereClause} GROUP BY cat.id, cat.name ORDER BY amount DESC`,
      params
    );
    const [statusRows] = await db.query<RowDataPacket[]>(
      `SELECT status, COUNT(*) as count FROM expense_claims ec ${whereClause} GROUP BY status`,
      params
    );
    const totals = totalRows[0];
    return {
      total_amount: parseFloat(totals.total_amount) || 0,
      claim_count: totals.claim_count,
      avg_claim_amount: parseFloat(totals.avg_claim_amount) || 0,
      by_category: categoryRows.map(r => ({
        category: r.category,
        amount: parseFloat(r.amount),
        count: r.count
      })),
      by_status: statusRows.map(r => ({ status: r.status, count: r.count }))
    };
  }

  async exportForPayment(
    status: ExpenseStatus,
    processId?: number,
    startDate?: string,
    endDate?: string
  ) {
    const params: any[] = [status];
    const whereConditions = ['ec.status = ?'];
    if (processId) { whereConditions.push('ec.process_id = ?'); params.push(processId); }
    if (startDate) { whereConditions.push('ec.submitted_date >= ?'); params.push(startDate); }
    if (endDate) { whereConditions.push('ec.submitted_date <= ?'); params.push(endDate); }
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT e.name as employee_name, e.employee_code, ebd.bank_name, ebd.account_number, ebd.ifsc_code,
              ec.total_amount as amount, ec.claim_number, ec.submitted_date as expense_date
       FROM expense_claims ec
       JOIN employees e ON ec.employee_id = e.id
       LEFT JOIN employee_bank_detail ebd ON e.id = ebd.employee_id
       WHERE ${whereConditions.join(' AND ')} ORDER BY ec.submitted_date ASC`,
      params
    );
    return rows.map(r => ({
      employee_name: r.employee_name,
      employee_code: r.employee_code,
      bank_name: r.bank_name || 'N/A',
      account_number: r.account_number || 'N/A',
      ifsc_code: r.ifsc_code || 'N/A',
      amount: parseFloat(r.amount),
      claim_number: r.claim_number,
      expense_date: r.expense_date
    }));
  }

  async getMonthlyTrends(processId: number, months = 6) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as claim_count, SUM(total_amount) as total_amount
       FROM expense_claims
       WHERE process_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY month ASC`,
      [processId, months]
    );
    return rows.map(r => ({
      month: r.month,
      claim_count: r.claim_count,
      total_amount: parseFloat(r.total_amount)
    }));
  }

  async getTopSpenders(processId: number, limit = 10) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT e.name as employee_name, e.employee_code, COUNT(ec.id) as claim_count, SUM(ec.total_amount) as total_amount
       FROM employees e
       JOIN expense_claims ec ON e.id = ec.employee_id
       WHERE ec.process_id = ? AND ec.status NOT IN (?, ?)
       GROUP BY e.id, e.name, e.employee_code ORDER BY total_amount DESC LIMIT ?`,
      [processId, ExpenseStatus.DRAFT, ExpenseStatus.REJECTED, limit]
    );
    return rows.map(r => ({
      employee_name: r.employee_name,
      employee_code: r.employee_code,
      claim_count: r.claim_count,
      total_amount: parseFloat(r.total_amount)
    }));
  }
}

export const expenseReportService = new ExpenseReportService();
