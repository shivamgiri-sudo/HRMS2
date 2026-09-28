// src/pages/finance/FinanceAnalyticsPage.tsx
//
// Finance Analytics dashboard — snapshot KPIs, AR aging, collection trend, cash-flow forecast.
// Exported as FinanceAnalyticsContent (no DashboardLayout — embedded as a tab in FinanceLedgerHubPage).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  AlertTriangle,
  Landmark,
  ArrowDownCircle,
  Clock,
  BarChart3,
  ShoppingCart,
  Receipt,
  CreditCard,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ComposedChart,
  Line,
  Cell,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { hrmsApi } from "@/lib/hrmsApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SnapshotData = {
  total_receivables: number;
  overdue_amount: number;
  overdue_count: number;
  bank_balance: number;
  total_payables: number;
  dso_days: number;
};

type AgingRow = {
  client_name: string;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
};

type TrendRow = {
  month_label: string;
  invoiced: number;
  collected: number;
};

type ForecastRow = {
  week_label: string;
  expected_in: number;
  expected_out: number;
  net: number;
};

// ---------------------------------------------------------------------------
// Money formatter
// ---------------------------------------------------------------------------

function money(v: unknown) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

// ---------------------------------------------------------------------------
// Chart configs
// ---------------------------------------------------------------------------

const agingConfig: ChartConfig = {
  current: { label: "Current", color: "#10b981" },
  days_1_30: { label: "1–30 d", color: "#eab308" },
  days_31_60: { label: "31–60 d", color: "#f97316" },
  days_61_90: { label: "61–90 d", color: "#ef4444" },
  days_90_plus: { label: "90 d+", color: "#be123c" },
};

const trendConfig: ChartConfig = {
  invoiced: { label: "Invoiced", color: "#3b82f6" },
  collected: { label: "Collected", color: "#10b981" },
};

const forecastConfig: ChartConfig = {
  expected_in: { label: "Expected In", color: "#10b981" },
  expected_out: { label: "Expected Out", color: "#ef4444" },
  net: { label: "Net", color: "#6366f1" },
};

