import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardHeader, CardTitle, CardContent,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RefreshCw, ChevronDown, ChevronRight, Shield, Calculator,
  Users, AlertTriangle, Activity, Filter, Calendar, User, Search,
} from "lucide-react";

interface AuditEntry {
  id: string;
  source: "calculation" | "action";
  // "payroll" | "payroll_loans" | "exit" — added 2026-08-25 alongside broadening the backend
  // query past module_key='payroll' only, so a loan or F&F/exit event doesn't read as an
  // unlabeled payroll one.
  module: string;
  run_id: string | null;
  employee_id: string | null;
  employee_name: string | null;
  employee_code: string | null;
  event_type: string;
  event_detail: any;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
}

interface RunOption {
  id: string;
  run_month: string;
  status: string;
}

const SOURCE_ICON: Record<string, React.ReactNode> = {
  calculation: <Calculator className="w-3.5 h-3.5" />,
  action:      <Shield className="w-3.5 h-3.5" />,
};

const SOURCE_COLOR: Record<string, string> = {
  calculation: "bg-blue-100 text-blue-800 border-blue-200",
  action:      "bg-purple-100 text-purple-800 border-purple-200",
};

// Added 2026-08-25 alongside broadening the backend query past module_key='payroll' only.
const MODULE_LABEL: Record<string, string> = {
  payroll: "Payroll",
  payroll_loans: "Loans",
  exit: "F&F / Exit",
};
const MODULE_COLOR: Record<string, string> = {
  payroll: "bg-slate-100 text-slate-600 border-slate-200",
  payroll_loans: "bg-amber-100 text-amber-800 border-amber-200",
  exit: "bg-rose-100 text-rose-800 border-rose-200",
};

const SOURCE_BORDER: Record<string, string> = {
  calculation: "border-l-2 border-blue-400",
  action:      "border-l-2 border-violet-400",
};

const AVATAR_COLOR: Record<string, string> = {
  calculation: "bg-blue-100 text-blue-700",
  action:      "bg-violet-100 text-violet-700",
};

function pretty(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "string") {
    try { return JSON.stringify(JSON.parse(val), null, 2); } catch { return val; }
  }
  return JSON.stringify(val, null, 2);
}

/**
 * Expand/collapse is done with local state rather than Radix `Collapsible`.
 *
 * `Collapsible` renders a `<div>` as its root and another around its content. Nested directly in
 * `<tbody>`, those divs are not valid table children, so the browser hoisted them out and the data
 * rows stopped sharing a table layout with `<thead>` — headers no longer sat above their own
 * columns. Behaviour here is unchanged: click the row to toggle the JSON detail beneath it.
 */
