import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { expenseApi } from './api';
import type { CreateExpenseClaimDto, AddExpenseItemDto, ApproveClaimDto, RejectClaimDto, MarkPaidDto, ExpenseStatus, ExpenseReportQuery } from './types';

export const EXPENSE_KEYS = {
  categories: ['expense-categories'] as const,
  myClaims: (status?: ExpenseStatus) => ['my-expense-claims', status] as const,
  claimDetails: (id: number) => ['expense-claim', id] as const,
  pendingApprovals: ['expense-pending-approvals'] as const,
  financeQueue: (status: ExpenseStatus) => ['expense-finance-queue', status] as const,
  summary: (query: ExpenseReportQuery) => ['expense-summary', query] as const,
  monthlyTrends: (months: number) => ['expense-monthly-trends', months] as const,
  topSpenders: (limit: number) => ['expense-top-spenders', limit] as const,
};

export function useExpenseCategories() {
  return useQuery({ queryKey: EXPENSE_KEYS.categories, queryFn: () => expenseApi.listCategories() });
}

export function useCreateClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateExpenseClaimDto) => expenseApi.createClaim(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXPENSE_KEYS.myClaims() })
  });
}

export function useAddClaimItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: AddExpenseItemDto }) =>
      expenseApi.addClaimItem(claimId, dto),
    onSuccess: (_, { claimId }) => qc.invalidateQueries({ queryKey: EXPENSE_KEYS.claimDetails(claimId) })
  });
}

export function useUploadReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, itemId, receiptPath }: { claimId: number; itemId: number; receiptPath: string }) =>
      expenseApi.uploadReceipt(claimId, itemId, receiptPath),
    onSuccess: (_, { claimId }) => qc.invalidateQueries({ queryKey: EXPENSE_KEYS.claimDetails(claimId) })
  });
}

export function useSubmitClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (claimId: number) => expenseApi.submitClaim(claimId),
    onSuccess: (claim) => {
      qc.invalidateQueries({ queryKey: EXPENSE_KEYS.myClaims() });
      qc.invalidateQueries({ queryKey: EXPENSE_KEYS.claimDetails(claim.id) });
    }
  });
}

export function useMyClaims(status?: ExpenseStatus) {
  return useQuery({
    queryKey: EXPENSE_KEYS.myClaims(status),
    queryFn: () => expenseApi.getMyClaims(status)
  });
}

export function useClaimDetails(claimId: number) {
  return useQuery({
    queryKey: EXPENSE_KEYS.claimDetails(claimId),
    queryFn: () => expenseApi.getClaimDetails(claimId),
    enabled: !!claimId
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: EXPENSE_KEYS.pendingApprovals,
    queryFn: () => expenseApi.getPendingApprovals()
  });
}

export function useManagerApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: ApproveClaimDto }) =>
      expenseApi.managerApprove(claimId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: EXPENSE_KEYS.pendingApprovals })
  });
}

export function useRejectClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: RejectClaimDto }) =>
      expenseApi.rejectClaim(claimId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EXPENSE_KEYS.pendingApprovals });
      qc.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('MANAGER_APPROVED' as ExpenseStatus) });
    }
  });
}

export function useFinanceQueue(status: ExpenseStatus) {
  return useQuery({
    queryKey: EXPENSE_KEYS.financeQueue(status),
    queryFn: () => expenseApi.getFinanceQueue(status)
  });
}

export function useFinanceApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: ApproveClaimDto }) =>
      expenseApi.financeApprove(claimId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('MANAGER_APPROVED' as ExpenseStatus) });
      qc.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('FINANCE_APPROVED' as ExpenseStatus) });
    }
  });
}

export function useMarkAsPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, dto }: { claimId: number; dto: MarkPaidDto }) =>
      expenseApi.markAsPaid(claimId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('FINANCE_APPROVED' as ExpenseStatus) });
      qc.invalidateQueries({ queryKey: EXPENSE_KEYS.financeQueue('PAID' as ExpenseStatus) });
    }
  });
}

export function useExpenseSummary(query: ExpenseReportQuery) {
  return useQuery({
    queryKey: EXPENSE_KEYS.summary(query),
    queryFn: () => expenseApi.getExpenseSummary(query)
  });
}

export function useMonthlyTrends(months = 6) {
  return useQuery({
    queryKey: EXPENSE_KEYS.monthlyTrends(months),
    queryFn: () => expenseApi.getMonthlyTrends(months)
  });
}

export function useTopSpenders(limit = 10) {
  return useQuery({
    queryKey: EXPENSE_KEYS.topSpenders(limit),
    queryFn: () => expenseApi.getTopSpenders(limit)
  });
}
