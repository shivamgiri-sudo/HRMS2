import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2/promise";
import { getJoinedInfo, joinedIdSql } from "./dashboard.joined.js";
import {
  branchDisplay,
  branchFilter,
  processDisplay,
  recruiterNamer,
  reportingScope,
  sourceDisplay,
} from "./dashboard.scope.js";

/**
 * ATS dashboard overview — server-side aggregates for /ats/dashboard.
 *
 * Data model (verified against production data, Sep 2026):
 *  - ats_candidate.status is the outcome (Selected / Rejected / No Show / Hold / Waiting …);
 *    status = 'Inactive' marks bulk-imported leads that never engaged, so they are counted separately.
 *  - current_stage is the furthest stage reached ("Round 1- HR Screening", "Offered", "Onboarded" …).
 *  - Offers: ats_employment_offer. BGV: candidate_bgv_report. Live queue: ats_queue_token.
 *
 * Performance: ats_candidate rows are wide, so a scan costs seconds. One day-level cube is fetched once and
 * shared by every period/branch view; results are served stale-while-revalidate and warmed at startup.
 */

export type OverviewPeriod = "today" | "7d" | "30d" | "90d" | "all";

export const LEAD = "Inactive";
const HOLD_STATUSES = ["Hold", "Client Round - Pending"];
const INTERVIEWED = [
  "Round 1- HR Screening",
  "Interview - Skill Test",
  "Round 2- Op's",
  "Round 3- Client",
  "Selection Discussion",
  "Interview",
  "Offered",
  "offer_approved",
  "payroll_validated",
  "Onboarded",
  "converted",
  "selected",
  "bgv_pending",
];
export const OFFERED = [
  "Offered",
  "offer_approved",
  "payroll_validated",
  "Onboarded",
  "converted",
];
const APPROVED = [
  "offer_approved",
  "payroll_validated",
  "Onboarded",
  "converted",
];
export const JOINED = ["Onboarded", "converted", "payroll_validated"];
const OPEN_STATUSES = [
  "Waiting",
  "Hold",
  "Client Round - Pending",
  "profile_submitted",
  "hr_approved",
  "Pending",
  "active",
  "hr_pushback",
];
const SLA_MINUTES = 120;

const FRESH_MS = 60_000; // serve as-is
const STALE_MS = 15 * 60_000; // serve immediately, refresh in background
const CUBE_TTL_MS = 120_000;

export const isSelected = (status: string, stage: string) =>
  status === "Selected" || OFFERED.includes(stage);
export const readable = processDisplay;
export const pct = (n: number, d: number) =>
  d ? Math.round((n / d) * 1000) / 10 : 0;
export const num = (v: unknown) => Number(v || 0);
const ph = (xs: string[]) => xs.map(() => "?").join(",");

export async function q<T = RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

