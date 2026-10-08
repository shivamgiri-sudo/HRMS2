import type { ReactNode } from "react";
import { InsightGrid, KpiTiles, LazySection, Panel, SectionTitle } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { kpisOf, summaryFigures } from "./hrModel";

const pickS = (data: ReferenceDashboardData, keys: string[]) => (data.insights?.series ?? []).filter((s) => keys.includes(s.key));
const pickT = (data: ReferenceDashboardData, keys: string[]) => (data.insights?.tables ?? []).filter((t) => keys.includes(t.key));

/** Shows what the summary endpoint reports for the same measures, and why the corrected figures above differ. */
function Reconciliation({ data }: { data: ReferenceDashboardData }) {
  const f = summaryFigures(data);
  if (f.summaryJoins === null && f.summaryExits === null && f.summaryAttrition === null) return null;
  const fmt = (v: number | null, s = "") => (v === null ? "—" : `${v.toLocaleString("en-IN")}${s}`);
  return (
    <Panel title="Reconciliation with the summary feed" subtitle="Same measures as the tiles above, as the legacy workforce summary computes them">
      <p className="text-[12px] leading-5 text-slate-600">
        Summary feed: joins {fmt(f.summaryJoins)} (counts only people still active), exits {fmt(f.summaryExits)}, attrition {fmt(f.summaryAttrition, "%")} (leavers over closing headcount plus half the leavers).
        The tiles above count every joiner including those who already left, date exits by exit date, and divide by average headcount over the 30 days.
      </p>
    </Panel>
  );
}

/** Headcount movement, attrition, hiring gap. */
export function HrWorkforceSection({ data }: { data: ReferenceDashboardData }) {
  const loading = data.insightsLoading === true && !data.insights;
  return (
    <>
      <SectionTitle hint="from join and exit dates, 12 months">Headcount movement and attrition</SectionTitle>
      <InsightGrid series={pickS(data, ["movement", "headcount-trend", "tenure-at-exit", "exit-reasons"])} tables={pickT(data, ["attrition-branch", "attrition-process"])} loading={loading} />
      <LazySection minHeight={90}><Reconciliation data={data} /></LazySection>
      <SectionTitle hint="mandate plus buffer vs people on roll">Hiring gap</SectionTitle>
      <KpiTiles kpis={kpisOf(data.insights, ["hiring-gap", "mandate-coverage"])} loading={loading} cols={3} />
      <InsightGrid series={pickS(data, ["hiring-gap-ranked"])} tables={pickT(data, ["hiring-table"])} loading={loading} />
    </>
  );
}

/** Onboarding funnel and age; attendance discipline. */
export function HrOnboardingAttendanceSection({ data, extra }: { data: ReferenceDashboardData; extra?: ReactNode }) {
  const loading = data.insightsLoading === true && !data.insights;
  return (
    <>
      <SectionTitle hint="requests raised since 25 Aug">Onboarding funnel and turnaround</SectionTitle>
      <KpiTiles kpis={kpisOf(data.insights, ["onboarding-tat"])} loading={loading} cols={3} />
      <InsightGrid series={pickS(data, ["onboarding-funnel", "onboarding-age"])} loading={loading} />
      {extra}
      <SectionTitle hint="latest completely processed day">Attendance discipline</SectionTitle>
      <KpiTiles kpis={kpisOf(data.insights, ["att-rate", "late-rate", "absent-rate", "long-absent"])} loading={loading} cols={4} />
      <InsightGrid series={pickS(data, ["att-week"])} tables={pickT(data, ["long-absentees"])} loading={loading} />
    </>
  );
}

/** Leave liability, compliance gaps, calendar, engagement. */
export function HrPeopleSection({ data }: { data: ReferenceDashboardData }) {
  const loading = data.insightsLoading === true && !data.insights;
  return (
    <>
      <SectionTitle hint="balances, statutory and profile gaps">Leave liability and compliance</SectionTitle>
      <KpiTiles kpis={kpisOf(data.insights, ["on-leave-today", "el-balance", "el-liability", "no-uan", "no-bank", "no-pan"])} loading={loading} cols={6} />
      <InsightGrid tables={pickT(data, ["profile-gaps"])} loading={loading} />
      <SectionTitle hint="next 7 days">Birthdays, anniversaries and engagement</SectionTitle>
      <KpiTiles kpis={kpisOf(data.insights, ["birthdays-week", "anniversaries-week", "engagement-score", "engagement-risk", "lms-readiness"])} loading={loading} cols={5} />
      <InsightGrid tables={pickT(data, ["birthdays", "anniversaries"])} loading={loading} />
    </>
  );
}

