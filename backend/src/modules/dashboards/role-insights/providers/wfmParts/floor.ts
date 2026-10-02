import type { RowDataPacket } from "mysql2";
import { PRESENT_SESSION_STATUSES, statusList } from "../../../../../shared/attendanceStatus.js";
import { buildScopeWhere } from "../../../../../shared/dashboardScope.js";
import { empScope, lastDays, num, rows, severityFor, toneFor } from "../../helpers.js";
import type { InsightAction, InsightContext, InsightKpi, InsightSection, InsightSignal } from "../../types.js";
import {
  heavy, idFilter, PRESENT_IN, REAL_ROSTER, ROSTER_NOT_WORKING, activeHeadcount, anchorDate, daysSince, once, ratio, shortDate, weekdayShort,
} from "./shared.js";

/** Live shift floor (today), roster publish health, roster-vs-required and leave-vs-roster conflicts. */

const IN_NOW = statusList(PRESENT_SESSION_STATUSES);
const SHIFT_EXPR = `COALESCE(NULLIF(sm.shift_name,''), CONCAT(TIME_FORMAT(ra.shift_start_time,'%H:%i'),'-',TIME_FORMAT(ra.shift_end_time,'%H:%i')), 'Unassigned')`;

export interface FloorRow { shift: string; startAt: string | null; rostered: number; due: number; inNow: number; noShow: number }

/** Pure: roll shift rows into the floor headline numbers. */
export function floorTotals(r: FloorRow[]) {
  const sum = (k: keyof Omit<FloorRow, "shift" | "startAt">) => r.reduce((s, x) => s + x[k], 0);
  const rostered = sum("rostered"), due = sum("due"), inNow = sum("inNow"), noShow = sum("noShow");
  return { rostered, due, inNow, noShow, fillPct: ratio(inNow, due) };
}

/** Roster rows for today by shift with live login state. "Due" = shift already started. */
export const liveFloor = (ctx: InsightContext) =>
  once(ctx, "floor", async () => {
    const s = await idFilter(ctx, "ra.employee_id", "active");
    const [r, clock] = await Promise.all([
      rows<RowDataPacket>(
        `SELECT ${SHIFT_EXPR} AS shift, MIN(TIME_FORMAT(ra.shift_start_time,'%H:%i')) AS start_at, COUNT(*) AS rostered,
                SUM(ra.shift_start_time IS NOT NULL AND ra.shift_start_time <= CURTIME()) AS due,
                SUM(s.current_status IN (${IN_NOW})) AS in_now,
                SUM(ra.shift_start_time IS NOT NULL AND ra.shift_start_time <= CURTIME() AND s.id IS NULL) AS no_show
           FROM wfm_roster_assignment ra
           LEFT JOIN wfm_shift_master sm ON sm.id = ra.shift_id
           LEFT JOIN wfm_attendance_session s ON s.employee_id = ra.employee_id AND s.session_date = ra.roster_date
          WHERE ra.roster_date = ? AND ${REAL_ROSTER} AND NOT ${ROSTER_NOT_WORKING}${s.sql}
          GROUP BY shift ORDER BY rostered DESC LIMIT 12`,
        [ctx.today, ...s.params],
      ),
      rows(`SELECT DATE_FORMAT(NOW(),'%H:%i') AS t`),
    ]);
    const n = (v: unknown) => num(v) ?? 0;
    const list: FloorRow[] = r.map((x) => ({ shift: String(x.shift), startAt: (x.start_at as string) ?? null, rostered: n(x.rostered), due: n(x.due), inNow: n(x.in_now), noShow: n(x.no_show) }));
    return { rows: list, clock: String(clock[0]?.t ?? "") };
  });

/** Mandated headcount incl. shrinkage buffer (the same formula as the HEADCOUNT metric), or null if none configured. */
const requiredHc = (ctx: InsightContext) =>
  once(ctx, "required", async () => {
    const sc = buildScopeWhere(ctx.scope, "branch_id", "process_id");
    const r = await rows(`SELECT SUM(CEIL(mandated_hc * (1 + shrinkage_pct / 100))) AS hc FROM workforce_mandate WHERE active_status = 1 AND ${sc.sql}`, sc.params);
    return num(r[0]?.hc);
  });

