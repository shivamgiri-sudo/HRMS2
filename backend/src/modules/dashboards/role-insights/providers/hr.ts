import type { InsightProvider } from "../types.js";
import { leaveAndAttendanceQueues, exitQueues, onboardingQueues, miscQueues } from "./hrParts/queues.js";
import { movement } from "./hrParts/roster.js";
import { headcountMovementSection, attritionBreakdownSection, hiringSection, hiringGap, hiringCoverage, onboardingSection } from "./hrParts/workforce.js";
import { attendanceSection, leaveSection, calendarSection, complianceSection, peopleHealthSection } from "./hrParts/people.js";
import { composeHealth, scoreBetween } from "./hrParts/shared.js";
import type { InsightContext, InsightSection } from "../types.js";

/** Composite people-ops health from the same memoised loaders the other sections use, so it costs no extra queries. */
async function healthSection(ctx: InsightContext): Promise<InsightSection> {
  const [mv, hire, queues] = await Promise.allSettled([
    movement(ctx), hiringGap(ctx),
    Promise.all([leaveAndAttendanceQueues(ctx), exitQueues(ctx), onboardingQueues(ctx), miscQueues(ctx)]),
  ]);
  const attr = mv.status === "fulfilled" ? mv.value.attrition : null;
  const coverage = hire.status === "fulfilled" && hire.value.length ? hiringCoverage(hire.value).coverage : null;
  let responsiveness: number | null = null;
  if (queues.status === "fulfilled") {
    const all = queues.value.flat();
    const open = all.reduce((s, a) => s + (a.count ?? 0), 0);
    const overdue = all.reduce((s, a) => s + (a.overdue ?? 0), 0);
    responsiveness = open > 0 ? Math.round(Math.max(0, 100 - (overdue / open) * 100)) : 100;
  }
  const { score, basis } = composeHealth([
    { label: "Retention (30d attrition 3% = 100, 15% = 0)", score: scoreBetween(attr, 3, 15), weight: 35 },
    { label: "Staffing (mandate coverage)", score: coverage === null ? null : Math.round(Math.min(100, coverage)), weight: 30 },
    { label: "Responsiveness (share of open items not overdue)", score: responsiveness, weight: 35 },
  ]);
  return { healthScore: score, healthBasis: basis };
}

/** HR_DASHBOARD insights. Sections run in parallel; each returns actions/kpis/series/tables/signals. */
const provider: InsightProvider = {
  sections: {
    queueLeaveAttendance: async (ctx) => ({ actions: await leaveAndAttendanceQueues(ctx) }),
    queueExit: async (ctx) => ({ actions: await exitQueues(ctx) }),
    queueOnboarding: async (ctx) => ({ actions: await onboardingQueues(ctx) }),
    queueMisc: async (ctx) => ({ actions: await miscQueues(ctx) }),
    headcountMovement: headcountMovementSection,
    attritionBreakdown: attritionBreakdownSection,
    hiring: hiringSection,
    onboarding: onboardingSection,
    attendance: attendanceSection,
    leave: leaveSection,
    calendar: calendarSection,
    compliance: complianceSection,
    peopleHealth: peopleHealthSection,
    health: healthSection,
  },
};

export default provider;
