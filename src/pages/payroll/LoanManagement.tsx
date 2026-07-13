import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BadgeIndianRupee,
  ChevronDown,
  ChevronRight,
  PlusCircle,
  Search,
  RefreshCw,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoanRecord {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  loan_type: string;
  amount: string | number;
  start_date: string;
  end_date: string | null;
  installments: number;
  deduction_per_month: string | number;
  deducted_amount: string | number;
  pending_amount: string | number;
  status: "active" | "completed" | "cancelled";
  reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  cheque_number: string | null;
  cheque_bank: string | null;
  rtgs_number: string | null;
  branch_name: string | null;
  created_at: string;
}

interface LoansListResponse {
  success: boolean;
  data: LoanRecord[];
  total: number;
  page: number;
  limit: number;
}

interface EmployeeLoansSummaryData {
  loans: LoanRecord[];
  total_deducted: number;
  total_pending: number;
}

interface EmployeeLoansResponse {
  success: boolean;
  data: EmployeeLoansSummaryData;
}

interface ScheduleEntry {
  month: string;
  emi: number;
  running_balance: number;
}

interface ScheduleResponse {
  success: boolean;
  data: ScheduleEntry[];
}

interface CreateLoanResponse {
  success: boolean;
  data: LoanRecord;
}

interface UpdateLoanResponse {
  success: boolean;
  data: LoanRecord;
}

interface RecordPaymentResponse {
  success: boolean;
  data: LoanRecord;
}

interface EmployeeSearchResult {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  designation?: string;
  branch_name?: string;
}

