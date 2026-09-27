/**
 * Extracted from NativeExitCommandCenter.tsx (owner ruling 2026-09-26: split the 2600+
 * line page into smaller files). Shared types/consts/primitives live in ./shared.ts.
 */
import { AlertTriangle, Clock, Loader2, Percent, UserMinus } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS, KpiTile, REASON_COLORS, type CenterData } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Tab
// ─────────────────────────────────────────────────────────────────────────────
export function AnalyticsTab({
  data,
  loading,
}: {
  data: CenterData | null;
  loading: boolean;
}) {
  const trendData = data?.attrition_trend ?? [];
  const reasonData = data?.reason_breakdown ?? [];
  const branchData = data?.branch_breakdown ?? [];

  const avgAttritionRate =
    trendData.length > 0
      ? (trendData.reduce((s, d) => s + d.rate, 0) / trendData.length).toFixed(
          1,
        )
      : "0.0";

  const totalVoluntary = trendData.reduce((s, d) => s + d.voluntary, 0);
  const totalInvoluntary = trendData.reduce((s, d) => s + d.involuntary, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <span className="ml-2 text-slate-500">Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          title="Avg Attrition Rate"
          value={`${avgAttritionRate}%`}
          icon={<Percent className="w-5 h-5" />}
          note="Rolling 6 months"
          tone="red"
        />
        <KpiTile
          title="Voluntary Exits"
          value={totalVoluntary}
          icon={<UserMinus className="w-5 h-5" />}
          note="Resignations"
          tone="blue"
        />
        <KpiTile
          title="Involuntary Exits"
          value={totalInvoluntary}
          icon={<AlertTriangle className="w-5 h-5" />}
          note="Terminations"
          tone="amber"
        />
        <KpiTile
          title="Active Notices"
          value={data?.summary?.active_notice ?? 0}
          icon={<Clock className="w-5 h-5" />}
          note="Currently serving"
          tone="violet"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Attrition Trend */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                Attrition Trend
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Monthly exits over time
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" /> Voluntary
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" /> Involuntary
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={trendData}
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              />
              <Line
                type="monotone"
                dataKey="voluntary"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={false}
                name="Voluntary"
              />
              <Line
                type="monotone"
                dataKey="involuntary"
                stroke="#EF4444"
                strokeWidth={2}
                dot={false}
                name="Involuntary"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Attrition Rate Trend */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                Attrition Rate %
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Monthly percentage
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={trendData}
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
                formatter={(v: number) => [`${v.toFixed(1)}%`, "Rate"]}
              />
              <Bar dataKey="rate" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Exit Reasons */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800">Exit Reasons</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Distribution by category
            </p>
          </div>
          {reasonData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie
                    data={reasonData}
                    dataKey="count"
                    nameKey="reason"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {reasonData.map((entry, i) => (
                      <Cell
                        key={entry.reason}
                        fill={
                          REASON_COLORS[entry.reason] ??
                          CHART_COLORS[i % CHART_COLORS.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 max-h-44 overflow-y-auto">
                {reasonData.map((r, i) => (
                  <div
                    key={r.reason}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            REASON_COLORS[r.reason] ??
                            CHART_COLORS[i % CHART_COLORS.length],
                        }}
                      />
                      <span className="text-slate-600 capitalize">
                        {r.reason.replace(/_/g, " ")}
                      </span>
                    </span>
                    <span className="font-bold text-slate-800">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-slate-400">
              No reason data available
            </div>
          )}
        </div>

        {/* Branch Breakdown */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800">
              Branch Attrition
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Exits by location</p>
          </div>
          {branchData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={branchData.slice(0, 8)}
                layout="vertical"
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#f1f5f9"
                  horizontal={false}
                />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="branch"
                  tick={{ fontSize: 10 }}
                  width={80}
                />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="#3B82F6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-12 text-center text-sm text-slate-400">
              No branch data available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
