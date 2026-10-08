/**
 * Exit analytics. Built on the shared analytics-kit (same tiles/cards as AON & Attrition)
 * so both surfaces read as one system. Deeper tenure/cohort analysis lives in the
 * "AON & Attrition" insight tab.
 */
import { AlertTriangle, Clock, Percent, UserMinus } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_TICK,
  ChartCard,
  ChartSkeleton,
  EmptyState,
  GRID_PROPS,
  SERIES,
  StatTile,
  TOOLTIP_STYLE,
  num,
} from "@/components/analytics/analytics-kit";
import { CHART_COLORS, REASON_COLORS, reasonLabel, type CenterData } from "./shared";

const AON_ORDER = ["0-30", "31-60", "61-90", "90+"] as const;

export function AnalyticsTab({ data, loading }: { data: CenterData | null; loading: boolean }) {
  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <ChartSkeleton key={i} height={40} />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <ChartSkeleton key={i} height={220} />)}
        </div>
      </div>
    );
  }

  const trendData = data?.attrition_trend ?? [];
  const reasonData = data?.reason_breakdown ?? [];
  const branchData = (data?.branch_breakdown ?? []).slice(0, 8);
  const aonRaw = data?.aon_breakdown ?? [];
  const aonData = AON_ORDER.map((b) => {
    const r = aonRaw.find((x) => x.bucket === b);
    return { bucket: b, voluntary: Number(r?.voluntary ?? 0), involuntary: Number(r?.involuntary ?? 0), count: Number(r?.count ?? 0) };
  });
  const aonTotal = aonData.reduce((s, d) => s + d.count, 0);
  const early = aonData[0].count + aonData[1].count + aonData[2].count;

  const avgRate = trendData.length
    ? (trendData.reduce((s, d) => s + Number(d.rate), 0) / trendData.length).toFixed(1)
    : "0.0";
  const totalVoluntary = trendData.reduce((s, d) => s + Number(d.voluntary), 0);
  const totalInvoluntary = trendData.reduce((s, d) => s + Number(d.involuntary), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Avg attrition rate" value={`${avgRate}%`} denominator="Mean of last 6 months" intent="critical" icon={<Percent className="h-4 w-4" />} />
        <StatTile label="Voluntary exits" value={num(totalVoluntary)} denominator="Resignations, last 6 months" icon={<UserMinus className="h-4 w-4" />} />
        <StatTile label="Involuntary exits" value={num(totalInvoluntary)} denominator="Terminations, last 6 months" intent="warning" icon={<AlertTriangle className="h-4 w-4" />} />
        <StatTile label="Active notices" value={num(Number(data?.summary?.active_notice ?? 0))} denominator="Currently serving" icon={<Clock className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Exits by month" subtitle="Voluntary vs involuntary, last 6 months">
          {trendData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="voluntary" name="Voluntary" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="involuntary" name="Involuntary" stroke={SERIES[7]} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyState label="No exits in the last 6 months" />}
        </ChartCard>

        <ChartCard title="Attrition rate %" subtitle="Exits as % of active headcount, per month">
          {trendData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${Number(v).toFixed(2)}%`, "Rate"]} />
                <Bar dataKey="rate" fill={SERIES[4]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState label="No rate data" />}
        </ChartCard>

        <ChartCard
          title="Tenure at exit (AON)"
          subtitle="Days from joining to last working day, last 12 months"
          footer={
            <p className="text-[11px] text-slate-500">
              {aonTotal ? `${num(early)} of ${num(aonTotal)} leavers (${Math.round((early / aonTotal) * 100)}%) left within 90 days of joining.` : "No leavers with a joining date in scope."}
            </p>
          }
        >
          {aonTotal ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={aonData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="bucket" tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="voluntary" name="Voluntary" stackId="a" fill={SERIES[0]} isAnimationActive={false} />
                <Bar dataKey="involuntary" name="Involuntary" stackId="a" fill={SERIES[7]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState label="No tenure data" height={200} />}
        </ChartCard>

        <ChartCard title="Exit reasons" subtitle="Distribution by category, last 12 months">
          {reasonData.length ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie data={reasonData} dataKey="count" nameKey="reason" innerRadius={50} outerRadius={80} paddingAngle={2} isAnimationActive={false}>
                    {reasonData.map((e, i) => (
                      <Cell key={e.reason} fill={REASON_COLORS[e.reason] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="max-h-44 flex-1 space-y-1.5 overflow-y-auto">
                {reasonData.map((r, i) => (
                  <li key={r.reason} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: REASON_COLORS[r.reason] ?? CHART_COLORS[i % CHART_COLORS.length] }} />
                      {reasonLabel(r.reason)}
                    </span>
                    <span className="font-bold tabular-nums text-slate-800">{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <EmptyState label="No reason data" height={180} hint="Exit reason is often not captured at raise time" />}
        </ChartCard>

        <ChartCard title="Branch attrition" subtitle="Exits by location, last 6 months" className="lg:col-span-2">
          {branchData.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, branchData.length * 28)}>
              <BarChart data={branchData} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
                <YAxis type="category" dataKey="branch" tick={AXIS_TICK} width={110} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" name="Exits" fill={SERIES[0]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState label="No branch data" />}
        </ChartCard>
      </div>
    </div>
  );
}
