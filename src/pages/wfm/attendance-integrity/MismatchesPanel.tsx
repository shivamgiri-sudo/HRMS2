import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Loader2, Search, ShieldAlert, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi, getHrmsApiErrorStatus } from "@/lib/hrmsApi";

type MismatchRecord = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  record_date: string;
  attendance_status: string;
  biometric_status: string | null;
  apr_status: string | null;
  mismatch_flag: number;
  biometric_minutes: number | null;
  dialler_minutes: number | null;
  raw_minutes: number | null;
  lwp_value: number;
  branch_name: string | null;
  process_name: string | null;
  designation: string | null;
  mismatch_resolved_at: string | null;
  mismatch_resolution_reason: string | null;
  is_locked: number;
};

type Summary = {
  unresolved_mismatches: number;
  missing_punches: number;
  week_off_worked: number;
};

const FINAL_STATUSES = [
  { value: "present",       label: "Present (Full Day)" },
  { value: "half_day",      label: "Half Day" },
  { value: "absent",        label: "Absent" },
  { value: "leave_approved",label: "Leave Approved" },
  { value: "holiday",       label: "Holiday" },
  { value: "week_off",      label: "Week Off" },
  { value: "week_off_worked",label: "Week Off – Worked" },
];

const LWP_MAP: Record<string, number> = {
  present: 0, half_day: 0.5, absent: 1,
  leave_approved: 0, holiday: 0, week_off: 0, week_off_worked: 0,
};

/**
 * Describes the date window the list and summary are actually querying, so the summary
 * tiles never claim a fixed "(60d)" that has drifted from what /api/wfm/mismatches and
 * /api/wfm/mismatches/summary are honouring server-side (both now share the same
 * fromDate/toDate — see mismatch-review.routes.ts). With no dates picked, the backend
 * defaults to a trailing 30-day window.
 */
function windowLabel(fromDate: string, toDate: string): string {
  if (!fromDate && !toDate) return "last 30 days";
  if (fromDate && toDate) return `${fromDate} to ${toDate}`;
  if (fromDate) return `since ${fromDate}`;
  return `through ${toDate}`;
}

function statusBadge(status: string) {
  const s = status?.toLowerCase();
  if (s === "present")         return <Badge className="bg-emerald-50 text-emerald-700">Present</Badge>;
  if (s === "half_day")        return <Badge className="bg-sky-50 text-sky-700">Half Day</Badge>;
  if (s === "absent")          return <Badge className="bg-slate-100 text-slate-700">Absent</Badge>;
  if (s === "missing_punch")   return <Badge className="bg-rose-50 text-rose-700">Missing Punch</Badge>;
  if (s === "week_off_worked") return <Badge className="bg-amber-100 text-amber-800">Worked on WO</Badge>;
  if (s === "week_off")        return <Badge className="bg-violet-50 text-violet-700">Week Off</Badge>;
  if (s === "leave_approved")  return <Badge className="bg-blue-50 text-blue-700">On Leave</Badge>;
  if (s === "holiday")         return <Badge className="bg-teal-50 text-teal-700">Holiday</Badge>;
  return <Badge className="bg-slate-100 text-slate-600">{status || "—"}</Badge>;
}

