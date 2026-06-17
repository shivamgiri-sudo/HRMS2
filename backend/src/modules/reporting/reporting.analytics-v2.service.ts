import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { reportingService } from './reporting.service.js';
import { resolveBranchScope, type BranchScope } from './reporting.scope.js';

function scopeClause(scope: BranchScope, branchCol: string): { sql: string; params: string[] } {
  if (scope.isSuperAdmin || scope.branchIds.length === 0) return { sql: '1=1', params: [] };
  return { sql: `${branchCol} IN (${scope.branchIds.map(() => '?').join(',')})`, params: scope.branchIds };
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isInactiveStatus(value: unknown): boolean {
  return ['terminated', 'inactive', 'offboarded', 'absconded', 'resigned', 'left', 'separated'].includes(String(value ?? '').trim().toLowerCase());
}

function activeAsOf(emp: any, asOf: Date): boolean {
  const joined = toDate(emp.date_of_joining);
  const exited = toDate(emp.exit_date);
  if (joined && joined > asOf) return false;
  if (exited && exited <= asOf) return false;
  if (!exited && isInactiveStatus(emp.employment_status)) return false;
  return true;
}

export const reportingAnalyticsV2Service = {
  async analyticsOverview(year: number, userId: string) {
    const base = await reportingService.analyticsOverview(year, userId);
    const scope = await resolveBranchScope(userId);
    const sc = scopeClause(scope, 'e.branch_id');
    const [employeeRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.date_of_joining,
              COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date) AS exit_date,
              e.employment_status
         FROM employees e
        WHERE ${sc.sql}`,
      sc.params,
    );

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const today = new Date();

    const monthlyBreakdown = monthNames.map((month, index) => {
      const start = new Date(year, index, 1, 0, 0, 0, 0);
      const end = new Date(year, index + 1, 0, 23, 59, 59, 999);
      const hires = employeeRows.filter((employee) => {
        const joined = toDate(employee.date_of_joining);
        return joined && joined >= start && joined <= end;
      }).length;
      const terminations = employeeRows.filter((employee) => {
        const exited = toDate(employee.exit_date);
        return exited && exited >= start && exited <= end;
      }).length;
      return { month, hires, joiners: hires, terminations, exits: terminations, net: hires - terminations };
    });

    const employeeGrowth = monthNames.map((month, index) => {
      const asOf = new Date(year, index + 1, 0, 23, 59, 59, 999);
      const breakdown = monthlyBreakdown[index];
      const headcount = employeeRows.filter((employee) => activeAsOf(employee, asOf)).length;
      return {
        month,
        employees: headcount,
        headcount,
        joiners: breakdown.joiners,
        exits: breakdown.exits,
      };
    });

    const payrollScope = scopeClause(scope, 'e.branch_id');
    const [payrollRows] = await db.execute<RowDataPacket[]>(
      `SELECT spr.run_month, SUM(COALESCE(spl.net_salary, 0)) AS total_net
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
         JOIN employees e ON e.id = spl.employee_id
        WHERE LEFT(spr.run_month, 4) = ?
          AND LOWER(spr.status) IN ('approved', 'disbursed', 'finalized', 'locked', 'released')
          AND ${payrollScope.sql}
        GROUP BY spr.run_month
        ORDER BY spr.run_month`,
      [String(year), ...payrollScope.params],
    );
    const payrollByMonth = new Map(payrollRows.map((row) => [Number(String(row.run_month).slice(5, 7)), Number(row.total_net ?? 0)]));
    const payrollTrend = monthNames.map((month, index) => ({ month, amount: payrollByMonth.get(index + 1) ?? 0 }));
    const missingPayrollMonths = payrollTrend.filter((row) => row.amount === 0).map((row) => row.month);

    const newHires = monthlyBreakdown.reduce((sum, item) => sum + item.hires, 0);
    const terminations = monthlyBreakdown.reduce((sum, item) => sum + item.terminations, 0);
    const startOfYearHeadcount = employeeRows.filter((employee) => activeAsOf(employee, yearStart)).length;
    const currentHeadcount = employeeRows.filter((employee) => activeAsOf(employee, today)).length;

    return {
      ...base,
      employeeGrowth,
      payrollTrend,
      headcount: {
        ...base.headcount,
        newHires,
        newJoiners: newHires,
        terminations,
        netChange: monthlyBreakdown.reduce((sum, item) => sum + item.net, 0),
        currentHeadcount,
        startOfYearHeadcount,
        startOfYear: startOfYearHeadcount,
        monthlyBreakdown,
      },
      dataHealth: {
        logicVersion: 'analytics_as_of_v3',
        year,
        employeeRowsScanned: employeeRows.length,
        payrollRowsScanned: payrollRows.length,
        missingPayrollMonths,
        warnings: [
          ...(employeeRows.length === 0 ? ['No employee records found for current report scope'] : []),
          ...(payrollRows.length === 0 ? ['No approved/locked/released payroll runs found for selected year'] : []),
          ...(missingPayrollMonths.length > 0 ? [`Payroll trend has zero data for ${missingPayrollMonths.join(', ')}`] : []),
        ],
      },
    };
  },
};
