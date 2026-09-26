import {
  Clock,
  ClipboardCheck,
  Gauge,
  Scale,
  Timer,
  TrendingDown,
  UserMinus,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import { KpiCard } from "@/components/process-performance/DashboardKit";
import type { OnfidoKpi, OnfidoKpiKey } from "./onfidoKpi";

const ICONS: Record<OnfidoKpiKey, ComponentType<{ className?: string }>> = {
  activeHc: Users,
  approvedHc: ClipboardCheck,
  buffer: Scale,
  shortfall: UserMinus,
  attrition: TrendingDown,
  shrinkage: Gauge,
  docAht: Timer,
  poaAht: Clock,
};

/**
 * Headline tiles at the top of the Overview, using Process Performance V2's own KpiCard so the
 * look matches the other dashboards. Purely a summary of numbers already in the tables below.
 */
export function OnfidoKpiStrip({
  kpis,
  loading,
}: {
  kpis: OnfidoKpi[];
  loading?: boolean;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8"
      aria-label="Headline figures"
    >
      {loading
        ? kpis.map((k) => (
            <div
              key={k.key}
              className="oc-skeleton"
              style={{ height: 52, borderRadius: 12 }}
            />
          ))
        : kpis.map((k) => (
            <KpiCard
              key={k.key}
              icon={ICONS[k.key]}
              label={k.label}
              value={k.value}
              sub={k.sub}
              tone={k.tone}
            />
          ))}
    </div>
  );
}
