import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
  Loader2, RefreshCw, Search, Send, ShieldAlert, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi, getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import { useHasRole } from "@/hooks/useUserRole";
import { EscalateDialog, RespondDialog, ResolveDialog } from "./MismatchDialogs";
import { MismatchDrawer } from "./MismatchDrawer";
import {
  fmtDate, fmtMinutes, statusLabel,
  type EscalationInfo, type MismatchRecord, type Summary,
} from "./mismatchTypes";

const PAGE_SIZE = 50;
const ALL_BRANCHES = "all";

type Branch = { id: string; branch_name: string };
type DialogState = { kind: "resolve" | "escalate" | "respond"; record: MismatchRecord } | null;

// ── Status color helpers ────────────────────────────────────────────────────

function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "present":         return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "half_day":        return "bg-amber-50 text-amber-700 border border-amber-200";
    case "absent":
    case "missing_punch":   return "bg-rose-50 text-rose-700 border border-rose-200";
    case "leave_approved":  return "bg-blue-50 text-blue-700 border border-blue-200";
    case "week_off":        return "bg-slate-100 text-slate-600 border border-slate-200";
    case "week_off_worked": return "bg-orange-50 text-orange-700 border border-orange-200";
    default:                return "bg-slate-50 text-slate-500 border border-slate-200";
  }
}

