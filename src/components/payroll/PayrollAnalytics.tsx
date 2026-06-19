import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line,
  PieChart, Pie, Cell,
  ResponsiveContainer,
} from "recharts";
import {
  Users, IndianRupee, TrendingUp, ShieldCheck, Building2, BarChart2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  usePayrollAnalytics,
  usePayrollTrends,
} from "@/hooks/usePayroll";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);

const fmtShort = (n: number) => {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
};

const CHART_COLORS = [
  "#1B6AB5", "#3BAD49", "#F59E0B", "#E11D48",
  "#0891B2", "#4F46E5", "#10B981", "#F97316",
];

const TONE_MAP: Record<string, { card: string; icon: string }> = {
  sky:     { card: "border-sky-100 bg-gradient-to-br from-white to-sky-50",         icon: "bg-sky-50 text-sky-700 ring-sky-100"           },
  emerald: { card: "border-emerald-100 bg-gradient-to-br from-white to-emerald-50", icon: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  indigo:  { card: "border-indigo-100 bg-gradient-to-br from-white to-indigo-50",   icon: "bg-indigo-50 text-indigo-700 ring-indigo-100"   },
  amber:   { card: "border-amber-100 bg-gradient-to-br from-white to-amber-50",     icon: "bg-amber-50 text-amber-700 ring-amber-100"       },
  rose:    { card: "border-rose-100 bg-gradient-to-br from-white to-rose-50",       icon: "bg-rose-50 text-rose-700 ring-rose-100"           },
  slate:   { card: "border-slate-100 bg-gradient-to-br from-white to-slate-50",     icon: "bg-slate-50 text-slate-700 ring-slate-100"       },
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface PayrollAnalyticsProps {
  availableMonths?: string[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PayrollAnalytics({ availableMonths = [] }: PayrollAnalyticsProps) {
  const [runMonth, setRunMonth]   = useState<string | undefined>(availableMonths[0]);
  const [dimension, setDimension] = useState<"department" | "branch" | "process">("department");

  const analyticsQuery = usePayrollAnalytics(runMonth, dimension);
  const trendsQuery    = usePayrollTrends(6);

  const kpi  = analyticsQuery.data?.kpi;
  const data = analyticsQuery.data?.data ?? [];
  const resolvedRunMonth = analyticsQuery.data?.runMonth ?? runMonth;

  const dimLabel = dimension.charAt(0).toUpperCase() + dimension.slice(1);

  const kpiCards = [
    { label: "Total Net Payroll", value: fmt(kpi?.total_net ?? 0),          icon: <IndianRupee className="h-5 w-5" />, tone: "sky"     },
    { label: "Headcount",         value: String(kpi?.headcount ?? 0),       icon: <Users className="h-5 w-5" />,      tone: "emerald" },
    { label: "Avg Net Salary",    value: fmt(kpi?.avg_net ?? 0),            icon: <TrendingUp className="h-5 w-5" />, tone: "indigo"  },
    { label: "PF Employer",       value: fmt(kpi?.total_pf_employer ?? 0),  icon: <ShieldCheck className="h-5 w-5" />,tone: "amber"   },
    { label: "ESIC Employer",     value: fmt(kpi?.total_esic_employer ?? 0),icon: <Building2 className="h-5 w-5" />,  tone: "rose"    },
    {
      label: "Gross-to-Net",
      value: kpi?.total_gross
        ? `${((kpi.total_net / kpi.total_gross) * 100).toFixed(1)}%`
        : "—",
      icon: <BarChart2 className="h-5 w-5" />,
      tone: "slate",
    },
  ];

  if (analyticsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {availableMonths.length > 0 && (
          <Select
            value={resolvedRunMonth ?? ""}
            onValueChange={(v) => setRunMonth(v || undefined)}
          >
            <SelectTrigger className="h-10 w-[180px] rounded-xl border-slate-200 bg-white text-sm shadow-sm">
              <SelectValue placeholder="Select month" />
            </SelectTrigger>
            <SelectContent>
              {availableMonths.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={dimension}
          onValueChange={(v) => setDimension(v as typeof dimension)}
        >
          <SelectTrigger className="h-10 w-[160px] rounded-xl border-slate-200 bg-white text-sm shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="department">By Department</SelectItem>
            <SelectItem value="branch">By Branch</SelectItem>
            <SelectItem value="process">By Process</SelectItem>
          </SelectContent>
        </Select>

        {resolvedRunMonth && (
          <Badge variant="outline" className="h-10 px-3 text-xs font-semibold">
            Run: {resolvedRunMonth}
          </Badge>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpiCards.map((c) => {
          const style = TONE_MAP[c.tone] ?? TONE_MAP.slate;
          return (
            <div key={c.label} className={`rounded-2xl border p-4 shadow-sm ${style.card}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    {c.label}
                  </p>
                  <h3 className="mt-2 text-xl font-bold text-slate-950">{c.value}</h3>
                </div>
                <div className={`rounded-xl p-2.5 ring-1 ${style.icon}`}>{c.icon}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid gap-5 xl:grid-cols-2">

        {/* Horizontal bar — dimension breakdown */}
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-slate-950">
              Net Salary by {dimLabel}
            </CardTitle>
            <p className="text-xs text-slate-500">Sorted descending · {resolvedRunMonth}</p>
          </CardHeader>
          <CardContent>
            {data.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400">
                No data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, data.length * 40)}>
                <BarChart
                  data={data}
                  layout="vertical"
                  margin={{ left: 8, right: 48, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={fmtShort}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="dimension_name"
                    width={130}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value: number) => [fmt(value), "Net Salary"]}
                    contentStyle={{ borderRadius: 12, fontSize: 12 }}
                  />
                  <Bar dataKey="total_net" radius={[0, 4, 4, 0]}>
                    {data.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Donut — share of total */}
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-slate-950">
              Payroll Distribution
            </CardTitle>
            <p className="text-xs text-slate-500">Share of total net · {resolvedRunMonth}</p>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {data.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400">
                No data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="total_net"
                    nameKey="dimension_name"
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={3}
                  >
                    {data.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [fmt(value), name]}
                    contentStyle={{ borderRadius: 12, fontSize: 12 }}
                  />
                  <Legend
                    iconSize={10}
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Month-over-month trend */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-950">
            Month-over-Month Trend (Last 6 Months)
          </CardTitle>
          <p className="text-xs text-slate-500">Gross vs Net salary across all active runs</p>
        </CardHeader>
        <CardContent>
          {trendsQuery.isLoading ? (
            <Skeleton className="h-56 rounded-xl" />
          ) : !trendsQuery.data?.length ? (
            <div className="flex h-56 items-center justify-center text-sm text-slate-400">
              No trend data available yet — run payroll for at least one month
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart
                data={trendsQuery.data}
                margin={{ left: 10, right: 20, top: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month_label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number, name: string) => [fmt(value), name]}
                  contentStyle={{ borderRadius: 12, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="total_gross"
                  name="Gross Salary"
                  stroke="#1B6AB5"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="total_net"
                  name="Net Salary"
                  stroke="#3BAD49"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Summary table */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-950">
            {dimLabel} Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">No data for this period</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 bg-slate-50">
                    <TableHead className="text-xs font-semibold">{dimLabel}</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Headcount</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Avg Net</TableHead>
                    <TableHead className="text-right text-xs font-semibold">Total Net</TableHead>
                    <TableHead className="text-right text-xs font-semibold">% of Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row, i) => (
                    <TableRow key={`${row.dimension_name}-${i}`} className="border-slate-100 text-sm">
                      <TableCell className="font-medium text-slate-800">
                        {row.dimension_name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.headcount}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(row.avg_net ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmt(row.total_net)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Badge variant="outline" className="font-mono text-xs">
                          {(row.pct_of_total ?? 0).toFixed(1)}%
                        </Badge>
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
