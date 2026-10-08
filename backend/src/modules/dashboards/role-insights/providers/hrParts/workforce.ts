import { buildScopeWhere } from "../../../../../shared/dashboardScope.js";
import { excludeEmployeeShapedCandidatesSql } from "../../../../ats/ats-reporting-scope.js";
import { num, pct, rows, one, toneFor } from "../../helpers.js";
import type { InsightContext, InsightKpi, InsightPoint, InsightSection, InsightSignal } from "../../types.js";
import { PENDENCY_CUTOFF_DATE, int, lit, memoized, monthLabel, monthStart } from "./shared.js";
import { groupMovement, loadRoster, monthEndHeadcount, monthlyCounts, movement, nameLookup, reasonCoverage, tenureDistribution, type GroupRow } from "./roster.js";

export async function headcountMovementSection(ctx: InsightContext): Promise<InsightSection> {
  const t = ctx.today;
  const [m, roster] = await Promise.all([movement(ctx), loadRoster(ctx)]);
  const months = Array.from({ length: 12 }, (_, i) => monthStart(t, 11 - i).slice(0, 7));
  const { joins, exits } = monthlyCounts(roster, t, months);
  const hc = monthEndHeadcount(m.hcNow, months, joins, exits);
  const points: InsightPoint[] = months.map((mo, i) => ({ label: monthLabel(mo), joins: joins.get(mo) ?? 0, exits: exits.get(mo) ?? 0, net: (joins.get(mo) ?? 0) - (exits.get(mo) ?? 0), headcount: hc[i] }));
  const net = m.joins - m.exits;
  const earlyShare = m.exits > 0 ? pct(m.earlyExits, m.exits) : null;
  const kpis: InsightKpi[] = [
    { key: "joins30", label: "Joins (30d)", value: m.joins, delta: m.joins - m.joinsPrev, deltaLabel: "vs previous 30d", tone: "green",
      formula: "Employees whose date of joining falls in the last 30 days, including any who have since left", helper: "joined, still here or not", href: "/employees" },
    { key: "exits30", label: "Exits (30d)", value: m.exits, delta: m.exits - m.exitsPrev, deltaLabel: "vs previous 30d", higherIsBetter: false, tone: "red",
      formula: "Inactive employees whose exit date (date_of_exit, else date_of_leaving) falls in the last 30 days", helper: "by exit date, not notice date", href: "/exit/command-center" },
    { key: "net30", label: "Net movement (30d)", value: net, delta: net - (m.joinsPrev - m.exitsPrev), deltaLabel: "vs previous 30d", tone: net >= 0 ? "green" : "red",
      formula: "Joins minus exits over the same 30 days, both counted from the same population" },
    { key: "attrition30", label: "Attrition (30d)", value: m.attrition, unit: "percent", delta: m.attrition !== null && m.attritionPrev !== null ? Math.round((m.attrition - m.attritionPrev) * 10) / 10 : null,
      deltaLabel: "pp vs previous 30d", higherIsBetter: false, tone: toneFor(m.attrition, 5, 10, false),
      formula: "Exits in 30 days / average headcount, where average = (headcount 30 days ago + headcount today) / 2, both from join and exit dates",
      helper: "not annualised", unavailable: m.attrition === null ? "No headcount to measure against" : null, href: "/exit/command-center" },
    { key: "early-exits", label: "Exits under 90 days' tenure", value: earlyShare, unit: "percent", higherIsBetter: false, tone: toneFor(earlyShare, 25, 40, false),
      helper: `${m.earlyExits} of ${m.exits} exits in 30d`, unavailable: m.exits === 0 ? "No exits in the last 30 days" : null,
      formula: "Exits in the last 30 days with under 90 days between joining and exit / all exits in the same window" },
  ];
  const signals: InsightSignal[] = [];
  if (m.attrition !== null) {
    signals.push({ tone: m.attrition > 10 ? "bad" : m.attrition > 5 ? "watch" : "good", title: `Attrition ${m.attrition}% in 30 days`,
      detail: `${m.exits} exits on an average of ${Math.round((m.hcOpen + m.hcNow) / 2)} people. Good at 5% or less, watch to 10%, bad above (30-day window, not annualised).`, value: `${m.attrition}%`, href: "/exit/command-center" });
  }
  if (m.exits >= 5 && earlyShare !== null) {
    signals.push({ tone: earlyShare > 40 ? "bad" : earlyShare > 25 ? "watch" : "good", title: `${earlyShare}% of leavers had under 90 days' tenure`,
      detail: "High early exit points at hiring quality, process fit or the first-30-day experience rather than later-tenure churn.", value: `${m.earlyExits}/${m.exits}` });
  }
  signals.push({ tone: net < 0 ? "bad" : net === 0 ? "watch" : "good", title: net < 0 ? "Headcount is shrinking" : net === 0 ? "Headcount is flat" : "Headcount is growing", detail: `${m.joins} joined, ${m.exits} left in the last 30 days (net ${net >= 0 ? "+" : ""}${net}).`, value: net >= 0 ? `+${net}` : `${net}` });
  return {
    kpis,
    series: [
      { key: "movement", title: "Joins vs exits, 12 months", subtitle: "By join date and exit date. Current month is partial.", kind: "bar", points,
        keys: [{ key: "joins", label: "Joins", tone: "green" }, { key: "exits", label: "Exits", tone: "red" }], unit: "count", href: "/employees" },
      { key: "headcount-trend", title: "Month-end headcount", subtitle: "Worked back from today's headcount using the same joins and exits", kind: "area", points,
        keys: [{ key: "headcount", label: "Headcount", tone: "blue" }], unit: "count" },
    ],
    signals,
  };
}

