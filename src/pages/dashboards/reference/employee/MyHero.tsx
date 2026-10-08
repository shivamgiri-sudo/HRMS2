import { Sun } from "lucide-react";
import { DashHero, type HeroStat } from "../../kit";
import type { InsightIndex } from "./insightIndex";
import { greeting, pendingTotal, todayChip, todayLine } from "./insightIndex";

/** Greeting + today's shift/punch state + month attendance ring. Paints from insights, falls back to the summary feed. */
export function MyHero({ ix, name, hour, fallbackPct, loading }: {
  ix: InsightIndex; name: string; hour: number; fallbackPct: number | null; loading: boolean;
}) {
    // Ring: provider's health (closed month early in the month), else the summary feed's month %.
  const ring = ix.health ?? (ix.kpi("att_pct")?.value ?? fallbackPct);
  const chip = todayChip(ix.today);
  const open = pendingTotal(ix.actions);
  const first = name.trim().split(/\s+/)[0] || "there";
  const leave = ix.kpi("leave_available");
  const holiday = ix.table("holidays")?.rows[0];
  const score = ix.kpi("kpi_score");
  const stats: HeroStat[] = [
    { label: "Today", value: loading && !ix.today ? "…" : chip.value, tone: chip.tone, href: "/my-roster" },
    { label: "Needs my action", value: loading && !ix.actions.length ? "…" : open, tone: open > 0 ? "warn" : "good", href: "#my-actions" },
    { label: "Leave left", value: leave?.value == null ? "—" : `${leave.value}d`, href: "/leaves" },
    { label: "Next holiday", value: holiday ? `${String(holiday.date)}` : "—", href: "/leaves" },
    { label: "KPI score", value: score?.value == null ? "—" : `${score.value}%`, href: "/my-kpi" },
  ];
  return (
    <DashHero
      accent="cyan"
      icon={Sun}
      eyebrow="My day"
      title={`${greeting(hour)}, ${first}`}
      subtitle={new Date(Date.now() + 5.5 * 3_600_000).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
      headline={{ label: "Today", value: chip.value === "…" ? "—" : chip.value, caption: todayLine(ix.today) }}
      health={ring === null ? null : { value: ring, label: "Attendance", basis: ix.healthBasis }}
      stats={stats}
    />
  );
}