// ---------------------------------------------------------------------------
// Skeleton card
// ---------------------------------------------------------------------------

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border bg-white shadow-sm p-5 animate-pulse ${className}`}
    >
      <div className="h-3 w-24 rounded bg-slate-200 mb-4" />
      <div className="h-7 w-32 rounded bg-slate-200 mb-2" />
      <div className="h-3 w-20 rounded bg-slate-100" />
    </div>
  );
}

function SkeletonChart({ height = 320 }: { height?: number }) {
  return (
    <div
      className="rounded-2xl border bg-white shadow-sm animate-pulse"
      style={{ height }}
    />
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

type KpiTone = "blue" | "red" | "green" | "amber" | "slate";

const toneMap: Record<KpiTone, { bg: string; icon: string; value: string }> = {
  blue: { bg: "bg-blue-50", icon: "text-blue-600", value: "text-blue-700" },
  red: { bg: "bg-red-50", icon: "text-red-600", value: "text-red-700" },
  green: {
    bg: "bg-emerald-50",
    icon: "text-emerald-600",
    value: "text-emerald-700",
  },
  amber: { bg: "bg-amber-50", icon: "text-amber-600", value: "text-amber-700" },
  slate: {
    bg: "bg-slate-100",
    icon: "text-slate-600",
    value: "text-slate-800",
  },
};

type KpiCardProps = {
  label: string;
  value: string;
  subtitle?: string;
  tone: KpiTone;
  icon: React.ElementType;
};

function KpiCard({ label, value, subtitle, tone, icon: Icon }: KpiCardProps) {
  const t = toneMap[tone];
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
          {label}
        </span>
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.bg}`}
        >
          <Icon className={`h-4 w-4 ${t.icon}`} />
        </div>
      </div>
      <div className={`text-2xl font-bold ${t.value}`}>{value}</div>
      {subtitle && (
        <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AR Aging chart
// ---------------------------------------------------------------------------

function ARAgingChart({ data }: { data: AgingRow[] }) {
  const chartData = data
    .map((r) => ({
      ...r,
      client_name:
        r.client_name.length > 20
          ? r.client_name.slice(0, 20) + "…"
          : r.client_name,
    }))
    .slice(0, 10);

  return (
    <div className="rounded-2xl border bg-white shadow-sm p-6">
      <h2 className="text-sm font-bold text-slate-700 mb-4">
        AR Aging — Top 10 Clients
      </h2>
      <ChartContainer config={agingConfig} className="h-[380px] w-full">
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v) =>
              new Intl.NumberFormat("en-IN", {
                notation: "compact",
                maximumFractionDigits: 1,
                style: "currency",
                currency: "INR",
              }).format(v)
            }
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="client_name"
            width={140}
            tick={{ fontSize: 11 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  }).format(Number(value))
                }
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
          <Bar
            dataKey="current"
            stackId="a"
            fill="var(--color-current)"
            radius={[0, 0, 0, 0]}
          />
          <Bar dataKey="days_1_30" stackId="a" fill="var(--color-days_1_30)" />
          <Bar
            dataKey="days_31_60"
            stackId="a"
            fill="var(--color-days_31_60)"
          />
          <Bar
            dataKey="days_61_90"
            stackId="a"
            fill="var(--color-days_61_90)"
          />
          <Bar
            dataKey="days_90_plus"
            stackId="a"
            fill="var(--color-days_90_plus)"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collection Trend chart
// ---------------------------------------------------------------------------

function CollectionTrendChart({ data }: { data: TrendRow[] }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm p-6">
      <h2 className="text-sm font-bold text-slate-700 mb-4">
        Monthly Collection Trend (12 months)
      </h2>
      <ChartContainer config={trendConfig} className="h-[280px] w-full">
        <BarChart
          data={data}
          margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month_label" tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) =>
              new Intl.NumberFormat("en-IN", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(v)
            }
            tick={{ fontSize: 11 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  }).format(Number(value))
                }
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="invoiced"
            fill="var(--color-invoiced)"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="collected"
            fill="var(--color-collected)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash Flow Forecast chart
// ---------------------------------------------------------------------------

function CashFlowForecastChart({ data }: { data: ForecastRow[] }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm p-6">
      <h2 className="text-sm font-bold text-slate-700 mb-4">
        90-Day Cash Flow Forecast
      </h2>
      <ChartContainer config={forecastConfig} className="h-[280px] w-full">
        <ComposedChart
          data={data}
          margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week_label" tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) =>
              new Intl.NumberFormat("en-IN", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(v)
            }
            tick={{ fontSize: 11 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  new Intl.NumberFormat("en-IN", {
                    style: "currency",
                    currency: "INR",
                    maximumFractionDigits: 0,
                  }).format(Number(value))
                }
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="net" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.net >= 0 ? "#10b981" : "#ef4444"}
              />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="expected_in"
            stroke="var(--color-expected_in)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="expected_out"
            stroke="var(--color-expected_out)"
            strokeWidth={2}
            dot={false}
            strokeDasharray="4 2"
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expense Trends tab
// ---------------------------------------------------------------------------

type ExpenseTrendsData = {
  kpis: {
    total_spend: number;
    pending_payments: number;
    avg_approval_days: number;
  };
  monthly: Record<string, number | string>[];
  topHeads: string[];
  topVendors: { vendor_name: string; total_spend: number; grn_count: number }[];
};

const HEAD_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
];

function ExpenseTrendsTab() {
  const query = useQuery<ExpenseTrendsData>({
    queryKey: ["finance-expense-trends"],
    queryFn: () =>
      hrmsApi
        .get("/api/finance/analytics/expense-trends?financialYear=2026-27")
        .then((r) => r.data),
  });
  const d = query.data;
  if (query.isLoading)
    return (
      <div className="space-y-4">
        <SkeletonChart height={300} />
        <SkeletonChart height={300} />
      </div>
    );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label="Total GRN Spend (FY)"
          value={money(d?.kpis.total_spend ?? 0)}
          tone="blue"
          icon={ShoppingCart}
        />
        <KpiCard
          label="Pending Payments"
          value={money(d?.kpis.pending_payments ?? 0)}
          tone="amber"
          icon={Clock}
        />
        <KpiCard
          label="Avg Approval Days"
          value={`${d?.kpis.avg_approval_days ?? 0} days`}
          tone="slate"
          icon={BarChart3}
        />
      </div>
      {(d?.monthly?.length ?? 0) > 0 && (
        <div className="rounded-2xl border bg-white shadow-sm p-6">
          <h2 className="text-sm font-bold text-slate-700 mb-4">
            Monthly Expense by Head (FY 2026-27)
          </h2>
          <ChartContainer config={{}} className="h-[320px] w-full">
            <BarChart
              data={d!.monthly}
              margin={{ top: 4, right: 24, bottom: 20, left: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v) =>
                  new Intl.NumberFormat("en-IN", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(v)
                }
                tick={{ fontSize: 11 }}
              />
              <Tooltip formatter={(value: number) => money(value)} />
              <Legend />
              {(d?.topHeads ?? []).map((h, i) => (
                <Bar
                  key={h}
                  dataKey={h}
                  stackId="a"
                  fill={HEAD_COLORS[i % HEAD_COLORS.length]}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </div>
      )}
      {(d?.topVendors?.length ?? 0) > 0 && (
        <div className="rounded-2xl border bg-white shadow-sm p-6">
          <h2 className="text-sm font-bold text-slate-700 mb-4">
            Top Vendors by Spend
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-slate-400 uppercase tracking-wide">
                <th className="pb-2 text-left">Vendor</th>
                <th className="pb-2 text-right">Total Spend</th>
                <th className="pb-2 text-right">GRNs</th>
              </tr>
            </thead>
            <tbody>
              {d!.topVendors.map((v, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-50 hover:bg-slate-50"
                >
                  <td className="py-2 text-slate-700">{v.vendor_name}</td>
                  <td className="py-2 text-right font-medium text-slate-800">
                    {money(v.total_spend)}
                  </td>
                  <td className="py-2 text-right text-slate-500">
                    {v.grn_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue & Collections tab
// ---------------------------------------------------------------------------

type RevCollData = {
  trend: { month: string; invoiced: number; collected: number }[];
  clientBreakdown: { client_name: string; invoiced: number }[];
  paymentStatusSummary: { status: string; count: number; amount: number }[];
};

const STATUS_COLOR: Record<string, string> = {
  paid: "#10b981",
  partial: "#f59e0b",
  pending: "#6366f1",
  overdue: "#ef4444",
  disputed: "#ec4899",
};

function RevenueCollectionsTab() {
  const query = useQuery<RevCollData>({
    queryKey: ["finance-revenue-collections"],
    queryFn: () =>
      hrmsApi
        .get("/api/finance/analytics/revenue-collections?months=12")
        .then((r) => r.data),
  });
  const d = query.data;
  if (query.isLoading)
    return (
      <div className="space-y-4">
        <SkeletonChart height={300} />
        <SkeletonChart height={300} />
      </div>
    );
  return (
    <div className="space-y-6">
      {(d?.trend?.length ?? 0) > 0 && (
        <div className="rounded-2xl border bg-white shadow-sm p-6">
          <h2 className="text-sm font-bold text-slate-700 mb-4">
            12-Month Invoiced vs Collected
          </h2>
          <ChartContainer config={trendConfig} className="h-[300px] w-full">
            <ComposedChart
              data={d!.trend}
              margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v) =>
                  new Intl.NumberFormat("en-IN", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(v)
                }
                tick={{ fontSize: 11 }}
              />
              <ChartTooltip
                content={<ChartTooltipContent formatter={(v) => money(v)} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="invoiced"
                fill="var(--color-invoiced)"
                radius={[4, 4, 0, 0]}
              />
              <Line
                type="monotone"
                dataKey="collected"
                stroke="var(--color-collected)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(d?.clientBreakdown?.length ?? 0) > 0 && (
          <div className="rounded-2xl border bg-white shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-700 mb-4">
              Top 5 Clients by Revenue (12m)
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-400 uppercase tracking-wide">
                  <th className="pb-2 text-left">Client</th>
                  <th className="pb-2 text-right">Invoiced</th>
                </tr>
              </thead>
              <tbody>
                {d!.clientBreakdown.map((c, i) => (
                  <tr
                    key={i}
                    className="border-b border-slate-50 hover:bg-slate-50"
                  >
                    <td className="py-2 text-slate-700">{c.client_name}</td>
                    <td className="py-2 text-right font-medium text-slate-800">
                      {money(c.invoiced)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(d?.paymentStatusSummary?.length ?? 0) > 0 && (
          <div className="rounded-2xl border bg-white shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-700 mb-4">
              Invoice Payment Status
            </h2>
            <div className="space-y-2">
              {d!.paymentStatusSummary.map((s) => (
                <div
                  key={s.status}
                  className="flex items-center justify-between py-1"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full inline-block"
                      style={{
                        background: STATUS_COLOR[s.status] ?? "#94a3b8",
                      }}
                    />
                    <span className="capitalize text-slate-700">
                      {s.status}
                    </span>
                    <span className="text-xs text-slate-400">({s.count})</span>
                  </div>
                  <span className="font-medium text-slate-800">
                    {money(s.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payables Aging tab
// ---------------------------------------------------------------------------

type PayablesData = {
  buckets: {
    b0_30: number;
    b31_60: number;
    b61_90: number;
    b90_plus: number;
    total: number;
  };
  topVendors: {
    vendor_name: string;
    pending_amount: number;
    oldest_due: string | null;
  }[];
};

function PayablesAgingTab() {
  const query = useQuery<PayablesData>({
    queryKey: ["finance-payables-aging"],
    queryFn: () =>
      hrmsApi.get("/api/finance/analytics/payables-aging").then((r) => r.data),
  });
  const d = query.data;
  if (query.isLoading)
    return (
      <div className="space-y-4">
        <SkeletonChart height={260} />
        <SkeletonChart height={260} />
      </div>
    );
  const b = d?.buckets ?? {
    b0_30: 0,
    b31_60: 0,
    b61_90: 0,
    b90_plus: 0,
    total: 0,
  };
  const bucketData = [
    { label: "0–30 days", amount: b.b0_30, color: "#10b981" },
    { label: "31–60 days", amount: b.b31_60, color: "#f59e0b" },
    { label: "61–90 days", amount: b.b61_90, color: "#f97316" },
    { label: "90+ days", amount: b.b90_plus, color: "#ef4444" },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {bucketData.map((bk) => (
          <div
            key={bk.label}
            className="rounded-2xl border bg-white shadow-sm p-5"
          >
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
              {bk.label}
            </div>
            <div className="text-2xl font-bold" style={{ color: bk.color }}>
              {money(bk.amount)}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border bg-white shadow-sm p-6">
        <h2 className="text-sm font-bold text-slate-700 mb-4">
          Payables Aging Buckets
        </h2>
        <ChartContainer config={{}} className="h-[240px] w-full">
          <BarChart
            data={bucketData}
            margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v) =>
                new Intl.NumberFormat("en-IN", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(v)
              }
              tick={{ fontSize: 11 }}
            />
            <Tooltip formatter={(v: number) => money(v)} />
            <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
              {bucketData.map((bk, i) => (
                <Cell key={i} fill={bk.color} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
      {(d?.topVendors?.length ?? 0) > 0 && (
        <div className="rounded-2xl border bg-white shadow-sm p-6">
          <h2 className="text-sm font-bold text-slate-700 mb-4">
            Top Vendors — Pending Payables
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-slate-400 uppercase tracking-wide">
                <th className="pb-2 text-left">Vendor</th>
                <th className="pb-2 text-right">Pending</th>
                <th className="pb-2 text-right">Oldest Due</th>
              </tr>
            </thead>
            <tbody>
              {d!.topVendors.map((v, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-50 hover:bg-slate-50"
                >
                  <td className="py-2 text-slate-700">{v.vendor_name}</td>
                  <td className="py-2 text-right font-medium text-slate-800">
                    {money(v.pending_amount)}
                  </td>
                  <td className="py-2 text-right text-slate-500">
                    {v.oldest_due ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const TABS = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "expense-trends", label: "Expense Trends", icon: ShoppingCart },
  { key: "revenue-collections", label: "Revenue & Collections", icon: Receipt },
  { key: "payables", label: "Payables", icon: CreditCard },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function FinanceAnalyticsContent() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const snapshotQuery = useQuery<SnapshotData>({
    queryKey: ["finance-analytics-snapshot"],
    queryFn: () =>
      hrmsApi.get("/api/finance/analytics/snapshot").then((r) => r.data),
  });

  const agingQuery = useQuery<AgingRow[]>({
    queryKey: ["finance-analytics-ar-aging"],
    queryFn: () =>
      hrmsApi
        .get("/api/finance/analytics/ar-aging")
        .then((r) => r.data?.rows ?? []),
  });

  const trendQuery = useQuery<TrendRow[]>({
    queryKey: ["finance-analytics-collection-trend"],
    queryFn: () =>
      hrmsApi
        .get("/api/finance/analytics/collection-trend")
        .then((r) => r.data?.months ?? []),
  });

  const forecastQuery = useQuery<ForecastRow[]>({
    queryKey: ["finance-analytics-cash-flow"],
    queryFn: () =>
      hrmsApi
        .get("/api/finance/analytics/cash-flow-forecast")
        .then((r) => r.data?.weeks ?? []),
  });

  const snap = snapshotQuery.data;

  return (
    <div className="w-full space-y-6 pt-4">
      {/* Page header */}
      <div className="bg-gradient-to-r from-blue-700 to-indigo-600 text-white p-6 rounded-2xl flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <BarChart3 className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Finance Analytics</h1>
          <p className="text-blue-100 text-sm mt-0.5">
            Receivables, aging, collections, expense trends and payables.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                active
                  ? "border-blue-600 text-blue-700 bg-blue-50"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Overview tab */}
      {activeTab === "overview" && (
        <>
          {/* KPI snapshot row */}
          {snapshotQuery.isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard
                label="Total Receivables"
                value={money(snap?.total_receivables ?? 0)}
                subtitle="Outstanding from clients"
                tone="blue"
                icon={TrendingUp}
              />
              <KpiCard
                label="Overdue Amount"
                value={money(snap?.overdue_amount ?? 0)}
                subtitle={`${snap?.overdue_count ?? 0} invoice${(snap?.overdue_count ?? 0) !== 1 ? "s" : ""} overdue`}
                tone="red"
                icon={AlertTriangle}
              />
              <KpiCard
                label="Bank Balance"
                value={money(snap?.bank_balance ?? 0)}
                subtitle="Across all accounts"
                tone="green"
                icon={Landmark}
              />
              <KpiCard
                label="Total Payables"
                value={money(snap?.total_payables ?? 0)}
                subtitle="Vendor dues outstanding"
                tone="amber"
                icon={ArrowDownCircle}
              />
              <KpiCard
                label="DSO"
                value={`${Number(snap?.dso_days ?? 0).toFixed(1)} days`}
                subtitle="Days Sales Outstanding"
                tone="slate"
                icon={Clock}
              />
            </div>
          )}

          {/* AR Aging chart */}
          {agingQuery.isLoading ? (
            <SkeletonChart height={440} />
          ) : (
            <ARAgingChart data={agingQuery.data ?? []} />
          )}

          {/* Collection Trend + Cash Flow */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {trendQuery.isLoading ? (
              <SkeletonChart height={340} />
            ) : (
              <CollectionTrendChart data={trendQuery.data ?? []} />
            )}
            {forecastQuery.isLoading ? (
              <SkeletonChart height={340} />
            ) : (
              <CashFlowForecastChart data={forecastQuery.data ?? []} />
            )}
          </div>
        </>
      )}

      {activeTab === "expense-trends" && <ExpenseTrendsTab />}
      {activeTab === "revenue-collections" && <RevenueCollectionsTab />}
      {activeTab === "payables" && <PayablesAgingTab />}
    </div>
  );
}
