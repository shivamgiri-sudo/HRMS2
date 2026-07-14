import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Eye,
  FileText,
  Filter,
  History,
  Loader2,
  RefreshCw,
  Save,
  Upload,
  X,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { formatISTDate } from "@/lib/utils";

interface VendorPayment {
  id: string;
  grn_number?: string;
  branch_id?: string;
  branch_name?: string;
  process_id?: string | null;
  process_name?: string | null;
  cost_centre_id?: string | null;
  cost_centre_name?: string | null;
  cost_class?: "direct" | "indirect";
  vendor_id?: string | null;
  vendor_name?: string | null;
  head?: string;
  sub_head?: string;
  due_amount: number;
  due_date?: string;
  grn_file_name?: string;
  grn_file_path?: string;
  grn_file_mime?: string;
  payment_mode?: string;
  payment_date?: string;
  bank_id?: string;
  bank_name?: string;
  transaction_id?: string;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  remarks?: string;
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

interface ProcessOption {
  id: string;
  process_name: string;
  branch_id?: string | null;
}

interface CostCentreOption {
  id: string;
  cost_centre_name: string;
  branch_id?: string | null;
  process_id?: string | null;
}

interface VendorOption {
  id: string;
  vendor_name?: string;
  name?: string;
}

interface EditRow {
  process_id: string;
  cost_centre_id: string;
  cost_class: "direct" | "indirect";
  payment_mode: string;
  payment_date: string;
  bank_id: string;
  transaction_id: string;
  paid_amount: string;
  remarks: string;
  payment_status: string;
}

interface FiltersState {
  financialYear: string;
  month: string;
  branchId: string;
  processId: string;
  costCentreId: string;
  costClass: string;
  head: string;
  subHead: string;
  vendorId: string;
  paymentStatus: string;
  dueDateFrom: string;
  dueDateTo: string;
  search: string;
}

const PAYMENT_MODES = [
  "Cheque", "NEFT", "RTGS", "IMPS", "UPI",
  "Cash", "Bank Transfer", "Adjustment", "Other",
];

const PAYMENT_STATUSES = [
  "Payment Pending", "Partially Paid", "Paid", "On Hold", "Rejected", "Closed",
];

const COST_CLASSES = [
  { value: "indirect", label: "Indirect" },
  { value: "direct", label: "Direct" },
] as const;

const BANK_MODES = ["Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Bank Transfer"];
const FINANCIAL_YEARS = ["2024-25", "2025-26", "2026-27"];

const STATUS_COLORS: Record<string, string> = {
  "Payment Pending": "bg-amber-50 text-amber-700 border-amber-200",
  "Partially Paid": "bg-blue-50 text-blue-700 border-blue-200",
  "Paid": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "On Hold": "bg-orange-50 text-orange-700 border-orange-200",
  "Rejected": "bg-rose-50 text-rose-700 border-rose-200",
  "Closed": "bg-slate-50 text-slate-600 border-slate-200",
};

function fmt(n: number | string) {
  return Number(n ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function agingDays(dueDate?: string) {
  if (!dueDate) return 0;
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
}

function transactionLabel(mode?: string) {
  if (!mode) return "Transaction ID / Cheque No.";
  if (mode === "Cheque") return "Cheque No.";
  if (["Adjustment", "Other"].includes(mode)) return "Adjustment Ref";
  return "Transaction ID / UTR No.";
}

function branchLabel(branch: BranchOption) {
  return branch.branch_name ?? branch.name ?? branch.id;
}

function vendorLabel(vendor: VendorOption) {
  return vendor.vendor_name ?? vendor.name ?? vendor.id;
}

function initialFilters(): FiltersState {
  return {
    financialYear: "",
    month: "",
    branchId: "",
    processId: "",
    costCentreId: "",
    costClass: "",
    head: "",
    subHead: "",
    vendorId: "",
    paymentStatus: "",
    dueDateFrom: "",
    dueDateTo: "",
    search: "",
  };
}

export default function NativeVendorPaymentTracking() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<FiltersState>(initialFilters());
  const [editRows, setEditRows] = useState<Record<string, EditRow>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

  const setFilter = (key: keyof FiltersState) => (value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const { data: banksData } = useQuery({
    queryKey: ["finance-banks"],
    queryFn: () => hrmsApi.get<{ data: BankMaster[] }>("/api/finance/banks"),
    staleTime: 10 * 60_000,
  });
  const banks: BankMaster[] = (banksData as any)?.data ?? [];

  const { data: branchData } = useQuery({
    queryKey: ["branches-list"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=500"),
    staleTime: 10 * 60_000,
  });
  const branches: BranchOption[] = branchData?.data ?? branchData ?? [];

  const { data: processData } = useQuery({
    queryKey: ["processes-list"],
    queryFn: () => hrmsApi.get<any>("/api/org/processes?limit=500"),
    staleTime: 10 * 60_000,
  });
  const processes: ProcessOption[] = processData?.data ?? processData ?? [];

  const { data: costCentreData } = useQuery({
    queryKey: ["cost-centres-list"],
    queryFn: () => hrmsApi.get<any>("/api/org/cost-centres?limit=500"),
    staleTime: 10 * 60_000,
  });
  const costCentres: CostCentreOption[] = costCentreData?.data ?? costCentreData ?? [];

  const { data: vendorData } = useQuery({
    queryKey: ["vendors-list"],
    queryFn: () => hrmsApi.get<any>("/api/erp/vendors?limit=500"),
    staleTime: 10 * 60_000,
  });
  const vendors: VendorOption[] = vendorData?.data ?? vendorData ?? [];

  const filteredProcesses = processes.filter((process) => !filters.branchId || process.branch_id === filters.branchId);
  const filteredCostCentres = costCentres.filter((costCentre) => !filters.branchId || costCentre.branch_id === filters.branchId);

  const queryKey = ["vendor-payments", page, filters];
  const { data: listData, isFetching } = useQuery({
    queryKey,
    queryFn: () => hrmsApi.get<{ rows: VendorPayment[]; total: number; limit: number }>(
      `/api/finance/vendor-payments?page=${page}&limit=50` +
      Object.entries(filters)
        .filter(([, value]) => value)
        .map(([key, value]) => `&${key}=${encodeURIComponent(value)}`)
        .join("")
    ),
  });

  const rows: VendorPayment[] = (listData as any)?.rows ?? [];
  const total = Number((listData as any)?.total ?? 0);
  const pageSize = Number((listData as any)?.limit ?? 50);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setEditRows((previous) => {
      const next = { ...previous };
      for (const row of rows) {
        if (!next[row.id]) {
          next[row.id] = {
            process_id: row.process_id ?? "",
            cost_centre_id: row.cost_centre_id ?? "",
            cost_class: row.cost_class ?? "indirect",
            payment_mode: row.payment_mode ?? "",
            payment_date: row.payment_date?.slice(0, 10) ?? "",
            bank_id: row.bank_id ?? "",
            transaction_id: row.transaction_id ?? "",
            paid_amount: String(row.paid_amount ?? ""),
            remarks: row.remarks ?? "",
            payment_status: row.payment_status ?? "Payment Pending",
          };
        }
      }
      return next;
    });
  }, [rows]);

  function markDirty(id: string) {
    setDirtyIds((current) => new Set(current).add(id));
  }

  function updateEditRow(id: string, updater: (current: EditRow) => EditRow) {
    setEditRows((current) => ({
      ...current,
      [id]: updater(current[id]),
    }));
    markDirty(id);
  }

  function setEditField<K extends keyof EditRow>(id: string, key: K, value: EditRow[K]) {
    updateEditRow(id, (current) => ({ ...current, [key]: value }));
  }

  function normalizeIndirectCostCentre(costCentreId: string, costClass: "direct" | "indirect") {
    if (costClass !== "indirect") return costCentreId;
    const costCentre = costCentres.find((item) => item.id === costCentreId);
    return costCentre?.process_id ? "" : costCentreId;
  }

  const saveMutation = useMutation({
    mutationFn: (id: string) => {
      const edit = editRows[id];
      if (!edit) throw new Error("No edit data");
      return hrmsApi.post(`/api/finance/vendor-payments/${id}/update-payment`, {
        processId: edit.process_id || undefined,
        costCentreId: edit.cost_centre_id || undefined,
        costClass: edit.cost_class,
        paymentMode: edit.payment_mode || undefined,
        paymentDate: edit.payment_date || undefined,
        bankId: edit.bank_id || undefined,
        transactionId: edit.transaction_id || undefined,
        paidAmount: edit.paid_amount !== "" ? Number(edit.paid_amount) : undefined,
        remarks: edit.remarks || undefined,
        paymentStatus: edit.payment_status || undefined,
      });
    },
    onSuccess: (_data, id) => {
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      toast({ title: "Payment updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkSaveMutation = useMutation({
    mutationFn: () => {
      const updates = [...dirtyIds].map((id) => {
        const edit = editRows[id];
        return {
          id,
          processId: edit.process_id || undefined,
          costCentreId: edit.cost_centre_id || undefined,
          costClass: edit.cost_class,
          paymentMode: edit.payment_mode || undefined,
          paymentDate: edit.payment_date || undefined,
          bankId: edit.bank_id || undefined,
          transactionId: edit.transaction_id || undefined,
          paidAmount: edit.paid_amount !== "" ? Number(edit.paid_amount) : undefined,
          remarks: edit.remarks || undefined,
          paymentStatus: edit.payment_status || undefined,
        };
      });
      return hrmsApi.post("/api/finance/vendor-payments/bulk-update", { updates });
    },
    onSuccess: (data: any) => {
      const failed = (data?.results ?? []).filter((row: any) => !row.success);
      if (failed.length > 0) {
        toast({
          title: `${failed.length} rows failed`,
          description: failed.map((row: any) => row.error).join("; "),
          variant: "destructive",
        });
      } else {
        toast({ title: `${dirtyIds.size} rows saved` });
        setDirtyIds(new Set());
      }
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk save failed", description: error.message, variant: "destructive" });
    },
  });

  const proofMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const formData = new FormData();
      formData.append("proof", file);
      return hrmsApi.postForm(`/api/finance/vendor-payments/${id}/upload-proof`, formData);
    },
    onSuccess: () => {
      setUploadTargetId(null);
      toast({ title: "Payment proof uploaded" });
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  function handleProofFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !uploadTargetId) return;
    proofMutation.mutate({ id: uploadTargetId, file });
    event.target.value = "";
  }

  function openGrnFile(row: VendorPayment) {
    window.open(`/api/finance/vendor-payments/${row.id}/grn-file`, "_blank");
  }

  function handleExport() {
    const query = Object.entries(filters)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    window.open(`/api/finance/vendor-payments/export?${query}`, "_blank");
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const totalDue = rows.reduce((sum, row) => sum + Number(row.due_amount ?? 0), 0);
  const totalPaid = rows.reduce((sum, row) => {
    const edit = editRows[row.id];
    const value = edit?.paid_amount !== "" && edit?.paid_amount != null
      ? Number(edit.paid_amount)
      : Number(row.paid_amount ?? 0);
    return sum + value;
  }, 0);
  const totalBalance = rows.reduce((sum, row) => {
    const edit = editRows[row.id];
    const paid = edit?.paid_amount !== "" && edit?.paid_amount != null
      ? Number(edit.paid_amount)
      : Number(row.paid_amount ?? 0);
    return sum + Math.max(0, Number(row.due_amount ?? 0) - paid);
  }, 0);

  const inputClass = "h-9 text-xs px-2 border-slate-200 rounded focus:ring-1 focus:ring-blue-400";
  const selectClass = "h-9 text-xs";

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50">
      <input
        ref={proofInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleProofFile}
      />

      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="border-l-4 border-l-[#073f78] pl-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-[#e8f2fc] text-[#073f78]">
                  <FileText className="size-5" />
                </div>
                <div>
                  <h1 className="text-base font-bold text-slate-900">GRN Payment Processing</h1>
                  <p className="text-xs text-slate-500">Vendor Payment Tracking</p>
                </div>
              </div>
            </div>
            <div className="hidden items-center gap-1.5 sm:flex">
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                {total} records
              </span>
              {dirtyIds.size > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                  {dirtyIds.size} unsaved
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setPage(1)}
                disabled={page <= 1}
              >
                {"<<"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                <ArrowLeft className="size-3.5" />
              </Button>
              <span className="px-1.5 text-xs font-medium text-slate-600">{page} / {totalPages}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
              >
                <ArrowRight className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
              >
                {">>"}
              </Button>
            </div>

            <Button
              size="sm"
              variant="outline"
              className={`h-8 gap-1.5 text-xs ${showFilters ? "border-blue-300 bg-blue-50 text-blue-700" : ""}`}
              onClick={() => setShowFilters((current) => !current)}
            >
              <Filter className="size-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            {dirtyIds.size > 0 && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 text-xs hover:bg-emerald-700"
                onClick={() => bulkSaveMutation.mutate()}
                disabled={bulkSaveMutation.isPending}
              >
                {bulkSaveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save All ({dirtyIds.size})
              </Button>
            )}

            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleExport}>
              <Download className="size-3.5" />
              Export
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] })}
            >
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="border-t border-slate-200 bg-white px-4 py-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Financial Year</Label>
                  <Select
                    value={filters.financialYear || "_all"}
                    onValueChange={(value) => setFilter("financialYear")(value === "_all" ? "" : value)}
                  >
                    <SelectTrigger className={selectClass}><SelectValue placeholder="All years" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All years</SelectItem>
                      {FINANCIAL_YEARS.map((year) => (
                        <SelectItem key={year} value={year}>{year}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Month</Label>
                  <Input type="month" className={inputClass} value={filters.month} onChange={(event) => setFilter("month")(event.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Branch</Label>
                  <Select
                    value={filters.branchId || "_all"}
                    onValueChange={(value) => {
                      const branchId = value === "_all" ? "" : value;
                      setFilters((current) => {
                        const nextProcessId = current.processId && processes.some((process) => process.id === current.processId && (!branchId || process.branch_id === branchId))
                          ? current.processId
                          : "";
                        const nextCostCentreId = current.costCentreId && costCentres.some((costCentre) => costCentre.id === current.costCentreId && (!branchId || costCentre.branch_id === branchId))
                          ? current.costCentreId
                          : "";
                        return {
                          ...current,
                          branchId,
                          processId: nextProcessId,
                          costCentreId: nextCostCentreId,
                        };
                      });
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className={selectClass}><SelectValue placeholder="All branches" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All branches</SelectItem>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>{branchLabel(branch)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Process</Label>
                  <Select
                    value={filters.processId || "_all"}
                    onValueChange={(value) => setFilter("processId")(value === "_all" ? "" : value)}
                  >
                    <SelectTrigger className={selectClass}><SelectValue placeholder="All processes" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All processes</SelectItem>
                      {filteredProcesses.map((process) => (
                        <SelectItem key={process.id} value={process.id}>{process.process_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cost Centre</Label>
                  <Select
                    value={filters.costCentreId || "_all"}
                    onValueChange={(value) => setFilter("costCentreId")(value === "_all" ? "" : value)}
                  >
                    <SelectTrigger className={selectClass}><SelectValue placeholder="All cost centres" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All cost centres</SelectItem>
                      {filteredCostCentres.map((costCentre) => (
                        <SelectItem key={costCentre.id} value={costCentre.id}>{costCentre.cost_centre_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cost Class</Label>
                  <Select
                    value={filters.costClass || "_all"}
                    onValueChange={(value) => setFilter("costClass")(value === "_all" ? "" : value)}
                  >
                    <SelectTrigger className={selectClass}><SelectValue placeholder="All classes" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All classes</SelectItem>
                      {COST_CLASSES.map((item) => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Vendor</Label>
                  <Select
                    value={filters.vendorId || "_all"}
                    onValueChange={(value) => setFilter("vendorId")(value === "_all" ? "" : value)}
                  >
                    <SelectTrigger className={selectClass}><SelectValue placeholder="All vendors" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All vendors</SelectItem>
                      {vendors.map((vendor) => (
                        <SelectItem key={vendor.id} value={vendor.id}>{vendorLabel(vendor)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Budget Head</Label>
                  <Input className={inputClass} value={filters.head} onChange={(event) => setFilter("head")(event.target.value)} placeholder="Enter budget head" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Sub Head</Label>
                  <Input className={inputClass} value={filters.subHead} onChange={(event) => setFilter("subHead")(event.target.value)} placeholder="Enter sub head" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Payment Status</Label>
                  <Select
                    value={filters.paymentStatus || "_all"}
                    onValueChange={(value) => setFilter("paymentStatus")(value === "_all" ? "" : value)}
                  >
                    <SelectTrigger className={selectClass}><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All statuses</SelectItem>
                      {PAYMENT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>{status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Due Date From</Label>
                  <Input type="date" className={inputClass} value={filters.dueDateFrom} onChange={(event) => setFilter("dueDateFrom")(event.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Due Date To</Label>
                  <Input type="date" className={inputClass} value={filters.dueDateTo} onChange={(event) => setFilter("dueDateTo")(event.target.value)} />
                </div>

                <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
                  <Label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Search GRN / Vendor</Label>
                  <Input className={inputClass} value={filters.search} onChange={(event) => setFilter("search")(event.target.value)} placeholder="Search GRN number or vendor" />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => {
                    setFilters(initialFilters());
                    setPage(1);
                  }}
                >
                  <X className="size-3.5" />
                  Clear All Filters
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        {isFetching && rows.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="mr-2 size-6 animate-spin" />
            Loading...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-400">
            <div className="flex size-24 items-center justify-center rounded-2xl bg-slate-100">
              <FileText className="size-16 opacity-30" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-500">No vendor payment records found</p>
              <p className="mt-1 text-xs text-slate-400">Approved vendor GRNs will appear here once available.</p>
            </div>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-[57px] z-10">
              <tr className="select-none bg-[#073f78] text-white">
                {[
                  "Sr.",
                  "Branch",
                  "Attribution",
                  "Class",
                  "GRN No.",
                  "Vendor",
                  "Head",
                  "Sub Head",
                  "Due Amount",
                  "Due Date",
                  "GRN File",
                  "Payment Mode",
                  "Payment Date",
                  "Bank Name",
                  "Transaction ID / Cheque No.",
                  "Paid Amount",
                  "Balance",
                  "Status",
                  "Remarks",
                  "Actions",
                ].map((header) => (
                  <th key={header} className="border-r border-blue-900/30 px-2 py-3 text-left text-[11px] font-semibold whitespace-nowrap last:border-r-0">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const edit = editRows[row.id] ?? {
                  process_id: row.process_id ?? "",
                  cost_centre_id: row.cost_centre_id ?? "",
                  cost_class: row.cost_class ?? "indirect",
                  payment_mode: row.payment_mode ?? "",
                  payment_date: row.payment_date?.slice(0, 10) ?? "",
                  bank_id: row.bank_id ?? "",
                  transaction_id: row.transaction_id ?? "",
                  paid_amount: String(row.paid_amount ?? ""),
                  remarks: row.remarks ?? "",
                  payment_status: row.payment_status ?? "Payment Pending",
                };

                const isDirty = dirtyIds.has(row.id);
                const isSaving = saveMutation.isPending && saveMutation.variables === row.id;
                const needsBank = BANK_MODES.includes(edit.payment_mode || row.payment_mode || "");
                const overdueDays = agingDays(row.due_date);
                const overdue = overdueDays > 0 && row.payment_status !== "Paid" && row.payment_status !== "Closed";
                const rowProcesses = processes.filter((process) => !row.branch_id || process.branch_id === row.branch_id);
                const rowCostCentres = costCentres.filter((costCentre) => !row.branch_id || costCentre.branch_id === row.branch_id);

                const rowClass = isDirty
                  ? "bg-amber-50/40 border-l-2 border-l-amber-400"
                  : overdue
                  ? "bg-rose-50/20"
                  : index % 2 === 0
                  ? "bg-white"
                  : "bg-slate-50/50";

                return (
                  <tr key={row.id} className={`border-b border-slate-100 transition-colors hover:brightness-95 ${rowClass}`}>
                    <td className="px-2 py-1.5 font-mono text-slate-500 whitespace-nowrap">
                      {(page - 1) * pageSize + index + 1}
                    </td>

                    <td className="max-w-[110px] truncate px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                      {row.branch_name ?? "-"}
                    </td>

                    <td className="min-w-[220px] px-2 py-1.5">
                      <div className="grid gap-1">
                        <Select
                          value={edit.process_id || "_none"}
                          onValueChange={(value) => {
                            const processId = value === "_none" ? "" : value;
                            updateEditRow(row.id, (current) => {
                              const currentCostCentre = costCentres.find((item) => item.id === current.cost_centre_id);
                              const clearCostCentre = currentCostCentre?.process_id && currentCostCentre.process_id !== processId;
                              return {
                                ...current,
                                process_id: processId,
                                cost_centre_id: clearCostCentre ? "" : current.cost_centre_id,
                              };
                            });
                          }}
                        >
                          <SelectTrigger className="h-7 border-slate-200 text-xs">
                            <SelectValue placeholder="Select process" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">No direct process</SelectItem>
                            {rowProcesses.map((process) => (
                              <SelectItem key={process.id} value={process.id}>{process.process_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={edit.cost_centre_id || "_none"}
                          onValueChange={(value) => {
                            if (value === "_none") {
                              setEditField(row.id, "cost_centre_id", "");
                              return;
                            }
                            const selected = costCentres.find((item) => item.id === value);
                            updateEditRow(row.id, (current) => ({
                              ...current,
                              cost_centre_id: value,
                              process_id: current.process_id || selected?.process_id || "",
                            }));
                          }}
                        >
                          <SelectTrigger className="h-7 border-slate-200 text-xs">
                            <SelectValue placeholder="Select cost centre" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">No cost centre</SelectItem>
                            {rowCostCentres.map((costCentre) => (
                              <SelectItem key={costCentre.id} value={costCentre.id}>{costCentre.cost_centre_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </td>

                    <td className="min-w-[110px] px-2 py-1.5">
                      <Select
                        value={edit.cost_class}
                        onValueChange={(value: "direct" | "indirect") => {
                          updateEditRow(row.id, (current) => ({
                            ...current,
                            cost_class: value,
                            process_id: value === "indirect" ? "" : current.process_id,
                            cost_centre_id: normalizeIndirectCostCentre(current.cost_centre_id, value),
                          }));
                        }}
                      >
                        <SelectTrigger className="h-7 border-slate-200 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COST_CLASSES.map((item) => (
                            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>

                    <td className="px-2 py-1.5 font-mono text-blue-700 whitespace-nowrap">
                      {row.grn_number ?? "-"}
                    </td>

                    <td className="max-w-[140px] truncate px-2 py-1.5 text-slate-700">
                      {row.vendor_name ?? "-"}
                    </td>

                    <td className="max-w-[120px] truncate px-2 py-1.5 text-slate-600">
                      {row.head ?? "-"}
                    </td>

                    <td className="max-w-[120px] truncate px-2 py-1.5 text-slate-600">
                      {row.sub_head ?? "-"}
                    </td>

                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">
                      Rs {fmt(row.due_amount)}
                    </td>

                    <td className={`px-2 py-1.5 font-mono whitespace-nowrap ${overdue ? "font-semibold text-rose-600" : "text-slate-600"}`}>
                      {row.due_date ? formatISTDate(row.due_date) : "-"}
                      {overdue && <span className="ml-1 text-[9px] text-rose-500">+{overdueDays}d</span>}
                    </td>

                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {row.grn_file_name ? (
                        <button
                          onClick={() => openGrnFile(row)}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          <Eye className="size-3" />
                          {row.grn_file_mime?.includes("pdf") ? "PDF" : "File"}
                        </button>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="min-w-[110px] px-2 py-1.5">
                      <Select value={edit.payment_mode || "_none"} onValueChange={(value) => setEditField(row.id, "payment_mode", value === "_none" ? "" : value)}>
                        <SelectTrigger className="h-7 border-slate-200 text-xs">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Not set</SelectItem>
                          {PAYMENT_MODES.map((mode) => (
                            <SelectItem key={mode} value={mode}>{mode}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>

                    <td className="min-w-[120px] px-2 py-1.5">
                      <Input
                        type="date"
                        className="h-7 border-slate-200 text-xs"
                        value={edit.payment_date}
                        onChange={(event) => setEditField(row.id, "payment_date", event.target.value)}
                        max={new Date().toISOString().slice(0, 10)}
                      />
                    </td>

                    <td className="min-w-[130px] px-2 py-1.5">
                      {needsBank ? (
                        <Select value={edit.bank_id || "_none"} onValueChange={(value) => setEditField(row.id, "bank_id", value === "_none" ? "" : value)}>
                          <SelectTrigger className="h-7 border-slate-200 text-xs">
                            <SelectValue placeholder="Select bank" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">No bank</SelectItem>
                            {banks.map((bank) => (
                              <SelectItem key={bank.id} value={bank.id}>{bank.bank_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>

                    <td className="min-w-[150px] px-2 py-1.5">
                      <Input
                        className="h-7 border-slate-200 text-xs"
                        placeholder={transactionLabel(edit.payment_mode || row.payment_mode)}
                        value={edit.transaction_id}
                        onChange={(event) => setEditField(row.id, "transaction_id", event.target.value)}
                      />
                    </td>

                    <td className="min-w-[100px] px-2 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max={row.due_amount}
                        className="h-7 border-slate-200 text-right text-xs"
                        value={edit.paid_amount}
                        onChange={(event) => setEditField(row.id, "paid_amount", event.target.value)}
                        placeholder="0.00"
                      />
                    </td>

                    <td className="px-2 py-1.5 text-right font-mono text-slate-700 whitespace-nowrap">
                      Rs {fmt(edit.paid_amount !== "" ? Math.max(0, row.due_amount - Number(edit.paid_amount)) : row.balance_amount)}
                    </td>

                    <td className="min-w-[130px] px-2 py-1.5">
                      <Select value={edit.payment_status || row.payment_status} onValueChange={(value) => setEditField(row.id, "payment_status", value)}>
                        <SelectTrigger className={`h-7 border text-xs font-semibold ${STATUS_COLORS[edit.payment_status || row.payment_status] ?? "border-slate-200"}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>{status}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>

                    <td className="min-w-[140px] px-2 py-1.5">
                      <Input
                        className="h-7 border-slate-200 text-xs"
                        placeholder="Remarks..."
                        value={edit.remarks}
                        onChange={(event) => setEditField(row.id, "remarks", event.target.value)}
                      />
                    </td>

                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {isDirty && (
                          <Button
                            size="sm"
                            className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => saveMutation.mutate(row.id)}
                            disabled={isSaving}
                          >
                            {isSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            setUploadTargetId(row.id);
                            proofInputRef.current?.click();
                          }}
                          disabled={proofMutation.isPending && uploadTargetId === row.id}
                        >
                          {proofMutation.isPending && uploadTargetId === row.id ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] text-slate-500"
                          onClick={() => toast({
                            title: `Audit - GRN ${row.grn_number ?? row.id}`,
                            description: "Full audit trail is available in the Audit Log module.",
                          })}
                        >
                          <History className="size-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-100">
                <td colSpan={8} className="px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Page Totals ({rows.length} rows)
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                  Rs {fmt(totalDue)}
                </td>
                <td colSpan={6} className="px-2 py-2" />
                <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-emerald-700 whitespace-nowrap">
                  Rs {fmt(totalPaid)}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-rose-700 whitespace-nowrap">
                  Rs {fmt(totalBalance)}
                </td>
                <td colSpan={3} className="px-2 py-2" />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between border-t border-slate-200 bg-white/95 px-4 py-2 text-xs text-slate-500 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur-sm">
          <span>
            Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total} records
            {dirtyIds.size > 0 && <span className="ml-2 font-semibold text-amber-600">| {dirtyIds.size} unsaved</span>}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-[11px]" onClick={() => setPage(1)} disabled={page <= 1}>{"<<"}</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
              <ArrowLeft className="size-3" />
              Prev
            </Button>
            <span className="px-2 font-medium">{page} / {totalPages}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
              Next
              <ArrowRight className="size-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-[11px]" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>{">>"}</Button>
          </div>
        </div>
      )}
      </div>
    </DashboardLayout>
  );
}
