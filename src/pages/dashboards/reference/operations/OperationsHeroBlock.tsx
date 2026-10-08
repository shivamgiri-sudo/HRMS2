import type { ReactNode } from "react";
import { Gauge } from "lucide-react";
import { DashHero, type HeroStat, type RoleInsights } from "../../kit";
import { kpiOf } from "./operationsModel";

const tone = (v: number | null | undefined, good: number, warn: number, higher = true): HeroStat["tone"] =>
  v === null || v === undefined ? "neutral" : higher ? (v >= good ? "good" : v >= warn ? "warn" : "bad") : v <= good ? "good" : v <= warn ? "warn" : "bad";

/** Hero: floor shrinkage is the headline (the number operations is judged on), with the other control-tower vitals as chips. */
export function OperationsHeroBlock({ insights, loading, filters }: { insights?: RoleInsights; loading?: boolean; filters?: ReactNode }) {
  const shr = kpiOf(insights, "shrinkage_pct");
  const att = kpiOf(insights, "attendance_pct");
  const fill = kpiOf(insights, "mandate_fill_pct");
  const adh = kpiOf(insights, "roster_adherence_pct");
  const attr = kpiOf(insights, "attrition_pct");
  const qa = kpiOf(insights, "qa_score_pct");
  const hc = kpiOf(insights, "hc_closing");
  const f = (k?: { value: number | null }, suffix = "") => (loading ? "…" : k?.value == null ? "—" : `${k.value}${suffix}`);
  const stats: HeroStat[] = [
    { label: "Headcount", value: f(hc), href: "/operations-dashboard" },
    { label: "Attendance", value: f(att, "%"), tone: tone(att?.value, 90, 80), href: "/operations-dashboard?tab=attendance" },
    { label: "Mandate fill", value: f(fill, "%"), tone: tone(fill?.value, 95, 85), href: "/operations-dashboard?tab=hiring&by=process" },
    { label: "Roster adherence", value: f(adh, "%"), tone: tone(adh?.value, 92, 85), href: "/operations-dashboard?tab=roster" },
    { label: "Attrition (30d)", value: f(attr, "%"), tone: tone(attr?.value, 4, 8, false), href: "/operations-dashboard?tab=attrition" },
    { label: "Quality", value: f(qa, "%"), tone: tone(qa?.value, 85, 75), href: "/operations-dashboard?tab=quality" },
  ];
  return (
    <DashHero
      accent="cyan"
      icon={Gauge}
      eyebrow="Operations · control tower"
      title="Operations Dashboard"
      subtitle="People, attendance, shrinkage, service levels and process economics - drill from branch to process to team"
      headline={{ label: "Floor shrinkage (30 days)", value: loading ? "…" : shr?.value == null ? "—" : `${shr.value}%`, caption: shr?.value == null ? "No scheduled days in this window." : "Time lost against time scheduled: planned leave + unplanned absence. Lower is better." }}
      health={insights?.healthScore != null ? { value: insights.healthScore, label: "Operations health", basis: insights.healthBasis } : null}
      stats={stats}
      right={filters}
    />
  );
}