export async function safe<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[ats-overview] ${label} failed:`, (err as Error).message);
    return fallback;
  }
}

export const BRANCH_EXPR = `COALESCE(NULLIF(branch_display_name,''),NULLIF(applied_for_branch,''),'Unspecified')`;

export interface CubeRow {
  d: string;
  b: string;
  status: string;
  stage: string;
  n: number;
}
let cube: { at: number; rows: CubeRow[] } | null = null;
let cubeInflight: Promise<CubeRow[]> | null = null;

/** Day × branch × status × stage counts — ~2k rows, drives KPIs, trend, funnel, branches and drop-off. */
export async function getCube(): Promise<CubeRow[]> {
  if (cube && Date.now() - cube.at < CUBE_TTL_MS) return cube.rows;
  // FORCE INDEX makes MySQL read the covering index instead of every wide row (~3x faster). Fall back if the index is absent.
  const cubeSql = (
    hint: string,
  ) => `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS d, ${BRANCH_EXPR} AS b, status, current_stage AS stage, COUNT(*) AS n
     FROM ats_candidate ${hint} WHERE active_status = 1 AND ${reportingScope("ats_candidate")} GROUP BY d, b, status, stage`;
  cubeInflight ??= q<CubeRow>(cubeSql("FORCE INDEX (idx_ats_candidate_dash)"))
    .catch((e: { errno?: number }) =>
      e?.errno === 1176 ? q<CubeRow>(cubeSql("")) : Promise.reject(e),
    )
    .then((rows) => {
      cube = {
        at: Date.now(),
        rows: rows.map((r) => ({ ...r, b: branchDisplay(r.b), n: num(r.n) })),
      };
      return cube.rows;
    })
    .finally(() => {
      cubeInflight = null;
    });
  return cubeInflight;
}

export const ymd = (t: number) =>
  new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Canonical source label (repo vocabulary: merges WALKIN / Walk-In / walk in). */
export const sourceLabel = sourceDisplay;

interface Tally {
  total: number;
  selected: number;
  rejected: number;
  joined: number;
}
const blank = (): Tally => ({ total: 0, selected: 0, rejected: 0, joined: 0 });
function add(
  t: Tally,
  status: string,
  stage: string,
  n: number,
  joined = false,
) {
  t.total += n;
  if (isSelected(status, stage)) t.selected += n;
  if (status === "Rejected") t.rejected += n;
  if (joined || JOINED.includes(stage)) t.joined += n;
}

function tallyBy<T>(
  rows: T[],
  keyOf: (r: T) => string,
  get: (r: T) => { status: string; stage: string; n: number; joined?: boolean },
) {
  const m = new Map<string, Tally>();
  for (const r of rows) {
    const k = keyOf(r),
      g = get(r),
      t = m.get(k) ?? blank();
    add(t, g.status, g.stage, g.n, g.joined);
    m.set(k, t);
  }
  return [...m.entries()]
    .map(([name, t]) => ({ name, ...t, selRate: pct(t.selected, t.total) }))
    .sort((a, b) => b.total - a.total);
}

async function compute(period: OverviewPeriod, branch: string) {
  const days = { today: 1, "7d": 7, "30d": 30, "90d": 90, all: null }[period];
  const now = Date.now();
  const from = days ? ymd(now - (days - 1) * 86_400_000) : "0000-00-00";
  const prevFrom = days ? ymd(now - (2 * days - 1) * 86_400_000) : "";
  const inCur = (d: string) => d >= from;
  const inPrev = (d: string) => !!days && d >= prevFrom && d < from;

  const win = days
    ? `AND created_at >= DATE_SUB(CURDATE(), INTERVAL ${days - 1} DAY)`
    : "";
  const bf = branch ? branchFilter(branch) : null;
  const brSql = bf ? `AND ${bf.sql}` : "";
  const brArgs = bf ? bf.params : [];

  const joinedInfo = await getJoinedInfo();
  const jsql = joinedIdSql("id", joinedInfo.ids);
  const [rows, dims, heat, aging, tth, offers, bgv, queue, dup] =
    await Promise.all([
      getCube(),
      // Recruiter / source / process / gender need columns the cube omits; engaged candidates only (~8k rows).
      safe(
        "dims",
        () =>
          q<{
            ch: string;
            pr: string;
            rc: string;
            g: string;
            status: string;
            stage: string;
            jn: number;
            n: number;
          }>(
            `SELECT sourcing_channel AS ch, applied_for_process AS pr,
              COALESCE(NULLIF(recruiter_name,''),'Unassigned') AS rc, gender AS g, status, current_stage AS stage, (${jsql.sql}) AS jn, COUNT(*) AS n
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope("ats_candidate")} AND status <> ? ${win} ${brSql}
       GROUP BY ch, pr, rc, g, status, stage, jn`,
            [...jsql.params, LEAD, ...brArgs],
          ),
        [],
      ),
      safe(
        "heat",
        () =>
          q<{ dow: number; hr: number; n: number }>(
            `SELECT DAYOFWEEK(created_at) AS dow, HOUR(created_at) AS hr, COUNT(*) AS n
       FROM ats_candidate WHERE active_status = 1 AND ${reportingScope("ats_candidate")} AND status <> ? ${win} ${brSql} GROUP BY dow, hr`,
            [LEAD, ...brArgs],
          ),
        [],
      ),
      safe(
        "aging",
        () =>
          q<{ bucket: string; n: number }>(
            `SELECT CASE WHEN d <= 1 THEN '0-1d' WHEN d <= 3 THEN '2-3d' WHEN d <= 7 THEN '4-7d' WHEN d <= 14 THEN '8-14d' ELSE '15d+' END AS bucket, COUNT(*) AS n
       FROM (SELECT DATEDIFF(NOW(), updated_at) AS d FROM ats_candidate
             WHERE active_status = 1 AND ${reportingScope("ats_candidate")} AND status IN (${ph(OPEN_STATUSES)}) ${brSql}) t GROUP BY bucket`,
            [...OPEN_STATUSES, ...brArgs],
          ),
        [],
      ),
      safe(
        "tth",
        () =>
          q<{ hrs: number | null }>(
            `SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, c.created_at, s.submitted_at)) / 60, 1) AS hrs
       FROM ats_interview_submission s JOIN ats_candidate c ON c.id = s.candidate_id
       WHERE ${reportingScope("c")} AND s.final_decision = 'Selected' AND s.submitted_at >= c.created_at
         ${days ? `AND s.submitted_at >= DATE_SUB(CURDATE(), INTERVAL ${days - 1} DAY)` : ""}`,
          ),
        [],
      ),
      safe(
        "offers",
        () =>
          q<{ status: string; n: number }>(
            `SELECT status, COUNT(*) AS n FROM ats_employment_offer
       ${days ? `WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${days - 1} DAY)` : ""} GROUP BY status`,
          ),
        [],
      ),
      safe(
        "bgv",
        () =>
          q<{ status: string; n: number }>(
            `SELECT overall_status AS status, COUNT(*) AS n FROM candidate_bgv_report
       ${days ? `WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ${days - 1} DAY)` : ""} GROUP BY overall_status`,
          ),
        [],
      ),
      safe(
        "queue",
        () =>
          q<Record<string, number>>(
            `SELECT COUNT(*) AS today, SUM(status = 'active') AS active, SUM(status = 'walked_out') AS walked_out,
              SUM(status = 'completed') AS completed,
              SUM(status = 'active' AND TIMESTAMPDIFF(MINUTE, arrival_time, NOW()) > ${SLA_MINUTES}) AS sla_breach,
              ROUND(AVG(CASE WHEN status = 'active' THEN TIMESTAMPDIFF(MINUTE, arrival_time, NOW()) END)) AS avg_wait_min
       FROM ats_queue_token WHERE DATE(arrival_time) = CURDATE()`,
          ),
        [],
      ),
      safe(
        "dup",
        () =>
          q<{ unresolved: number }>(
            `SELECT COALESCE(SUM(resolved = 0), 0) AS unresolved FROM ats_duplicate_log`,
          ),
        [],
      ),
    ]);

  // ── KPI cohorts from the cube ──
  const scoped = rows.filter((r) => !branch || r.b === branch);
  const engaged = (r: CubeRow) => r.status !== LEAD;
  const cohort = (pred: (d: string) => boolean) => {
    const c = {
      leads: 0,
      registered: 0,
      interviewed: 0,
      selected: 0,
      offered: 0,
      approved: 0,
      joined: 0,
      rejected: 0,
      noShow: 0,
      hold: 0,
      waiting: 0,
    };
    for (const r of scoped) {
      if (!pred(r.d)) continue;
      if (!engaged(r)) {
        c.leads += r.n;
        continue;
      }
      c.registered += r.n;
      if (INTERVIEWED.includes(r.stage)) c.interviewed += r.n;
      if (isSelected(r.status, r.stage)) c.selected += r.n;
      if (OFFERED.includes(r.stage)) c.offered += r.n;
      if (APPROVED.includes(r.stage)) c.approved += r.n;
      if (r.status === "Rejected") c.rejected += r.n;
      if (r.status === "No Show") c.noShow += r.n;
      if (HOLD_STATUSES.includes(r.status)) c.hold += r.n;
      if (r.status === "Waiting") c.waiting += r.n;
    }
    // Joined comes from the resolved id set (stage OR employee-mobile match), keyed by registration day + branch.
    for (const [key, n] of joinedInfo.byDayBranch) {
      const [d, b] = key.split("|");
      if (pred(d) && (!branch || b === branch)) c.joined += n;
    }
    return c;
  };
  const k = cohort(inCur),
    kp = cohort(inPrev);
  const delta = (a: number, b: number) => (days && b ? pct(a - b, b) : null);

  // ── Trend (last ≤90 days, by registration date) ──
  const trendFrom = ymd(now - (Math.min(days ?? 90, 90) - 1) * 86_400_000);
  const byDay = new Map<
    string,
    { registered: number; selected: number; rejected: number }
  >();
  for (const r of scoped) {
    if (r.d < trendFrom || !engaged(r)) continue;
    const t = byDay.get(r.d) ?? { registered: 0, selected: 0, rejected: 0 };
    t.registered += r.n;
    if (isSelected(r.status, r.stage)) t.selected += r.n;
    if (r.status === "Rejected") t.rejected += r.n;
    byDay.set(r.d, t);
  }
  const trend = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, ...t }));

  // ── Breakdowns ──
  const curEngaged = rows.filter((r) => engaged(r) && inCur(r.d));
  const branches = tallyBy(
    curEngaged,
    (r) => r.b,
    (r) => ({ status: r.status, stage: r.stage, n: r.n }),
  )
    .slice(0, 15)
    .map(({ name, total, selected, rejected, selRate }) => ({
      name,
      total,
      selected,
      rejected,
      selRate,
    }));
  const dropMap = new Map<string, number>();
  for (const r of scoped) {
    if (
      !engaged(r) ||
      !inCur(r.d) ||
      (r.status !== "Rejected" && r.status !== "No Show")
    )
      continue;
    const label = r.stage === "Applied" ? "Applied (screened out)" : r.stage;
    dropMap.set(label, (dropMap.get(label) ?? 0) + r.n);
  }
  const dropoff = [...dropMap.entries()]
    .map(([stage, n]) => ({ stage, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  const dim = (keyOf: (r: (typeof dims)[number]) => string) =>
    tallyBy(dims, keyOf, (r) => ({
      status: r.status,
      stage: r.stage,
      n: num(r.n),
      joined: !!num(r.jn),
    }));
  const sources = dim((r) => sourceLabel(r.ch))
    .slice(0, 12)
    .map((s) => ({
      name: s.name,
      total: s.total,
      selected: s.selected,
      joined: s.joined,
      convRate: s.selRate,
    }));
  const processes = dim((r) => readable(r.pr))
    .slice(0, 12)
    .map(({ name, total, selected, rejected, selRate }) => ({
      name,
      total,
      selected,
      rejected,
      selRate,
    }));
  const nameRc = recruiterNamer(dims.map((r) => r.rc));
  const recruiters = dim((r) => nameRc(r.rc))
    .slice(0, 15)
    .map(({ name, total, selected, rejected, joined, selRate }) => ({
      name,
      total,
      selected,
      rejected,
      joined,
      selRate,
    }));
  const demographics = dim((r) => r.g || "Unknown").map((g) => ({
    name: g.name,
    n: g.total,
  }));

  // ── Offers, BGV, queue ──
  const offerMap: Record<string, number> = {};
  for (const o of offers)
    offerMap[
      o.status === "bh_approved"
        ? "approved"
        : o.status === "bh_rejected"
          ? "rejected"
          : o.status
    ] = num(o.n);
  const offersTotal = Object.values(offerMap).reduce((a, b) => a + b, 0);
  const bgvTotal = bgv.reduce((a, b) => a + num(b.n), 0);
  const bgvOf = (s: string) => num(bgv.find((b) => b.status === s)?.n);
  const qr = queue[0] ?? {};
  const activeQ = num(qr.active);

  // ── Deeper analytics: weekly trend, weekday pattern, movers, anomalies, run-rate ──
  const weekOf = (d: string) => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };
  const weeks = new Map<
    string,
    { registered: number; selected: number; rejected: number }
  >();
  const dowTally = new Map<number, { registered: number; selected: number }>();
  const from12w = ymd(now - 84 * 86_400_000);
  for (const r of scoped) {
    if (!engaged(r)) continue;
    if (r.d >= from12w) {
      const k = weekOf(r.d),
        w = weeks.get(k) ?? { registered: 0, selected: 0, rejected: 0 };
      w.registered += r.n;
      if (isSelected(r.status, r.stage)) w.selected += r.n;
      if (r.status === "Rejected") w.rejected += r.n;
      weeks.set(k, w);
    }
    if (inCur(r.d)) {
      const dw = new Date(`${r.d}T00:00:00Z`).getUTCDay() + 1,
        x = dowTally.get(dw) ?? { registered: 0, selected: 0 };
      x.registered += r.n;
      if (isSelected(r.status, r.stage)) x.selected += r.n;
      dowTally.set(dw, x);
    }
  }
  const weekly = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, w]) => ({
      week,
      ...w,
      selRate: pct(w.selected, w.registered),
    }));
  const weekday = [1, 2, 3, 4, 5, 6, 7].map((dw) => ({
    dow: dw,
    registered: dowTally.get(dw)?.registered ?? 0,
    selRate: pct(
      dowTally.get(dw)?.selected ?? 0,
      dowTally.get(dw)?.registered ?? 0,
    ),
  }));

  // Branch movers: volume and selection-rate change against the previous equal-length window.
  const branchWin = (pred: (d: string) => boolean) =>
    tallyBy(
      rows.filter((r) => engaged(r) && pred(r.d)),
      (r) => r.b,
      (r) => ({ status: r.status, stage: r.stage, n: r.n }),
    );
  const curB = branchWin(inCur),
    prevB = new Map(branchWin(inPrev).map((b) => [b.name, b]));
  const movers = days
    ? curB
        .filter((b) => b.name !== "Unspecified")
        .map((b) => {
          const p = prevB.get(b.name);
          return {
            name: b.name,
            total: b.total,
            prevTotal: p?.total ?? 0,
            volumeDelta: p?.total ? pct(b.total - p.total, p.total) : null,
            selRate: b.selRate,
            selRateDelta:
              p && p.total >= 10
                ? Math.round((b.selRate - p.selRate) * 10) / 10
                : null,
          };
        })
        .filter((m) => m.total >= 15 || m.prevTotal >= 15)
    : [];
  const byVol = [...movers]
    .filter((m) => m.volumeDelta != null)
    .sort((a, b) => (b.volumeDelta ?? 0) - (a.volumeDelta ?? 0));

  // Anomalies: days more than 2 standard deviations from the period mean (Sundays excluded from droughts).
  const series = trend.map((t) => t.registered);
  const mean = series.reduce((a, b) => a + b, 0) / (series.length || 1);
  const sd = Math.sqrt(
    series.reduce((a, b) => a + (b - mean) ** 2, 0) / (series.length || 1),
  );
  const anomalies =
    sd > 0 && series.length >= 10
      ? trend
          .map((t) => ({
            date: t.date,
            value: t.registered,
            z: Math.round(((t.registered - mean) / sd) * 10) / 10,
          }))
          .filter(
            (a) =>
              Math.abs(a.z) >= 2 &&
              !(a.z < 0 && new Date(`${a.date}T00:00:00Z`).getUTCDay() === 0),
          )
          .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
          .slice(0, 4)
      : [];

  // Run-rate projection for the current calendar month.
  const monthKey = ymd(now).slice(0, 7);
  const mtd = scoped.filter((r) => engaged(r) && r.d.startsWith(monthKey));
  const mtdReg = mtd.reduce((a, r) => a + r.n, 0),
    mtdSel = mtd
      .filter((r) => isSelected(r.status, r.stage))
      .reduce((a, r) => a + r.n, 0);
  const dayOfMonth = Number(ymd(now).slice(8, 10)),
    monthDays = new Date(
      Number(monthKey.slice(0, 4)),
      Number(monthKey.slice(5, 7)),
      0,
    ).getDate();
  const last7 = trend.slice(-7),
    avg7 = last7.length
      ? last7.reduce((a, t) => a + t.registered, 0) / last7.length
      : 0;
  const runRate = {
    month: monthKey,
    mtdRegistered: mtdReg,
    mtdSelected: mtdSel,
    dailyAvg7: Math.round(avg7 * 10) / 10,
    dayOfMonth,
    daysInMonth: monthDays,
    projectedRegistered: Math.round(mtdReg + avg7 * (monthDays - dayOfMonth)),
    projectedSelected: Math.round(
      mtdSel + avg7 * (monthDays - dayOfMonth) * (mtdReg ? mtdSel / mtdReg : 0),
    ),
  };

  const data = {
    generatedAt: new Date().toISOString(),
    period,
    branch: branch || null,
    kpis: {
      registered: {
        value: k.registered,
        delta: delta(k.registered, kp.registered),
      },
      selected: {
        value: k.selected,
        delta: delta(k.selected, kp.selected),
        rate: pct(k.selected, k.registered),
      },
      rejected: {
        value: k.rejected,
        delta: delta(k.rejected, kp.rejected),
        rate: pct(k.rejected, k.registered),
      },
      joined: {
        value: k.joined,
        delta: delta(k.joined, kp.joined),
        rate: pct(k.joined, k.selected),
      },
      inProcess: { value: k.waiting + k.hold },
      leads: k.leads,
      noShow: k.noShow,
      noShowRate: pct(k.noShow, k.registered),
      hrsToSelect: num(tth[0]?.hrs),
      offerApprovalRate: pct(offerMap.approved ?? 0, offersTotal),
      offersTotal,
      bgvClearRate: pct(bgvOf("clear"), bgvTotal),
      bgvFlagRate: pct(bgvOf("refer") + bgvOf("negative"), bgvTotal),
      duplicateUnresolved: num(dup[0]?.unresolved),
      walkoutRate: pct(num(qr.walked_out), num(qr.today)),
    },
    funnel: [
      { stage: "Applied", n: k.registered + k.leads },
      { stage: "Engaged", n: k.registered },
      { stage: "Interviewed", n: k.interviewed },
      { stage: "Selected", n: k.selected },
      { stage: "Offer approved", n: k.approved },
      { stage: "Joined", n: k.joined },
    ],
    outcomes: {
      selected: k.selected,
      rejected: k.rejected,
      noShow: k.noShow,
      hold: k.hold,
      waiting: k.waiting,
      joined: k.joined,
      registered: k.registered,
    },
    trend,
    heatmap: heat.map((r) => ({
      dow: num(r.dow),
      hour: num(r.hr),
      n: num(r.n),
    })),
    sources,
    branches,
    processes,
    recruiters,
    offers: {
      byStatus: offerMap,
      declineReasons: [] as { reason: string; n: number }[],
    },
    bgv: bgv.map((r) => ({
      status: r.status,
      n: num(r.n),
      avgTatDays: null as number | null,
    })),
    queue: {
      today: num(qr.today),
      active: activeQ,
      walkedOut: num(qr.walked_out),
      completed: num(qr.completed),
      slaBreach: num(qr.sla_breach),
      avgWaitMin: num(qr.avg_wait_min),
      slaMinutes: SLA_MINUTES,
    },
    aging: ["0-1d", "2-3d", "4-7d", "8-14d", "15d+"].map((b) => ({
      bucket: b,
      n: num(aging.find((a) => a.bucket === b)?.n),
    })),
    dropoff,
    demographics,
    weekly,
    weekday,
    movers: {
      up: byVol.slice(0, 3),
      down: byVol
        .slice(-3)
        .reverse()
        .filter((m) => (m.volumeDelta ?? 0) < 0),
      all: movers,
    },
    anomalies,
    runRate,
  };
  return data;
}

type Overview = Awaited<ReturnType<typeof compute>>;
const cache = new Map<string, { at: number; data: Overview }>();
const inflight = new Map<string, Promise<Overview>>();

function refresh(key: string, period: OverviewPeriod, branch: string) {
  let p = inflight.get(key);
  if (!p) {
    p = compute(period, branch)
      .then((data) => {
        cache.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Stale-while-revalidate: fresh → return; stale → return now and refresh in background; cold → await. */
export async function getAtsOverview(
  period: OverviewPeriod = "30d",
  branch?: string,
): Promise<Overview> {
  const b = branch ?? "";
  const key = `${period}|${b}`;
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < FRESH_MS) return hit.data;
  if (hit && age < STALE_MS) {
    void refresh(key, period, b).catch((e) =>
      console.error("[ats-overview] refresh failed:", e.message),
    );
    return hit.data;
  }
  return refresh(key, period, b);
}

/** Call once after boot: fills the common views sequentially (gentle on the DB), then keeps them hot every 10 minutes. */
export function warmAtsOverview() {
  const run = async () => {
    for (const p of ["30d", "today", "7d"] as OverviewPeriod[]) {
      try {
        await refresh(`${p}|`, p, "");
      } catch (e) {
        console.error("[ats-overview] warm failed:", (e as Error).message);
      }
    }
  };
  void run();
  setInterval(() => void run(), 10 * 60_000).unref();
}