function SourceBadge({ label, status, minutes }: { label: string; status: string | null; minutes: number | null }) {
  const noData = !status || (!minutes && status === "absent");
  return (
    <div className="min-w-[80px]">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mr-1">{label}</span>
      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusBadgeClass(status)}`}>
        {noData && !status ? "no data" : statusLabel(status)}
      </span>
      {minutes != null && minutes > 0 && (
        <span className="block text-[11px] text-slate-400 mt-0.5">{fmtMinutes(minutes)}</span>
      )}
      {(!minutes || minutes <= 0) && status && (
        <span className="block text-[11px] text-slate-300 mt-0.5">no data</span>
      )}
    </div>
  );
}

function EscalationChip({ escalation }: { escalation: EscalationInfo | null }) {
  if (!escalation) return null;
  if (escalation.status === "recommended") {
    return <Badge className="bg-emerald-50 text-emerald-700 text-[10px]">Rec: {statusLabel(escalation.recommended_status)}</Badge>;
  }
  if (escalation.is_overdue) {
    return <Badge className="bg-rose-50 text-rose-700 text-[10px]">Overdue</Badge>;
  }
  return <Badge className="bg-amber-50 text-amber-700 text-[10px]">Escalated</Badge>;
}

function Tile({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <Card className="border-0 bg-white shadow-sm">
      <CardContent className="p-4">
        <p className={`text-3xl font-bold ${tone}`}>{value.toLocaleString()}</p>
        <p className="text-xs text-slate-500 mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function MismatchesPanel() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const canAct = useHasRole("wfm", "hr", "admin", "super_admin");

  const [records, setRecords] = useState<MismatchRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null);

  const [fromDate, setFromDate] = useState(searchParams.get("fromDate") ?? "");
  const [toDate, setToDate] = useState(searchParams.get("toDate") ?? "");
  const employeeId = searchParams.get("employeeId") ?? "";
  const [branchId, setBranchId] = useState(ALL_BRANCHES);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkNote, setBulkNote] = useState("");
  const [showBulkNote, setShowBulkNote] = useState(false);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    hrmsApi.get<{ data: Branch[] }>("/api/org/branches")
      .then((res) => setBranches(res.data ?? []))
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => { setPage(1); setSelected(new Set()); }, [fromDate, toDate, search, branchId, employeeId]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (search) params.set("search", search);
    if (branchId !== ALL_BRANCHES) params.set("branchId", branchId);
    if (employeeId) params.set("employeeId", employeeId);
    return params;
  }, [fromDate, toDate, search, branchId, employeeId]);

  const load = useCallback(async () => {
    // Cancel any in-flight request so filter changes don't stack up.
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    try {
      const params = buildParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      const summaryParams = buildParams();
      summaryParams.delete("search");
      const [listRes, sumRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: MismatchRecord[]; total: number }>(`/api/wfm/mismatches?${params}`),
        hrmsApi.get<{ success: boolean; data: Summary }>(`/api/wfm/mismatches/summary?${summaryParams}`),
      ]);
      setRecords(listRes.data ?? []);
      setTotal(listRes.total ?? 0);
      setSummary(sumRes.success ? sumRes.data : null);
      setSelected(new Set());
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError({ status: getHrmsApiErrorStatus(err), message: err instanceof Error ? err.message : "Failed to load the queue" });
      setRecords([]);
      setTotal(0);
      toast({ title: "Failed to load the queue", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [buildParams, page, toast]);

  useEffect(() => { void load(); }, [load]);

  function afterAction() {
    setDialog(null);
    void load();
  }

  function clearEmployeeFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete("employeeId");
    setSearchParams(next, { replace: true });
  }

  // Bulk escalate
  async function handleBulkEscalate() {
    if (!selected.size) return;
    setBulkLoading(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { succeeded: number; skipped: number; failed: number } }>(
        "/api/wfm/mismatches/bulk-escalate",
        { ids: Array.from(selected), note: bulkNote || null },
      );
      const { succeeded, skipped, failed } = res.data ?? { succeeded: 0, skipped: 0, failed: 0 };
      toast({
        title: `Bulk escalation done`,
        description: `${succeeded} escalated · ${skipped} skipped · ${failed} failed`,
        variant: succeeded > 0 ? "default" : "destructive",
      });
      setShowBulkNote(false);
      setBulkNote("");
      void load();
    } catch (err) {
      toast({ title: "Bulk escalation failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const pageIds = records.map((r) => r.id);
    const allSelected = pageIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(pageIds));
  }

  const isForbidden = error?.status === 403;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allPageSelected = records.length > 0 && records.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Days where biometric and APR disagree, or week-off days where someone worked.
        Missing punches and data errors are on the{" "}
        <Link to="?tab=exceptions" className="font-semibold text-blue-600 hover:underline">Exceptions</Link> tab.
      </p>

      {isForbidden && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-600" />
            <p className="text-sm text-amber-900">Your role can open this tab but not view this data. Ask your administrator for access.</p>
          </CardContent>
        </Card>
      )}
      {error && !isForbidden && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 p-4 text-sm font-bold text-red-800">
            <AlertTriangle className="h-4 w-4" />{error.message}
          </CardContent>
        </Card>
      )}

      {/* KPI tiles */}
      {!isForbidden && summary && (
        <div className="grid grid-cols-3 gap-3">
          <Tile value={summary.total_open} label="Open for review" tone="text-slate-900" />
          <Tile value={summary.unresolved_mismatches} label="APR vs biometric disagree" tone="text-rose-600" />
          <Tile value={summary.week_off_worked} label="Worked on week-off" tone="text-amber-600" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9 h-8 text-sm" placeholder="Search name or code" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="All branches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" className="w-36 h-8 text-sm" aria-label="From date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="text-xs text-slate-400">to</span>
        <Input type="date" className="w-36 h-8 text-sm" aria-label="To date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        {employeeId && (
          <Button variant="secondary" size="sm" className="h-8" onClick={clearEmployeeFilter}>
            One employee <X className="ml-1 h-3 w-3" />
          </Button>
        )}
        <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>
      {!fromDate && !toDate && (
        <p className="-mt-2 text-xs text-slate-400">Showing the last 30 days. Pick dates to change the window.</p>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && canAct && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
          <span className="text-sm font-semibold text-blue-800">{selected.size} selected</span>
          {showBulkNote ? (
            <>
              <Input
                className="h-7 text-sm w-64"
                placeholder="Optional escalation note…"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
              />
              <Button size="sm" className="h-7" disabled={bulkLoading} onClick={() => void handleBulkEscalate()}>
                {bulkLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                Confirm escalate
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowBulkNote(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" className="h-7 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={() => setShowBulkNote(true)}>
                <Send className="mr-1 h-3 w-3" /> Bulk escalate to managers
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-slate-500" onClick={() => setSelected(new Set())}>
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      )}

      {/* Table */}
      <div className="relative overflow-x-auto rounded-lg border border-slate-200 bg-white">
        {loading && records.length > 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60 backdrop-blur-[1px]">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 text-xs">
              {canAct && (
                <TableHead className="w-10 pl-3">
                  <Checkbox checked={allPageSelected} onCheckedChange={toggleAll} aria-label="Select all on this page" />
                </TableHead>
              )}
              <TableHead className="font-bold uppercase tracking-wide text-slate-500 text-[11px]">Employee</TableHead>
              <TableHead className="font-bold uppercase tracking-wide text-slate-500 text-[11px]">Designation</TableHead>
              <TableHead className="font-bold uppercase tracking-wide text-slate-500 text-[11px]">Branch · Process</TableHead>
              <TableHead className="font-bold uppercase tracking-wide text-slate-500 text-[11px]">Date</TableHead>
              <TableHead className="font-bold uppercase tracking-wide text-slate-500 text-[11px]">Biometric</TableHead>
              <TableHead className="font-bold uppercase tracking-wide text-slate-500 text-[11px]">APR</TableHead>
              <TableHead className="font-bold uppercase tracking-wide text-slate-500 text-[11px]">Manager</TableHead>
              <TableHead className="text-right font-bold uppercase tracking-wide text-slate-500 text-[11px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && records.length === 0 && (
              <TableRow>
                <TableCell colSpan={canAct ? 9 : 8} className="py-14 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {!loading && !error && records.length === 0 && (
              <TableRow>
                <TableCell colSpan={canAct ? 9 : 8} className="py-14 text-center">
                  <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                  <p className="text-sm font-medium text-slate-600">Nothing to review</p>
                </TableCell>
              </TableRow>
            )}
            {records.map((rec) => {
              const isWeekOff = rec.attendance_status === "week_off_worked";
              const esc = rec.escalation;
              const isSelected = selected.has(rec.id);
              return (
                <TableRow
                  key={rec.id}
                  className={`cursor-pointer text-sm transition-colors hover:bg-slate-50 ${isSelected ? "bg-blue-50/40" : ""}`}
                  onClick={() => setDrawerId(rec.id)}
                >
                  {canAct && (
                    <TableCell className="pl-3 w-10" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(rec.id)}
                        aria-label={`Select ${rec.employee_name}`}
                      />
                    </TableCell>
                  )}

                  {/* Employee: name + code only */}
                  <TableCell className="py-2.5">
                    <p className="font-semibold text-slate-900 leading-tight">{rec.employee_name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{rec.employee_code}</p>
                  </TableCell>

                  {/* Designation */}
                  <TableCell className="py-2.5 text-xs text-slate-600">
                    {rec.designation ?? <span className="text-slate-300">—</span>}
                  </TableCell>

                  {/* Branch · Process */}
                  <TableCell className="py-2.5">
                    <p className="text-xs text-slate-700 font-medium leading-tight">{rec.branch_name ?? "—"}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{rec.process_name ?? "—"}</p>
                  </TableCell>

                  {/* Date */}
                  <TableCell className="py-2.5 whitespace-nowrap text-xs text-slate-700 font-medium">
                    {fmtDate(rec.record_date)}
                  </TableCell>

                  {/* Biometric */}
                  <TableCell className="py-2.5">
                    {isWeekOff ? (
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusBadgeClass("week_off_worked")}`}>
                        Worked
                      </span>
                    ) : (
                      <SourceBadge label="" status={rec.biometric_status} minutes={rec.biometric_minutes} />
                    )}
                  </TableCell>

                  {/* APR */}
                  <TableCell className="py-2.5">
                    {isWeekOff ? (
                      <span className="text-[11px] text-slate-400">{fmtMinutes(rec.raw_minutes)}</span>
                    ) : (
                      <SourceBadge label="" status={rec.apr_status} minutes={rec.dialler_minutes} />
                    )}
                  </TableCell>

                  {/* Manager */}
                  <TableCell className="py-2.5">
                    {rec.manager_name ? (
                      <div>
                        <p className="text-xs text-slate-700 leading-tight">{rec.manager_name}</p>
                        {esc && <EscalationChip escalation={esc} />}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      {esc?.can_respond && (
                        <Button size="sm" className="h-7 text-xs" onClick={() => setDialog({ kind: "respond", record: rec })}>Respond</Button>
                      )}
                      {canAct && (!esc || esc.is_overdue) && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDialog({ kind: "escalate", record: rec })}>
                          {esc?.is_overdue ? "Re-escalate" : "Escalate"}
                        </Button>
                      )}
                      {canAct && (
                        <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700" onClick={() => setDialog({ kind: "resolve", record: rec })}>
                          Resolve
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span className="text-xs">{total.toLocaleString()} records · page {page} of {totalPages}</span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ResolveDialog record={dialog?.kind === "resolve" ? dialog.record : null} onClose={() => setDialog(null)} onDone={afterAction} />
      <EscalateDialog record={dialog?.kind === "escalate" ? dialog.record : null} onClose={() => setDialog(null)} onDone={afterAction} />
      <RespondDialog record={dialog?.kind === "respond" ? dialog.record : null} onClose={() => setDialog(null)} onDone={afterAction} />
      <MismatchDrawer recordId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  );
}
