import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  HardDrive,
  Headphones,
  Monitor,
  Package,
  Server,
  ShieldCheck,
  ShieldX,
  Ticket,
  Upload,
  UserPlus,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";

import {
  ReferenceHeader,
  ReferenceMetricGrid,
  ReferencePanel,
  ReferenceQuickLink,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  asRecord,
  asString,
  formatValue,
  metricDetail,
  metricUnavailableReason,
  metricValue,
} from "../reference-dashboard-model";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  ExitPipelinePanel,
  OnboardingFunnelPanel,
} from "./ReferenceSharedPanels";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";

type Tab = "provisioning" | "helpdesk" | "employees" | "bulk_upload";

const TAB_LABELS: Record<Tab, string> = {
  provisioning: "Provisioning Queue",
  helpdesk: "Helpdesk Tickets",
  employees: "Employee IT Directory",
  bulk_upload: "Bulk Upload",
};

// ── CSV Template ──────────────────────────────────────────────────────────────
const CSV_COLUMNS = [
  { key: "employee_code",      label: "Employee Code",      required: true,  example: "MAS0001",                           note: "Must match HRMS employee code exactly" },
  { key: "official_email",     label: "Official Email",     required: true,  example: "john.doe@teammas.in",               note: "Must be @teammas.in or @teammas.co.in" },
  { key: "domain_account",     label: "Domain Account",     required: true,  example: "john.d",                            note: "AD login username (without domain)" },
  { key: "asset_tag",          label: "Asset Tag",          required: false, example: "LAP-0042",                          note: "Laptop / device asset tag from inventory" },
  { key: "biometric_enrolled", label: "Biometric Enrolled", required: false, example: "yes",                              note: "yes / no — biometric attendance enrolled" },
  { key: "id_card_printed",    label: "ID Card Printed",    required: false, example: "yes",                              note: "yes / no — employee ID card issued" },
];

const SAMPLE_ROWS = [
  ["MAS0001", "john.doe@teammas.in",    "john.d",    "LAP-0042", "yes", "yes"],
  ["MAS0002", "priya.sharma@teammas.in","priya.s",   "LAP-0043", "yes", "no"],
  ["MAS0003", "rahul.kumar@teammas.in", "rahul.k",   "",         "no",  "no"],
];

function buildCsvTemplate(): string {
  const header = CSV_COLUMNS.map(c => c.key).join(",");
  const rows   = SAMPLE_ROWS.map(r => r.join(","));
  return [header, ...rows].join("\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SlaBadge({ breached, dueAt }: { breached: unknown; dueAt: unknown }) {
  const isBreached = Number(breached) === 1 || breached === true;
  const due = dueAt ? new Date(String(dueAt)) : null;
  const nearBreach = due && !isBreached && due.getTime() - Date.now() < 4 * 60 * 60 * 1000;
  if (isBreached) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
      <ShieldX className="h-3 w-3" /> Breached
    </span>
  );
  if (nearBreach) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
      <AlertTriangle className="h-3 w-3" /> At Risk
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
      <CheckCircle2 className="h-3 w-3" /> On Time
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status ?? "").toLowerCase();
  const colors: Record<string, string> = {
    open:        "bg-blue-50 text-blue-700",
    in_progress: "bg-violet-50 text-violet-700",
    resolved:    "bg-emerald-50 text-emerald-700",
    closed:      "bg-slate-100 text-slate-600",
    cancelled:   "bg-slate-100 text-slate-400",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${colors[s] ?? "bg-amber-50 text-amber-700"}`}>
      {s.replace(/_/g, " ") || "—"}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const p = String(priority ?? "").toLowerCase();
  const colors: Record<string, string> = {
    urgent: "bg-red-500", high: "bg-amber-500", medium: "bg-blue-400", low: "bg-slate-300",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[p] ?? "bg-slate-300"}`} />;
}

// ── Tab: Provisioning ─────────────────────────────────────────────────────────

/**
 * `available` distinguishes "the provisioning source failed" from "there is nothing
 * pending". Both render as an empty task list, and defaulting the counts to zero presents a
 * failed fetch as a clean queue — the one reading an IT manager is most likely to act on by
 * doing nothing. The distinction existed before the comprehensive-IT-dashboard rewrite
 * dropped it; role-dashboard-live-data.contract.test.ts has been failing on it since.
 */
