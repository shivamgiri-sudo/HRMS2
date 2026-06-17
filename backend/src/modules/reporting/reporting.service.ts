import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { resolveBranchScope, type BranchScope } from './reporting.scope.js';

// ── Scope SQL helper ──────────────────────────────────────────────────────────
function scopeClause(scope: BranchScope, branchCol: string): { sql: string; params: string[] } {
  if (scope.isSuperAdmin || scope.branchIds.length === 0) {
    return { sql: '1=1', params: [] };
  }
  const placeholders = scope.branchIds.map(() => '?').join(',');
  return { sql: `${branchCol} IN (${placeholders})`, params: scope.branchIds };
}

type Builder = (f: Record<string, string>, scope: BranchScope) => { sql: string; params: unknown[] };

const QUERIES: Record<string, Builder> = {

  // ══════════════════════════════════════════════════════════════════════════
  //  EXISTING (scope-enhanced)
  // ══════════════════════════════════════════════════════════════════════════

  branch_master: (f, scope) => {
    const sc = scopeClause(scope, 'b.id');
    return {
      sql: `SELECT b.id, b.branch_code, b.branch_name, b.call_centre_code, b.city, b.state,
                   COUNT(DISTINCT e.id) AS employee_count,
                   COUNT(DISTINCT p.id) AS process_count,
                   b.active_status
              FROM branch_master b
              LEFT JOIN employees e ON e.branch_id = b.id AND e.active_status = 1
              LEFT JOIN process_master p ON p.branch_id = b.id AND p.active_status = 1
             WHERE ${sc.sql} ${f.branch ? 'AND b.id = ?' : ''}
             GROUP BY b.id ORDER BY b.branch_name`,
      params: [...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },

  user_master: (_f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT ur.user_id, ur.role_key, ur.active_status,
                   e.first_name, e.last_name, e.email, e.employee_code,
                   e.branch_id, bm.branch_name
              FROM user_roles ur
              LEFT JOIN employees e ON e.user_id = ur.user_id
              LEFT JOIN branch_master bm ON bm.id = e.branch_id
             WHERE ${sc.sql}
             ORDER BY ur.role_key, e.last_name`,
      params: sc.params,
    };
  },

  process_master: (f, scope) => {
    const sc = scopeClause(scope, 'p.branch_id');
    return {
      sql: `SELECT p.id, p.process_code, p.process_name, p.call_centre_code,
                   b.branch_name, l.lob_name,
                   COUNT(DISTINCT e.id) AS headcount,
                   p.active_status
              FROM process_master p
              LEFT JOIN branch_master b ON b.id = p.branch_id
              LEFT JOIN lob_master l ON l.id = p.lob_id
              LEFT JOIN employees e ON e.process_id = p.id AND e.active_status = 1
             WHERE ${sc.sql} ${f.branch ? 'AND p.branch_id = ?' : ''}
             GROUP BY p.id ORDER BY b.branch_name, p.process_name`,
      params: [...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },

  role_access_map: (_f, _scope) => ({
    sql: `SELECT rpa.role_key, rpa.page_code, rpa.can_view, rpa.can_create,
                 rpa.can_edit, rpa.can_delete, rpa.can_export
            FROM role_page_access rpa
           ORDER BY rpa.role_key, rpa.page_code`,
    params: [],
  }),

  cc_headcount: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code,
                   b.branch_name, COUNT(e.id) AS headcount,
                   COUNT(CASE WHEN e.employment_status = 'active' THEN 1 END) AS active_count
              FROM employees e
              LEFT JOIN branch_master b ON b.id = e.branch_id
             WHERE ${sc.sql} ${f.ccCode ? 'AND COALESCE(e.call_centre_code, b.call_centre_code) = ?' : ''}
             GROUP BY cc_code, b.branch_name ORDER BY cc_code`,
      params: [...sc.params, ...(f.ccCode ? [f.ccCode] : [])],
    };
  },

  employee_dir: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT e.employee_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
                   e.email, d.designation_name, b.branch_name, p.process_name,
                   e.employment_status, e.date_of_joining,
                   COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code
              FROM employees e
              LEFT JOIN designation_master d ON d.id = e.designation_id
              LEFT JOIN branch_master b ON b.id = e.branch_id
              LEFT JOIN process_master p ON p.id = e.process_id
             WHERE e.active_status = 1 AND ${sc.sql}
               ${f.branch ? 'AND e.branch_id = ?' : ''}
               ${f.status ? 'AND e.employment_status = ?' : ''}
             ORDER BY b.branch_name, e.last_name`,
      params: [...sc.params, ...(f.branch ? [f.branch] : []), ...(f.status ? [f.status] : [])],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PAYROLL (6)
  // ══════════════════════════════════════════════════════════════════════════

  payroll_register: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               spr.run_month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               d.designation_name,
               spl.working_days,
               spl.present_days,
               spl.leave_days,
               spl.lwp_days,
               spl.late_marks,
               spl.gross_salary,
               spl.basic,
               spl.hra,
               spl.special_allowance,
               spl.pf_employee,
               spl.pf_employer,
               spl.esic_employee,
               spl.esic_employer,
               spl.professional_tax,
               spl.tds_amount,
               spl.advance_recovery,
               spl.lwp_deduction,
               spl.total_deductions,
               spl.net_salary,
               spl.status AS line_status
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.process ? 'AND e.process_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.process ? [f.process] : []),
      ],
    };
  },

  payroll_component_detail: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               spr.run_month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               splc.component_code,
               splc.component_name,
               splc.component_type,
               splc.amount,
               splc.taxable,
               splc.source
             FROM salary_prep_line_component splc
             JOIN salary_prep_run spr ON spr.id = splc.run_id
             JOIN employees e ON e.id = splc.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.componentType ? 'AND splc.component_type = ?' : ''}
            ORDER BY b.branch_name, e.employee_code, splc.component_type, splc.component_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.componentType ? [f.componentType] : []),
      ],
    };
  },

  payroll_statutory: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               spr.run_month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               e.uan_number,
               e.esic_number,
               e.pan_number,
               spl.gross_salary AS gross_wages,
               spl.pf_employee,
               spl.pf_employer,
               (spl.pf_employee + spl.pf_employer) AS total_pf,
               spl.esic_employee,
               spl.esic_employer,
               (spl.esic_employee + spl.esic_employer) AS total_esic,
               spl.professional_tax AS pt,
               spl.tds_amount AS tds
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  payroll_bank_statement: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               spr.run_month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               e.bank_name,
               e.bank_branch,
               e.account_holder_name,
               e.bank_account_number,
               e.ifsc_code,
               e.account_type,
               spl.net_salary AS amount_to_credit,
               spl.status AS line_status,
               spr.disbursed_at
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  payroll_full_final: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               d.designation_name,
               e.date_of_joining,
               e.date_of_exit,
               er.resignation_date,
               er.last_working_day,
               er.exit_type,
               ffc.calculation_date,
               ffc.notice_period_days,
               ffc.notice_shortfall_days,
               ffc.notice_recovery,
               ffc.earned_leave_encashment,
               ffc.gratuity_amount,
               ffc.salary_hold,
               ffc.advances_recovery,
               ffc.net_payable,
               ffc.status AS ff_status
             FROM full_final_calculation ffc
             JOIN exit_request er ON er.id = ffc.exit_request_id
             JOIN employees e ON e.id = ffc.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND ffc.calculation_date >= ?' : ''}
              ${f.dateTo ? 'AND ffc.calculation_date <= ?' : ''}
            ORDER BY ffc.calculation_date DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  payroll_ytd: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               spr.financial_year,
               COUNT(spl.id) AS months_paid,
               SUM(spl.gross_salary) AS ytd_gross,
               SUM(spl.basic) AS ytd_basic,
               SUM(spl.hra) AS ytd_hra,
               SUM(spl.special_allowance) AS ytd_special_allowance,
               SUM(spl.pf_employee) AS ytd_pf_employee,
               SUM(spl.pf_employer) AS ytd_pf_employer,
               SUM(spl.esic_employee) AS ytd_esic_employee,
               SUM(spl.professional_tax) AS ytd_pt,
               SUM(spl.tds_amount) AS ytd_tds,
               SUM(spl.lwp_deduction) AS ytd_lwp_deduction,
               SUM(spl.net_salary) AS ytd_net
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND ${sc.sql}
              ${f.financialYear ? 'AND spr.financial_year = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY e.id, spr.financial_year
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.financialYear ? [f.financialYear] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  EMPLOYEE (5)
  // ══════════════════════════════════════════════════════════════════════════

  emp_master: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               e.gender,
               e.date_of_birth,
               e.blood_group,
               e.father_name,
               e.marital_status,
               e.mobile,
               e.email,
               e.office_email,
               e.date_of_joining,
               e.salary_start_date,
               e.resignation_date,
               e.date_of_leaving,
               e.date_of_exit,
               e.employment_type,
               e.emp_type,
               e.employee_category,
               e.employment_status,
               b.branch_name,
               loc.location_name,
               p.process_name,
               d.designation_name,
               dept.dept_name AS department,
               lob.lob_name,
               g.grade_name,
               cc.cost_centre_name,
               COALESCE(e.cost_center_code, cc.cost_centre_code) AS cost_centre_code,
               e.band,
               e.stream,
               e.profile_type,
               e.source_type,
               e.source,
               CONCAT(rm.first_name,' ',COALESCE(rm.last_name,'')) AS reporting_manager,
               e.biometric_code,
               e.billable_status,
               COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code,
               e.ctc,
               e.gross_salary,
               e.net_inhand,
               e.nominee_name,
               e.nominee_relation,
               e.address1,
               e.address2,
               e.city,
               e.state,
               e.country,
               e.pincode,
               e.pan_number,
               e.aadhaar_last4,
               e.aadhaar_number,
               e.uan_number,
               e.epf_number,
               e.esic_number,
               e.bank_name,
               e.bank_branch,
               e.bank_account_number,
               e.ifsc_code,
               e.account_type,
               e.legacy_emp_id,
               e.legacy_id
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN location_master loc ON loc.id = e.location_id
             LEFT JOIN process_master p ON p.id = e.process_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
             LEFT JOIN department_master dept ON dept.id = e.department_id
             LEFT JOIN lob_master lob ON lob.id = e.lob_id
             LEFT JOIN grade_band_master g ON g.id = e.grade_id
             LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
             LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.process ? 'AND e.process_id = ?' : ''}
              ${f.status ? 'AND e.employment_status = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.process ? [f.process] : []),
        ...(f.status ? [f.status] : []),
      ],
    };
  },

  emp_statutory: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               b.branch_name,
               e.pan_number,
               e.pan_verified_on,
               e.aadhaar_last4,
               e.aadhaar_verified_on,
               e.uan_number,
               e.epf_number,
               e.esic_number,
               esi.pf_applicable,
               esi.esic_applicable,
               esi.pt_applicable,
               esi.tds_applicable,
               e.employment_status
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },

  emp_bank_details: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               b.branch_name,
               e.account_holder_name,
               e.bank_name,
               e.bank_branch,
               e.bank_account_number,
               e.ifsc_code,
               e.account_type,
               e.employment_status
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },

  emp_joining_exit: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const typeFilter =
      f.type === 'joiners' ? 'AND e.date_of_joining IS NOT NULL' :
      f.type === 'leavers' ? 'AND e.date_of_exit IS NOT NULL' : '';
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               b.branch_name,
               p.process_name,
               d.designation_name,
               e.date_of_joining,
               e.date_of_exit,
               e.employment_status,
               e.employment_type,
               e.employee_category,
               COALESCE(e.call_centre_code, b.call_centre_code) AS cc_code
             FROM employees e
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
             LEFT JOIN designation_master d ON d.id = e.designation_id
            WHERE ${sc.sql} ${typeFilter}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND COALESCE(e.date_of_exit, e.date_of_joining) >= ?' : ''}
              ${f.dateTo ? 'AND COALESCE(e.date_of_exit, e.date_of_joining) <= ?' : ''}
            ORDER BY b.branch_name, e.date_of_joining DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  emp_documents: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
               b.branch_name,
               ed.doc_type,
               ed.doc_category,
               ed.doc_name,
               ed.verified,
               ed.expiry_date,
               ed.created_at AS uploaded_at,
               ed.verification_date,
               ed.verification_remarks
             FROM employee_documents ed
             JOIN employees e ON e.id = ed.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.verified !== undefined && f.verified !== '' ? 'AND ed.verified = ?' : ''}
            ORDER BY b.branch_name, e.employee_code, ed.doc_category`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.verified !== undefined && f.verified !== '' ? [f.verified] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ATTENDANCE & BIOMETRIC (5)
  // ══════════════════════════════════════════════════════════════════════════

  att_monthly: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               adr.record_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               adr.attendance_status,
               adr.clock_in_time,
               adr.clock_out_time,
               adr.raw_minutes,
               ROUND(adr.raw_minutes / 60, 2) AS hours_worked,
               adr.late_mark,
               adr.late_by_minutes,
               adr.lwp_value,
               adr.work_mode,
               adr.attendance_source
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.process ? 'AND e.process_id = ?' : ''}
              ${f.dateFrom ? 'AND adr.record_date >= ?' : ''}
              ${f.dateTo ? 'AND adr.record_date <= ?' : ''}
            ORDER BY adr.record_date, b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.process ? [f.process] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  att_late_mark: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               DATE_FORMAT(adr.record_date,'%Y-%m') AS month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               COUNT(*) AS total_late_marks,
               SUM(adr.late_by_minutes) AS total_late_minutes,
               ROUND(AVG(adr.late_by_minutes),1) AS avg_late_minutes
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE adr.late_mark = 1
              AND ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), e.id
            ORDER BY month, b.branch_name, total_late_marks DESC`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  att_biometric: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               was.session_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               e.biometric_code,
               b.branch_name,
               was.branch_name AS punch_branch,
               p.process_name,
               was.login_time AS punch_in,
               was.logout_time AS punch_out,
               was.total_login_minutes,
               ROUND(was.total_login_minutes / 60, 2) AS login_hours,
               was.current_status,
               was.punch_source
             FROM wfm_attendance_session was
             JOIN employees e ON e.id = was.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(was.session_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND was.session_date >= ?' : ''}
              ${f.dateTo ? 'AND was.session_date <= ?' : ''}
            ORDER BY was.session_date, b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  att_regularization: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               ar.session_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               ar.reason,
               ar.status,
               ar.reviewed_at,
               ar.reviewer_note,
               ar.created_at AS applied_at
             FROM attendance_regularization ar
             JOIN employees e ON e.id = ar.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.status ? 'AND ar.status = ?' : ''}
              ${f.dateFrom ? 'AND ar.session_date >= ?' : ''}
              ${f.dateTo ? 'AND ar.session_date <= ?' : ''}
            ORDER BY ar.session_date DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.status ? [f.status] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  att_reconciliation: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               adr.record_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               adr.attendance_status,
               adr.attendance_source,
               adr.clock_in_time,
               adr.clock_out_time,
               adr.raw_minutes,
               adr.is_locked
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE adr.attendance_status = 'unreconciled'
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND adr.record_date >= ?' : ''}
              ${f.dateTo ? 'AND adr.record_date <= ?' : ''}
            ORDER BY adr.record_date DESC, b.branch_name`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  APR / DIALER (3) — joined to employees via biometric_code
  // ══════════════════════════════════════════════════════════════════════════

  apr_daily: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               a.ReportDate,
               a.UserID AS agent_id,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS agent_name,
               e.employee_code,
               b.branch_name,
               p.process_name,
               a.campaign_id,
               a.Calls,
               a.TALK_TIME,
               a.WAIT_TIME,
               a.DISPO_TIME,
               a.PAUSE_TIME,
               a.AHT,
               a.Login_Time,
               a.Logout_Time,
               a.Net_Login,
               a.BIO,
               a.LUNCH,
               a.QA,
               a.TRAINING
             FROM apr a
             LEFT JOIN employees e ON e.biometric_code = a.UserID AND e.active_status = 1
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${f.dateFrom ? 'AND a.ReportDate >= ?' : ''}
              ${f.dateTo ? 'AND a.ReportDate <= ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.campaign ? 'AND a.campaign_id = ?' : ''}
            ORDER BY a.ReportDate DESC, b.branch_name, a.UserID`,
      params: [
        ...sc.params,
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.campaign ? [f.campaign] : []),
      ],
    };
  },

  apr_monthly: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               DATE_FORMAT(a.ReportDate,'%Y-%m') AS month,
               a.UserID AS agent_id,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS agent_name,
               e.employee_code,
               b.branch_name,
               p.process_name,
               a.campaign_id,
               COUNT(*) AS days_logged,
               SUM(a.Calls) AS total_calls,
               SEC_TO_TIME(SUM(TIME_TO_SEC(a.TALK_TIME))) AS total_talk_time,
               SEC_TO_TIME(SUM(TIME_TO_SEC(a.Net_Login))) AS total_net_login,
               SEC_TO_TIME(AVG(TIME_TO_SEC(a.AHT))) AS avg_aht
             FROM apr a
             LEFT JOIN employees e ON e.biometric_code = a.UserID AND e.active_status = 1
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(a.ReportDate,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY DATE_FORMAT(a.ReportDate,'%Y-%m'), a.UserID, a.campaign_id
            ORDER BY month, b.branch_name, a.UserID`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  apr_campaign: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               a.campaign_id,
               DATE_FORMAT(a.ReportDate,'%Y-%m') AS month,
               b.branch_name,
               COUNT(DISTINCT a.UserID) AS agents,
               COUNT(*) AS agent_days,
               SUM(a.Calls) AS total_calls,
               ROUND(SUM(a.Calls)/NULLIF(COUNT(*),0),1) AS avg_calls_per_day,
               SEC_TO_TIME(AVG(TIME_TO_SEC(a.AHT))) AS avg_aht,
               SEC_TO_TIME(SUM(TIME_TO_SEC(a.Net_Login))) AS total_net_login
             FROM apr a
             LEFT JOIN employees e ON e.biometric_code = a.UserID AND e.active_status = 1
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(a.ReportDate,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.campaign ? 'AND a.campaign_id = ?' : ''}
            GROUP BY a.campaign_id, DATE_FORMAT(a.ReportDate,'%Y-%m'), b.branch_name
            ORDER BY month, b.branch_name, a.campaign_id`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
        ...(f.campaign ? [f.campaign] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  LEAVE (3)
  // ══════════════════════════════════════════════════════════════════════════

  leave_balance: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    const year = parseInt(f.year || String(new Date().getFullYear()));
    return {
      sql: `SELECT
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               ltm.leave_code,
               ltm.leave_name,
               ltm.paid_leave,
               lbl.balance_year AS year,
               lbl.allocated_days,
               lbl.used_days,
               lbl.adjusted_days,
               (lbl.allocated_days - lbl.used_days + lbl.adjusted_days) AS closing_balance
             FROM leave_balance_ledger lbl
             JOIN employees e ON e.id = lbl.employee_id
             JOIN leave_type_master ltm ON ltm.id = lbl.leave_type_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE lbl.balance_year = ?
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code, ltm.leave_code`,
      params: [year, ...sc.params, ...(f.branch ? [f.branch] : [])],
    };
  },

  leave_transactions: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               lr.applied_at,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               ltm.leave_code,
               ltm.leave_name,
               lr.from_date,
               lr.to_date,
               lr.total_days,
               lr.status,
               lr.reason,
               lr.approved_at,
               lr.approved_by,
               lr.rejection_reason
             FROM leave_request lr
             JOIN employees e ON e.id = lr.employee_id
             JOIN leave_type_master ltm ON ltm.id = lr.leave_type_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.status ? 'AND lr.status = ?' : ''}
              ${f.dateFrom ? 'AND lr.from_date >= ?' : ''}
              ${f.dateTo ? 'AND lr.to_date <= ?' : ''}
            ORDER BY lr.applied_at DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.status ? [f.status] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  leave_lwp: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               DATE_FORMAT(adr.record_date,'%Y-%m') AS month,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               SUM(adr.lwp_value) AS total_lwp_days,
               COUNT(*) AS lwp_records
             FROM attendance_daily_record adr
             JOIN employees e ON e.id = adr.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE adr.lwp_value > 0
              AND ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(adr.record_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), e.id
            ORDER BY month, b.branch_name, total_lwp_days DESC`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  KPI (2)
  // ══════════════════════════════════════════════════════════════════════════

  kpi_scores: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               ks.period,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               kmm.metric_code,
               kmm.metric_name,
               kmm.metric_unit,
               ks.actual_value,
               ks.source
             FROM kpi_score ks
             JOIN kpi_metric_master kmm ON kmm.id = ks.metric_id
             JOIN employees e ON e.id = ks.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = e.process_id
            WHERE ${sc.sql}
              ${f.period ? 'AND ks.period = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY ks.period, b.branch_name, e.employee_code, kmm.metric_code`,
      params: [
        ...sc.params,
        ...(f.period ? [f.period] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  kpi_summary: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               kss.period_id,
               kss.role_code,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               p.process_name,
               kss.final_score,
               kss.rating,
               kss.rank_in_team,
               kss.rank_in_process,
               kss.rank_in_branch,
               kss.status
             FROM kpi_score_summary kss
             JOIN employees e ON e.id = kss.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master p ON p.id = kss.process_id
            WHERE ${sc.sql}
              ${f.period ? 'AND kss.period_id = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, kss.rank_in_branch`,
      params: [
        ...sc.params,
        ...(f.period ? [f.period] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ATTRITION & LIFECYCLE (2)
  // ══════════════════════════════════════════════════════════════════════════

  attrition_monthly: (f, scope) => {
    const sc = scopeClause(scope, 'ar.branch_id');
    return {
      sql: `SELECT
               DATE_FORMAT(ar.exit_date,'%Y-%m') AS month,
               b.branch_name,
               p.process_name,
               ar.exit_type,
               COUNT(*) AS headcount_exited,
               SUM(ar.tenure_days) AS total_tenure_days,
               ROUND(AVG(ar.tenure_days),0) AS avg_tenure_days
             FROM attrition_record ar
             LEFT JOIN branch_master b ON b.id = ar.branch_id
             LEFT JOIN process_master p ON p.id = ar.process_id
            WHERE ${sc.sql}
              ${f.month ? "AND DATE_FORMAT(ar.exit_date,'%Y-%m') = ?" : ''}
              ${f.branch ? 'AND ar.branch_id = ?' : ''}
            GROUP BY DATE_FORMAT(ar.exit_date,'%Y-%m'), ar.branch_id, ar.process_id, ar.exit_type
            ORDER BY month DESC, b.branch_name`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  emp_lifecycle: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               ele.effective_date,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               b.branch_name,
               ele.event_type,
               ele.old_value_json,
               ele.new_value_json,
               ele.remarks,
               ele.created_at
             FROM employee_lifecycle_event ele
             JOIN employees e ON e.id = ele.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.eventType ? 'AND ele.event_type = ?' : ''}
              ${f.dateFrom ? 'AND ele.effective_date >= ?' : ''}
              ${f.dateTo ? 'AND ele.effective_date <= ?' : ''}
            ORDER BY ele.effective_date DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.eventType ? [f.eventType] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  COMPLIANCE / STATUTORY (2)
  // ══════════════════════════════════════════════════════════════════════════

  pf_challan: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               spr.run_month,
               b.branch_name,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               e.uan_number,
               e.epf_number,
               spl.gross_salary AS pf_wages,
               spl.basic AS pf_basic,
               spl.pf_employee AS employee_pf,
               spl.pf_employer AS employer_pf,
               (spl.pf_employee + spl.pf_employer) AS total_pf_contribution
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND spl.pf_employee > 0
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  esic_challan: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               spr.run_month,
               b.branch_name,
               e.employee_code,
               CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
               e.esic_number,
               spl.gross_salary AS esic_wages,
               spl.esic_employee AS employee_esic,
               spl.esic_employer AS employer_esic,
               (spl.esic_employee + spl.esic_employer) AS total_esic_contribution
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
             JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE LOWER(spr.status) IN ('approved','disbursed','finalized')
              AND spl.esic_employee > 0
              AND ${sc.sql}
              ${f.month ? 'AND spr.run_month = ?' : ''}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY b.branch_name, e.employee_code`,
      params: [
        ...sc.params,
        ...(f.month ? [f.month] : []),
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  NEW EMPLOYEE DETAIL REPORTS (5)
  // ══════════════════════════════════════════════════════════════════════════

  emp_emergency_contact: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               e.full_name,
               b.branch_name,
               e.employment_status,
               ec.contact_seq,
               ec.is_primary,
               ec.name AS contact_name,
               ec.relationship,
               ec.mobile AS contact_mobile,
               ec.address AS contact_address
             FROM employee_emergency_contact ec
             JOIN employees e ON e.id = ec.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.status ? 'AND e.employment_status = ?' : ''}
            ORDER BY e.employee_code, ec.is_primary DESC, ec.contact_seq`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.status ? [f.status] : []),
      ],
    };
  },

  emp_nominee: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               e.full_name,
               b.branch_name,
               n.nominee_name,
               n.relationship,
               n.date_of_birth AS nominee_dob,
               n.nominee_for,
               n.share_percentage,
               n.is_minor,
               n.guardian_name,
               n.guardian_relation,
               n.mobile AS nominee_mobile,
               n.address AS nominee_address
             FROM employee_nominee n
             JOIN employees e ON e.id = n.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE e.active_status = 1
              AND ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
            ORDER BY e.employee_code, n.nominee_for`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
      ],
    };
  },

  emp_probation: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               e.full_name,
               b.branch_name,
               proc.process_name,
               desig.designation_name,
               e.date_of_joining,
               ep.probation_start_date,
               ep.probation_end_date,
               ep.actual_end_date,
               ep.extended_end_date,
               ep.status AS probation_status,
               ep.extension_reason,
               ep.confirmation_remarks,
               CONCAT(conf.first_name,' ',COALESCE(conf.last_name,'')) AS confirmed_by
             FROM employee_probation ep
             JOIN employees e ON e.id = ep.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN process_master proc ON proc.id = e.process_id
             LEFT JOIN designation_master desig ON desig.id = e.designation_id
             LEFT JOIN employees conf ON conf.id = ep.confirmed_by
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.status ? 'AND ep.status = ?' : ''}
            ORDER BY ep.probation_end_date, b.branch_name`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.status ? [f.status] : []),
      ],
    };
  },

  emp_job_history: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               e.full_name,
               b.branch_name,
               jh.effective_date,
               jh.change_type,
               fd.designation_name AS from_designation,
               td.designation_name AS to_designation,
               fdept.dept_name AS from_department,
               tdept.dept_name AS to_department,
               fb.branch_name AS from_branch,
               tb.branch_name AS to_branch,
               fp.process_name AS from_process,
               tp.process_name AS to_process,
               jh.from_ctc_annual,
               jh.to_ctc_annual,
               jh.reason
             FROM employee_job_history jh
             JOIN employees e ON e.id = jh.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN designation_master fd ON fd.id = jh.from_designation_id
             LEFT JOIN designation_master td ON td.id = jh.to_designation_id
             LEFT JOIN department_master fdept ON fdept.id = jh.from_department_id
             LEFT JOIN department_master tdept ON tdept.id = jh.to_department_id
             LEFT JOIN branch_master fb ON fb.id = jh.from_branch_id
             LEFT JOIN branch_master tb ON tb.id = jh.to_branch_id
             LEFT JOIN process_master fp ON fp.id = jh.from_process_id
             LEFT JOIN process_master tp ON tp.id = jh.to_process_id
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND jh.effective_date >= ?' : ''}
              ${f.dateTo ? 'AND jh.effective_date <= ?' : ''}
              ${f.changeType ? 'AND jh.change_type = ?' : ''}
            ORDER BY e.employee_code, jh.effective_date`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
        ...(f.changeType ? [f.changeType] : []),
      ],
    };
  },

  emp_salary_history: (f, scope) => {
    const sc = scopeClause(scope, 'e.branch_id');
    return {
      sql: `SELECT
               e.employee_code,
               e.full_name,
               b.branch_name,
               sa.effective_from,
               sa.effective_to,
               sa.ctc_annual,
               ss.structure_name,
               ss.structure_code,
               sa.active_status AS is_current
             FROM employee_salary_assignment sa
             JOIN employees e ON e.id = sa.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
             LEFT JOIN salary_structure_master ss ON ss.id = sa.structure_id
            WHERE ${sc.sql}
              ${f.branch ? 'AND e.branch_id = ?' : ''}
              ${f.dateFrom ? 'AND sa.effective_from >= ?' : ''}
              ${f.dateTo ? 'AND sa.effective_from <= ?' : ''}
            ORDER BY e.employee_code, sa.effective_from DESC`,
      params: [
        ...sc.params,
        ...(f.branch ? [f.branch] : []),
        ...(f.dateFrom ? [f.dateFrom] : []),
        ...(f.dateTo ? [f.dateTo] : []),
      ],
    };
  },
};

// ── Service ───────────────────────────────────────────────────────────────────

export const reportingService = {
  async leaveBalanceOverview(year: number, userId: string, filters?: { branchId?: string; processId?: string }) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw Object.assign(new Error("year must be between 2000 and 2100"), { statusCode: 400 });
    }
    const scope = await resolveBranchScope(userId);
    const sc = scopeClause(scope, "e.branch_id");
    const extraConds: string[] = [];
    const extraParams: unknown[] = [];
    if (filters?.branchId)  { extraConds.push("e.branch_id = ?");  extraParams.push(filters.branchId); }
    if (filters?.processId) { extraConds.push("e.process_id = ?"); extraParams.push(filters.processId); }
    const extraSql = extraConds.length ? "AND " + extraConds.join(" AND ") : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id,
              e.employee_code,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
              COALESCE(NULLIF(TRIM(dm.dept_name), ''), 'Unassigned') AS department_name,
              lt.id AS leave_type_id,
              lt.leave_name,
              COALESCE(lbl.allocated_days, 0) + COALESCE(lbl.adjusted_days, 0) AS total_days,
              COALESCE(lbl.used_days, 0) AS used_days
         FROM employees e
         CROSS JOIN leave_type_master lt
         LEFT JOIN department_master dm ON dm.id = e.department_id
         LEFT JOIN leave_balance_ledger lbl
           ON lbl.employee_id = e.id
          AND lbl.leave_type_id = lt.id
          AND lbl.balance_year = ?
        WHERE e.active_status = 1
          AND lt.active_status = 1
          AND ${sc.sql}
          ${extraSql}
        ORDER BY e.employee_code, lt.leave_name`,
      [year, ...sc.params, ...extraParams]
    );

    const leaveTypes = Array.from(new Set(rows.map((row) => String(row.leave_name))));
    const records = new Map<string, {
      employeeId: string;
      employeeCode: string;
      employeeName: string;
      department: string;
      balances: Array<{ leaveType: string; total: number; used: number; remaining: number }>;
    }>();
    for (const row of rows) {
      const employeeId = String(row.employee_id);
      if (!records.has(employeeId)) {
        records.set(employeeId, {
          employeeId,
          employeeCode: String(row.employee_code ?? ""),
          employeeName: String(row.employee_name ?? ""),
          department: String(row.department_name ?? "Unassigned"),
          balances: [],
        });
      }
      const total = Number(row.total_days ?? 0);
      const used = Number(row.used_days ?? 0);
      records.get(employeeId)!.balances.push({
        leaveType: String(row.leave_name),
        total,
        used,
        remaining: total - used,
      });
    }
    return { year, leaveTypes, records: Array.from(records.values()) };
  },

  async analyticsOverview(
    year: number,
    userId: string
  ): Promise<{
    employeeGrowth: Array<{ month: string; employees: number }>;
    departmentDistribution: Array<{ name: string; value: number }>;
    leaveStatistics: { monthlyData: Array<Record<string, string | number>>; leaveTypeKeys: string[] };
    payrollTrend: Array<{ month: string; amount: number }>;
    headcount: {
      newHires: number;
      terminations: number;
      netChange: number;
      currentHeadcount: number;
      startOfYearHeadcount: number;
      monthlyBreakdown: Array<{ month: string; hires: number; terminations: number; net: number }>;
    };
  }> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw Object.assign(new Error("year must be between 2000 and 2100"), { statusCode: 400 });
    }

    const scope = await resolveBranchScope(userId);
    const employeeScope = scopeClause(scope, "e.branch_id");
    const [employeeRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.date_of_joining,
              COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date) AS exit_date,
              e.active_status,
              e.employment_status,
              COALESCE(NULLIF(TRIM(dm.dept_name), ''), 'Unassigned') AS department_name
         FROM employees e
         LEFT JOIN department_master dm ON dm.id = e.department_id
        WHERE ${employeeScope.sql}`,
      employeeScope.params
    );

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const toDate = (value: unknown): Date | null => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const employees = employeeRows.map((row) => ({
      joined: toDate(row.date_of_joining),
      exited: toDate(row.exit_date),
      active: Number(row.active_status) === 1,
      terminated: ['resigned', 'inactive', 'terminated'].includes(String(row.employment_status ?? '').toLowerCase()),
      department: String(row.department_name ?? "Unassigned"),
    }));

    const monthlyBreakdown = monthNames.map((month, index) => {
      const start = new Date(year, index, 1);
      const end = new Date(year, index + 1, 0, 23, 59, 59, 999);
      const hires = employees.filter((employee) =>
        employee.joined && employee.joined >= start && employee.joined <= end
      ).length;
      const terminations = employees.filter((employee) => {
        if (employee.exited && employee.exited >= start && employee.exited <= end) return true;
        // Also catch employees without exit_date but with terminated status who joined before this month
        return false;
      }).length;
      return { month, hires, terminations, net: hires - terminations };
    });

    // Growth: closing active headcount per month end
    // An employee is active at end of month M if joined <= month_end AND (no exit OR exit > month_end)
    const employeeGrowth = monthNames.map((month, index) => {
      const end = new Date(year, index + 1, 0, 23, 59, 59, 999);
      const count = employees.filter((employee) => {
        const joinedBeforeEnd = !employee.joined || employee.joined <= end;
        const notExitedYet = !employee.exited || employee.exited > end;
        return joinedBeforeEnd && notExitedYet && employee.active;
      }).length;
      return { month, employees: count };
    });

    const departmentMap = new Map<string, number>();
    for (const employee of employees) {
      if (!employee.active) continue;
      departmentMap.set(employee.department, (departmentMap.get(employee.department) ?? 0) + 1);
    }
    const departmentDistribution = Array.from(departmentMap, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const leaveScope = scopeClause(scope, "e.branch_id");
    const [leaveRows] = await db.execute<RowDataPacket[]>(
      `SELECT MONTH(lr.from_date) AS month_no,
              lt.leave_name,
              SUM(lr.total_days) AS total_days
         FROM leave_request lr
         JOIN employees e ON e.id = lr.employee_id
         JOIN leave_type_master lt ON lt.id = lr.leave_type_id
        WHERE YEAR(lr.from_date) = ?
          AND LOWER(lr.status) = 'approved'
          AND lt.active_status = 1
          AND ${leaveScope.sql}
        GROUP BY MONTH(lr.from_date), lt.leave_name
        ORDER BY month_no, lt.leave_name`,
      [year, ...leaveScope.params]
    );
    const leaveNames = Array.from(new Set(leaveRows.map((row) => String(row.leave_name))));
    const leaveKey = (name: string) => name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_");
    const leaveTypeKeys = leaveNames.map(leaveKey);
    const monthlyData = monthNames.map((month, index) => {
      const item: Record<string, string | number> = { month };
      for (const name of leaveNames) item[leaveKey(name)] = 0;
      for (const row of leaveRows) {
        if (Number(row.month_no) === index + 1) {
          item[leaveKey(String(row.leave_name))] = Number(row.total_days ?? 0);
        }
      }
      return item;
    });

    const payrollScope = scopeClause(scope, "e.branch_id");
    const [payrollRows] = await db.execute<RowDataPacket[]>(
      `SELECT spr.run_month, SUM(spl.net_salary) AS total_net
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
         JOIN employees e ON e.id = spl.employee_id
        WHERE LEFT(spr.run_month, 4) = ?
          AND LOWER(spr.status) IN ('approved', 'disbursed', 'finalized')
          AND ${payrollScope.sql}
        GROUP BY spr.run_month
        ORDER BY spr.run_month`,
      [String(year), ...payrollScope.params]
    );
    const payrollByMonth = new Map(payrollRows.map((row) => [
      Number(String(row.run_month).slice(5, 7)),
      Number(row.total_net ?? 0),
    ]));
    const payrollTrend = monthNames
      .map((month, index) => ({ month, amount: payrollByMonth.get(index + 1) ?? 0 }));

    const newHires = employees.filter((employee) =>
      employee.joined && employee.joined >= yearStart && employee.joined <= yearEnd
    ).length;
    const terminations = employees.filter((employee) =>
      (employee.exited && employee.exited >= yearStart && employee.exited <= yearEnd) ||
      (employee.terminated && !employee.exited && employee.joined && employee.joined >= yearStart && employee.joined <= yearEnd)
    ).length;
    // Employees active on Jan 1: joined before Jan 1 AND (no exit date OR exit on/after Jan 1)
    const startOfYearHeadcount = employees.filter((employee) => {
      const joinedBeforeYear = !employee.joined || employee.joined < yearStart;
      const notExitedBeforeYear = !employee.exited || employee.exited >= yearStart;
      return joinedBeforeYear && notExitedBeforeYear;
    }).length;

    return {
      employeeGrowth,
      departmentDistribution,
      leaveStatistics: { monthlyData, leaveTypeKeys },
      payrollTrend,
      headcount: {
        newHires,
        terminations,
        netChange: newHires - terminations,
        currentHeadcount: employees.filter((employee) => employee.active).length,
        startOfYearHeadcount,
        monthlyBreakdown,
      },
    };
  },

  async listReports(userId: string): Promise<RowDataPacket[]> {
    const scope = await resolveBranchScope(userId);
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
      [userId]
    );
    const roles = (roleRows as { role_key: string }[]).map(r => r.role_key);
    const canSeeAdminOnly = scope.isSuperAdmin ||
      roles.some(r => ['hr', 'finance', 'payroll', 'ceo'].includes(r));

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM report_master
        WHERE active_status = 1 ${canSeeAdminOnly ? '' : 'AND admin_only = 0'}
        ORDER BY report_category, report_name`
    );
    return rows;
  },

  async runReport(
    reportCode: string,
    filters: Record<string, string>,
    userId: string
  ): Promise<{ columns: string[]; rows: unknown[]; count: number }> {
    const [meta] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM report_master WHERE report_code = ? AND active_status = 1 LIMIT 1',
      [reportCode]
    );
    if (!meta[0]) throw Object.assign(new Error(`Report ${reportCode} not found`), { statusCode: 404 });

    const queryKey = meta[0].query_key as string;
    const builder = QUERIES[queryKey];
    if (!builder) throw Object.assign(new Error(`No query builder for ${queryKey}`), { statusCode: 501 });

    const scope = await resolveBranchScope(userId);

    // If user requests a specific branch but it's outside their scope, reject
    if (!scope.isSuperAdmin && scope.branchIds.length > 0 && filters.branch) {
      if (!scope.branchIds.includes(filters.branch)) {
        throw Object.assign(new Error('Access denied: branch not in your scope'), { statusCode: 403 });
      }
    }

    const { sql, params } = builder(filters, scope);
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows, count: rows.length };
  },
};
