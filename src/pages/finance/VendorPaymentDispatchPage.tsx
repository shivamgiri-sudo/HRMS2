import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Clock,
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
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useHasRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import { PaymentDispatchSheet } from "@/components/finance/vendor/PaymentDispatchSheet";
// The voucher chain is reachable from this page too: raise for one due, then approve/release in
// the same drawer the Payment Vouchers page uses. Both write one payment_voucher row.
import { PaymentVoucherDrawer } from "@/components/finance/vendor/PaymentVoucherDrawer";
import { RaiseVoucherForSingleDueDialog } from "@/components/finance/vendor/RaiseVoucherForSingleDueDialog";
import { VoucherStatusBadge } from "@/components/finance/vendor/VoucherStatusBadge";

interface PaymentCapabilities {
  canRead: boolean;
  canWrite: boolean;
  readScope: "organisation" | "branch";
  scopeBranchNames?: string[];
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
  /** From grn_request via the list join — the vendor's own bill reference, not the GRN number. */
  invoice_number?: string | null;
  bill_date?: string | null;
  billing_cycle_status?: "OPEN" | "BOOKED" | "CLOSED" | null;
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
  tds_deducted_amount?: number | null;
  vendor_id?: string | null;
  /**
   * The most recently raised Payment Voucher against this due, joined on by the list/detail
   * queries. A due can be settled either here (direct dispatch) or through the voucher chain
   * on /finance/payment-vouchers — both write this same row, so this page has to show which.
   * Null on every due that has never had a voucher raised, which is most of them.
   */
  voucher_id?: string | null;
  voucher_number?: string | null;
  voucher_status?: "raised" | "ceo_approved" | "released" | "rejected" | "changes_requested" | null;
  voucher_raised_at?: string | null;
  voucher_ceo_approved_at?: string | null;
  voucher_released_at?: string | null;
  voucher_rejection_reason?: string | null;
  /** Server-computed: a voucher is mid-flight, so direct dispatch is blocked for this due. */
  active_voucher?: boolean;
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

interface Filters {
  branchId: string;
  month: string;
  financialYear: string;
  paymentStatus: string;
  dueDateFrom: string;
  dueDateTo: string;
  search: string;
}

const PAYMENT_STATUSES = [
  "Payment Pending",
  "Partially Paid",
  "Paid",
  "On Hold",
  "Rejected",
  "Closed",
] as const;

// Approval Backlog panel stages — GRN statuses gating a payment from ever reaching this page's
// own vendor_payment_tracking grid. 3-stage chain (owner ruling, 2026-09-12): Branch Head ->
// Accounts Head -> Finance Head.
const BACKLOG_STAGES: { key: string; label: string }[] = [
  { key: "branch_head_approved", label: "Awaiting Accounts Head (cleared Branch Head)" },
  { key: "accounts_head_approved", label: "Awaiting Finance Head (cleared Accounts Head)" },
  // finance_head_approved is declared on the enum but never actually written for a vendor GRN —
  // Finance Head's own approval goes straight to pending_accounts_payment (grn.service.ts's
  // reviewGrn). Left here rather than removed: a legacy or future row in that status should
  // still surface somewhere rather than silently vanish from this backlog.
  { key: "finance_head_approved", label: "Awaiting Accounts Head payment run (cleared Finance Head)" },
];

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

function Metric({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "blue" | "emerald" | "rose" | "amber";
}) {
  const toneClass = {
    slate: "text-slate-950",
    blue: "text-blue-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">{label}</p>
      <p className={`mt-2 text-lg font-black ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function initialFilters(): Filters {
  return {
    branchId: "",
    month: "",
    financialYear: "",
    paymentStatus: "",
    dueDateFrom: "",
    dueDateTo: "",
    search: "",
  };
}

function financialYearOptions(): string[] {
  const now = new Date();
  const currentStartYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const options: string[] = [];
  for (let year = currentStartYear; year >= 2017; year--) {
    options.push(`${year}-${String((year + 1) % 100).padStart(2, "0")}`);
  }
  return options;
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
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(initialFilters());
  const [selected, setSelected] = useState<VendorPayment | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Voucher surfaces. The drawer and the dispatch sheet are siblings, never nested — opening a
  // voucher from inside the sheet closes the sheet and opens the drawer.
  const [voucherDrawerId, setVoucherDrawerId] = useState<string | null>(null);
  const [raiseForDue, setRaiseForDue] = useState<VendorPayment | null>(null);
  // Raising is Finance Head's call, matching VOUCHER_RAISE_ROLES on the server. Accounts Head
  // keeps the direct-dispatch button; this is the other route, not a replacement for it.
  const canRaiseVoucher = useHasRole("finance_head", "super_admin");
  const [showAging, setShowAging] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showBacklog, setShowBacklog] = useState(false);
  const [ledgerVendorId, setLedgerVendorId] = useState("");
  const [ledgerVendorSearch, setLedgerVendorSearch] = useState("");

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
  const agingQuery = useQuery({
    queryKey: ["vendor-payments-aging", filters.branchId],
    enabled: showAging,
    queryFn: () => hrmsApi.get<any>(
      `/api/finance/vendor-payments/aging${filters.branchId ? `?branchId=${filters.branchId}` : ""}`
    ),
    staleTime: 5 * 60_000,
  });
  const agingBuckets: Record<string, any[]> = (agingQuery.data as any)?.data ?? {};

  const ledgerQuery = useQuery({
    queryKey: ["vendor-ledger", ledgerVendorId, filters.branchId],
    enabled: showLedger && Boolean(ledgerVendorId),
    queryFn: () => hrmsApi.get<any>(
      `/api/finance/vendors/${ledgerVendorId}/ledger${filters.branchId ? `?branchId=${filters.branchId}` : ""}`
    ),
    staleTime: 5 * 60_000,
  });
  const ledgerRows: any[] = (ledgerQuery.data as any)?.data ?? [];

  // Vendor picker for the Ledger panel — was a raw UUID paste box ("Vendor ID (paste from
  // vendor master)"), which meant actually finding a vendor's account statement required first
  // opening Vendor Management in another tab to copy an internal id. Same find-then-pick pattern
  // as NativeVendorBankDetails.tsx's vendor picker.
  const ledgerVendorQuery = useQuery({
    queryKey: ["vendor-ledger-vendor-search", ledgerVendorSearch],
    enabled: showLedger,
    queryFn: () => hrmsApi.get<any>(
      `/api/erp/vendors?q=${encodeURIComponent(ledgerVendorSearch)}&limit=50&is_active=1`
    ),
    staleTime: 60_000,
  });
  const ledgerVendorOptions: { id: string; vendor_code: string; vendor_name: string }[] =
    (ledgerVendorQuery.data as any)?.data ?? (ledgerVendorQuery.data as any) ?? [];

  // GRN approval backlog — GET /api/finance/grns/summary already exists (grn.routes.ts),
  // already RBAC-scoped the same way as this page's own endpoints, and already returns
  // branch_head_approved/finance_head_approved counts. No new backend endpoint needed.
  // payroll_head is on this page's PAYMENT_READ_ROLES but not GRN_READ_ROLES, so a 403 here
  // is an expected outcome for that role, not an error — pendingApproval degrades to null.
  const pendingApprovalQuery = useQuery({
    queryKey: ["grn-approval-summary", filters.branchId],
    queryFn: () => hrmsApi.get<any>(
      filters.branchId
        ? `/api/finance/grns/summary?branchId=${filters.branchId}`
        : "/api/finance/grns/summary"
    ),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const pendingApproval: { count: number; value: number } | null = (() => {
    if (pendingApprovalQuery.isError) return null;
    const byStatus = (pendingApprovalQuery.data as any)?.data?.byStatus;
    if (!byStatus) return null;
    const branchHead = byStatus.branch_head_approved ?? { count: 0, value: 0 };
    // Accounts Head's own approval gate (owner ruling, 2026-09-12) — a GRN sitting here is just
    // as much "not yet reached this page" as one still with Branch Head or Finance Head.
    const accountsHead = byStatus.accounts_head_approved ?? { count: 0, value: 0 };
    const financeHead = byStatus.finance_head_approved ?? { count: 0, value: 0 };
    return {
      count: Number(branchHead.count ?? 0) + Number(accountsHead.count ?? 0) + Number(financeHead.count ?? 0),
      value: Number(branchHead.value ?? 0) + Number(accountsHead.value ?? 0) + Number(financeHead.value ?? 0),
    };
  })();

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

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <DashboardLayout>
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
            {capabilities?.readScope === "organisation" ? (
              <Badge variant="outline">organisation scope</Badge>
            ) : capabilities?.scopeBranchNames && capabilities.scopeBranchNames.length > 0 ? (
              <Badge variant="outline" title="All branches in the filter bar is narrowed to these on the backend">
                {capabilities.scopeBranchNames.join(", ")} only
              </Badge>
            ) : capabilities?.readScope === "branch" ? (
              <Badge variant="outline">branch scope</Badge>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setShowAging((v) => !v)}>
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />Aging
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowLedger((v) => !v)}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />Ledger
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowBacklog((v) => !v)}>
              <Clock className="mr-1.5 h-3.5 w-3.5" />Backlog
              {pendingApproval && pendingApproval.count > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">
                  {pendingApproval.count}
                </span>
              )}
            </Button>
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 border-b bg-slate-50/40 px-4 py-3 text-xs shrink-0">
          <Metric label="Page due" value={money(summary.due)} />
          <Metric label="Paid" value={money(summary.paid)} tone="emerald" />
          <Metric label="Balance" value={money(summary.balance)} tone="blue" />
          <Metric label="Overdue" value={money(summary.overdue)} tone="rose" />
          {pendingApproval && (
            <Metric
              label="Pending approval"
              value={money(pendingApproval.value)}
              sub={`${pendingApproval.count} GRN${pendingApproval.count === 1 ? "" : "s"}`}
              tone="amber"
            />
          )}
        </div>

        {/* ── Filter bar ── */}
        {/* A labeled grid, not a ragged flex-wrap row: every control sits under its own caption
            at the same 32px height (the MonthYearPicker's two <select>s included — it defaults
            to h-9 when no selectClassName is passed, which is what made it stand a visible notch
            taller than every Select/Input beside it), so fields line up in clean columns instead
            of drifting to whatever width their content happened to need. */}
        {showFilters && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-b bg-slate-50/60 px-4 py-3 shrink-0 sm:grid-cols-3 lg:grid-cols-7 lg:items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Branch</label>
              <Select
                value={filters.branchId || "_all"}
                onValueChange={(value) => {
                  setFilters((c) => ({ ...c, branchId: value === "_all" ? "" : value }));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All branches</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>{branchLabel(branch)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Month</label>
              <MonthYearPicker
                className="w-full"
                selectClassName="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                value={filters.month}
                onChange={(v) => { setFilters((c) => ({ ...c, month: v })); setPage(1); }}
                emptyLabel="All months"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Financial year</label>
              <Select
                value={filters.financialYear || "_all"}
                onValueChange={(value) => {
                  setFilters((c) => ({ ...c, financialYear: value === "_all" ? "" : value }));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="All years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All years</SelectItem>
                  {financialYearOptions().map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</label>
              <Select
                value={filters.paymentStatus || "_all"}
                onValueChange={(value) => {
                  setFilters((c) => ({ ...c, paymentStatus: value === "_all" ? "" : value }));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All statuses</SelectItem>
                  {PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Due from</label>
              <Input
                type="date"
                className="h-8 w-full text-xs"
                value={filters.dueDateFrom}
                onChange={(e) => { setFilters((c) => ({ ...c, dueDateFrom: e.target.value })); setPage(1); }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Due to</label>
              <Input
                type="date"
                className="h-8 w-full text-xs"
                value={filters.dueDateTo}
                onChange={(e) => { setFilters((c) => ({ ...c, dueDateTo: e.target.value })); setPage(1); }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  className="h-8 w-full pl-7 text-xs"
                  value={filters.search}
                  onChange={(e) => { setFilters((c) => ({ ...c, search: e.target.value })); setPage(1); }}
                  placeholder="GRN / vendor / UTR"
                />
              </div>
            </div>
            <div className="col-span-2 flex justify-end sm:col-span-3 lg:col-span-7">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
                <X className="mr-1 h-3 w-3" />Clear filters
              </Button>
            </div>
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
                  <th className="h-8 min-w-[110px] text-left font-medium text-slate-500">Invoice</th>
                  <th className="h-8 min-w-[120px] text-left font-medium text-slate-500">Vendor</th>
                  <th className="h-8 min-w-[110px] text-left font-medium text-slate-500">Head / Sub-head</th>
                  <th className="h-8 min-w-[110px] text-left font-medium text-slate-500">Cost centre / Process</th>
                  {/* Amounts right-aligned and tabular so a column of money lines up on the
                      decimal — the Finance convention the plan set out. */}
                  <th className="h-8 min-w-[90px] text-right font-medium text-slate-500">GRN amount</th>
                  <th className="h-8 min-w-[80px] text-right font-medium text-slate-500">Paid</th>
                  <th className="h-8 min-w-[80px] text-right font-medium text-slate-500">Balance</th>
                  <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Due date</th>
                  <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Status</th>
                  <th className="h-8 min-w-[110px] text-left font-medium text-slate-500">Voucher</th>
                  <th className="h-8 min-w-[130px] text-left font-medium text-slate-500">Action</th>
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
                    <td className="truncate max-w-[110px] py-1">
                      <div className="truncate">{p.invoice_number ?? "-"}</div>
                      {/* The GRN file is what a vendor query actually needs opening; surfaced
                          here rather than only inside the dispatch sheet. */}
                      {p.grn_file_name && (
                        <div className="truncate text-slate-400">{p.grn_file_name}</div>
                      )}
                    </td>
                    <td className="truncate max-w-[120px] py-1">{p.vendor_name ?? "-"}</td>
                    <td className="truncate max-w-[110px] py-1">
                      <div className="truncate">{p.head ?? "-"}</div>
                      <div className="truncate text-slate-400">{p.sub_head ?? "-"}</div>
                    </td>
                    <td className="truncate max-w-[110px] py-1">
                      <div className="truncate">{p.cost_centre_name ?? "-"}</div>
                      <div className="truncate text-slate-400">{p.process_name ?? "-"}</div>
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      ₹{(p.due_amount ?? 0).toLocaleString("en-IN")}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      ₹{(p.paid_amount ?? 0).toLocaleString("en-IN")}
                    </td>
                    <td className="py-1 text-right font-medium tabular-nums">
                      ₹{(p.balance_amount ?? 0).toLocaleString("en-IN")}
                    </td>
                    <td className="py-1">
                      {p.due_date ? formatISTDate(p.due_date) : "-"}
                      {p.due_date && agingDays(p.due_date) > 0 && !["Paid", "Closed"].includes(p.payment_status) && (
                        <div className="text-[10px] font-medium text-rose-600">
                          {agingDays(p.due_date)} days overdue
                        </div>
                      )}
                    </td>
                    <td className="py-1">
                      <Badge
                        variant={p.payment_status === "Paid" ? "default" : p.payment_status === "On Hold" ? "destructive" : "secondary"}
                        className="text-xs"
                      >
                        {p.payment_status}
                      </Badge>
                    </td>
                    <td className="py-1">
                      {p.voucher_status ? (
                        <button
                          type="button"
                          className="cursor-pointer text-left"
                          title={`${p.voucher_number ?? "Voucher"} — open approval detail`}
                          onClick={(e) => { e.stopPropagation(); setVoucherDrawerId(p.voucher_id ?? null); }}
                        >
                          <VoucherStatusBadge status={p.voucher_status} className="text-[10px]" />
                          <div className="truncate max-w-[110px] text-[10px] text-slate-400">{p.voucher_number}</div>
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-1">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={(e) => { e.stopPropagation(); setSelected(p); setSheetOpen(true); }}
                        >
                          Pay
                        </Button>
                        {/* Only offered where it can actually succeed: no voucher already in
                            flight (the server rejects a second one) and something still owed. */}
                        {canRaiseVoucher && !p.active_voucher && Number(p.balance_amount ?? 0) > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-blue-700 hover:bg-blue-50"
                            onClick={(e) => { e.stopPropagation(); setRaiseForDue(p); }}
                          >
                            Raise
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-slate-400">
                      {activeFilterCount === 0 && pendingApproval && pendingApproval.count > 0 ? (
                        <>
                          No payments due for dispatch — {pendingApproval.count} GRN
                          {pendingApproval.count === 1 ? "" : "s"} ({money(pendingApproval.value)}) are
                          still awaiting approval before they reach this queue.{" "}
                          <button
                            type="button"
                            className="font-medium text-blue-600 hover:underline"
                            onClick={() => setShowBacklog(true)}
                          >
                            View backlog
                          </button>
                        </>
                      ) : (
                        "No payments found"
                      )}
                    </td>
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

      {/* 4-B: AP Aging Panel */}
      {showAging && (
        <div className="border-t px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-800">AP Aging — Outstanding Balances</p>
            {agingQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>
          {agingQuery.isError ? (
            <p className="text-xs text-rose-600">Could not load aging data. {agingQuery.error instanceof Error ? agingQuery.error.message : ""}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-5">
              {(["current","1-30","31-60","61-90",">90"] as const).map((bucket) => {
                const items: any[] = agingBuckets[bucket] ?? [];
                const total = items.reduce((s: number, r: any) => s + Number(r.balance_amount ?? 0), 0);
                const isOverdue = bucket !== "current";
                return (
                  <div key={bucket} className={`rounded-xl border p-3 ${isOverdue && items.length ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
                    <p className="text-[11px] font-medium text-slate-500 uppercase">{bucket === "current" ? "Current (not due)" : `${bucket} days overdue`}</p>
                    <p className={`mt-1 text-base font-semibold tabular-nums ${isOverdue && items.length ? "text-rose-700" : "text-slate-800"}`}>{money(total)}</p>
                    <p className="text-[11px] text-slate-400">{items.length} invoice{items.length !== 1 ? "s" : ""}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Approval Backlog — GRNs that must clear Branch Head + Finance Head approval before
          they ever reach vendor_payment_tracking and this page's own grid. Read-only link-out;
          approving is a different page's job. */}
      {showBacklog && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">Approval Backlog</p>
          {pendingApprovalQuery.isError ? (
            <p className="text-xs text-slate-400">
              Approval backlog isn't visible for your role — ask a Finance/Accounts Head to check
              the GRN approval queue directly.
            </p>
          ) : !pendingApproval || pendingApproval.count === 0 ? (
            <p className="text-xs text-slate-400">No GRNs waiting on approval right now.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {BACKLOG_STAGES.map(({ key, label }) => {
                const byStatus = (pendingApprovalQuery.data as any)?.data?.byStatus ?? {};
                const bucket = byStatus[key] ?? { count: 0, value: 0 };
                return (
                  <div key={key} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-[11px] font-medium text-slate-500 uppercase">{label}</p>
                    <p className="mt-1 text-base font-semibold tabular-nums text-amber-700">
                      {money(bucket.value)}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {bucket.count} GRN{bucket.count === 1 ? "" : "s"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          <a href="/finance/grn" className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline">
            Open GRN Approvals →
          </a>
        </div>
      )}

      {/* 4-C: Vendor Ledger Panel */}
      {showLedger && (
        <div className="border-t px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-semibold text-slate-800">Vendor Account Statement</p>
            <Input
              className="h-8 w-48 text-xs"
              placeholder="Search name or code…"
              value={ledgerVendorSearch}
              onChange={(e) => setLedgerVendorSearch(e.target.value)}
            />
            <Select value={ledgerVendorId} onValueChange={setLedgerVendorId}>
              <SelectTrigger className="h-8 w-64 text-xs">
                <SelectValue placeholder={ledgerVendorQuery.isFetching ? "Loading…" : "Select vendor…"} />
              </SelectTrigger>
              <SelectContent>
                {ledgerVendorOptions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.vendor_code} — {v.vendor_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ledgerQuery.isFetching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          </div>
          {!ledgerVendorId && <p className="text-xs text-slate-400">Search and select a vendor above to load their statement.</p>}
          {ledgerVendorId && ledgerRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b bg-slate-50">
                    {["GRN No.", "Date", "Invoice No.", "Period", "Due Amt", "TDS", "Net Payable", "Paid", "Balance", "Status", "Due Date", "Branch"].map((h) => (
                      <th
                        key={h}
                        className="h-8 px-3 text-left font-medium text-slate-500"
                        title={h === "Period" ? "This is accounting_period — the main grid above filters by due_date instead, so a bill can show a different month here than in the Due date filter." : undefined}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ledgerRows.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2 font-mono text-[11px]">{row.grn_number ?? "—"}</td>
                      <td className="px-3 py-2">{row.bill_date ? String(row.bill_date).slice(0,10) : "—"}</td>
                      <td className="px-3 py-2">{row.invoice_number ?? "—"}</td>
                      <td className="px-3 py-2">{row.accounting_period ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-right">{money(row.due_amount)}</td>
                      <td className="px-3 py-2 tabular-nums text-right text-amber-700">{money(row.tds_deducted_amount)}</td>
                      <td className="px-3 py-2 tabular-nums text-right">{money(row.net_payable)}</td>
                      <td className="px-3 py-2 tabular-nums text-right text-emerald-700">{money(row.paid_amount)}</td>
                      <td className="px-3 py-2 tabular-nums text-right">{money(row.balance_amount)}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className={STATUS_CLASS[row.payment_status] ?? ""}>{row.payment_status}</Badge></td>
                      <td className="px-3 py-2">{row.due_date ? String(row.due_date).slice(0,10) : "—"}</td>
                      <td className="px-3 py-2">{row.branch_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ledgerVendorId && !ledgerQuery.isFetching && ledgerRows.length === 0 && (
            <p className="text-xs text-slate-400">No transactions found for this vendor.</p>
          )}
        </div>
      )}

      {/* ── Edit Sheet ── */}
      <PaymentDispatchSheet
        payment={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={() => void refetch()}
        onOpenVoucher={(voucherId) => {
          // Hand off, don't nest: close the sheet, then open the drawer on the voucher.
          setSheetOpen(false);
          setVoucherDrawerId(voucherId);
        }}
      />

      {/* Same drawer the Payment Vouchers page mounts — one component, so a voucher offers the
          identical CEO-approve / release / review actions whichever page opened it. */}
      <PaymentVoucherDrawer
        voucherId={voucherDrawerId}
        open={!!voucherDrawerId}
        onOpenChange={(o) => { if (!o) setVoucherDrawerId(null); }}
        onChanged={() => void refetch()}
      />

      <RaiseVoucherForSingleDueDialog
        payment={raiseForDue}
        open={!!raiseForDue}
        onOpenChange={(o) => { if (!o) setRaiseForDue(null); }}
        onRaised={() => void refetch()}
      />
    </DashboardLayout>
  );
}
