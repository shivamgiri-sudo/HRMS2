import { useMemo } from "react";
import { Users, Target, Clock, AlertTriangle, TrendingUp, Award, Activity, Zap } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  AreaChart, Area, CartesianGrid
} from "recharts";

type AnyRow = Record<string, unknown>;

interface CoverTabProps {
  summary: AnyRow;
  queueRows: AnyRow[];
  branchTable: AnyRow[];
  processTable: AnyRow[];
  recruiterTable: AnyRow[];
  sourceTable: AnyRow[];
  dashboardRows: AnyRow[];
  loading?: boolean;
}

const COLORS = ["#0f172a", "#1e40af", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];

function n(v: unknown) { return Number(v || 0).toLocaleString("en-IN"); }
function pct(v: unknown) { return `${Number(v || 0).toFixed(1)}%`; }

export function CoverTab({ summary, queueRows, branchTable, processTable, recruiterTable, sourceTable, dashboardRows, loading }: CoverTabProps) {
  const slaBreachQueue = useMemo(
    () => queueRows.filter((r) => r.SLAFlag).slice(0, 5),
    [queueRows]
  );

  const topBranches = useMemo(
    () => (branchTable || []).slice(0, 6).map((b) => ({
      name: String(b.Name || ""),
      arrival: Number(b.TotalArrival || 0),
      selected: Number(b.Selection || 0),
    })),
    [branchTable]
  );

  const sourcePie = useMemo(
    () => (sourceTable || []).slice(0, 6).map((s) => ({
      name: String(s.Name || "Unknown"),
      value: Number(s.TotalArrival || 0),
    })),
    [sourceTable]
  );

  const trendData = useMemo(
    () => (dashboardRows || []).map((d) => ({
      period: String(d.Date || ""),
      arrivals: Number(d["Total Arrival"] || 0),
      selected: Number(d.Selection || 0),
      rejected: Number(d.Rejection || 0),
    })),
    [dashboardRows]
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
          <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI Row */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiTile icon={Users} label="Total Arrivals" value={n(summary.totalArrival)} color="bg-slate-900" />
        <KpiTile icon={Target} label="Selected" value={n(summary.totalSelection)} sub={pct(summary.selectionRate)} color="bg-emerald-600" />
        <KpiTile icon={Clock} label="Pending" value={n(summary.pending)} sub={`${n(summary.waiting)} waiting`} color="bg-amber-600" />
        <KpiTile icon={AlertTriangle} label="SLA Breach" value={n(summary.slaBreach)} sub={pct(summary.slaBreachRate)} color="bg-rose-600" />
        <KpiTile icon={TrendingUp} label="Avg Wait" value={`${Math.round(Number(summary.avgWaitMinutes || 0))}m`} color="bg-blue-600" />
        <KpiTile icon={Award} label="On Hold" value={n(summary.onHold)} color="bg-purple-600" />
        <KpiTile icon={Activity} label="Un-attended" value={n(summary.waiting)} color="bg-orange-600" />
        <KpiTile icon={Zap} label="Rejection" value={n(summary.totalRejection)} sub={pct(summary.rejectionRate)} color="bg-red-700" />
      </div>

      {/* SLA Breach Alert */}
      {slaBreachQueue.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-rose-800 mb-3">
            <AlertTriangle className="h-4 w-4" />
            SLA Breach — {slaBreachQueue.length} candidate{slaBreachQueue.length > 1 ? "s" : ""} waiting too long
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {slaBreachQueue.map((row, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-rose-200 bg-white px-3 py-2 text-xs">
                <span className="font-mono text-rose-700">{String(row.QToken || "-")}</span>
                <span className="truncate text-slate-700">{String(row.FullName || "")}</span>
                <span className="ml-auto font-bold text-rose-600">{Math.round(Number(row.WaitingMinutes || 0))}m</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Branch Performance */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Branch Performance</h3>
          {topBranches.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topBranches} layout="vertical" margin={{ left: 60 }}>
                <XAxis type="number" fontSize={11} stroke="#94a3b8" />
                <YAxis type="category" dataKey="name" fontSize={11} stroke="#94a3b8" width={60} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="arrival" name="Arrivals" fill="#1e40af" radius={[0, 4, 4, 0]} />
                <Bar dataKey="selected" name="Selected" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-slate-400">No branch data</div>
          )}
        </div>

        {/* Source Distribution */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Source Distribution</h3>
          {sourcePie.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={240}>
                <PieChart>
                  <Pie data={sourcePie} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" stroke="none">
                    {sourcePie.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {sourcePie.map((s, idx) => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[idx % COLORS.length] }} />
                    <span className="flex-1 truncate text-slate-700">{s.name}</span>
                    <span className="font-bold text-slate-900">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-slate-400">No source data</div>
          )}
        </div>
      </div>

      {/* Period Trends */}
      {trendData.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Period Comparison</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" fontSize={11} stroke="#94a3b8" />
              <YAxis fontSize={11} stroke="#94a3b8" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Area type="monotone" dataKey="arrivals" name="Arrivals" stroke="#1e40af" fill="#dbeafe" strokeWidth={2} />
              <Area type="monotone" dataKey="selected" name="Selected" stroke="#10b981" fill="#d1fae5" strokeWidth={2} />
              <Area type="monotone" dataKey="rejected" name="Rejected" stroke="#ef4444" fill="#fee2e2" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Process & Recruiter Tables side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-bold text-slate-800">Top Processes</h3>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Process</th>
                  <th className="text-right px-3 py-2 font-medium">Arrival</th>
                  <th className="text-right px-3 py-2 font-medium">Selected</th>
                  <th className="text-right px-3 py-2 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {(processTable || []).slice(0, 10).map((p, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800 truncate max-w-[140px]">{String(p.Name || "-")}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{n(p.TotalArrival)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-medium">{n(p.Selection)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{pct(p.SelectionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!processTable || processTable.length === 0) && (
              <p className="text-center text-xs text-slate-400 py-8">No process data</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-bold text-slate-800">Recruiter Productivity</h3>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Recruiter</th>
                  <th className="text-right px-3 py-2 font-medium">Sourced</th>
                  <th className="text-right px-3 py-2 font-medium">Sel%</th>
                  <th className="text-right px-3 py-2 font-medium">SLA%</th>
                </tr>
              </thead>
              <tbody>
                {(recruiterTable || []).slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800 truncate max-w-[140px]">{String(r.Recruiter || "-")}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{n(r.SourcedCount)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-medium">{pct(r.SelectionRate)}</td>
                    <td className="px-3 py-2 text-right text-blue-700 font-medium">{pct(r.SlaCompliancePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!recruiterTable || recruiterTable.length === 0) && (
              <p className="text-center text-xs text-slate-400 py-8">No recruiter data</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiTile({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color} text-white`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
        <p className="text-lg font-bold text-slate-900 leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}
