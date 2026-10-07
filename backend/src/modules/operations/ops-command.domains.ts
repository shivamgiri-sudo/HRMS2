import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  activeAt as _unusedSqlActiveAt,
  addDays,
  factGroupExpr,
  factWhere,
  hasPeopleOnlyFilter,
  num,
  numOrNull,
  type OpsCtx,
  type OpsDimension,
} from "./ops-command.context.js";
import { SQL_NOT_SCHEDULED } from "./ops-command.definitions.js";
import {
  groupKey,
  isActiveAt,
  exitDateOf,
  exitedIn,
  type DimView,
} from "./ops-command.dim.js";
import * as F from "./ops-command.facts.js";

void _unusedSqlActiveAt;
void SQL_NOT_SCHEDULED;

export type MetricRow = Record<string, number | null>;
export type MetricMap = Map<string, MetricRow>;

const bucket = (m: MetricMap, gid: string): Record<string, number> => {
  let b = m.get(gid) as Record<string, number> | undefined;
  if (!b) {
    b = {};
    m.set(gid, b);
  }
  return b;
};
const inc = (b: Record<string, number>, k: string, v = 1) => {
  b[k] = (b[k] ?? 0) + v;
};

const NOT_SCHEDULED = new Set(["week_off", "holiday", "week_off_worked"]);
const WORKED = new Set(["present", "half_day"]);
const attWindow = (ctx: OpsCtx) => ({
  from: ctx.f.from,
  to: ctx.f.to < ctx.attThrough ? ctx.f.to : ctx.attThrough,
});

/** Opening / closing / joiners (from the scoped employee view) + mandate (SQL, process / branch grain). */
export async function headcountDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<MetricMap> {
  const { from, to } = ctx.f;
  const before = addDays(from, -1);
  const out: MetricMap = new Map();
  for (const e of view.emps) {
    if (!e.doj || e.doj > to) continue;
    const b = bucket(out, groupKey(e, dim));
    const closing = isActiveAt(e, to);
    if (closing) inc(b, "hc_closing");
    if (isActiveAt(e, before)) inc(b, "hc_opening");
    if (e.doj >= from && e.doj <= to && e.status !== "not_joined")
      inc(b, "joiners");
    if (
      closing &&
      Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${e.doj}T00:00:00Z`)) /
          86_400_000,
      ) <= 90
    )
      inc(b, "new_joiner_hc");
  }

  const gx = factGroupExpr(dim, "wm.branch_id", "wm.process_id");
  if (gx && !hasPeopleOnlyFilter(ctx)) {
    const fw = factWhere(ctx, "wm.branch_id", "wm.process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${gx} AS gid, SUM(wm.mandated_hc) AS mandate_hc,
              SUM(wm.mandated_hc * COALESCE(wm.shrinkage_pct,0)) / NULLIF(SUM(wm.mandated_hc),0) AS shrinkage_mandate_pct
         FROM workforce_mandate wm
        WHERE wm.active_status = 1 AND wm.effective_from <= ? AND (wm.effective_to IS NULL OR wm.effective_to >= ?) AND ${fw.sql}
        GROUP BY gid`,
      [to, to, ...fw.params],
    );
    for (const r of rows) {
      const b = bucket(out, String(r.gid));
      b.mandate_hc = num(r.mandate_hc);
      if (r.shrinkage_mandate_pct !== null)
        b.shrinkage_mandate_pct = num(r.shrinkage_mandate_pct);
    }
  }
  return out;
}

