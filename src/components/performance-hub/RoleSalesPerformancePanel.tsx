import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, IndianRupee, PackageCheck, ShoppingCart, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/enterprise/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { usePerformanceScorecard } from "@/hooks/usePerformanceHub";
import type { PerformanceMetric, PerformanceMetricCode, PerformanceFilters } from "@/types/performanceHub";

type RoleVariant = "employee" | "hr" | "payroll" | "ceo" | "manager" | "super_admin" | "wfm" | "wfm_attendance";

const SALES_CODES: PerformanceMetricCode[] = ["SALES_COUNT", "REVENUE", "AOV", "CONVERSION_RATE", "COD_SHARE", "RTO_RATE"];

const ROLE_COPY: Record<RoleVariant, { title: string; description: string }> = {
  employee: {
    title: "My sales performance",
    description: "Your own verified sales, revenue, conversion and order quality for the current month.",
  },
  manager: {
    title: "Team sales performance",
    description: "Team sales, revenue and conversion signals for coaching and daily follow-up.",
  },
  hr: {
    title: "Sales-linked people signals",
    description: "Performance pressure indicators HR can use with attendance, attrition and staffing reviews.",
  },
  payroll: {
    title: "Sales incentive readiness",
    description: "Sales, revenue and order-risk facts that can later feed approved incentive checks.",
  },
  ceo: {
    title: "Organisation sales pulse",
    description: "Revenue, sales volume, conversion and COD/RTO mix from verified employee-level facts.",
  },
  super_admin: {
    title: "Enterprise sales data health",
    description: "Cross-role sales facts from the shared Performance Hub source pipeline.",
  },
  wfm: {
    title: "Sales demand signal",
    description: "Sales and conversion pressure to compare against staffing and roster coverage.",
  },
  wfm_attendance: {
    title: "Sales demand signal",
    description: "Sales pressure context for attendance and coverage review.",
  },
};

const ICONS: Partial<Record<PerformanceMetricCode, React.ReactNode>> = {
  SALES_COUNT: <ShoppingCart className="h-4 w-4" aria-hidden="true" />,
  REVENUE: <IndianRupee className="h-4 w-4" aria-hidden="true" />,
  AOV: <IndianRupee className="h-4 w-4" aria-hidden="true" />,
  CONVERSION_RATE: <TrendingUp className="h-4 w-4" aria-hidden="true" />,
  COD_SHARE: <PackageCheck className="h-4 w-4" aria-hidden="true" />,
  RTO_RATE: <PackageCheck className="h-4 w-4" aria-hidden="true" />,
};

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthFilters(branchId?: string, processId?: string): PerformanceFilters {
  const today = new Date();
  return {
    from: localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localIsoDate(today),
    branchId: branchId || undefined,
    processId: processId || undefined,
    page: 1,
    pageSize: 25,
  };
}

function formatMetric(metric: PerformanceMetric): string {
  if (metric.value === null) return "—";
  if (metric.unit === "currency") {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(metric.value);
  }
  if (metric.unit === "percent") return `${metric.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
  if (metric.unit === "seconds") return `${metric.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} sec`;
  return metric.value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

export function RoleSalesPerformanceContent({
  variant,
  metrics,
  loading,
}: {
  variant: RoleVariant;
  metrics: PerformanceMetric[];
  loading: boolean;
}) {
  const copy = ROLE_COPY[variant];
  const salesMetrics = SALES_CODES
    .map((code) => metrics.find((metric) => metric.metricCode === code))
    .filter((metric): metric is PerformanceMetric => Boolean(metric));
  const verifiedCount = salesMetrics.filter((metric) => metric.calculationStatus === "verified").length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,0.045)]" aria-label={copy.title}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">Sales performance</p>
          <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">{copy.title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{copy.description}</p>
        </div>
        <Link to="/performance-hub" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 text-sm font-black text-blue-700 transition hover:border-blue-200 hover:bg-blue-100">
          Full hub
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : salesMetrics.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No sales facts for this period"
            description="Sales data will appear here after the verified sales source sync maps records to HRMS employees."
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {salesMetrics.map((metric) => (
              <div key={metric.metricCode} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm">
                    {ICONS[metric.metricCode] ?? <BadgeCheck className="h-4 w-4" aria-hidden="true" />}
                  </div>
                  <span className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-400">{metric.metricCode}</span>
                </div>
                <p className="mt-3 text-xs font-bold text-slate-500">{metric.label}</p>
                <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{formatMetric(metric)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {metric.calculationStatus === "verified" ? "Formula verified" : "Needs source verification"}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-500">
            {verifiedCount}/{salesMetrics.length} sales metrics verified from source lineage.
          </p>
        </>
      )}
    </section>
  );
}

export function RoleSalesPerformancePanel({
  variant,
  branchId,
  processId,
  enabled = true,
}: {
  variant: RoleVariant;
  branchId?: string;
  processId?: string;
  enabled?: boolean;
}) {
  const filters = currentMonthFilters(branchId, processId);
  const scorecardQuery = usePerformanceScorecard(filters, enabled);

  return (
    <RoleSalesPerformanceContent
      variant={variant}
      metrics={scorecardQuery.data ?? []}
      loading={scorecardQuery.isLoading}
    />
  );
}
