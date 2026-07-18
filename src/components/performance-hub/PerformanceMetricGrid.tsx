import {
  Activity,
  BadgeCheck,
  Clock3,
  IndianRupee,
  Gauge,
  PackageCheck,
  PhoneCall,
  ShieldAlert,
  ShoppingCart,
  Target,
} from "lucide-react";
import { KpiCard, type KpiTone } from "@/components/enterprise/KpiCard";
import { EmptyState } from "@/components/enterprise/EmptyState";
import type { PerformanceMetric, PerformanceMetricCode } from "@/types/performanceHub";

const metricIcons: Record<PerformanceMetricCode, React.ReactNode> = {
  CALLS: <PhoneCall className="h-5 w-5" />,
  AHT: <Clock3 className="h-5 w-5" />,
  ADHERENCE: <Target className="h-5 w-5" />,
  UTILIZATION: <Gauge className="h-5 w-5" />,
  QUALITY_SCORE: <BadgeCheck className="h-5 w-5" />,
  FATAL_RATE: <ShieldAlert className="h-5 w-5" />,
  CONVERSION_RATE: <Activity className="h-5 w-5" />,
  SALES_COUNT: <ShoppingCart className="h-5 w-5" />,
  REVENUE: <IndianRupee className="h-5 w-5" />,
  AOV: <IndianRupee className="h-5 w-5" />,
  COD_SHARE: <PackageCheck className="h-5 w-5" />,
  RTO_RATE: <PackageCheck className="h-5 w-5" />,
};

function tone(metric: PerformanceMetric): KpiTone {
  if (metric.status === "on_track") return "success";
  if (metric.status === "watch") return "warning";
  if (metric.status === "off_track") return "danger";
  return "default";
}

function displayValue(metric: PerformanceMetric): string {
  if (metric.value === null) return "—";
  if (metric.unit === "percent") return `${metric.value.toLocaleString("en-IN")}%`;
  if (metric.unit === "seconds") return `${metric.value.toLocaleString("en-IN")} sec`;
  return metric.value.toLocaleString("en-IN");
}

export function PerformanceMetricGrid({
  metrics,
  loading,
}: {
  metrics: PerformanceMetric[];
  loading: boolean;
}) {
  if (!loading && metrics.length === 0) {
    return (
      <EmptyState
        title="No KPI facts for this period"
        description="No calculated performance facts are available in your authorised scope. Check the selected dates or ask the integration owner to review data health."
      />
    );
  }

  return (
    <section aria-label="Performance scorecard" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {(loading ? Array.from({ length: 7 }, (_, index) => ({
        metricCode: PERFORMANCE_ORDER[index],
        label: "Loading metric",
      })) : metrics).map((item) => {
        const metric = item as PerformanceMetric;
        const verification = !loading && metric.calculationStatus === "legacy_unverified"
          ? "Needs source verification"
          : !loading && metric.calculationStatus === "verified"
            ? "Formula verified"
            : "No calculated value";
        const target = !loading && metric.target !== null
          ? `Target ${metric.unit === "currency" ? `₹${metric.target.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : `${metric.target.toLocaleString("en-IN")}${metric.unit === "percent" ? "%" : metric.unit === "seconds" ? " sec" : ""}`}`
          : "No approved target";

        return (
          <KpiCard
            key={item.metricCode}
            title={item.label}
            value={loading ? "" : displayValue(metric)}
            loading={loading}
            icon={metricIcons[item.metricCode]}
            tone={loading ? "default" : tone(metric)}
            description={`${target} · ${verification}`}
            trend={!loading && metric.achievementPct !== null
              ? `${metric.achievementPct.toLocaleString("en-IN")}% achieved`
              : undefined}
          />
        );
      })}
    </section>
  );
}

const PERFORMANCE_ORDER: PerformanceMetricCode[] = [
  "CALLS",
  "AHT",
  "ADHERENCE",
  "UTILIZATION",
  "QUALITY_SCORE",
  "FATAL_RATE",
  "CONVERSION_RATE",
];
