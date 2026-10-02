import { BadgeCheck, FileSignature, FileX2, GraduationCap, Hourglass, ShieldCheck, Target, TrendingDown, UserMinus, UserPlus, UsersRound } from "lucide-react";
import { KpiTiles, PulseGrid, PulseTile } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { metricUnavailableReason } from "../../reference-dashboard-model";
import { kpisOf, summaryFigures, tileTarget } from "./hrModel";

const ICONS = { joins30: UserPlus, exits30: UserMinus, net30: UsersRound, attrition30: TrendingDown, "early-exits": UserMinus } as const;

/** Headcount movement KPIs (insights) — loaded after the summary, so they show skeletons first. */
export function HrMovementTiles({ data }: { data: ReferenceDashboardData }) {
  const loading = data.insightsLoading === true && !data.insights;
  const kpis = kpisOf(data.insights, ["joins30", "exits30", "net30", "attrition30", "early-exits", "mandate-coverage"]);
  return (
    <KpiTiles
      kpis={kpis}
      loading={loading}
      cols={6}
      icons={{ ...ICONS, "mandate-coverage": Target }}
      onDrill={(k) => k.drill && data.openDrill?.(k.drill.metricCode, k.label, k.drill.filters)}
    />
  );
}

/**
 * Pipeline and compliance tiles, fed straight from the summary so they paint with the hero.
 * Each opens the metric's drill-down drawer, or the page that owns the work when the metric has none.
 */
export function HrPipelineTiles({ data }: { data: ReferenceDashboardData }) {
  const f = summaryFigures(data);
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));
  const m = data.metrics;
  const settling = data.secondaryLoading === true;
  const docPct = f.docsMissing !== null && f.headcount ? Math.round((f.docsMissing / f.headcount) * 1000) / 10 : null;
  return (
    <PulseGrid cols={4}>
      <PulseTile label="Total employees" icon={UsersRound} tone="blue" value={f.headcount} helper="active, joined on or before today" {...tileTarget(drill, "hc", "/employees")} />
      <PulseTile label="Hiring shortage" icon={UserPlus} tone={f.shortage ? "red" : "green"} value={f.shortage} unit="count" suffix=" seats" higherIsBetter={false}
        helper={f.processesShort ? `${f.processesShort} process${f.processesShort === 1 ? "" : "es"} short` : undefined} unavailable={metricUnavailableReason(m, "hiringAlert")}
        {...tileTarget(drill, "hiringAlert", "/recruitment/job-requisition")} />
      <PulseTile label="Onboarding pending" icon={Target} tone="violet" value={f.onbPending} helper={f.onbStuck ? `${f.onbStuck} stuck` : "live requests since 25 Aug"} unavailable={metricUnavailableReason(m, "onb")}
        {...tileTarget(drill, "onb", "/ats/onboarding-requests")} />
      <PulseTile label="BGV pending" icon={ShieldCheck} tone={f.bgvFlagged ? "red" : "amber"} value={f.bgvPending} higherIsBetter={false}
        helper={f.bgvFlagged ? `${f.bgvFlagged} flagged` : "candidates, not checks"} unavailable={metricUnavailableReason(m, "bgv")} {...tileTarget(drill, "bgv", "/ats/bgv")} />
      <PulseTile label="Appointment e-sign" icon={FileSignature} tone="amber" value={f.appointmentEsign} higherIsBetter={false} unavailable={metricUnavailableReason(m, "appointmentEsign")}
        helper="letters awaiting a signature" {...tileTarget(drill, "appointmentEsign", "/provisioning/appointment-letter")} />
      <PulseTile label="Joining-doc e-sign" icon={FileSignature} tone="amber" value={f.joiningDocEsign} higherIsBetter={false} unavailable={metricUnavailableReason(m, "joiningDocEsign")}
        helper="documents awaiting a signature" {...tileTarget(drill, "joiningDocEsign", "/ats/joining-documents-tracker")} />
      <PulseTile label="Resignations in review" icon={Hourglass} tone={f.resignReview ? "amber" : "green"} value={f.resignReview} higherIsBetter={false} unavailable={metricUnavailableReason(m, "resign")}
        helper="submitted, manager, HR or admin review" {...tileTarget(drill, "resign", "/exit/command-center")} />
      <PulseTile label="No documents on file" icon={FileX2} tone="red" value={settling ? null : f.docsMissing} higherIsBetter={false} unavailable={metricUnavailableReason(m, "docCompliance")}
        helper={docPct !== null ? `${docPct}% of active employees` : undefined} {...tileTarget(drill, "docCompliance", "/document-verification")} />
      <PulseTile label="Pending leave" icon={Hourglass} tone="amber" value={settling ? null : f.leavePending} higherIsBetter={false}
        helper={f.legacyLeave ? `awaiting approval · ${f.legacyLeave.toLocaleString("en-IN")} legacy` : "awaiting approval"} {...tileTarget(drill, "leaveApprovals", "/leaves")} />
      <PulseTile label="Training complete" icon={GraduationCap} tone="blue" value={settling ? null : f.training} unit="percent" unavailable={metricUnavailableReason(m, "training")}
        helper="LMS completion rate" {...tileTarget(drill, "training", "/lms/progress-dashboard")} />
      <PulseTile label="Shrinkage" icon={BadgeCheck} tone="violet" value={settling ? null : f.shrinkage} unit="percent" higherIsBetter={false}
        helper="absent-equivalent / expected to work" href="/wfm-attendance" />
    </PulseGrid>
  );
}
