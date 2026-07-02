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

export interface SalaryPackage {
  id: string;
  grade_id: string;
  slab_id: string;
  location_id: string | null;
  cost_centre_id: string | null;
  basic_amt: number;
  conveyance_amt: number;
  conveyance_type: 'fixed' | 'pct';
  medical_amt: number;
  medical_type: 'fixed' | 'pct';
  other_allowance_amt: number;
  other_allowance_type: 'fixed' | 'pct';
  bonus_amt: number;
  bonus_type: 'fixed' | 'pct';
  portfolio_amt: number;
  special_allowance_amt: number;
  pli_amt: number;
  gross_monthly: number;
  ctc_monthly: number;
  effective_from: string;
  active_status: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joins
  grade_name?: string;
  slab_label?: string;
  location_name?: string;
  cost_centre_name?: string;
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
