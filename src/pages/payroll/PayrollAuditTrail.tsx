import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { RefreshCw, ChevronDown, ChevronRight, Shield, Calculator } from "lucide-react";

interface AuditEntry {
  id: string;
  source: "calculation" | "action";
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
  return (
    <>
        <tr
          onClick={() => setOpen(o => !o)}
          className="hover:bg-slate-50/60 cursor-pointer transition-colors"
        >
          <td className="px-3 py-1.5 text-xs text-slate-400 whitespace-nowrap">
            {new Date(entry.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </td>
          <td className="px-3 py-1.5">
            <Badge variant="outline" className={`text-[11px] px-1.5 py-0 gap-1 ${SOURCE_COLOR[entry.source]}`}>
              {SOURCE_ICON[entry.source]}
              {entry.source}
            </Badge>
          </td>
          <td className="px-3 py-1.5 font-mono text-xs max-w-[220px] truncate">{entry.event_type}</td>
          {/* Name and code on one line: the stacked pair doubled every row's height for a value
              most rows do not even have. */}
          <td className="px-3 py-1.5 text-xs whitespace-nowrap">
            {entry.employee_name ? (
              <>
                <span className="font-medium">{entry.employee_name}</span>
                {entry.employee_code && <span className="text-slate-400 ml-1.5">{entry.employee_code}</span>}
              </>
            ) : "—"}
          </td>
          <td className="px-3 py-1.5 text-xs text-slate-500 whitespace-nowrap">{entry.actor_name ?? entry.actor_user_id ?? "system"}</td>
          <td className="px-3 py-1.5 w-8">
            <span className="text-slate-400">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</span>
          </td>
        </tr>
      {open && (
        <tr>
          <td colSpan={6} className="px-4 pb-3 pt-0 bg-slate-50 border-b">
            <pre className="text-xs text-slate-600 whitespace-pre-wrap break-all max-h-64 overflow-auto font-mono bg-white border rounded p-3 mt-2">
              {pretty(entry.event_detail)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

/** Inline label + control, sized to its content — the unit the compact filter bar is built from. */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
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

  function reset() {
    setRunId(""); setEmployeeId(""); setEventType(""); setDateFrom(""); setDateTo(""); setSource("all"); setPage(1);
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Payroll Audit Trail</h1>
            <p className="text-slate-500 text-sm mt-0.5">Complete history of all payroll calculations and sensitive actions</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Filters — single compact toolbar row. The previous 6-column grid stretched every control
            to an equal ~200px cell and stacked a label above it, so five short filters occupied a
            tall full-width block. Inline label + intrinsically-sized control keeps it to one line. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-white px-3 py-2">
          <FilterField label="Run">
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
          <FilterField label="Event">
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
          <FilterField label="Source">
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
          <FilterField label="From">
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="h-7 w-[140px] text-xs px-2" />
          </FilterField>
          <FilterField label="To">
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="h-7 w-[140px] text-xs px-2" />
          </FilterField>
          <Button variant="ghost" size="sm" onClick={reset} className="ml-auto h-7 px-2 text-xs text-slate-500">Clear</Button>
        </div>

        {/* Trail table */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Audit Events</span>
              <span className="text-sm font-normal text-slate-500">{total.toLocaleString()} total</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-slate-400">Loading…</div>
            ) : entries.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No audit events found for the selected filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      {["Timestamp", "Source", "Event Type", "Employee", "Actor", ""].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {entries.map(e => <AuditRow key={e.id} entry={e} />)}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
