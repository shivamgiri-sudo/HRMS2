import { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Building2,
  IndianRupee,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePayrollAnalytics, usePayrollEmployeeSearch, useEmployeeSalaryHistoryByCode, usePayrollTrends } from "@/hooks/usePayroll";
import { useDebounce } from "@/hooks/useDebounce";

const fmt = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const fmtShort = (value: number) => {
  if (value >= 10_000_000) return `Rs${(value / 10_000_000).toFixed(1)}Cr`;
  if (value >= 100_000) return `Rs${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `Rs${(value / 1_000).toFixed(0)}K`;
  return `Rs${Math.round(value)}`;
};

const formatRunMonth = (value?: string | null) => {
  if (!value) return "Latest run";
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return String(value);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
};

const COLORS = ["#0f766e", "#0891b2", "#2563eb", "#16a34a", "#f59e0b", "#ea580c", "#db2777", "#7c3aed"];

const KPI_TONES = {
  teal: "border-teal-100 bg-[linear-gradient(135deg,#f0fdfa_0%,#ccfbf1_100%)] text-teal-700",
  blue: "border-sky-100 bg-[linear-gradient(135deg,#f0f9ff_0%,#dbeafe_100%)] text-sky-700",
  green: "border-emerald-100 bg-[linear-gradient(135deg,#ecfdf5_0%,#d1fae5_100%)] text-emerald-700",
  amber: "border-amber-100 bg-[linear-gradient(135deg,#fffbeb_0%,#fde68a_100%)] text-amber-700",
  slate: "border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#e2e8f0_100%)] text-slate-700",
} as const;

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
  const empMomPct = empMomDelta !== null && empPrev && empPrev.netSalary > 0 ? (empMomDelta / empPrev.netSalary) * 100 : null;

  const analyticsQuery = usePayrollAnalytics(runMonth, dimension);
  const trendsQuery = usePayrollTrends(6);

  const kpi = analyticsQuery.data?.kpi;
  const data = useMemo(() => analyticsQuery.data?.data ?? [], [analyticsQuery.data?.data]);
  const trendData = useMemo(() => trendsQuery.data ?? [], [trendsQuery.data]);
  const resolvedRunMonth = analyticsQuery.data?.runMonth ?? runMonth;
  const dimensionLabel = dimension.charAt(0).toUpperCase() + dimension.slice(1);
  const formattedRunMonth = formatRunMonth(resolvedRunMonth);

  const chartRows = useMemo(() => data.slice(0, 8), [data]);
  const distributionRows = useMemo(() => data.slice(0, 6), [data]);
  const topContributor = data[0] ?? null;
  const latestTrend = trendData[trendData.length - 1] ?? null;

  const kpiCards = [
    {
      label: "Total Net",
      value: fmt(kpi?.total_net ?? 0),
      meta: formattedRunMonth,
      tone: KPI_TONES.teal,
      icon: <Wallet className="h-4 w-4" />,
    },
    {
      label: "Headcount",
      value: String(kpi?.headcount ?? 0),
      meta: `${data.length || 0} ${dimension} groups`,
      tone: KPI_TONES.blue,
      icon: <Users className="h-4 w-4" />,
    },
    {
      label: "Average Net",
      value: fmt(kpi?.avg_net ?? 0),
      meta: "Per employee payout",
      tone: KPI_TONES.green,
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      label: "Gross Payroll",
      value: fmt(kpi?.total_gross ?? 0),
      meta: "Before deductions",
      tone: KPI_TONES.slate,
      icon: <IndianRupee className="h-4 w-4" />,
    },
    {
      label: "Employer PF",
      value: fmt(kpi?.total_pf_employer ?? 0),
      meta: "Employer statutory load",
      tone: KPI_TONES.amber,
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    {
      label: "Employer ESIC",
      value: fmt(kpi?.total_esic_employer ?? 0),
      meta: "Employer statutory load",
      tone: KPI_TONES.slate,
      icon: <Building2 className="h-4 w-4" />,
    },
  ];

  if (analyticsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-3xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-[360px] rounded-2xl" />
          <Skeleton className="h-[360px] rounded-2xl" />
        </div>
        <Skeleton className="h-[320px] rounded-2xl" />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden rounded-3xl border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ecfeff_42%,#f0fdf4_100%)] shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Payroll Analytics
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              Payroll mix for {formattedRunMonth}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Same payroll logic, clearer readout. This view shows where payout volume sits, how gross converts to net, and how the last six runs are trending.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {availableMonths.length > 0 && (
              <Select
                value={resolvedRunMonth ?? ""}
                onValueChange={(value) => setRunMonth(value || undefined)}
              >
                <SelectTrigger className="h-10 min-w-[180px] rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {availableMonths.map((month) => (
                    <SelectItem key={month} value={month}>
                      {formatRunMonth(month)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select
              value={dimension}
              onValueChange={(value) => setDimension(value as typeof dimension)}
            >
              <SelectTrigger className="h-10 min-w-[160px] rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="department">By Department</SelectItem>
                <SelectItem value="branch">By Branch</SelectItem>
                <SelectItem value="process">By Process</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpiCards.map((card) => (
          <div key={card.label} className={`rounded-2xl border p-4 shadow-sm ${card.tone}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {card.label}
                </p>
                <p className="mt-2 text-lg font-bold text-slate-950">{card.value}</p>
                <p className="mt-1 text-xs text-slate-600">{card.meta}</p>
              </div>
              <div className="rounded-xl bg-white/80 p-2 shadow-sm text-slate-700">{card.icon}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base font-bold text-slate-950">
                  Net Salary by {dimensionLabel}
                </CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  Highest payout groups first. The chart is capped to the top eight for faster scanning.
                </p>
              </div>
              {topContributor && (
                <Badge variant="outline" className="w-fit text-xs font-semibold">
                  Top contributor: {topContributor.dimension_name}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {chartRows.length === 0 ? (
              <div className="flex h-[320px] items-center justify-center text-sm text-slate-400">
                No data for this period
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={Math.max(280, chartRows.length * 42)}>
                  <BarChart
                    data={chartRows}
                    layout="vertical"
                    margin={{ top: 4, right: 20, bottom: 4, left: 4 }}
                  >
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtShort} />
                    <YAxis type="category" dataKey="dimension_name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => [fmt(value), "Net salary"]}
                      contentStyle={{ borderRadius: 14, borderColor: "#cbd5e1", fontSize: 12 }}
                    />
                    <Bar dataKey="total_net" radius={[0, 10, 10, 0]}>
                      {chartRows.map((row, index) => (
                        <Cell key={`${row.dimension_name}-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  {chartRows.slice(0, 3).map((row, index) => (
                    <div key={`${row.dimension_name}-summary`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{row.dimension_name}</p>
                          <p className="mt-1 text-xs text-slate-500">{row.headcount} employees</p>
                        </div>
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{fmt(row.total_net)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-slate-950">
              Distribution Snapshot
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Share of total net payroll across the top visible {dimension} groups.
            </p>
          </CardHeader>
          <CardContent>
            {distributionRows.length === 0 ? (
              <div className="flex h-[320px] items-center justify-center text-sm text-slate-400">
                No data for this period
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
                <div className="relative mx-auto h-[220px] w-full max-w-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distributionRows}
                        dataKey="total_net"
                        nameKey="dimension_name"
                        innerRadius={62}
                        outerRadius={92}
                        paddingAngle={3}
                      >
                        {distributionRows.map((row, index) => (
                          <Cell key={`${row.dimension_name}-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [fmt(value), name]}
                        contentStyle={{ borderRadius: 14, borderColor: "#cbd5e1", fontSize: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Total Net
                    </p>
                    <p className="mt-1 text-center text-lg font-bold text-slate-950">
                      {fmtShort(kpi?.total_net ?? 0)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {distributionRows.map((row, index) => (
                    <div key={`${row.dimension_name}-share`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          <p className="text-sm font-semibold text-slate-900">{row.dimension_name}</p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {(row.pct_of_total ?? 0).toFixed(1)}%
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                        <span>{row.headcount} employees</span>
                        <span>{fmt(row.total_net)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base font-bold text-slate-950">
                Six-Month Trend
              </CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Gross versus net payroll movement across the last six active runs.
              </p>
            </div>
            {latestTrend && (
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">Latest gross {fmtShort(latestTrend.total_gross)}</Badge>
                <Badge variant="outline" className="text-xs">Latest net {fmtShort(latestTrend.total_net)}</Badge>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {trendsQuery.isLoading ? (
            <Skeleton className="h-[260px] rounded-xl" />
          ) : trendData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">
              No trend data available yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="grossArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.26} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.04} />
                  </linearGradient>
                  <linearGradient id="netArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="month_label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShort} />
                <Tooltip
                  formatter={(value: number, name: string) => [fmt(value), name === "total_gross" ? "Gross salary" : "Net salary"]}
                  contentStyle={{ borderRadius: 14, borderColor: "#cbd5e1", fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="total_gross"
                  stroke="#0ea5e9"
                  strokeWidth={2.5}
                  fill="url(#grossArea)"
                />
                <Area
                  type="monotone"
                  dataKey="total_net"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#netArea)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Employee Salary Lens ───────────────────────────────────────────── */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-base font-bold text-slate-950">Employee Salary Lens</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Search any employee by name or code and see their full salary history and month-on-month trend.
              </p>
            </div>
            {selectedEmpCode && (
              <button
                type="button"
                onClick={() => { setSelectedEmpCode(null); setSelectedEmpName(null); setEmpSearchInput(""); }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative" ref={lensRef}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Type employee name or code..."
              className="h-10 rounded-xl border-slate-200 bg-white pl-10 text-sm shadow-sm"
              value={empSearchInput}
              onChange={(e) => { setEmpSearchInput(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 160)}
            />
            {showSuggestions && (empSearching || empSuggestions.length > 0) && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
                {empSearching ? (
                  <div className="px-4 py-3 text-sm text-slate-400">Searching…</div>
                ) : (
                  empSuggestions.map((s) => (
                    <button
                      key={s.employeeId}
                      type="button"
                      className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl"
                      onMouseDown={() => {
                        setSelectedEmpCode(s.employeeCode);
                        setSelectedEmpName(s.name);
                        setEmpSearchInput(s.name);
                        setShowSuggestions(false);
                      }}
                    >
                      <span className="text-sm font-medium text-slate-900">{s.name}</span>
                      <span className="text-xs text-slate-400">
                        {s.employeeCode}{s.branch ? ` · ${s.branch}` : ""}{s.process ? ` › ${s.process}` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {!selectedEmpCode ? (
            <div className="flex h-[120px] items-center justify-center text-sm text-slate-400">
              Search for an employee above to see their salary trend
            </div>
          ) : empHistoryLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-[200px] rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : empHistory.length === 0 ? (
            <div className="flex h-[100px] items-center justify-center text-sm text-slate-400">
              No payroll records found for {selectedEmpName}
            </div>
          ) : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Latest Net</p>
                  <p className="mt-1 text-base font-bold text-slate-950">{fmt(empLatest!.netSalary)}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{empLatest!.monthLabel}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Peak Net</p>
                  <p className="mt-1 text-base font-bold text-slate-950">{fmt(empPeak!)}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{empHistory.find((h) => h.netSalary === empPeak)?.monthLabel}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">MoM Change</p>
                  {empMomDelta !== null ? (
                    <p className={`mt-1 text-base font-bold ${empMomDelta > 0 ? "text-emerald-600" : empMomDelta < 0 ? "text-red-500" : "text-slate-500"}`}>
                      {empMomDelta > 0 ? "+" : ""}{fmt(empMomDelta)}
                    </p>
                  ) : (
                    <p className="mt-1 text-base font-bold text-slate-300">—</p>
                  )}
                  {empMomPct !== null && (
                    <p className={`mt-0.5 flex items-center gap-0.5 text-xs font-medium ${empMomPct > 0 ? "text-emerald-600" : empMomPct < 0 ? "text-red-500" : "text-slate-400"}`}>
                      {empMomPct > 0 ? <TrendingUp className="h-3 w-3" /> : empMomPct < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                      {empMomPct > 0 ? "+" : ""}{empMomPct.toFixed(1)}%
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Months</p>
                  <p className="mt-1 text-base font-bold text-slate-950">{empHistory.length}</p>
                  <p className="mt-0.5 text-xs text-slate-400">on payroll record</p>
                </div>
              </div>

              {/* Trend chart */}
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={empHistory} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="empNetGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtShort} width={56} />
                  <Tooltip
                    formatter={(v: number, name: string) => [fmt(v), name === "netSalary" ? "Net salary" : name === "basic" ? "Basic" : "Deductions"]}
                    contentStyle={{ borderRadius: 12, borderColor: "#cbd5e1", fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="basic" stroke="#94a3b8" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="netSalary" stroke="#6366f1" strokeWidth={2.5} fill="url(#empNetGrad)" dot={{ r: 3, fill: "#6366f1" }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-slate-400 -mt-2">Dashed line = basic salary · solid line = net take-home</p>

              {/* Monthly breakdown table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Month</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Basic</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Allowances</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Deductions</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Net</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">MoM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...empHistory].reverse().map((h, i, arr) => {
                      const prev = arr[i + 1];
                      const delta = prev ? h.netSalary - prev.netSalary : null;
                      return (
                        <tr key={h.runMonth} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                          <td className="px-3 py-2 font-medium text-slate-700">{h.monthLabel}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtShort(h.basic)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-600">+{fmtShort(h.allowances)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-500">-{fmtShort(h.deductions)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{fmtShort(h.netSalary)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${delta === null ? "text-slate-300" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-slate-400"}`}>
                            {delta === null ? "—" : `${delta > 0 ? "+" : ""}${fmtShort(delta)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Dimension Summary Table ─────────────────────────────────────────── */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-slate-950">
            {dimensionLabel} Summary
          </CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Compact ledger view for audit and quick comparisons.
          </p>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">No data for this period</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 bg-slate-50">
                    <TableHead className="text-xs font-semibold">{dimensionLabel}</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Headcount</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Average Net</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Total Net</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row, index) => (
                    <TableRow key={`${row.dimension_name}-${index}`} className="border-slate-100">
                      <TableCell className="font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          {row.dimension_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{row.headcount}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(row.avg_net ?? 0)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">{fmt(row.total_net)}</TableCell>
                      <TableCell className="min-w-[180px]">
                        <div className="flex items-center justify-end gap-3">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, row.pct_of_total ?? 0)}%`,
                                backgroundColor: COLORS[index % COLORS.length],
                              }}
                            />
                          </div>
                          <span className="w-12 text-right text-xs font-semibold text-slate-600">
                            {(row.pct_of_total ?? 0).toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