/** Attendance + shrinkage share one aggregate so the two can never disagree. */
export async function attendanceDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<MetricMap> {
  const { from, to } = attWindow(ctx);
  if (from > to) return new Map();
  const rows = await F.adrRows(from, to);
  const out: MetricMap = new Map();
  const login = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const e = view.byId.get(r.eid);
    if (!e) continue;
    const gid = groupKey(e, dim);
    const b = bucket(out, gid);
    if (!NOT_SCHEDULED.has(r.st)) inc(b, "scheduled_days");
    if (r.st === "present") inc(b, "present_days");
    if (r.st === "absent") inc(b, "absent_days");
    if (r.st === "half_day") inc(b, "half_days");
    if (r.st === "leave_approved") inc(b, "leave_days");
    if (r.st === "missing_punch" || r.st === "unreconciled")
      inc(b, "missing_punch_days");
    if (r.late) inc(b, "late_marks");
    if (WORKED.has(r.st)) inc(b, "worked_days");
    if (r.mismatch) inc(b, "open_mismatches");
    if ((WORKED.has(r.st) || r.st === "week_off_worked") && r.mins !== null) {
      const l = login.get(gid) ?? { sum: 0, n: 0 };
      l.sum += r.mins;
      l.n += 1;
      login.set(gid, l);
    }
  }
  for (const [gid, b] of out) {
    for (const k of [
      "scheduled_days",
      "present_days",
      "absent_days",
      "half_days",
      "leave_days",
      "missing_punch_days",
      "late_marks",
      "worked_days",
      "open_mismatches",
    ])
      b[k] ??= 0;
    const l = login.get(gid);
    (b as MetricRow).avg_login_hours = l && l.n ? l.sum / l.n / 60 : null;
  }
  return out;
}

export async function rosterDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<MetricMap> {
  const { from, to } = ctx.f;
  const out: MetricMap = new Map();
  const attTo = to < ctx.attThrough ? to : ctx.attThrough;
  const [rows, adr] = await Promise.all([
    F.rosterRows(from, to),
    from <= attTo ? F.adrRows(from, attTo) : Promise.resolve([]),
  ]);
  const worked = new Set<string>();
  for (const a of adr)
    if (a.st === "present" || a.st === "half_day" || a.st === "week_off_worked")
      worked.add(`${a.eid}|${a.d}`);

  const counted = new Set<string>();
  for (const r of rows) {
    const e = view.byId.get(r.eid);
    if (!e) continue;
    const gid = groupKey(e, dim);
    const b = bucket(out, gid);
    if (r.working) {
      inc(b, "rostered_days");
      inc(b, "rostered_hours", r.minutes / 60);
      if (r.published) inc(b, "published_days");
      if (r.ackPending) inc(b, "ack_pending");
      if (r.ackRejected) inc(b, "ack_rejected");
      if (r.d <= ctx.attThrough) {
        inc(b, "due_days");
        if (worked.has(`${r.eid}|${r.d}`)) inc(b, "adhered_days");
      }
    }
    if (r.weekoff) inc(b, "weekoff_days");
    if (r.training) inc(b, "training_days");
    if (!counted.has(r.eid) && isActiveAt(e, to)) {
      counted.add(r.eid);
      inc(b, "rostered_employees");
    }
  }

  const cg = factGroupExpr(dim, "c.branch_id", "c.process_id");
  const sg = factGroupExpr(dim, "r.branch_id", "r.process_id");
  if (cg && sg && !hasPeopleOnlyFilter(ctx)) {
    const cw = factWhere(ctx, "c.branch_id", "c.process_id");
    const sw = factWhere(ctx, "r.branch_id", "r.process_id");
    const [[cycles], [slots]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT ${cg} AS gid, SUM(c.status IN ('draft','submitted','reviewed')) AS n FROM weekly_roster_cycle c
          WHERE c.week_end_date >= ? AND c.week_start_date <= ? AND ${cw.sql} GROUP BY gid`,
        [from, to, ...cw.params],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT ${sg} AS gid, SUM(r.coverage_status = 'shortage') AS n FROM wfm_slot_requirement r
          WHERE r.requirement_date BETWEEN ? AND ? AND r.is_active = 1 AND ${sw.sql} GROUP BY gid`,
        [from, to, ...sw.params],
      ),
    ]);
    for (const r of cycles) bucket(out, String(r.gid)).cycles_open = num(r.n);
    for (const r of slots)
      bucket(out, String(r.gid)).demand_shortage_slots = num(r.n);
  }
  return out;
}