export async function liveFloorSection(ctx: InsightContext): Promise<InsightSection> {
  const [floor, required, active] = await Promise.all([liveFloor(ctx), requiredHc(ctx), activeHeadcount(ctx)]);
  const t = floorTotals(floor.rows);
  const gap = required !== null ? Math.max(0, required - t.rostered) : null;
  const kpis: InsightKpi[] = [
    {
      key: "floor_fill", label: "Floor fill (logged in / due)", value: t.fillPct, unit: "percent", tone: toneFor(t.fillPct, 90, 75),
      helper: t.due ? `${t.inNow} of ${t.due} due by ${floor.clock} IST` : `No shift has started yet (${floor.clock} IST)`,
      formula: "Rostered working agents whose shift has started and who hold a live Logged In / Partial session, over rostered agents whose shift has started. Live; not the processed day.",
      href: "/wfm/live-tracker", unavailable: floor.rows.length ? null : "No roster rows for today in this scope",
    },
    {
      key: "no_show_now", label: "No-shows right now", value: floor.rows.length ? t.noShow : null, unit: "count", higherIsBetter: false,
      tone: t.noShow > 0 ? "red" : "green", helper: "shift started, no session yet", href: "/wfm/live-tracker",
      formula: "Rostered working agents whose shift start time has passed and who have no attendance session today.",
      unavailable: floor.rows.length ? null : "No roster rows for today in this scope",
    },
    {
      key: "roster_vs_required", label: "Roster vs required HC", value: required !== null && t.rostered ? ratio(t.rostered, required) : null, unit: "percent",
      tone: toneFor(ratio(t.rostered, required), 100, 90), href: "/wfm/capacity-dashboard",
      helper: required === null ? undefined : gap ? `${gap} open seat${gap === 1 ? "" : "s"} (${t.rostered} rostered / ${required} required)` : `${t.rostered} rostered / ${required} required`,
      formula: "Working agents rostered today over mandated headcount (workforce_mandate incl. its shrinkage buffer). Per-slot requirements (wfm_slot_requirement) are empty, so this is a day-level view.",
      unavailable: required === null ? "No active workforce mandate for this scope" : t.rostered ? null : "No roster rows for today",
    },
    {
      key: "roster_coverage", label: "Workforce on roster today", value: active && t.rostered ? ratio(t.rostered, active) : null, unit: "percent",
      tone: toneFor(ratio(t.rostered, active), 85, 60), href: "/wfm/roster-command-center",
      helper: active ? `${t.rostered} of ${active} active employees have a working roster row` : undefined,
      formula: "Active employees with a working-day roster row for today over active headcount in scope. Employees with no roster row are invisible to shift planning.",
      unavailable: active === null ? "Headcount unavailable" : null,
    },
  ];
  const signals: InsightSignal[] = [];
  if (t.noShow >= 5) signals.push({ tone: "bad", title: `${t.noShow} rostered agents have not logged in`, detail: `Their shift started but no session exists as of ${floor.clock} IST.`, value: t.noShow, href: "/wfm/live-tracker" });
  if (gap && gap > 0) signals.push({ tone: "watch", title: `${gap} seats short of mandated headcount`, detail: "Rostered working agents today are below the configured mandate.", value: gap, href: "/wfm/capacity-dashboard" });
  const actions: InsightAction[] = [];
  if (t.noShow > 0) actions.push({ id: "no_show", label: "Rostered agents not yet logged in", count: t.noShow, severity: severityFor(t.noShow, 5, 20), href: "/wfm/live-tracker", hint: `shift started, no session (${floor.clock} IST)`, group: "Live floor" });
  return {
    kpis, signals, actions,
    tables: [{
      key: "shift_floor", title: "Live shift floor", href: "/wfm/live-tracker",
      columns: [
        { key: "shift", label: "Shift" }, { key: "startAt", label: "Starts" }, { key: "rostered", label: "Rostered", align: "right" },
        { key: "due", label: "Due", align: "right" }, { key: "inNow", label: "Logged in", align: "right" }, { key: "noShow", label: "No-show", align: "right" }, { key: "fill", label: "Fill", unit: "percent", align: "right" },
      ],
      rows: floor.rows.map((x) => ({ ...x, fill: ratio(x.inNow, x.due) })),
      unavailable: floor.rows.length ? null : "No roster rows for today in this scope",
    }],
  };
}