export default function MismatchesPanel() {
  const { toast } = useToast();

  const [records, setRecords] = useState<MismatchRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // 3b: the search box now hits the API's server-side `search` param (matches employee
  // code or name across the whole result set) instead of filtering only the 50 rows
  // already on screen. Debounced the same way ExceptionsPanel debounces its search box.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [selected, setSelected] = useState<MismatchRecord | null>(null);
  const [finalStatus, setFinalStatus] = useState("");
  const [lwpValue, setLwpValue] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset to page 1 whenever a filter changes so a stale page number from a previous,
  // larger result set doesn't silently request an out-of-range page.
  useEffect(() => { setPage(1); }, [fromDate, toDate, search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate)   params.set("toDate", toDate);
      if (search)   params.set("search", search);
      const res = await hrmsApi.get<{ success: boolean; data: MismatchRecord[]; total: number }>(`/api/wfm/mismatches?${params}`);
      if (res.success) {
        setRecords(res.data ?? []);
        setTotal(res.total ?? 0);
      }
    } catch (err) {
      // 3a: distinguish 403 (role can open the tab but the API refuses the data) from any
      // other failure, instead of a bare catch that leaves the table showing the same
      // green "No pending items" state as a genuinely empty queue.
      setError({
        status: getHrmsApiErrorStatus(err),
        message: err instanceof Error ? err.message : "Failed to load mismatch queue",
      });
      setRecords([]);
      setTotal(0);
      toast({ title: "Failed to load mismatch queue", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, fromDate, toDate, search, toast]);

  const loadSummary = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate)   params.set("toDate", toDate);
      const qs = params.toString();
      const res = await hrmsApi.get<{ success: boolean; data: Summary }>(
        `/api/wfm/mismatches/summary${qs ? `?${qs}` : ""}`,
      );
      if (res.success) setSummary(res.data);
    } catch { /* non-critical: tiles just stay hidden, list below still shows its own error */ }
  }, [fromDate, toDate]);

  useEffect(() => { load(); loadSummary(); }, [load, loadSummary]);

  const isForbidden = error?.status === 403;

  function openResolve(rec: MismatchRecord) {
    setSelected(rec);
    const suggestedStatus = rec.attendance_status === "week_off_worked"
      ? "week_off_worked"
      : rec.attendance_status === "missing_punch"
        ? ""
        : rec.attendance_status;
    setFinalStatus(suggestedStatus);
    setLwpValue(LWP_MAP[suggestedStatus] ?? 0);
    setReason("");
    setResolveDialogOpen(true);
  }

  async function submitResolve() {
    if (!selected || !finalStatus || !reason.trim()) return;
    setSubmitting(true);
    try {
      const res = await hrmsApi.patch<{ success: boolean; message?: string }>(
        `/api/wfm/mismatches/${selected.id}/resolve`,
        { final_status: finalStatus, lwp_value: lwpValue, reason }
      );
      if (res.success) {
        toast({ title: "Resolved", description: `Record updated to ${finalStatus}` });
        setResolveDialogOpen(false);
        load();
        loadSummary();
      } else {
        toast({ title: res.message ?? "Failed to resolve", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: e?.message ?? "Error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-slate-500 mt-1">
            Review APR vs biometric mismatches, missing punches, and week-off worked records.
            {" "}For reconciliation and data-integrity exceptions, see the{" "}
            {/* Same-page tab switch, not a route navigation — see ExceptionsPanel.tsx's
                matching comment on its own cross-link back to this tab. */}
            <Link to="?tab=exceptions" className="font-semibold text-blue-600 hover:underline">
              attendance exception engine
            </Link>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { load(); loadSummary(); }} className="self-start sm:self-auto">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Forbidden — the tab is reachable but the API refuses this role's data (3a). Kept
          visually distinct from the empty/success state below: amber + ShieldAlert, never
          the emerald checkmark. */}
      {isForbidden && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-5">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <p className="font-bold text-amber-900">Your role can open this page but not view this data</p>
              <p className="mt-1 text-sm text-amber-800">
                Mismatch queue records are restricted to WFM, HR, Payroll, Manager, Process
                Manager, Branch Head, CEO and Admin roles. Ask your administrator for access
                if you need it.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Any other error (non-403) */}
      {error && !isForbidden && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 p-4 text-sm font-bold text-red-800">
            <AlertTriangle className="h-4 w-4" />
            {error.message}
          </CardContent>
        </Card>
      )}

      {/* Summary Cards — tile labels now reflect the window the list is actually showing
          (fromDate/toDate honoured server-side by /summary, no more hard-coded "(60d)"). */}
      {!isForbidden && summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-rose-500" />
              <div>
                <p className="text-2xl font-bold text-slate-900">{summary.unresolved_mismatches}</p>
                <p className="text-xs text-slate-500">Unresolved Mismatches ({windowLabel(fromDate, toDate)})</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="w-8 h-8 text-orange-500" />
              <div>
                <p className="text-2xl font-bold text-slate-900">{summary.missing_punches}</p>
                <p className="text-xs text-slate-500">Missing Punches ({windowLabel(fromDate, toDate)})</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-amber-600" />
              <div>
                <p className="text-2xl font-bold text-slate-900">{summary.week_off_worked}</p>
                <p className="text-xs text-slate-500">Worked on Week Off ({windowLabel(fromDate, toDate)})</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      {!isForbidden && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label>From Date</Label>
                <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1">
                <Label>To Date</Label>
                <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1 flex-1 min-w-48">
                <Label>Search Employee</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Name or code..."
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Records Table */}
      {!isForbidden && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Pending Reviews
            <span className="ml-2 text-sm font-normal text-slate-500">({total} total)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : records.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              No pending items
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Process / Branch</TableHead>
                    <TableHead>Current Status</TableHead>
                    <TableHead>Biometric</TableHead>
                    <TableHead>APR</TableHead>
                    <TableHead className="text-right">Minutes</TableHead>
                    <TableHead>LWP</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map(rec => (
                    <TableRow key={rec.id} className={rec.is_locked ? "opacity-60" : ""}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {rec.record_date?.slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-sm">{rec.employee_name}</p>
                        <p className="text-xs text-slate-400">{rec.employee_code}</p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        <p>{rec.process_name ?? "—"}</p>
                        <p className="text-xs text-slate-400">{rec.branch_name}</p>
                      </TableCell>
                      <TableCell>{statusBadge(rec.attendance_status)}</TableCell>
                      <TableCell>
                        {rec.biometric_status ? statusBadge(rec.biometric_status) : <span className="text-slate-400 text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        {rec.apr_status ? statusBadge(rec.apr_status) : <span className="text-slate-400 text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <span title="Biometric">B:{rec.biometric_minutes ?? "—"}</span>
                        {" / "}
                        <span title="APR">A:{rec.dialler_minutes ?? "—"}</span>
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {rec.lwp_value?.toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {rec.mismatch_resolved_at ? (
                          <span className="text-xs text-emerald-600">Resolved</span>
                        ) : rec.is_locked ? (
                          <span className="text-xs text-slate-400">Locked</span>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => openResolve(rec)}>
                            Resolve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Pagination */}
      {!isForbidden && totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm self-center text-slate-600">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve Attendance Record</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
                <p><span className="font-medium">Employee:</span> {selected.employee_name} ({selected.employee_code})</p>
                <p><span className="font-medium">Date:</span> {selected.record_date?.slice(0, 10)}</p>
                <p><span className="font-medium">Current status:</span> {selected.attendance_status}</p>
                <p><span className="font-medium">Biometric:</span> {selected.biometric_status ?? "—"} ({selected.biometric_minutes ?? "—"} min) | <span className="font-medium">APR:</span> {selected.apr_status ?? "—"} ({selected.dialler_minutes ?? "—"} min)</p>
              </div>

              <div className="space-y-2">
                <Label>Final Status *</Label>
                <Select value={finalStatus} onValueChange={v => { setFinalStatus(v); setLwpValue(LWP_MAP[v] ?? 0); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select final status…" />
                  </SelectTrigger>
                  <SelectContent>
                    {FINAL_STATUSES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>LWP Value</Label>
                <Select value={String(lwpValue)} onValueChange={v => setLwpValue(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0.0 — Full day paid</SelectItem>
                    <SelectItem value="0.5">0.5 — Half day LWP</SelectItem>
                    <SelectItem value="1">1.0 — Full day LWP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Resolution Reason *</Label>
                <Textarea
                  placeholder="Explain why this status was chosen…"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={submitResolve}
              disabled={submitting || !finalStatus || !reason.trim()}
            >
              {submitting ? "Saving…" : "Save Resolution"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
