import type { ReactNode } from "react";
import { Banknote, Gauge, Percent, ShieldAlert, TrendingDown, TrendingUp, UserMinus, UserPlus, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { BarsChart, HealthRing, PulseTile, type RoleInsights } from "../../kit";
import type { CeoModel } from "./ceoModel";
import { drillTo, kpiOf } from "./ceoModel";

function Pillar({ title, hint, accent, children, className }: { title: string; hint: string; accent: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-3xl bg-slate-50/80 p-3 ring-1 ring-slate-200/70 sm:p-4", className)}>
      <header className="mb-3 flex items-baseline gap-2 px-1">
        <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", accent)} />
        <h2 className="text-[13px] font-extrabold uppercase tracking-[.14em] text-slate-700">{title}</h2>
        <span className="truncate text-[12px] text-slate-400">{hint}</span>
      </header>
      {children}
    </section>
  );
}

/** Bento composition: three pillars (revenue / people / quality) with the headline number of each as the large tile. */
export function CeoPillars({ data, model, insights, loading }: { data: ReferenceDashboardData; model: CeoModel; insights?: RoleInsights; loading?: boolean }) {
  const k = (key: string) => kpiOf(insights?.kpis, key);
  const rev = model.revenue;
  const revTrend = (Array.isArray((data.pnl as { trend?: unknown }).trend) ? ((data.pnl as { trend: Array<Record<string, unknown>> }).trend) : [])
    .map((r) => ({ label: String(r.month ?? "").slice(2), value: Number(r.revenue) || 0 }));
  const att = k("attendance_latest");
  const shr = k("shrinkage_latest");
  const attr = k("attrition_12m");
  const gap = k("hiring_gap");
  const insightWait = loading ? "Loading…" : undefined;
  // The P&L and workforce feeds load after the summary (secondaryLoading); skeleton instead of a false empty.
  const pnlWait = Boolean(data.secondaryLoading) && !Object.keys(data.pnl).length;

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Pillar title="Revenue" hint={model.pnlAsOf ? `P&L as of ${model.pnlAsOf}` : "Finance P&L"} accent="bg-violet-500" className="xl:col-span-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <PulseTile size="hero" label={rev.month ? `Revenue — ${rev.month}` : "Revenue"} value={rev.revenue} unit="inr" icon={Banknote} tone="violet"
              delta={!rev.inProgress && rev.revenue !== null && rev.priorRevenue !== null ? rev.revenue - rev.priorRevenue : null} deltaLabel={rev.inProgress ? "Month in progress" : "vs prior month"} spark={rev.spark}
              helper={`${rev.inProgress ? "Month in progress" : "Recognised revenue"}${model.processesTotal ? ` · modelled for ${model.processesModelled ?? 0} of ${model.processesTotal} processes` : ""}`}
              formula="Recognised revenue for the selected P&L period from the P&L engine (/api/finance/pnl/summary)"
              href="/finance/process-pnl" loading={pnlWait} unavailable={rev.revenue === null && !pnlWait ? "No recognised revenue in the P&L" : null} />
          </div>
          <PulseTile label={rev.marginMonth ? `EBITDA margin — ${rev.marginMonth}` : "EBITDA margin"} value={rev.marginPct} unit="percent" icon={Percent} tone="violet"
            helper={rev.marginCaveat ?? "All cost booked"} unavailable={rev.marginPct === null ? rev.marginCaveat ?? "Not available" : null}
            formula="EBITDA ÷ recognised revenue for the latest month whose direct and indirect cost are both booked (an unfinalized payroll run or unposted GRNs would overstate margin)" href="/finance/process-pnl" loading={pnlWait} />
          <PulseTile label="Revenue at risk (MTD)" value={model.revenueAtRisk} unit="inr" icon={ShieldAlert} tone="red" higherIsBetter={false}
            unavailable={model.revenueRiskReason} helper="Sum of process_revenue_daily.revenue_at_risk" formula="Not a gap against target — no revenue target source is live" href="/finance/process-pnl" loading={pnlWait} />
          <PulseTile label="Loss-making processes" value={model.lossMaking} unit="count" icon={TrendingDown} tone={model.lossMaking ? "red" : "green"} higherIsBetter={false}
            helper={rev.marginCaveat ? "Counts booked cost only — may be understated" : "EBITDA negative after allocation"} formula="Processes whose P&L status is loss-making for the selected period" href="/finance/process-pnl" loading={pnlWait} />
          {model.receivable ? (
            <PulseTile label="Receivables outstanding" value={model.receivable} unit="inr" icon={Wallet} tone="amber" higherIsBetter={false}
              helper="Invoiced and not yet collected" formula="Σ outstanding receivable across processes (P&L engine)" href="/finance/process-pnl" loading={pnlWait} />
          ) : (
            // Nothing invoiced yet reads as "₹0 receivable" - true but misleading. Show what is actually open: revenue earned and not billed.
            <PulseTile label="Unbilled revenue" value={model.unbilled} unit="inr" icon={Wallet} tone="amber" higherIsBetter={false}
              helper={model.invoiced ? "Earned, not yet invoiced" : "Nothing invoiced or collected yet this period"} formula="Recognised revenue minus invoiced revenue (P&L engine). Receivables outstanding is ₹0 only because nothing has been invoiced." href="/finance/process-pnl" loading={pnlWait} />
          )}
          <div className="sm:col-span-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200/70">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Recognised revenue — last 6 months</p>
            {revTrend.length ? <BarsChart points={revTrend} unit="inr" height={120} /> : <p className="py-6 text-center text-[12px] text-slate-400">P&L trend unavailable</p>}
          </div>
        </div>
      </Pillar>

      <Pillar title="People" hint="Headcount · attendance · attrition · mandate" accent="bg-sky-500" className="xl:col-span-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <PulseTile label="Active headcount" value={model.active} icon={Users} tone="blue" href={drillTo("HEADCOUNT")} loading={data.loading && model.active === null}
            helper={k("net_flow_30d")?.helper ?? "Employee master"} deltaLabel={k("net_flow_30d")?.value != null ? "net 30 days" : undefined} delta={k("net_flow_30d")?.value ?? null} formula="Active employees whose joining date is on or before today" />
          <PulseTile label="Attendance" value={att?.value ?? model.attendance} unit="percent" icon={Gauge} tone={(att?.tone ?? "blue")} delta={att?.delta} deltaLabel={att?.deltaLabel ?? (model.attendanceAsOf ? `processed ${model.attendanceAsOf}` : undefined)}
            spark={att?.spark} formula={att?.formula} href={drillTo("ATTENDANCE")} unavailable={model.attendanceReason} loading={data.loading && model.attendance === null} />
          <PulseTile label="Shrinkage" value={shr?.value ?? model.shrinkage} unit="percent" icon={TrendingUp} tone={shr?.tone ?? "amber"} higherIsBetter={false} delta={shr?.delta} deltaLabel={shr?.deltaLabel ?? "latest processed day"}
            spark={shr?.spark} formula={shr?.formula} href={drillTo("ATTENDANCE")} helper={shr ? undefined : insightWait} />
          <PulseTile label="Attrition — 12 months" value={attr?.value ?? null} unit="percent" icon={UserMinus} tone={attr?.tone ?? "red"} higherIsBetter={false} spark={attr?.spark}
            helper={attr?.helper ?? insightWait} formula={attr?.formula} href={drillTo("RESIGNATION")} unavailable={attr?.unavailable} loading={loading && !attr} />
          <PulseTile label="Hiring gap" value={gap?.value ?? null} unit="count" icon={UserPlus} tone={gap?.tone ?? "amber"} higherIsBetter={false} helper={gap?.helper ?? insightWait}
            formula={gap?.formula} href={drillTo("HIRING_ALERT")} unavailable={gap?.unavailable} loading={loading && !gap} />
          <PulseTile label="Mandate fill" value={k("mandate_fill")?.value ?? null} unit="percent" icon={Percent} tone={k("mandate_fill")?.tone ?? "blue"} helper={k("mandate_fill")?.helper ?? insightWait}
            formula={k("mandate_fill")?.formula} href={drillTo("HIRING_ALERT")} loading={loading && !k("mandate_fill")} />
        </div>
      </Pillar>

      <Pillar title="Quality" hint="Last 30 days · audited calls" accent="bg-emerald-500" className="xl:col-span-3">
        <div className="grid gap-3">
          <div className="kit-card kit-rise flex flex-col items-center gap-2 p-4">
            {model.qualityScore !== null && !model.qualityNote ? (
              <HealthRing value={model.qualityScore} label={model.qualityTarget ? `Org quality vs target ${model.qualityTarget}` : "Org quality score"} size={104} />
            ) : data.qualityLoading ? (
              <div className="kit-shimmer h-[104px] w-[104px] rounded-full" aria-busy="true" aria-label="Loading quality score" />
            ) : (
              <p className="py-6 text-center text-[12px] text-amber-700">{model.qualityNote ?? "Quality score unavailable"}</p>
            )}
            {model.qualityGap !== null && !model.qualityNote ? (
              <p className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-bold", model.qualityGap > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                {Math.abs(model.qualityGap).toFixed(2)} pts {model.qualityGap > 0 ? "below" : "above"} target
              </p>
            ) : null}
          </div>
          <PulseTile label="Agents at risk" value={model.qualityNote ? null : model.riskAgents} icon={ShieldAlert} tone="red" higherIsBetter={false} unavailable={model.qualityNote} loading={Boolean(data.qualityLoading)}
            helper="Score under 70" formula="Agents with a 30-day average under 60 (critical) or 60-70 (at risk)" href="/quality/executive" />
        </div>
      </Pillar>
    </div>
  );
}
