// src/pages/finance/LedgerReportsPage.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Scale, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type TrialBalanceRow = {
  accountType: "bank_account" | "vendor" | "expense_sub_head" | "payable_account";
  accountId: string;
  accountName: string;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
};

type AccountLedgerEntry = {
  journalEntryId: string;
  entryDate: string;
  narration: string;
  sourceType: string;
  sourceId: string;
  branchName: string | null;
  costCentreName: string | null;
  processName: string | null;
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
};

type FilterOption = { id: string; name: string };

/** Branch / Cost Centre / Process pickers shared by Trial Balance and Head/Sub-head Spend —
 *  a single query, deduped by React Query across both tabs. */
function useLedgerFilterOptions() {
  const query = useQuery({
    queryKey: ["ledger-reports-filter-options"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { branches: FilterOption[]; costCentres: FilterOption[]; processes: FilterOption[] } }>(
        "/api/finance/ledger-reports/filter-options",
      );
      return res.data;
    },
  });
  return {
    branches: query.data?.branches ?? [],
    costCentres: query.data?.costCentres ?? [],
    processes: query.data?.processes ?? [],
  };
}

const ALL_VALUE = "__all__";

function DepthFilters({
  branchId, setBranchId, costCentreId, setCostCentreId, processId, setProcessId,
}: {
  branchId: string; setBranchId: (v: string) => void;
  costCentreId: string; setCostCentreId: (v: string) => void;
  processId: string; setProcessId: (v: string) => void;
}) {
  const { branches, costCentres, processes } = useLedgerFilterOptions();
  return (
    <>
      <div className="min-w-[160px]">
        <Label>Branch</Label>
        <Select value={branchId || ALL_VALUE} onValueChange={(v) => setBranchId(v === ALL_VALUE ? "" : v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All branches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-[160px]">
        <Label>Cost Centre</Label>
        <Select value={costCentreId || ALL_VALUE} onValueChange={(v) => setCostCentreId(v === ALL_VALUE ? "" : v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All cost centres" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All cost centres</SelectItem>
            {costCentres.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-[160px]">
        <Label>Process</Label>
        <Select value={processId || ALL_VALUE} onValueChange={(v) => setProcessId(v === ALL_VALUE ? "" : v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All processes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All processes</SelectItem>
            {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

type HeadSubHeadRow = {
  accountId: string;
  headSubHead: string;
  totalSpent: number;
  grnCount: number;
};

function money(value: unknown) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

/** Right-side drill-down drawer shared by Trial Balance and Head/Subhead Ledger rows — the
 *  Drill-Down Mandate: every clickable row opens the underlying journal_entry_line postings
 *  that make up the aggregate figure, not just the total. */
function AccountLedgerDrawer({
  accountType, accountId, accountLabel, open, onOpenChange,
}: {
  accountType: string | null;
  accountId: string | null;
  accountLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ["account-ledger", accountType, accountId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { entries: AccountLedgerEntry[]; closingBalance: number } }>(
        `/api/finance/ledger-reports/account-ledger/${accountType}/${accountId}`,
      );
      return res.data;
    },
    enabled: open && !!accountType && !!accountId,
  });
  const entries = query.data?.entries ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-4xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-sm">{accountLabel}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Every posted journal line for this account — the entries behind the total.
          </p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {query.isLoading && <p className="py-6 text-center text-xs text-slate-400">Loading…</p>}
          {!query.isLoading && entries.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-400">None</p>
          )}
          {entries.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Narration</th>
                  <th className="py-2 pr-2">Source</th>
                  <th className="py-2 pr-2">Branch</th>
                  <th className="py-2 pr-2">Cost Centre</th>
                  <th className="py-2 pr-2">Process</th>
                  <th className="py-2 pr-2 text-right">Debit</th>
                  <th className="py-2 pr-2 text-right">Credit</th>
                  <th className="py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((e) => (
                  <tr key={e.journalEntryId}>
                    <td className="py-2 pr-2 whitespace-nowrap text-slate-600">{e.entryDate}</td>
                    <td className="max-w-[220px] truncate py-2 pr-2 text-slate-700" title={e.narration}>{e.narration}</td>
                    <td className="py-2 pr-2">
                      <Badge variant="outline" className="text-[10px]">
                        {e.sourceType === "grn" ? "GRN" : e.sourceType === "payment_voucher" ? "Payment Voucher" : e.sourceType}
                      </Badge>
                    </td>
                    <td className="max-w-[120px] truncate py-2 pr-2 text-slate-600" title={e.branchName ?? undefined}>{e.branchName ?? "—"}</td>
                    <td className="max-w-[140px] truncate py-2 pr-2 text-slate-600" title={e.costCentreName ?? undefined}>{e.costCentreName ?? "—"}</td>
                    <td className="max-w-[120px] truncate py-2 pr-2 text-slate-600" title={e.processName ?? undefined}>{e.processName ?? "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-rose-600">{e.debitAmount ? money(e.debitAmount) : "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-emerald-600">{e.creditAmount ? money(e.creditAmount) : "—"}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-800">{money(e.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {query.data && (
          <div className="border-t bg-slate-50 px-5 py-3 text-right text-xs font-semibold text-slate-700">
            Closing balance: {money(query.data.closingBalance)}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TrialBalanceTab() {
  const [asOfDate, setAsOfDate] = useState("");
  const [branchId, setBranchId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [processId, setProcessId] = useState("");
  const [drill, setDrill] = useState<{ accountType: string; accountId: string; label: string } | null>(null);

  const query = useQuery({
    queryKey: ["trial-balance", asOfDate, branchId, costCentreId, processId],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (asOfDate) qs.set("asOfDate", asOfDate);
      if (branchId) qs.set("branchId", branchId);
      if (costCentreId) qs.set("costCentreId", costCentreId);
      if (processId) qs.set("processId", processId);
      const res = await hrmsApi.get<{ success: boolean; data: { rows: TrialBalanceRow[]; balanced: boolean; totalDebit: number; totalCredit: number } }>(
        `/api/finance/ledger-reports/trial-balance?${qs.toString()}`,
      );
      return res.data;
    },
  });
  const rows = query.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>As of date</Label>
            <Input type="date" className="h-8 w-40 text-xs" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </div>
          <DepthFilters
            branchId={branchId} setBranchId={setBranchId}
            costCentreId={costCentreId} setCostCentreId={setCostCentreId}
            processId={processId} setProcessId={setProcessId}
          />
        </div>
        {query.data && (
          <Badge
            variant="outline"
            className={query.data.balanced ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}
          >
            {query.data.balanced ? "Balanced — debit = credit" : "NOT BALANCED — needs investigation"}
          </Badge>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
              <tr>
                <th className="px-3 py-2.5">Account</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5 text-right">Debit</th>
                <th className="px-3 py-2.5 text-right">Credit</th>
                <th className="px-3 py-2.5 text-right">Net Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-100">
              {query.isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>}
              {!query.isLoading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No postings yet</td></tr>}
              {rows.map((r) => (
                <tr
                  key={`${r.accountType}:${r.accountId}`}
                  className="cursor-pointer hover:bg-blue-50/40"
                  onClick={() => setDrill({ accountType: r.accountType, accountId: r.accountId, label: r.accountName })}
                >
                  <td className="px-3 py-2 text-gray-800">{r.accountName}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{r.accountType.replace(/_/g, " ")}</Badge></td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600">{r.totalDebit ? money(r.totalDebit) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.totalCredit ? money(r.totalCredit) : "—"}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-800">{money(r.netBalance)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && query.data && (
              <tfoot>
                <tr className="border-t-2 border-blue-100 bg-blue-50/40 font-bold text-gray-800">
                  <td colSpan={2} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right text-rose-700">{money(query.data.totalDebit)}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{money(query.data.totalCredit)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <AccountLedgerDrawer
        accountType={drill?.accountType ?? null}
        accountId={drill?.accountId ?? null}
        accountLabel={drill?.label ?? ""}
        open={!!drill}
        onOpenChange={(o) => { if (!o) setDrill(null); }}
      />
    </div>
  );
}

function VendorLedgerTab() {
  const [search, setSearch] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const vendorQuery = useQuery({
    queryKey: ["ledger-reports-vendor-search", search],
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/erp/vendors?q=${encodeURIComponent(search)}&limit=50&is_active=1`);
      return (res as any)?.data ?? res ?? [];
    },
  });
  const vendorOptions: { id: string; vendor_code: string; vendor_name: string }[] = vendorQuery.data ?? [];

  const ledgerQuery = useQuery({
    queryKey: ["ledger-reports-vendor-ledger", vendorId, from, to],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await hrmsApi.get<{ success: boolean; data: { entries: AccountLedgerEntry[]; closingBalance: number } }>(
        `/api/finance/ledger-reports/vendor-ledger/${vendorId}?${qs.toString()}`,
      );
      return res.data;
    },
    enabled: !!vendorId,
  });
  const entries = ledgerQuery.data?.entries ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <Label>Vendor</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input className="h-8 pl-7 text-xs" placeholder="Search name or code…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Select vendor…" /></SelectTrigger>
            <SelectContent>
              {vendorOptions.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.vendor_code} — {v.vendor_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div><Label>From</Label><Input type="date" className="h-8 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" className="h-8 text-xs" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
              <tr>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Narration</th>
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5 text-right">Debit</th>
                <th className="px-3 py-2.5 text-right">Credit</th>
                <th className="px-3 py-2.5 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-100">
              {!vendorId && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Search and select a vendor above</td></tr>}
              {vendorId && ledgerQuery.isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>}
              {vendorId && !ledgerQuery.isLoading && entries.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No postings for this vendor</td></tr>}
              {entries.map((e) => (
                <tr key={e.journalEntryId} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2 text-gray-600">{e.entryDate}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-gray-500" title={e.narration}>{e.narration}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{e.sourceType === "grn" ? "GRN" : e.sourceType === "payment_voucher" ? "Payment Voucher" : e.sourceType}</Badge></td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600">{e.debitAmount ? money(e.debitAmount) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{e.creditAmount ? money(e.creditAmount) : "—"}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-800">{money(e.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
            {entries.length > 0 && ledgerQuery.data && (
              <tfoot>
                <tr className="border-t-2 border-blue-100 bg-blue-50/40 font-bold text-gray-800">
                  <td colSpan={5} className="px-3 py-2 text-right">Closing balance</td>
                  <td className="px-3 py-2 text-right">{money(ledgerQuery.data.closingBalance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function HeadSubHeadLedgerTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [processId, setProcessId] = useState("");
  const [drill, setDrill] = useState<{ accountId: string; label: string } | null>(null);

  const query = useQuery({
    queryKey: ["ledger-reports-head-subhead", from, to, branchId, costCentreId, processId],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (branchId) qs.set("branchId", branchId);
      if (costCentreId) qs.set("costCentreId", costCentreId);
      if (processId) qs.set("processId", processId);
      const res = await hrmsApi.get<{ success: boolean; data: HeadSubHeadRow[] }>(`/api/finance/ledger-reports/head-subhead-ledger?${qs.toString()}`);
      return res.data ?? [];
    },
  });
  const rows = query.data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.totalSpent), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label>From</Label><Input type="date" className="h-8 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" className="h-8 text-xs" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <DepthFilters
          branchId={branchId} setBranchId={setBranchId}
          costCentreId={costCentreId} setCostCentreId={setCostCentreId}
          processId={processId} setProcessId={setProcessId}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
              <tr>
                <th className="px-3 py-2.5">Head / Sub-head</th>
                <th className="px-3 py-2.5 text-right">GRN Count</th>
                <th className="px-3 py-2.5 text-right">Total Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-100">
              {query.isLoading && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>}
              {!query.isLoading && rows.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">No postings yet</td></tr>}
              {rows.map((r) => (
                <tr
                  key={r.accountId}
                  className="cursor-pointer hover:bg-blue-50/40"
                  onClick={() => setDrill({ accountId: r.accountId, label: r.headSubHead })}
                >
                  <td className="px-3 py-2 text-gray-800">{r.headSubHead}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.grnCount}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-800">{money(r.totalSpent)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-blue-100 bg-blue-50/40 font-bold text-gray-800">
                  <td className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right">{rows.reduce((s, r) => s + r.grnCount, 0)}</td>
                  <td className="px-3 py-2 text-right">{money(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <AccountLedgerDrawer
        accountType={drill ? "expense_sub_head" : null}
        accountId={drill?.accountId ?? null}
        accountLabel={drill?.label ?? ""}
        open={!!drill}
        onOpenChange={(o) => { if (!o) setDrill(null); }}
      />
    </div>
  );
}

export function LedgerReportsContent() {
  return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div className="overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm">
          <div className="flex items-center gap-3 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Scale className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-bold">Ledger Reports</h1>
              <p className="text-sm text-blue-100">
                Trial Balance, Vendor Ledger and Head/Subhead spend — read directly off the double-entry journal.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800 flex items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
          These reports only see activity actually posted to the journal — GRN approvals and Payment Voucher releases from the point the journal engine went live, plus anything the historical backfill has covered so far.
        </div>

        <Tabs defaultValue="trial-balance">
          <TabsList>
            <TabsTrigger value="trial-balance" className="cursor-pointer">Trial Balance</TabsTrigger>
            <TabsTrigger value="vendor-ledger" className="cursor-pointer">Vendor Ledger</TabsTrigger>
            <TabsTrigger value="head-subhead" className="cursor-pointer">Head / Sub-head Spend</TabsTrigger>
          </TabsList>
          <TabsContent value="trial-balance" className="mt-4"><TrialBalanceTab /></TabsContent>
          <TabsContent value="vendor-ledger" className="mt-4"><VendorLedgerTab /></TabsContent>
          <TabsContent value="head-subhead" className="mt-4"><HeadSubHeadLedgerTab /></TabsContent>
        </Tabs>
      </div>
  );
}

export default function LedgerReportsPage() {
  return (
    <DashboardLayout>
      <LedgerReportsContent />
    </DashboardLayout>
  );
}