/** Hourly login curve: today versus the last processed day, IST hours. */
export async function loginCurveSection(ctx: InsightContext): Promise<InsightSection> {
  const anchor = await anchorDate(ctx);
  const s = await idFilter(ctx, "s.employee_id", "scoped");
  const dates = anchor ? [ctx.today, anchor] : [ctx.today];
  const r = await rows<RowDataPacket>(
    `SELECT DATE_FORMAT(s.session_date,'%Y-%m-%d') AS d, HOUR(s.login_time) AS h, COUNT(*) AS n
       FROM wfm_attendance_session s
      WHERE s.session_date IN (${dates.map(() => "?").join(",")}) AND s.login_time IS NOT NULL${s.sql}
      GROUP BY s.session_date, HOUR(s.login_time)`,
    [...dates, ...s.params],
  );
  const grid = new Map(r.map((x) => [`${x.d}|${x.h}`, num(x.n) ?? 0]));
  const points = Array.from({ length: 24 }, (_, h) => ({
    label: `${String(h).padStart(2, "0")}:00`, today: grid.get(`${ctx.today}|${h}`) ?? 0, prev: anchor ? grid.get(`${anchor}|${h}`) ?? 0 : null,
  }));
  const total = points.reduce((a, p) => a + Number(p.today), 0);
  return {
    series: [{
      key: "login_curve", title: "Interval view: logins by hour", subtitle: anchor ? `Today vs ${shortDate(anchor)} (IST hours)` : "Today (IST hours)", kind: "area",
      keys: [{ key: "today", label: "Today", tone: "blue" }, ...(anchor ? [{ key: "prev", label: shortDate(anchor), tone: "slate" as const }] : [])],
      points, unit: "count", href: "/wfm/live-tracker", unavailable: total === 0 && !anchor ? "No login sessions yet" : null,
    }],
  };
}

export interface HeatCell { absent: number; late: number; adhered: number; rostered: number }
export type HeatKey = `${string}|${string}`;

/** Pure: shift x day grid -> table rows of percentages (null where nothing was rostered). */
export function heatRows(shifts: string[], dates: string[], cells: Map<HeatKey, HeatCell>, pick: (c: HeatCell) => number) {
  return shifts.map((shift) => {
    const row: Record<string, string | number | null> = { shift };
    dates.forEach((d, i) => { const c = cells.get(`${shift}|${d}`); row[`d${i}`] = c && c.rostered > 0 ? ratio(pick(c), c.rostered) : null; });
    return row;
  });
}

export interface HeatData { dates: string[]; cells: Map<HeatKey, HeatCell>; shifts: string[]; perDay: Map<string, HeatCell> }

