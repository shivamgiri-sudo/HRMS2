import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { ExpenseStatus, type ExpenseReportQuery } from './expense.model.js';
import { resolveAccountNumber } from '../../shared/fieldEncryption.js';

/*
 * Reporting reads expense_claim, the table that actually exists.
 *
 * This service used to query expense_claims and expense_items. Neither is a table in mas_hrms -
 * the module was written against a claims-plus-line-items schema that was never created - so every
 * report here raised ER_NO_SUCH_TABLE and the Expense Reports page has never produced a figure.
 *
 * expense_claim is the real store and already holds the data: 5,634 rows, of which 100 are
 * expense_type = 'employee_claim' (the rest are imprest and vendor_bill, which this module is not
 * about, hence the filter on every query). One row is one expense, so a claim's amount is its own
 * `amount` column rather than a SUM over child rows, and its category is the `category` enum rather
 * than a join to expense_categories.
 *
 * Column mapping, all verified against information_schema:
 *   total_amount    -> amount
 *   claim_number    -> id            (the claim's identifier; there is no claim-number column)
 *   submitted_date  -> created_at    (ERP inserts these rows already in 'submitted' status)
 *   process_id      -> employees.process_id, via a join - expense_claim has no process column
 *
 * Only the reporting layer is moved here. The claim lifecycle in expense.service.ts still targets
 * the missing tables, because that path returns typed ExpenseClaim objects whose `id` is declared
 * as a number while expense_claim.id is char(36); changing it cascades into the controller, the
 * routes and the frontend's own types. That is a typed refactor, not a query fix, and is called
 * out separately rather than half-done here.
 */
class ExpenseReportService {
  async getExpenseSummary(query: ExpenseReportQuery) {
    const { process_id, branch_id, start_date, end_date } = query;
    const params: any[] = [];
    const whereConditions: string[] = ["ec.expense_type = 'employee_claim'"];
    if (process_id) { whereConditions.push('e.process_id = ?'); params.push(process_id); }
    if (branch_id) { whereConditions.push('ec.branch_id = ?'); params.push(branch_id); }
    if (start_date) { whereConditions.push('ec.created_at >= ?'); params.push(start_date); }
    if (end_date) { whereConditions.push('ec.created_at <= ?'); params.push(end_date); }
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const [totalRows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) as claim_count, SUM(ec.amount) as total_amount, AVG(ec.amount) as avg_claim_amount
       FROM expense_claim ec
       LEFT JOIN employees e ON e.id = ec.employee_id
       ${whereClause}`,
      params
    );
    // category is an enum on the claim itself, so this is a GROUP BY rather than a join through
    // expense_items to expense_categories.
    const [categoryRows] = await db.query<RowDataPacket[]>(
      `SELECT ec.category as category, SUM(ec.amount) as amount, COUNT(*) as count
       FROM expense_claim ec
       LEFT JOIN employees e ON e.id = ec.employee_id
       ${whereClause} GROUP BY ec.category ORDER BY amount DESC`,
      params
    );
    const [statusRows] = await db.query<RowDataPacket[]>(
      `SELECT ec.status as status, COUNT(*) as count
       FROM expense_claim ec
       LEFT JOIN employees e ON e.id = ec.employee_id
       ${whereClause} GROUP BY ec.status`,
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
    processId?: string,
    startDate?: string,
    endDate?: string
  ) {
    const params: any[] = [status];
    const whereConditions = ["ec.expense_type = 'employee_claim'", 'ec.status = ?'];
    if (processId) { whereConditions.push('e.process_id = ?'); params.push(processId); }
    if (startDate) { whereConditions.push('ec.created_at >= ?'); params.push(startDate); }
    if (endDate) { whereConditions.push('ec.created_at <= ?'); params.push(endDate); }
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT e.full_name as employee_name, e.employee_code, ebd.bank_name, ebd.account_number_enc, ebd.account_number AS account_number_legacy, ebd.ifsc_code,
              ec.amount as amount, ec.id as claim_number, ec.expense_date as expense_date
       FROM expense_claim ec
       JOIN employees e ON ec.employee_id = e.id
       LEFT JOIN employee_bank_detail ebd ON e.id = ebd.employee_id
       WHERE ${whereConditions.join(' AND ')} ORDER BY ec.expense_date ASC`,
      params
    );
    return rows.map(r => ({
      employee_name: r.employee_name,
      employee_code: r.employee_code,
      bank_name: r.bank_name || 'N/A',
      account_number: resolveAccountNumber({ account_number_enc: r.account_number_enc, account_number: r.account_number_legacy }) || 'N/A',
      ifsc_code: r.ifsc_code || 'N/A',
      amount: parseFloat(r.amount),
      claim_number: r.claim_number,
      expense_date: r.expense_date
    }));
  }

  async getMonthlyTrends(processId: string, months = 6) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ec.created_at, '%Y-%m') as month, COUNT(*) as claim_count, SUM(ec.amount) as total_amount
       FROM expense_claim ec
       LEFT JOIN employees e ON e.id = ec.employee_id
       WHERE ec.expense_type = 'employee_claim'
         AND e.process_id = ?
         AND ec.created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
       GROUP BY DATE_FORMAT(ec.created_at, '%Y-%m') ORDER BY month ASC`,
      [processId, months]
    );
    return rows.map(r => ({
      month: r.month,
      claim_count: r.claim_count,
      total_amount: parseFloat(r.total_amount)
    }));
  }

  async getTopSpenders(processId: string, limit = 10) {
    // limit is interpolated, not bound: MySQL rejects a bound parameter in LIMIT on a prepared
    // statement, and db.query is used here rather than db.execute, so it is clamped to an integer
    // instead of relying on which of the two this call happens to use.
    const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || 10, 100));
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT e.full_name as employee_name, e.employee_code, COUNT(ec.id) as claim_count, SUM(ec.amount) as total_amount
       FROM employees e
       JOIN expense_claim ec ON e.id = ec.employee_id
       WHERE ec.expense_type = 'employee_claim'
         AND e.process_id = ?
         AND ec.status NOT IN (?, ?)
       GROUP BY e.id, e.full_name, e.employee_code ORDER BY total_amount DESC LIMIT ${safeLimit}`,
      [processId, ExpenseStatus.DRAFT, ExpenseStatus.REJECTED]
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
