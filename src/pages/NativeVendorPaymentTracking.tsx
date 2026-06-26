import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Eye,
  FileText,
  Filter,
  Loader2,
  Save,
  Upload,
  X,
  RefreshCw,
  History,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface VendorPayment {
  id: string;
  grn_number?: string;
  branch_name?: string;
  vendor_name?: string;
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

interface EditRow {
  payment_mode: string;
  payment_date: string;
  bank_id: string;
  transaction_id: string;
  paid_amount: string;
  remarks: string;
  payment_status: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_MODES = [
  "Cheque", "NEFT", "RTGS", "IMPS", "UPI",
  "Cash", "Bank Transfer", "Adjustment", "Other",
];

const PAYMENT_STATUSES = [
  "Payment Pending", "Partially Paid", "Paid", "On Hold", "Rejected", "Closed",
];

const BANK_MODES = ["Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Bank Transfer"];

const STATUS_COLORS: Record<string, string> = {
  "Payment Pending":  "bg-amber-50 text-amber-700 border-amber-200",
  "Partially Paid":   "bg-blue-50 text-blue-700 border-blue-200",
  "Paid":             "bg-emerald-50 text-emerald-700 border-emerald-200",
  "On Hold":          "bg-orange-50 text-orange-700 border-orange-200",
  "Rejected":         "bg-rose-50 text-rose-700 border-rose-200",
  "Closed":           "bg-slate-50 text-slate-600 border-slate-200",
};

const FINANCIAL_YEARS = ["2024-25", "2025-26", "2026-27"];

function transactionLabel(mode?: string): string {
  if (!mode) return "Transaction ID / Cheque No.";
  if (mode === "Cheque") return "Cheque No.";
  if (["Adjustment", "Other"].includes(mode)) return "Adjustment Ref";
  return "Transaction ID / UTR No.";
}

function fmt(n: number | string) {
  return Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function agingDays(dueDate?: string): number {
  if (!dueDate) return 0;
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
}

// ── Filters component ─────────────────────────────────────────────────────────

interface FiltersState {
  financialYear: string;
  month: string;
  branchId: string;
  head: string;
  subHead: string;
  vendorId: string;
  paymentStatus: string;
  dueDateFrom: string;
  dueDateTo: string;
  search: string;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NativeVendorPaymentTracking() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [editRows, setEditRows] = useState<Record<string, EditRow>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState<FiltersState>({
    financialYear: "",
    month: "",
    branchId: "",
    head: "",
    subHead: "",
    vendorId: "",
    paymentStatus: "",
    dueDateFrom: "",
    dueDateTo: "",
    search: "",
  });

  const setFilter = (k: keyof FiltersState) => (v: string) =>
    setFilters(f => ({ ...f, [k]: v }));

  // Banks list
  const { data: banksData } = useQuery({
    queryKey: ["finance-banks"],
    queryFn: () => hrmsApi.get<{ data: BankMaster[] }>("/api/finance/banks"),
    staleTime: 10 * 60_000,
  });
  const banks: BankMaster[] = (banksData as any)?.data ?? [];

  // Payments list
  const queryKey = ["vendor-payments", page, filters];
  const { data: listData, isFetching } = useQuery({
    queryKey,
    queryFn: () => hrmsApi.get<{ rows: VendorPayment[]; total: number; limit: number }>(
      `/api/finance/vendor-payments?page=${page}&limit=50` +
      Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
        .join("")
    ),
  });

  const rows: VendorPayment[] = (listData as any)?.rows ?? [];
  const total: number        = (listData as any)?.total ?? 0;
  const pageSize             = (listData as any)?.limit ?? 50;
  const totalPages           = Math.ceil(total / pageSize);

  // Initialize edit row state when rows load
  useEffect(() => {
    setEditRows(prev => {
      const next = { ...prev };
      for (const r of rows) {
        if (!next[r.id]) {
          next[r.id] = {
            payment_mode:   r.payment_mode ?? "",
            payment_date:   r.payment_date?.slice(0, 10) ?? "",
            bank_id:        r.bank_id ?? "",
            transaction_id: r.transaction_id ?? "",
            paid_amount:    String(r.paid_amount ?? ""),
            remarks:        r.remarks ?? "",
            payment_status: r.payment_status ?? "Payment Pending",
          };
        }
      }
      return next;
    });
  }, [rows]);

  function setEditField(id: string, field: keyof EditRow, value: string) {
    setEditRows(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setDirtyIds(d => new Set(d).add(id));
  }

  // Single row save
  const saveMutation = useMutation({
    mutationFn: (id: string) => {
      const e = editRows[id];
      if (!e) throw new Error("No edit data");
      return hrmsApi.post(`/api/finance/vendor-payments/${id}/update-payment`, {
        paymentMode:    e.payment_mode  || undefined,
        paymentDate:    e.payment_date  || undefined,
        bankId:         e.bank_id       || undefined,
        transactionId:  e.transaction_id || undefined,
        paidAmount:     e.paid_amount !== "" ? Number(e.paid_amount) : undefined,
        remarks:        e.remarks       || undefined,
        paymentStatus:  e.payment_status || undefined,
      });
    },
    onSuccess: (_data, id) => {
      setDirtyIds(d => { const s = new Set(d); s.delete(id); return s; });
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      toast({ title: "Payment updated" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // Bulk save
  const bulkSaveMutation = useMutation({
    mutationFn: () => {
      const updates = [...dirtyIds].map(id => {
        const e = editRows[id];
        return {
          id,
          paymentMode:   e.payment_mode   || undefined,
          paymentDate:   e.payment_date   || undefined,
          bankId:        e.bank_id        || undefined,
          transactionId: e.transaction_id || undefined,
          paidAmount:    e.paid_amount !== "" ? Number(e.paid_amount) : undefined,
          remarks:       e.remarks        || undefined,
          paymentStatus: e.payment_status || undefined,
        };
      });
      return hrmsApi.post("/api/finance/vendor-payments/bulk-update", { updates });
    },
    onSuccess: (data: any) => {
      const failed = (data?.results ?? []).filter((r: any) => !r.success);
      if (failed.length) {
        toast({ title: `${failed.length} rows failed`, description: failed.map((f: any) => f.error).join("; "), variant: "destructive" });
      } else {
        toast({ title: `${dirtyIds.size} rows saved` });
        setDirtyIds(new Set());
      }
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
    },
    onError: (err: Error) => toast({ title: "Bulk save failed", description: err.message, variant: "destructive" }),
  });

  // Proof upload
  const proofMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("proof", file);
      return hrmsApi.postForm(`/api/finance/vendor-payments/${id}/upload-proof`, fd);
    },
    onSuccess: () => {
      setUploadTargetId(null);
      toast({ title: "Payment proof uploaded" });
      void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
    },
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  function handleProofFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetId) return;
    proofMutation.mutate({ id: uploadTargetId, file });
    e.target.value = "";
  }

  function openGrnFile(row: VendorPayment) {
    window.open(`/api/finance/vendor-payments/${row.id}/grn-file`, "_blank");
  }

  function handleExport() {
    const qs = Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    window.open(`/api/finance/vendor-payments/export?${qs}`, "_blank");
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  // Summary totals computed from current page rows
  const totalDue     = rows.reduce((sum, r) => sum + Number(r.due_amount ?? 0), 0);
  const totalPaid    = rows.reduce((sum, r) => {
    const edit = editRows[r.id];
    return sum + (edit?.paid_amount !== "" && edit?.paid_amount != null
      ? Number(edit.paid_amount)
      : Number(r.paid_amount ?? 0));
  }, 0);
  const totalBalance = rows.reduce((sum, r) => {
    const edit = editRows[r.id];
    const paid = edit?.paid_amount !== "" && edit?.paid_amount != null
      ? Number(edit.paid_amount)
      : Number(r.paid_amount ?? 0);
    return sum + Math.max(0, Number(r.due_amount ?? 0) - paid);
  }, 0);

  const inp = "h-9 text-xs px-2 border-slate-200 rounded focus:ring-1 focus:ring-blue-400";
  const sel = "h-9 text-xs";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hidden proof file input */}
      <input
        ref={proofInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleProofFile}
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {/* gradient left border accent */}
            <div className="border-l-4 border-l-[#073f78] pl-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-[#e8f2fc] text-[#073f78]">
                <FileText className="size-5" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900 leading-tight">GRN Payment Processing</h1>
                <p className="text-xs text-slate-500">Vendor Payment Tracking</p>
              </div>
            </div>
            {/* Stats chips */}
            <div className="hidden sm:flex items-center gap-1.5 ml-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200">
                {total} record{total !== 1 ? "s" : ""}
              </span>
              {dirtyIds.size > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                  {dirtyIds.size} unsaved
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Pagination controls */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => setPage(1)}
                disabled={page <= 1}
                title="First page"
              >
                «
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ArrowLeft className="size-3.5" />
              </Button>
              <span className="text-xs font-medium text-slate-600 px-1.5 tabular-nums">
                {page} / {Math.max(1, totalPages)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
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
                title="Last page"
              >
                »
              </Button>
            </div>

            <Button
              size="sm"
              variant="outline"
              className={`h-8 text-xs gap-1.5 ${showFilters ? "bg-blue-50 border-blue-300 text-blue-700" : ""}`}
              onClick={() => setShowFilters(f => !f)}
            >
              <Filter className="size-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 size-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            {dirtyIds.size > 0 && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 shadow-sm"
                onClick={() => bulkSaveMutation.mutate()}
                disabled={bulkSaveMutation.isPending}
              >
                {bulkSaveMutation.isPending
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <Save className="size-3.5" />}
                Save All ({dirtyIds.size})
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={handleExport}
            >
              <Download className="size-3.5" /> Export
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["vendor-payments"] })}
              title="Refresh"
            >
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* ── Filters panel ─────────────────────────────────────────────────── */}
        {showFilters && (
          <div className="border-t border-slate-200 bg-white px-4 py-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Financial Year</Label>
                  <Select
                    value={filters.financialYear || "_all"}
                    onValueChange={v => setFilter("financialYear")(v === "_all" ? "" : v)}
                  >
                    <SelectTrigger className={sel}><SelectValue placeholder="All years" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All years</SelectItem>
                      {FINANCIAL_YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Month</Label>
                  <Input type="month" className={inp} value={filters.month} onChange={e => setFilter("month")(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Budget Head</Label>
                  <Input className={inp} placeholder="Enter budget head" value={filters.head} onChange={e => setFilter("head")(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Sub Head</Label>
                  <Input className={inp} placeholder="Enter sub head" value={filters.subHead} onChange={e => setFilter("subHead")(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Payment Status</Label>
                  <Select
                    value={filters.paymentStatus || "_all"}
                    onValueChange={v => setFilter("paymentStatus")(v === "_all" ? "" : v)}
                  >
                    <SelectTrigger className={sel}><SelectValue placeholder="All statuses" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">All statuses</SelectItem>
                      {PAYMENT_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Due Date From</Label>
                  <Input type="date" className={inp} value={filters.dueDateFrom} onChange={e => setFilter("dueDateFrom")(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Due Date To</Label>
                  <Input type="date" className={inp} value={filters.dueDateTo} onChange={e => setFilter("dueDateTo")(e.target.value)} />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Search GRN No. / Vendor</Label>
                  <Input className={inp} placeholder="Search GRN number, vendor name…" value={filters.search} onChange={e => setFilter("search")(e.target.value)} />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 text-xs gap-1.5 bg-rose-500 hover:bg-rose-600"
                  onClick={() => {
                    setFilters({ financialYear: "", month: "", branchId: "", head: "", subHead: "", vendorId: "", paymentStatus: "", dueDateFrom: "", dueDateTo: "", search: "" });
                    setPage(1);
                  }}
                >
                  <X className="size-3.5" /> Clear All Filters
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        {isFetching && rows.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="size-6 animate-spin mr-2" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
            <div className="flex size-24 items-center justify-center rounded-2xl bg-slate-100">
              <FileText className="size-16 opacity-30" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-500">No vendor payment records found</p>
              <p className="text-xs text-slate-400 mt-1">Approved vendor GRNs will appear here once available.</p>
            </div>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-[57px] z-10">
              <tr className="bg-[#073f78] text-white select-none">
                {[
                  "Sr.", "Branch", "GRN No.", "Vendor", "Head", "Sub Head",
                  "Due Amount", "Due Date", "GRN File",
                  "Payment Mode", "Payment Date", "Bank Name",
                  "Transaction ID / Cheque No.", "Paid Amount",
                  "Balance", "Status", "Remarks", "Actions",
                ].map(h => (
                  <th key={h} className="px-2 py-3 text-left font-semibold whitespace-nowrap text-[11px] border-r border-blue-900/30 last:border-0">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const edit = editRows[row.id] ?? {
                  payment_mode: "", payment_date: "", bank_id: "",
                  transaction_id: "", paid_amount: "", remarks: "", payment_status: "",
                };
                const isDirty  = dirtyIds.has(row.id);
                const isSaving = saveMutation.isPending && saveMutation.variables === row.id;
                const needsBank = BANK_MODES.includes(edit.payment_mode || row.payment_mode || "");
                const aging = agingDays(row.due_date);
                const overdue = aging > 0 && row.payment_status !== "Paid" && row.payment_status !== "Closed";

                // Row background: dirty > overdue > alternating
                const rowBg = isDirty
                  ? "bg-amber-50/40 border-l-2 border-l-amber-400"
                  : overdue
                  ? "bg-rose-50/20"
                  : idx % 2 === 0
                  ? "bg-white"
                  : "bg-slate-50/50";

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 hover:brightness-95 transition-colors ${rowBg}`}
                  >
                    {/* Sr. */}
                    <td className="px-2 py-1.5 text-slate-500 font-mono whitespace-nowrap">
                      {(page - 1) * pageSize + idx + 1}
                    </td>

                    {/* Branch */}
                    <td className="px-2 py-1.5 whitespace-nowrap font-medium text-slate-700 max-w-[100px] truncate">
                      {row.branch_name ?? "—"}
                    </td>

                    {/* GRN No. */}
                    <td className="px-2 py-1.5 font-mono text-blue-700 whitespace-nowrap">
                      {row.grn_number ?? "—"}
                    </td>

                    {/* Vendor */}
                    <td className="px-2 py-1.5 max-w-[120px] truncate text-slate-700">
                      {row.vendor_name ?? "—"}
                    </td>

                    {/* Head */}
                    <td className="px-2 py-1.5 max-w-[110px] truncate text-slate-600">
                      {row.head ?? "—"}
                    </td>

                    {/* Sub Head */}
                    <td className="px-2 py-1.5 max-w-[110px] truncate text-slate-600">
                      {row.sub_head ?? "—"}
                    </td>

                    {/* Due Amount */}
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">
                      ₹{fmt(row.due_amount)}
                    </td>

                    {/* Due Date */}
                    <td className={`px-2 py-1.5 whitespace-nowrap font-mono ${overdue ? "text-rose-600 font-semibold" : "text-slate-600"}`}>
                      {row.due_date ? formatISTDate(row.due_date) : "—"}
                      {overdue && <span className="ml-1 text-[9px] text-rose-500">+{aging}d</span>}
                    </td>

                    {/* GRN File */}
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {row.grn_file_name ? (
                        <button
                          onClick={() => openGrnFile(row)}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline text-xs"
                        >
                          <Eye className="size-3" />
                          {row.grn_file_mime?.includes("pdf") ? "PDF" : "File"}
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Payment Mode */}
                    <td className="px-2 py-1.5 min-w-[110px]">
                      <Select
                        value={edit.payment_mode}
                        onValueChange={v => setEditField(row.id, "payment_mode", v)}
                      >
                        <SelectTrigger className="h-7 text-xs border-slate-200">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>

                    {/* Payment Date */}
                    <td className="px-2 py-1.5 min-w-[120px]">
                      <Input
                        type="date"
                        className="h-7 text-xs border-slate-200"
                        value={edit.payment_date}
                        onChange={e => setEditField(row.id, "payment_date", e.target.value)}
                        max={new Date().toISOString().slice(0, 10)}
                      />
                    </td>

                    {/* Bank Name */}
                    <td className="px-2 py-1.5 min-w-[130px]">
                      {needsBank ? (
                        <Select
                          value={edit.bank_id}
                          onValueChange={v => setEditField(row.id, "bank_id", v)}
                        >
                          <SelectTrigger className="h-7 text-xs border-slate-200">
                            <SelectValue placeholder="Select bank" />
                          </SelectTrigger>
                          <SelectContent>
                            {banks.map(b => (
                              <SelectItem key={b.id} value={b.id}>{b.bank_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Transaction ID */}
                    <td className="px-2 py-1.5 min-w-[140px]">
                      <Input
                        className="h-7 text-xs border-slate-200"
                        placeholder={transactionLabel(edit.payment_mode || row.payment_mode)}
                        value={edit.transaction_id}
                        onChange={e => setEditField(row.id, "transaction_id", e.target.value)}
                      />
                    </td>

                    {/* Paid Amount */}
                    <td className="px-2 py-1.5 min-w-[100px]">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max={row.due_amount}
                        className="h-7 text-xs border-slate-200 text-right"
                        value={edit.paid_amount}
                        onChange={e => setEditField(row.id, "paid_amount", e.target.value)}
                        placeholder="0.00"
                      />
                    </td>

                    {/* Balance (read-only computed) */}
                    <td className="px-2 py-1.5 text-right font-mono text-slate-700 whitespace-nowrap">
                      {edit.paid_amount !== ""
                        ? `₹${fmt(Math.max(0, row.due_amount - Number(edit.paid_amount)))}`
                        : `₹${fmt(row.balance_amount)}`
                      }
                    </td>

                    {/* Status */}
                    <td className="px-2 py-1.5 min-w-[130px]">
                      <Select
                        value={edit.payment_status || row.payment_status}
                        onValueChange={v => setEditField(row.id, "payment_status", v)}
                      >
                        <SelectTrigger className={`h-7 text-xs border font-semibold ${STATUS_COLORS[edit.payment_status || row.payment_status] ?? "border-slate-200"}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>

                    {/* Remarks */}
                    <td className="px-2 py-1.5 min-w-[130px]">
                      <Input
                        className="h-7 text-xs border-slate-200"
                        placeholder="Remarks…"
                        value={edit.remarks}
                        onChange={e => setEditField(row.id, "remarks", e.target.value)}
                      />
                    </td>

                    {/* Actions */}
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
                          className="h-6 px-2 text-[10px] gap-0.5"
                          onClick={() => {
                            setUploadTargetId(row.id);
                            proofInputRef.current?.click();
                          }}
                          disabled={proofMutation.isPending && uploadTargetId === row.id}
                          title="Upload payment proof"
                        >
                          {proofMutation.isPending && uploadTargetId === row.id
                            ? <Loader2 className="size-3 animate-spin" />
                            : <Upload className="size-3" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] gap-0.5 text-slate-500"
                          title="Audit trail"
                          onClick={() => toast({ title: `Audit — GRN ${row.grn_number ?? row.id}`, description: "Full audit trail available in Audit Log module." })}
                        >
                          <History className="size-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* ── Summary totals row ──────────────────────────────────────────── */}
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-300">
                {/* Sr. through Sub Head — 6 cols */}
                <td colSpan={6} className="px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Page Totals ({rows.length} rows)
                </td>
                {/* Due Amount */}
                <td className="px-2 py-2 text-right font-mono font-semibold text-slate-800 whitespace-nowrap text-xs">
                  ₹{fmt(totalDue)}
                </td>
                {/* Due Date through GRN File — 2 cols */}
                <td colSpan={2} className="px-2 py-2" />
                {/* Payment Mode through Transaction ID — 4 cols */}
                <td colSpan={4} className="px-2 py-2" />
                {/* Paid Amount */}
                <td className="px-2 py-2 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap text-xs">
                  ₹{fmt(totalPaid)}
                </td>
                {/* Balance */}
                <td className="px-2 py-2 text-right font-mono font-semibold text-rose-700 whitespace-nowrap text-xs">
                  ₹{fmt(totalBalance)}
                </td>
                {/* Status + Remarks + Actions — 3 cols */}
                <td colSpan={3} className="px-2 py-2" />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-2 flex items-center justify-between text-xs text-slate-500 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} records
            {dirtyIds.size > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">· {dirtyIds.size} unsaved</span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-[11px]" onClick={() => setPage(1)} disabled={page <= 1}>«</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <ArrowLeft className="size-3" /> Prev
            </Button>
            <span className="px-2 font-medium tabular-nums">{page} / {Math.max(1, totalPages)}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next <ArrowRight className="size-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-[11px]" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>»</Button>
          </div>
        </div>
      )}
    </div>
  );
}
