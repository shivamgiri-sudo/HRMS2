import type { InsightProvider, InsightSection } from "../types.js";
import { leaveConflictSection, liveFloorSection, loginCurveSection, publishHealthSection, publishWindow, rosterHeatSection, liveFloor, floorTotals } from "./wfmParts/floor.js";
import { integrityQueue, pendingLeaveQueue, regularizationQueues, rosterRequestQueues } from "./wfmParts/queues.js";
import { absconderSection, attendanceKpiSection, breakSection, forecastSection, shrinkageByProcess } from "./wfmParts/trends.js";
import { anchorDate, attendanceRate, biometricFreshness, composite, dailyAttendance, lagTone, publishPct } from "./wfmParts/shared.js";
import type { InsightContext } from "../types.js";

/**
 * WFM_DASHBOARD insights: the live shift floor. Sections are independent and run in parallel; heavy
 * inputs (daily attendance, roster publish window, live floor) are memoised per request in wfmParts.
 */

/** COSEC pipeline freshness as a KPI + signal (the WFM desk owns the biometric feed). */
async function syncSection(ctx: InsightContext): Promise<InsightSection> {
  const f = await biometricFreshness(ctx);
  const rawStale = f.rawPunchLagH !== null && f.rawPunchLagH > 48;
  return {
    kpis: [{ key: "biometric_lag", label: "Biometric feed lag", value: f.dailyFeedLagH, unit: "hours", higherIsBetter: false, tone: lagTone(f.dailyFeedLagH), href: "/wfm/attendance-integrity?tab=biometric",
      helper: f.dailyFeedAt ? `daily feed updated ${f.dailyFeedAt} IST` : undefined,
      formula: "Hours since integration_biometric_daily (the feed attendance is built from) was last written, measured on the database clock.", unavailable: f.dailyFeedLagH === null ? "No biometric daily rows in the last 3 days" : null }],
    signals: [
      ...(f.dailyFeedLagH !== null && f.dailyFeedLagH > 24 ? [{ tone: "bad" as const, title: `Biometric daily feed is ${Math.round(f.dailyFeedLagH)}h old`, detail: "Attendance will under-count punches until the integration runs.", value: `${Math.round(f.dailyFeedLagH)}h`, href: "/wfm/attendance-integrity?tab=biometric" }] : []),
      ...(rawStale ? [{ tone: "watch" as const, title: `Raw COSEC punch table stopped at ${f.rawPunchAt}`, detail: "cosec_punch_sync has received nothing since then. Attendance still updates through the daily integration, but raw-punch drill-downs and the sync watermark are stale.", value: `${Math.round((f.rawPunchLagH ?? 0) / 24)}d`, href: "/wfm/attendance-integrity?tab=biometric" }] : []),
    ],
  };
}

/** Composite floor health from whatever is measurable. Basis text names every input. */
async function healthSection(ctx: InsightContext): Promise<InsightSection> {
  const [days, pub, floor, anchor] = await Promise.all([dailyAttendance(ctx), publishWindow(ctx), liveFloor(ctx), anchorDate(ctx)]);
  const last = days[days.length - 1];
  const rate = last ? attendanceRate(last) : null;
  const published = publishPct(pub.days);
  const fill = floorTotals(floor.rows).fillPct;
  const score = composite([rate, published, fill]);
  return {
    healthScore: score,
    healthBasis: score === null ? null : `Average of: attendance rate${anchor ? ` (${anchor})` : ""} ${rate ?? "n/a"}%, roster published next 14d ${published ?? "n/a"}%, live floor fill ${fill ?? "n/a"}%. Unmeasurable inputs are left out, not counted as 0.`,
    kpis: [], signals: score !== null && score < 60 ? [{ tone: "bad", title: `Floor health ${score}/100`, detail: "Attendance, roster publication and live login fill are all dragging.", value: score }] : [],
  };
}

const provider: InsightProvider = {
  sections: {
    health: healthSection,
    liveFloor: liveFloorSection,
    loginCurve: loginCurveSection,
    attendance: attendanceKpiSection,
    rosterHeat: rosterHeatSection,
    publishHealth: publishHealthSection,
    leaveConflicts: leaveConflictSection,
    shrinkageByProcess,
    forecast: forecastSection,
    absconders: absconderSection,
    breaks: breakSection,
    regularizations: regularizationQueues,
    rosterRequests: rosterRequestQueues,
    integrity: integrityQueue,
    pendingLeave: pendingLeaveQueue,
    sync: syncSection,
  },
};

export default provider;
