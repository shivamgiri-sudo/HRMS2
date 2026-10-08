import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { DashHero, type HeroStat, type RoleInsights } from "../../kit";
import { kpiOf } from "./qualityModel";

/** Hero: average quality score vs the 85% target is the headline; coverage, fail rate, backlog and fatals are the chips. */
export function QualityHeroBlock({ insights, loading, filters }: { insights?: RoleInsights; loading?: boolean; filters?: ReactNode }) {
  const score = kpiOf(insights, "q_score");
  const f = (key: string, suffix = "") => { const k = kpiOf(insights, key); return loading ? "…" : k?.value == null ? "—" : `${k.value.toLocaleString("en-IN")}${suffix}`; };
  const v = (key: string) => kpiOf(insights, key)?.value;
  const stats: HeroStat[] = [
    { label: "Calls audited", value: f("q_audited"), href: "/quality-dashboard" },
    { label: "Audit coverage", value: f("q_coverage", "%"), href: "/quality-dashboard" },
    { label: "Fail rate", value: f("q_fail", "%"), tone: v("q_fail") == null ? "neutral" : (v("q_fail") as number) <= 10 ? "good" : (v("q_fail") as number) <= 20 ? "warn" : "bad", href: "/quality-dashboard" },
    { label: "Pending audits", value: f("q_pending"), tone: (v("q_pending") ?? 0) > 0 ? "warn" : "good", href: "/quality-dashboard" },
    { label: "Fatal-error calls", value: f("q_fatal"), tone: (v("q_fatal") ?? 0) > 0 ? "bad" : "good", href: "/quality-dashboard" },
    { label: "Agents below 70%", value: f("q_agents_below"), tone: (v("q_agents_below") ?? 0) > 0 ? "warn" : "good", href: "/quality-dashboard" },
  ];
  const delta = score?.delta;
  return (
    <DashHero
      accent="violet"
      icon={ShieldCheck}
      eyebrow="Quality · audit control room"
      title="Quality Dashboard"
      subtitle="Audit coverage, score vs target, defects by parameter, coaching and fatal errors"
      headline={{ label: "Avg quality score (30 days)", value: loading ? "…" : score?.value == null ? "—" : `${score.value}%`, caption: score?.value == null ? (score?.unavailable ?? "No audited calls for this scope.") : `${score.value >= 85 ? "Meets" : "Below"} the 85% target${delta == null ? "" : ` · ${delta >= 0 ? "up" : "down"} ${Math.abs(delta)} pp on the previous 30 days`}.` }}
      health={insights?.healthScore != null ? { value: insights.healthScore, label: "Quality health", basis: insights.healthBasis } : null}
      stats={stats}
      right={filters}
    />
  );
}