function ProvisioningTab({ it, itProv, available }: {
  it: Record<string, unknown>;
  itProv: Record<string, unknown>;
  available: boolean;
}) {
  // Left undefined rather than coerced, so a missing count is never rendered as a real 0.
  const taskBreakdown = [
    { label: "Domain / Login",   value: asNumber(it.pending_domain),    color: "#3b82f6" },
    { label: "Email Setup",      value: asNumber(it.pending_email),     color: "#8b5cf6" },
    { label: "Asset Assignment", value: asNumber(it.pending_asset ?? itProv.pending_asset), color: "#f59e0b" },
    { label: "Biometric Enroll", value: asNumber(it.pending_biometric ?? itProv.pending_biometric), color: "#06b6d4" },
  ].filter((t): t is { label: string; value: number; color: string } =>
    typeof t.value === "number" && t.value > 0);
  const maxTask = Math.max(...taskBreakdown.map(t => t.value), 1);
  const pendingJoiners = arrayAt(it, "pending_joiners").slice(0, 10);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <ReferencePanel title="Task Breakdown" bodyClassName="p-4">
        {!available ? (
          <p className="py-6 text-center text-sm text-[#a0aec0]">Provisioning source unavailable</p>
        ) : taskBreakdown.length > 0 ? (
          <div className="space-y-3">
            {taskBreakdown.map(task => (
              <div key={task.label} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-right text-xs text-[#61708a]">{task.label}</span>
                <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9] h-3">
                  <div className="h-3 rounded-full transition-all" style={{ width: `${Math.round((task.value / maxTask) * 100)}%`, backgroundColor: task.color }} />
                </div>
                <span className="w-6 text-xs font-semibold text-[#0b1f44]">{task.value}</span>
              </div>
            ))}
          </div>
        ) : <p className="py-6 text-center text-sm text-[#a0aec0]">No pending provisioning tasks</p>}
      </ReferencePanel>

      <ReferencePanel title="New Joiners Awaiting IT Setup" action={<span className="text-xs text-[#61708a]">{pendingJoiners.length} pending</span>} bodyClassName="p-0">
        {pendingJoiners.length > 0 ? (
          <div className="divide-y divide-[#edf1f6]">
            {pendingJoiners.map((row, i) => {
              const slaTime = row.sla_due_at ? new Date(String(row.sla_due_at)) : null;
              const hoursLeft = slaTime ? Math.round((slaTime.getTime() - Date.now()) / 3_600_000) : null;
              const isOverdue = hoursLeft !== null && hoursLeft < 0;
              return (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#0b1f44]">{String(row.employee_name ?? "New Joiner")}</p>
                    <p className="text-xs text-[#61708a]">{String(row.employee_code ?? "")}{row.task_code ? ` · ${String(row.task_code).replace(/_/g, " ")}` : ""}</p>
                  </div>
                  {hoursLeft !== null && (
                    <span className={`ml-3 shrink-0 text-xs font-semibold ${isOverdue ? "text-red-600" : "text-amber-600"}`}>
                      {isOverdue ? `${Math.abs(hoursLeft)}h overdue` : `${hoursLeft}h left`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No pending provisioning tasks</p>}
      </ReferencePanel>
    </div>
  );
}

// ── Tab: Helpdesk ─────────────────────────────────────────────────────────────

function HelpdeskTab({ helpdesk }: { helpdesk: Record<string, unknown> }) {
  const stats   = asRecord(helpdesk.stats);
  const tickets = Array.isArray(helpdesk.tickets) ? helpdesk.tickets as Record<string, unknown>[] : [];
  // Same distinction the provisioning tab makes: an absent helpdesk payload is not a
  // helpdesk with zero tickets. Coercing each figure to 0 renders "0 open, 0 breached" — a
  // perfectly healthy-looking queue — when the source simply did not answer. The tab reports
  // that once, up front, rather than each tile inventing a zero.
  const total        = asNumber(stats.total_tickets);
  const open         = asNumber(stats.open_tickets);
  const urgent       = asNumber(stats.urgent_tickets);
  const breachedOpen = asNumber(stats.sla_breached_open);
  const resolvedOT   = asNumber(stats.resolved_on_time);
  const avgMins      = asNumber(stats.avg_resolution_minutes);
  const slaPct = total !== undefined && total > 0 && resolvedOT !== undefined
    ? Math.round((resolvedOT / total) * 100)
    : null;

  // A tile with no figure shows a dash, and its colour stays neutral. Defaulting each of
  // these to 0 rendered "0 open, 0 urgent, 0 breached" in confident green — a healthy queue
  // — whenever the helpdesk payload was simply absent. Green-for-zero is only truthful when
  // the zero was measured.
  const countTone = (value: number | undefined, whenPositive: string) =>
    value === undefined ? "text-[#a0aec0]" : value > 0 ? whenPositive : "text-emerald-600";
  const show = (value: number | undefined) => (value === undefined ? "—" : value);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: "Total Tickets",    value: show(total),        color: total === undefined ? "text-[#a0aec0]" : "text-[#0b1f44]" },
          { label: "Open",             value: show(open),         color: countTone(open, "text-amber-600") },
          { label: "Urgent Open",      value: show(urgent),       color: countTone(urgent, "text-red-600") },
          { label: "SLA Breached",     value: show(breachedOpen), color: countTone(breachedOpen, "text-red-600") },
          { label: "Avg Resolution",   value: avgMins !== undefined ? `${(avgMins / 60).toFixed(1)}h` : "—", color: "text-[#0b1f44]" },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-[#edf1f6] bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{typeof s.value === "number" ? formatValue(s.value) : s.value}</p>
            <p className="mt-0.5 text-[11px] text-[#61708a]">{s.label}</p>
          </div>
        ))}
      </div>
      {slaPct !== null && (
        <div className="flex items-center gap-3 rounded-xl border border-[#edf1f6] bg-white px-4 py-3">
          <span className="text-xs text-[#61708a]">SLA Compliance</span>
          <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9] h-2.5">
            <div className={`h-2.5 rounded-full transition-all ${slaPct >= 80 ? "bg-emerald-500" : slaPct >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${slaPct}%` }} />
          </div>
          <span className={`text-xs font-bold ${slaPct >= 80 ? "text-emerald-600" : slaPct >= 60 ? "text-amber-600" : "text-red-600"}`}>{slaPct}%</span>
        </div>
      )}
      <ReferencePanel title="IT Ticket History" action={<span className="text-xs text-[#61708a]">{tickets.length} records</span>} bodyClassName="p-0">
        {tickets.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#edf1f6] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                  <th className="px-4 py-3 text-left">Ticket #</th>
                  <th className="px-4 py-3 text-left">Employee</th>
                  <th className="px-4 py-3 text-left">Subject</th>
                  <th className="px-4 py-3 text-left">Priority</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">SLA</th>
                  <th className="px-4 py-3 text-left">Resolved By</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t, i) => (
                  <tr key={String(t.id ?? i)} className="border-b border-[#f8fafc] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#61708a]">{asString(t.ticket_number) ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-medium text-[#0b1f44]">{asString(t.raised_by_name) ?? "—"}</p>
                      <p className="text-[10px] text-[#a0aec0]">{asString(t.employee_code) ?? ""}</p>
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2.5 text-xs text-[#0b1f44]">{asString(t.subject) ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <PriorityDot priority={String(t.priority ?? "")} />
                        <span className="text-xs capitalize text-[#61708a]">{String(t.priority ?? "—")}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={String(t.status ?? "")} /></td>
                    <td className="px-4 py-2.5"><SlaBadge breached={t.sla_breached} dueAt={t.sla_due_at} /></td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">{asString(t.resolved_by_name) ?? (t.resolved_at ? "IT Team" : "—")}</td>
                    <td className="px-4 py-2.5 text-xs text-[#a0aec0]">{t.created_at ? String(t.created_at).slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No IT helpdesk tickets found</p>}
      </ReferencePanel>
    </div>
  );
}

// ── Tab: Employee IT Directory ────────────────────────────────────────────────

function EmployeeDirectoryTab({ employees }: { employees: Record<string, unknown>[] }) {
  const [search, setSearch] = useState("");
  const filtered = employees.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(e.employee_code ?? "").toLowerCase().includes(q) ||
      String(e.employee_name ?? "").toLowerCase().includes(q) ||
      String(e.official_email ?? "").toLowerCase().includes(q) ||
      String(e.domain_account ?? "").toLowerCase().includes(q) ||
      String(e.branch_name ?? "").toLowerCase().includes(q) ||
      String(e.process_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <ReferencePanel
      title="Employee IT Directory"
      action={
        <input
          type="text"
          placeholder="Search name, email, domain..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#0b1f44] placeholder:text-[#a0aec0] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30 w-56"
        />
      }
      bodyClassName="p-0"
    >
      {filtered.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#edf1f6] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Official Email</th>
                <th className="px-4 py-3 text-left">Domain Account</th>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Branch</th>
                <th className="px-4 py-3 text-left">Process</th>
                <th className="px-4 py-3 text-left">IT Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const provStatus = String(e.it_provision_status ?? "");
                const statusColor =
                  provStatus === "actioned" || provStatus === "confirmed" ? "bg-emerald-50 text-emerald-700" :
                  provStatus === "pending"  || provStatus === "pending_unassigned" ? "bg-amber-50 text-amber-700" :
                  provStatus === "waived"   ? "bg-slate-100 text-slate-500" : "bg-slate-50 text-slate-400";
                return (
                  <tr key={String(e.id ?? i)} className="border-b border-[#f8fafc] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#61708a]">{asString(e.employee_code) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs font-medium text-[#0b1f44]">{asString(e.employee_name) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.official_email ? <span className="font-mono">{String(e.official_email)}</span> : <span className="text-[#a0aec0]">Not assigned</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.domain_account ? <span className="font-mono">{String(e.domain_account)}</span> : <span className="text-[#a0aec0]">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.asset_name
                        ? <div><p className="font-medium text-[#0b1f44]">{String(e.asset_name)}</p><p className="text-[10px] text-[#a0aec0]">{String(e.serial_number ?? "")}</p></div>
                        : <span className="text-[#a0aec0]">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">{asString(e.branch_name) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">{asString(e.process_name) ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {provStatus
                        ? <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusColor}`}>{provStatus.replace(/_/g, " ")}</span>
                        : <span className="text-[10px] text-[#a0aec0]">No IT task</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">
          {search ? "No matching employees found" : "No employee IT data available"}
        </p>
      )}
    </ReferencePanel>
  );
}

// ── Tab: Bulk Upload ──────────────────────────────────────────────────────────

type ParsedRow = {
  employee_code: string;
  official_email: string;
  domain_account: string;
  asset_tag: string;
  biometric_enrolled: string;
  id_card_printed: string;
  _rowNum: number;
  _errors: string[];
};

type SyncResult = {
  employee_code: string;
  employee_name?: string;
  status: "updated" | "task_completed" | "skipped" | "error";
  actions: string[];
  message?: string;
};

function validateRow(row: ParsedRow): string[] {
  const errs: string[] = [];
  if (!row.employee_code.trim()) errs.push("employee_code is required");
  if (!row.official_email.trim()) errs.push("official_email is required");
  else if (!/^[^\s@]+@(teammas\.in|teammas\.co\.in)$/i.test(row.official_email.trim()))
    errs.push("email must be @teammas.in or @teammas.co.in");
  if (!row.domain_account.trim()) errs.push("domain_account is required");
  return errs;
}

function BulkUploadTab() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [fileName, setFileName] = useState("");

  function resetFile() {
    setRows([]); setParseError(""); setResults(null); setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    resetFile();
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      try {
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { setParseError("File must have a header row and at least one data row."); return; }
        const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
        const idx = (col: string) => header.indexOf(col);
        if (idx("employee_code") === -1) { setParseError("Column 'employee_code' not found. Check header row."); return; }
        const parsed: ParsedRow[] = lines.slice(1).map((line, i) => {
          // Handle quoted fields
          const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
          const get = (col: string) => { const j = idx(col); return j >= 0 ? (cols[j] ?? "").trim() : ""; };
          const row: ParsedRow = {
            employee_code:      get("employee_code"),
            official_email:     get("official_email"),
            domain_account:     get("domain_account"),
            asset_tag:          get("asset_tag"),
            biometric_enrolled: get("biometric_enrolled"),
            id_card_printed:    get("id_card_printed"),
            _rowNum: i + 2,
            _errors: [],
          };
          row._errors = validateRow(row);
          return row;
        });
        setRows(parsed);
      } catch {
        setParseError("Failed to parse file. Ensure it is a valid CSV.");
      }
    };
    reader.readAsText(file);
  }

  const validRows   = rows.filter(r => r._errors.length === 0);
  const invalidRows = rows.filter(r => r._errors.length > 0);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const payload = validRows.map(r => ({
        employee_code:      r.employee_code,
        official_email:     r.official_email,
        domain_account:     r.domain_account,
        asset_tag:          r.asset_tag || undefined,
        biometric_enrolled: r.biometric_enrolled || undefined,
        id_card_printed:    r.id_card_printed || undefined,
      }));
      return hrmsApi.post<{ success: boolean; processed: number; completed: number; updated: number; errors: number; results: SyncResult[] }>(
        "/api/it-provisioning/bulk-sync",
        { rows: payload },
      );
    },
    onSuccess: (res: any) => {
      const r = res as { completed?: number; updated?: number; processed?: number; errors?: number; results?: SyncResult[] };
      const updated = (Number(r.completed) || 0) + (Number(r.updated) || 0);
      toast.success(`Sync complete: ${updated} employees updated, ${Number(r.errors) || 0} errors`);
      setResults(r.results ?? []);
      queryClient.invalidateQueries({ queryKey: ["reference-dashboard-it-full"] });
      queryClient.invalidateQueries({ queryKey: ["reference-dashboard-it-provisioning"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Upload failed"),
  });

  const resultCompleted = (results ?? []).filter(r => r.status === "task_completed").length;
  const resultUpdated   = (results ?? []).filter(r => r.status === "updated").length;
  const resultErrors    = (results ?? []).filter(r => r.status === "error").length;

  return (
    <div className="space-y-5">
      {/* Format guide */}
      <div className="rounded-2xl border border-[#edf1f6] bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#edf1f6] px-5 py-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-[#3b82f6]" />
            <h3 className="text-sm font-bold text-[#0b1f44]">CSV Format Guide</h3>
          </div>
          <button
            onClick={() => downloadCsv(buildCsvTemplate(), "it_bulk_upload_template.csv")}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2563eb] transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Download Template
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#edf1f6] bg-[#f8fafc] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                <th className="px-4 py-2.5 text-left">Column</th>
                <th className="px-4 py-2.5 text-left">Required</th>
                <th className="px-4 py-2.5 text-left">Example Value</th>
                <th className="px-4 py-2.5 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {CSV_COLUMNS.map(col => (
                <tr key={col.key} className="border-b border-[#f8fafc]">
                  <td className="px-4 py-2 font-mono font-semibold text-[#0b1f44]">{col.key}</td>
                  <td className="px-4 py-2">
                    {col.required
                      ? <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Required</span>
                      : <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Optional</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-[#61708a]">{col.example}</td>
                  <td className="px-4 py-2 text-[#61708a]">{col.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[#edf1f6] bg-[#fffbeb] px-5 py-3">
          <p className="text-xs text-amber-700">
            <strong>Important:</strong> This upload works for <em>all active employees</em> — whether or not they have a pending provisioning task.
            If a pending IT provisioning task exists it will be automatically marked completed.
            Employees already provisioned will have their records updated silently.
          </p>
        </div>
      </div>

      {/* Upload area */}
      <div className="rounded-2xl border border-[#edf1f6] bg-white p-5 space-y-4">
        <h3 className="text-sm font-bold text-[#0b1f44]">Upload IT Data</h3>

        <label className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${rows.length > 0 ? "border-[#3b82f6] bg-blue-50/40" : "border-[#e2e8f0] bg-[#f8fafc] hover:border-[#3b82f6] hover:bg-blue-50/30"}`}>
          <Upload className={`h-8 w-8 mb-2 ${rows.length > 0 ? "text-[#3b82f6]" : "text-[#a0aec0]"}`} />
          {fileName
            ? <p className="text-sm font-semibold text-[#0b1f44]">{fileName}</p>
            : <p className="text-sm font-semibold text-[#0b1f44]">Click to choose a CSV file</p>}
          <p className="text-xs text-[#a0aec0] mt-1">or drag and drop · .csv files only</p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </label>

        {parseError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <XCircle className="h-4 w-4 shrink-0" /> {parseError}
          </div>
        )}

        {rows.length > 0 && !results && (
          <>
            {/* Stats row */}
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {rows.length} rows total
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> {validRows.length} valid
              </span>
              {invalidRows.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                  <XCircle className="h-3.5 w-3.5" /> {invalidRows.length} with errors
                </span>
              )}
            </div>

            {/* Preview table */}
            <div className="rounded-xl border border-[#edf1f6] overflow-hidden">
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#f8fafc] z-10">
                    <tr className="border-b border-[#edf1f6] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                      <th className="px-3 py-2.5 text-left">Row</th>
                      <th className="px-3 py-2.5 text-left">Employee Code</th>
                      <th className="px-3 py-2.5 text-left">Official Email</th>
                      <th className="px-3 py-2.5 text-left">Domain Account</th>
                      <th className="px-3 py-2.5 text-left">Asset Tag</th>
                      <th className="px-3 py-2.5 text-left">Biometric</th>
                      <th className="px-3 py-2.5 text-left">ID Card</th>
                      <th className="px-3 py-2.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r._rowNum} className={`border-b ${r._errors.length > 0 ? "bg-red-50/40" : "hover:bg-[#f8fafc]"}`}>
                        <td className="px-3 py-2 text-[#a0aec0]">{r._rowNum}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-[#0b1f44]">{r.employee_code || <span className="text-red-400">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-[#61708a]">{r.official_email || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-[#61708a]">{r.domain_account || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2 text-[#61708a]">{r.asset_tag || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2 text-[#61708a] capitalize">{r.biometric_enrolled || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2 text-[#61708a] capitalize">{r.id_card_printed || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2">
                          {r._errors.length === 0
                            ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Valid</span>
                            : (
                              <div className="space-y-0.5">
                                {r._errors.map((err, ei) => (
                                  <div key={ei} className="flex items-center gap-1 text-[10px] text-red-600">
                                    <XCircle className="h-3 w-3 shrink-0" /> {err}
                                  </div>
                                ))}
                              </div>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {invalidRows.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                {invalidRows.length} row{invalidRows.length > 1 ? "s" : ""} with errors will be skipped. Fix the CSV and re-upload, or proceed with {validRows.length} valid rows only.
              </p>
            )}

            <div className="flex items-center justify-between pt-1">
              <button onClick={resetFile} className="text-xs text-[#61708a] underline hover:text-[#0b1f44]">Clear and start over</button>
              <button
                disabled={validRows.length === 0 || uploadMutation.isPending}
                onClick={() => uploadMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0b1f44] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1a3060] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploadMutation.isPending
                  ? <><span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> Uploading…</>
                  : <><Upload className="h-4 w-4" /> Upload {validRows.length} Employee{validRows.length !== 1 ? "s" : ""}</>}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="rounded-2xl border border-[#edf1f6] bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#edf1f6] px-5 py-3">
            <h3 className="text-sm font-bold text-[#0b1f44]">Upload Results</h3>
            <div className="flex gap-2">
              {resultCompleted > 0 && <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{resultCompleted} tasks completed</span>}
              {resultUpdated   > 0 && <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{resultUpdated} records updated</span>}
              {resultErrors    > 0 && <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">{resultErrors} errors</span>}
            </div>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#f8fafc] z-10">
                <tr className="border-b border-[#edf1f6] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                  <th className="px-4 py-2.5 text-left">Code</th>
                  <th className="px-4 py-2.5 text-left">Employee</th>
                  <th className="px-4 py-2.5 text-left">Result</th>
                  <th className="px-4 py-2.5 text-left">Actions Taken</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const statusInfo = {
                    task_completed: { cls: "bg-emerald-50 text-emerald-700", icon: <CheckCircle2 className="h-3 w-3" />, label: "Task Completed" },
                    updated:        { cls: "bg-blue-50 text-blue-700",     icon: <CheckCircle2 className="h-3 w-3" />, label: "Updated" },
                    skipped:        { cls: "bg-slate-100 text-slate-500",  icon: <AlertTriangle className="h-3 w-3" />, label: "Skipped" },
                    error:          { cls: "bg-red-50 text-red-700",       icon: <XCircle className="h-3 w-3" />, label: "Error" },
                  }[r.status] ?? { cls: "bg-slate-100 text-slate-500", icon: null, label: r.status };
                  return (
                    <tr key={i} className="border-b border-[#f8fafc] hover:bg-[#f8fafc]">
                      <td className="px-4 py-2.5 font-mono font-semibold text-[#0b1f44]">{r.employee_code}</td>
                      <td className="px-4 py-2.5 text-[#61708a]">{r.employee_name ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusInfo.cls}`}>
                          {statusInfo.icon} {statusInfo.label}
                        </span>
                        {r.message && <p className="mt-0.5 text-[10px] text-red-500">{r.message}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.actions.length > 0
                          ? <ul className="space-y-0.5">{r.actions.map((a, ai) => <li key={ai} className="text-[10px] text-[#61708a]">· {a}</li>)}</ul>
                          : <span className="text-[#a0aec0]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#edf1f6] px-5 py-3 flex justify-between items-center">
            <p className="text-xs text-[#61708a]">Upload complete. The Employee IT Directory tab will reflect updated data.</p>
            <button onClick={resetFile} className="text-xs text-[#3b82f6] font-semibold hover:underline">Upload another file</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Layout ───────────────────────────────────────────────────────────────

export function ItManagerReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const [activeTab, setActiveTab] = useState<Tab>("provisioning");

  const itProv       = data.itProvisioning ?? {};
  const itFull       = asRecord(data.itDashboard);
  const provData     = asRecord(itFull.provisioning ?? itProv);
  const helpdesk     = asRecord(itFull.helpdesk);
  const assetSummary = asRecord(itFull.assets);
  const employees    = Array.isArray((itFull as any).employees)
    ? (itFull as any).employees as Record<string, unknown>[] : [];

  const pendingTotal    = asNumber(provData.pending_total  ?? itProv.pending_total);
  const overdueCount    = asNumber(provData.overdue        ?? itProv.overdue);
  const completedToday  = asNumber(provData.completed_today ?? itProv.completed_today);
  const openTickets     = asNumber(asRecord(helpdesk.stats).open_tickets);
  const slaBreachedOpen = asNumber(asRecord(helpdesk.stats).sla_breached_open);
  const assetsAssigned  = asNumber(assetSummary.assigned);
  const assetsAvailable = asNumber(assetSummary.available);
  const expiringWarranty= asNumber(assetSummary.expiring_soon);

  const tabs: Tab[] = ["provisioning", "helpdesk", "employees", "bulk_upload"];
  const tabIcons: Record<Tab, React.ReactNode> = {
    provisioning: <Server className="h-4 w-4" />,
    helpdesk:     <Headphones className="h-4 w-4" />,
    employees:    <Users className="h-4 w-4" />,
    bulk_upload:  <Upload className="h-4 w-4" />,
  };

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader
        title="IT Department Dashboard"
        subtitle="Provisioning queue · Helpdesk tickets · Employee IT directory · Bulk data upload"
        badge="IT Manager View"
        right={filters}
      />
      <TodayCelebrationsWidget />

      <ReferenceMetricGrid
        columns={4}
        loading={data.loading}
        metrics={[
          { label: "Pending Provisioning", value: pendingTotal,    helper: "new joiners awaiting IT", icon: Clock,      tone: pendingTotal === null ? "slate" : pendingTotal > 10 ? "red" : pendingTotal > 5 ? "amber" : "green", onDrilldown: () => setActiveTab("provisioning") },
          { label: "SLA Overdue",          value: overdueCount,    helper: "provisioning tasks past SLA", icon: AlertTriangle, tone: overdueCount === null ? "slate" : overdueCount > 0 ? "red" : "green", onDrilldown: () => setActiveTab("provisioning") },
          { label: "Open IT Tickets",      value: openTickets,     helper: "helpdesk tickets open",  icon: Ticket,      tone: openTickets === null ? "slate" : openTickets > 10 ? "red" : openTickets > 3 ? "amber" : "green", onDrilldown: () => setActiveTab("helpdesk") },
          { label: "SLA Breached",         value: slaBreachedOpen, helper: "IT tickets past SLA",    icon: ShieldX,     tone: slaBreachedOpen === null ? "slate" : slaBreachedOpen > 0 ? "red" : "green", onDrilldown: () => setActiveTab("helpdesk") },
        ]}
      />

      {/* Provisioning demand: incoming joiners need accounts and assets, exits need
          deprovisioning and asset recovery. Both come from the IT bundle's own metrics. */}
      <ReferenceMetricGrid
        columns={3}
        loading={data.loading}
        metrics={[
          {
            label: "Incoming Joiners",
            value: metricDetail(m, "onb", "pending") ?? metricValue(m, "onb"),
            helper: "accounts and assets to provision",
            icon: Users,
            tone: "amber",
            href: "/ats/onboarding-requests",
            unavailableReason: metricUnavailableReason(m, "onb"),
            ...drill("onb"),
          },
          {
            label: "Exits To Deprovision",
            value: metricDetail(m, "resign", "totalActive") ?? metricValue(m, "resign"),
            helper: "revoke access and recover assets",
            icon: ShieldX,
            tone: "red",
            href: "/exit/command-center",
            unavailableReason: metricUnavailableReason(m, "resign"),
            ...drill("resign"),
          },
          {
            label: "Active Headcount",
            value: metricDetail(m, "hc", "active") ?? metricValue(m, "hc"),
            helper: "accounts under management",
            icon: HardDrive,
            tone: "blue",
            href: "/employees",
            unavailableReason: metricUnavailableReason(m, "hc"),
            ...drill("hc"),
          },
        ]}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Assets Assigned",   value: assetsAssigned,    icon: HardDrive,    color: "text-blue-600" },
          { label: "Assets Available",  value: assetsAvailable,   icon: Package,      color: "text-emerald-600" },
          { label: "Warranty Expiring", value: expiringWarranty,  icon: Wrench,       color: expiringWarranty !== null && expiringWarranty > 0 ? "text-amber-600" : "text-slate-500" },
          { label: "Completed Today",   value: completedToday,    icon: CheckCircle2, color: "text-emerald-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-[#edf1f6] bg-white px-4 py-3">
            <Icon className={`h-5 w-5 shrink-0 ${color}`} />
            <div>
              <p className={`text-xl font-bold ${color}`}>{formatValue(value)}</p>
              <p className="text-[11px] text-[#61708a]">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#edf1f6] bg-white overflow-hidden">
        <div className="flex border-b border-[#edf1f6] overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex shrink-0 items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-[#3b82f6] text-[#3b82f6] bg-[#f8faff]"
                  : "text-[#61708a] hover:text-[#0b1f44] hover:bg-[#f8fafc]"
              } ${tab === "bulk_upload" ? "ml-auto" : ""}`}
            >
              {tabIcons[tab]}
              {TAB_LABELS[tab]}
              {tab === "bulk_upload" && (
                <span className="rounded-full bg-[#3b82f6] px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">NEW</span>
              )}
            </button>
          ))}
        </div>
        <div className="p-4">
          {activeTab === "provisioning" && <ProvisioningTab it={provData} itProv={itProv} available={data.itProvisioningAvailable !== false} />}
          {activeTab === "helpdesk"     && <HelpdeskTab helpdesk={helpdesk} />}
          {activeTab === "employees"    && <EmployeeDirectoryTab employees={employees} />}
          {activeTab === "bulk_upload"  && <BulkUploadTab />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ReferenceQuickLink href="/provisioning/it"    title="IT Provisioning Queue" icon={Server} />
        <ReferenceQuickLink href="/helpdesk"           title="Helpdesk"              icon={Headphones} />
        <ReferenceQuickLink href="/assets-manager"     title="Assets Manager"        icon={HardDrive} />
        <ReferenceQuickLink href="/provisioning/admin" title="Admin Provisioning"    icon={UserPlus} />
        <ReferenceQuickLink href="/employees"          title="Employee Directory"     icon={Monitor} />
        <ReferenceQuickLink href="/settings"           title="Settings"              icon={ShieldCheck} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <OnboardingFunnelPanel data={data} />
        <ExitPipelinePanel data={data} />
      </div>
    </div>
  );
}
