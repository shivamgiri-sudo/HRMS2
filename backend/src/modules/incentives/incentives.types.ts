export interface IncentiveMaster {
  id: string;
  incentive_code: string;
  incentive_name: string;
  description: string | null;
  gl_code: string | null;
  taxable: number;
  pf_applicable: number;
  esic_applicable: number;
  active_status: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncentiveUploadBatch {
  id: string;
  incentive_id: string;
  pay_month: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'applied';
  total_employees: number;
  total_amount: number;
  uploaded_by: string | null;
  upload_filename: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
  // joins
  incentive_name?: string;
  incentive_code?: string;
}

export interface IncentiveUploadLine {
  id: string;
  batch_id: string;
  employee_id: string;
  employee_code: string;
  amount: number;
  remarks: string | null;
  validation_status: 'ok' | 'error';
  validation_msg: string | null;
  created_at: string;
  // joins
  employee_name?: string;
}

export interface IncentiveApprovalLog {
  id: string;
  batch_id: string;
  actor_user_id: string;
  action: 'submitted' | 'approved' | 'rejected' | 'applied';
  remarks: string | null;
  acted_at: string;
}