export async function attritionDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<MetricMap> {
  const { from, to } = ctx.f;
  const out: MetricMap = new Map();
  const reqs = await F.exitRequests();
  for (const e of view.emps) {
    if (!exitedIn(e, from, to)) continue;
    const b = bucket(out, groupKey(e, dim));
    if (e.status === "not_joined") {
      inc(b, "not_joined");
      continue;
    }
    inc(b, "exits");
    const er = F.latestExit(reqs, e.id);
    const absconding =
      er?.type === "absconding" ||
      er?.subType === "absconding" ||
      er?.subType === "abandonment" ||
      e.status === "absconded";
    if (absconding) inc(b, "absconding_exits");
    else if (er?.type === "voluntary") inc(b, "voluntary_exits");
    else if (er?.type === "involuntary") inc(b, "involuntary_exits");
    else inc(b, "unclassified_exits");
    const x = exitDateOf(e)!;
    const tenure = e.doj
      ? Math.round(
          (Date.parse(`${x}T00:00:00Z`) - Date.parse(`${e.doj}T00:00:00Z`)) /
            86_400_000,
        )
      : 9999;
    inc(
      b,
      tenure <= 30
        ? "exits_0_30"
        : tenure <= 90
          ? "exits_31_90"
          : tenure <= 180
            ? "exits_91_180"
            : "exits_180_plus",
    );
  }

  // Forward-looking pipeline as of today, from the latest live request of each active employee.
  const horizon = addDays(ctx.today, 30);
  const seen = new Set<string>();
  for (const e of view.emps) {
    if (e.active !== 1) continue;
    const list = reqs.get(e.id);
    if (!list) continue;
    const b = bucket(out, groupKey(e, dim));
    const openReq = list.find((r) => F.isOpenNotice(r.status));
    const pendingReq = list.find((r) => F.isPendingExit(r.status));
    if (openReq) {
      inc(b, "notice_hc");
      if (openReq.lwd && openReq.lwd >= ctx.today && openReq.lwd <= horizon)
        inc(b, "lwd_next_30");
    }
    if (pendingReq) inc(b, "pending_resignations");
    seen.add(e.id);
  }
  return out;
}

