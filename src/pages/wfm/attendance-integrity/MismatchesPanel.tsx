import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
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

/** What the two sources say, side by side — the reason a row is in the queue. */
function SourceCell({ label, status, minutes }: { label: string; status: string | null; minutes: number | null }) {
  return (
    <div className="text-xs leading-tight">
      <span className="text-slate-400">{label} </span>
      <span className="font-semibold text-slate-800">{statusLabel(status)}</span>
      <span className="block text-slate-500">{fmtMinutes(minutes)}</span>
    </div>
  );
}

function EscalationChip({ escalation }: { escalation: EscalationInfo | null }) {
  if (!escalation) return <span className="text-xs text-slate-300">—</span>;
  if (escalation.status === "recommended") {
    return <Badge className="bg-emerald-50 text-emerald-700">Manager: {statusLabel(escalation.recommended_status)}</Badge>;
  }
  if (escalation.is_overdue) {
    return <Badge className="bg-rose-50 text-rose-700">Overdue · {escalation.escalated_to_name?.trim() ?? "manager"}</Badge>;
  }
  return <Badge className="bg-amber-50 text-amber-700">With {escalation.escalated_to_name?.trim() ?? "manager"}</Badge>;
}

function Tile({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className={`text-2xl font-bold ${tone}`}>{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </CardContent>
    </Card>
  );
}

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

  // Deep links (inbox alerts) arrive with employeeId + fromDate/toDate already set.
  const [fromDate, setFromDate] = useState(searchParams.get("fromDate") ?? "");
  const [toDate, setToDate] = useState(searchParams.get("toDate") ?? "");
  const employeeId = searchParams.get("employeeId") ?? "";
  const [branchId, setBranchId] = useState(ALL_BRANCHES);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [dialog, setDialog] = useState<DialogState>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  useEffect(() => {
    hrmsApi.get<{ data: Branch[] }>("/api/org/branches")
      .then((res) => setBranches(res.data ?? []))
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [fromDate, toDate, search, branchId, employeeId]);

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
    setLoading(true);
    setError(null);
    try {
      const params = buildParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      const summaryParams = buildParams();
      summaryParams.delete("search");
      // Independent reads — fire together so the tiles do not wait behind the table.
      const [res, sum] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: MismatchRecord[]; total: number }>(`/api/wfm/mismatches?${params}`),
        hrmsApi.get<{ success: boolean; data: Summary }>(`/api/wfm/mismatches/summary?${summaryParams}`),
      ]);
      setRecords(res.data ?? []);
      setTotal(res.total ?? 0);
      setSummary(sum.success ? sum.data : null);
    } catch (err) {
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

  const isForbidden = error?.status === 403;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Days where the two attendance sources disagree (APR vs biometric) and days worked on a week-off.
        Days with no data, and biometric-only staff, do not appear here. Missing punches and data errors are on the{" "}
        <Link to="?tab=exceptions" className="font-semibold text-blue-600 hover:underline">Exceptions</Link> tab.
        Closed once payroll is finalized.
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

      {!isForbidden && summary && (
        <div className="grid grid-cols-3 gap-3">
          <Tile value={summary.total_open} label="Open for review" tone="text-slate-900" />
          <Tile value={summary.unresolved_mismatches} label="APR vs biometric disagree" tone="text-rose-600" />
          <Tile value={summary.week_off_worked} label="Worked on week-off" tone="text-amber-600" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search name or code" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All branches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" className="w-40" aria-label="From date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="text-xs text-slate-400">to</span>
        <Input type="date" className="w-40" aria-label="To date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        {employeeId && (
          <Button variant="secondary" size="sm" onClick={clearEmployeeFilter}>One employee <X className="ml-1 h-3 w-3" /></Button>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh
        </Button>
      </div>
      {!fromDate && !toDate && <p className="-mt-3 text-xs text-slate-400">Showing the last 30 days. Pick dates to change the window.</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Biometric vs APR</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && records.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
            )}
            {!loading && !error && records.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center">
                  <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                  <p className="text-sm font-medium text-slate-600">Nothing to review</p>
                </TableCell>
              </TableRow>
            )}
            {records.map((rec) => {
              const isWeekOff = rec.attendance_status === "week_off_worked";
              const esc = rec.escalation;
              return (
                <TableRow key={rec.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDrawerId(rec.id)}>
                  <TableCell>
                    <p className="text-sm font-semibold text-slate-900">{rec.employee_name}</p>
                    <p className="text-xs text-slate-500">{rec.employee_code} · {rec.branch_name ?? "—"} · {rec.process_name ?? "—"}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{fmtDate(rec.record_date)}</TableCell>
                  <TableCell>
                    {isWeekOff ? (
                      <div className="text-xs"><span className="font-semibold text-amber-700">Worked on week-off</span><span className="block text-slate-500">{fmtMinutes(rec.raw_minutes)}</span></div>
                    ) : (
                      <div className="flex gap-4">
                        <SourceCell label="Bio" status={rec.biometric_status} minutes={rec.biometric_minutes} />
                        <SourceCell label="APR" status={rec.apr_status} minutes={rec.dialler_minutes} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell><EscalationChip escalation={esc} /></TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      {esc?.can_respond && <Button size="sm" onClick={() => setDialog({ kind: "respond", record: rec })}>Respond</Button>}
                      {canAct && (!esc || esc.is_overdue) && (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "escalate", record: rec })}>
                          {esc?.is_overdue ? "Escalate up" : "Escalate"}
                        </Button>
                      )}
                      {canAct && <Button size="sm" onClick={() => setDialog({ kind: "resolve", record: rec })}>Resolve</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{total} records · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
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
