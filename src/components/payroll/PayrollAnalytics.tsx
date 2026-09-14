import { useMemo, useRef, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Building2,
  IndianRupee,
  Layers,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  usePayrollAnalytics,
  usePayrollEmployeeSearch,
  useEmployeeSalaryHistoryByCode,
  usePayrollTrends,
} from "@/hooks/usePayroll";
import { useDebounce } from "@/hooks/useDebounce";
import {
  AXIS_TICK,
  ChartCard,
  CoverageNote,
  EmptyState,
  GRID_PROPS,
  ProvenanceBar,
  SERIES,
  StatTile,
  TOOLTIP_STYLE,
  inr,
  inrShort,
  num,
  pct,
} from "@/components/analytics/analytics-kit";

const formatRunMonth = (value?: string | null) => {
  if (!value) return "Latest run";
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return String(value);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
};

/** How many dimension groups the charts show before folding the rest into "Other". */
const CHART_GROUPS = 8;

interface PayrollAnalyticsProps {
  availableMonths?: string[];
}

export function PayrollAnalytics({ availableMonths = [] }: PayrollAnalyticsProps) {
  const [runMonth, setRunMonth] = useState<string | undefined>(availableMonths[0]);
  const [dimension, setDimension] = useState<"department" | "branch" | "process">("department");

  // Employee salary lens state
  const [empSearchInput, setEmpSearchInput] = useState("");
  const [selectedEmpCode, setSelectedEmpCode] = useState<string | null>(null);
  const [selectedEmpName, setSelectedEmpName] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debouncedEmpSearch = useDebounce(empSearchInput.trim(), 300);
  const lensRef = useRef<HTMLDivElement>(null);

  const { data: empSuggestions = [], isFetching: empSearching } = usePayrollEmployeeSearch(debouncedEmpSearch);
  const { data: empHistory = [], isLoading: empHistoryLoading } = useEmployeeSalaryHistoryByCode(selectedEmpCode);

  const empPeak = empHistory.length > 0 ? Math.max(...empHistory.map((h) => h.netSalary)) : null;
  const empLatest = empHistory.length > 0 ? empHistory[empHistory.length - 1] : null;
  const empPrev = empHistory.length > 1 ? empHistory[empHistory.length - 2] : null;
  const empMomDelta = empLatest && empPrev ? empLatest.netSalary - empPrev.netSalary : null;
  const empMomPct =
    empMomDelta !== null && empPrev && empPrev.netSalary > 0 ? (empMomDelta / empPrev.netSalary) * 100 : null;

  const analyticsQuery = usePayrollAnalytics(runMonth, dimension);
  const trendsQuery = usePayrollTrends(6);

  const kpi = analyticsQuery.data?.kpi;
  const meta = analyticsQuery.data?.meta ?? null;
  const data = useMemo(() => analyticsQuery.data?.data ?? [], [analyticsQuery.data?.data]);
  const trendData = useMemo(() => trendsQuery.data ?? [], [trendsQuery.data]);
  const resolvedRunMonth = analyticsQuery.data?.runMonth ?? runMonth;
  const dimensionLabel = dimension.charAt(0).toUpperCase() + dimension.slice(1);
  const formattedRunMonth = formatRunMonth(resolvedRunMonth);

  /**
   * Charts show the top N groups and fold the remainder into an explicit "Other"
   * bar. Dropping the tail silently made the bars sum to less than the KPI total,
   * which is the first thing a reviewer notices and the hardest to defend.
   */
  const { chartRows, otherGroupCount, otherTotal, shownTotal } = useMemo(() => {
    const head = data.slice(0, CHART_GROUPS);
    const tail = data.slice(CHART_GROUPS);
    const tailNet = tail.reduce((sum, row) => sum + Number(row.total_net || 0), 0);
    const tailHeads = tail.reduce((sum, row) => sum + Number(row.headcount || 0), 0);
    const rows = tailNet > 0
      ? [...head, {
          dimension_name: `Other (${tail.length})`,
          total_net: tailNet,
          headcount: tailHeads,
          pct_of_total: tail.reduce((sum, row) => sum + Number(row.pct_of_total || 0), 0),
          isOther: true,
        }]
      : head;
    return {
      chartRows: rows,
      otherGroupCount: tail.length,
      otherTotal: tailNet,
      shownTotal: head.reduce((sum, row) => sum + Number(row.total_net || 0), 0),
    };
  }, [data]);

  const topContributor = data[0] ?? null;
  const latestTrend = trendData[trendData.length - 1] ?? null;
  const prevTrend = trendData.length > 1 ? trendData[trendData.length - 2] : null;
  const netMoM =
    latestTrend && prevTrend && prevTrend.total_net > 0
      ? ((latestTrend.total_net - prevTrend.total_net) / prevTrend.total_net) * 100
      : null;

  // Employer statutory load as a share of gross — the number finance actually asks for.
  const employerLoad = (kpi?.total_pf_employer ?? 0) + (kpi?.total_esic_employer ?? 0);
  const ctc = (kpi?.total_gross ?? 0) + employerLoad;
  const deductionRate =
    (kpi?.total_gross ?? 0) > 0 ? ((kpi?.total_deductions ?? 0) / (kpi?.total_gross ?? 1)) * 100 : null;

  if (analyticsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-[360px] rounded-xl" />
          <Skeleton className="h-[360px] rounded-xl" />
        </div>
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header + controls ─────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">Payroll Analytics</h2>
            {meta?.isProvisional && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                Provisional run
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Where payout volume sits, how gross converts to net, and how the last six runs moved.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {availableMonths.length > 0 && (
            <Select value={resolvedRunMonth ?? ""} onValueChange={(value) => setRunMonth(value || undefined)}>
              <SelectTrigger className="h-9 min-w-[170px] cursor-pointer rounded-lg border-slate-200 bg-white text-sm">
                <SelectValue placeholder="Select month" />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map((month) => (
                  <SelectItem key={month} value={month} className="cursor-pointer">
                    {formatRunMonth(month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={dimension} onValueChange={(value) => setDimension(value as typeof dimension)}>
            <SelectTrigger className="h-9 min-w-[150px] cursor-pointer rounded-lg border-slate-200 bg-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="department" className="cursor-pointer">By Department</SelectItem>
              <SelectItem value="branch" className="cursor-pointer">By Branch</SelectItem>
              <SelectItem value="process" className="cursor-pointer">By Process</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {/* Provenance — which run produced these figures. */}
      <ProvenanceBar
        items={[
          { label: "Period", value: formattedRunMonth },
          { label: "Run status", value: meta?.runStatus || "—", warn: meta?.isProvisional },
          {
            label: "Basis",
            value:
              meta && meta.otherRunsInMonth > 0
                ? `Canonical run · ${meta.otherRunsInMonth} other run${meta.otherRunsInMonth === 1 ? "" : "s"} in month excluded`
                : "Single run for month",
            warn: (meta?.otherRunsInMonth ?? 0) > 0,
          },
          { label: "Employees", value: num(kpi?.headcount ?? 0) },
          { label: "Grouped by", value: dimensionLabel },
        ]}
      />

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatTile
          label="Net Payout"
          value={inrShort(kpi?.total_net ?? 0)}
          denominator={`${num(kpi?.headcount ?? 0)} employees · ${formattedRunMonth}`}
          delta={netMoM}
          deltaLabel="vs prev month"
          intent="good"
          icon={<Wallet className="h-4 w-4" />}
          provisional={meta?.isProvisional}
        />
        <StatTile
          label="Gross Payroll"
          value={inrShort(kpi?.total_gross ?? 0)}
          denominator="Before employee deductions"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <StatTile
          label="Average Net"
          value={inr(kpi?.avg_net ?? 0)}
          denominator="Net ÷ distinct employees"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatTile
          label="Deductions"
          value={inrShort(kpi?.total_deductions ?? 0)}
          denominator={deductionRate !== null ? `${pct(deductionRate)} of gross` : "No gross recorded"}
          intent="warning"
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <StatTile
          label="Employer Load"
          value={inrShort(employerLoad)}
          denominator={`PF ${inrShort(kpi?.total_pf_employer ?? 0)} · ESIC ${inrShort(kpi?.total_esic_employer ?? 0)}`}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatTile
          label="Total Cost"
          value={inrShort(ctc)}
          denominator="Gross + employer statutory"
          icon={<Building2 className="h-4 w-4" />}
        />
      </div>

      {/* ── Gross → Net bridge + distribution ────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
        <ChartCard
          title={`Net Payout by ${dimensionLabel}`}
          subtitle={`Highest first. Bars sum to the ${inrShort(kpi?.total_net ?? 0)} net payout above.`}
          action={
            topContributor && (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                Top: {topContributor.dimension_name}
              </span>
            )
          }
          footer={
            <CoverageNote
              shownGroups={Math.min(CHART_GROUPS, data.length)}
              distinctGroups={data.length}
              shownRecords={Math.round(shownTotal)}
              otherGroups={otherGroupCount}
              otherRecords={Math.round(otherTotal)}
              unit="₹ net"
            />
          }
        >
          {chartRows.length === 0 ? (
            <EmptyState label="No payroll lines for this period" hint="Pick another month above." height={300} />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(260, chartRows.length * 40)}>
              <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 76, bottom: 4, left: 4 }}>
                <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} tickFormatter={inrShort} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="dimension_name"
                  width={130}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  formatter={(value: number, _n, item: any) => [
                    `${inr(value)} · ${num(item?.payload?.headcount ?? 0)} employees · ${pct(item?.payload?.pct_of_total ?? 0)} of total`,
                    "Net payout",
                  ]}
                  contentStyle={TOOLTIP_STYLE}
                />
                {/* Direct value labels: required relief for the low-contrast slots. */}
                <Bar dataKey="total_net" radius={[0, 4, 4, 0]} barSize={20} label={{
                  position: "right",
                  formatter: (v: number) => inrShort(v),
                  fontSize: 11,
                  fill: "#475569",
                  fontWeight: 600,
                }}>
                  {chartRows.map((row: any, index) => (
                    <Cell
                      key={`${row.dimension_name}-${index}`}
                      fill={row.isOther ? "#94a3b8" : SERIES[index % SERIES.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Payroll Composition"
          subtitle="How gross salary converts to take-home, and what it costs the employer."
        >
          {(kpi?.total_gross ?? 0) === 0 ? (
            <EmptyState label="No composition data" height={300} />
          ) : (
            <div className="space-y-3">
              {/*
                A composition bar rather than a pie: parts of a whole that must
                reconcile exactly, read against a common baseline. Basic and
                allowances sum to gross by construction (allowances = gross − basic).
              */}
              {[
                {
                  label: "Basic",
                  value: kpi?.total_basic ?? 0,
                  base: kpi?.total_gross ?? 0,
                  color: SERIES[0],
                  note: "of gross",
                },
                {
                  label: "Allowances & other earnings",
                  value: Math.max(0, (kpi?.total_gross ?? 0) - (kpi?.total_basic ?? 0)),
                  base: kpi?.total_gross ?? 0,
                  color: SERIES[2],
                  note: "of gross",
                },
                {
                  label: "Employee deductions",
                  value: kpi?.total_deductions ?? 0,
                  base: kpi?.total_gross ?? 0,
                  color: SERIES[1],
                  note: "of gross",
                },
                {
                  label: "Net take-home",
                  value: kpi?.total_net ?? 0,
                  base: kpi?.total_gross ?? 0,
                  color: SERIES[5],
                  note: "of gross",
                },
                {
                  label: "Employer PF + ESIC",
                  value: employerLoad,
                  base: kpi?.total_gross ?? 0,
                  color: SERIES[6],
                  note: "on top of gross",
                },
              ].map((row) => {
                const share = row.base > 0 ? (row.value / row.base) * 100 : 0;
                return (
                  <div key={row.label}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                        {row.label}
                      </span>
                      <span className="shrink-0 text-xs font-bold tabular-nums text-slate-900">
                        {inrShort(row.value)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-[width] duration-300"
                          style={{ width: `${Math.min(100, share)}%`, backgroundColor: row.color }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
                        {pct(share)} {row.note}
                      </span>
                    </div>
                  </div>
                );
              })}

              <div className="mt-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                Basic + allowances = gross by construction. Gross − deductions ={" "}
                <strong className="font-semibold text-slate-800">{inrShort(kpi?.total_net ?? 0)}</strong> net.
                Employer PF/ESIC sits on top of gross and is not deducted from employees.
              </div>
            </div>
          )}
        </ChartCard>
      </div>

      {/* ── Six-run trend ─────────────────────────────────────────────────── */}
      <ChartCard
        title="Payroll Trend — Last 6 Runs"
        subtitle="One canonical run per month, matching the figures above. Headcount is plotted as a line to keep a single value axis for money."
        action={
          latestTrend && (
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                Latest net {inrShort(latestTrend.total_net)}
              </span>
              {netMoM !== null && (
                <span
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                    netMoM >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {netMoM >= 0 ? "+" : ""}
                  {netMoM.toFixed(1)}% MoM
                </span>
              )}
            </div>
          )
        }
      >
        {trendsQuery.isLoading ? (
          <Skeleton className="h-[280px] rounded-lg" />
        ) : trendData.length === 0 ? (
          <EmptyState label="No completed payroll runs yet" height={280} />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={290}>
              <ComposedChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="netTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[5]} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={SERIES[5]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month_label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                {/*
                  A single value axis. Gross, net and deductions are all rupees, so
                  they share it; headcount is normalised into the same space via the
                  tooltip rather than a second y-scale (dual axes distort comparison).
                */}
                <YAxis tick={AXIS_TICK} tickFormatter={inrShort} axisLine={false} tickLine={false} width={64} />
                <Tooltip
                  cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number, name: string) => {
                    if (name === "Headcount") return [num(value), name];
                    return [inr(value), name];
                  }}
                  labelFormatter={(label, payload) => {
                    const row: any = payload?.[0]?.payload;
                    return `${label}${row?.is_provisional ? " · provisional run" : ""} · ${num(row?.headcount ?? 0)} employees`;
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Area
                  type="monotone"
                  dataKey="total_net"
                  name="Net payout"
                  stroke={SERIES[5]}
                  strokeWidth={2}
                  fill="url(#netTrendFill)"
                  dot={{ r: 3, strokeWidth: 0, fill: SERIES[5] }}
                  activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="total_gross"
                  name="Gross"
                  stroke={SERIES[0]}
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 0, fill: SERIES[0] }}
                  activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                />
                <Bar dataKey="total_deductions" name="Deductions" fill={SERIES[1]} barSize={14} radius={[3, 3, 0, 0]} opacity={0.75} />
                {latestTrend?.is_provisional && (
                  <ReferenceLine
                    x={latestTrend.month_label}
                    stroke="#eda100"
                    strokeDasharray="4 3"
                    label={{ value: "provisional", position: "top", fontSize: 10, fill: "#a16207" }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>

            {/* Table view — required relief for low-contrast slots, and the thing finance exports. */}
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="px-3 py-2 text-left font-semibold">Month</th>
                    <th className="px-3 py-2 text-right font-semibold">Employees</th>
                    <th className="px-3 py-2 text-right font-semibold">Gross</th>
                    <th className="px-3 py-2 text-right font-semibold">Deductions</th>
                    <th className="px-3 py-2 text-right font-semibold">Net</th>
                    <th className="px-3 py-2 text-right font-semibold">MoM Net</th>
                  </tr>
                </thead>
                <tbody>
                  {trendData.map((row, index) => {
                    const prev = index > 0 ? trendData[index - 1] : null;
                    const delta = prev && prev.total_net > 0 ? ((row.total_net - prev.total_net) / prev.total_net) * 100 : null;
                    return (
                      <tr key={row.run_month} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {row.month_label}
                          {row.is_provisional && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1 py-px text-[9px] font-bold text-amber-700">
                              PROV
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(row.headcount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{inrShort(row.total_gross)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-orange-700">−{inrShort(row.total_deductions)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{inrShort(row.total_net)}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            delta === null ? "text-slate-300" : delta > 0 ? "text-emerald-700" : delta < 0 ? "text-rose-600" : "text-slate-400"
                          }`}
                        >
                          {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ChartCard>

      {/* ── Employee salary lens ──────────────────────────────────────────── */}
      <ChartCard
        title="Employee Salary Lens"
        subtitle="Search an employee by name or code for their full salary history and month-on-month movement."
        action={
          selectedEmpCode && (
            <button
              type="button"
              onClick={() => {
                setSelectedEmpCode(null);
                setSelectedEmpName(null);
                setEmpSearchInput("");
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )
        }
      >
        <div className="space-y-4">
          <div className="relative max-w-md" ref={lensRef}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Employee name or code…"
              className="h-9 rounded-lg border-slate-200 bg-white pl-9 text-sm"
              value={empSearchInput}
              onChange={(e) => {
                setEmpSearchInput(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 160)}
            />
            {showSuggestions && (empSearching || empSuggestions.length > 0) && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {empSearching ? (
                  <div className="px-3 py-2.5 text-sm text-slate-400">Searching…</div>
                ) : (
                  empSuggestions.map((s) => (
                    <button
                      key={s.employeeId}
                      type="button"
                      className="flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-50"
                      onMouseDown={() => {
                        setSelectedEmpCode(s.employeeCode);
                        setSelectedEmpName(s.name);
                        setEmpSearchInput(s.name);
                        setShowSuggestions(false);
                      }}
                    >
                      <span className="text-sm font-medium text-slate-900">{s.name}</span>
                      <span className="text-[11px] text-slate-400">
                        {s.employeeCode}
                        {s.branch ? ` · ${s.branch}` : ""}
                        {s.process ? ` › ${s.process}` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {!selectedEmpCode ? (
            <EmptyState label="Search for an employee to see their salary trend" height={120} />
          ) : empHistoryLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-[200px] rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
            </div>
          ) : empHistory.length === 0 ? (
            <EmptyState label={`No payroll records found for ${selectedEmpName}`} height={100} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile
                  label="Latest Net"
                  value={inr(empLatest!.netSalary)}
                  denominator={empLatest!.monthLabel}
                  intent="good"
                />
                <StatTile
                  label="Peak Net"
                  value={inr(empPeak!)}
                  denominator={empHistory.find((h) => h.netSalary === empPeak)?.monthLabel}
                />
                <StatTile
                  label="MoM Change"
                  value={empMomDelta !== null ? `${empMomDelta > 0 ? "+" : ""}${inrShort(empMomDelta)}` : "—"}
                  denominator={empPrev ? `vs ${empPrev.monthLabel}` : "No prior month"}
                  delta={empMomPct}
                  intent={empMomDelta === null ? "neutral" : empMomDelta > 0 ? "good" : empMomDelta < 0 ? "critical" : "neutral"}
                />
                <StatTile
                  label="Months on Record"
                  value={num(empHistory.length)}
                  denominator={`${empHistory[0]?.monthLabel} → ${empLatest!.monthLabel}`}
                  icon={<Layers className="h-4 w-4" />}
                />
              </div>

              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={empHistory} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="empNetFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="monthLabel" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} tickFormatter={inrShort} axisLine={false} tickLine={false} width={60} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [inr(v), name]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Area
                    type="monotone"
                    dataKey="netSalary"
                    name="Net take-home"
                    stroke={SERIES[0]}
                    strokeWidth={2}
                    fill="url(#empNetFill)"
                    dot={{ r: 3, strokeWidth: 0, fill: SERIES[0] }}
                    activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="basic"
                    name="Basic"
                    stroke={SERIES[2]}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200 text-slate-600">
                      <th className="px-3 py-2 text-left font-semibold">Month</th>
                      <th className="px-3 py-2 text-right font-semibold">Basic</th>
                      <th className="px-3 py-2 text-right font-semibold">Allowances</th>
                      <th className="px-3 py-2 text-right font-semibold">Deductions</th>
                      <th className="px-3 py-2 text-right font-semibold">Net</th>
                      <th className="px-3 py-2 text-right font-semibold">MoM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...empHistory].reverse().map((h, i, arr) => {
                      const prev = arr[i + 1];
                      const delta = prev ? h.netSalary - prev.netSalary : null;
                      return (
                        <tr key={h.runMonth} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                          <td className="px-3 py-2 font-medium text-slate-800">{h.monthLabel}</td>
                          {/*
                            These read totalAllowances/totalDeductions. The previous
                            code read `h.allowances` / `h.deductions`, which the hook
                            never returns — both columns rendered "RsNaN" in production.
                          */}
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{inrShort(h.basic)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                            +{inrShort(h.totalAllowances)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-orange-700">
                            −{inrShort(h.totalDeductions)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                            {inrShort(h.netSalary)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${
                              delta === null ? "text-slate-300" : delta > 0 ? "text-emerald-700" : delta < 0 ? "text-rose-600" : "text-slate-400"
                            }`}
                          >
                            {delta === null ? "—" : `${delta > 0 ? "+" : ""}${inrShort(delta)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </ChartCard>

      {/* ── Dimension ledger ──────────────────────────────────────────────── */}
      <ChartCard
        title={`${dimensionLabel} Ledger`}
        subtitle="Every group, uncapped — the reconciliation view behind the charts above."
        action={
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {num(data.length)} groups
          </span>
        }
      >
        {data.length === 0 ? (
          <EmptyState label="No payroll lines for this period" height={160} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">{dimensionLabel}</th>
                  <th className="px-3 py-2 text-right font-semibold">Employees</th>
                  <th className="px-3 py-2 text-right font-semibold">Gross</th>
                  <th className="px-3 py-2 text-right font-semibold">Average Net</th>
                  <th className="px-3 py-2 text-right font-semibold">Total Net</th>
                  <th className="px-3 py-2 text-right font-semibold">Share of Net</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, index) => (
                  <tr key={`${row.dimension_name}-${index}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2 font-medium text-slate-800">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: index < CHART_GROUPS ? SERIES[index % SERIES.length] : "#94a3b8" }}
                        />
                        {row.dimension_name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(row.headcount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{inrShort(row.total_gross)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{inr(row.avg_net ?? 0)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{inrShort(row.total_net)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, row.pct_of_total ?? 0)}%`,
                              backgroundColor: index < CHART_GROUPS ? SERIES[index % SERIES.length] : "#94a3b8",
                            }}
                          />
                        </div>
                        <span className="w-12 text-right font-semibold tabular-nums text-slate-600">
                          {pct(row.pct_of_total ?? 0)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(kpi?.headcount ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inrShort(kpi?.total_gross ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(kpi?.avg_net ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inrShort(kpi?.total_net ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">100.0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