export async function hiringDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
): Promise<MetricMap> {
  const gx = factGroupExpr(dim, "jr.branch_id", "jr.process_id");
  if (!gx || hasPeopleOnlyFilter(ctx)) return new Map();
  const fw = factWhere(ctx, "jr.branch_id", "jr.process_id");
  const OPEN = `GREATEST(jr.requested_headcount - jr.fulfilled_headcount, 0)`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${gx} AS gid, SUM(${OPEN}) AS open_positions,
            SUM(CASE WHEN jr.priority IN ('high','urgent') THEN ${OPEN} ELSE 0 END) AS urgent_positions,
            SUM(CASE WHEN jr.target_joining_date < ? THEN ${OPEN} ELSE 0 END) AS overdue_positions
       FROM job_requisition jr
      WHERE jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.closed_at IS NULL
        AND jr.requested_headcount > jr.fulfilled_headcount AND ${fw.sql}
      GROUP BY gid`,
    [ctx.today, ...fw.params],
  );
  return new Map(
    rows.map((r) => [
      String(r.gid),
      {
        open_positions: num(r.open_positions),
        urgent_positions: num(r.urgent_positions),
        overdue_positions: num(r.overdue_positions),
      },
    ]),
  );
}

export async function qualityDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<{ map: MetricMap; externalAvailable: boolean }> {
  const { from, to } = ctx.f;
  const out: MetricMap = new Map();
  const [ext, manual] = await Promise.all([
    F.externalQuality(from, to),
    F.manualQuality(from, to),
  ]);
  for (const r of ext.rows) {
    const e = view.byCode.get(r.code);
    if (!e) continue;
    const b = bucket(out, groupKey(e, dim));
    inc(b, "qa_audits", r.n);
    inc(b, "qa_sum", r.sum);
    inc(b, "qa_fatal", r.fatal);
  }
  const man = new Map<string, { s: number; n: number }>();
  for (const r of manual) {
    const e = view.byId.get(r.eid);
    if (!e) continue;
    const gid = groupKey(e, dim);
    const m = man.get(gid) ?? { s: 0, n: 0 };
    m.s += r.sum;
    m.n += r.n;
    man.set(gid, m);
  }
  for (const [gid, m] of man)
    (bucket(out, gid) as MetricRow).manual_qa_score_pct = m.n
      ? m.s / m.n
      : null;
  return { map: out, externalAvailable: ext.ok };
}

export async function conductDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<MetricMap> {
  const out: MetricMap = new Map();
  const [warn, pips] = await Promise.all([
    F.warningsFact(ctx.f.from, ctx.f.to),
    F.activePips(),
  ]);
  for (const w of warn) {
    const e = view.byId.get(w.eid);
    if (!e) continue;
    const b = bucket(out, groupKey(e, dim));
    inc(b, "warnings_active", w.n);
    inc(b, "warnings_final", w.final);
  }
  for (const id of pips) {
    const e = view.byId.get(id);
    if (e && e.active === 1) inc(bucket(out, groupKey(e, dim)), "pip_active");
  }
  return out;
}

export async function trainingDomain(
  _ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<MetricMap> {
  const out: MetricMap = new Map();
  const rd = new Map<string, { s: number; n: number }>();
  for (const t of await F.trainingFact()) {
    const e = view.byId.get(t.eid);
    if (!e || e.active !== 1) continue;
    const gid = groupKey(e, dim);
    const b = bucket(out, gid);
    inc(b, "training_learners");
    if (t.red) inc(b, "training_at_risk");
    if (t.ready) inc(b, "training_ready");
    const r = rd.get(gid) ?? { s: 0, n: 0 };
    r.s += t.rs;
    r.n += t.rn;
    rd.set(gid, r);
  }
  for (const [gid, r] of rd)
    (bucket(out, gid) as MetricRow).avg_readiness = r.n ? r.s / r.n : null;
  return out;
}

export async function breaksDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<MetricMap> {
  const out: MetricMap = new Map();
  const acc = new Map<string, { s: number; n: number }>();
  for (const r of await F.breaksFact(ctx.f.from, ctx.f.to)) {
    const e = view.byId.get(r.eid);
    if (!e) continue;
    const gid = groupKey(e, dim);
    const b = bucket(out, gid);
    inc(b, "break_exceeded_days", r.exceeded);
    inc(b, "break_no_punch_days", r.noPunch);
    const a = acc.get(gid) ?? { s: 0, n: 0 };
    a.s += r.sum;
    a.n += r.n;
    acc.set(gid, a);
  }
  for (const [gid, a] of acc)
    (bucket(out, gid) as MetricRow).avg_break_minutes = a.n ? a.s / a.n : null;
  return out;
}

export async function liveDomain(
  ctx: OpsCtx,
  dim: OpsDimension,
  view: DimView,
): Promise<MetricMap> {
  const out: MetricMap = new Map();
  const fact = await F.liveFact(ctx.today);
  for (const r of fact.roster) {
    const e = view.byId.get(r.eid);
    if (!e || e.active !== 1 || !r.planned) continue;
    const b = bucket(out, groupKey(e, dim));
    inc(b, "live_planned");
    if (r.in) inc(b, "live_logged_in");
    if (r.out && !r.in) inc(b, "live_logged_out");
  }
  for (const id of fact.onBreak) {
    const e = view.byId.get(id);
    if (e) inc(bucket(out, groupKey(e, dim)), "live_on_break");
  }
  return out;
}

export { numOrNull };