function breakdownTable(key: string, title: string, dim: string, data: GroupRow[], names: Map<string, string>) {
  return {
    key, title, href: "/exit/command-center",
    columns: [
      { key: "name", label: dim }, { key: "headcount", label: "Headcount", unit: "count" as const, align: "right" as const },
      { key: "joins", label: "Joins", unit: "count" as const, align: "right" as const }, { key: "exits", label: "Exits", unit: "count" as const, align: "right" as const },
      { key: "attrition", label: "Attrition", unit: "percent" as const, align: "right" as const },
    ],
    rows: data.slice(0, 12).map((r) => ({ name: (r.id && names.get(r.id)) || "Unassigned", headcount: r.headcount, joins: r.joins, exits: r.exits, attrition: r.attrition })),
  };
}

export async function attritionBreakdownSection(ctx: InsightContext): Promise<InsightSection> {
  const t = ctx.today;
  const [roster, branches, processes] = await Promise.all([loadRoster(ctx), nameLookup("branch_master"), nameLookup("process_master")]);
  const dist = tenureDistribution(roster, t);
  const totalExits = dist.reduce((s, p) => s + p.value, 0);
  const { total: total90, withReason, top } = reasonCoverage(roster, t);
  const signals: InsightSignal[] = [];
  if (total90 >= 20) {
    const cover = pct(withReason, total90) as number;
    signals.push({ tone: cover < 50 ? "bad" : cover < 80 ? "watch" : "good", title: `Exit reason recorded for ${cover}% of leavers`,
      detail: `${withReason} of ${total90} exits in 90 days carry an attrition reason. Below that, why people leave cannot be analysed.`, value: `${cover}%`, href: "/exit/command-center" });
  }
  return {
    series: [
      { key: "tenure-at-exit", title: "Exits by tenure at exit (90 days)", subtitle: `${totalExits} exits. Share of leavers, not a rate: it shows when people leave, not how risky each tenure band is.`, kind: "bar",
        points: dist.map((p) => ({ label: p.label, value: p.value })), unit: "count" },
      withReason > 0
        ? { key: "exit-reasons", title: "Why people left (90 days)", subtitle: `Recorded for ${withReason} of ${total90} exits`, kind: "ranked", points: top.map(([label, value]) => ({ label, value })), unit: "count" }
        : { key: "exit-reasons", title: "Why people left (90 days)", kind: "ranked", points: [], unavailable: total90 > 0 ? `No attrition reason recorded for any of the ${total90} exits in 90 days` : "No exits in the last 90 days" },
    ],
    tables: [
      breakdownTable("attrition-branch", "Attrition by branch (30d)", "Branch", groupMovement(roster, t, (r) => r.branchId), branches),
      breakdownTable("attrition-process", "Attrition by process (30d)", "Process", groupMovement(roster, t, (r) => r.processId), processes),
    ],
    signals,
  };
}

/** Target seats = mandate + buffer; same arithmetic as getHiringAlertMetrics, grouped per branch+process so a pair with several mandate lines is not double-counted. */
export const hiringGap = memoized("wf.hiring", async (ctx: InsightContext) => {
  const sc = buildScopeWhere(ctx.scope, "wm.branch_id", "wm.process_id");
  const r = await rows(
    `SELECT pm.process_name AS process, bm.branch_name AS branch, SUM(wm.mandated_hc) AS mandate,
            SUM(wm.mandated_hc + CEIL(wm.mandated_hc * wm.buffer_pct / 100)) AS target, MAX(COALESCE(a.active_hc, 0)) AS active
       FROM workforce_mandate wm
       JOIN process_master pm ON pm.id = wm.process_id
       JOIN branch_master bm ON bm.id = wm.branch_id
       LEFT JOIN (SELECT branch_id, process_id, COUNT(*) AS active_hc FROM employees WHERE active_status = 1 GROUP BY branch_id, process_id) a
              ON a.branch_id = wm.branch_id AND a.process_id = wm.process_id
      WHERE wm.active_status = 1 AND (wm.effective_to IS NULL OR wm.effective_to >= ${lit(ctx.today)}) AND ${sc.sql}
      GROUP BY wm.branch_id, wm.process_id, pm.process_name, bm.branch_name`,
    sc.params,
  );
  return r.map((x) => ({ process: String(x.process), branch: String(x.branch), mandate: int(x.mandate), target: int(x.target), active: int(x.active), short: Math.max(0, int(x.target) - int(x.active)) }));
});

