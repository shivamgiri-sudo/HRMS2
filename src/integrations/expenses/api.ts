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
import { apiBaseUrl } from '@/lib/apiBase';

const API_BASE = apiBaseUrl();
const DEMO_LOGIN_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';

function getAuthHeaders(): Record<string, string> {
  const mysqlToken = localStorage.getItem('hrms_access_token');
  if (mysqlToken) return { 'Content-Type': 'application/json', Authorization: `Bearer ${mysqlToken}` };

  const demoRaw = DEMO_LOGIN_ENABLED ? localStorage.getItem('hrms_demo_session') : null;
  if (demoRaw) {
    try {
      const demo = JSON.parse(demoRaw);
      const token = demo?.access_token;
      if (token) return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    } catch {
      // fall through
    }
  }
  return { 'Content-Type': 'application/json' };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: getAuthHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try { message = JSON.parse(text)?.error ?? JSON.parse(text)?.message ?? text; } catch { message = text || message; }
    throw new Error(message);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

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
    const headers: Record<string, string> = {};
    const mysqlToken = localStorage.getItem('hrms_access_token');
    if (mysqlToken) headers.Authorization = `Bearer ${mysqlToken}`;
    const res = await fetch(`${API_BASE}/api/expenses/claims/export-for-payment?${params}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
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
