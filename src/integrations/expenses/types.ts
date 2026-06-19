export enum ExpenseStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  MANAGER_APPROVED = 'MANAGER_APPROVED',
  FINANCE_APPROVED = 'FINANCE_APPROVED',
  PAID = 'PAID',
  REJECTED = 'REJECTED'
}

export interface ExpenseCategory {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExpenseClaim {
  id: number;
  claim_number: string;
  employee_id: number;
  process_id: number;
  branch_id: number;
  total_amount: number;
  currency: string;
  status: ExpenseStatus;
  submitted_date?: string;
  manager_approved_date?: string;
  finance_approved_date?: string;
  paid_date?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseItem {
  id: number;
  expense_claim_id: number;
  category_id: number;
  expense_date: string;
  amount: number;
  description: string;
  vendor_name?: string;
  receipt_file_path?: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseApproval {
  id: number;
  expense_claim_id: number;
  approver_id: number;
  approval_type: 'MANAGER' | 'FINANCE';
  action: 'APPROVED' | 'REJECTED';
  comments?: string;
  action_date: string;
}

export interface ExpensePayment {
  id: number;
  expense_claim_id: number;
  payment_reference: string;
  payment_date: string;
  payment_method: string;
  processed_by: number;
  created_at: string;
}

export interface ExpenseClaimWithDetails extends ExpenseClaim {
  items?: ExpenseItem[];
  approvals?: ExpenseApproval[];
  payment?: ExpensePayment;
}

export interface CreateExpenseClaimDto {
  process_id: number;
  branch_id: number;
}

export interface AddExpenseItemDto {
  category_id: number;
  expense_date: string;
  amount: number;
  description: string;
  vendor_name?: string;
}

export interface ApproveClaimDto {
  comments?: string;
}

export interface RejectClaimDto {
  rejection_reason: string;
}

export interface MarkPaidDto {
  payment_reference: string;
  payment_date: string;
  payment_method: string;
}

export interface ExpenseReportQuery {
  process_id?: number;
  branch_id?: number;
  start_date?: string;
  end_date?: string;
  group_by?: 'category' | 'employee' | 'branch' | 'process';
}
