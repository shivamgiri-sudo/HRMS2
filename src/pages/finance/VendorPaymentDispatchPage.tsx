import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Download,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import { PaymentDispatchSheet } from "@/components/finance/vendor/PaymentDispatchSheet";

interface PaymentCapabilities {
  canRead: boolean;
  canWrite: boolean;
  readScope: "organisation" | "branch";
  writeRole: string | null;
  paymentModel?: "installment_ledger";
}

interface VendorPayment {
  id: string;
  grn_request_id: string;
  grn_number?: string | null;
  branch_id: string;
  branch_name?: string | null;
  process_id?: string | null;
  process_name?: string | null;
  cost_centre_id?: string | null;
  cost_centre_name?: string | null;
  cost_class?: "direct" | "indirect";
  vendor_name?: string | null;
  head?: string | null;
  sub_head?: string | null;
  amount_without_tax?: number;
  tax_amount?: number;
  amount_with_tax?: number;
  due_amount: number;
  due_date?: string | null;
  payment_mode?: string | null;
  payment_date?: string | null;
  bank_id?: string | null;
  bank_name?: string | null;
  transaction_id?: string | null;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  remarks?: string | null;
  grn_file_name?: string | null;
  payment_proof_file_name?: string | null;
}

interface PaymentTransaction {
  id: string;
  sequence_no: number;
  payment_mode: string;
  payment_date: string;
  bank_name?: string | null;
  transaction_id?: string | null;
  amount: number;
  remarks?: string | null;
  proof_file_name?: string | null;
  proof_file_mime?: string | null;
  created_at: string;
}

interface BankMaster {
  id: string;
  bank_name: string;
}

interface BranchOption {
  id: string;
  branch_name?: string;
  name?: string;
}

interface DispatchDraft {
  paymentMode: string;
  paymentDate: string;
  bankId: string;
  transactionId: string;
  paymentAmount: string;
  remarks: string;
  holdReason: string;
}

interface Filters {
  branchId: string;
  month: string;
  paymentStatus: string;
  dueDateFrom: string;
  dueDateTo: string;
  search: string;
}

const PAYMENT_MODES = [
  "Cheque",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "Cash",
  "Bank Transfer",
  "Adjustment",
  "Other",
] as const;
const BANK_MODES = new Set(["Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Bank Transfer"]);
const PAYMENT_STATUSES = [
  "Payment Pending",
  "Partially Paid",
  "Paid",
  "On Hold",
  "Rejected",
  "Closed",
] as const;

const STATUS_CLASS: Record<string, string> = {
  "Payment Pending": "border-amber-200 bg-amber-50 text-amber-700",
  "Partially Paid": "border-blue-200 bg-blue-50 text-blue-700",
  Paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "On Hold": "border-orange-200 bg-orange-50 text-orange-700",
  Rejected: "border-rose-200 bg-rose-50 text-rose-700",
  Closed: "border-slate-200 bg-slate-100 text-slate-600",
};

function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function initialFilters(): Filters {
  return {
    branchId: "",
    month: "",
    paymentStatus: "",
    dueDateFrom: "",
    dueDateTo: "",
    search: "",
  };
}

function initialDraft(row: VendorPayment): DispatchDraft {
  return {
    paymentMode: row.payment_mode ?? "",
    paymentDate: "",
    bankId: row.bank_id ?? "",
    transactionId: "",
    paymentAmount: "",
    remarks: "",
    holdReason: "",
  };
}

function agingDays(dueDate?: string | null) {
  if (!dueDate) return 0;
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000);
}

function branchLabel(branch: BranchOption) {
  return branch.branch_name ?? branch.name ?? branch.id;
}

