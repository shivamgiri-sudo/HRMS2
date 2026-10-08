import { ArrowRight, Crown } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { DashHero, formatUnit, type HeroStat } from "../../kit";
import type { RoleInsights } from "../../kit";
import type { Attention, CeoModel } from "./ceoModel";
import { drillTo, kpiOf } from "./ceoModel";

const pctText = (v: number | null) => { const f = formatUnit(v, "percent"); return v === null ? "—" : `${f.text}${f.suffix}`; };
const tone = (v: number | null, good: number, warn: number, higherIsBetter = true): HeroStat["tone"] =>
  v === null ? "neutral" : (higherIsBetter ? v >= good : v <= good) ? "good" : (higherIsBetter ? v >= warn : v <= warn) ? "warn" : "bad";

/** CEO hero: headcount headline, live stat chips that each drill, and the composite health ring. */
export function CeoHero({ model, insights, filters, loading }: { model: CeoModel; insights?: RoleInsights; filters: React.ReactNode; loading?: boolean }) {
  const flow = kpiOf(insights?.kpis, "net_flow_30d");
  const attr = kpiOf(insights?.kpis, "attrition_month");
  const gap = kpiOf(insights?.kpis, "hiring_gap");
  const stats: HeroStat[] = [
    { label: model.attendanceAsOf ? `Attendance · ${model.attendanceAsOf.slice(5)}` : "Attendance", value: pctText(model.attendance), tone: tone(model.attendance, 90, 80), href: drillTo("ATTENDANCE") },
    { label: "Attrition · last month", value: attr?.value == null ? "—" : `${attr.value}%`, tone: tone(attr?.value ?? null, 8, 15, false), href: drillTo("RESIGNATION") },
    { label: "Hiring gap", value: gap?.value == null ? "—" : gap.value.toLocaleString("en-IN"), tone: tone(gap?.value ?? null, 0, 50, false), href: drillTo("HIRING_ALERT") },
    { label: model.revenue.month ? `Revenue · ${model.revenue.month}` : "Revenue", value: model.revenue.revenue === null ? "—" : formatUnit(model.revenue.revenue, "inr").text, href: "/finance/process-pnl" },
    { label: "Quality vs target", value: model.qualityScore === null ? "—" : `${model.qualityScore.toFixed(1)}${model.qualityTarget ? ` / ${model.qualityTarget}` : ""}`, tone: model.qualityScore !== null && model.qualityTarget !== null ? (model.qualityScore >= model.qualityTarget ? "good" : model.qualityScore >= model.qualityTarget - 10 ? "warn" : "bad") : "neutral", href: "/quality/executive" },
    { label: "Payroll data ready", value: pctText(model.payrollReadiness), tone: tone(model.payrollReadiness, 95, 85), href: drillTo("PAYROLL_READINESS") },
  ];
  return (
    <DashHero
      eyebrow="CEO cockpit" title="Organisation at a glance" subtitle="Revenue · people · quality — everything that needs a decision, one click from its source"
      accent="indigo" icon={Crown} right={filters}
      headline={{ label: "Active headcount", value: loading || model.active === null ? "—" : model.active.toLocaleString("en-IN"), caption: flow ? `${flow.helper ?? ""} in the last 30 days` : undefined }}
      health={insights?.healthScore != null ? { value: insights.healthScore, label: "Operational health", basis: insights.healthBasis } : null}
      stats={stats}
    />
  );
}

/** Top-3 "what needs the CEO" — ranked by severity, age, overdue count and whether the decision is the CEO's own. */
export function NeedsCeoBanner({ items, loading }: { items: Attention[]; loading?: boolean }) {
  // Wait for the insight queues: ranking only the summary-fed candidates first would reshuffle the banner when they land.
  if (loading) {
    return <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  }
  if (!items.length) {
    return <div className="kit-card kit-rise flex items-center gap-3 p-4 text-emerald-700"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden /><p className="text-[13px] font-semibold">Nothing needs the CEO right now — no pending decisions or red signals.</p></div>;
  }
  return (
    <section aria-label="What needs the CEO" className="grid gap-3 md:grid-cols-3">
      {items.map((a, i) => (
        <Link key={a.id} to={a.href} className={cn("kit-card kit-rise kit-lift group relative block overflow-hidden p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500", a.tone === "red" ? "border-rose-200" : "border-amber-200")}>
          <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", a.tone === "red" ? "bg-rose-500" : "bg-amber-500")} />
          <div className="flex items-start gap-3">
            <span className={cn("kit-num flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[14px] font-black", a.tone === "red" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800")}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Needs the CEO</p>
              <p className="mt-0.5 text-[14px] font-bold leading-5 text-slate-900">{a.count != null ? <span className="kit-num mr-1.5">{a.count.toLocaleString("en-IN")}</span> : null}{a.title}</p>
              {a.detail ? <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-slate-500">{a.detail}</p> : null}
            </div>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" aria-hidden />
          </div>
        </Link>
      ))}
    </section>
  );
}
