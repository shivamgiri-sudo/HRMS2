export enum ExpenseStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  MANAGER_APPROVED = 'MANAGER_APPROVED',
  FINANCE_APPROVED = 'FINANCE_APPROVED',
  PAID = 'PAID',
  REJECTED = 'REJECTED'
}

export enum ApprovalType {
  MANAGER = 'MANAGER',
  FINANCE = 'FINANCE'
}

export enum ApprovalAction {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export interface ExpenseCategory {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ExpenseClaim {
  // char(36) UUIDs throughout. These were declared number, which is what a claims-plus-items
  // schema with AUTO_INCREMENT keys would have used - but expense_claim.id, employees.id,
  // process_master.id and branch_master.id are all char(36) in this system.
  id: string;
  claim_number: string;
  employee_id: string;
  process_id: string | null;
  branch_id: string | null;
  total_amount: number;
  currency: string;
  status: ExpenseStatus;
  submitted_date?: Date;
  manager_approved_date?: Date;
  finance_approved_date?: Date;
  paid_date?: Date;
  rejection_reason?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ExpenseItem {
  id: string;
  expense_claim_id: string;
  category_id: number;
  expense_date: Date;
  amount: number;
  description: string;
  vendor_name?: string;
  receipt_file_path?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ExpenseApproval {
  id: string;
  expense_claim_id: string;
  approver_id: string;
  approval_type: ApprovalType;
  action: ApprovalAction;
  comments?: string;
  action_date: Date;
}

export interface ExpensePayment {
  id: string;
  expense_claim_id: string;
  payment_reference: string;
  payment_date: Date;
  payment_method: string;
  processed_by: string;
  created_at: Date;
}

export interface CreateExpenseClaimDto {
  process_id?: string | null;
  branch_id?: string | null;
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
  process_id?: string;
  branch_id?: string;
  start_date?: string;
  end_date?: string;
  group_by?: 'category' | 'employee' | 'branch' | 'process';
}

export interface ExpenseClaimWithDetails extends ExpenseClaim {
  items?: ExpenseItem[];
  approvals?: ExpenseApproval[];
  payment?: ExpensePayment;
}
