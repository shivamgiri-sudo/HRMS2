import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  TriangleAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
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

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Tone } from "./reference-dashboard-model";
import { formatValue } from "./reference-dashboard-model";

const TONE: Record<Tone, { icon: string; value: string; border: string; bar: string; soft: string }> = {
  blue: {
    icon: "bg-[#edf4ff] text-[#0b63e5]",
    value: "text-[#0b63e5]",
    border: "border-[#dce8fb]",
    bar: "bg-[#0b63e5]",
    soft: "bg-[#f4f8ff]",
  },
  green: {
    icon: "bg-[#eaf8ef] text-[#16a34a]",
    value: "text-[#15803d]",
    border: "border-[#d7f0df]",
    bar: "bg-[#16a34a]",
    soft: "bg-[#f2fbf5]",
  },
  amber: {
    icon: "bg-[#fff4e8] text-[#f97316]",
    value: "text-[#ea580c]",
    border: "border-[#fee3c5]",
    bar: "bg-[#f97316]",
    soft: "bg-[#fff9f2]",
  },
  red: {
    icon: "bg-[#fff0f1] text-[#ef4444]",
    value: "text-[#dc2626]",
    border: "border-[#ffdadd]",
    bar: "bg-[#ef4444]",
    soft: "bg-[#fff7f7]",
  },
  violet: {
    icon: "bg-[#f3efff] text-[#7c3aed]",
    value: "text-[#6d28d9]",
    border: "border-[#e6ddff]",
    bar: "bg-[#7c3aed]",
    soft: "bg-[#faf8ff]",
  },
  slate: {
    icon: "bg-[#f1f4f8] text-[#475569]",
    value: "text-[#0b1f44]",
    border: "border-[#e3e9f2]",
    bar: "bg-[#64748b]",
    soft: "bg-[#f8fafc]",
  },
};

export const REFERENCE_CHART_COLORS = ["#16a34a", "#f97316", "#ef4444", "#0b63e5", "#7c3aed", "#94a3b8"];

export interface ReferenceMetric {
  label: string;
  value: unknown;
  helper?: string;
  icon: ElementType;
  tone?: Tone;
  trend?: number | null;
  href?: string;
  valueSuffix?: string;
}

export interface ReferenceAction {
  label: string;
  value: unknown;
  detail: string;
  tone?: "red" | "amber" | "blue";
  href?: string;
}

