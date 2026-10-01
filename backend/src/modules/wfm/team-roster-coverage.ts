/**
 * Team Roster - approver snapshot for a submission: for every date in the submission window, how the
 * submitter's whole team looks today versus after the proposed changes (week off / leave / training /
 * unscheduled = shrinkage), shift-wise head counts, leave detail, a process split, and a compact
 * employee x date matrix for the people the submission touches.
 *
 * Read-only. Leave is taken from approved leave and always wins over a roster cell, matching the grid.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { loadApprovedLeave, type LeaveKind } from "./roster-leave-guard.service.js";
import { loadShiftOptions } from "./team-roster-shifts.js";
import { resolveTeamTree } from "./team-roster-tree.js";
import { eachDate, effectiveType, placeholders, rowsOf, todayIst } from "./team-roster-types.js";

export type CoverageKind = "SHIFT" | "WEEK_OFF" | "LEAVE" | "TRAINING" | "UNSCHEDULED" | "UNASSIGNED";
const KINDS: CoverageKind[] = ["SHIFT", "WEEK_OFF", "LEAVE", "TRAINING", "UNSCHEDULED", "UNASSIGNED"];
/** Kinds that take a person off the floor on a day. */
const SHRINK: CoverageKind[] = ["WEEK_OFF", "LEAVE", "TRAINING", "UNSCHEDULED"];
const CHUNK = 1000;
const MAX_STREAK = 6;

interface Cell { kind: CoverageKind; label: string }
export interface CoverageLine { employeeId: string; date: string; newType: string; newLabel: string | null; status: string }
type Counts = Record<CoverageKind, number>;

const hhmm = (t: unknown) => (t == null || t === "" ? null : String(t).slice(0, 5));
const SHORT: Record<string, string> = { WEEK_OFF: "WO", LEAVE: "Leave", TRAINING: "TRN", UNSCHEDULED: "UNS", UNASSIGNED: "-" };
const kindOf = (t: string): CoverageKind => (KINDS.includes(t as CoverageKind) ? (t as CoverageKind) : "UNASSIGNED");
const counts = (): Counts => Object.fromEntries(KINDS.map((k) => [k, 0])) as Counts;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number, d: number) => (d > 0 ? r1((n / d) * 100) : 0);
const shrinkOf = (c: Counts) => SHRINK.reduce((n, k) => n + c[k], 0);
const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);

