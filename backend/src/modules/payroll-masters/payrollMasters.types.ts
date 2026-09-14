export interface SalarySlab {
  id: string;
  slab_code: string;
  range_from: number;
  range_to: number;
  label: string;
  seq_order: number;
  active_status: number;
  created_at: string;
  updated_at: string;
}

/** Live schema as of migration 326. Replaces the old grade_id/slab_id Schema A. */
export interface SalaryPackage {
  id: string;
  branch_name: string;
  cost_centre_code: string | null;
  band_code: string;
  package_amount: number;
  // Earnings
  basic: number;
  hra: number;
  lta: number;
  conveyance: number;
  portfolio: number;
  medical: number;
  special_allowance: number;
  other_allowance: number;
  bonus: number;
  pli: number;
  gross: number;
  // Statutory deductions (employee)
  epf_employee: number;
  esic_employee: number;
  professional_tax: number;
  net_in_hand: number;
  // Employer contributions
  epf_employer: number;
  esic_employer: number;
  admin_charges: number;
  ctc: number;
  active_status: number;
  source_db: string;
  source_id: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // optional join columns
  grade_name?: string;
  band?: string;
}

export interface DesignationBandEntry {
  id: string;
  department_id: string;
  designation_id: string;
  grade_id: string;
  min_slab_id: string | null;
  active_status: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joins
  department_name?: string;
  designation_name?: string;
  grade_name?: string;
  band?: string;
  min_slab_label?: string;
}
