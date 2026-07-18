import type {
  ExpenseCategory,
  ExpenseClaim,
  ExpenseItem,
  ExpenseClaimWithDetails,
  CreateExpenseClaimDto,
  AddExpenseItemDto,
  ApproveClaimDto,
  RejectClaimDto,
  MarkPaidDto,
  ExpenseStatus,
  ExpenseReportQuery
} from './types';
import { hrmsApi } from '@/lib/hrmsApi';

// Re-use the centralized hrmsApi client so token handling, refresh logic,
// and demo-session fallback are maintained in a single place.
const request = <T>(method: string, path: string, body?: unknown): Promise<T> => {
  switch (method) {
    case 'GET':    return hrmsApi.get<T>(path);
    case 'POST':   return hrmsApi.post<T>(path, body);
    case 'PUT':    return hrmsApi.put<T>(path, body);
    case 'PATCH':  return hrmsApi.patch<T>(path, body);
    case 'DELETE': return hrmsApi.delete<T>(path);
    default:       return hrmsApi.get<T>(path);
  }
};

export const expenseApi = {
  async listCategories(): Promise<ExpenseCategory[]> {
    const data = await request<{ categories: ExpenseCategory[] }>('GET', '/api/expenses/categories');
    return data.categories;
  },

  async createClaim(dto: CreateExpenseClaimDto): Promise<ExpenseClaim> {
    const data = await request<{ claim: ExpenseClaim }>('POST', '/api/expenses/claims', dto);
    return data.claim;
  },

  async addClaimItem(claimId: number, dto: AddExpenseItemDto): Promise<ExpenseItem> {
    const data = await request<{ item: ExpenseItem }>('POST', `/api/expenses/claims/${claimId}/items`, dto);
    return data.item;
  },

  async deleteClaimItem(itemId: number): Promise<void> {
    await request<void>('DELETE', `/api/expenses/claims/items/${itemId}`);
  },

  async uploadReceipt(claimId: number, itemId: number, receiptPath: string): Promise<string> {
    await request<{ success: boolean; receipt_path: string }>(
      'POST',
      `/api/expenses/claims/${claimId}/items/${itemId}/receipt`,
      { receipt_path: receiptPath }
    );
    return receiptPath;
  },

  async submitClaim(claimId: number): Promise<ExpenseClaim> {
    const data = await request<{ claim: ExpenseClaim }>('POST', `/api/expenses/claims/${claimId}/submit`);
    return data.claim;
  },

  async getMyClaims(status?: ExpenseStatus, page = 1, limit = 20): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.append('status', status);
    return request<{ claims: ExpenseClaim[]; total: number }>('GET', `/api/expenses/claims/my-claims?${params}`);
  },

  async getClaimDetails(claimId: number): Promise<ExpenseClaimWithDetails> {
    const data = await request<{ claim: ExpenseClaimWithDetails }>('GET', `/api/expenses/claims/${claimId}`);
    return data.claim;
  },

  async getPendingApprovals(): Promise<ExpenseClaim[]> {
    const data = await request<{ claims: ExpenseClaim[] }>('GET', '/api/expenses/claims/pending-approval');
    return data.claims;
  },

  async managerApprove(claimId: number, dto: ApproveClaimDto): Promise<ExpenseClaim> {
    const data = await request<{ claim: ExpenseClaim }>('POST', `/api/expenses/claims/${claimId}/manager-approve`, dto);
    return data.claim;
  },

  async rejectClaim(claimId: number, dto: RejectClaimDto): Promise<ExpenseClaim> {
    const data = await request<{ claim: ExpenseClaim }>('POST', `/api/expenses/claims/${claimId}/reject`, dto);
    return data.claim;
  },

  async getFinanceQueue(status: ExpenseStatus, page = 1, limit = 20): Promise<{ claims: ExpenseClaim[]; total: number }> {
    const params = new URLSearchParams({ status, page: String(page), limit: String(limit) });
    return request<{ claims: ExpenseClaim[]; total: number }>('GET', `/api/expenses/claims/finance-queue?${params}`);
  },

  async financeApprove(claimId: number, dto: ApproveClaimDto): Promise<ExpenseClaim> {
    const data = await request<{ claim: ExpenseClaim }>('POST', `/api/expenses/claims/${claimId}/finance-approve`, dto);
    return data.claim;
  },

  async markAsPaid(claimId: number, dto: MarkPaidDto): Promise<ExpenseClaim> {
    const data = await request<{ claim: ExpenseClaim }>('POST', `/api/expenses/claims/${claimId}/mark-paid`, dto);
    return data.claim;
  },

  async exportForPayment(status: ExpenseStatus, startDate?: string, endDate?: string): Promise<Blob> {
    const params = new URLSearchParams({ status });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return hrmsApi.getBlob(`/api/expenses/claims/export-for-payment?${params}`);
  },

  async getExpenseSummary(query: ExpenseReportQuery) {
    const params = new URLSearchParams();
    if (query.process_id) params.append('process_id', String(query.process_id));
    if (query.branch_id) params.append('branch_id', String(query.branch_id));
    if (query.start_date) params.append('start_date', query.start_date);
    if (query.end_date) params.append('end_date', query.end_date);
    if (query.group_by) params.append('group_by', query.group_by);
    return request<{ total_amount: number; claim_count: number; avg_claim_amount: number; by_category: Array<{ category: string; amount: number; count: number }>; by_status: Array<{ status: string; count: number }> }>('GET', `/api/expenses/reports/summary?${params}`);
  },

  async getMonthlyTrends(months = 6) {
    return request<{ trends: Array<{ month: string; claim_count: number; total_amount: number }> }>('GET', `/api/expenses/reports/monthly-trends?months=${months}`);
  },

  async getTopSpenders(limit = 10) {
    return request<{ spenders: Array<{ employee_name: string; employee_code: string; claim_count: number; total_amount: number }> }>('GET', `/api/expenses/reports/top-spenders?limit=${limit}`);
  }
};
