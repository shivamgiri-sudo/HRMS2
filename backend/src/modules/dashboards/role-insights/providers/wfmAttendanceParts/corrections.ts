import type { RowDataPacket } from "mysql2";
import { num, rows, toneFor } from "../../helpers.js";
import type { InsightContext, InsightSection } from "../../types.js";
import { queueAction, REG_SLA_DAYS } from "../wfmParts/queues.js";
import { ageBucket, biometricFreshness, composite, dailyAttendance, idFilter, ratio, shortDate, unreconciledPct } from "../wfmParts/shared.js";

/** Regularisation ageing, payroll-lock countdown and the integrity health score. */

/** Pure: whole days from today to the cutoff (negative = passed), null when no cutoff is configured. */
export function daysToCutoff(cutoff: string | null, today: string): number | null {
  if (!cutoff) return null;
  return Math.round((Date.parse(`${cutoff.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export const AGE_BUCKETS = ["0-1d", "2-3d", "4-7d", "8d+"] as const;

/** Pure: bucket the open requests' ages and find the median. */
export function ageProfile(ages: number[]) {
  const counts = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0])) as Record<(typeof AGE_BUCKETS)[number], number>;
  for (const a of ages) { const b = ageBucket(a); if (b) counts[b] += 1; }
  const sorted = [...ages].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
  return { counts, median, withinSla: ages.length ? ratio(ages.filter((a) => a <= REG_SLA_DAYS).length, ages.length) : null };
}

/** The correction queue: ageing buckets, who must act next, payroll-impacting requests, by type. */
export async function correctionQueueSection(ctx: InsightContext): Promise<InsightSection> {
  const s = await idFilter(ctx, "r.employee_id", "active");
  const r = await rows<RowDataPacket>(
    `SELECT r.status, COALESCE(r.dispute_type,'(none)') AS type, DATEDIFF(CURDATE(), r.created_at) AS age, COALESCE(r.payroll_impact,'') AS impact
       FROM attendance_regularization r WHERE r.status IN ('pending','manager_approved')${s.sql}`,
    s.params,
  );
  const ages = r.map((x) => Math.max(0, num(x.age) ?? 0));
  const prof = ageProfile(ages);
  const waitingManager = r.filter((x) => x.status === "pending").length, waitingWfm = r.length - waitingManager;
  const byType = new Map<string, { n: number; oldest: number }>();
  for (const x of r) { const t = String(x.type); const c = byType.get(t) ?? { n: 0, oldest: 0 }; byType.set(t, { n: c.n + 1, oldest: Math.max(c.oldest, num(x.age) ?? 0) }); }
  const overdue = ages.filter((a) => a > REG_SLA_DAYS).length;
  const oldest = ages.length ? Math.max(...ages) : null;
  return {
    kpis: [{ key: "reg_median_age", label: "Median request age", value: prof.median, unit: "days", higherIsBetter: false, tone: toneFor(prof.median, 2, 4, false), href: "/attendance-regularization",
      helper: prof.withinSla === null ? undefined : `${prof.withinSla}% within the ${REG_SLA_DAYS}-day SLA`, formula: "Median days since creation of open (pending / manager-approved) regularisation requests. SLA is a product convention, not stored data.", unavailable: prof.median === null ? "No open correction requests" : null }],
    series: [{ key: "reg_age", title: "Correction queue ageing", subtitle: `${r.length} open request${r.length === 1 ? "" : "s"} by days waiting`, kind: "bar", unit: "count", href: "/attendance-regularization", keys: [{ key: "value", label: "Requests", tone: "amber" }],
      points: AGE_BUCKETS.map((b) => ({ label: b, value: prof.counts[b] })) }],
    tables: [{ key: "reg_by_type", title: "Open corrections by type", href: "/attendance-regularization",
      columns: [{ key: "type", label: "Type" }, { key: "n", label: "Open", align: "right" }, { key: "oldest", label: "Oldest (days)", align: "right" }],
      rows: [...byType.entries()].sort((a, b) => b[1].n - a[1].n).map(([type, v]) => ({ type: type.replace(/_/g, " "), n: v.n, oldest: v.oldest })) }],
    signals: overdue > 0 ? [{ tone: "bad", title: `${overdue} corrections older than ${REG_SLA_DAYS} days`, detail: `Oldest has waited ${oldest} days. Each unresolved one posts as absent or LOP at payroll.`, value: overdue, href: "/attendance-regularization" }] : [],
  };
}

/** Attendance cutoff countdown. The payroll calendar is the source; with none configured it is shown as unavailable. */
export async function payrollLockSection(ctx: InsightContext): Promise<InsightSection> {
  const [cal, run, blockers] = await Promise.all([
    rows<RowDataPacket>(`SELECT calendar_month AS m, DATE_FORMAT(attendance_cutoff_date,'%Y-%m-%d') AS d FROM payroll_calendar WHERE attendance_cutoff_date >= CURDATE() ORDER BY attendance_cutoff_date LIMIT 1`).catch(() => [] as RowDataPacket[]),
    rows<RowDataPacket>(`SELECT run_month AS m, status, attendance_snapshot_locked AS locked FROM salary_prep_run WHERE run_month = ? LIMIT 1`, [ctx.today.slice(0, 7)]).catch(() => [] as RowDataPacket[]),
    rows<RowDataPacket>(`SELECT COUNT(*) AS n FROM attendance_reconciliation_issue WHERE resolved_at IS NULL AND severity = 'blocker' AND issue_date >= ?`, [`${ctx.today.slice(0, 7)}-01`]),
  ]);
  const cutoff = (cal[0]?.d as string | undefined) ?? null;
  const left = daysToCutoff(cutoff, ctx.today);
  const open = num(blockers[0]?.n) ?? 0;
  const locked = Number(run[0]?.locked ?? 0) === 1;
  return {
    kpis: [{ key: "payroll_lock", label: "Days to attendance cutoff", value: left, unit: "days", higherIsBetter: true, tone: left === null ? "slate" : left <= 2 ? "red" : left <= 5 ? "amber" : "green", href: "/wfm/attendance-integrity?tab=mismatches",
      helper: cutoff ? `${open.toLocaleString("en-IN")} blockers open this month; cutoff ${shortDate(cutoff)}${locked ? " (snapshot locked)" : ""}` : `${open.toLocaleString("en-IN")} blockers open this month`,
      formula: "Next attendance_cutoff_date in payroll_calendar. After it, unresolved blockers and pending corrections flow into payroll as they stand.", unavailable: left === null ? "No attendance cutoff set in the payroll calendar" : null }],
    actions: [queueAction({ id: "month_blockers", label: "This month's attendance blockers before payroll", count: open, href: "/wfm/attendance-integrity?tab=mismatches", hint: cutoff ? `cutoff in ${left} day${left === 1 ? "" : "s"}` : "no cutoff configured", group: "Payroll lock", high: 50, critical: 500 })],
    signals: left !== null && left <= 3 && open > 0 ? [{ tone: "bad", title: `${open.toLocaleString("en-IN")} blockers with ${left} day${left === 1 ? "" : "s"} to cutoff`, detail: "Clear or correct these now or payroll will take them as they are.", value: open, href: "/wfm/attendance-integrity?tab=mismatches" }] : [],
  };
}

/** Composite data-integrity health from measurable inputs only. */
export async function integrityHealthSection(ctx: InsightContext): Promise<InsightSection> {
  const [days, f, s] = await Promise.all([dailyAttendance(ctx), biometricFreshness(ctx), idFilter(ctx, "r.employee_id", "active")]);
  const reg = await rows<RowDataPacket>(`SELECT COUNT(*) AS n, SUM(r.created_at >= DATE_SUB(NOW(), INTERVAL ${REG_SLA_DAYS} DAY)) AS ok FROM attendance_regularization r WHERE r.status IN ('pending','manager_approved')${s.sql}`, s.params);
  const last = days[days.length - 1];
  const reconciled = last ? 100 - (unreconciledPct(last) ?? 0) : null;
  const slaOk = num(reg[0]?.n) ? ratio(num(reg[0]?.ok), num(reg[0]?.n)) : null;
  const fresh = f.dailyFeedLagH === null ? null : f.dailyFeedLagH <= 6 ? 100 : f.dailyFeedLagH <= 24 ? 60 : 20;
  const score = composite([reconciled, slaOk, fresh]);
  return {
    healthScore: score,
    healthBasis: score === null ? null : `Average of: processed day reconciled ${reconciled ?? "n/a"}%, corrections within SLA ${slaOk ?? "n/a"}%, biometric feed freshness ${fresh ?? "n/a"}/100. Inputs that cannot be measured are left out, not scored 0.`,
  };
}
