import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Search,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi, getAuthToken, getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import { apiBaseUrl } from "@/lib/apiBase";

/**
 * Attendance Exception Engine — read-only worklist over `attendance_reconciliation_issue`.
 *
 * This is the store the nightly ncosec-attendance-reconciliation worker writes and the
 * dashboard "Attendance Exceptions" tiles count. It is deliberately NOT the same data as
 * /wfm/mismatch-queue, which resolves individual `attendance_daily_record` rows.
 *
 * Previously this page rendered PeopleOSDataPage against
 * /api/attendance/exception-engine/summary, whose table (`attendance_exception`) has never
 * had a row written to it — which is why the page appeared blank.
 *
 * This is a panel, not a page: extracted from NativeAttendanceExceptionEngine.tsx for the
 * merged attendance-integrity console (Task 3). It owns its own data/filter state and has
 * no required props — the console shell owns the page chrome (DashboardLayout, <h1>) and
 * the tab selection. Behaviour is otherwise unchanged from the source page.
 */

type ExceptionRow = {
  id: string;
  issue_date: string;
  issue_type: string;
  severity: "blocker" | "warning";
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  cosec_user_id: string | null;
  source_minutes: number | null;
  hrms_minutes: number | null;
  adr_status: string | null;
  auto_fix_status: string | null;
  auto_fix_reason: string | null;
  first_detected_at: string | null;
  last_detected_at: string | null;
  resolved_at: string | null;
  age_days: number | null;
  branch_name: string | null;
  process_name: string | null;
};

type ByType = { issue_type: string; severity: string; total: number; open_count: number };

type Summary = {
  total_in_range: number;
  open_total: number;
  open_blockers: number;
  open_warnings: number;
  resolved_total: number;
  auto_fix_failed: number;
  oldest_open_age_days: number;
  unassigned_total: number | null;
  scope_is_global: boolean;
  by_type: ByType[];
};

/**
 * Labels match the dashboard tiles in ReferenceSharedPanels.tsx so a user who clicks a
 * tile sees the same wording on the page it lands on.
 */
const ISSUE_TYPE_LABELS: Record<string, string> = {
  missing_adr: "Missing Attendance Record",
  salary_payable_days_mismatch: "Payable Days Mismatch",
  unmapped_cosec_user: "Unmapped Biometric User",
  zero_minute_attendance: "Zero-Minute Attendance",
  missing_punch_with_usable_source: "Missing Punch (source available)",
  missing_ibd: "Missing IBD",
  inactive_cosec_user_activity: "Inactive Biometric User Activity",
  apr_missing_adr: "APR — Missing Attendance Record",
  apr_minutes_mismatch: "APR — Minutes Mismatch",
  apr_source_fallback_when_apr_exists: "APR — Source Fallback",
  approved_regularization_missing_adr: "Approved Regularization — Missing Record",
  dialler_source_without_evidence: "Dialler Source Without Evidence",
};

