import { Banknote, Gauge, GraduationCap, Medal, Percent, Receipt, Target } from "lucide-react";
import { KpiTiles, Panel, SectionTitle, TablePanel } from "../../kit";
import type { EmployeeDashboardData } from "../../reference-dashboard-model";
import { asNumber } from "../../reference-dashboard-model";
import type { InsightIndex } from "./insightIndex";

/** Last payslips + YTD, KPI vs target with peer standing, learning/goals and engagement points. */
export function PayAndPerformance({ ix, loading, employee }: { ix: InsightIndex; loading: boolean; employee: EmployeeDashboardData }) {
  const pay = ix.kpis(["pay_latest_net", "pay_ytd_gross", "pay_ytd_tds"]);
  const perf = ix.kpis(["kpi_score", "kpi_percentile", "learn_progress", "goals"]);
  const eng = employee.engagement;
  const points = asNumber(eng.total_points);
  const toNext = asNumber(eng.points_to_next_tier);
  const tier = typeof eng.current_tier === "string" ? eng.current_tier : null;
  const payslips = ix.table("payslips");
  const kpiTable = ix.table("kpi_metrics");
  const kpiErr = ix.sectionErrors.kpi;
  return (
    <div className="space-y-4">
      <SectionTitle hint="Your own pay data only">Pay</SectionTitle>
      <KpiTiles kpis={pay} loading={loading} cols={3} icons={{ pay_latest_net: Banknote, pay_ytd_gross: Receipt, pay_ytd_tds: Percent }} />
      {payslips ? <TablePanel table={payslips} /> : null}

      <SectionTitle hint="Month to date vs your targets">Performance & growth</SectionTitle>
      <KpiTiles kpis={perf} loading={loading} cols={4} icons={{ kpi_score: Gauge, kpi_percentile: Medal, learn_progress: GraduationCap, goals: Target }} />
      {kpiErr ? <p className="text-[12px] text-amber-700">KPI data could not be loaded right now.</p> : null}
      {kpiTable ? <TablePanel table={kpiTable} /> : null}
      <Panel title="Engagement" subtitle={tier ? `Tier: ${tier}` : undefined} href="/engagement" hrefLabel="Open engagement">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Points</p><p className="kit-num text-[28px] font-extrabold text-slate-900">{points === null ? "—" : points.toLocaleString("en-IN")}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">To next tier</p><p className="kit-num text-[20px] font-bold text-slate-800">{toNext === null ? "—" : toNext.toLocaleString("en-IN")}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Surveys done</p><p className="kit-num text-[20px] font-bold text-slate-800">{asNumber(eng.surveys_completed) ?? "—"}</p></div>
        </div>
      </Panel>
    </div>
  );
}
