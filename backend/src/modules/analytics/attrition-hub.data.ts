/**
 * Attrition hub - data access. One function, `loadSnapshot(asOf)`, turns "who was employed on
 * that date" into model Features. It serves two callers with the same code path:
 *   - asOf = today          -> the live risk list (also reads KPI, call quality, PIP, hygiene)
 *   - asOf = a past date    -> the backtest, which asks "what did the model say then, and who
 *                              actually left in the next 30 days?"
 * Historical snapshots can only use what history exists for (attendance, leave, regularisation,
 * warnings, increments, joining/exit dates, manager exits). The rest stays null and scores zero.
 *
 * Each optional source is fetched independently; one failing loses that signal, not the page.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { Features } from "./attrition-model.js";

export interface SnapshotPerson {
  id: string; code: string; name: string;
  designation: string | null; process: string | null; branch: string | null; manager: string | null;
  designationId: string | null; processId: string | null; branchId: string | null; managerId: string | null;
  source: string | null; joinDate: string; aonDays: number;
  exitDate: string | null;           // set for people who later left (used by the backtest)
  features: Features;
}
export interface Snapshot { asOf: string; people: SnapshotPerson[]; inNotice: Set<string>; degraded: string[] }

const AON_JOIN = "COALESCE(e.salary_start_date, e.date_of_joining)";
type Row = RowDataPacket;
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => ymd(new Date());
export const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000);

async function q(sql: string, params: unknown[] = []): Promise<Row[]> {
  const [rows] = await db.execute<Row[]>(sql, params as never[]);
  return rows;
}

/** At most this many source queries hit the database at once. */
const MAX_PARALLEL = 4;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await run(); } finally { running--; waiting.shift()?.(); }
}