interface EmployeeSearchApiResponse {
  employees?: EmployeeSearchResult[];
  data?: EmployeeSearchResult[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOAN_TYPES = [
  "Salary Advance",
  "Personal Loan",
  "Emergency Advance",
  "Other",
] as const;

const STATUS_LIMIT = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtAmount(val: string | number | undefined): string {
  const n = Number(val ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleDateString("en-IN");
  } catch {
    return val;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "completed":
      return "bg-green-100 text-green-800 border-green-200";
    case "cancelled":
      return "bg-slate-100 text-slate-600 border-slate-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

// ---------------------------------------------------------------------------
// Sub-component: Repayment Schedule (inline expandable)
// ---------------------------------------------------------------------------

interface SchedulePanelProps {
  loanId: string;
}

function SchedulePanel({ loanId }: SchedulePanelProps) {
  const { data, isLoading, isError } = useQuery<ScheduleResponse>({
    queryKey: ["loan-schedule", loanId],
    queryFn: () =>
      hrmsApi.get<ScheduleResponse>(`/api/payroll/loans/${loanId}/schedule`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-sm text-slate-400 animate-pulse">
        Loading schedule…
      </div>
    );
  }
  if (isError || !data?.data?.length) {
    return (
      <div className="px-4 py-3 text-sm text-slate-400">
        {isError ? "Failed to load schedule." : "No schedule data available."}
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 pt-1">
      <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">
        Repayment Schedule
      </p>
      <div className="overflow-x-auto rounded border border-slate-100">
        <table className="text-xs w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-3 py-2 text-left font-medium text-slate-600">#</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Month</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">EMI</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((row, idx) => (
              <tr
                key={row.month}
                className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}
              >
                <td className="px-3 py-1.5 text-slate-400">{idx + 1}</td>
                <td className="px-3 py-1.5 text-slate-700">{row.month}</td>
                <td className="px-3 py-1.5 text-right text-slate-700">
                  {fmtAmount(row.emi)}
                </td>
                <td
                  className={`px-3 py-1.5 text-right font-medium ${
                    row.running_balance === 0
                      ? "text-green-600"
                      : "text-slate-700"
                  }`}
                >
                  {fmtAmount(row.running_balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Record Payment Dialog
// ---------------------------------------------------------------------------

interface RecordPaymentDialogProps {
  open: boolean;
  loan: LoanRecord | null;
  onClose: () => void;
  onSuccess: () => void;
}

function RecordPaymentDialog({
  open,
  loan,
  onClose,
  onSuccess,
}: RecordPaymentDialogProps) {
  const [amountPaid, setAmountPaid] = useState("");

  const mutation = useMutation<RecordPaymentResponse, Error, { id: string; amount_paid: number }>({
    mutationFn: ({ id, amount_paid }) =>
      hrmsApi.post<RecordPaymentResponse>(`/api/payroll/loans/${id}/record-payment`, {
        amount_paid,
      }),
    onSuccess: () => {
      toast.success("Payment recorded successfully.");
      setAmountPaid("");
      onSuccess();
      onClose();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to record payment.");
    },
  });

  const handleSubmit = () => {
    if (!loan) return;
    const n = Number(amountPaid);
    if (!n || Number.isNaN(n) || n <= 0) {
      toast.error("Enter a valid positive amount.");
      return;
    }
    mutation.mutate({ id: loan.id, amount_paid: n });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            Record Manual Payment
          </DialogTitle>
        </DialogHeader>

        {loan && (
          <div className="space-y-4 py-1">
            <div className="rounded-md bg-slate-50 border border-slate-100 px-4 py-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Employee</span>
                <span className="font-medium">{loan.employee_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Loan Type</span>
                <span>{loan.loan_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pending</span>
                <span className="text-orange-600 font-semibold">
                  {fmtAmount(loan.pending_amount)}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="amount_paid">Amount Paid (₹)</Label>
              <Input
                id="amount_paid"
                type="number"
                min="1"
                step="0.01"
                placeholder="e.g. 5000"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending || !amountPaid}>
            {mutation.isPending ? "Saving…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Loans Table
// ---------------------------------------------------------------------------

interface LoansTableProps {
  loans: LoanRecord[];
  showAdminActions: boolean;
  onPaymentClick: (loan: LoanRecord) => void;
  showProgress?: boolean;
}

function LoansTable({
  loans,
  showAdminActions,
  onPaymentClick,
  showProgress = false,
}: LoansTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loans.length === 0) {
    return (
      <div className="py-12 text-center text-slate-400 text-sm">
        No loan records found.
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Employee</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Monthly EMI</TableHead>
            <TableHead className="text-right">Deducted</TableHead>
            <TableHead className="text-right">Pending</TableHead>
            <TableHead>Status</TableHead>
            {showAdminActions && (
              <TableHead className="text-right">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loans.map((loan) => (
            <>
              <TableRow
                key={`row-${loan.id}`}
                className="cursor-pointer hover:bg-slate-50/60"
              >
                <TableCell>
                  <button
                    type="button"
                    onClick={() => toggleExpand(loan.id)}
                    className="p-0.5 rounded text-slate-400 hover:text-slate-700"
                    aria-label="Expand schedule"
                  >
                    {expanded.has(loan.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="font-medium text-sm">
                    {loan.employee_name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {loan.employee_code}
                  </div>
                  {showProgress && (
                    <div className="mt-1 w-28">
                      <Progress
                        value={
                          Number(loan.amount) > 0
                            ? (Number(loan.deducted_amount) / Number(loan.amount)) * 100
                            : 0
                        }
                        className="h-1"
                      />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm">{loan.loan_type}</TableCell>
                <TableCell className="text-right text-sm">
                  {fmtAmount(loan.amount)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {fmtAmount(loan.deduction_per_month)}
                </TableCell>
                <TableCell className="text-right text-sm text-green-700">
                  {fmtAmount(loan.deducted_amount)}
                </TableCell>
                <TableCell className="text-right text-sm font-medium text-orange-600">
                  {fmtAmount(loan.pending_amount)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${statusBadgeClass(loan.status)}`}
                  >
                    {loan.status}
                  </Badge>
                </TableCell>
                {showAdminActions && (
                  <TableCell className="text-right">
                    {loan.status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => onPaymentClick(loan)}
                      >
                        <Wallet className="h-3.5 w-3.5 mr-1" />
                        Record Payment
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
              {expanded.has(loan.id) && (
                <TableRow key={`schedule-${loan.id}`} className="bg-slate-50/40">
                  <TableCell
                    colSpan={showAdminActions ? 9 : 8}
                    className="p-0"
                  >
                    <SchedulePanel loanId={loan.id} />
                  </TableCell>
                </TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Add Loan Dialog
// ---------------------------------------------------------------------------

interface AddLoanDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface AddLoanForm {
  employee_code: string;
  employee_id: string;
  employee_name: string;
  loan_type: string;
  amount: string;
  start_date: string;
  installments: string;
  deduction_per_month: string;
  reason: string;
}

const emptyForm: AddLoanForm = {
  employee_code: "",
  employee_id: "",
  employee_name: "",
  loan_type: "Salary Advance",
  amount: "",
  start_date: "",
  installments: "",
  deduction_per_month: "",
  reason: "",
};

function AddLoanDialog({ open, onClose, onSuccess }: AddLoanDialogProps) {
  const [form, setForm] = useState<AddLoanForm>(emptyForm);
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<EmployeeSearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-calculate EMI when amount or installments change
  useEffect(() => {
    const amt = Number(form.amount);
    const inst = Number(form.installments);
    if (amt > 0 && inst > 0) {
      const emi = parseFloat((amt / inst).toFixed(2));
      setForm((f) => ({ ...f, deduction_per_month: String(emi) }));
    }
  }, [form.amount, form.installments]);

  // Employee search debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!empSearch.trim() || form.employee_id) {
      setEmpResults([]);
      setDropdownOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await hrmsApi.get<EmployeeSearchApiResponse | EmployeeSearchResult[]>(
          `/api/employees?search=${encodeURIComponent(empSearch.trim())}&limit=10`
        );
        const list: EmployeeSearchResult[] = Array.isArray(data)
          ? data
          : ((data as EmployeeSearchApiResponse).employees ??
            (data as EmployeeSearchApiResponse).data ??
            []);
        setEmpResults(list);
        setDropdownOpen(list.length > 0);
      } catch {
        setEmpResults([]);
        setDropdownOpen(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [empSearch, form.employee_id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelectEmp = (emp: EmployeeSearchResult) => {
    setForm((f) => ({
      ...f,
      employee_id: emp.id,
      employee_code: emp.employee_code,
      employee_name: `${emp.first_name} ${emp.last_name}`,
    }));
    setEmpSearch(`${emp.first_name} ${emp.last_name} (${emp.employee_code})`);
    setDropdownOpen(false);
    setEmpResults([]);
  };

  const mutation = useMutation<CreateLoanResponse, Error, Record<string, unknown>>({
    mutationFn: (body) =>
      hrmsApi.post<CreateLoanResponse>("/api/payroll/loans", body),
    onSuccess: () => {
      toast.success("Loan created successfully.");
      setForm(emptyForm);
      setEmpSearch("");
      onSuccess();
      onClose();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create loan.");
    },
  });

  const handleSubmit = () => {
    if (!form.employee_id) {
      toast.error("Please select an employee.");
      return;
    }
    if (!form.loan_type || !form.amount || !form.start_date || !form.installments || !form.deduction_per_month) {
      toast.error("Please fill all required fields.");
      return;
    }
    mutation.mutate({
      employee_id: form.employee_id,
      loan_type: form.loan_type,
      amount: Number(form.amount),
      start_date: form.start_date,
      installments: Number(form.installments),
      deduction_per_month: Number(form.deduction_per_month),
      reason: form.reason || undefined,
    });
  };

  const handleClose = () => {
    setForm(emptyForm);
    setEmpSearch("");
    setEmpResults([]);
    setDropdownOpen(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeIndianRupee className="h-5 w-5 text-blue-600" />
            Add New Loan / Advance
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Employee Search */}
          <div className="space-y-1">
            <Label>Employee *</Label>
            <div className="relative" ref={dropdownRef}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Search by name or code…"
                value={empSearch}
                onChange={(e) => {
                  setEmpSearch(e.target.value);
                  if (form.employee_id) {
                    setForm((f) => ({
                      ...f,
                      employee_id: "",
                      employee_code: "",
                      employee_name: "",
                    }));
                  }
                }}
              />
              {dropdownOpen && empResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {empResults.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm outline-none"
                      onMouseDown={() => handleSelectEmp(emp)}
                    >
                      <span className="font-medium">
                        {emp.first_name} {emp.last_name}
                      </span>
                      <span className="ml-2 text-slate-400 text-xs">
                        {emp.employee_code}
                      </span>
                      {emp.branch_name && (
                        <span className="ml-2 text-slate-400 text-xs">
                          · {emp.branch_name}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Loan Type */}
          <div className="space-y-1">
            <Label>Loan Type *</Label>
            <Select
              value={form.loan_type}
              onValueChange={(v) => setForm((f) => ({ ...f, loan_type: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {LOAN_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount + Start Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="e.g. 50000"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Start Date *</Label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, start_date: e.target.value }))
                }
              />
            </div>
          </div>

          {/* Installments + EMI */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Installments *</Label>
              <Input
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 12"
                value={form.installments}
                onChange={(e) =>
                  setForm((f) => ({ ...f, installments: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Monthly EMI (₹) *</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="Auto-calculated"
                value={form.deduction_per_month}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    deduction_per_month: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-slate-400">
                Auto = amount ÷ installments; editable.
              </p>
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <Label>Reason</Label>
            <Input
              placeholder="Optional reason / purpose"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create Loan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab: All Loans (admin view)
// ---------------------------------------------------------------------------

interface AllLoansTabProps {
  showAdminActions: boolean;
}

function AllLoansTab({ showAdminActions }: AllLoansTabProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [paymentLoan, setPaymentLoan] = useState<LoanRecord | null>(null);

  const queryKey = ["loans-all", page, search, statusFilter];

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(STATUS_LIMIT) });
    if (search) params.set("q", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    return `/api/payroll/loans?${params.toString()}`;
  }, [page, search, statusFilter]);

  const { data, isLoading, isError, refetch } = useQuery<LoansListResponse>({
    queryKey,
    queryFn: () => hrmsApi.get<LoansListResponse>(buildUrl()),
    staleTime: 30_000,
  });

  const totalPages = data ? Math.ceil(data.total / STATUS_LIMIT) : 1;

  const handleAddSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: ["loans-all"] });
  };

  const handlePaymentSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: ["loans-all"] });
  };

  return (
    <div className="space-y-4 mt-4">
      {/* Filter / Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search employee, code, or type…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
        {showAdminActions && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <PlusCircle className="h-4 w-4 mr-1.5" />
            Add Loan
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading && (
        <div className="py-12 text-center text-slate-400 text-sm animate-pulse">
          Loading loans…
        </div>
      )}
      {isError && (
        <div className="py-8 text-center text-red-500 text-sm">
          Failed to load loans. Try refreshing.
        </div>
      )}
      {!isLoading && !isError && (
        <>
          <LoansTable
            loans={data?.data ?? []}
            showAdminActions={showAdminActions}
            onPaymentClick={(loan) => setPaymentLoan(loan)}
          />
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>
                Page {page} of {totalPages} — {data?.total ?? 0} records
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Loan Dialog */}
      <AddLoanDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={handleAddSuccess}
      />

      {/* Record Payment Dialog */}
      <RecordPaymentDialog
        open={!!paymentLoan}
        loan={paymentLoan}
        onClose={() => setPaymentLoan(null)}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: My Loans (employee self-view)
// ---------------------------------------------------------------------------

interface MyLoansTabProps {
  employeeId: string | null;
}

function MyLoansTab({ employeeId }: MyLoansTabProps) {
  const { data, isLoading, isError } = useQuery<EmployeeLoansResponse>({
    queryKey: ["loans-mine", employeeId],
    queryFn: () =>
      hrmsApi.get<EmployeeLoansResponse>(`/api/payroll/loans/employee/${employeeId}`),
    enabled: !!employeeId,
    staleTime: 30_000,
  });

  if (!employeeId) {
    return (
      <div className="mt-4 py-12 text-center text-slate-400 text-sm">
        Employee record not linked to your account. Contact HR.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-4 py-12 text-center text-slate-400 text-sm animate-pulse">
        Loading your loans…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-4 py-8 text-center text-red-500 text-sm">
        Failed to load loans. Please try again.
      </div>
    );
  }

  const summary = data?.data;
  const loans = summary?.loans ?? [];

  return (
    <div className="mt-4 space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Active Loans
            </p>
            <p className="text-2xl font-bold text-slate-800">
              {loans.filter((l) => l.status === "active").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Total Deducted
            </p>
            <p className="text-2xl font-bold text-green-700">
              {fmtAmount(summary?.total_deducted ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Total Pending
            </p>
            <p className="text-2xl font-bold text-orange-600">
              {fmtAmount(summary?.total_pending ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <LoansTable
        loans={loans}
        showAdminActions={false}
        onPaymentClick={() => undefined}
        showProgress
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Pending Approval (active loans awaiting disbursement — finance view)
// ---------------------------------------------------------------------------

function PendingApprovalTab() {
  const queryClient = useQueryClient();
  const [paymentLoan, setPaymentLoan] = useState<LoanRecord | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<LoansListResponse>({
    queryKey: ["loans-pending-active"],
    queryFn: () =>
      hrmsApi.get<LoansListResponse>("/api/payroll/loans?status=active&limit=200"),
    staleTime: 30_000,
  });

  const handlePaymentSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: ["loans-pending-active"] });
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Active loans awaiting disbursement or pending first deduction.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-slate-400 text-sm animate-pulse">
          Loading…
        </div>
      )}
      {isError && (
        <div className="py-8 text-center text-red-500 text-sm">
          Failed to load. Try refreshing.
        </div>
      )}
      {!isLoading && !isError && (
        <LoansTable
          loans={data?.data ?? []}
          showAdminActions
          onPaymentClick={(loan) => setPaymentLoan(loan)}
        />
      )}

      <RecordPaymentDialog
        open={!!paymentLoan}
        loan={paymentLoan}
        onClose={() => setPaymentLoan(null)}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function LoanManagement() {
  const { roleKeys, employeeId, isLoading: roleLoading } = useWorkforceAccess();

  const isAdmin = roleKeys.some((r) =>
    ["super_admin", "admin", "payroll_head", "payroll", "hr"].includes(r)
  );
  const isFinance = roleKeys.some((r) =>
    ["finance", "super_admin", "admin"].includes(r)
  );
  const canCreate = roleKeys.some((r) =>
    ["super_admin", "admin", "payroll_head", "finance"].includes(r)
  );

  const defaultTab = isAdmin ? "all" : "mine";

  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="p-8 text-slate-400 text-sm animate-pulse">
          Loading access…
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <BadgeIndianRupee className="h-6 w-6 text-blue-600" />
              Loan Management
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Employee loans, salary advances and repayment tracking.
              Active loan EMIs are deducted automatically each payroll run.
            </p>
          </div>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList>
            {isAdmin && <TabsTrigger value="all">All Loans</TabsTrigger>}
            <TabsTrigger value="mine">My Loans</TabsTrigger>
            {isFinance && (
              <TabsTrigger value="pending">Pending Approval</TabsTrigger>
            )}
          </TabsList>

          {/* All Loans Tab */}
          {isAdmin && (
            <TabsContent value="all">
              <AllLoansTab showAdminActions={canCreate} />
            </TabsContent>
          )}

          {/* My Loans Tab */}
          <TabsContent value="mine">
            <MyLoansTab employeeId={employeeId} />
          </TabsContent>

          {/* Pending Approval Tab */}
          {isFinance && (
            <TabsContent value="pending">
              <PendingApprovalTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
