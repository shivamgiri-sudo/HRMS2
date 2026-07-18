import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface PaymentCapabilities {
  canRead: boolean;
  canWrite: boolean;
  readScope: "organisation" | "branch";
  writeRole: string | null;
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
  vendor_id?: string | null;
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
  grn_file_mime?: string | null;
  payment_proof_file_name?: string | null;
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

interface PaymentDraft {
  paymentMode: string;
  paymentDate: string;
  bankId: string;
  transactionId: string;
  paidAmount: string;
  hold: boolean;
  remarks: string;
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

function rowDraft(row: VendorPayment): PaymentDraft {
  return {
    paymentMode: row.payment_mode ?? "",
    paymentDate: row.payment_date?.slice(0, 10) ?? "",
    bankId: row.bank_id ?? "",
    transactionId: row.transaction_id ?? "",
    paidAmount: String(row.paid_amount ?? 0),
    hold: row.payment_status === "On Hold",
    remarks: row.remarks ?? "",
  };
}

function agingDays(dueDate?: string | null) {
  if (!dueDate) return 0;
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000);
}

function branchLabel(branch: BranchOption) {
  return branch.branch_name ?? branch.name ?? branch.id;
}

export default function VendorPaymentDispatchPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [proofTarget, setProofTarget] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(initialFilters());
  const [drafts, setDrafts] = useState<Record<string, PaymentDraft>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (!dirtyIds.has(row.id)) next[row.id] = rowDraft(row);
      }
      return next;
    });
  }, [rows, dirtyIds]);

  function updateDraft(id: string, patch: Partial<PaymentDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? rowDraft(rows.find((row) => row.id === id)!)), ...patch },
    }));
    setDirtyIds((current) => new Set(current).add(id));
  }

  function payloadFor(id: string) {
    const draft = drafts[id];
    if (!draft) throw new Error("Payment row is not ready");
    return {
      paymentMode: draft.paymentMode || undefined,
      paymentDate: draft.paymentDate || undefined,
      bankId: draft.bankId || undefined,
      transactionId: draft.transactionId.trim() || undefined,
      paidAmount: draft.paidAmount === "" ? undefined : Number(draft.paidAmount),
      remarks: draft.remarks.trim() || undefined,
      paymentStatus: draft.hold ? "On Hold" : "Payment Pending",
    };
  }

  const saveMutation = useMutation({
    mutationFn: (id: string) =>
      hrmsApi.post(`/api/finance/vendor-payments/${id}/update-payment`, payloadFor(id)),
    onSuccess: (_response, id) => {
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      toast({ title: "Payment row updated" });
    },
    onError: (mutationError: Error) => {
      toast({ title: "Payment update failed", description: mutationError.message, variant: "destructive" });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: () => hrmsApi.post("/api/finance/vendor-payments/bulk-update", {
      updates: [...dirtyIds].map((id) => ({ id, ...payloadFor(id) })),
    }),
    onSuccess: (response: any) => {
      const failed = (response?.results ?? []).filter((item: any) => !item.success);
      if (failed.length) {
        toast({
          title: `${failed.length} payment rows failed`,
          description: failed.map((item: any) => item.error).join("; "),
          variant: "destructive",
        });
      } else {
        setDirtyIds(new Set());
        toast({ title: "All payment changes saved" });
      }
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
    },
    onError: (mutationError: Error) => {
      toast({ title: "Bulk save failed", description: mutationError.message, variant: "destructive" });
    },
  });

  const proofMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const formData = new FormData();
      formData.append("proof", file);
      return hrmsApi.postForm(`/api/finance/vendor-payments/${id}/upload-proof`, formData);
    },
    onSuccess: () => {
      setProofTarget(null);
      toast({ title: "Payment proof uploaded" });
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
    },
    onError: (mutationError: Error) => {
      toast({ title: "Proof upload failed", description: mutationError.message, variant: "destructive" });
    },
  });

  function onProofSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && proofTarget) proofMutation.mutate({ id: proofTarget, file });
    event.target.value = "";
  }

  function clearFilters() {
    setFilters(initialFilters());
    setPage(1);
  }

  function exportCsv() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    window.open(`/api/finance/vendor-payments/export?${params.toString()}`, "_blank");
  }

  const summary = useMemo(() => {
    return rows.reduce(
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
    );
  }, [rows]);

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
          <div className="mx-auto flex max-w-[1800px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#e8f2fc] text-[#073f78]">
                <Banknote className="size-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-black text-slate-900">Vendor Payment Dispatch</h1>
                  <Badge variant="outline" className={canWrite ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}>
                    {capabilityLoading ? "Checking access" : canWrite ? "Accounts write access" : "Read-only ledger"}
                  </Badge>
                  {capabilities?.readScope && (
                    <Badge variant="outline">{capabilities.readScope} scope</Badge>
                  )}
                </div>
                <p className="mt-1 max-w-3xl text-sm text-slate-500">
                  Finance-approved GRNs appear automatically. Process, cost centre, tax and budget attribution are locked from the approved GRN.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowFilters((value) => !value)}>
                <Filter className="mr-2 size-4" />Filters
                {activeFilterCount > 0 && <span className="ml-2 rounded-full bg-blue-600 px-1.5 text-[10px] text-white">{activeFilterCount}</span>}
              </Button>
              {canWrite && dirtyIds.size > 0 && (
                <Button size="sm" onClick={() => bulkMutation.mutate()} disabled={bulkMutation.isPending}>
                  {bulkMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                  Save all ({dirtyIds.size})
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="mr-2 size-4" />Export
              </Button>
              <Button variant="ghost" size="icon" onClick={() => void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] })}>
                <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-[1800px] space-y-5 p-4 sm:p-6 lg:p-8">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Page due", summary.due, FileText, "text-slate-700"],
              ["Page paid", summary.paid, CheckCircle2, "text-emerald-700"],
              ["Page balance", summary.balance, Banknote, "text-blue-700"],
              ["Overdue balance", summary.overdue, AlertTriangle, "text-rose-700"],
            ].map(([label, value, Icon, color]) => (
              <Card key={String(label)} className="border-slate-200 shadow-sm">
                <CardContent className="flex items-center justify-between p-4">
                  <div><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{String(label)}</p><p className={`mt-2 text-xl font-black ${String(color)}`}>{money(Number(value))}</p></div>
                  {/* @ts-expect-error tuple icon */}
                  <Icon className={`size-5 ${String(color)}`} />
                </CardContent>
              </Card>
            ))}
          </div>

          {showFilters && (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select value={filters.branchId || "_all"} onValueChange={(value) => { setFilters((current) => ({ ...current, branchId: value === "_all" ? "" : value })); setPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All branches" /></SelectTrigger>
                    <SelectContent><SelectItem value="_all">All branches</SelectItem>{branches.map((branch) => <SelectItem key={branch.id} value={branch.id}>{branchLabel(branch)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Due month</Label><Input type="month" value={filters.month} onChange={(event) => { setFilters((current) => ({ ...current, month: event.target.value })); setPage(1); }} /></div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={filters.paymentStatus || "_all"} onValueChange={(value) => { setFilters((current) => ({ ...current, paymentStatus: value === "_all" ? "" : value })); setPage(1); }}>
                    <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent><SelectItem value="_all">All statuses</SelectItem>{PAYMENT_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Due from</Label><Input type="date" value={filters.dueDateFrom} onChange={(event) => { setFilters((current) => ({ ...current, dueDateFrom: event.target.value })); setPage(1); }} /></div>
                <div className="space-y-2"><Label>Due to</Label><Input type="date" value={filters.dueDateTo} onChange={(event) => { setFilters((current) => ({ ...current, dueDateTo: event.target.value })); setPage(1); }} /></div>
                <div className="space-y-2"><Label>GRN / vendor / UTR</Label><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><Input className="pl-9" value={filters.search} onChange={(event) => { setFilters((current) => ({ ...current, search: event.target.value })); setPage(1); }} /></div></div>
                <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6 flex justify-end"><Button variant="ghost" size="sm" onClick={clearFilters}><X className="mr-2 size-4" />Clear filters</Button></div>
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
              <table className="min-w-[1900px] w-full border-collapse text-xs">
                <thead className="bg-[#073f78] text-white">
                  <tr>
                    {["Branch & attribution", "GRN / Vendor", "Budget head", "Tax split", "Due & aging", "Payment mode", "Payment date", "Bank", "UTR / Cheque", "Cumulative paid", "Balance", "Hold / remarks", "Status", "Files", "Action"].map((heading) => (
                      <th key={heading} className="border-r border-white/10 px-3 py-3 text-left font-semibold whitespace-nowrap">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isFetching && rows.length === 0 ? (
                    <tr><td colSpan={15} className="py-20 text-center text-slate-500"><Loader2 className="mx-auto mb-2 size-6 animate-spin" />Loading vendor payments…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={15} className="py-20 text-center text-slate-500"><ShieldCheck className="mx-auto mb-3 size-10 text-slate-300" /><p className="font-semibold">No Finance-approved vendor GRNs found</p><p className="mt-1 text-xs">Records appear here after Branch Head and Finance Head approval.</p></td></tr>
                  ) : rows.map((row, index) => {
                    const draft = drafts[row.id] ?? rowDraft(row);
                    const isLocked = ["Paid", "Closed", "Rejected"].includes(row.payment_status);
                    const editable = canWrite && !isLocked;
                    const dirty = dirtyIds.has(row.id);
                    const overdueDays = agingDays(row.due_date);
                    const overdue = overdueDays > 0 && !["Paid", "Closed"].includes(row.payment_status);
                    const needsBank = BANK_MODES.has(draft.paymentMode);
                    const calculatedBalance = Math.max(0, Number(row.due_amount) - Number(draft.paidAmount || 0));
                    return (
                      <tr key={row.id} className={`border-b border-slate-100 align-top ${dirty ? "bg-amber-50/50" : index % 2 ? "bg-slate-50/40" : "bg-white"}`}>
                        <td className="px-3 py-3"><p className="font-semibold text-slate-800">{row.branch_name ?? row.branch_id}</p><p className="mt-1 text-slate-500">{row.process_name ?? "Shared"} · {row.cost_centre_name ?? "Branch common"}</p><Badge variant="outline" className="mt-2 text-[10px]">{row.cost_class ?? "indirect"}</Badge></td>
                        <td className="px-3 py-3"><p className="font-mono font-semibold text-blue-700">{row.grn_number ?? "—"}</p><p className="mt-1 max-w-[170px] font-medium text-slate-800">{row.vendor_name ?? "—"}</p></td>
                        <td className="px-3 py-3"><p className="font-semibold text-slate-800">{row.head ?? "—"}</p><p className="mt-1 text-slate-500">{row.sub_head ?? "General"}</p></td>
                        <td className="px-3 py-3 whitespace-nowrap"><p>Base: {money(row.amount_without_tax)}</p><p className="mt-1 text-slate-500">Tax: {money(row.tax_amount)}</p><p className="mt-1 font-semibold">Gross: {money(row.amount_with_tax ?? row.due_amount)}</p></td>
                        <td className="px-3 py-3 whitespace-nowrap"><p className="font-black text-slate-800">{money(row.due_amount)}</p><p className={`mt-1 ${overdue ? "font-semibold text-rose-600" : "text-slate-500"}`}>{row.due_date ? formatISTDate(row.due_date) : "No due date"}{overdue ? ` · ${overdueDays}d overdue` : ""}</p></td>
                        <td className="px-3 py-3 min-w-[140px]">{editable ? <Select value={draft.paymentMode || "_none"} onValueChange={(value) => updateDraft(row.id, { paymentMode: value === "_none" ? "" : value, bankId: value === "Cash" ? "" : draft.bankId })}><SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="_none">Not set</SelectItem>{PAYMENT_MODES.map((mode) => <SelectItem key={mode} value={mode}>{mode}</SelectItem>)}</SelectContent></Select> : <span>{row.payment_mode ?? "—"}</span>}</td>
                        <td className="px-3 py-3 min-w-[135px]">{editable ? <Input type="date" className="h-8" max={new Date().toISOString().slice(0, 10)} value={draft.paymentDate} onChange={(event) => updateDraft(row.id, { paymentDate: event.target.value })} /> : <span>{row.payment_date ? formatISTDate(row.payment_date) : "—"}</span>}</td>
                        <td className="px-3 py-3 min-w-[150px]">{editable && needsBank ? <Select value={draft.bankId || "_none"} onValueChange={(value) => updateDraft(row.id, { bankId: value === "_none" ? "" : value })}><SelectTrigger className="h-8"><SelectValue placeholder="Select bank" /></SelectTrigger><SelectContent><SelectItem value="_none">Select bank</SelectItem>{banks.map((bank) => <SelectItem key={bank.id} value={bank.id}>{bank.bank_name}</SelectItem>)}</SelectContent></Select> : <span>{row.bank_name ?? (needsBank ? "—" : "Not required")}</span>}</td>
                        <td className="px-3 py-3 min-w-[160px]">{editable ? <Input className="h-8" value={draft.transactionId} onChange={(event) => updateDraft(row.id, { transactionId: event.target.value })} placeholder={draft.paymentMode === "Cheque" ? "Cheque number" : "UTR / reference"} /> : <span className="font-mono">{row.transaction_id ?? "—"}</span>}</td>
                        <td className="px-3 py-3 min-w-[130px]">{editable ? <Input type="number" className="h-8 text-right" min={Number(row.paid_amount ?? 0)} max={Number(row.due_amount)} step="0.01" value={draft.paidAmount} onChange={(event) => updateDraft(row.id, { paidAmount: event.target.value })} /> : <span className="font-semibold text-emerald-700">{money(row.paid_amount)}</span>}<p className="mt-1 text-[10px] text-slate-400">Cannot be lower than recorded paid</p></td>
                        <td className="px-3 py-3 font-semibold text-slate-800 whitespace-nowrap">{money(editable ? calculatedBalance : row.balance_amount)}</td>
                        <td className="px-3 py-3 min-w-[200px]">{editable ? <div className="space-y-2"><Select value={draft.hold ? "hold" : "active"} onValueChange={(value) => updateDraft(row.id, { hold: value === "hold" })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active dispatch</SelectItem><SelectItem value="hold">Put on hold</SelectItem></SelectContent></Select><Input className="h-8" value={draft.remarks} onChange={(event) => updateDraft(row.id, { remarks: event.target.value })} placeholder={draft.hold ? "Hold reason required" : "Remarks"} /></div> : <span>{row.remarks ?? "—"}</span>}</td>
                        <td className="px-3 py-3"><Badge variant="outline" className={STATUS_CLASS[row.payment_status] ?? ""}>{row.payment_status}</Badge>{isLocked && <p className="mt-2 text-[10px] text-slate-400">Locked</p>}</td>
                        <td className="px-3 py-3"><div className="flex flex-col gap-1"><Button variant="ghost" size="sm" className="h-7 justify-start px-1 text-xs" onClick={() => window.open(`/api/finance/vendor-payments/${row.id}/grn-file`, "_blank")} disabled={!row.grn_file_name}><Eye className="mr-1 size-3" />GRN</Button>{row.payment_proof_file_name && <Button variant="ghost" size="sm" className="h-7 justify-start px-1 text-xs" onClick={() => window.open(`/api/finance/vendor-payments/${row.id}/proof`, "_blank")}><Eye className="mr-1 size-3" />Proof</Button>}{editable && <Button variant="ghost" size="sm" className="h-7 justify-start px-1 text-xs" onClick={() => { setProofTarget(row.id); proofInputRef.current?.click(); }} disabled={Number(row.paid_amount) <= 0 && Number(draft.paidAmount || 0) <= 0}><Upload className="mr-1 size-3" />Upload</Button>}</div></td>
                        <td className="px-3 py-3">{editable && dirty ? <Button size="sm" className="h-8" disabled={saveMutation.isPending && saveMutation.variables === row.id} onClick={() => saveMutation.mutate(row.id)}>{saveMutation.isPending && saveMutation.variables === row.id ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}</Button> : <span className="text-slate-400">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-slate-500">Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}</span>
            <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ArrowLeft className="mr-1 size-4" />Previous</Button><span className="font-semibold">{page} / {totalPages}</span><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Next<ArrowRight className="ml-1 size-4" /></Button></div>
          </div>
        </main>
      </div>
    </DashboardLayout>
  );
}
