import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardDrive,
  Headphones,
  Monitor,
  Package,
  Server,
  ShieldCheck,
  ShieldX,
  Ticket,
  UserPlus,
  Users,
  Wrench,
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
} from "../reference-dashboard-model";

type Tab = "provisioning" | "helpdesk" | "employees";

const TAB_LABELS: Record<Tab, string> = {
  provisioning: "Provisioning Queue",
  helpdesk: "Helpdesk Tickets",
  employees: "Employee IT Directory",
};

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
    open:       "bg-blue-50 text-blue-700",
    in_progress:"bg-violet-50 text-violet-700",
    resolved:   "bg-emerald-50 text-emerald-700",
    closed:     "bg-slate-100 text-slate-600",
    cancelled:  "bg-slate-100 text-slate-400",
  };
  const cls = colors[s] ?? "bg-amber-50 text-amber-700";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${cls}`}>
      {s.replace(/_/g, " ") || "—"}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const p = String(priority ?? "").toLowerCase();
  const colors: Record<string, string> = {
    urgent: "bg-red-500",
    high:   "bg-amber-500",
    medium: "bg-blue-400",
    low:    "bg-slate-300",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[p] ?? "bg-slate-300"}`} />;
}

function ProvisioningTab({ it, itProv }: { it: Record<string, unknown>; itProv: Record<string, unknown> }) {
  const pendingDomain    = asNumber(it.pending_domain);
  const pendingEmail     = asNumber(it.pending_email);
  const pendingAsset     = asNumber(it.pending_asset ?? itProv.pending_asset);
  const pendingBiometric = asNumber(it.pending_biometric ?? itProv.pending_biometric);

  const taskBreakdown = [
    { label: "Domain / Login",  value: pendingDomain    ?? 0, color: "#3b82f6" },
    { label: "Email Setup",     value: pendingEmail     ?? 0, color: "#8b5cf6" },
    { label: "Asset Assignment",value: pendingAsset     ?? 0, color: "#f59e0b" },
    { label: "Biometric Enroll",value: pendingBiometric ?? 0, color: "#06b6d4" },
  ].filter(t => t.value > 0);
  const maxTask = Math.max(...taskBreakdown.map(t => t.value), 1);

  const pendingJoiners = arrayAt(it, "pending_joiners").slice(0, 10);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <ReferencePanel title="Task Breakdown" bodyClassName="p-4">
        {taskBreakdown.length > 0 ? (
          <div className="space-y-3">
            {taskBreakdown.map(task => {
              const pct = Math.round((task.value / maxTask) * 100);
              return (
                <div key={task.label} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-right text-xs text-[#61708a]">{task.label}</span>
                  <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9] h-3">
                    <div className="h-3 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: task.color }} />
                  </div>
                  <span className="w-6 text-xs font-semibold text-[#0b1f44]">{task.value}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-[#a0aec0]">No pending provisioning tasks</p>
        )}
      </ReferencePanel>

      <ReferencePanel
        title="New Joiners Awaiting IT Setup"
        action={<span className="text-xs text-[#61708a]">{pendingJoiners.length} pending</span>}
        bodyClassName="p-0"
      >
        {pendingJoiners.length > 0 ? (
          <div className="divide-y divide-[#edf1f6]">
            {pendingJoiners.map((row, i) => {
              const slaTime = row.sla_due_at ? new Date(String(row.sla_due_at)) : null;
              const hoursLeft = slaTime ? Math.round((slaTime.getTime() - Date.now()) / 3_600_000) : null;
              const isOverdue = hoursLeft !== null && hoursLeft < 0;
              return (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#0b1f44]">
                      {String(row.employee_name ?? row.name ?? "New Joiner")}
                    </p>
                    <p className="text-xs text-[#61708a]">
                      {String(row.employee_code ?? "")}
                      {row.task_code ? ` · ${String(row.task_code).replace(/_/g, " ")}` : ""}
                    </p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    {hoursLeft !== null && (
                      <span className={`text-xs font-semibold ${isOverdue ? "text-red-600" : "text-amber-600"}`}>
                        {isOverdue ? `${Math.abs(hoursLeft)}h overdue` : `${hoursLeft}h left`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No pending provisioning tasks</p>
        )}
      </ReferencePanel>
    </div>
  );
}

function HelpdeskTab({ helpdesk }: { helpdesk: Record<string, unknown> }) {
  const stats  = asRecord(helpdesk.stats);
  const tickets = Array.isArray(helpdesk.tickets) ? helpdesk.tickets as Record<string, unknown>[] : [];

  const total         = asNumber(stats.total_tickets) ?? 0;
  const open          = asNumber(stats.open_tickets) ?? 0;
  const urgent        = asNumber(stats.urgent_tickets) ?? 0;
  const breachedOpen  = asNumber(stats.sla_breached_open) ?? 0;
  const resolvedOnTime = asNumber(stats.resolved_on_time) ?? 0;
  const avgMins       = asNumber(stats.avg_resolution_minutes);
  const avgHrs        = avgMins !== null ? (avgMins / 60).toFixed(1) : null;
  const slaPct        = total > 0 ? Math.round((resolvedOnTime / total) * 100) : null;

  return (
    <div className="space-y-4">
      {/* Helpdesk KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: "Total Tickets",    value: total,        color: "text-[#0b1f44]" },
          { label: "Open",             value: open,         color: open > 0 ? "text-amber-600" : "text-emerald-600" },
          { label: "Urgent Open",      value: urgent,       color: urgent > 0 ? "text-red-600" : "text-emerald-600" },
          { label: "SLA Breached",     value: breachedOpen, color: breachedOpen > 0 ? "text-red-600" : "text-emerald-600" },
          { label: "Avg Resolution",   value: avgHrs !== null ? `${avgHrs}h` : "—", color: "text-[#0b1f44]" },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-[#edf1f6] bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${stat.color}`}>{typeof stat.value === "number" ? formatValue(stat.value) : stat.value}</p>
            <p className="mt-0.5 text-[11px] text-[#61708a]">{stat.label}</p>
          </div>
        ))}
      </div>
      {slaPct !== null && (
        <div className="flex items-center gap-3 rounded-xl border border-[#edf1f6] bg-white px-4 py-3">
          <span className="text-xs text-[#61708a]">SLA Compliance</span>
          <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9] h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all ${slaPct >= 80 ? "bg-emerald-500" : slaPct >= 60 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${slaPct}%` }}
            />
          </div>
          <span className={`text-xs font-bold ${slaPct >= 80 ? "text-emerald-600" : slaPct >= 60 ? "text-amber-600" : "text-red-600"}`}>
            {slaPct}%
          </span>
        </div>
      )}

      {/* Ticket table */}
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
                    <td className="px-4 py-2.5">
                      <SlaBadge breached={t.sla_breached} dueAt={t.sla_due_at} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {asString(t.resolved_by_name) ?? (t.resolved_at ? "IT Team" : "—")}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#a0aec0]">
                      {t.created_at ? String(t.created_at).slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No IT helpdesk tickets found</p>
        )}
      </ReferencePanel>
    </div>
  );
}

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
                <th className="px-4 py-3 text-left">Dept</th>
                <th className="px-4 py-3 text-left">IT Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const provStatus = String(e.it_provision_status ?? "");
                const statusColor =
                  provStatus === "actioned" || provStatus === "confirmed" ? "bg-emerald-50 text-emerald-700" :
                  provStatus === "pending"  || provStatus === "pending_unassigned" ? "bg-amber-50 text-amber-700" :
                  provStatus === "waived"   ? "bg-slate-100 text-slate-500" :
                  "bg-slate-50 text-slate-400";
                return (
                  <tr key={String(e.id ?? i)} className="border-b border-[#f8fafc] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#61708a]">{asString(e.employee_code) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs font-medium text-[#0b1f44]">{asString(e.employee_name) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.official_email
                        ? <span className="font-mono">{String(e.official_email)}</span>
                        : <span className="text-[#a0aec0]">Not assigned</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.domain_account
                        ? <span className="font-mono">{String(e.domain_account)}</span>
                        : <span className="text-[#a0aec0]">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.asset_name
                        ? <div><p className="font-medium text-[#0b1f44]">{String(e.asset_name)}</p><p className="text-[10px] text-[#a0aec0]">{String(e.serial_number ?? "")}</p></div>
                        : <span className="text-[#a0aec0]">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">{asString(e.branch_name) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">{asString(e.process_name) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">{asString(e.dept_name) ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {provStatus ? (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusColor}`}>
                          {provStatus.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#a0aec0]">No IT task</span>
                      )}
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

export function ItManagerReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const [activeTab, setActiveTab] = useState<Tab>("provisioning");

  const itProv   = data.itProvisioning ?? {};
  const itFull   = asRecord(data.itDashboard);
  const provData = asRecord(itFull.provisioning ?? itProv);
  const helpdesk = asRecord(itFull.helpdesk);
  const assetSummary = asRecord(itFull.assets);
  const employees = Array.isArray((itFull as any).employees)
    ? (itFull as any).employees as Record<string, unknown>[]
    : [];

  const pendingTotal     = asNumber(provData.pending_total  ?? itProv.pending_total);
  const overdueCount     = asNumber(provData.overdue        ?? itProv.overdue);
  const completedToday   = asNumber(provData.completed_today ?? itProv.completed_today);
  const openTickets      = asNumber(asRecord(helpdesk.stats).open_tickets);
  const slaBreachedOpen  = asNumber(asRecord(helpdesk.stats).sla_breached_open);
  const assetsAssigned   = asNumber(assetSummary.assigned);
  const assetsAvailable  = asNumber(assetSummary.available);
  const expiringWarranty = asNumber(assetSummary.expiring_soon);

  const tabs: Tab[] = ["provisioning", "helpdesk", "employees"];

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader
        title="IT Department Dashboard"
        subtitle="Provisioning queue · Helpdesk tickets · Employee IT directory · Asset inventory"
        badge="IT Manager View"
      />

      {/* KPI Row */}
      <ReferenceMetricGrid
        columns={4}
        loading={data.loading}
        metrics={[
          {
            label: "Pending Provisioning",
            value: pendingTotal,
            helper: "new joiners awaiting IT",
            icon: Clock,
            tone: pendingTotal === null ? "slate" : pendingTotal > 10 ? "red" : pendingTotal > 5 ? "amber" : "green",
          },
          {
            label: "SLA Overdue",
            value: overdueCount,
            helper: "provisioning tasks past SLA",
            icon: AlertTriangle,
            tone: overdueCount === null ? "slate" : overdueCount > 0 ? "red" : "green",
          },
          {
            label: "Open IT Tickets",
            value: openTickets,
            helper: "helpdesk tickets open",
            icon: Ticket,
            tone: openTickets === null ? "slate" : openTickets > 10 ? "red" : openTickets > 3 ? "amber" : "green",
          },
          {
            label: "SLA Breached",
            value: slaBreachedOpen,
            helper: "IT tickets past SLA deadline",
            icon: ShieldX,
            tone: slaBreachedOpen === null ? "slate" : slaBreachedOpen > 0 ? "red" : "green",
          },
        ]}
      />

      {/* Second KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Assets Assigned",      value: assetsAssigned,   icon: HardDrive,   color: "text-blue-600" },
          { label: "Assets Available",     value: assetsAvailable,  icon: Package,     color: "text-emerald-600" },
          { label: "Warranty Expiring",    value: expiringWarranty, icon: Wrench,      color: expiringWarranty !== null && expiringWarranty > 0 ? "text-amber-600" : "text-slate-500" },
          { label: "Completed Today",      value: completedToday,   icon: CheckCircle2,color: "text-emerald-600" },
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

      {/* Tabs */}
      <div className="rounded-2xl border border-[#edf1f6] bg-white overflow-hidden">
        <div className="flex border-b border-[#edf1f6]">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-[#3b82f6] text-[#3b82f6] bg-[#f8faff]"
                  : "text-[#61708a] hover:text-[#0b1f44] hover:bg-[#f8fafc]"
              }`}
            >
              {tab === "provisioning" && <Server className="h-4 w-4" />}
              {tab === "helpdesk"     && <Headphones className="h-4 w-4" />}
              {tab === "employees"    && <Users className="h-4 w-4" />}
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <div className="p-4">
          {activeTab === "provisioning" && <ProvisioningTab it={provData} itProv={itProv} />}
          {activeTab === "helpdesk"     && <HelpdeskTab helpdesk={helpdesk} />}
          {activeTab === "employees"    && <EmployeeDirectoryTab employees={employees} />}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ReferenceQuickLink href="/provisioning/it"    title="IT Provisioning Queue"  icon={Server} />
        <ReferenceQuickLink href="/helpdesk"           title="Helpdesk"               icon={Headphones} />
        <ReferenceQuickLink href="/assets-manager"     title="Assets Manager"         icon={HardDrive} />
        <ReferenceQuickLink href="/provisioning/admin" title="Admin Provisioning"     icon={UserPlus} />
        <ReferenceQuickLink href="/employees"          title="Employee Directory"      icon={Monitor} />
        <ReferenceQuickLink href="/settings"           title="Settings"               icon={ShieldCheck} />
      </div>
    </div>
  );
}