export function ReferenceHeader({
  title,
  subtitle,
  badge,
  right,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  right?: ReactNode;
}) {
  return (
    <header className="reference-header">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.025em] text-[#081a3a]">{title}</h1>
          {badge ? (
            <span className="rounded-md border border-[#bcd4fb] bg-[#edf4ff] px-2 py-0.5 text-[11px] font-semibold text-[#0b63e5]">
              {badge}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="mt-1 text-[13px] text-[#61708a]">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </header>
  );
}

export function UpdatedControl({
  generatedAt,
  refreshing,
  onRefresh,
}: {
  generatedAt?: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const text = generatedAt
    ? `Data as of ${new Date(generatedAt).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "Updated just now";
  return (
    <button
      type="button"
      onClick={onRefresh}
      className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-[11px] font-medium text-[#61708a] hover:bg-[#f4f7fb] hover:text-[#0b63e5]"
      aria-label="Refresh dashboard data"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
      {text}
    </button>
  );
}

export function ReferenceMetricCard({ metric, loading = false }: { metric: ReferenceMetric; loading?: boolean }) {
  const tone = TONE[metric.tone ?? "blue"];
  const Icon = metric.icon;
  const body = (
    <div
      className={cn("reference-metric-card", tone.border)}
      role={metric.href ? "link" : "group"}
      aria-label={`${metric.label}: ${formatValue(metric.value, metric.valueSuffix ?? "")}`}
      tabIndex={metric.href ? -1 : 0}
    >
      {loading ? (
        <>
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        </>
      ) : (
        <>
          <div className={cn("reference-metric-icon", tone.icon)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-[12px] font-semibold text-[#1d2b45]">{metric.label}</p>
              {metric.trend !== null && metric.trend !== undefined ? (
                <span className={cn("inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold", metric.trend >= 0 ? "text-[#16a34a]" : "text-[#ef4444]")}>
                  {metric.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(metric.trend).toFixed(1)}%
                </span>
              ) : null}
            </div>
            <p className={cn("mt-1 text-[25px] font-extrabold leading-none tracking-[-0.02em]", tone.value)}>
              {formatValue(metric.value, metric.valueSuffix ?? "")}
            </p>
            {metric.helper ? <p className="mt-2 truncate text-[10px] text-[#71809a]">{metric.helper}</p> : null}
          </div>
        </>
      )}
    </div>
  );
  return metric.href ? (
    <Link to={metric.href} className="block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b63e5]/30">
      {body}
    </Link>
  ) : body;
}

export function ReferenceMetricGrid({
  metrics,
  loading,
  columns = 4,
}: {
  metrics: ReferenceMetric[];
  loading?: boolean;
  columns?: 2 | 3 | 4 | 5 | 6 | 7;
}) {
  const columnClass: Record<number, string> = {
    2: "lg:grid-cols-2",
    3: "lg:grid-cols-3",
    4: "lg:grid-cols-4",
    5: "xl:grid-cols-5",
    6: "xl:grid-cols-6",
    7: "xl:grid-cols-7",
  };
  return (
    <section className={cn("grid gap-3 sm:grid-cols-2", columnClass[columns])} role="region" aria-label="Dashboard metrics">
      {metrics.map((metric) => (
        <ReferenceMetricCard key={metric.label} metric={metric} loading={loading} />
      ))}
    </section>
  );
}

export function ReferencePanel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("reference-panel", className)} aria-label={title}>
      <div className="reference-panel-header">
        <h2 className="text-[14px] font-bold text-[#0b1f44]">{title}</h2>
        {action}
      </div>
      <div className={cn("reference-panel-body", bodyClassName)}>{children}</div>
    </section>
  );
}

export function ReferenceActionStrip({
  title,
  items,
}: {
  title: string;
  items: ReferenceAction[];
}) {
  const visible = items.filter((item) => item.value !== null && item.value !== undefined);
  return (
    <section className="reference-action-strip" aria-label={title}>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#0b1f44]">
        <TriangleAlert className="h-4 w-4 text-[#ef4444]" aria-hidden="true" />
        {title}
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {visible.map((item) => {
          const tone = item.tone ?? "red";
          const cls = tone === "red"
            ? "border-[#ffdadd] bg-white text-[#dc2626]"
            : tone === "amber"
              ? "border-[#fee3c5] bg-white text-[#ea580c]"
              : "border-[#dce8fb] bg-white text-[#0b63e5]";
          const content = (
            <div className={cn("rounded-lg border px-3 py-2.5", cls)}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-bold text-[#1d2b45]">{item.label}</p>
                <span className="rounded-full bg-current/10 px-2 py-0.5 text-[10px] font-extrabold">{formatValue(item.value)}</span>
              </div>
              <p className="mt-1 truncate text-[9px] text-[#71809a]">{item.detail}</p>
            </div>
          );
          return item.href ? <Link key={item.label} to={item.href}>{content}</Link> : <div key={item.label}>{content}</div>;
        })}
      </div>
    </section>
  );
}

export function ReferenceDonut({
  data,
  centerValue,
  centerLabel,
  compact = false,
}: {
  data: Array<{ name: string; value: number }>;
  centerValue?: unknown;
  centerLabel: string;
  compact?: boolean;
}) {
  const clean = data.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const total = clean.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className={cn("grid items-center gap-4", compact ? "grid-cols-[145px_1fr]" : "sm:grid-cols-[190px_1fr]")}>
      <div className={cn("relative", compact ? "h-36" : "h-44") } aria-label={`${centerLabel} distribution`}>
        {clean.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={clean} dataKey="value" nameKey="name" innerRadius={compact ? 43 : 54} outerRadius={compact ? 61 : 73} paddingAngle={1.5} stroke="none">
                {clean.map((item, index) => <Cell key={`${item.name}-${index}`} fill={REFERENCE_CHART_COLORS[index % REFERENCE_CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e3e9f2", fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-[#94a3b8]">No data</div>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-extrabold leading-none text-[#0b1f44]">{formatValue(centerValue ?? total)}</span>
          <span className="mt-1 text-[9px] font-medium text-[#71809a]">{centerLabel}</span>
        </div>
      </div>
      <div className="space-y-2">
        {clean.map((item, index) => (
          <div key={item.name} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex min-w-0 items-center gap-2 text-[#61708a]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: REFERENCE_CHART_COLORS[index % REFERENCE_CHART_COLORS.length] }} />
              <span className="truncate">{item.name}</span>
            </span>
            <span className="font-bold text-[#1d2b45]">{formatValue(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReferenceLineChart({
  data,
  dataKey = "value",
  xKey = "label",
  height = 190,
}: {
  data: Array<Record<string, string | number>>;
  dataKey?: string;
  xKey?: string;
  height?: number;
}) {
  if (!data.length) return <div className="flex h-44 items-center justify-center text-[11px] text-[#94a3b8]">Historical data is unavailable</div>;
  return (
    <div style={{ height }} aria-label="Trend chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf1f6" />
          <XAxis dataKey={xKey} tick={{ fill: "#71809a", fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#71809a", fontSize: 9 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e3e9f2", fontSize: 11 }} />
          <Line type="monotone" dataKey={dataKey} stroke="#0b63e5" strokeWidth={2.5} dot={{ r: 3, fill: "#0b63e5" }} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReferenceProgress({
  label,
  value,
  max = 100,
  tone = "green",
  suffix = "",
}: {
  label: string;
  value: number | null;
  max?: number;
  tone?: Tone;
  suffix?: string;
}) {
  const safe = value === null ? 0 : Math.max(0, Math.min(max, value));
  const width = max > 0 ? Math.min(100, (safe / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px]">
        <span className="font-medium text-[#61708a]">{label}</span>
        <span className={cn("font-bold", TONE[tone].value)}>{formatValue(value, suffix)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#edf1f6]">
        <div className={cn("h-full rounded-full", TONE[tone].bar)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function ReferenceListRow({
  icon: Icon,
  title,
  subtitle,
  value,
  tone = "blue",
  href,
}: {
  icon?: ElementType;
  title: string;
  subtitle?: string;
  value?: unknown;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <div className="reference-list-row">
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE[tone].icon)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-[#1d2b45]">{title}</p>
          {subtitle ? <p className="mt-0.5 truncate text-[9px] text-[#71809a]">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {value !== undefined ? <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", TONE[tone].soft, TONE[tone].value)}>{formatValue(value)}</span> : null}
        {href ? <ArrowRight className="h-3.5 w-3.5 text-[#94a3b8]" aria-hidden="true" /> : null}
      </div>
    </div>
  );
  return href ? <Link to={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b63e5]/30">{body}</Link> : body;
}

export function ReferenceQuickLink({
  icon: Icon,
  title,
  subtitle,
  href,
  tone = "blue",
}: {
  icon: ElementType;
  title: string;
  subtitle?: string;
  href: string;
  tone?: Tone;
}) {
  return (
    <Link to={href} className="reference-quick-link" aria-label={title}>
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", TONE[tone].icon)}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold leading-tight text-[#1d2b45]">{title}</span>
        {subtitle ? <span className="mt-0.5 block text-[9px] leading-tight text-[#71809a]">{subtitle}</span> : null}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-[#94a3b8]" aria-hidden="true" />
    </Link>
  );
}

export function ReferenceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#ffdadd] bg-[#fff7f7] px-4 py-3 text-[11px] text-[#b91c1c]" role="alert">
      <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="rounded-md border border-[#fecaca] bg-white px-3 py-1.5 text-[10px] font-semibold hover:bg-[#fff0f1]">Retry</button>
    </div>
  );
}

export function ReferenceEmpty({ text = "No data available" }: { text?: string }) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center text-center text-[#94a3b8]">
      <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
      <p className="mt-2 text-[10px]">{text}</p>
    </div>
  );
}