async function loadHeat(ctx: InsightContext, anchor: string): Promise<HeatData> {
  const dates = lastDays(anchor, 7);
  const s = await idFilter(ctx, "ra.employee_id", "scoped");
  const r = await rows<RowDataPacket>(
    `SELECT ${SHIFT_EXPR} AS shift, DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d, COUNT(*) AS rostered,
            SUM(a.attendance_status = 'absent') AS absent,
            SUM(a.late_mark = 1) AS late,
            SUM(a.attendance_status IN (${PRESENT_IN})) AS adhered
       FROM wfm_roster_assignment ra
       LEFT JOIN wfm_shift_master sm ON sm.id = ra.shift_id
       LEFT JOIN attendance_daily_record a ON a.employee_id = ra.employee_id AND a.record_date = ra.roster_date
      WHERE ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER} AND NOT ${ROSTER_NOT_WORKING}${s.sql}
      GROUP BY shift, ra.roster_date`,
    [dates[0], anchor, ...s.params],
  );
  const n = (v: unknown) => num(v) ?? 0;
  const cells = new Map<HeatKey, HeatCell>();
  const volume = new Map<string, number>();
  const perDay = new Map<string, HeatCell>();
  for (const x of r) {
    const c = { rostered: n(x.rostered), absent: n(x.absent), late: n(x.late), adhered: n(x.adhered) };
    cells.set(`${x.shift}|${x.d}`, c);
    volume.set(String(x.shift), (volume.get(String(x.shift)) ?? 0) + c.rostered);
    const p = perDay.get(String(x.d)) ?? { rostered: 0, absent: 0, late: 0, adhered: 0 };
    perDay.set(String(x.d), { rostered: p.rostered + c.rostered, absent: p.absent + c.absent, late: p.late + c.late, adhered: p.adhered + c.adhered });
  }
  const shifts = [...volume.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  return { dates, cells, shifts, perDay };
}

/** Rostered working agents on the last 7 processed days, joined to processed attendance: absenteeism, late and adherence by shift. */
export async function rosterHeatSection(ctx: InsightContext): Promise<InsightSection> {
  const anchor = await anchorDate(ctx);
  const none = (why: string): InsightSection => ({ tables: ["absence_heat", "late_heat"].map((key) => ({ key, title: key === "absence_heat" ? "Absenteeism heatmap: shift x day" : "Late-coming heatmap: shift x day", columns: [], rows: [], unavailable: why })) });
  if (!anchor) return none("No processed attendance day yet");
  const { value, warming } = await heavy(ctx, "heat", 10 * 60_000, 4_500, () => loadHeat(ctx, anchor));
  if (!value) return none(warming ? "Computing the shift heatmap (first load of the day takes about 15 seconds). Refresh shortly." : "Unavailable");
  const { dates, cells, shifts, perDay } = value;
  const columns = [{ key: "shift", label: "Shift" }, ...dates.map((d, i) => ({ key: `d${i}`, label: `${weekdayShort(d)} ${shortDate(d)}`, unit: "percent" as const, align: "right" as const }))];
  const adherenceSpark = dates.map((d) => { const c = perDay.get(d); return c && c.rostered ? ratio(c.adhered, c.rostered) : null; });
  const latest = perDay.get(anchor);
  const adherence = latest ? ratio(latest.adhered, latest.rostered) : null;
  const prev = adherenceSpark.length > 1 ? adherenceSpark[adherenceSpark.length - 2] : null;
  const empty = shifts.length === 0 ? "No rostered working days with attendance in the last 7 processed days" : null;
  return {
    kpis: [{
      key: "roster_adherence", label: "Roster adherence", value: adherence, unit: "percent", tone: toneFor(adherence, 92, 85),
      delta: adherence !== null && prev !== null ? Math.round((adherence - prev) * 10) / 10 : null, deltaLabel: `pp vs previous day (as of ${shortDate(anchor)})`,
      spark: adherenceSpark.filter((v): v is number => v !== null), href: "/wfm/roster-command-center",
      formula: "Rostered working days that ended with the person present or half-day (processed attendance), over all rostered working days. Rostered = wfm_roster_assignment rows that are not week-off/holiday/leave. Roster rows cover a subset of the workforce.",
      unavailable: latest ? null : "No rostered attendance for the anchor day",
    }],
    tables: [
      { key: "absence_heat", title: "Absenteeism heatmap: shift x day", columns, rows: heatRows(shifts, dates, cells, (c) => c.absent), href: "/wfm/roster-command-center", unavailable: empty },
      { key: "late_heat", title: "Late-coming heatmap: shift x day", columns, rows: heatRows(shifts, dates, cells, (c) => c.late), href: "/wfm/roster-command-center", unavailable: empty },
    ],
  };
}

export interface PublishDay { date: string; total: number; published: number; acked: number }

/** Pure: publish health over a window of roster days. */
export function publishTotals(days: PublishDay[]) {
  const total = days.reduce((s, d) => s + d.total, 0);
  const published = days.reduce((s, d) => s + d.published, 0);
  const firstDraft = days.find((d) => d.total > d.published)?.date ?? null;
  return { total, published, draft: total - published, publishedPct: ratio(published, total), firstDraft };
}

/**
 * Next 14 days of working roster rows: published vs draft, employee acknowledgements, horizon.
 * "Published" follows the platform's lifecycle (roster-trends.calc.ts buildFunnel): a row has been published to the
 * employee once final_roster_status has left 'generated'. wfm_roster_assignment.publish_status is NOT that signal -
 * it stays 'draft' on rows that are already awaiting the employee's acknowledgement (reading it showed 0% published
 * on a roster that was 99% sent).
 */
export const publishWindow = (ctx: InsightContext) =>
  once(ctx, "publish", async () => {
    const s = await idFilter(ctx, "ra.employee_id", "active");
    const end = new Date(Date.parse(`${ctx.today}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10);
    const r = await rows<RowDataPacket>(
      `SELECT DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d, COUNT(*) AS total,
              SUM(COALESCE(ra.final_roster_status, 'generated') <> 'generated') AS published,
              SUM(ra.final_roster_status IN ('acknowledged','approved_final','published_to_rta','force_approved_by_manager','realigned_by_manager')) AS acked,
              SUM(ra.final_roster_status = 'pending_employee_ack') AS pending_ack
         FROM wfm_roster_assignment ra
        WHERE ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER} AND NOT ${ROSTER_NOT_WORKING}${s.sql}
        GROUP BY ra.roster_date ORDER BY ra.roster_date`,
      [ctx.today, end, ...s.params],
    );
    const n = (v: unknown) => num(v) ?? 0;
    const days: PublishDay[] = r.map((x) => ({ date: String(x.d), total: n(x.total), published: n(x.published), acked: n(x.acked) }));
    return { days, pendingAck: r.reduce((a, x) => a + n(x.pending_ack), 0), horizon: days.length ? days[days.length - 1].date : null };
  });

export async function publishHealthSection(ctx: InsightContext): Promise<InsightSection> {
  const w = await publishWindow(ctx);
  const t = publishTotals(w.days);
  const horizonDays = w.horizon ? daysSince(ctx.today, w.horizon) : null;
  // Days from today until the earliest still-draft day (0 = today is unpublished).
  const firstDraftIn = t.firstDraft ? daysSince(ctx.today, t.firstDraft) : null;
  const actions: InsightAction[] = [];
  if (t.total) {
    actions.push({
      id: "unpublished_rosters", label: "Roster days not yet published to employees (next 14 days)", count: t.draft, severity: t.draft ? (firstDraftIn !== null && firstDraftIn <= 1 ? "critical" : "high") : "info",
      href: "/wfm/roster-command-center", hint: t.firstDraft ? `earliest unpublished day ${shortDate(t.firstDraft)}` : undefined, overdue: w.days.filter((d) => d.total > d.published && d.date <= ctx.today).reduce((a, d) => a + d.total - d.published, 0), group: "Roster",
    });
    actions.push({ id: "roster_ack_pending", label: "Rosters awaiting employee acknowledgement", count: w.pendingAck, severity: severityFor(w.pendingAck, 100, 5000), href: "/wfm/notification-hub", hint: `${t.published ? ratio(w.days.reduce((a, d) => a + d.acked, 0), t.published) ?? 0 : 0}% of published days acknowledged`, group: "Roster" });
  }
  const signals: InsightSignal[] = [];
  if (t.total && (t.publishedPct ?? 0) < 50) signals.push({ tone: "bad", title: `${t.draft.toLocaleString("en-IN")} of ${t.total.toLocaleString("en-IN")} upcoming roster days are unpublished`, detail: "Employees cannot see shifts that have not been published, which drives no-shows and late marks.", value: `${t.publishedPct ?? 0}%`, href: "/wfm/roster-command-center" });
  if (horizonDays !== null && horizonDays < 7) signals.push({ tone: "watch", title: `Roster only planned ${horizonDays} day${horizonDays === 1 ? "" : "s"} ahead`, detail: `The last rostered day in scope is ${shortDate(w.horizon as string)}.`, value: `${horizonDays}d`, href: "/wfm/roster-builder" });
  return {
    actions, signals,
    kpis: [{
      key: "roster_published", label: "Roster published (next 14d)", value: t.publishedPct, unit: "percent", tone: toneFor(t.publishedPct, 95, 70), href: "/wfm/roster-command-center",
      helper: t.total ? `${t.published.toLocaleString("en-IN")} of ${t.total.toLocaleString("en-IN")} working roster days` : undefined,
      formula: "Working roster rows (today to +13 days) whose final_roster_status has moved past 'generated' (sent to the employee) over all working roster rows in the same window.",
      unavailable: t.total ? null : "No roster rows in the next 14 days for this scope",
    }, {
      key: "roster_horizon", label: "Roster horizon", value: horizonDays, unit: "days", tone: toneFor(horizonDays, 14, 7), href: "/wfm/roster-builder",
      helper: w.horizon ? `planned through ${shortDate(w.horizon)}` : undefined, formula: "Days between today and the last day that has a working roster row (capped at the 14-day window).",
      unavailable: horizonDays === null ? "No roster rows ahead" : null,
    }],
    series: [{
      key: "publish_by_day", title: "Roster publish health", subtitle: "Working roster rows per upcoming day", kind: "stacked", unit: "count", href: "/wfm/roster-command-center",
      keys: [{ key: "published", label: "Published", tone: "green" }, { key: "draft", label: "Draft", tone: "amber" }],
      points: w.days.map((d) => ({ label: `${weekdayShort(d.date)} ${d.date.slice(8)}`, published: d.published, draft: d.total - d.published })),
      unavailable: w.days.length ? null : "No roster rows in the next 14 days",
    }],
  };
}

/** Approved leave landing on rostered working days (next 14 days): the double-booking WFM has to resolve. */
export async function leaveConflictSection(ctx: InsightContext): Promise<InsightSection> {
  const s = await idFilter(ctx, "lr.employee_id", "active");
  const end = new Date(Date.parse(`${ctx.today}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10);
  const r = await rows<RowDataPacket>(
    `SELECT COUNT(*) AS days, COUNT(DISTINCT ra.employee_id) AS people, DATE_FORMAT(MIN(ra.roster_date),'%Y-%m-%d') AS first_day
       FROM leave_request lr
       JOIN wfm_roster_assignment ra ON ra.employee_id = lr.employee_id
        AND ra.roster_date BETWEEN GREATEST(lr.from_date, ?) AND LEAST(lr.to_date, ?)
      WHERE lr.status = 'approved' AND lr.to_date >= ? AND lr.from_date <= ?
        AND ${REAL_ROSTER} AND NOT ${ROSTER_NOT_WORKING}${s.sql}`,
    [ctx.today, end, ctx.today, end, ...s.params],
  );
  const days = num(r[0]?.days) ?? 0;
  const people = num(r[0]?.people) ?? 0;
  const first = (r[0]?.first_day as string) ?? null;
  return {
    actions: [{
      id: "leave_roster_conflict", label: "Approved leave on rostered working days (next 14d)", count: days, severity: severityFor(days, 10, 50), href: "/wfm/roster",
      hint: people ? `${people} employee${people === 1 ? "" : "s"}${first ? `, first ${shortDate(first)}` : ""}` : undefined, group: "Roster",
    }],
    signals: days > 0 ? [{ tone: days >= 50 ? "bad" : "watch", title: `${days} rostered shifts overlap approved leave`, detail: "Those seats will be empty. Re-roster or confirm the leave overrides the shift.", value: days, href: "/wfm/roster" }] : [],
  };
}
