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
  Eye,
  FileClock,
  FileText,
  Filter,
  History,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

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

  const { data: listResponse, isFetching, error } = useQuery({
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
      <div className="min-h-screen bg-slate-50">
        <input
          ref={proofInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={onProofSelected}
        />

        <div className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1900px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#e8f2fc] text-[#073f78]">
                <Banknote className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-black text-slate-900">Vendor Payment Dispatch</h1>
                  <Badge
                    variant="outline"
                    className={canWrite
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"}
                  >
                    {capabilityLoading
                      ? "Checking access"
                      : canWrite
                        ? "Accounts dispatch access"
                        : "Read-only ledger"}
                  </Badge>
                  {capabilities?.readScope && (
                    <Badge variant="outline">{capabilities.readScope} scope</Badge>
                  )}
                  <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                    Installment ledger
                  </Badge>
                </div>
                <p className="mt-1 max-w-4xl text-sm text-slate-500">
                  Every installment keeps its own amount, bank, UTR or cheque number, date and proof. Approved GRN attribution and tax values remain locked.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}>
                <Filter className="mr-2 size-4" />Filters
                {activeFilterCount > 0 && (
                  <span className="ml-2 rounded-full bg-blue-600 px-1.5 text-[10px] text-white">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
                <Download className="mr-2 size-4" />Export
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] })}
              >
                <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-[1900px] space-y-5 p-4 sm:p-6 lg:p-8">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(({ label, value, icon: Icon, className }) => (
              <Card key={label} className="border-slate-200 shadow-sm">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
                    <p className={`mt-2 text-xl font-black ${className}`}>{money(value)}</p>
                  </div>
                  <Icon className={`size-5 ${className}`} />
                </CardContent>
              </Card>
            ))}
          </div>

          {showFilters && (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select
                    value={filters.branchId || "_all"}
                    onValueChange={(value) => {
                      setFilters((current) => ({
                        ...current,
                        branchId: value === "_all" ? "" : value,
                      }));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All branches</SelectItem>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>{branchLabel(branch)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Due month</Label>
                  <Input
                    type="month"
                    value={filters.month}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, month: event.target.value }));
                      setPage(1);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={filters.paymentStatus || "_all"}
                    onValueChange={(value) => {
                      setFilters((current) => ({
                        ...current,
                        paymentStatus: value === "_all" ? "" : value,
                      }));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All statuses</SelectItem>
                      {PAYMENT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>{status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Due from</Label>
                  <Input
                    type="date"
                    value={filters.dueDateFrom}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, dueDateFrom: event.target.value }));
                      setPage(1);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Due to</Label>
                  <Input
                    type="date"
                    value={filters.dueDateTo}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, dueDateTo: event.target.value }));
                      setPage(1);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>GRN / vendor / UTR</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
                    <Input
                      className="pl-9"
                      value={filters.search}
                      onChange={(event) => {
                        setFilters((current) => ({ ...current, search: event.target.value }));
                        setPage(1);
                      }}
                    />
                  </div>
                </div>
                <div className="flex justify-end sm:col-span-2 lg:col-span-3 xl:col-span-6">
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="mr-2 size-4" />Clear filters
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error instanceof Error ? error.message : "Unable to load vendor payments"}
            </div>
          )}

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[2250px] border-collapse text-xs">
                <thead className="bg-[#073f78] text-white">
                  <tr>
                    {[
                      "Branch & attribution",
                      "GRN / Vendor",
                      "Budget head",
                      "Tax split",
                      "Due & aging",
                      "Paid / balance",
                      "This installment",
                      "Payment mode",
                      "Payment date",
                      "Bank",
                      "UTR / Cheque",
                      "Remarks",
                      "Status / hold",
                      "Files & history",
                      "Dispatch",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="whitespace-nowrap border-r border-white/10 px-3 py-3 text-left font-semibold"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isFetching && rows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="py-20 text-center text-slate-500">
                        <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
                        Loading vendor payments…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="py-20 text-center text-slate-500">
                        <ShieldCheck className="mx-auto mb-3 size-10 text-slate-300" />
                        <p className="font-semibold">No Finance-approved vendor GRNs found</p>
                        <p className="mt-1 text-xs">
                          Records appear here after Branch Head and Finance Head approval.
                        </p>
                      </td>
                    </tr>
                  ) : rows.map((row, index) => {
                    const draft = drafts[row.id] ?? initialDraft(row);
                    const statusLocked = ["Paid", "Closed", "Rejected"].includes(row.payment_status);
                    const onHold = row.payment_status === "On Hold";
                    const editable = canWrite && !statusLocked && !onHold;
                    const overdueDays = agingDays(row.due_date);
                    const overdue = overdueDays > 0 && !["Paid", "Closed"].includes(row.payment_status);
                    const needsBank = BANK_MODES.has(draft.paymentMode);
                    const installment = Number(draft.paymentAmount || 0);
                    const installmentExceedsBalance = installment - Number(row.balance_amount ?? 0) > 0.01;
                    const canDispatch = editable
                      && installment > 0
                      && !installmentExceedsBalance
                      && Boolean(draft.paymentMode)
                      && Boolean(draft.paymentDate)
                      && (draft.paymentMode === "Cash" || Boolean(draft.transactionId.trim()))
                      && (!needsBank || Boolean(draft.bankId));
                    const rowClass = index % 2 ? "bg-slate-50/40" : "bg-white";

                    return (
                      <tr key={row.id} className={`border-b border-slate-100 align-top ${rowClass}`}>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-800">{row.branch_name ?? row.branch_id}</p>
                          <p className="mt-1 text-slate-500">
                            {row.process_name ?? "Shared"} · {row.cost_centre_name ?? "Branch common"}
                          </p>
                          <Badge variant="outline" className="mt-2 text-[10px]">
                            {row.cost_class ?? "indirect"}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-mono font-semibold text-blue-700">{row.grn_number ?? "—"}</p>
                          <p className="mt-1 max-w-[170px] font-medium text-slate-800">{row.vendor_name ?? "—"}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-800">{row.head ?? "—"}</p>
                          <p className="mt-1 text-slate-500">{row.sub_head ?? "General"}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <p>Base: {money(row.amount_without_tax)}</p>
                          <p className="mt-1 text-slate-500">Tax: {money(row.tax_amount)}</p>
                          <p className="mt-1 font-semibold">Gross: {money(row.amount_with_tax ?? row.due_amount)}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <p className="font-black text-slate-800">{money(row.due_amount)}</p>
                          <p className={`mt-1 ${overdue ? "font-semibold text-rose-600" : "text-slate-500"}`}>
                            {row.due_date ? formatISTDate(row.due_date) : "No due date"}
                            {overdue ? ` · ${overdueDays}d overdue` : ""}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <p className="font-semibold text-emerald-700">Paid: {money(row.paid_amount)}</p>
                          <p className="mt-1 font-semibold text-blue-700">Balance: {money(row.balance_amount)}</p>
                        </td>
                        <td className="min-w-[135px] px-3 py-3">
                          {editable ? (
                            <>
                              <Input
                                type="number"
                                className="h-8 text-right"
                                min="0.01"
                                max={Number(row.balance_amount)}
                                step="0.01"
                                value={draft.paymentAmount}
                                onChange={(event) => updateDraft(row.id, { paymentAmount: event.target.value })}
                                placeholder="0.00"
                              />
                              {installmentExceedsBalance && (
                                <p className="mt-1 text-[10px] text-rose-600">Exceeds balance</p>
                              )}
                            </>
                          ) : <span>—</span>}
                        </td>
                        <td className="min-w-[140px] px-3 py-3">
                          {editable ? (
                            <Select
                              value={draft.paymentMode || "_none"}
                              onValueChange={(value) => updateDraft(row.id, {
                                paymentMode: value === "_none" ? "" : value,
                                bankId: value === "Cash" ? "" : draft.bankId,
                              })}
                            >
                              <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_none">Select mode</SelectItem>
                                {PAYMENT_MODES.map((mode) => (
                                  <SelectItem key={mode} value={mode}>{mode}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : <span>{row.payment_mode ?? "—"}</span>}
                        </td>
                        <td className="min-w-[135px] px-3 py-3">
                          {editable ? (
                            <Input
                              type="date"
                              className="h-8"
                              max={new Date().toISOString().slice(0, 10)}
                              value={draft.paymentDate}
                              onChange={(event) => updateDraft(row.id, { paymentDate: event.target.value })}
                            />
                          ) : <span>{row.payment_date ? formatISTDate(row.payment_date) : "—"}</span>}
                        </td>
                        <td className="min-w-[150px] px-3 py-3">
                          {editable && needsBank ? (
                            <Select
                              value={draft.bankId || "_none"}
                              onValueChange={(value) => updateDraft(row.id, {
                                bankId: value === "_none" ? "" : value,
                              })}
                            >
                              <SelectTrigger className="h-8"><SelectValue placeholder="Select bank" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_none">Select bank</SelectItem>
                                {banks.map((bank) => (
                                  <SelectItem key={bank.id} value={bank.id}>{bank.bank_name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : <span>{row.bank_name ?? (needsBank ? "—" : "Not required")}</span>}
                        </td>
                        <td className="min-w-[170px] px-3 py-3">
                          {editable ? (
                            <Input
                              className="h-8"
                              value={draft.transactionId}
                              onChange={(event) => updateDraft(row.id, { transactionId: event.target.value })}
                              placeholder={draft.paymentMode === "Cheque" ? "Cheque number" : "UTR / reference"}
                            />
                          ) : <span className="font-mono">{row.transaction_id ?? "—"}</span>}
                        </td>
                        <td className="min-w-[180px] px-3 py-3">
                          {editable ? (
                            <Textarea
                              className="min-h-20 text-xs"
                              value={draft.remarks}
                              onChange={(event) => updateDraft(row.id, { remarks: event.target.value })}
                              placeholder="Installment remarks"
                            />
                          ) : <span>{row.remarks ?? "—"}</span>}
                        </td>
                        <td className="min-w-[190px] px-3 py-3">
                          <Badge variant="outline" className={STATUS_CLASS[row.payment_status] ?? ""}>
                            {row.payment_status}
                          </Badge>
                          {statusLocked ? (
                            <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
                              <LockKeyhole className="size-3" />No further dispatch allowed
                            </p>
                          ) : canWrite ? (
                            <div className="mt-2 space-y-2">
                              <Input
                                className="h-8"
                                value={draft.holdReason}
                                onChange={(event) => updateDraft(row.id, { holdReason: event.target.value })}
                                placeholder={onHold ? "Release note (optional)" : "Hold reason"}
                              />
                              <Button
                                variant={onHold ? "outline" : "ghost"}
                                size="sm"
                                className="h-7 text-[10px]"
                                disabled={holdMutation.isPending || (!onHold && !draft.holdReason.trim())}
                                onClick={() => holdMutation.mutate({ id: row.id, hold: !onHold })}
                              >
                                {holdMutation.isPending && holdMutation.variables?.id === row.id
                                  ? <Loader2 className="mr-1 size-3 animate-spin" />
                                  : onHold
                                    ? <CheckCircle2 className="mr-1 size-3" />
                                    : <LockKeyhole className="mr-1 size-3" />}
                                {onHold ? "Release hold" : "Put on hold"}
                              </Button>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 justify-start px-1 text-xs"
                              disabled={!row.grn_file_name}
                              onClick={() => void downloadFile(
                                `/api/finance/vendor-payments/${row.id}/grn-file`,
                                row.grn_file_name ?? `${row.grn_number ?? "grn"}.pdf`
                              )}
                            >
                              <Eye className="mr-1 size-3" />GRN file
                            </Button>
                            <Button
                              variant={selectedPaymentId === row.id ? "secondary" : "ghost"}
                              size="sm"
                              className="h-7 justify-start px-1 text-xs"
                              onClick={() => setSelectedPaymentId((current) => current === row.id ? null : row.id)}
                            >
                              <History className="mr-1 size-3" />Installments
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {editable ? (
                            <Button
                              size="sm"
                              className="h-8 bg-[#073f78] hover:bg-[#052d57]"
                              disabled={!canDispatch || dispatchMutation.isPending}
                              onClick={() => dispatchMutation.mutate(row.id)}
                            >
                              {dispatchMutation.isPending && dispatchMutation.variables === row.id
                                ? <Loader2 className="size-4 animate-spin" />
                                : <Send className="size-4" />}
                            </Button>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {selectedPaymentId && (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileClock className="size-4 text-[#073f78]" />
                    Installment history · {selectedPayment?.grn_number ?? selectedPaymentId}
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    Each line is immutable financial evidence with its own payment reference and proof.
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedPaymentId(null)}>
                  <X className="size-4" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {transactionsLoading ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    <Loader2 className="mx-auto mb-2 size-5 animate-spin" />Loading installments…
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-500">
                    No payment installment has been dispatched yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[950px] text-xs">
                      <thead className="bg-slate-100 text-slate-600">
                        <tr>
                          {["#", "Payment date", "Mode", "Bank", "UTR / Cheque", "Amount", "Remarks", "Recorded", "Proof"].map((heading) => (
                            <th key={heading} className="px-4 py-3 text-left font-semibold">{heading}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((transaction) => (
                          <tr key={transaction.id} className="border-t border-slate-100">
                            <td className="px-4 py-3 font-semibold">{transaction.sequence_no}</td>
                            <td className="px-4 py-3">{formatISTDate(transaction.payment_date)}</td>
                            <td className="px-4 py-3">{transaction.payment_mode}</td>
                            <td className="px-4 py-3">{transaction.bank_name ?? "Not required"}</td>
                            <td className="px-4 py-3 font-mono">{transaction.transaction_id ?? "Cash"}</td>
                            <td className="px-4 py-3 font-bold text-emerald-700">{money(transaction.amount)}</td>
                            <td className="max-w-[240px] px-4 py-3">{transaction.remarks ?? "—"}</td>
                            <td className="px-4 py-3">{formatISTDate(transaction.created_at)}</td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1">
                                {transaction.proof_file_name && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2"
                                    onClick={() => void downloadFile(
                                      `/api/finance/vendor-payments/${selectedPaymentId}/transactions/${transaction.id}/proof`,
                                      transaction.proof_file_name ?? `payment-proof-${transaction.sequence_no}`
                                    )}
                                  >
                                    <Eye className="mr-1 size-3" />View
                                  </Button>
                                )}
                                {canWrite && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2"
                                    disabled={proofMutation.isPending}
                                    onClick={() => {
                                      setProofTarget({
                                        paymentId: selectedPaymentId,
                                        transactionRowId: transaction.id,
                                      });
                                      proofInputRef.current?.click();
                                    }}
                                  >
                                    <Upload className="mr-1 size-3" />
                                    {transaction.proof_file_name ? "Replace" : "Upload"}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-slate-500">
              Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
              >
                <ArrowLeft className="mr-1 size-4" />Previous
              </Button>
              <span className="font-semibold">{page} / {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page >= totalPages}
              >
                Next<ArrowRight className="ml-1 size-4" />
              </Button>
            </div>
          </div>
        </main>
      </div>
    </DashboardLayout>
  );
}
