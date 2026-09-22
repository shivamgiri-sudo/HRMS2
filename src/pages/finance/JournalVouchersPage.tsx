// src/pages/finance/JournalVouchersPage.tsx
//
// Manual Journal Voucher — the accountant-authored entries (provision, reclassification,
// depreciation, correction, opening balance) journal.service.ts's own header declared as
// source_type='manual' but had no screen to create. Maker drafts and submits; a different
// approver (Finance Head/CEO) posts it straight into the double-entry ledger
// (journal_entry/journal_entry_line) via journalService.post().
//
// `JournalVouchersContent` (no DashboardLayout of its own) is the tab FinanceLedgerHubPage.tsx
// mounts; the default export below wraps it for a direct link.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis,
} from "recharts";
import {
  CheckCircle2, Clock, Download, FileWarning, IndianRupee, Plus, Scale, Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, type FilterChip } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useHasRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  JV_STATUSES, JV_TYPES, STATUS_LABEL, STATUS_TONE, TYPE_LABEL,
  compactMoney, dateOnly, money, type JvDetail, type JvListRow, type JvStatus, type JvType,
} from "@/lib/finance/journalVoucherStatus";
import { JournalVoucherFormDialog } from "@/components/finance/journal/JournalVoucherFormDialog";
import { JournalVoucherDrawer } from "@/components/finance/journal/JournalVoucherDrawer";

const ALL = "__all__";
const PAGE_SIZE = 25;

type Summary = {
  byStatus: Record<JvStatus, { count: number; amount: number }>;
  postedAmount: number;
  pendingAmount: number;
  avgApprovalHours: number | null;
  oldestPendingHours: number | null;
  rejectionRatePct: number | null;
  byType: { jvType: JvType; count: number; postedAmount: number }[];
  byBranch: { branchId: string | null; branchName: string; count: number; postedAmount: number }[];
  byMonth: { month: string; count: number; amount: number }[];
};

type FilterOptions = { branches: { id: string; name: string }[]; costCentres: { id: string; name: string }[]; processes: { id: string; name: string }[] };

type ListResponse = { rows: JvListRow[]; total: number; page: number; pageSize: number };

const monthConfig: ChartConfig = { amount: { label: "Posted Amount", color: "#2563EB" } };

function KpiTile({ label, value, subtitle, tone, icon: Icon }: { label: string; value: string; subtitle?: string; tone: "blue" | "amber" | "green" | "red" | "slate"; icon: React.ElementType }) {
  const tones: Record<string, { bg: string; icon: string; value: string }> = {
    blue: { bg: "bg-blue-50", icon: "text-blue-600", value: "text-blue-700" },
    amber: { bg: "bg-amber-50", icon: "text-amber-600", value: "text-amber-700" },
    green: { bg: "bg-emerald-50", icon: "text-emerald-600", value: "text-emerald-700" },
    red: { bg: "bg-red-50", icon: "text-red-600", value: "text-red-700" },
    slate: { bg: "bg-slate-100", icon: "text-slate-600", value: "text-slate-800" },
  };
  const t = tones[tone];
  return (
    <div className="rounded-2xl border border-white/60 bg-white/95 p-4 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.bg}`}><Icon className={`h-3.5 w-3.5 ${t.icon}`} /></div>
      </div>
      <div className={`text-xl font-bold ${t.value}`}>{value}</div>
      {subtitle && <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>}
    </div>
  );
}