function issueLabel(type: string) {
  return ISSUE_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

function severityBadge(severity: string) {
  if (severity === "blocker") return <Badge className="bg-rose-50 text-rose-700 hover:bg-rose-50">Blocker</Badge>;
  if (severity === "warning") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Warning</Badge>;
  return <Badge className="bg-slate-100 text-slate-600">{severity || "—"}</Badge>;
}

function autoFixBadge(status: string | null) {
  if (status === "fixed") return <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Auto-fixed</Badge>;
  if (status === "failed") return <Badge className="bg-rose-50 text-rose-700 hover:bg-rose-50">Failed</Badge>;
  if (status === "skipped") return <Badge className="bg-slate-100 text-slate-600">Skipped</Badge>;
  return <span className="text-xs text-slate-400">Not attempted</span>;
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function fmtNum(value: number | null) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

const PAGE_SIZE = 50;

function KpiCard({
  label, value, icon, tone,
}: { label: string; value: React.ReactNode; icon: React.ReactNode; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-2 text-2xl font-black ${tone ?? "text-slate-950"}`}>{value}</p>
          </div>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ExceptionsPanel() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null);

  // Filters seed from the query string so dashboard tiles can deep-link with a filter
  // already applied (e.g. ?issueType=missing_adr&status=open).
  const [status, setStatus] = useState(searchParams.get("status") ?? "open");
  const [issueType, setIssueType] = useState(searchParams.get("issueType") ?? "all");
  const [severity, setSeverity] = useState(searchParams.get("severity") ?? "all");
  const [fromDate, setFromDate] = useState(searchParams.get("fromDate") ?? "");
  const [toDate, setToDate] = useState(searchParams.get("toDate") ?? "");
  const [searchInput, setSearchInput] = useState(searchParams.get("search") ?? "");
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  // Deep-link only (no dropdown — there's no branch-list endpoint loaded on this page).
  // The Work Inbox ATTENDANCE_MISMATCH digest deep-links here with ?branchId=..., which
  // the backend (attendance-exceptions.routes.ts) already accepts and filters emp.branch_id
  // on; this page just wasn't reading it from the URL before.
  const [branchId, setBranchId] = useState(searchParams.get("branchId") ?? "");

  // Debounce the search box — it hits the server, unlike the mismatch queue's
  // current-page-only client filter.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (status && status !== "all") params.set("status", status);
    else if (status === "all") params.set("status", "all");
    if (issueType !== "all") params.set("issueType", issueType);
    if (severity !== "all") params.set("severity", severity);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (search) params.set("search", search);
    if (branchId) params.set("branchId", branchId);
    return params.toString();
  }, [status, issueType, severity, fromDate, toDate, search, branchId]);

  // Keep the URL in step with the filters so the view is shareable and refresh-safe.
  // Only the keys this panel manages are rewritten — any other param (e.g. the console
  // shell's `tab`) is preserved rather than clobbered by a full replace.
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      ["status", "issueType", "severity", "fromDate", "toDate", "search", "branchId"].forEach(
        (key) => next.delete(key),
      );
      new URLSearchParams(queryString).forEach((value, key) => next.set(key, value));
      return next;
    }, { replace: true });
    setPage(1);
  }, [queryString, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listParams = new URLSearchParams(queryString);
      listParams.set("page", String(page));
      listParams.set("limit", String(PAGE_SIZE));

      const [listRes, summaryRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: ExceptionRow[]; total: number }>(
          `/api/wfm/attendance-exceptions?${listParams.toString()}`,
        ),
        hrmsApi.get<{ success: boolean; data: Summary }>(
          `/api/wfm/attendance-exceptions/summary?${queryString}`,
        ),
      ]);

      setRows(listRes.data ?? []);
      setTotal(listRes.total ?? 0);
      setSummary(summaryRes.data ?? null);
    } catch (err) {
      setError({
        status: getHrmsApiErrorStatus(err),
        message: err instanceof Error ? err.message : "Unable to load attendance exceptions",
      });
      setRows([]);
      setTotal(0);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [queryString, page]);

  useEffect(() => { void load(); }, [load]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const token = getAuthToken();
      // Raw fetch rather than hrmsApi.getBlob: the truncation flag arrives as a response
      // header, which getBlob discards.
      const res = await fetch(`${apiBaseUrl()}/api/wfm/attendance-exceptions/export?${queryString}`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);

      const truncated = res.headers.get("X-Export-Truncated") === "true";
      const rowCount = res.headers.get("X-Export-Row-Count");
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `attendance-exceptions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // A truncated export that says nothing reads as complete — say it plainly.
      toast({
        title: truncated ? "Exported (truncated)" : "Export complete",
        description: truncated
          ? `Only the first ${rowCount} rows were exported. Narrow the filters to export the rest.`
          : `${rowCount ?? rows.length} rows exported.`,
        variant: truncated ? "default" : "default",
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }, [queryString, rows.length, toast]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isForbidden = error?.status === 403;

  return (
    <div className="space-y-6">
      {/* Header — page-level <h1> and DashboardLayout removed; the console shell owns
          both. The eyebrow label and description are kept, matching the source page. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Attendance</p>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Reconciliation and data-integrity exceptions detected against biometric, APR and
            payroll sources. To correct an individual attendance record instead, use the{" "}
            {/* Same-page tab switch, not a route navigation — Task 6 merged this panel and
                the mismatch queue into sibling tabs of one console. A relative "?tab=..."
                Link only rewrites the search string on the current route, which the
                console's own useSearchParams sync picks up (see
                AttendanceIntegrityConsole.tsx), rather than a full navigation through the
                /wfm/mismatch-queue redirect. */}
            <Link to="?tab=mismatches" className="font-semibold text-blue-600 hover:underline">
              attendance mismatch queue <ArrowRight className="inline h-3 w-3" />
            </Link>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exporting || loading || !total}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export CSV
          </Button>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

        {/* Branch filter, active only when this page was reached via a branch deep-link
            (e.g. the Work Inbox ATTENDANCE_MISMATCH digest item). No dropdown here — just
            a visible indicator + a way to clear it, since there's no branch-list endpoint
            loaded on this page. */}
        {branchId && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <p className="text-sm font-semibold text-blue-900">
                Filtered to branch:{" "}
                <span className="font-black">
                  {rows[0]?.branch_name ?? branchId}
                </span>
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-blue-700 hover:text-blue-900"
                onClick={() => setBranchId("")}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Access denied — a role that passes the page gate but not the data API */}
        {isForbidden && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex items-start gap-3 p-5">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <p className="font-bold text-amber-900">Your role can open this page but not view this data</p>
                <p className="mt-1 text-sm text-amber-800">
                  Attendance exception records are restricted to WFM, HR, Payroll, Manager,
                  Process Manager, Branch Head, CEO and Admin roles. Ask your administrator for
                  access if you need it.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Any other error */}
        {error && !isForbidden && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="flex items-center gap-3 p-4 text-sm font-bold text-red-800">
              <AlertTriangle className="h-4 w-4" />
              {error.message}
            </CardContent>
          </Card>
        )}

        {/* KPIs — always rendered with real zeros, never blank */}
        {!isForbidden && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              label="Open exceptions"
              value={fmtNum(summary?.open_total ?? 0)}
              icon={<AlertTriangle className="h-5 w-5 text-blue-500" />}
            />
            <KpiCard
              label="Blockers"
              value={fmtNum(summary?.open_blockers ?? 0)}
              tone={(summary?.open_blockers ?? 0) > 0 ? "text-rose-600" : "text-slate-950"}
              icon={<ShieldAlert className="h-5 w-5 text-rose-500" />}
            />
            <KpiCard
              label="Warnings"
              value={fmtNum(summary?.open_warnings ?? 0)}
              icon={<Info className="h-5 w-5 text-amber-500" />}
            />
            <KpiCard
              label="Oldest open"
              value={`${fmtNum(summary?.oldest_open_age_days ?? 0)}d`}
              icon={<Clock className="h-5 w-5 text-slate-400" />}
            />
            <KpiCard
              label="Resolved in range"
              value={fmtNum(summary?.resolved_total ?? 0)}
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            />
          </div>
        )}

        {/* Filters */}
        {!isForbidden && (
          <Card>
            <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-6">
              <div>
                <Label className="text-xs font-bold uppercase text-slate-500">From</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase text-slate-500">To</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-bold uppercase text-slate-500">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase text-slate-500">Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severities</SelectItem>
                    <SelectItem value="blocker">Blocker</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase text-slate-500">Issue type</Label>
                <Select value={issueType} onValueChange={setIssueType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {(summary?.by_type ?? []).map((t) => (
                      <SelectItem key={t.issue_type} value={t.issue_type}>
                        {issueLabel(t.issue_type)} ({t.open_count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase text-slate-500">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    className="pl-8"
                    placeholder="Name, code, biometric ID"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Table */}
        {!isForbidden && (
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                  <p className="text-base font-bold text-slate-900">
                    {status === "open" ? "No open exceptions in this range." : "No exceptions match these filters."}
                  </p>
                  <p className="max-w-md text-sm text-slate-500">
                    Try widening the date range, clearing the issue-type filter, or switching status to
                    &ldquo;All&rdquo;. Exceptions are detected nightly at 02:00 for the previous day.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead>Branch / Process</TableHead>
                        <TableHead>Issue</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead className="text-right">Age</TableHead>
                        <TableHead className="text-right">Source / HRMS min</TableHead>
                        <TableHead>Auto-fix</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap font-medium">{fmtDate(row.issue_date)}</TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-900">
                              {row.employee_name?.trim() || <span className="text-slate-400">Unmapped</span>}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.employee_code || row.cosec_user_id || "—"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-slate-700">{row.branch_name || "—"}</div>
                            <div className="text-xs text-slate-500">{row.process_name || "—"}</div>
                          </TableCell>
                          <TableCell className="max-w-[220px]">
                            <div className="text-sm text-slate-800">{issueLabel(row.issue_type)}</div>
                            {row.auto_fix_reason && (
                              <div className="truncate text-xs text-slate-500" title={row.auto_fix_reason}>
                                {row.auto_fix_reason}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{severityBadge(row.severity)}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.age_days ?? "—"}d</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {fmtNum(row.source_minutes)} / {fmtNum(row.hrms_minutes)}
                          </TableCell>
                          <TableCell>{autoFixBadge(row.auto_fix_status)}</TableCell>
                          <TableCell>
                            {row.resolved_at
                              ? <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Resolved</Badge>
                              : <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">Open</Badge>}
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
        {!isForbidden && rows.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {fmtNum(total)}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-slate-600">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Unmapped biometric users cannot be attributed to a branch. Say so rather than
            let a scoped viewer silently see a lower number than the dashboard tile. */}
        {!isForbidden && summary && (
          <p className="text-xs text-slate-500">
            {summary.scope_is_global
              ? `${fmtNum(summary.unassigned_total ?? 0)} exception(s) in this range are not linked to an employee record (unmapped biometric users).`
              : "Unmapped biometric users are not linked to a branch and are visible to org-wide roles only, so they are excluded from these counts."}
          </p>
        )}
    </div>
  );
}