export async function buildCoverage(o: {
  submitterId: string; from: string; to: string; lines: CoverageLine[]; names: Map<string, { name: string; code: string | null }>;
}) {
  const dates = eachDate(o.from, o.to);
  const tree = await resolveTeamTree(o.submitterId);
  const affected = [...new Set(o.lines.map((l) => l.employeeId))];
  const team = [...new Set([...tree.ids, ...affected])];

  const info = new Map<string, { name: string; code: string | null; processId: string | null; processName: string | null }>();
  const base = new Map<string, Cell>(); // `${emp}|${date}`
  for (let i = 0; i < team.length; i += CHUNK) {
    const ids = team.slice(i, i + CHUNK);
    const marks = placeholders(ids.length);
    for (const r of rowsOf<RowDataPacket>(await db.execute(
      `SELECT e.id, e.employee_code, e.process_id, pm.process_name,
              COALESCE(NULLIF(e.full_name, ''), TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')))) AS name
         FROM employees e LEFT JOIN process_master pm ON pm.id = e.process_id WHERE e.id IN (${marks})`, ids,
    ))) {
      info.set(String(r.id), { name: String(r.name ?? ""), code: r.employee_code ? String(r.employee_code) : null, processId: r.process_id ? String(r.process_id) : null, processName: r.process_name ? String(r.process_name) : null });
    }
    for (const r of rowsOf<RowDataPacket>(await db.execute(
      `SELECT wra.employee_id, DATE_FORMAT(wra.roster_date, '%Y-%m-%d') AS d, wra.assignment_type, wra.is_week_off,
              wra.shift_template_id, wra.shift_start_time, wra.shift_end_time
         FROM wfm_roster_assignment wra
        WHERE wra.employee_id IN (${marks}) AND wra.roster_date BETWEEN ? AND ?`,
      [...ids, o.from, o.to],
    ))) {
      const type = effectiveType(r as Record<string, unknown>);
      const kind = type === "SHIFT" ? "SHIFT" : kindOf(type);
      const start = hhmm(r.shift_start_time);
      const end = hhmm(r.shift_end_time);
      base.set(`${r.employee_id}|${r.d}`, { kind, label: kind === "SHIFT" ? (start && end ? `${start}-${end}` : "Shift") : SHORT[kind] ?? type });
    }
  }

  const leaveRows: Array<{ employeeId: string; employeeName: string; employeeCode: string | null; processName: string | null; dates: string[]; halfDays: number }> = [];
  try {
    const leave = await loadApprovedLeave(team, o.from, o.to);
    for (const [emp, byDate] of leave) {
      const days: string[] = [];
      let half = 0;
      for (const [d, k] of byDate as Map<string, LeaveKind>) {
        if (d < o.from || d > o.to) continue;
        base.set(`${emp}|${d}`, { kind: "LEAVE", label: SHORT.LEAVE });
        days.push(d);
        if (k === "HALF") half++;
      }
      if (days.length) {
        const w = info.get(emp);
        leaveRows.push({ employeeId: emp, employeeName: w?.name ?? "", employeeCode: w?.code ?? null, processName: w?.processName ?? null, dates: days.sort(), halfDays: half });
      }
    }
  } catch (err) {
    console.error("[team-roster] coverage leave unavailable:", (err as Error)?.message);
  }

  // Proposed cells: every line that is still going to land (pending) or already did (applied).
  const next = new Map<string, Cell>();
  for (const l of o.lines) {
    if (l.status === "skipped" || l.status === "failed") continue;
    const key = `${l.employeeId}|${l.date}`;
    if (base.get(key)?.kind === "LEAVE") continue;
    const kind = kindOf(l.newType.toUpperCase());
    next.set(key, { kind, label: kind === "SHIFT" ? (l.newLabel ?? "Shift") : SHORT[kind] ?? l.newType });
  }
  const cellBefore = (e: string, d: string): Cell => base.get(`${e}|${d}`) ?? { kind: "UNASSIGNED", label: SHORT.UNASSIGNED };
  const cellAfter = (e: string, d: string): Cell => next.get(`${e}|${d}`) ?? cellBefore(e, d);
  /** A shift label keeps only its HH:MM-HH:MM window so "GEN 09:00-18:00" and "09:00-18:00" group together. */
  const shiftKey = (label: string) => /\d{2}:\d{2}-\d{2}:\d{2}/.exec(label)?.[0] ?? label;

  const shiftTotals = new Map<string, { before: number; after: number }>();
  const processStats = new Map<string, { name: string; headcount: number; before: number[]; after: number[]; floorAfter: number[] }>();
  for (const e of team) {
    const p = info.get(e)?.processId ?? "none";
    if (!processStats.has(p)) processStats.set(p, { name: info.get(e)?.processName ?? "No process", headcount: 0, before: [], after: [], floorAfter: [] });
    processStats.get(p)!.headcount++;
  }
  const processDaily = new Map<string, Array<{ before: Counts; after: Counts }>>(
    [...processStats.keys()].map((p) => [p, dates.map(() => ({ before: counts(), after: counts() }))]),
  );
  const empProc = (e: string) => info.get(e)?.processId ?? "none";

  const perDate = dates.map((date, di) => {
    const before = counts();
    const after = counts();
    const shifts = new Map<string, { before: number; after: number }>();
    const bump = (k: string, f: "before" | "after") => {
      const s = shifts.get(k) ?? { before: 0, after: 0 };
      s[f]++;
      shifts.set(k, s);
      const t = shiftTotals.get(k) ?? { before: 0, after: 0 };
      t[f]++;
      shiftTotals.set(k, t);
    };
    for (const e of team) {
      const b = cellBefore(e, date);
      const a = cellAfter(e, date);
      before[b.kind]++; after[a.kind]++;
      if (b.kind === "SHIFT") bump(shiftKey(b.label), "before");
      if (a.kind === "SHIFT") bump(shiftKey(a.label), "after");
      const pd = processDaily.get(empProc(e))![di];
      pd.before[b.kind]++; pd.after[a.kind]++;
    }
    const planned = team.length;
    return {
      date, headcount: planned, before, after,
      shrinkageBeforePct: pct(shrinkOf(before), planned), shrinkageAfterPct: pct(shrinkOf(after), planned),
      onFloorBefore: before.SHIFT, onFloorAfter: after.SHIFT,
      shifts: Object.fromEntries([...shifts].map(([k, v]) => [k, v])),
    };
  });

  const byProcess = [...processStats].map(([id, s]) => {
    const days = processDaily.get(id)!;
    const sb = days.map((d) => pct(shrinkOf(d.before), s.headcount));
    const sa = days.map((d) => pct(shrinkOf(d.after), s.headcount));
    return {
      processId: id === "none" ? null : id, processName: s.name, headcount: s.headcount,
      avgShrinkageBeforePct: avg(sb), avgShrinkageAfterPct: avg(sa), peakShrinkageAfterPct: sa.length ? Math.max(...sa) : 0,
      minOnFloorAfter: days.length ? Math.min(...days.map((d) => d.after.SHIFT)) : 0,
    };
  }).sort((a, b) => b.headcount - a.headcount);

  // Shift options per process, so an approver can re-assign a cell without leaving the drawer.
  const procIds = [...new Set(affected.map((e) => info.get(e)?.processId).filter((p): p is string => !!p))];
  const optionMap = procIds.length ? await loadShiftOptions(procIds, todayIst()) : new Map();
  const shiftOptions = Object.fromEntries([...optionMap].map(([p, list]) => [p, list.map((s) => ({ key: s.key, start: s.start, end: s.end, label: s.label, night: s.night }))]));

  const rows = affected.map((e) => {
    let streak = 0; let maxStreak = 0; let weekOffs = 0; let beforeWeekOffs = 0;
    const cells = dates.map((date) => {
      const a = cellAfter(e, date);
      const changed = next.has(`${e}|${date}`);
      if (cellBefore(e, date).kind === "WEEK_OFF") beforeWeekOffs++;
      if (a.kind === "SHIFT") { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
      if (a.kind === "WEEK_OFF") weekOffs++;
      return { date, kind: a.kind, label: a.label, changed, was: changed ? cellBefore(e, date).label : null };
    });
    const who = info.get(e) ?? o.names.get(e);
    return {
      employeeId: e, employeeName: who?.name ?? "", employeeCode: who?.code ?? null,
      processId: info.get(e)?.processId ?? null, processName: info.get(e)?.processName ?? null, cells,
      changedCount: cells.filter((c) => c.changed).length, weekOffs, weekOffsBefore: beforeWeekOffs,
      maxStreak, streakBreach: maxStreak > MAX_STREAK,
    };
  });

  const sum = (f: "before" | "after") => KINDS.reduce((acc, k) => ({ ...acc, [k]: perDate.reduce((s, d) => s + d[f][k], 0) }), {} as Counts);
  const peak = perDate.reduce((p, d) => (d.shrinkageAfterPct > (p?.shrinkageAfterPct ?? -1) ? d : p), perDate[0]);
  const changeMix = { toShift: 0, toWeekOff: 0, toTraining: 0, toUnscheduled: 0 };
  for (const l of o.lines) {
    if (l.status === "skipped" || l.status === "failed") continue;
    const t = l.newType.toUpperCase();
    if (t === "SHIFT") changeMix.toShift++; else if (t === "WEEK_OFF") changeMix.toWeekOff++; else if (t === "TRAINING") changeMix.toTraining++; else changeMix.toUnscheduled++;
  }
  return {
    teamSize: team.length, teamTruncated: tree.truncated, dates, perDate, rows, byProcess, shiftOptions,
    shiftTotals: [...shiftTotals].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.after - a.after),
    leave: { employees: leaveRows.sort((a, b) => b.dates.length - a.dates.length), totalLeaveDays: leaveRows.reduce((s, r) => s + r.dates.length, 0) },
    composition: { before: sum("before"), after: sum("after") }, changeMix,
    summary: {
      avgShrinkageBeforePct: avg(perDate.map((d) => d.shrinkageBeforePct)), avgShrinkageAfterPct: avg(perDate.map((d) => d.shrinkageAfterPct)),
      peakDate: peak?.date ?? null, peakShrinkagePct: peak?.shrinkageAfterPct ?? 0,
      minOnFloorAfter: perDate.length ? Math.min(...perDate.map((d) => d.onFloorAfter)) : 0,
      employeesAffected: affected.length, streakBreaches: rows.filter((r) => r.streakBreach).length, maxStreakAllowed: MAX_STREAK,
    },
  };
}
