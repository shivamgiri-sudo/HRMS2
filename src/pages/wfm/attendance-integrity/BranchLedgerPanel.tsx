import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Loader2, RefreshCw, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi, getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import { LedgerDrawer, type LedgerDrawerTarget } from "./LedgerDrawer";
import {
  KIND_LABELS, KIND_TONE, LEDGER_KINDS, currentMonth, entriesToCsv, fmtDate, fmtDateTime, givenByLabel,
  humanize, monthWindow, personLabel,
  type BranchTally, type EntriesResponse, type LedgerEntry, type LedgerKind, type PeopleData, type SummaryData,
} from "./ledgerTypes";

/**
 * Branch Ledger — for each branch, every regularization, dispute, mismatch resolution,
 * exception resolution and manual override in a month: to whom it was given and by whom.
 * Read-only; data from /api/wfm/attendance-ledger (row-scoped server-side).
 */

const API = "/api/wfm/attendance-ledger";
const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 200;
const EXPORT_MAX_PAGES = 10; // backend caps page * limit at 2000 rows
const ALL = "all";

type Branch = { id: string; branch_name: string };
type LoadError = { status: number | null; message: string };

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1.5 text-2xl font-black text-slate-950">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Person({ name, code, sub }: { name: string | null; code: string | null; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-slate-900">{name ?? "None"}</p>
      <p className="truncate text-xs text-slate-400">{[code, sub].filter(Boolean).join(" · ") || "None"}</p>
    </div>
  );
}

function KindBadge({ kind }: { kind: LedgerKind }) {
  return <Badge className={`${KIND_TONE[kind]} font-medium hover:${KIND_TONE[kind]}`}>{KIND_LABELS[kind]}</Badge>;
}