/** Run an optional source; on failure record it and carry on without it. */
async function optional<T>(name: string, degraded: string[], run: () => Promise<T>, timeoutMs = 60_000): Promise<T | null> {
  try {
    return await Promise.race([
      slot(run),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
  } catch (err) {
    console.error(`[attrition-hub] ${name} unavailable:`, err instanceof Error ? err.message : err);
    degraded.push(name);
    return null;
  }
}

/* ── call quality: slow cross-database scan, cached and refreshed off the request path ── */
const QUALITY_TTL = 30 * 60_000;
let quality: { at: number; rows: Row[] | null; inflight: boolean; failed?: boolean } = { at: 0, rows: null, inflight: false };
let onQualityWarm: (() => void) | null = null;
export const setQualityListener = (fn: () => void) => { onQualityWarm = fn; };

function qualityRowsWarm(): Row[] | null {
  if (!quality.inflight && Date.now() - quality.at > QUALITY_TTL) {
    quality.inflight = true;
    const t0 = Date.now();
    Promise.race([
      q(`SELECT ei.id AS employee_id,
                ROUND(AVG(cqa.quality_percentage), 2) AS avg_quality,
                ROUND(AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN cqa.quality_percentage END)
                    - AVG(CASE WHEN cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY) AND cqa.CallDate < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN cqa.quality_percentage END), 2) AS velocity
           FROM mas_hrms.employees ei
           JOIN db_audit.call_quality_assessment cqa ON ei.employee_code = cqa.User
          WHERE cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 60 DAY) AND ei.employment_status = 'Active' AND ei.active_status = 1
          GROUP BY ei.id`),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout after 180s")), 180_000)),
    ]).then((rows) => {
      const first = !quality.rows;
      quality = { at: Date.now(), rows, inflight: false, failed: false };
      console.log(`[attrition-hub] call quality loaded: ${rows.length} people in ${Date.now() - t0} ms`);
      if (first) onQualityWarm?.();
    }).catch((err) => {
      // retry in 5 minutes rather than hammering a source that is struggling
      quality = { at: Date.now() - QUALITY_TTL + 5 * 60_000, rows: quality.rows, inflight: false, failed: true };
      console.error("[attrition-hub] call quality unavailable:", err instanceof Error ? err.message : err);
    });
  }
  return quality.rows;
}

const SEVERITY_RANK: Record<string, number> = { verbal: 1, written: 2, final: 3 };

export async function loadSnapshot(asOf: string, opts: { live: boolean }): Promise<Snapshot> {
  const degraded: string[] = [];
  const d30 = addDays(asOf, -30), d60 = addDays(asOf, -60), d10 = addDays(asOf, -10), d7 = addDays(asOf, -7);
  const d90 = addDays(asOf, -90), d180 = addDays(asOf, -180);

  // Who was employed on asOf. Live: the active flag is the truth. Past: joined by then and either
  // left after it or still here; an inactive row with no exit date cannot be placed in time, so it
  // is left out rather than miscounted as someone who stayed.
  const cohortWhere = opts.live
    ? `e.employment_status = 'Active' AND e.active_status = 1 AND (e.date_of_exit IS NULL OR e.date_of_exit > ?) AND e.date_of_joining <= ?`
    : `${AON_JOIN} <= ? AND e.date_of_joining IS NOT NULL
       AND ((e.date_of_exit IS NOT NULL AND e.date_of_exit > ? AND e.date_of_exit >= e.date_of_joining)
            OR (e.date_of_exit IS NULL AND e.employment_status = 'Active' AND e.active_status = 1))`;
  const cohortParams = opts.live ? [asOf, asOf] : [asOf, asOf];

  const base = await q(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS name,
            d.designation_name, p.process_name, b.branch_name,
            COALESCE(NULLIF(TRIM(m.full_name),''), TRIM(CONCAT(m.first_name,' ',COALESCE(m.last_name,'')))) AS manager_name,
            e.designation_id, e.process_id, e.branch_id, e.reporting_manager_id, e.source, e.ctc,
            DATE_FORMAT(${AON_JOIN}, '%Y-%m-%d') AS join_date,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS exit_date,
            (e.pan_number IS NULL OR TRIM(e.pan_number) = '') AS no_pan,
            (e.uan_number IS NULL OR TRIM(e.uan_number) = '') AS no_uan,
            (e.mobile IS NULL OR TRIM(e.mobile) = '') AS no_mobile,
            (e.personal_email IS NULL OR TRIM(e.personal_email) = '') AS no_email
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE ${cohortWhere}`,
    cohortParams,
  );

  // ── attendance: rates, trend, absent streak, late marks ──
  const attRowsP = optional("attendance", degraded, () => q(
    `SELECT employee_id,
            SUM(CASE WHEN attendance_status IN ('present','half_day','absent') AND record_date > ? THEN 1 ELSE 0 END) AS wd_r,
            SUM(CASE WHEN record_date > ? THEN (CASE attendance_status WHEN 'present' THEN 1 WHEN 'half_day' THEN 0.5 ELSE 0 END) ELSE 0 END) AS ok_r,
            SUM(CASE WHEN attendance_status IN ('present','half_day','absent') AND record_date <= ? THEN 1 ELSE 0 END) AS wd_p,
            SUM(CASE WHEN record_date <= ? THEN (CASE attendance_status WHEN 'present' THEN 1 WHEN 'half_day' THEN 0.5 ELSE 0 END) ELSE 0 END) AS ok_p,
            SUM(CASE WHEN late_mark = 1 AND record_date > ? THEN 1 ELSE 0 END) AS late30,
            SUM(CASE WHEN attendance_status = 'absent' AND record_date > ? THEN 1 ELSE 0 END) AS absent7
       FROM attendance_daily_record
      WHERE record_date > ? AND record_date <= ?
      GROUP BY employee_id`,
    [d30, d30, d30, d30, d30, d7, d60, asOf],
  ));
  // An absence streak means ROSTERED working days with no clock-in and no leave - the same definition the Branch
  // Health Report uses, so the two never disagree. People with no roster row are not counted (we cannot say
  // they should have been in: new joiners in training, for one, show as 'absent' in the raw attendance table).
  const streakRowsP = optional("attendance-streak", degraded, () => q(
    `SELECT ra.employee_id,
            (a.clock_in_time IS NULL AND COALESCE(a.attendance_status, '') NOT IN ('leave_approved','approved_leave','half_day_leave','leave')) AS missed
       FROM wfm_roster_assignment ra
       LEFT JOIN attendance_daily_record a ON a.employee_id = ra.employee_id AND a.record_date = ra.roster_date
      WHERE ra.roster_date > ? AND ra.roster_date < ?
        AND ra.is_week_off = 0
        AND UPPER(COALESCE(ra.assignment_type, '')) NOT IN ('WEEK_OFF', 'LEAVE', 'HOLIDAY')
      ORDER BY ra.employee_id, ra.roster_date DESC`,
    [d10, asOf],
  ));
  const leaveRowsP = optional("leave", degraded, () => q(
    `SELECT employee_id, COUNT(*) AS n FROM leave_request
      WHERE LOWER(status) IN ('approved','auto_approved') AND from_date > ? AND from_date <= ?
      GROUP BY employee_id`,
    [d60, asOf],
  ));
  const regRowsP = optional("regularisation", degraded, () => q(
    `SELECT employee_id, COUNT(*) AS n FROM attendance_regularization
      WHERE session_date > ? AND session_date <= ? GROUP BY employee_id`,
    [d60, asOf],
  ));
  const warnRowsP = optional("warnings", degraded, () => q(
    `SELECT employee_id, MAX(FIELD(severity,'verbal','written','final')) AS sev, COUNT(*) AS n
       FROM employee_warning
      WHERE warning_date > ? AND warning_date <= ?
        AND (status = 'active' OR (withdrawn_at IS NOT NULL AND withdrawn_at > ?))
      GROUP BY employee_id`,
    [d180, asOf, asOf],
  ));
  const incRowsP = optional("increments", degraded, () => q(
    `SELECT employee_id, DATE_FORMAT(MAX(effective_from), '%Y-%m-%d') AS last_inc
       FROM salary_increment_request
      WHERE status IN ('approved','implemented') AND effective_from <= ?
      GROUP BY employee_id`,
    [asOf],
  ));
  const teamExitRowsP = optional("team-exits", degraded, () => q(
    `SELECT reporting_manager_id AS mid, COUNT(*) AS n FROM employees
      WHERE date_of_exit > ? AND date_of_exit <= ? AND reporting_manager_id IS NOT NULL
      GROUP BY reporting_manager_id`,
    [d90, asOf],
  ));

  // Live-only sources: no point-in-time history exists for these.
  const kpiP = opts.live ? optional("kpi", degraded, () => q(
    `SELECT employee_id,
            SUBSTRING_INDEX(GROUP_CONCAT(final_score ORDER BY COALESCE(locked_at, reviewed_at) DESC SEPARATOR ','), ',', 2) AS scores
       FROM kpi_score_summary WHERE final_score IS NOT NULL GROUP BY employee_id`)) : Promise.resolve(null);
  const pipP = opts.live ? optional("pip", degraded, () => q(`SELECT DISTINCT employee_id FROM pip_record WHERE status = 'active'`)) : Promise.resolve(null);
  const noticeP = opts.live ? optional("notice", degraded, () => q(
    `SELECT DISTINCT employee_id FROM exit_request
      WHERE status NOT IN ('rejected','revoked','exited','withdrawn','cancelled')`)) : Promise.resolve(null);
  const bankP = opts.live ? optional("bank-record", degraded, () => q(`SELECT DISTINCT employee_id FROM employee_bank_detail WHERE active_status = 1`)) : Promise.resolve(null);
  // Call quality is a heavy cross-database scan: it refreshes in the background and is used once warm.
  const qualRows = opts.live ? qualityRowsWarm() : null;
  // Still loading is not a failure: only call it out when the load actually failed. Quality covers ~5% of people.
  if (opts.live && !qualRows && quality.failed) degraded.push("call-quality");

  const [attRows, streakRows, leaveRows, regRows, warnRows, incRows, teamExitRows, kpiRows, pipRows, noticeRaw, bankRows] =
    await Promise.all([attRowsP, streakRowsP, leaveRowsP, regRowsP, warnRowsP, incRowsP, teamExitRowsP, kpiP, pipP, noticeP, bankP]);
  const noticeRows = noticeRaw ?? [];

  const by = <T extends Row>(rows: T[] | null, key = "employee_id") => {
    const m = new Map<string, T>();
    for (const r of rows ?? []) m.set(String(r[key]), r);
    return m;
  };
  const att = by(attRows), leave = by(leaveRows), reg = by(regRows), warn = by(warnRows), inc = by(incRows);
  const kpi = by(kpiRows), qual = by(qualRows), pip = new Set((pipRows ?? []).map((r) => String(r.employee_id)));
  const bank = new Set((bankRows ?? []).map((r) => String(r.employee_id)));
  const teamExits = by(teamExitRows, "mid");

  // absent streak: rostered days arrive newest first per employee; stop at the first day they did turn up.
  const streak = new Map<string, number>();
  const done = new Set<string>();
  for (const r of streakRows ?? []) {
    const id = String(r.employee_id);
    if (done.has(id)) continue;
    if (Number(r.missed) === 1) streak.set(id, (streak.get(id) ?? 0) + 1);
    else done.add(id);
  }

  // peer pay and team size come from the cohort itself
  const ctcByDesig = new Map<string, number[]>();
  const teamSize = new Map<string, number>();
  for (const r of base) {
    const c = num(r.ctc);
    if (r.designation_id && c && c > 0) (ctcByDesig.get(String(r.designation_id)) ?? ctcByDesig.set(String(r.designation_id), []).get(String(r.designation_id))!).push(c);
    if (r.reporting_manager_id) teamSize.set(String(r.reporting_manager_id), (teamSize.get(String(r.reporting_manager_id)) ?? 0) + 1);
  }
  const avgCtc = new Map<string, number>();
  for (const [k, v] of ctcByDesig) if (v.length >= 5) avgCtc.set(k, v.reduce((a, b) => a + b, 0) / v.length);

  const people: SnapshotPerson[] = base.map((r) => {
    const id = String(r.id);
    const a = att.get(id);
    const wdR = num(a?.wd_r) ?? 0, wdP = num(a?.wd_p) ?? 0;
    const okR = num(a?.ok_r) ?? 0, okP = num(a?.ok_p) ?? 0;
    const wdAll = wdR + wdP;
    const attPct = wdAll >= 10 ? ((okR + okP) / wdAll) * 100 : null;
    const attDelta = wdR >= 8 && wdP >= 8 ? (okR / wdR - okP / wdP) * 100 : null;
    const joinDate = String(r.join_date);
    const aonDays = Math.max(0, daysBetween(joinDate, asOf));
    const tenureMonths = aonDays / 30.4;
    const lastInc = inc.get(id)?.last_inc as string | undefined;
    const ctc = num(r.ctc);
    const avg = r.designation_id ? avgCtc.get(String(r.designation_id)) : undefined;
    const mid = r.reporting_manager_id ? String(r.reporting_manager_id) : null;
    const size = mid ? (teamSize.get(mid) ?? 0) : 0;
    const exits = mid ? (num(teamExits.get(mid)?.n) ?? 0) : 0;
    const w = warn.get(id);
    // "" must not become 0, and a 0 is "not scored yet" (new joiners carry 0 rows), not a failing score
    const ks = String(kpi.get(id)?.scores ?? "").split(",").filter((x) => x.trim() !== "").map(Number).filter((x) => Number.isFinite(x) && x > 0);
    const qa = qual.get(id);
    const missing = (r.no_pan ? 1 : 0) + (r.no_uan ? 1 : 0) + (r.no_mobile ? 1 : 0) + (r.no_email ? 1 : 0) + (opts.live && bankRows && !bank.has(id) ? 1 : 0);
    const features: Features = {
      aonDays,
      walkIn: /^WALK/.test(String(r.source ?? "").toUpperCase().replace(/\s/g, "")),
      att60Pct: attPct, attDeltaPts: attDelta,
      absentStreak: streak.get(id) ?? 0, absent7: num(a?.absent7), late30: num(a?.late30),
      leaveCount60: num(leave.get(id)?.n) ?? 0, reg60: num(reg.get(id)?.n) ?? 0,
      kpiScore: ks.length ? ks[0] : null, kpiDelta: ks.length > 1 ? ks[0] - ks[1] : null,
      quality60: num(qa?.avg_quality), qualityVelocity: num(qa?.velocity),
      ctc, peerCtcRatio: ctc && avg ? ctc / avg : null,
      monthsSinceIncrement: lastInc ? daysBetween(lastInc, asOf) / 30.4 : null,
      tenureMonths,
      warningSeverity: w ? ((num(w.sev) ?? 0) as 0 | 1 | 2 | 3) : 0, warningCount: num(w?.n) ?? 0,
      activePip: opts.live ? pip.has(id) : null,
      hygieneMissing: opts.live ? missing : null,
      teamExitRate90: size + exits >= 5 ? exits / (size + exits) : null,
    };
    return {
      id, code: String(r.employee_code ?? ""), name: String(r.name ?? "").trim() || String(r.employee_code ?? ""),
      designation: r.designation_name ?? null, process: r.process_name ?? null, branch: r.branch_name ?? null, manager: r.manager_name ?? null,
      designationId: r.designation_id ?? null, processId: r.process_id ?? null, branchId: r.branch_id ?? null, managerId: mid,
      source: r.source ?? null, joinDate, aonDays, exitDate: r.exit_date ?? null, features,
    };
  });
  return { asOf, people, inNotice: new Set(noticeRows.map((r) => String(r.employee_id))), degraded };
}

/* ── first days after joining: who turned up (for the batch tracker) ── */
let presence: { at: number; p: Promise<{ firstPresent: Map<string, number | null>; seen: Set<string> }> } | null = null;
let presenceRefreshing = false;
async function queryFirstPresence() {
  const from = addDays(today(), -7 * 17);
  const t0 = Date.now();
  const firstPresent = new Map<string, number | null>();
  const seen = new Set<string>();
  const rows = await q(
    `SELECT adr.employee_id,
            MIN(CASE WHEN adr.attendance_status IN ('present','half_day') THEN DATEDIFF(adr.record_date, ${AON_JOIN}) END) AS first_present,
            COUNT(*) AS n
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE ${AON_JOIN} >= ? AND adr.record_date >= ?
        AND adr.record_date >= ${AON_JOIN} AND adr.record_date < DATE_ADD(${AON_JOIN}, INTERVAL 7 DAY)
      GROUP BY adr.employee_id`, [from, from]);
  for (const r of rows) { const id = String(r.employee_id); seen.add(id); firstPresent.set(id, r.first_present == null ? null : Number(r.first_present)); }
  console.log(`[attrition-hub] first-week presence loaded: ${rows.length} people in ${Date.now() - t0} ms`);
  return { firstPresent, seen };
}
/** Served stale-while-revalidate (30 min): only the very first caller after a restart waits. */
export function loadFirstPresence(): Promise<{ firstPresent: Map<string, number | null>; seen: Set<string> }> {
  if (presence) {
    if (Date.now() - presence.at >= 30 * 60_000 && !presenceRefreshing) {
      presenceRefreshing = true;
      queryFirstPresence()
        .then((fresh) => { presence = { at: Date.now(), p: Promise.resolve(fresh) }; })
        .catch((e) => console.error("[attrition-hub] presence refresh failed:", e instanceof Error ? e.message : e))
        .finally(() => { presenceRefreshing = false; });
    }
    return presence.p;
  }
  const p = queryFirstPresence();
  presence = { at: Date.now(), p };
  p.catch(() => { if (presence?.p === p) presence = null; });
  return p;
}
