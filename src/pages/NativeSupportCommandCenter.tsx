import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, BarChart2, CheckCircle2, Clock,
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

type SupportCommandCenterData = {
  stats: DashboardStats;
  sla_summary: SlaPriorityRow[];
  category_breakdown: CategoryRow[];
  owner_workload: OwnerRow[];
  aging: AgingBuckets;
  root_causes: RootCauseRow[];
};

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

      if (res.data?.success) {
        setStats(res.data.data.stats);
        setSla(res.data.data.sla_summary ?? []);
        setCategories(res.data.data.category_breakdown ?? []);
        setOwners(res.data.data.owner_workload ?? []);
        setAging(res.data.data.aging ?? null);
        setRootCauses(res.data.data.root_causes ?? []);
      }
      setLastRefresh(formatISTTime());
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, to, category, priority, status]);

  useEffect(() => { load(); }, [load]);

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
            options={["hr","payroll","it","general","asset","attendance"]} />
          <SelectFilter label="Priority" value={priority} onChange={setPriority}
            options={["urgent","high","medium","low"]} />
          <SelectFilter label="Status" value={status} onChange={setStatus}
            options={["open","in_progress","pending_info","resolved","closed"]} />
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
      </div>
    </DashboardLayout>
  );
}