function EmptyRow({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <TableRow><TableCell colSpan={cols} className="py-10 text-center text-sm text-slate-400">{children}</TableCell></TableRow>;
}

// ── Overview: branch summary table ───────────────────────────────────────────

function SummaryTable({ branches, onOpen }: { branches: BranchTally[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Branch</TableHead>
            <TableHead className="text-right">Regularizations</TableHead>
            <TableHead className="text-right">Approved / Rejected / Pending</TableHead>
            <TableHead className="text-right">Mismatch</TableHead>
            <TableHead className="text-right">Exceptions</TableHead>
            <TableHead className="text-right">Disputes</TableHead>
            <TableHead className="text-right">Overrides</TableHead>
            <TableHead className="text-right">Employees</TableHead>
            <TableHead className="text-right">Given by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.length === 0 && <EmptyRow cols={9}>No ledger activity for this month.</EmptyRow>}
          {branches.map((b) => (
            <TableRow key={b.branch_id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(b.branch_id)}>
              <TableCell className="font-semibold text-slate-900">{b.branch_name ?? b.branch_id}</TableCell>
              <TableCell className="text-right">{b.regularizations.total}</TableCell>
              <TableCell className="text-right text-slate-500">
                {b.regularizations.approved} / {b.regularizations.rejected} / {b.regularizations.pending}
              </TableCell>
              <TableCell className="text-right">{b.mismatch_resolutions}</TableCell>
              <TableCell className="text-right">{b.exception_resolutions}</TableCell>
              <TableCell className="text-right">{b.disputes}</TableCell>
              <TableCell className="text-right">{b.manual_overrides}</TableCell>
              <TableCell className="text-right">{b.employees_affected}</TableCell>
              <TableCell className="text-right">{b.actors}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ── Branch view: entries + people ────────────────────────────────────────────

function EntriesTable({ rows, loading, onOpen }: { rows: LedgerEntry[]; loading: boolean; onOpen: (e: LedgerEntry) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Attendance date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Given to</TableHead>
          <TableHead>Given by</TableHead>
          <TableHead>Decision</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Acted at</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && rows.length === 0 && <EmptyRow cols={7}><Loader2 className="mx-auto h-5 w-5 animate-spin" /></EmptyRow>}
        {!loading && rows.length === 0 && <EmptyRow cols={7}>No entries match these filters.</EmptyRow>}
        {rows.map((e) => (
          <TableRow key={`${e.kind}-${e.source_id}`} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(e)}>
            <TableCell className="whitespace-nowrap">{fmtDate(e.record_date)}</TableCell>
            <TableCell><KindBadge kind={e.kind} /></TableCell>
            <TableCell><Person name={e.employee_name} code={e.employee_code} /></TableCell>
            <TableCell>
              {e.given_by
                ? <Person name={e.given_by.name ?? e.given_by.email ?? e.given_by.user_id} code={e.given_by.code} sub={e.given_by.role} />
                : <span className="text-sm text-slate-400">{givenByLabel(e)}</span>}
            </TableCell>
            <TableCell><Badge variant="outline">{humanize(e.decision)}</Badge></TableCell>
            <TableCell className="max-w-xs truncate text-slate-600" title={e.reason ?? undefined}>{e.reason ?? "None"}</TableCell>
            <TableCell className="whitespace-nowrap text-slate-500">{fmtDateTime(e.acted_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PeopleMatrix({ data, onPick }: { data: PeopleData; onPick: (employeeCode: string | null, actorId: string | null) => void }) {
  return (
    <div className="space-y-4">
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Given by</TableHead>
              {LEDGER_KINDS.map((k) => <TableHead key={k} className="text-right">{KIND_LABELS[k]}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.actors.length === 0 && <EmptyRow cols={LEDGER_KINDS.length + 2}>No decisions with a recorded approver.</EmptyRow>}
            {data.actors.map((a) => (
              <TableRow key={a.user_id} className="cursor-pointer hover:bg-slate-50" onClick={() => onPick(null, a.user_id)}>
                <TableCell><Person name={a.name ?? a.email ?? a.user_id} code={a.code} sub={a.role} /></TableCell>
                {LEDGER_KINDS.map((k) => <TableCell key={k} className="text-right">{a.counts[k] ?? 0}</TableCell>)}
                <TableCell className="text-right font-bold">{a.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Given to</TableHead>
              <TableHead>Given by</TableHead>
              {LEDGER_KINDS.map((k) => <TableHead key={k} className="text-right">{KIND_LABELS[k]}</TableHead>)}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length === 0 && <EmptyRow cols={LEDGER_KINDS.length + 3}>No activity for this branch and month.</EmptyRow>}
            {data.rows.map((r) => (
              <TableRow
                key={`${r.employee.employee_id}-${r.given_by?.user_id ?? "none"}`}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => onPick(r.employee.code, r.given_by?.user_id ?? null)}
              >
                <TableCell><Person name={r.employee.name} code={r.employee.code} /></TableCell>
                <TableCell className="text-slate-600">{r.given_by ? personLabel(r.given_by) : "System / not recorded"}</TableCell>
                {LEDGER_KINDS.map((k) => <TableCell key={k} className="text-right">{r.counts[k] ?? 0}</TableCell>)}
                <TableCell className="text-right font-bold">{r.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {data.truncated && <p className="text-xs text-amber-700">Showing the 1,000 busiest employee and approver pairs.</p>}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export default function BranchLedgerPanel() {
  const { toast } = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [branchId, setBranchId] = useState(ALL);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState("entries");
  const [type, setType] = useState(ALL);
  const [actorId, setActorId] = useState(ALL);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<EntriesResponse | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [people, setPeople] = useState<PeopleData | null>(null);
  const [drawer, setDrawer] = useState<LedgerDrawerTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);

  const win = useMemo(() => monthWindow(month), [month]);
  const windowQs = `from=${win.from}&to=${win.to}`;

  useEffect(() => {
    hrmsApi.get<{ data: Branch[] }>("/api/org/branches")
      .then((res) => setBranches(res.data ?? []))
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: SummaryData }>(`${API}/summary?${windowQs}`);
      setSummary(res.data);
    } catch (err) {
      setSummary(null);
      setError({ status: getHrmsApiErrorStatus(err), message: err instanceof Error ? err.message : "Unable to load the ledger" });
    } finally {
      setLoading(false);
    }
  }, [windowQs]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const entriesQs = useCallback((pg: number, limit: number) => {
    const q = new URLSearchParams({ from: win.from, to: win.to, page: String(pg), limit: String(limit) });
    if (type !== ALL) q.set("type", type);
    if (actorId !== ALL) q.set("actorId", actorId);
    if (search) q.set("search", search);
    return q.toString();
  }, [win, type, actorId, search]);

  useEffect(() => {
    if (branchId === ALL) return;
    const mine = ++seq.current;
    setEntriesLoading(true);
    hrmsApi.get<EntriesResponse & { success: boolean }>(`${API}/branch/${branchId}/entries?${entriesQs(page, PAGE_SIZE)}`)
      .then((res) => { if (mine === seq.current) setEntries(res); })
      .catch((err) => {
        if (mine !== seq.current) return;
        setEntries(null);
        toast({ title: "Could not load entries", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      })
      .finally(() => { if (mine === seq.current) setEntriesLoading(false); });
  }, [branchId, entriesQs, page, toast]);

  useEffect(() => {
    if (branchId === ALL) { setPeople(null); return; }
    let cancelled = false;
    hrmsApi.get<{ success: boolean; data: PeopleData }>(`${API}/branch/${branchId}/people?${windowQs}`)
      .then((res) => { if (!cancelled) setPeople(res.data); })
      .catch(() => { if (!cancelled) setPeople(null); });
    return () => { cancelled = true; };
  }, [branchId, windowQs]);

  const selectBranch = (id: string) => {
    setBranchId(id);
    setView("entries");
    setType(ALL); setActorId(ALL); setSearchInput(""); setSearch(""); setPage(1);
    setEntries(null); setPeople(null);
  };

  const pickFromMatrix = (code: string | null, actor: string | null) => {
    setSearchInput(code ?? "");
    setSearch(code ?? "");
    setActorId(actor ?? ALL);
    setPage(1);
    setView("entries");
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows: LedgerEntry[] = [];
      let total = 0;
      for (let pg = 1; pg <= EXPORT_MAX_PAGES; pg += 1) {
        const res = await hrmsApi.get<EntriesResponse>(`${API}/branch/${branchId}/entries?${entriesQs(pg, EXPORT_PAGE_SIZE)}`);
        rows.push(...(res.data ?? []));
        total = res.total ?? rows.length;
        if (rows.length >= total || (res.data ?? []).length === 0) break;
      }
      const blob = new Blob([`﻿${entriesToCsv(rows)}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `branch-ledger-${branchName}-${month}.csv`.replace(/\s+/g, "-");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: rows.length < total ? "Exported (truncated)" : "Export complete",
        description: rows.length < total ? `Exported the newest ${rows.length} of ${total} rows. Narrow the filters for the rest.` : `${rows.length} rows exported.`,
      });
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const selected = summary?.branches.find((b) => b.branch_id === branchId) ?? null;
  const branchName = selected?.branch_name ?? branches.find((b) => b.id === branchId)?.branch_name ?? "branch";
  const branchOptions = useMemo(
    () => [...branches].sort((a, b) => a.branch_name.localeCompare(b.branch_name)),
    [branches],
  );
  const totalPages = Math.max(1, Math.ceil((entries?.total ?? 0) / PAGE_SIZE));
  const warnings = [...(summary?.warnings ?? []), ...(entries?.warnings ?? []), ...(people?.warnings ?? [])];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <p className="max-w-2xl text-sm text-slate-600">
          Every regularization, dispute, mismatch or exception resolution and manual override, by branch — to whom it was given and by whom.
          Dated by the attendance day it concerns.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-bold uppercase tracking-wide text-slate-400">Month</Label>
            <Input type="month" value={month} max={currentMonth()} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setPage(1); } }} className="w-52" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-bold uppercase tracking-wide text-slate-400">Branch</Label>
            <Select value={branchId} onValueChange={selectBranch}>
              <SelectTrigger className="w-56"><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches (overview)</SelectItem>
                {branchOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="icon" onClick={() => void loadSummary()} aria-label="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>

      {warnings.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{Array.from(new Set(warnings)).join(" ")}</p>}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error.status === 403 ? "You do not have access to the Branch Ledger." : error.message}
        </p>
      )}

      {branchId === ALL ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Total actions" value={summary?.totals.total_actions ?? "—"} />
            <Kpi label="Employees affected" value={summary?.totals.employees_affected ?? "—"} />
            <Kpi label="Distinct approvers" value={summary?.totals.actors ?? "—"} />
            <Kpi label="Branches with activity" value={summary ? summary.branches.filter((b) => b.total_actions > 0).length : "—"} />
          </div>
          {loading && !summary ? <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
            : <SummaryTable branches={summary?.branches ?? []} onOpen={selectBranch} />}
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => selectBranch(ALL)}>
            <ArrowLeft className="mr-1 h-4 w-4" /> All branches
          </Button>
          <h2 className="text-lg font-bold text-slate-900">{branchName}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Regularizations" value={selected?.regularizations.total ?? 0}
              hint={`${selected?.regularizations.approved ?? 0} approved · ${selected?.regularizations.rejected ?? 0} rejected · ${selected?.regularizations.pending ?? 0} pending`} />
            <Kpi label="Mismatch resolutions" value={selected?.mismatch_resolutions ?? 0} />
            <Kpi label="Exception resolutions" value={selected?.exception_resolutions ?? 0} />
            <Kpi label="Disputes" value={selected?.disputes ?? 0} />
            <Kpi label="Manual overrides" value={selected?.manual_overrides ?? 0} />
          </div>

          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="entries">Entries</TabsTrigger>
              <TabsTrigger value="people">To whom / by whom</TabsTrigger>
            </TabsList>

            <TabsContent value="entries" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase tracking-wide text-slate-400">Type</Label>
                  <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
                    <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All types</SelectItem>
                      {LEDGER_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase tracking-wide text-slate-400">Given by</Label>
                  <Select value={actorId} onValueChange={(v) => { setActorId(v); setPage(1); }}>
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Everyone</SelectItem>
                      {(people?.actors ?? []).map((a) => <SelectItem key={a.user_id} value={a.user_id}>{personLabel(a)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase tracking-wide text-slate-400">Employee</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input className="w-56 pl-8" placeholder="Name or code" value={searchInput} onChange={(e) => { setSearchInput(e.target.value); setPage(1); }} />
                  </div>
                </div>
                <Button variant="outline" className="ml-auto" onClick={() => void handleExport()} disabled={exporting || (entries?.total ?? 0) === 0}>
                  {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Export CSV
                </Button>
              </div>
              <Card><EntriesTable rows={entries?.data ?? []} loading={entriesLoading} onOpen={(e) => setDrawer({ kind: e.kind, id: e.source_id })} /></Card>
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>{entries?.total ?? 0} entries</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span>Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="people" className="mt-4">
              {people ? <PeopleMatrix data={people} onPick={pickFromMatrix} />
                : <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            </TabsContent>
          </Tabs>
        </>
      )}

      <LedgerDrawer target={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
