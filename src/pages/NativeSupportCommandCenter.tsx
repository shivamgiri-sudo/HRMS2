import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, BarChart2, CheckCircle2, Clock, Cpu,
  RefreshCcw, Ticket, TrendingDown, Users, Zap,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { DashboardLoading, FilterField, KpiTile, SelectFilter } from "@/components/command-center/CommandCenterUi";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTTime } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardStats = {
  total_tickets: number;
  open_tickets: number;
  urgent_tickets: number;
  breached_tickets: number;
  nearing_breach: number;
  avg_resolution_minutes: number | null;
  reopened_count: number;
  unassigned_count: number;
  avg_csat: number | null;
};

type SlaPriorityRow = {
  priority: string;
  total: number;
  breached: number;
  resolved_on_time: number;
  avg_resolution_minutes: number | null;
};

type CategoryRow = {
  category: string;
  total: number;
  open: number;
  breached: number;
  avg_resolution_minutes: number | null;
};

type OwnerRow = {
  assigned_to: string | null;
  owner_name: string;
  total: number;
  open: number;
  urgent_open: number;
  breached: number;
  avg_resolution_minutes: number | null;
};

type AgingBuckets = {
  bucket_0_4h: number;
  bucket_4_24h: number;
  bucket_1_3d: number;
  bucket_3_7d: number;
  bucket_over_7d: number;
};

type RootCauseRow = { root_cause: string; total: number };

type ItSubcategoryRow = {
  subcategory: string;
  total: number;
  open: number;
  breached: number;
  total_downtime_minutes: number;
  total_affected_seats: number;
  avg_downtime_minutes: number | null;
  avg_resolution_minutes: number | null;
};
type ItBranchRow = {
  branch_name: string;
  total_tickets: number;
  open_tickets: number;
  breached: number;
  total_downtime_minutes: number;
  total_affected_seats: number;
  avg_resolution_minutes: number | null;
};
type ItRecurringRow = { issue_label: string; occurrences: number; total_downtime: number; last_seen: string };
type ItSummary = {
  total_it_tickets: number;
  open_it_tickets: number;
  sla_breached: number;
  total_downtime_minutes: number;
  total_seat_impacts: number;
  avg_downtime_per_ticket: number | null;
  avg_resolution_minutes: number | null;
  branches_affected: number;
};
type ItAnalysisData = {
  summary: ItSummary;
  subcategory_breakdown: ItSubcategoryRow[];
  branch_impact: ItBranchRow[];
  recurring_issues: ItRecurringRow[];
};

type SupportCommandCenterData = {
  stats: DashboardStats;
  sla_summary: SlaPriorityRow[];
  category_breakdown: CategoryRow[];
  owner_workload: OwnerRow[];
  aging: AgingBuckets;
  root_causes: RootCauseRow[];
};

type QueueTicket = {
  id: string;
  ticket_number?: string;
  ticket_code?: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assigned_name?: string;
  sla_due_at?: string;
  sla_breached?: boolean;
  created_at: string;
};