export function hiringCoverage(list: Array<{ target: number; active: number; short: number }>) {
  const target = list.reduce((s, x) => s + x.target, 0);
  const filled = list.reduce((s, x) => s + Math.min(x.active, x.target), 0);
  return { target, shortage: list.reduce((s, x) => s + x.short, 0), short: list.filter((x) => x.short > 0).length, coverage: pct(filled, target) };
}

export async function hiringSection(ctx: InsightContext): Promise<InsightSection> {
  const list = await hiringGap(ctx);
  if (!list.length) {
    return { kpis: [{ key: "hiring-gap", label: "Hiring gap", value: null, unavailable: "No active workforce mandate in scope", href: "/recruitment/job-requisition" }] };
  }
  const c = hiringCoverage(list);
  const top = [...list].sort((a, b) => b.short - a.short).slice(0, 10);
  return {
    kpis: [
      { key: "hiring-gap", label: "Seats to hire", value: c.shortage, higherIsBetter: false, tone: c.shortage === 0 ? "green" : c.shortage > 50 ? "red" : "amber",
        helper: `${c.short} of ${list.length} processes short`, formula: "Per process: MAX(0, mandate + buffer seats - active employees), summed", href: "/recruitment/job-requisition" },
      { key: "mandate-coverage", label: "Mandate coverage", value: c.coverage, unit: "percent", tone: toneFor(c.coverage, 100, 90),
        formula: "Seats filled (capped at target per process) / target seats (mandate + buffer)", helper: `${c.target.toLocaleString("en-IN")} target seats`, href: "/recruitment/job-requisition" },
    ],
    series: [{ key: "hiring-gap-ranked", title: "Hiring gap by process (seats short)", kind: "ranked", unit: "count", href: "/recruitment/job-requisition",
      points: top.filter((x) => x.short > 0).map((x) => ({ label: `${x.process} · ${x.branch}`, value: x.short })) }],
    tables: [{ key: "hiring-table", title: "Mandate vs on roll", href: "/recruitment/job-requisition",
      columns: [{ key: "process", label: "Process" }, { key: "branch", label: "Branch" }, { key: "target", label: "Target", unit: "count", align: "right" }, { key: "active", label: "Active", unit: "count", align: "right" }, { key: "short", label: "Short", unit: "count", align: "right" }],
      rows: top }],
    signals: c.shortage > 0 ? [{ tone: c.coverage !== null && c.coverage < 90 ? "bad" : "watch", title: `${c.shortage} seats short across ${c.short} processes`,
      detail: `Mandate coverage ${c.coverage ?? "n/a"}%. Largest gap: ${top[0].process} (${top[0].branch}) short by ${top[0].short}.`, value: c.shortage, href: "/recruitment/job-requisition" }] : [],
  };
}

const CUTOFF = lit(PENDENCY_CUTOFF_DATE);
const FUNNEL: Array<{ label: string; statuses: string[] }> = [
  { label: "Raised", statuses: ["pending", "in_progress", "approved", "selected", "onboarding_link_sent", "profile_in_progress"] },
  { label: "Profile submitted", statuses: ["profile_submitted", "hr_review", "hr_pushback"] },
  { label: "HR approved", statuses: ["hr_approved"] },
  { label: "Offer & approvals", statuses: ["offer_draft", "offer_submitted", "branch_head_pending", "branch_head_approved", "payroll_hr_pending", "payroll_hr_approved", "payroll_pending", "payroll_approved"] },
  { label: "BGV & appointment", statuses: ["bgv_pending", "bgv_completed", "appointment_pending", "appointment_sent", "appointment_signed"] },
  { label: "Joined", statuses: ["employee_creation_pending", "employee_created", "onboarded"] },
];

