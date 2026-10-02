import { AlertTriangle, CheckCircle2, ShieldX } from "lucide-react";
import { ReferencePanel } from "../../ReferenceDashboardUI";
import { arrayAt, asNumber, asRecord, asString, formatValue } from "../../reference-dashboard-model";

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
export function HelpdeskTab({ helpdesk }: { helpdesk: Record<string, unknown> }) {
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
  // Denominator is RESOLVED tickets. It used to be total_tickets (open included), which understated compliance.
  const resolvedTotal = asNumber(stats.resolved_total);
  const avgMins      = asNumber(stats.avg_resolution_minutes);
  const slaPct = resolvedTotal !== undefined && resolvedTotal > 0 && resolvedOT !== undefined
    ? Math.round((resolvedOT / resolvedTotal) * 100)
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
