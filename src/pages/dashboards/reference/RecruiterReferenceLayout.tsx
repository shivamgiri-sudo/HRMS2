import type { ReactNode } from "react";
import { Briefcase, CalendarCheck, FileCheck2, Handshake, ShieldCheck, TrendingUp, UserCheck, UserPlus, UserX, Users } from "lucide-react";

import {
  ActionCenter, DashHero, InsightGrid, KpiTiles, LazySection, SectionTitle, SignalList, formatUnit, drillHref,
} from "../kit";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { OnboardingFunnelPanel, RecruiterFunnelPanel } from "./ReferenceSharedPanels";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { PipelineFunnel } from "./recruiter/PipelineFunnel";
import { LegacyAtsPanels } from "./recruiter/LegacyAtsPanels";
import { kpiOf, kpiValue, seriesOf } from "./recruiter/helpers";

const ICONS = {
  walkins_today: Users, registered_today: UserPlus, selected_today: UserCheck, offers_today: Handshake, joined_today: CalendarCheck,
  active_pipeline: TrendingUp, selection_rate: UserCheck, join_rate: CalendarCheck, offer_to_join: Handshake, offers_ghosted: UserX,
  joining_week: CalendarCheck, docs_pending: FileCheck2, bgv_pending: ShieldCheck, open_seats: Briefcase, time_to_fill: Briefcase, no_show_rate: UserX,
};
const TODAY = ["walkins_today", "registered_today", "selected_today", "offers_today", "joined_today"];
const RATES = ["selection_rate", "join_rate", "offer_to_join", "no_show_rate", "offers_ghosted"];
const PENDING = ["joining_week", "docs_pending", "bgv_pending", "open_seats", "time_to_fill", "active_pipeline"];

export function RecruiterReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const drill: (key: string) => { onDrilldown?: () => void } = data.drilldownFor ?? (() => ({}));
  const ins = data.insights;
  const loading = Boolean(data.insightsLoading);
  const pick = (keys: string[]) => (ins?.kpis ?? []).filter((k) => keys.includes(k.key)).sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
  const onDrill = (k: { drill?: { metricCode: string; filters?: Record<string, string> }; label: string }) => k.drill && data.openDrill?.(k.drill.metricCode, k.label, k.drill.filters);
  const pipeline = kpiOf(ins, "active_pipeline");
  const chip = (key: string, label: string, tone?: "good" | "bad" | "warn") => {
    const k = kpiOf(ins, key); const f = formatUnit(k?.value ?? null, k?.unit);
    return { label, value: `${f.text}${f.suffix}`, tone, href: k?.href };
  };
  const onboardingDrill = drill("onb");

  return (
    <div className="space-y-5">
      <DashHero
        accent="violet" icon={Users} eyebrow="Recruiter View" title="Recruitment Command"
        subtitle="Funnel, today vs target, offers, joiners and drop-off risk"
        headline={{ label: "Active pipeline", value: formatUnit(pipeline?.value ?? null).text, caption: pipeline?.helper ?? (loading ? "Loading live pipeline…" : pipeline?.unavailable ?? undefined) }}
        health={ins?.healthScore !== null && ins?.healthScore !== undefined ? { value: ins.healthScore, label: "Hiring health", basis: ins.healthBasis } : null}
        stats={[chip("walkins_today", "Walk-ins today"), chip("offers_today", "Offers today"), chip("joined_today", "Joined today"), chip("offer_to_join", "Offer to join"), chip("no_show_rate", "No-show", "warn"), chip("joining_week", "Joining in 7d")]}
        right={filters}
      />
      <TodayCelebrationsWidget />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <PipelineFunnel series={seriesOf(ins, "funnel_30d")} loading={loading} />
        <ActionCenter actions={ins?.actions} loading={loading} error={data.insightsError} title="Needs your action" limit={9} />
      </div>

      <SectionTitle hint="today vs 7-day average (no daily target configured unless shown)">Today</SectionTitle>
      <KpiTiles kpis={pick(TODAY)} loading={loading} cols={5} onDrill={onDrill} icons={ICONS} />
      <SectionTitle>Conversion and risk</SectionTitle>
      <KpiTiles kpis={pick(RATES)} loading={loading} cols={5} onDrill={onDrill} icons={ICONS} />
      <SectionTitle>Pipeline load</SectionTitle>
      <KpiTiles kpis={pick(PENDING)} loading={loading} cols={6} onDrill={onDrill} icons={ICONS} />
      <p className="text-[12px] text-slate-500">Onboarding queue detail: <a className="text-blue-600 hover:underline" href={drillHref(data.dashboardCode, "ONBOARDING")} onClick={(e) => { if (onboardingDrill.onDrilldown) { e.preventDefault(); onboardingDrill.onDrilldown(); } }}>open onboarding records</a> · {String(kpiValue(ins, "docs_pending") ?? "—")} awaiting documents</p>

      <LazySection><SignalList signals={ins?.signals} loading={loading} title="Drop-off risks and insights" /></LazySection>
      <InsightGrid series={(ins?.series ?? []).filter((s) => s.key !== "funnel_30d")} tables={ins?.tables} loading={loading} />

      <SectionTitle hint="original ATS datapoints, relabelled">Reference data</SectionTitle>
      <LazySection><LegacyAtsPanels data={data} /></LazySection>
      <div className="grid gap-4 xl:grid-cols-2">
        <OnboardingFunnelPanel data={data} />
        <RecruiterFunnelPanel data={data} />
      </div>
    </div>
  );
}