async function downloadAuthenticated(path: string, filename: string) {
  const blob = await hrmsApi.getBlob(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function VendorPaymentDispatchPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [proofTarget, setProofTarget] = useState<{
    paymentId: string;
    transactionRowId: string;
  } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(initialFilters());
  const [drafts, setDrafts] = useState<Record<string, DispatchDraft>>({});
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [selected, setSelected] = useState<VendorPayment | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: capabilityResponse, isLoading: capabilityLoading } = useQuery({
    queryKey: ["vendor-payment-capabilities"],
    queryFn: () => hrmsApi.get<{ data: PaymentCapabilities }>(
      "/api/finance/vendor-payments/capabilities"
    ),
    staleTime: 5 * 60_000,
  });
  const capabilities = (capabilityResponse as any)?.data as PaymentCapabilities | undefined;
  const canWrite = Boolean(capabilities?.canWrite);

  const { data: bankResponse } = useQuery({
    queryKey: ["finance-banks"],
    queryFn: () => hrmsApi.get<{ data: BankMaster[] }>("/api/finance/banks"),
    staleTime: 10 * 60_000,
  });
  const banks: BankMaster[] = (bankResponse as any)?.data ?? [];

  const { data: branchResponse } = useQuery({
    queryKey: ["vendor-payment-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=500"),
    staleTime: 10 * 60_000,
  });
  const branches: BranchOption[] = branchResponse?.data ?? branchResponse ?? [];

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }, [filters, page]);

  const { data: listResponse, isFetching, refetch, error } = useQuery({
    queryKey: ["vendor-payments", query],
    queryFn: () => hrmsApi.get<{
      rows: VendorPayment[];
      total: number;
      page: number;
      limit: number;
    }>(`/api/finance/vendor-payments?${query}`),
  });

  const rows: VendorPayment[] = (listResponse as any)?.rows ?? [];
  const total = Number((listResponse as any)?.total ?? 0);
  const pageSize = Number((listResponse as any)?.limit ?? 50);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedPayment = rows.find((row) => row.id === selectedPaymentId) ?? null;

  const { data: transactionResponse, isFetching: transactionsLoading } = useQuery({
    queryKey: ["vendor-payment-transactions", selectedPaymentId],
    enabled: Boolean(selectedPaymentId),
    queryFn: () => hrmsApi.get<{ data: PaymentTransaction[] }>(
      `/api/finance/vendor-payments/${selectedPaymentId}/transactions`
    ),
  });
  const transactions: PaymentTransaction[] = (transactionResponse as any)?.data ?? [];

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (!next[row.id]) next[row.id] = initialDraft(row);
      }
      return next;
    });
  }, [rows]);

  function updateDraft(id: string, patch: Partial<DispatchDraft>) {
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? initialDraft(row)), ...patch },
    }));
  }

  function resetDraft(id: string) {
    const row = rows.find((item) => item.id === id);
    setDrafts((current) => {
      const next = { ...current };
      if (row) next[id] = initialDraft(row);
      else delete next[id];
      return next;
    });
  }

  const dispatchMutation = useMutation({
    mutationFn: (id: string) => {
      const draft = drafts[id];
      if (!draft) throw new Error("Payment dispatch row is not ready");
      return hrmsApi.post(`/api/finance/vendor-payments/${id}/dispatch`, {
        paymentMode: draft.paymentMode,
        paymentDate: draft.paymentDate,
        bankId: draft.bankId || undefined,
        transactionId: draft.transactionId.trim() || undefined,
        paymentAmount: Number(draft.paymentAmount),
        remarks: draft.remarks.trim() || undefined,
      });
    },
    onSuccess: (_response, id) => {
      resetDraft(id);
      setSelectedPaymentId(id);
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      void queryClient.invalidateQueries({ queryKey: ["vendor-payment-transactions", id] });
      toast({ title: "Payment installment recorded" });
    },
    onError: (mutationError: Error) => {
      toast({
        title: "Payment dispatch failed",
        description: mutationError.message,
        variant: "destructive",
      });
    },
  });

  const holdMutation = useMutation({
    mutationFn: ({ id, hold }: { id: string; hold: boolean }) =>
      hrmsApi.post(`/api/finance/vendor-payments/${id}/hold`, {
        hold,
        reason: drafts[id]?.holdReason.trim() || undefined,
      }),
    onSuccess: (_response, variables) => {
      resetDraft(variables.id);
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      toast({ title: variables.hold ? "Payment placed on hold" : "Payment hold released" });
    },
    onError: (mutationError: Error) => {
      toast({
        title: "Hold action failed",
        description: mutationError.message,
        variant: "destructive",
      });
    },
  });

  const proofMutation = useMutation({
    mutationFn: ({
      paymentId,
      transactionRowId,
      file,
    }: {
      paymentId: string;
      transactionRowId: string;
      file: File;
    }) => {
      const formData = new FormData();
      formData.append("proof", file);
      return hrmsApi.postForm(
        `/api/finance/vendor-payments/${paymentId}/transactions/${transactionRowId}/upload-proof`,
        formData
      );
    },
    onSuccess: (_response, variables) => {
      setProofTarget(null);
      void queryClient.invalidateQueries({
        queryKey: ["vendor-payment-transactions", variables.paymentId],
      });
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      toast({ title: "Installment proof uploaded" });
    },
    onError: (mutationError: Error) => {
      toast({
        title: "Proof upload failed",
        description: mutationError.message,
        variant: "destructive",
      });
    },
  });

  function onProofSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && proofTarget) proofMutation.mutate({ ...proofTarget, file });
    event.target.value = "";
  }

  function clearFilters() {
    setFilters(initialFilters());
    setPage(1);
  }

  async function exportCsv() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    try {
      await downloadAuthenticated(
        `/api/finance/vendor-payments/export?${params.toString()}`,
        "vendor-payments-export.csv"
      );
    } catch (downloadError) {
      toast({
        title: "Export failed",
        description: downloadError instanceof Error ? downloadError.message : "Unable to export payments",
        variant: "destructive",
      });
    }
  }

  async function downloadFile(path: string, filename: string) {
    try {
      await downloadAuthenticated(path, filename);
    } catch (downloadError) {
      toast({
        title: "File could not be opened",
        description: downloadError instanceof Error ? downloadError.message : "Download failed",
        variant: "destructive",
      });
    }
  }

  const summary = useMemo(() => rows.reduce(
    (totalRow, row) => ({
      due: totalRow.due + Number(row.due_amount ?? 0),
      paid: totalRow.paid + Number(row.paid_amount ?? 0),
      balance: totalRow.balance + Number(row.balance_amount ?? 0),
      overdue: totalRow.overdue + (
        agingDays(row.due_date) > 0 && !["Paid", "Closed"].includes(row.payment_status)
          ? Number(row.balance_amount ?? 0)
          : 0
      ),
    }),
    { due: 0, paid: 0, balance: 0, overdue: 0 }
  ), [rows]);

  const summaryCards: Array<{
    label: string;
    value: number;
    icon: LucideIcon;
    className: string;
  }> = [
    { label: "Page due", value: summary.due, icon: FileText, className: "text-slate-700" },
    { label: "Page paid", value: summary.paid, icon: CheckCircle2, className: "text-emerald-700" },
    { label: "Page balance", value: summary.balance, icon: Banknote, className: "text-blue-700" },
    { label: "Overdue balance", value: summary.overdue, icon: AlertTriangle, className: "text-rose-700" },
  ];
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <DashboardLayout>
      <input
        ref={proofInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={onProofSelected}
      />
      <div className="flex h-full flex-col">
        {/* ── Slim page header ── */}
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
          <h1 className="text-sm font-semibold text-slate-900">Vendor Payment Dispatch</h1>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={canWrite
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-600"}
            >
              {capabilityLoading ? "Checking access" : canWrite ? "Dispatch access" : "Read-only"}
            </Badge>
            {capabilities?.readScope && (
              <Badge variant="outline">{capabilities.readScope} scope</Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowFilters((v) => !v)}>
              <Filter className="mr-1.5 h-3.5 w-3.5" />Filters
              {activeFilterCount > 0 && (
                <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 text-[10px] text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportCsv()}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div className="flex gap-3 border-b px-4 py-2 text-xs shrink-0">
          <span className="text-slate-500">Page due: <b className="text-slate-900">₹{summary.due.toLocaleString("en-IN")}</b></span>
          <span className="text-slate-500">Paid: <b className="text-slate-900">₹{summary.paid.toLocaleString("en-IN")}</b></span>
          <span className="text-slate-500">Balance: <b className="text-slate-900">₹{summary.balance.toLocaleString("en-IN")}</b></span>
          <span className="text-slate-500">Overdue: <b className="text-rose-600">₹{summary.overdue.toLocaleString("en-IN")}</b></span>
        </div>

        {/* ── Filter bar ── */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 border-b px-4 py-2 shrink-0">
            <Select
              value={filters.branchId || "_all"}
              onValueChange={(value) => {
                setFilters((c) => ({ ...c, branchId: value === "_all" ? "" : value }));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-36 text-xs">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All branches</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>{branchLabel(branch)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="month"
              className="h-7 w-36 text-xs"
              value={filters.month}
              onChange={(e) => { setFilters((c) => ({ ...c, month: e.target.value })); setPage(1); }}
            />
            <Select
              value={filters.paymentStatus || "_all"}
              onValueChange={(value) => {
                setFilters((c) => ({ ...c, paymentStatus: value === "_all" ? "" : value }));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-36 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All statuses</SelectItem>
                {PAYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              className="h-7 text-xs"
              value={filters.dueDateFrom}
              onChange={(e) => { setFilters((c) => ({ ...c, dueDateFrom: e.target.value })); setPage(1); }}
              placeholder="Due from"
            />
            <Input
              type="date"
              className="h-7 text-xs"
              value={filters.dueDateTo}
              onChange={(e) => { setFilters((c) => ({ ...c, dueDateTo: e.target.value })); setPage(1); }}
              placeholder="Due to"
            />
            <div className="relative">
              <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                className="h-7 pl-7 text-xs"
                value={filters.search}
                onChange={(e) => { setFilters((c) => ({ ...c, search: e.target.value })); setPage(1); }}
                placeholder="GRN / vendor / UTR"
              />
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>
              <X className="mr-1 h-3 w-3" />Clear
            </Button>
          </div>
        )}

        {error && (
          <div className="mx-4 mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 shrink-0">
            {error instanceof Error ? error.message : "Unable to load vendor payments"}
          </div>
        )}

        {/* ── Table ── */}
        <div className="flex-1 overflow-auto px-4 py-2">
          {isFetching && rows.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className="h-8 min-w-[120px] text-left font-medium text-slate-500">GRN / Branch</th>
                  <th className="h-8 min-w-[120px] text-left font-medium text-slate-500">Vendor</th>
                  <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Head</th>
                  <th className="h-8 min-w-[80px] text-right font-medium text-slate-500">Balance</th>
                  <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Due date</th>
                  <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Status</th>
                  <th className="h-8 w-16 text-left font-medium text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((p) => (
                  <tr
                    key={p.id}
                    className="h-9 cursor-pointer border-b hover:bg-slate-50"
                    onClick={() => { setSelected(p); setSheetOpen(true); }}
                  >
                    <td className="py-1">
                      <div className="font-medium truncate max-w-[120px]">{p.grn_number ?? p.grn_request_id}</div>
                      <div className="text-slate-400 truncate max-w-[120px]">{p.branch_name}</div>
                    </td>
                    <td className="truncate max-w-[120px] py-1">{p.vendor_name ?? "-"}</td>
                    <td className="truncate max-w-[80px] py-1">{p.head ?? "-"}</td>
                    <td className="py-1 text-right font-medium">
                      ₹{(p.balance_amount ?? 0).toLocaleString("en-IN")}
                    </td>
                    <td className="py-1">{p.due_date ? formatISTDate(p.due_date) : "-"}</td>
                    <td className="py-1">
                      <Badge
                        variant={p.payment_status === "Paid" ? "default" : p.payment_status === "On Hold" ? "destructive" : "secondary"}
                        className="text-xs"
                      >
                        {p.payment_status}
                      </Badge>
                    </td>
                    <td className="py-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={(e) => { e.stopPropagation(); setSelected(p); setSheetOpen(true); }}
                      >
                        Pay
                      </Button>
                    </td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">No payments found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs shrink-0">
          <span className="text-slate-500">
            Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((v) => Math.max(1, v - 1))}
              disabled={page <= 1}
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />Prev
            </Button>
            <span className="font-semibold">{page} / {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
              disabled={page >= totalPages}
            >
              Next<ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Edit Sheet ── */}
      <PaymentDispatchSheet
        payment={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={() => void refetch()}
      />
    </DashboardLayout>
  );
}