function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);

  const initials = entry.employee_name
    ? entry.employee_name.trim().charAt(0).toUpperCase()
    : "?";

  let relativeTime = "";
  try {
    relativeTime = formatDistanceToNow(new Date(entry.created_at), { addSuffix: true });
  } catch {
    relativeTime = entry.created_at;
  }

  const absoluteTime = new Date(entry.created_at).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <>
      <tr
        onClick={() => setOpen(o => !o)}
        className={`hover:bg-slate-50/70 cursor-pointer transition-colors ${SOURCE_BORDER[entry.source]}`}
      >
        {/* Timestamp */}
        <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default underline decoration-dotted decoration-slate-300">
                  {relativeTime}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {absoluteTime}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </td>

        {/* Source + module badges */}
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className={`text-[11px] px-1.5 py-0 gap-1 font-bold rounded-full ${SOURCE_COLOR[entry.source]}`}>
              {SOURCE_ICON[entry.source]}
              {entry.source}
            </Badge>
            {entry.module && entry.module !== "payroll" && (
              <Badge variant="outline" className={`text-[11px] px-1.5 py-0 font-bold rounded-full ${MODULE_COLOR[entry.module] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                {MODULE_LABEL[entry.module] ?? entry.module}
              </Badge>
            )}
          </div>
        </td>

        {/* Event type — monospace chip */}
        <td className="px-3 py-2 max-w-[220px] truncate">
          <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded-md text-slate-700 border border-slate-200">
            {entry.event_type}
          </span>
        </td>

        {/* Employee with avatar initial */}
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          {entry.employee_name ? (
            <div className="flex items-center gap-1.5">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${AVATAR_COLOR[entry.source]}`}>
                {initials}
              </span>
              <span className="font-medium">{entry.employee_name}</span>
              {entry.employee_code && (
                <span className="text-slate-400">{entry.employee_code}</span>
              )}
            </div>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>

        {/* Actor */}
        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
          <div className="flex items-center gap-1">
            <User className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span>{entry.actor_name ?? entry.actor_user_id ?? "system"}</span>
          </div>
        </td>

        {/* Expand toggle */}
        <td className="px-3 py-2 w-8">
          <span className="text-slate-400">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={6} className="px-4 pb-3 pt-0 bg-slate-50 border-b">
            <pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto font-mono bg-slate-900 text-emerald-400 border border-slate-700 rounded-lg p-3 mt-2 leading-relaxed">
              {pretty(entry.event_detail)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

/** Inline label + control, sized to its content — the unit the compact filter bar is built from. */
function FilterField({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon && <span className="text-slate-400">{icon}</span>}
      <Label className="text-[11px] font-medium uppercase tracking-wide text-slate-500 whitespace-nowrap">{label}</Label>
      {children}
    </div>
  );
}

export default function PayrollAuditTrail() {
  const [runId,      setRunId]      = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [eventType,  setEventType]  = useState("");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [source,     setSource]     = useState("all");
  const [page,       setPage]       = useState(1);
  const LIMIT = 50;

  const params = new URLSearchParams();
  if (runId)      params.set("run_id",      runId);
  if (employeeId) params.set("employee_id", employeeId);
  if (eventType)  params.set("event_type",  eventType);
  if (dateFrom)   params.set("date_from",   dateFrom);
  if (dateTo)     params.set("date_to",     dateTo);
  if (source && source !== "all") params.set("source", source);
  params.set("page",  String(page));
  params.set("limit", String(LIMIT));

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["payroll-audit-trail", params.toString()],
    // No .then(r => r.data) here: every consumer below reads data.data and data.total, i.e. the
    // whole envelope. Unwrapping it made entries always [] and total always 0 - an audit trail
    // that rendered no rows and paginated over nothing.
    queryFn: () => hrmsApi.get<{ success: boolean; data: AuditEntry[]; total: number; page: number; limit: number }>(
      `/api/payroll/audit-trail?${params.toString()}`
    ),
  });

  const { data: eventTypesData } = useQuery({
    queryKey: ["payroll-audit-event-types"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: string[] }>("/api/payroll/audit-trail/event-types"),
  });

  const { data: runsData } = useQuery({
    queryKey: ["payroll-audit-runs"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: RunOption[] }>("/api/payroll/audit-trail/runs"),
  });

  const entries: AuditEntry[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  // ── Computed insight values ──────────────────────────────────────────────
  const calcCount   = entries.filter(e => e.source === "calculation").length;
  const actionCount = entries.filter(e => e.source === "action").length;
  const uniqueEmps  = new Set(entries.map(e => e.employee_id).filter(Boolean)).size;

  const viewTotal = entries.length;
  const calcPct   = viewTotal > 0 ? Math.round((calcCount / viewTotal) * 100) : 0;
  const actionPct = viewTotal > 0 ? 100 - calcPct : 0;

  // Anomaly detection: employees with 3+ events in this view
  const empEventCount: Record<string, { name: string; count: number }> = {};
  for (const e of entries) {
    if (e.employee_id) {
      if (!empEventCount[e.employee_id]) {
        empEventCount[e.employee_id] = { name: e.employee_name ?? e.employee_id, count: 0 };
      }
      empEventCount[e.employee_id].count++;
    }
  }
  const anomalies = Object.values(empEventCount)
    .filter(x => x.count >= 3)
    .sort((a, b) => b.count - a.count);

  // Active filter count badge
  const activeFilters = [runId, employeeId, eventType, dateFrom, dateTo]
    .filter(Boolean).length + (source !== "all" ? 1 : 0);

  function reset() {
    setRunId(""); setEmployeeId(""); setEventType(""); setDateFrom(""); setDateTo(""); setSource("all"); setPage(1);
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-4">

        {/* ── Dark gradient header ──────────────────────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 text-white px-6 py-5 shadow-lg">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-slate-200" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Payroll Audit Intelligence</h1>
                <p className="text-slate-400 text-sm mt-0.5">
                  Full forensic record of all payroll calculations and sensitive access
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {total > 0 && (
                <Badge className="bg-white/15 text-white border-white/20 font-mono text-sm px-3 py-1 rounded-full">
                  {total.toLocaleString()} events
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* ── Filter bar ───────────────────────────────────────────────────── */}
        <div className="bg-slate-50 rounded-2xl border border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5 text-slate-500">
              <Filter className="w-3.5 h-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Filters</span>
              {activeFilters > 0 && (
                <Badge className="ml-1 bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0 rounded-full font-bold">
                  {activeFilters} active
                </Badge>
              )}
            </div>

            <FilterField label="Run" icon={<Activity className="w-3 h-3" />}>
              <Select value={runId || "all"} onValueChange={v => { setRunId(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="h-7 w-[150px] text-xs">
                  <SelectValue placeholder="All runs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All runs</SelectItem>
                  {(runsData?.data ?? []).map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.run_month} ({r.status})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Event" icon={<Search className="w-3 h-3" />}>
              <Select value={eventType || "all"} onValueChange={v => { setEventType(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="h-7 w-[180px] text-xs">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {(eventTypesData?.data ?? []).map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Source" icon={<Shield className="w-3 h-3" />}>
              <Select value={source} onValueChange={v => { setSource(v); setPage(1); }}>
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="calculation">Calculation</SelectItem>
                  <SelectItem value="action">Sensitive action</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="From" icon={<Calendar className="w-3 h-3" />}>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                className="h-7 w-[140px] text-xs px-2"
              />
            </FilterField>

            <FilterField label="To" icon={<Calendar className="w-3 h-3" />}>
              <Input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setPage(1); }}
                className="h-7 w-[140px] text-xs px-2"
              />
            </FilterField>

            {activeFilters > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                className="ml-auto h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {/* ── KPI insight tiles (3-up bento strip) ─────────────────────────── */}
        {entries.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Calculation events */}
            <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Calculator className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 leading-none">{calcCount.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-0.5">Calculation Events</p>
                <p className="text-[10px] text-slate-400 mt-0.5">in this view</p>
              </div>
            </div>

            {/* Sensitive action events */}
            <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
                <Shield className="w-4 h-4 text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 leading-none">{actionCount.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-0.5">Sensitive Actions</p>
                <p className="text-[10px] text-slate-400 mt-0.5">in this view</p>
              </div>
            </div>

            {/* Unique employees */}
            <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Users className="w-4 h-4 text-slate-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 leading-none">{uniqueEmps.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-0.5">Unique Employees</p>
                <p className="text-[10px] text-slate-400 mt-0.5">in this view</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Source distribution bar + Anomaly watch (side by side) ─────── */}
        {entries.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Distribution bar */}
            <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm px-4 py-3">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Source Distribution</p>
              <div className="flex h-3 w-full rounded-full overflow-hidden gap-px">
                {calcPct > 0 && (
                  <div
                    className="bg-blue-400 transition-all duration-500"
                    style={{ width: `${calcPct}%` }}
                    title={`Calculation ${calcPct}%`}
                  />
                )}
                {actionPct > 0 && (
                  <div
                    className="bg-violet-400 transition-all duration-500"
                    style={{ width: `${actionPct}%` }}
                    title={`Action ${actionPct}%`}
                  />
                )}
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                  Calculation {calcPct}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />
                  Action {actionPct}%
                </span>
              </div>
            </div>

            {/* Anomaly watch */}
            {anomalies.length === 0 ? (
              <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-green-800">No Anomalies Detected</p>
                  <p className="text-[11px] text-green-600 mt-0.5">No employee has 3+ events in this view</p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Anomaly Watch</p>
                  <Badge className="ml-auto bg-amber-200 text-amber-800 border-amber-300 text-[10px] px-1.5 rounded-full">
                    {anomalies.length}
                  </Badge>
                </div>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {anomalies.map(a => (
                    <div key={a.name} className="flex items-center justify-between text-[11px]">
                      <span className="text-amber-900 font-medium">{a.name}</span>
                      <span className="text-amber-700 font-mono">{a.count} events</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Activity timeline table ──────────────────────────────────────── */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-0 px-4 pt-4">
            <CardTitle className="text-base flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-slate-500" />
                <span className="text-slate-800">Activity Timeline</span>
              </div>
              <span className="text-sm font-normal text-slate-500">
                {total.toLocaleString()} total events
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-10 text-center text-slate-400 text-sm">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-300" />
                Loading audit events…
              </div>
            ) : entries.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-sm">
                No audit events found for the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {["Timestamp", "Source", "Event Type", "Employee", "Actor", ""].map(h => (
                        <th
                          key={h}
                          className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entries.map(e => <AuditRow key={e.id} entry={e} />)}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                <span className="text-xs text-slate-500">
                  Page <span className="font-semibold text-slate-700">{page}</span> of{" "}
                  <span className="font-semibold text-slate-700">{totalPages}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                    className="h-7 px-3 text-xs rounded-full"
                  >
                    Previous
                  </Button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                    const pg = start + i;
                    return pg <= totalPages ? (
                      <Button
                        key={pg}
                        variant={pg === page ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPage(pg)}
                        className={`h-7 w-7 p-0 text-xs rounded-full ${pg === page ? "bg-slate-800 text-white border-slate-800" : ""}`}
                      >
                        {pg}
                      </Button>
                    ) : null;
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="h-7 px-3 text-xs rounded-full"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}
