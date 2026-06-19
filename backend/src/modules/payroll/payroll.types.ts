export interface SalaryStructure {
  id: string;
  structure_code: string;
  structure_name: string;
  description: string | null;
  basic_pct: number;   // % of gross CTC for Basic (default 40)
  hra_pct: number;     // % of gross CTC for HRA (default 20)
  active_status: number;
  created_at: string;
}

export interface BulkAssignInput {
  structureId: string;
  ctcAnnual: number;
  effectiveFrom: string;
  processId?: string;
  branchId?: string;
}

export interface BulkAssignResult {
  assigned: number;
  skipped: number;
}

export interface SalaryComponent {
  id: string;
  component_code: string;
  component_name: string;
  component_type: string;
  taxable: number;
  active_status: number;
  created_at: string;
}

export interface EmployeeSalaryAssignment {
  id: string;
  employee_id: string;
  structure_id: string;
  ctc_annual: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  created_at: string;
}

export interface SalaryPrepRun {
  id: string;
  run_month: string;
  branch_filter: string | null;
  process_filter: string | null;
  status: string;
  total_employees: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  created_by: string | null;
  approved_by: string | null;
  disbursed_by: string | null;
  disbursed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalaryPrepLine {
  id: string;
  run_id: string;
  employee_id: string;
  employee_code: string;
  working_days: number;
  present_days: number;
  leave_days: number;
  lwp_days: number;
  late_marks: number;
  dialer_hours: number | null;
  overtime_hours: number | null;
  overtime_amount: number | null;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  pf_employee: number;
  pf_employer: number;
  esic_employee: number;
  esic_employer: number;
  professional_tax: number;
  tds: number;
  remarks: string | null;
  status: string;
}

export interface SalaryAdvance {
  id: string;
  employee_id: string;
  advance_date: string;
  amount: number;
  recovery_months: number;
  recovered_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface SalaryAllowance {
  name: string;
  amount: number;
}

export interface NetSalaryResult {
  // Component breakdown
  basic: number;
  hra: number;
  special_allowance: number;
  allowances: SalaryAllowance[];
  allowances_total: number;
  gross_salary: number;
  // Employee deductions
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  tds: number;
  total_deductions: number;
  net_salary: number;
  // Employer contributions (CTC cost, not deducted from employee)
  pf_employer: number;
  pf_employer_epf: number; // 3.67% of pfBase
  pf_employer_eps: number; // 8.33% of min(Basic, EPS wage ceiling ₹15000)
  esic_employer: number;
  gratuity: number;        // 4.81% of Basic (employer cost)
  ctc_monthly: number;     // gross + employer PF + employer ESIC + gratuity
}

export interface NetSalaryParams {
  grossMonthlyCTC: number;
  workingDays: number;
  lwpDays: number;
  pfEmployeePct: number;
  esicEmployeePct: number;
  esicWageLimit: number;
  pfWageLimit: number;     // statutory PF wage ceiling (₹15,000)
  professionalTax: number;
  tds: number;
  basicPct: number;        // % of gross CTC allocated to Basic (default 40)
  hraPct: number;          // % of gross CTC allocated to HRA (default 20)
  allowances?: SalaryAllowance[]; // variable pay: night shift, incentives, etc.
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