/** Cumulative funnel: a request sitting at stage k has passed every earlier stage. Rejected / cancelled are dropped, not stages. */
export function onboardingFunnel(counts: Record<string, number>): Array<{ label: string; value: number }> {
  const perStage = FUNNEL.map((s) => s.statuses.reduce((n, st) => n + (counts[st] ?? 0), 0));
  return FUNNEL.map((s, i) => ({ label: s.label, value: perStage.slice(i).reduce((a, b) => a + b, 0) }));
}

export async function onboardingSection(ctx: InsightContext): Promise<InsightSection> {
  const t = ctx.today;
  const genuine = excludeEmployeeShapedCandidatesSql("cand");
  const sc = buildScopeWhere(ctx.scope, "bm.id", "pm.id");
  const base = `FROM ats_onboarding_request r JOIN ats_candidate cand ON cand.id = r.candidate_id
       LEFT JOIN branch_master bm ON bm.id = r.branch_id LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
      WHERE ${genuine} AND LOWER(COALESCE(cand.status, '')) NOT IN ('rejected', 'no show', 'inactive') AND r.created_at >= ${CUTOFF} AND ${sc.sql}`;
  const [byStatus, ages, tat] = await Promise.all([
    rows(`SELECT r.status AS status, COUNT(*) AS n ${base} GROUP BY r.status`, sc.params),
    rows(`SELECT CASE WHEN DATEDIFF(${lit(t)}, DATE(r.created_at)) <= 2 THEN 0 WHEN DATEDIFF(${lit(t)}, DATE(r.created_at)) <= 7 THEN 1
                      WHEN DATEDIFF(${lit(t)}, DATE(r.created_at)) <= 14 THEN 2 WHEN DATEDIFF(${lit(t)}, DATE(r.created_at)) <= 30 THEN 3 ELSE 4 END AS b, COUNT(*) AS n
            ${base} AND r.status NOT IN ('rejected', 'cancelled', 'onboarded', 'employee_created', 'employee_creation_pending') GROUP BY b`, sc.params),
    one(`SELECT COUNT(*) AS n, AVG(DATEDIFF(b.converted_at, b.created_at)) AS avg_days
           FROM ats_onboarding_bridge b JOIN ats_candidate cand ON cand.id = b.candidate_id
           LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
          WHERE b.converted_at IS NOT NULL AND b.converted_at >= DATE_SUB(${lit(t)}, INTERVAL 90 DAY) AND ${genuine} AND ${sc.sql}`, sc.params),
  ]);
  const counts: Record<string, number> = {};
  for (const r of byStatus) counts[String(r.status)] = int(r.n);
  // Later stages (BGV, appointment, joined) are not written back to onboarding requests in this database; a trailing run of zeros would read as "nobody got there".
  const full = onboardingFunnel(counts);
  const lastLive = full.reduce((idx, s, i) => (s.value > 0 ? i : idx), 0);
  const funnel = full.slice(0, lastLive + 1);
  const dropped = (counts.rejected ?? 0) + (counts.cancelled ?? 0);
  const labels = ["0-2 days", "3-7 days", "8-14 days", "15-30 days", "30+ days"];
  const bucket = new Map(ages.map((r) => [int(r.b), int(r.n)]));
  const openTotal = [...bucket.values()].reduce((a, b) => a + b, 0);
  const tatN = int(tat?.n);
  return {
    kpis: [{ key: "onboarding-tat", label: "Raise-to-join TAT", value: tatN > 0 ? Math.round(Number(tat?.avg_days) * 10) / 10 : null, unit: "days", higherIsBetter: false,
      helper: tatN > 0 ? `${tatN} joiners converted in last 90d` : undefined, unavailable: tatN === 0 ? "No onboarding converted to an employee in the last 90 days" : null,
      formula: "Average days from the onboarding bridge being created to the candidate being converted to an employee, for conversions in the last 90 days", href: "/ats/onboarding-requests" }],
    series: [
      { key: "onboarding-funnel", title: "Onboarding funnel", subtitle: `Requests raised since 25 Aug that reached each stage · ${dropped} rejected or cancelled · later stages are not written back to requests`, kind: "funnel", href: "/ats/onboarding-requests", points: funnel },
      { key: "onboarding-age", title: "Open onboarding by age", subtitle: `${openTotal} open requests, age since raised`, kind: "bar", unit: "count", href: "/ats/onboarding-requests", points: labels.map((label, i) => ({ label, value: bucket.get(i) ?? 0 })) },
    ],
    signals: openTotal >= 10 && (bucket.get(4) ?? 0) / openTotal > 0.25
      ? [{ tone: "watch", title: `${bucket.get(4)} onboarding requests are over 30 days old`, detail: "Requests this old rarely convert; close or chase them so the funnel reflects real joiners.", value: bucket.get(4) ?? 0, href: "/ats/onboarding-requests" }] : [],
  };
}