type QueueAgent = { id: string; full_name: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMinutes(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-red-600 bg-red-50 border-red-200",
  high:   "text-orange-600 bg-orange-50 border-orange-200",
  medium: "text-yellow-600 bg-yellow-50 border-yellow-200",
  low:    "text-gray-600 bg-gray-50 border-gray-200",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function NativeSupportCommandCenter() {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [stats, setStats]         = useState<DashboardStats | null>(null);
  const [sla, setSla]             = useState<SlaPriorityRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [owners, setOwners]       = useState<OwnerRow[]>([]);
  const [aging, setAging]         = useState<AgingBuckets | null>(null);
  const [rootCauses, setRootCauses] = useState<RootCauseRow[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  // IT depth analysis
  const [itAnalysis, setItAnalysis]       = useState<ItAnalysisData | null>(null);
  const [itLoading, setItLoading]         = useState(false);

  // Ticket queue
  const [queueTickets, setQueueTickets]     = useState<QueueTicket[]>([]);
  const [queueLoading, setQueueLoading]     = useState(false);
  const [queueActionBusy, setQueueActionBusy] = useState<string | null>(null);
  const [queueAgents, setQueueAgents]       = useState<QueueAgent[]>([]);

  // Filters
  const [from, setFrom]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [to, setTo]         = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (category) params.set("category", category);
      if (priority) params.set("priority", priority);
      if (status)   params.set("status",   status);

      const res = await hrmsApi.get<{ success: boolean; data: SupportCommandCenterData }>(
        `/api/helpdesk/command-center?${params}`
      );

      if (res.success) {
        setStats(res.data.stats);
        setSla(res.data.sla_summary ?? []);
        setCategories(res.data.category_breakdown ?? []);
        setOwners(res.data.owner_workload ?? []);
        setAging(res.data.aging ?? null);
        setRootCauses(res.data.root_causes ?? []);
      }
      // formatISTTime returns "" for a falsy argument, so "last refreshed" was always blank.
      setLastRefresh(formatISTTime(new Date()));
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, to, category, priority, status]);

  useEffect(() => { load(); }, [load]);

  const loadItAnalysis = useCallback(async () => {
    setItLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await hrmsApi.get<{ success: boolean; data: ItAnalysisData }>(
        `/api/helpdesk/it-analysis?${params}`
      );
      if (res.success) setItAnalysis(res.data);
    } catch { /* non-fatal */ }
    finally { setItLoading(false); }
  }, [from, to]);

  useEffect(() => { void loadItAnalysis(); }, [loadItAnalysis]);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const [ticketRes, agentRes] = await Promise.all([
        hrmsApi.get<{ data: QueueTicket[] }>("/api/helpdesk/tickets?status=open"),
        hrmsApi.get<{ success: boolean; data: QueueAgent[] }>("/api/helpdesk/agents"),
      ]);
      setQueueTickets(ticketRes.data ?? []);
      setQueueAgents(agentRes.data ?? []);
    } catch { /* non-fatal */ }
    finally { setQueueLoading(false); }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const doQueueAssign = async (ticketId: string, userId: string) => {
    if (!userId) return;
    setQueueActionBusy(ticketId);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${ticketId}/assign`, { assigned_to: userId });
      await loadQueue();
    } catch { /* non-fatal */ }
    finally { setQueueActionBusy(null); }
  };

  const doQueueTake = async (ticketId: string) => {
    setQueueActionBusy(ticketId);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${ticketId}/take`, {});
      await loadQueue();
    } catch { /* non-fatal */ }
    finally { setQueueActionBusy(null); }
  };

  const doQueueEscalate = async (ticketId: string) => {
    setQueueActionBusy(ticketId);
    try {
      await hrmsApi.post(`/api/helpdesk/tickets/${ticketId}/escalate`, {});
      await loadQueue();
    } catch { /* non-fatal */ }
    finally { setQueueActionBusy(null); }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Ticket size={24} className="text-indigo-500" />
              Support Command Center
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              SLA performance, owner workload, ticket analytics
              {lastRefresh && <> · Refreshed {lastRefresh}</>}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <FilterField label="From" type="date" value={from} onChange={setFrom} />
          <FilterField label="To"   type="date" value={to}   onChange={setTo} />
          <SelectFilter label="Category" value={category} onChange={setCategory}
            options={["hr","payroll","it","general","asset","attendance","admin","leave","other"]} />
          <SelectFilter label="Priority" value={priority} onChange={setPriority}
            options={["urgent","high","medium","low"]} />
          {/* 'closed' removed 2026-08-24 - 'resolved' is the only terminal ticket status now */}
          <SelectFilter label="Status" value={status} onChange={setStatus}
            options={["open","in_progress","pending_info","resolved"]} />
        </div>

        {loading ? (
          <DashboardLoading />
        ) : (
          <>
            {/* KPI Summary */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                <KpiTile icon={<Ticket size={18} className="text-indigo-500" />}  label="Open Tickets"     value={stats.open_tickets}     />
                <KpiTile icon={<Zap     size={18} className="text-red-500" />}    label="Urgent Open"      value={stats.urgent_tickets}    highlight={Number(stats.urgent_tickets) > 0} />
                <KpiTile icon={<AlertTriangle size={18} className="text-red-600" />} label="SLA Breached"  value={stats.breached_tickets}  highlight={Number(stats.breached_tickets) > 0} />
                <KpiTile icon={<Clock   size={18} className="text-yellow-500" />} label="Nearing Breach"  value={stats.nearing_breach}    highlight={Number(stats.nearing_breach) > 0} />
                <KpiTile icon={<CheckCircle2 size={18} className="text-green-500" />} label="Avg Resolution" value={formatMinutes(stats.avg_resolution_minutes)} />
                <KpiTile icon={<TrendingDown size={18} className="text-blue-500" />} label="CSAT Avg"      value={stats.avg_csat != null ? `${stats.avg_csat}/5` : "—"} />
                <KpiTile icon={<Users   size={18} className="text-gray-500" />}   label="Unassigned"       value={stats.unassigned_count}  highlight={Number(stats.unassigned_count) > 0} />
                <KpiTile icon={<RefreshCcw size={18} className="text-orange-500" />} label="Reopened"      value={stats.reopened_count}   highlight={Number(stats.reopened_count) > 0} />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* SLA by priority */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <BarChart2 size={16} className="text-indigo-500" /> SLA by Priority
                </h2>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 uppercase">
                    <tr>
                      <th className="pb-2 text-left">Priority</th>
                      <th className="pb-2 text-right">Total</th>
                      <th className="pb-2 text-right">Breached</th>
                      <th className="pb-2 text-right">On-Time</th>
                      <th className="pb-2 text-right">Avg Res.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sla.map(r => (
                      <tr key={r.priority}>
                        <td className="py-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded border ${PRIORITY_COLOR[r.priority] ?? "text-gray-600 bg-gray-50 border-gray-200"}`}>
                            {r.priority}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-600">{r.total}</td>
                        <td className={`py-2 text-right font-medium ${r.breached > 0 ? "text-red-600" : "text-gray-400"}`}>{r.breached}</td>
                        <td className="py-2 text-right text-green-600">{r.resolved_on_time}</td>
                        <td className="py-2 text-right text-gray-500">{formatMinutes(r.avg_resolution_minutes)}</td>
                      </tr>
                    ))}
                    {sla.length === 0 && (
                      <tr><td colSpan={5} className="py-4 text-center text-gray-400 text-xs">No data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Category breakdown */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <BarChart2 size={16} className="text-purple-500" /> Category Breakdown
                </h2>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 uppercase">
                    <tr>
                      <th className="pb-2 text-left">Category</th>
                      <th className="pb-2 text-right">Total</th>
                      <th className="pb-2 text-right">Open</th>
                      <th className="pb-2 text-right">Breached</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {categories.map(r => (
                      <tr key={r.category}>
                        <td className="py-2 font-medium text-gray-700 capitalize">{r.category}</td>
                        <td className="py-2 text-right text-gray-600">{r.total}</td>
                        <td className="py-2 text-right text-gray-600">{r.open}</td>
                        <td className={`py-2 text-right font-medium ${r.breached > 0 ? "text-red-600" : "text-gray-400"}`}>{r.breached}</td>
                      </tr>
                    ))}
                    {categories.length === 0 && (
                      <tr><td colSpan={4} className="py-4 text-center text-gray-400 text-xs">No data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Owner workload */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <Users size={16} className="text-blue-500" /> Owner Workload
                </h2>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 uppercase">
                    <tr>
                      <th className="pb-2 text-left">Owner</th>
                      <th className="pb-2 text-right">Open</th>
                      <th className="pb-2 text-right">Urgent</th>
                      <th className="pb-2 text-right">Breached</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {owners.slice(0, 10).map(r => (
                      <tr key={r.assigned_to ?? "unassigned"}>
                        <td className="py-2 text-gray-700">{r.owner_name}</td>
                        <td className="py-2 text-right text-gray-600">{r.open}</td>
                        <td className={`py-2 text-right font-medium ${r.urgent_open > 0 ? "text-red-600" : "text-gray-400"}`}>{r.urgent_open}</td>
                        <td className={`py-2 text-right font-medium ${r.breached > 0 ? "text-red-600" : "text-gray-400"}`}>{r.breached}</td>
                      </tr>
                    ))}
                    {owners.length === 0 && (
                      <tr><td colSpan={4} className="py-4 text-center text-gray-400 text-xs">No data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Aging + Root causes */}
              <div className="space-y-4">
                {/* Aging */}
                {aging && (
                  <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                      <Clock size={16} className="text-orange-500" /> Open Ticket Aging
                    </h2>
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { label: "0–4h",   value: aging.bucket_0_4h,     color: "bg-green-100 text-green-700" },
                        { label: "4–24h",  value: aging.bucket_4_24h,    color: "bg-yellow-100 text-yellow-700" },
                        { label: "1–3d",   value: aging.bucket_1_3d,     color: "bg-orange-100 text-orange-700" },
                        { label: "3–7d",   value: aging.bucket_3_7d,     color: "bg-red-100 text-red-600" },
                        { label: ">7d",    value: aging.bucket_over_7d,  color: "bg-red-200 text-red-700" },
                      ].map(b => (
                        <div key={b.label} className={`rounded-lg p-3 text-center ${b.color}`}>
                          <div className="text-lg font-bold">{b.value ?? 0}</div>
                          <div className="text-xs">{b.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Root causes */}
                {rootCauses.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-yellow-500" /> Root Causes
                    </h2>
                    <ul className="space-y-1">
                      {rootCauses.slice(0, 8).map(r => (
                        <li key={r.root_cause} className="flex justify-between text-sm">
                          <span className="text-gray-600 truncate">{r.root_cause}</span>
                          <span className="font-medium text-gray-800 ml-2">{r.total}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── IT Depth Analysis ────────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Cpu size={16} className="text-blue-500" /> IT Ticket Depth Analysis
            </h2>
            <button
              onClick={() => void loadItAnalysis()}
              disabled={itLoading}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <RefreshCcw size={12} className={itLoading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>

          {itLoading ? (
            <div className="py-8 text-center text-gray-400 text-xs">Loading IT analysis…</div>
          ) : !itAnalysis || itAnalysis.summary.total_it_tickets === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No IT tickets in selected period.</div>
          ) : (
            <div className="space-y-6">
              {/* IT Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
                {[
                  { label: "IT Tickets", value: itAnalysis.summary.total_it_tickets, color: "text-blue-600 bg-blue-50" },
                  { label: "Total Downtime", value: `${Math.round((itAnalysis.summary.total_downtime_minutes ?? 0) / 60)}h ${(itAnalysis.summary.total_downtime_minutes ?? 0) % 60}m`, color: "text-red-600 bg-red-50" },
                  { label: "Seat Impacts", value: itAnalysis.summary.total_seat_impacts ?? 0, color: "text-orange-600 bg-orange-50" },
                  { label: "Branches Hit", value: itAnalysis.summary.branches_affected ?? 0, color: "text-purple-600 bg-purple-50" },
                  { label: "Avg Downtime/Ticket", value: `${itAnalysis.summary.avg_downtime_per_ticket ?? 0}m`, color: "text-amber-600 bg-amber-50" },
                  { label: "Avg Resolution", value: formatMinutes(itAnalysis.summary.avg_resolution_minutes), color: "text-green-600 bg-green-50" },
                  { label: "SLA Breached", value: itAnalysis.summary.sla_breached ?? 0, color: (itAnalysis.summary.sla_breached ?? 0) > 0 ? "text-red-700 bg-red-100" : "text-gray-400 bg-gray-50" },
                  { label: "Open IT Tickets", value: itAnalysis.summary.open_it_tickets ?? 0, color: (itAnalysis.summary.open_it_tickets ?? 0) > 0 ? "text-amber-700 bg-amber-50" : "text-gray-400 bg-gray-50" },
                ].map(k => (
                  <div key={k.label} className={`rounded-xl p-3 ${k.color}`}>
                    <div className="text-lg font-bold">{k.value}</div>
                    <div className="text-xs mt-0.5 opacity-70">{k.label}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Sub-category breakdown */}
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Sub-Category Impact</h3>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-400 uppercase border-b">
                      <tr>
                        <th className="pb-2 text-left">Sub-Category</th>
                        <th className="pb-2 text-right">Tickets</th>
                        <th className="pb-2 text-right">Downtime</th>
                        <th className="pb-2 text-right">Seats</th>
                        <th className="pb-2 text-right">Avg Res.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {itAnalysis.subcategory_breakdown.map(r => (
                        <tr key={r.subcategory}>
                          <td className="py-2 text-gray-700 font-medium capitalize text-xs">
                            {r.subcategory.replace(/_/g, " ")}
                          </td>
                          <td className="py-2 text-right text-gray-600">{r.total}</td>
                          <td className="py-2 text-right text-red-600 font-semibold">{r.total_downtime_minutes ?? 0}m</td>
                          <td className="py-2 text-right text-orange-600">{r.total_affected_seats ?? 0}</td>
                          <td className="py-2 text-right text-gray-400">{formatMinutes(r.avg_resolution_minutes)}</td>
                        </tr>
                      ))}
                      {itAnalysis.subcategory_breakdown.length === 0 && (
                        <tr><td colSpan={5} className="py-3 text-center text-gray-300 text-xs">No sub-category data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Branch impact */}
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Branch Impact</h3>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-400 uppercase border-b">
                      <tr>
                        <th className="pb-2 text-left">Branch</th>
                        <th className="pb-2 text-right">Tickets</th>
                        <th className="pb-2 text-right">Downtime</th>
                        <th className="pb-2 text-right">Seats</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {itAnalysis.branch_impact.map(r => (
                        <tr key={r.branch_name}>
                          <td className="py-2 text-gray-700 font-medium text-xs">{r.branch_name}</td>
                          <td className="py-2 text-right text-gray-600">{r.total_tickets}</td>
                          <td className="py-2 text-right text-red-600 font-semibold">{r.total_downtime_minutes ?? 0}m</td>
                          <td className="py-2 text-right text-orange-600">{r.total_affected_seats ?? 0}</td>
                        </tr>
                      ))}
                      {itAnalysis.branch_impact.length === 0 && (
                        <tr><td colSpan={4} className="py-3 text-center text-gray-300 text-xs">No branch data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recurring issues */}
              {itAnalysis.recurring_issues.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recurring Issues (Top 10)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {itAnalysis.recurring_issues.map(r => (
                      <div key={r.issue_label} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <span className="text-xs text-gray-700 font-medium capitalize truncate">{r.issue_label.replace(/_/g, " ")}</span>
                        <div className="flex gap-3 ml-2 shrink-0">
                          <span className="text-xs font-bold text-blue-600">{r.occurrences}×</span>
                          <span className="text-xs text-red-500">{r.total_downtime ?? 0}m DT</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Open Ticket Queue ─────────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Ticket size={16} className="text-indigo-500" /> Open Ticket Queue
              {queueTickets.length > 0 && (
                <span className="ml-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5">
                  {queueTickets.length}
                </span>
              )}
            </h2>
            <button
              onClick={() => void loadQueue()}
              disabled={queueLoading}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <RefreshCcw size={12} className={queueLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          {queueLoading ? (
            <div className="py-8 text-center text-gray-400 text-xs">Loading queue…</div>
          ) : queueTickets.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <CheckCircle2 size={24} className="text-emerald-400" />
              No open tickets — queue is clear!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[750px] text-sm">
                <thead className="text-xs text-gray-400 uppercase border-b">
                  <tr>
                    <th className="pb-2 text-left font-semibold">Ticket</th>
                    <th className="pb-2 text-left font-semibold">Category</th>
                    <th className="pb-2 text-left font-semibold">Priority</th>
                    <th className="pb-2 text-left font-semibold">SLA</th>
                    <th className="pb-2 text-left font-semibold">Agent</th>
                    <th className="pb-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {queueTickets.slice(0, 25).map(t => {
                    const isBusy = queueActionBusy === t.id;
                    const slaBadge = (() => {
                      if (t.sla_breached) return <span className="text-xs font-bold text-red-600">Breached</span>;
                      if (!t.sla_due_at) return <span className="text-xs text-gray-300">—</span>;
                      const minsLeft = Math.floor((new Date(t.sla_due_at).getTime() - Date.now()) / 60000);
                      if (minsLeft < 0)   return <span className="text-xs font-bold text-red-600">Breached</span>;
                      if (minsLeft <= 60) return <span className="text-xs font-semibold text-amber-600">&lt;1h</span>;
                      if (minsLeft <= 240) return <span className="text-xs text-yellow-600">{Math.round(minsLeft / 60)}h</span>;
                      return <span className="text-xs text-emerald-600">On Time</span>;
                    })();
                    return (
                      <tr key={t.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-gray-800 text-sm leading-tight line-clamp-1">{t.subject}</div>
                          <div className="text-gray-400 text-xs font-mono">
                            #{t.ticket_number ?? t.ticket_code ?? t.id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-gray-500 capitalize">{t.category}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded border capitalize ${PRIORITY_COLOR[t.priority] ?? ""}`}>
                            {t.priority}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">{slaBadge}</td>
                        <td className="py-2.5 pr-3 text-xs">
                          {t.assigned_name
                            ? <span className="text-gray-600">{t.assigned_name}</span>
                            : <span className="text-amber-600 font-semibold">Unassigned</span>
                          }
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <select
                              defaultValue=""
                              onChange={e => void doQueueAssign(t.id, e.target.value)}
                              disabled={isBusy}
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 bg-white cursor-pointer disabled:opacity-50"
                            >
                              <option value="">Assign…</option>
                              {queueAgents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                            </select>
                            <button
                              onClick={() => void doQueueTake(t.id)}
                              disabled={isBusy}
                              className="text-xs bg-indigo-50 text-indigo-700 rounded-lg px-2.5 py-1 font-semibold hover:bg-indigo-100 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              Take
                            </button>
                            <button
                              onClick={() => void doQueueEscalate(t.id)}
                              disabled={isBusy}
                              className="text-xs bg-red-50 text-red-600 rounded-lg px-2.5 py-1 font-semibold hover:bg-red-100 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              Escalate
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {queueTickets.length > 25 && (
                <p className="text-xs text-gray-400 text-center pt-3">
                  Showing 25 of {queueTickets.length} open tickets. Visit /helpdesk for full list.
                </p>
              )}
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}