export function JournalVouchersContent() {
  const qc = useQueryClient();
  const canCreate = useHasRole("finance", "finance_head", "accounts_head", "super_admin");

  const [status, setStatus] = useState("");
  const [jvType, setJvType] = useState("");
  const [branchId, setBranchId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [processId, setProcessId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "voucherDate", dir: "desc" });
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<JvDetail | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const filterOptionsQuery = useQuery({
    queryKey: ["journal-voucher-options-filters"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: FilterOptions }>("/api/finance/journal-vouchers/options")).data,
  });
  const options = filterOptionsQuery.data;

  const filterParams = useMemo(() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (jvType) qs.set("jvType", jvType);
    if (branchId) qs.set("branchId", branchId);
    if (costCentreId) qs.set("costCentreId", costCentreId);
    if (processId) qs.set("processId", processId);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (q.trim()) qs.set("q", q.trim());
    if (minAmount) qs.set("minAmount", minAmount);
    if (maxAmount) qs.set("maxAmount", maxAmount);
    return qs;
  }, [status, jvType, branchId, costCentreId, processId, from, to, q, minAmount, maxAmount]);

  const listQuery = useQuery({
    queryKey: ["journal-vouchers", filterParams.toString(), sort.key, sort.dir, page],
    queryFn: async () => {
      const qs = new URLSearchParams(filterParams);
      qs.set("sort", sort.key); qs.set("dir", sort.dir); qs.set("page", String(page)); qs.set("pageSize", String(PAGE_SIZE));
      return (await hrmsApi.get<{ success: boolean; data: ListResponse }>(`/api/finance/journal-vouchers?${qs.toString()}`)).data;
    },
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const summaryQuery = useQuery({
    queryKey: ["journal-voucher-summary", filterParams.toString()],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: Summary }>(`/api/finance/journal-vouchers/summary?${filterParams.toString()}`)).data,
  });
  const summary = summaryQuery.data;

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  const setStatusP = resetPage(setStatus), setTypeP = resetPage(setJvType), setBranchP = resetPage(setBranchId);
  const setCcP = resetPage(setCostCentreId), setProcP = resetPage(setProcessId);
  const setFromP = resetPage(setFrom), setToP = resetPage(setTo), setQP = resetPage(setQ);
  const setMinP = resetPage(setMinAmount), setMaxP = resetPage(setMaxAmount);

  const chips: FilterChip[] = [
    status && { key: "status", label: "Status", value: STATUS_LABEL[status as JvStatus] },
    jvType && { key: "jvType", label: "Type", value: TYPE_LABEL[jvType as JvType] },
    branchId && { key: "branchId", label: "Branch", value: options?.branches.find((b) => b.id === branchId)?.name ?? branchId },
    costCentreId && { key: "costCentreId", label: "Cost Centre", value: options?.costCentres.find((c) => c.id === costCentreId)?.name ?? costCentreId },
    processId && { key: "processId", label: "Process", value: options?.processes.find((p) => p.id === processId)?.name ?? processId },
    from && { key: "from", label: "From", value: from },
    to && { key: "to", label: "To", value: to },
    q.trim() && { key: "q", label: "Search", value: q.trim() },
    minAmount && { key: "minAmount", label: "Min ₹", value: minAmount },
    maxAmount && { key: "maxAmount", label: "Max ₹", value: maxAmount },
  ].filter(Boolean) as FilterChip[];

  const removeChip = (key: string) => {
    ({ status: () => setStatusP(""), jvType: () => setTypeP(""), branchId: () => setBranchP(""), costCentreId: () => setCcP(""),
      processId: () => setProcP(""), from: () => setFromP(""), to: () => setToP(""), q: () => setQP(""),
      minAmount: () => setMinP(""), maxAmount: () => setMaxP("") } as Record<string, () => void>)[key]?.();
  };
  const clearAll = () => { setStatusP(""); setTypeP(""); setBranchP(""); setCcP(""); setProcP(""); setFromP(""); setToP(""); setQP(""); setMinP(""); setMaxP(""); };

  const onSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  const sortDir = (key: string): "asc" | "desc" | null => (sort.key === key ? sort.dir : null);

  const monthChartData = (summary?.byMonth ?? []).map((m) => ({ ...m, monthLabel: m.month.slice(2) }));

  const download = async (detail: "vouchers" | "lines") => {
    const qs = new URLSearchParams(filterParams); qs.set("detail", detail);
    const blob = await hrmsApi.getBlob(`/api/finance/journal-vouchers/export?${qs.toString()}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `journal-vouchers-${detail}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Journal Vouchers</h2>
          <p className="text-xs text-slate-500">Manual double-entry postings — provisions, reclassifications, depreciation, corrections. Maker drafts, a different approver posts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="cursor-pointer gap-1.5" onClick={() => download("vouchers")}>
            <Download className="h-3.5 w-3.5" /> Export Vouchers
          </Button>
          <Button variant="outline" size="sm" className="cursor-pointer gap-1.5" onClick={() => download("lines")}>
            <Download className="h-3.5 w-3.5" /> Export Lines
          </Button>
          {canCreate && (
            <Button size="sm" className="cursor-pointer gap-1.5 bg-blue-600 shadow-[0_4px_12px_rgba(37,99,235,0.3)] hover:bg-blue-700" onClick={() => { setEditingVoucher(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> New Journal Voucher
            </Button>
          )}
        </div>
      </div>

      {/* Metrics */}
      {summaryQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiTile label="Posted Amount" value={compactMoney(summary.postedAmount)} subtitle={`${summary.byStatus.posted.count} vouchers`} tone="green" icon={CheckCircle2} />
          <KpiTile label="Pending Approval" value={compactMoney(summary.pendingAmount)} subtitle={`${summary.byStatus.pending_approval.count} awaiting`} tone="amber" icon={Clock} />
          <KpiTile label="Oldest Pending" value={summary.oldestPendingHours === null ? "—" : `${summary.oldestPendingHours}h`} subtitle="hours open" tone="amber" icon={FileWarning} />
          <KpiTile label="Avg. Approval Time" value={summary.avgApprovalHours === null ? "—" : `${summary.avgApprovalHours}h`} subtitle="submit → post" tone="blue" icon={Scale} />
          <KpiTile label="Rejection Rate" value={summary.rejectionRatePct === null ? "—" : `${summary.rejectionRatePct}%`} subtitle="of decided vouchers" tone="red" icon={FileWarning} />
          <KpiTile label="Drafts" value={String(summary.byStatus.draft.count)} subtitle="not yet submitted" tone="slate" icon={IndianRupee} />
        </div>
      )}

      {/* Breakdown by type/branch + trend */}
      {summary && (summary.byType.length > 0 || summary.byMonth.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/60 bg-white/95 p-4 shadow-sm lg:col-span-2">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Posted Amount by Month</h3>
            {monthChartData.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">No posted vouchers in range yet</p>
            ) : (
              <ChartContainer config={monthConfig} className="h-[220px] w-full">
                <BarChart data={monthChartData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => compactMoney(v)} tick={{ fontSize: 11 }} width={56} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
                  <Bar dataKey="amount" fill="var(--color-amount)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/95 p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">By Voucher Type</h3>
            <div className="space-y-2">
              {summary.byType.length === 0 && <p className="text-xs text-slate-400">None</p>}
              {summary.byType.slice(0, 8).map((t) => (
                <div key={t.jvType} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">{TYPE_LABEL[t.jvType]} <span className="text-slate-400">({t.count})</span></span>
                  <span className="font-semibold tabular-nums text-slate-800">{compactMoney(t.postedAmount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/60 bg-white/95 p-3 shadow-sm">
        <div className="relative min-w-[200px] flex-1">
          <Label>Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input className="h-8 pl-8 text-xs" placeholder="Voucher no., narration, reference…" value={q} onChange={(e) => setQP(e.target.value)} />
          </div>
        </div>
        <div className="min-w-[150px]">
          <Label>Status</Label>
          <Select value={status || ALL} onValueChange={(v) => setStatusP(v === ALL ? "" : v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All statuses</SelectItem>{JV_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px]">
          <Label>Type</Label>
          <Select value={jvType || ALL} onValueChange={(v) => setTypeP(v === ALL ? "" : v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All types</SelectItem>{JV_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-[150px]">
          <Label>Branch</Label>
          <Select value={branchId || ALL} onValueChange={(v) => setBranchP(v === ALL ? "" : v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All branches" /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All branches</SelectItem>{(options?.branches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-[150px]">
          <Label>Cost Centre</Label>
          <Select value={costCentreId || ALL} onValueChange={(v) => setCcP(v === ALL ? "" : v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All cost centres" /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All cost centres</SelectItem>{(options?.costCentres ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-[150px]">
          <Label>Process</Label>
          <Select value={processId || ALL} onValueChange={(v) => setProcP(v === ALL ? "" : v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All processes" /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All processes</SelectItem>{(options?.processes ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>From</Label>
          <Input type="date" className="h-8 w-36 text-xs" value={from} onChange={(e) => setFromP(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" className="h-8 w-36 text-xs" value={to} onChange={(e) => setToP(e.target.value)} />
        </div>
        <div>
          <Label>Min ₹</Label>
          <Input type="number" min="0" className="h-8 w-24 text-xs" value={minAmount} onChange={(e) => setMinP(e.target.value)} />
        </div>
        <div>
          <Label>Max ₹</Label>
          <Input type="number" min="0" className="h-8 w-24 text-xs" value={maxAmount} onChange={(e) => setMaxP(e.target.value)} />
        </div>
      </div>

      <FilterBar filters={chips} resultCount={total} onRemove={removeChip} onClearAll={clearAll} />

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-blue-50/60 hover:bg-blue-50/60">
                <SortableTableHead sortKey="voucherNumber" currentSortKey={sort.key} direction={sortDir("voucherNumber")} onSort={onSort} className="text-[11px] font-bold uppercase tracking-wide text-blue-800">Voucher No.</SortableTableHead>
                <SortableTableHead sortKey="voucherDate" currentSortKey={sort.key} direction={sortDir("voucherDate")} onSort={onSort} className="text-[11px] font-bold uppercase tracking-wide text-blue-800">Date</SortableTableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-blue-800">Type</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-blue-800">Narration</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-blue-800">Branch / Cost Centre</TableHead>
                <SortableTableHead sortKey="amount" currentSortKey={sort.key} direction={sortDir("amount")} onSort={onSort} className="text-right text-[11px] font-bold uppercase tracking-wide text-blue-800">Amount</SortableTableHead>
                <SortableTableHead sortKey="status" currentSortKey={sort.key} direction={sortDir("status")} onSort={onSort} className="text-[11px] font-bold uppercase tracking-wide text-blue-800">Status</SortableTableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-blue-800">Maker</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading && Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              ))}
              {!listQuery.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="p-0"><EmptyState title="No journal vouchers match these filters" description="Try widening the date range or clearing filters." /></TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => setDrawerId(r.id)}>
                  <TableCell className="font-medium text-slate-800">{r.voucherNumber ?? <span className="text-slate-400">(draft)</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">{dateOnly(r.voucherDate)}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{TYPE_LABEL[r.jvType]}</Badge></TableCell>
                  <TableCell className="max-w-[260px] truncate text-slate-600" title={r.narration}>{r.narration}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-slate-600">{[r.branchName, r.costCentreName].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-slate-800">{money(r.totalAmount)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.status === "pending_approval" && r.pendingHours !== null && r.pendingHours >= 48 && (
                      <span className="ml-1.5 text-[10px] font-semibold text-rose-600">{Math.floor(r.pendingHours / 24)}d overdue</span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600">{r.createdByName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="cursor-pointer" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span>Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" className="cursor-pointer" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <JournalVoucherFormDialog
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditingVoucher(null); }}
        voucher={editingVoucher}
        onSaved={(id) => { setDrawerId(id); qc.invalidateQueries({ queryKey: ["journal-vouchers"] }); }}
      />
      <JournalVoucherDrawer
        voucherId={drawerId}
        open={!!drawerId}
        onOpenChange={(o) => { if (!o) setDrawerId(null); }}
        onEdit={(voucher) => { setDrawerId(null); setEditingVoucher(voucher); setFormOpen(true); }}
        onChanged={() => listQuery.refetch()}
      />
    </div>
  );
}

export default function JournalVouchersPage() {
  return (
    <DashboardLayout>
      <div className="w-full p-4 sm:p-6">
        <JournalVouchersContent />
      </div>
    </DashboardLayout>
  );
}
