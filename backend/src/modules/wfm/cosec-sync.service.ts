import sql from "mssql";
import type { RowDataPacket } from "mysql2";
import { isEmployedOn } from "../../shared/employmentWindow.js";
import { db } from "../../db/mysql.js";
import { getNcosecPool } from "../../db/ncosecDb.js";
import { attendanceEngineService } from "./attendance-engine.service.js";
import { assessAggregatePunches } from "./cosec-punch-interpretation.service.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { logger } from "../../lib/logger.js";
import type { PunchAssessmentMode } from "./cosec-punch-interpretation.service.js";
import { buildSourceUserMaps, classifySourceUser } from "./attendance-reconciliation-mapping.js";
import { queuePayrollRecalculation, drainPayrollRecalcQueue } from "../payroll/payroll-targeted-recalculation.service.js";
import { CLOSED_RUN_STATUSES_SQL } from "../payroll/run-status.js";

export type PunchGroup = {
  cosecUserId: string;
  punchDate: string;
  firstPunch: string;
  lastPunch: string;
  totalPunches: number;
  workingMinutes: number;
  sourceSystem: string;
  sourceTable: string;
  /** Set by attributeNightShifts: this group already absorbed the next morning's exit punches. */
  tailMerged?: boolean;
  /**
   * Set by attributeNightShifts when the shift is of a kind its own rule cannot be sure about
   * (see shiftReviewReason). The write path turns it into mismatch_flag + a reason, so the day
   * lands in the mismatch queue instead of reading as clean attendance.
   */
  review?: string;
};

type SyncResult = {
  success: boolean;
  from: string;
  to: string;
  sourceTable: string;
  pulledEvents: number;
  groupedDays: number;
  migratedDays: number;
  /**
   * Days the source returned that were already stored identically and so were not rewritten.
   * Reported rather than hidden: without it `migrated` appears to collapse after this change,
   * when in fact the same days are simply no longer being written a second time.
   */
  skippedUnchanged: number;
  ignoredExcludedUsers: number;
  inactiveUsers: Array<{ cosecUserId: string; punchDate: string; totalPunches: number }>;
  unmappedUsers: Array<{ cosecUserId: string; punchDate: string; totalPunches: number }>;
  failed: Array<{ cosecUserId: string; punchDate: string; error: string }>;
};

let lastSyncResult: SyncResult | null = null;

/**
 * When the in-flight sync started, or null when idle.
 *
 * This was a plain boolean. The `finally` below does clear it, so a thrown
 * error was never the problem — a *hang* was. The COSEC SQL Server spends
 * ~15s in its post-login phase and can stall there indefinitely, and a sync
 * that never returns never reaches `finally`, so the flag stayed set for the
 * life of the process. Every subsequent run then refused with "COSEC sync is
 * already running": 5,593 failed runs, against a connector whose credentials
 * are perfectly valid.
 *
 * Holding the start time instead of a boolean lets a later run recognise a
 * lock nobody is holding any more and take it over.
 */
let runningSince: number | null = null;

/**
 * A real sync moves ~45 days of punches and takes minutes, not hours. Beyond
 * this the holder is assumed dead. Deliberately generous: taking over too
 * early risks two concurrent syncs, and the writes are upserts but the source
 * pull is expensive.
 */
const STALE_LOCK_MS = Number(process.env.COSEC_SYNC_STALE_LOCK_MS ?? 60 * 60 * 1000);

export type CosecLockDecision =
  | { action: "acquire" }
  | { action: "reject"; heldMs: number }
  | { action: "takeover"; heldMs: number };

/**
 * Pure lock decision, split out so it can be tested without a COSEC server, a
 * database, or an hour of waiting. sync() holds the only mutable state.
 */
export function decideCosecLock(
  heldSince: number | null,
  now: number,
  staleAfterMs: number,
): CosecLockDecision {
  if (heldSince === null) return { action: "acquire" };
  const heldMs = now - heldSince;
  return heldMs < staleAfterMs ? { action: "reject", heldMs } : { action: "takeover", heldMs };
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for COSEC sync`);
  return value;
}

function assertIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} contains unsafe characters`);
  }
  return value;
}

function quoteTable(tableName: string): string {
  const parts = tableName.split(".").map((part) => assertIdentifier(part.trim(), "COSEC table name"));
  return parts.map((part) => `[${part}]`).join(".");
}

function quoteColumn(columnName: string): string {
  return `[${assertIdentifier(columnName, "COSEC column name")}]`;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Always derive calendar dates in IST — COSEC stores wall-clock IST times, so
// using UTC dates here would shift the sync window by up to ±5h30m.
function toISTDateString(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Calendar date arithmetic on a YYYY-MM-DD string (UTC maths, no timezone drift). */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function defaultFromDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toISTDateString(date);
}

function defaultToDate(): string {
  return toISTDateString(new Date());
}

function normalizeDateInput(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function getConfig() {
  return {
    host: requiredEnv("NCOSEC_DB_HOST"),
    port: numberEnv("NCOSEC_DB_PORT", 1433),
    user: requiredEnv("NCOSEC_DB_USER"),
    password: requiredEnv("NCOSEC_DB_PASSWORD"),
    database: process.env.NCOSEC_DB_NAME?.trim() || "NCOSEC",
    encrypt: boolEnv("NCOSEC_DB_ENCRYPT", false),
    trustServerCertificate: boolEnv("NCOSEC_DB_TRUST_CERT", true),
    table: process.env.NCOSEC_EVENT_TABLE?.trim() || "dbo.Mx_ATDEventTrn",
    userColumn: process.env.NCOSEC_USER_ID_COLUMN?.trim() || "UserID",
    datetimeColumn: process.env.NCOSEC_DATETIME_COLUMN?.trim() || "Edatetime",
    sourceMode: process.env.NCOSEC_SOURCE_MODE === "mssql" ? "mssql" : "mysql",
    batchDays: numberEnv("NCOSEC_SYNC_LOOKBACK_DAYS", 1),
  };
}

/**
 * A run of punches for one user: first/last/count over some interval. The SQL source delivers one
 * block per (user, date, hour); tests and scripts may pass any granularity.
 */
export type PunchBlock = {
  cosecUserId: string;
  punchDate: string;
  firstPunch: string;
  lastPunch: string;
  totalPunches: number;
};

/**
 * Punches this many minutes apart start a new cluster (a new shift, or an exit after silence).
 * 9 h, not 5 h: a sparse day worker swipes at arrival, lunch and departure with gaps of 5 h or
 * more, and a 5 h threshold cut such a day into pieces and glued the morning swipe to the evening
 * before. Real gaps BETWEEN shifts are 11 h or more, and the longest silence inside one night
 * shift seen on production is 7.5 h.
 */
const SHIFT_SPLIT_GAP_MIN = 540;
/** Longest silent stretch tolerated between a shift's last punch and its morning exit. */
const MAX_TAIL_GAP_MIN = 840;
/** Smallest silence an oversized cluster may be split at. */
const MIN_SPLIT_GAP_MIN = 45;
/** No single shift is longer than this; anything longer is two shifts, not one. */
const MAX_SHIFT_SPAN_MIN = 900;
/** An exit cluster starts before this hour (no night shift's exit starts later). */
const TAIL_EARLIEST_HOUR_MAX = 10;
/** ...and is over by this hour. */
const TAIL_LATEST_HOUR = 12;

const hourOf = (ts: string) => parseInt(ts.substring(11, 13), 10);

/**
 * Shapes the attribution rule cannot be sure about. Validated 2026-10-12 against NCOSEC's own
 * per-shift table: ~94% agreement, and the residue clusters in exactly these shapes. They are
 * flagged for a human, never silently settled.
 *   - a long shift: 12 h or more
 *   - a day that starts in the small hours (00:00-05:59) and runs 10 h or more: typically a night
 *     shift's morning exit glued to the following day shift
 *   - a night-shift start whose exit is missing (single swipe, nothing after)
 */
export function shiftReviewReason(first: string, last: string, punches: number): string | undefined {
  const span = diffMinutes(first, last);
  const startHour = hourOf(first);
  if (span >= 12 * 60) return `shift spans ${(span / 60).toFixed(1)}h (12h or more) - check for a glued exit or a double shift`;
  if (startHour < 6 && span >= 10 * 60) return `starts ${first.slice(11, 16)} and runs ${(span / 60).toFixed(1)}h - a night shift's exit may be glued to the next day shift`;
  if (punches <= 1 && startHour >= 17) return `evening start with no exit punch yet`;
  return undefined;
}

/**
 * Attribute punches to SHIFTS rather than to calendar dates.
 *
 * WHY. The source groups by calendar date and takes MIN/MAX. For a night worker (in ~22:00, out
 * ~07:00) date D therefore holds the exit of shift D-1 AND the start of shift D, so its span ran
 * 00:30 -> 23:59 = 23.5 h, and the exit-only morning row was graded absent with LWP 1. Seen live on
 * 2,384 employee-days across ~234 employees (Aug-Oct 2026, NOIDA / NOIDA-2).
 *
 * RULE. A shift belongs to the date it STARTED on.
 *   1. Cluster each user's punches: a gap of 9 h or more starts a new cluster.
 *   2. A cluster that looks like an exit (starts before 10:00, ends before 12:00) is absorbed into
 *      the previous cluster when the joined shift is <= 15 h and the silence between them <= 14 h.
 *      This also re-joins a shift that has a long quiet stretch inside it.
 *   3. Each remaining cluster is a shift, dated by its first punch. Two clusters on one date are
 *      combined exactly as the old calendar-date grouping did.
 * A morning-shift worker is never glued to the evening before, because the 15 h cap rejects it.
 * The first date of the pull has no previous cluster to join, so a leading exit cluster there is
 * dropped as belonging to a shift that began before the window.
 *
 * Returns the attributed groups plus the dates whose punches were absorbed into another shift and
 * have no shift of their own left; their stale rows have to be cleared by the caller.
 */
export function attributeNightShifts(
  blocks: PunchBlock[],
  sourceSystem: string,
  sourceTable: string,
): { groups: PunchGroup[]; consumedDates: Array<{ cosecUserId: string; punchDate: string }> } {
  const byUser = new Map<string, PunchBlock[]>();
  for (const b of blocks) {
    const arr = byUser.get(b.cosecUserId) ?? [];
    arr.push(b);
    byUser.set(b.cosecUserId, arr);
  }
  const windowStart = blocks.reduce((min, b) => {
    const d = b.firstPunch.slice(0, 10);
    return min === "" || d < min ? d : min;
  }, "");

  type Cluster = { first: string; last: string; count: number; absorbed: boolean; blocks: PunchBlock[] };
  const groups: PunchGroup[] = [];
  const consumedDates: Array<{ cosecUserId: string; punchDate: string }> = [];

  for (const [cosecUserId, userBlocks] of byUser) {
    userBlocks.sort((a, b) => a.firstPunch.localeCompare(b.firstPunch));

    // 1. cluster by silence
    const clusters: Cluster[] = [];
    for (const b of userBlocks) {
      const last = clusters[clusters.length - 1];
      if (last && diffMinutes(last.last, b.firstPunch) < SHIFT_SPLIT_GAP_MIN) {
        if (b.lastPunch > last.last) last.last = b.lastPunch;
        last.count += b.totalPunches;
        last.blocks.push(b);
      } else {
        clusters.push({ first: b.firstPunch, last: b.lastPunch, count: b.totalPunches, absorbed: false, blocks: [b] });
      }
    }

    // 1b. A cluster longer than any real shift is two shifts chained by small gaps: a night shift's
    // exit followed, an hour or two later, by the next day shift (MAS49499: 20:23 ... 07:14, then
    // 08:49 ... 16:01). Split at the largest internal silence until every piece is a plausible
    // shift. Silences under MIN_SPLIT_GAP_MIN are left alone, and a cluster that cannot be split
    // stays whole and takes the calendar-date fallback below.
    const splitOversized = (c: Cluster): Cluster[] => {
      if (diffMinutes(c.first, c.last) <= MAX_SHIFT_SPAN_MIN || c.blocks.length < 2) return [c];
      const bl = [...c.blocks].sort((x, y) => x.firstPunch.localeCompare(y.firstPunch));
      // Prefer a silence that looks like "night shift's exit, then the day shift starts": the part
      // before it ends 04:00-09:59 and the part after it begins 05:00-11:59. Among those take the
      // LAST one whose two parts are both a plausible shift length - the exit is the end of the
      // night's activity, and an earlier quiet stretch inside the night (MAS49499: 04:49 -> 06:59
      // while his exit was 07:14) must not be mistaken for it. With no such silence, the largest.
      let best = -1, bestGap = 0, bestPref = -1;
      let runEnd = bl[0].lastPunch;
      for (let i = 1; i < bl.length; i++) {
        const gap = diffMinutes(runEnd, bl[i].firstPunch);
        const endH = hourOf(runEnd), startH = hourOf(bl[i].firstPunch);
        if (gap >= MIN_SPLIT_GAP_MIN && endH >= 4 && endH < 10 && startH >= 5 && startH < 12
          && diffMinutes(c.first, runEnd) <= MAX_SHIFT_SPAN_MIN
          && diffMinutes(bl[i].firstPunch, c.last) <= MAX_SHIFT_SPAN_MIN) bestPref = i;
        if (gap > bestGap) { bestGap = gap; best = i; }
        if (bl[i].lastPunch > runEnd) runEnd = bl[i].lastPunch;
      }
      if (bestPref >= 0) {
        best = bestPref;
        bestGap = MIN_SPLIT_GAP_MIN; // a qualifying silence is already at least this long
      }
      if (best < 0 || bestGap < MIN_SPLIT_GAP_MIN) return [c];
      const mkc = (part: PunchBlock[]): Cluster => ({
        first: part[0].firstPunch,
        last: part.reduce((m, b) => (b.lastPunch > m ? b.lastPunch : m), part[0].lastPunch),
        count: part.reduce((n, b) => n + b.totalPunches, 0),
        absorbed: false,
        blocks: part,
      });
      return [...splitOversized(mkc(bl.slice(0, best))), ...splitOversized(mkc(bl.slice(best)))];
    };
    const split = clusters.flatMap(splitOversized);
    clusters.length = 0;
    clusters.push(...split);

    // 2. absorb exit-like clusters into the previous shift
    const shifts: Cluster[] = [];
    const goneDates: string[] = [];
    for (const c of clusters) {
      const prev = shifts[shifts.length - 1];
      const exitLike = hourOf(c.first) < TAIL_EARLIEST_HOUR_MAX && hourOf(c.last) < TAIL_LATEST_HOUR;
      if (prev && exitLike
        && diffMinutes(prev.last, c.first) <= MAX_TAIL_GAP_MIN
        && diffMinutes(prev.first, c.last) <= MAX_SHIFT_SPAN_MIN) {
        prev.last = c.last;
        prev.count += c.count;
        prev.blocks.push(...c.blocks);
        prev.absorbed = true;
        goneDates.push(c.first.slice(0, 10));
      } else if (!prev && exitLike && c.first.slice(0, 10) === windowStart) {
        goneDates.push(c.first.slice(0, 10));
      } else {
        shifts.push({ ...c });
      }
    }

    // 3. one group per start date
    const byDate = new Map<string, PunchGroup>();
    const place = (punchDate: string, first: string, last: string, count: number, absorbed: boolean) => {
      const existing = byDate.get(punchDate);
      if (existing && diffMinutes(first < existing.firstPunch ? first : existing.firstPunch,
                                  last > existing.lastPunch ? last : existing.lastPunch) > MAX_SHIFT_SPAN_MIN) {
        // Two clusters starting the same date that cannot be one shift: keep the longer one
        // rather than inventing a span no one worked.
        if (diffMinutes(first, last) > existing.workingMinutes) {
          existing.firstPunch = first;
          existing.lastPunch = last;
          existing.totalPunches = count;
          existing.workingMinutes = diffMinutes(first, last);
          if (absorbed) existing.tailMerged = true; else delete existing.tailMerged;
        }
      } else if (existing) {
        if (first < existing.firstPunch) existing.firstPunch = first;
        if (last > existing.lastPunch) existing.lastPunch = last;
        existing.totalPunches += count;
        existing.workingMinutes = diffMinutes(existing.firstPunch, existing.lastPunch);
        if (absorbed) existing.tailMerged = true;
      } else {
        byDate.set(punchDate, {
          cosecUserId,
          punchDate,
          firstPunch: first,
          lastPunch: last,
          totalPunches: count,
          workingMinutes: diffMinutes(first, last),
          sourceSystem,
          sourceTable,
          ...(absorbed ? { tailMerged: true } : {}),
        });
      }
    };
    for (const sft of shifts) {
      if (diffMinutes(sft.first, sft.last) > MAX_SHIFT_SPAN_MIN) {
        // Punches chained across days with gaps under 5 h (a sparse puncher, not a night shift):
        // no honest single shift, so fall back to the calendar-date grouping used before.
        for (const b of sft.blocks) place(b.firstPunch.slice(0, 10), b.firstPunch, b.lastPunch, b.totalPunches, false);
      } else {
        place(sft.first.slice(0, 10), sft.first, sft.last, sft.count, sft.absorbed);
      }
    }
    for (const g of byDate.values()) {
      const r = shiftReviewReason(g.firstPunch, g.lastPunch, g.totalPunches);
      if (r) g.review = r;
    }
    groups.push(...byDate.values());
    // Dates a shift runs into (its exit lands there) are no longer a day of their own either.
    for (const sft of shifts) {
      const lastDate = sft.last.slice(0, 10);
      for (let d = shiftDate(sft.first.slice(0, 10), 1); d <= lastDate; d = shiftDate(d, 1)) goneDates.push(d);
    }
    for (const d of new Set(goneDates)) {
      if (!byDate.has(d)) consumedDates.push({ cosecUserId, punchDate: d });
    }
  }
  return { groups, consumedDates };
}

async function pullCosecAttendance(
  from: string,
  to: string,
): Promise<{ groups: PunchGroup[]; consumedDates: Array<{ cosecUserId: string; punchDate: string }> }> {
  const cfg = getConfig();
  const table = quoteTable(cfg.table);
  const userColumn = quoteColumn(cfg.userColumn);
  const datetimeColumn = quoteColumn(cfg.datetimeColumn);
  const pool = await getNcosecPool();
  const request = pool.request();
  request.input("fromDate", sql.Date, from);
  request.input("toDate", sql.Date, to);
  // Guard against a hung MSSQL query stalling the sync lock indefinitely.
  // The stale-lock threshold is 60 min; give the query 55 s — enough for large
  // result sets but short enough that the lock releases before the next interval.
  const QUERY_TIMEOUT_MS = 55_000;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutRace = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      try { request.cancel(); } catch { /* ignore cancel errors */ }
      reject(new Error(`pullCosecAttendance timed out after ${QUERY_TIMEOUT_MS / 1000}s`));
    }, QUERY_TIMEOUT_MS);
  });
  // One row per (user, date, hour): small enough to pull for the whole population, fine enough
  // for attributeNightShifts() to see the silences that separate one shift from the next.
  request.input("windowFrom", sql.Date, shiftDate(from, -1));
  const queryPromise = request.query(`
      SELECT
        CAST(${userColumn} AS NVARCHAR(100)) AS user_id,
        CONVERT(CHAR(10), CAST(${datetimeColumn} AS DATE), 23) AS attendance_date,
        CONVERT(CHAR(19), MIN(${datetimeColumn}), 120) AS first_punch,
        CONVERT(CHAR(19), MAX(${datetimeColumn}), 120) AS last_punch,
        COUNT_BIG(*) AS total_punches
      FROM ${table}
      WHERE ${datetimeColumn} >= @windowFrom
        AND ${datetimeColumn} < DATEADD(DAY, 1, @toDate)
        AND ${userColumn} IS NOT NULL
      GROUP BY ${userColumn}, CAST(${datetimeColumn} AS DATE), DATEPART(HOUR, ${datetimeColumn})
      ORDER BY ${userColumn}, attendance_date
    `);
  let result: Awaited<typeof queryPromise>;
  try {
    result = await Promise.race([queryPromise, timeoutRace]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
  const blocks: PunchBlock[] = result.recordset
    .map((row: any) => ({
      cosecUserId: String(row.user_id ?? "").trim(),
      punchDate: String(row.attendance_date ?? "").trim(),
      firstPunch: String(row.first_punch ?? "").trim(),
      lastPunch: String(row.last_punch ?? "").trim(),
      totalPunches: Math.max(0, Number(row.total_punches ?? 0)),
    }))
    .filter((b: PunchBlock) =>
      b.cosecUserId
      && /^\d{4}-\d{2}-\d{2}$/.test(b.punchDate)
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(b.firstPunch)
      && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(b.lastPunch)
      && Number.isFinite(b.totalPunches)
    );
  const attributed = attributeNightShifts(blocks, "cosec_sqlserver", cfg.table);
  // The extra leading day is only there so a tail can find the evening it belongs to.
  return {
    groups: attributed.groups.filter((g) => g.punchDate >= from),
    consumedDates: attributed.consumedDates.filter((d) => d.punchDate >= from),
  };
}


async function pullMysqlAttendance(from: string, to: string): Promise<PunchGroup[]> {
  const groups = new Map<string, PunchGroup>();
  const add = (row: any, sourceSystem: string, sourceTable: string) => {
    const cosecUserId = String(row.user_id ?? "").trim();
    const punchDate = String(row.attendance_date ?? "").trim();
    const rawFirst = row.first_punch;
    const rawLast = row.last_punch;
    const firstPunch = rawFirst instanceof Date
      ? `${rawFirst.getFullYear()}-${String(rawFirst.getMonth()+1).padStart(2,"0")}-${String(rawFirst.getDate()).padStart(2,"0")} ${String(rawFirst.getHours()).padStart(2,"0")}:${String(rawFirst.getMinutes()).padStart(2,"0")}:${String(rawFirst.getSeconds()).padStart(2,"0")}`
      : String(rawFirst ?? "").trim();
    const lastPunch = rawLast instanceof Date
      ? `${rawLast.getFullYear()}-${String(rawLast.getMonth()+1).padStart(2,"0")}-${String(rawLast.getDate()).padStart(2,"0")} ${String(rawLast.getHours()).padStart(2,"0")}:${String(rawLast.getMinutes()).padStart(2,"0")}:${String(rawLast.getSeconds()).padStart(2,"0")}`
      : String(rawLast ?? "").trim();
    const totalPunches = Math.max(0, Number(row.total_punches ?? 0));
    const workingMinutes = Math.max(0, Number(row.working_minutes ?? 0));
    if (
      !cosecUserId
      || !/^\d{4}-\d{2}-\d{2}$/.test(punchDate)
      || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(firstPunch)
      || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(lastPunch)
    ) return;
    const key = `${cosecUserId}__${punchDate}`;
    if (!groups.has(key)) {
      groups.set(key, {
        cosecUserId,
        punchDate,
        firstPunch,
        lastPunch,
        totalPunches,
        workingMinutes,
        sourceSystem,
        sourceTable,
      });
    }
  };

  if (await tableExists("integration_biometric_daily")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code AS user_id,
              DATE_FORMAT(activity_date, '%Y-%m-%d') AS attendance_date,
              first_punch,
              last_punch,
              COALESCE(total_punches, CASE WHEN first_punch IS NULL THEN 0 WHEN first_punch = last_punch THEN 1 ELSE 2 END) AS total_punches,
              biometric_minutes AS working_minutes
         FROM integration_biometric_daily
        WHERE activity_date >= ?
          AND activity_date <= ?
          AND employee_code IS NOT NULL
        ORDER BY activity_date DESC, updated_at DESC`,
      [from, to],
    );
    for (const row of rows) add(row, "cosec_mysql", "mas_hrms.integration_biometric_daily");
  }

  if (await tableExists("wfm_external_punch_staging")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code AS user_id,
              DATE_FORMAT(MIN(DATE(punch_time)), '%Y-%m-%d') AS attendance_date,
              MIN(punch_time) AS first_punch,
              MAX(punch_time) AS last_punch,
              COUNT(*) AS total_punches,
              TIMESTAMPDIFF(MINUTE, MIN(punch_time), MAX(punch_time)) AS working_minutes
         FROM wfm_external_punch_staging
        WHERE DATE(punch_time) >= ?
          AND DATE(punch_time) <= ?
          AND employee_code IS NOT NULL
        GROUP BY employee_code, DATE(punch_time)`,
      [from, to],
    );
    for (const row of rows) add(row, "cosec_mysql", "mas_hrms.wfm_external_punch_staging");
  }

  if (await tableExists("stg_legacy_attendance")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code AS user_id,
              DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date,
              in_time AS first_punch,
              out_time AS last_punch,
              CASE WHEN in_time IS NULL THEN 0 WHEN in_time = out_time THEN 1 ELSE 2 END AS total_punches,
              COALESCE(ROUND(total_hours * 60), TIMESTAMPDIFF(MINUTE, in_time, out_time), 0) AS working_minutes
         FROM stg_legacy_attendance
        WHERE attendance_date >= ?
          AND attendance_date <= ?
          AND employee_code IS NOT NULL`,
      [from, to],
    );
    for (const row of rows) add(row, "cosec_mysql", "mas_hrms.stg_legacy_attendance");
  }

  return [...groups.values()];
}

async function resolveEmployee(cosecUserId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            e.employee_code,
            e.branch_id,
            e.process_id,
            b.branch_name,
            p.process_name
       FROM employees e
       LEFT JOIN employee_biometric_enrollment ebe
         ON ebe.employee_id = e.id
        AND ebe.is_active = 1
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE (
          ebe.cosec_user_id = ?
          OR e.biometric_code = ?
          OR e.employee_code = ?
        )
        AND e.active_status = 1
      ORDER BY CASE
        WHEN ebe.cosec_user_id = ? THEN 0
        WHEN e.biometric_code = ? THEN 1
        ELSE 2
      END
      LIMIT 1`,
    [cosecUserId, cosecUserId, cosecUserId, cosecUserId, cosecUserId],
  );
  return rows[0] as any | undefined;
}

// COSEC stores IST wall-clock times as bare "YYYY-MM-DD HH:mm:ss" strings.
// mysql2 pool timezone:"+05:30" only shifts JavaScript Date objects — bare
// string values are written to DATETIME columns as-is. Do not append "+05:30".
function tagIST(val: string): string {
  return val; // pass bare string through unchanged
}

export function assessmentModeForPunchDate(punchDate: string, syncToDate: string): PunchAssessmentMode {
  return punchDate < defaultToDate() || punchDate < syncToDate ? "historical" : "live";
}

// Exported so a targeted, scoped backfill script (e.g. for re-materialising a specific
// employee cohort's historical attendance) can drive the exact production write path one
// punch group at a time, instead of the full-population sync() sweep. Behaviour is
// unchanged — this is the same function sync() has always called internally.
export async function migratePunchGroup(group: PunchGroup, mode: PunchAssessmentMode): Promise<"migrated" | "unmapped"> {
  const employee = await resolveEmployee(group.cosecUserId);
  if (!employee) return "unmapped";

  const assessed = assessAggregatePunches({
    firstPunch: group.firstPunch,
    lastPunch: group.lastPunch,
    totalPunches: group.totalPunches,
    workingMinutes: group.workingMinutes,
    mode,
  });
  const rawMinutes = Math.round(assessed.effectiveWorkingMinutes);
  const firstPunchIST = tagIST(assessed.effectivePunchIn ?? group.firstPunch);
  const lastPunchIST  = assessed.effectivePunchOut ? tagIST(assessed.effectivePunchOut) : null;
  await db.execute(
    `INSERT INTO employee_biometric_enrollment
       (id, employee_id, cosec_user_id, is_active, last_sync_at)
     VALUES (UUID(), ?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE is_active = 1, last_sync_at = NOW()`,
    [employee.employee_id, group.cosecUserId],
  );

  await db.execute(
    `INSERT INTO biometric_attendance_log
       (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out,
        total_punches, raw_minutes, source_system, migrated_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       cosec_user_id = VALUES(cosec_user_id),
       first_punch_in = VALUES(first_punch_in),
       last_punch_out = VALUES(last_punch_out),
       total_punches = VALUES(total_punches),
       raw_minutes = VALUES(raw_minutes),
       migrated_at = NOW()`,
    [employee.employee_id, group.cosecUserId, group.punchDate, firstPunchIST, lastPunchIST, assessed.effectivePunchCount, rawMinutes, group.sourceSystem],
  );

  await db.execute(
    `INSERT INTO integration_biometric_daily
       (id, integration_key, source_table, employee_code, activity_date,
        first_punch, last_punch, total_punches, biometric_minutes)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       first_punch = VALUES(first_punch),
       last_punch = VALUES(last_punch),
       total_punches = VALUES(total_punches),
       biometric_minutes = VALUES(biometric_minutes),
       updated_at = NOW()`,
    [group.sourceSystem, group.sourceTable, employee.employee_code, group.punchDate, firstPunchIST, lastPunchIST, assessed.effectivePunchCount, rawMinutes],
  );

  await db.execute(
    `INSERT INTO wfm_attendance_session
       (id, employee_id, session_date, login_time, logout_time, total_login_minutes,
        current_status, punch_source, branch_name, process_name)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'BIOMETRIC', ?, ?)
     ON DUPLICATE KEY UPDATE
       login_time = VALUES(login_time),
       logout_time = VALUES(logout_time),
       total_login_minutes = VALUES(total_login_minutes),
       current_status = VALUES(current_status),
       punch_source = 'BIOMETRIC'`,
    [
      employee.employee_id,
      group.punchDate,
      firstPunchIST,
      lastPunchIST,
      rawMinutes,
      assessed.effectivePunchOut ? (rawMinutes >= 540 ? "Logged Out" : "Partial") : "Logged In",
      employee.branch_name ?? null,
      employee.process_name ?? null,
    ],
  );

  await db.execute(
    `UPDATE employee_biometric_enrollment SET last_sync_at = NOW() WHERE employee_id = ? AND cosec_user_id = ?`,
    [employee.employee_id, group.cosecUserId],
  );

  const attendance = await attendanceEngineService.processEmployee(employee.employee_id, group.punchDate);
  await attendanceEngineService.upsertDailyRecord(attendance, `${group.sourceSystem}_sync`);
  await db.execute(
    `UPDATE attendance_daily_record
        SET clock_in_time = ?, clock_out_time = ?
      WHERE employee_id = ? AND record_date = ? AND is_locked = 0`,
    [firstPunchIST, lastPunchIST, employee.employee_id, group.punchDate],
  );
  if (assessed.reviewRequired || group.review) {
    await db.execute(
      `UPDATE attendance_daily_record
          SET mismatch_flag = 1,
              status_change_reason = ?
        WHERE employee_id = ? AND record_date = ? AND is_locked = 0`,
      [
        `COSEC ${mode} review: ${[assessed.reviewRequired ? assessed.reason : null, group.review ? `shift check: ${group.review}` : null].filter(Boolean).join("; ")}; punches=${assessed.effectivePunchCount}; source_span_minutes=${Math.round(group.workingMinutes ?? 0)}; applied_minutes=${rawMinutes}`,
        employee.employee_id,
        group.punchDate,
      ],
    );
  }
  await attendanceEngineService.checkAndNotifyBiometricMismatch(employee.employee_id, group.punchDate, attendance);

  return "migrated";
}

function diffMinutes(a: string, b: string): number {
  const da = new Date(a.replace(" ", "T") + "+05:30");
  const db = new Date(b.replace(" ", "T") + "+05:30");
  return Math.max(0, Math.round((db.getTime() - da.getTime()) / 60000));
}

function nextCalendarDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+05:30");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

type RosterDay = { isNightShift: boolean; isWeekOff: boolean };

/**
 * Pre-fetch roster info for all cosec-user/date combinations in the sync window
 * in a single query. Returns a map keyed "cosecUserId__YYYY-MM-DD".
 * Only published/approved_final rows are used; missing key = no roster data.
 * A shift is a night shift when end_time < start_time (crosses midnight).
 */
async function fetchRosterMap(groups: PunchGroup[]): Promise<Map<string, RosterDay>> {
  if (!groups.length) return new Map();

  const userIds = [...new Set(groups.map(g => g.cosecUserId))];
  const dates   = [...new Set(groups.flatMap(g => [g.punchDate, nextCalendarDate(g.punchDate)]))];

  const up = userIds.map(() => "?").join(",");
  const dp = dates.map(() => "?").join(",");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(ebe.cosec_user_id, e.biometric_code, e.employee_code) AS cosec_user_id,
       ra.roster_date,
       ra.shift_start_time,
       ra.shift_end_time,
       ra.is_week_off
     FROM wfm_roster_assignment ra
     JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
     LEFT JOIN employee_biometric_enrollment ebe
       ON ebe.employee_id = e.id AND ebe.is_active = 1
     WHERE ra.roster_date IN (${dp})
       AND ra.publish_status IN ('published','approved_final')
       AND (
         ebe.cosec_user_id IN (${up})
         OR e.biometric_code  IN (${up})
         OR e.employee_code   IN (${up})
       )`,
    [...dates, ...userIds, ...userIds, ...userIds],
  );

  const map = new Map<string, RosterDay>();
  for (const row of rows) {
    const key   = `${row.cosec_user_id}__${String(row.roster_date).slice(0, 10)}`;
    const start = row.shift_start_time ?? "";
    const end   = row.shift_end_time   ?? "";
    map.set(key, {
      isNightShift: !!start && !!end && end < start,
      isWeekOff: !!row.is_week_off,
    });
  }
  return map;
}

/**
 * Write a missing_punch record for a night-shift employee whose spill-over day
 * had no COSEC punches (week-off boundary with no exit scan).
 * Sets attendance_status='missing_punch' + lwp=1.00 + mismatch_flag=1 so HR
 * can review and regularise rather than payroll silently treating it as absent.
 */
async function writeMissingPunchRecord(
  employeeId: string,
  date: string,
  punchIn: string,
  branchId: string | null,
  processId: string | null,
  reason: string,
): Promise<void> {
  // No attendance outside salary start date .. exit date (shared/employmentWindow.ts).
  if (!(await isEmployedOn(employeeId, date))) return;
  await db.execute(
    `INSERT INTO attendance_daily_record
       (id, employee_id, record_date, clock_in_time, clock_out_time,
        raw_minutes, biometric_minutes, attendance_status, lwp_value,
        attendance_source, source_system, source_record_date,
        mismatch_flag, late_mark, late_by_minutes, is_locked,
        branch_id, process_id, created_by, created_at, updated_at,
        status_change_reason)
     VALUES (UUID(), ?, ?, ?, NULL, 0, 0, 'missing_punch', 1.00,
             'biometric', 'cosec_sqlserver', ?,
             1, 0, 0, 0, ?, ?, 'cosec_night_shift_guard', NOW(), NOW(), ?)
     ON DUPLICATE KEY UPDATE
       attendance_status    = IF(is_locked = 0, 'missing_punch',          attendance_status),
       clock_in_time        = IF(is_locked = 0, VALUES(clock_in_time),     clock_in_time),
       lwp_value            = IF(is_locked = 0, 1.00,                      lwp_value),
       mismatch_flag        = IF(is_locked = 0, 1,                         mismatch_flag),
       status_change_reason = IF(is_locked = 0, VALUES(status_change_reason), status_change_reason),
       source_system        = IF(is_locked = 0, 'cosec_sqlserver',         source_system),
       updated_at           = IF(is_locked = 0, NOW(),                     updated_at)`,
    [employeeId, date, punchIn, date, branchId, processId, reason],
  );

  // Best-effort audit log — table created by migration 099; not fatal if absent
  await db.execute(
    `INSERT IGNORE INTO night_shift_incomplete_punch_log
       (id, employee_id, punch_date, punch_in_time, reason, created_at)
     VALUES (UUID(), ?, ?, ?, ?, NOW())`,
    [employeeId, date, punchIn, reason],
  ).catch(() => {});
}

/**
 * Night shift rollover: merge COSEC day N and day N+1 when an employee's shift
 * crosses midnight, attributing the full shift to the roster start date.
 *
 * Guards:
 * 1. Roster-aware: prefer published roster (end_time < start_time = night shift)
 *    over the punch heuristic (firstPunch >= 18:00) so day-shift workers who
 *    occasionally punch in late are not misclassified.
 * 2. Week-off spill-over merge: if day N+1 is week_off but COSEC has early-morning
 *    exit punches, merge proceeds — employee worked through the boundary.
 * 3. Missing spill-over: night shift start on day N + rostered week_off on day N+1
 *    with zero COSEC punches → flag as missing_punch for HR review.
 * 4. Shift change: day N+1 last punch >= 10:00 → employee switched to day shift,
 *    do not merge, keep each day as its own record.
 */
export async function mergeNightShiftRollover(
  groups: PunchGroup[],
  rosterMap?: Map<string, RosterDay>,
): Promise<PunchGroup[]> {
  const map = rosterMap ?? await fetchRosterMap(groups);

  const byUser = new Map<string, PunchGroup[]>();
  for (const g of groups) {
    const arr = byUser.get(g.cosecUserId) ?? [];
    arr.push(g);
    byUser.set(g.cosecUserId, arr);
  }

  const merged: PunchGroup[] = [];
  for (const [userId, userGroups] of byUser) {
    userGroups.sort((a, b) => a.punchDate.localeCompare(b.punchDate));
    const consumed = new Set<number>();

    for (let i = 0; i < userGroups.length; i++) {
      if (consumed.has(i)) continue;
      const current = userGroups[i];
      const firstHour = parseInt(current.firstPunch.substring(11, 13), 10);

      // Guard 1: prefer roster confirmation, fall back to punch heuristic
      const rosterCurrent = map.get(`${userId}__${current.punchDate}`);
      const isNightShiftStart = rosterCurrent
        ? rosterCurrent.isNightShift
        : firstHour >= 18;

      if (!isNightShiftStart) {
        merged.push(current);
        continue;
      }

      const expectedNextDate = nextCalendarDate(current.punchDate);
      const nextIdx = (i + 1 < userGroups.length && userGroups[i + 1].punchDate === expectedNextDate)
        ? i + 1 : -1;

      if (nextIdx !== -1) {
        const next = userGroups[nextIdx];
        const nextLastHour = parseInt(next.lastPunch.substring(11, 13), 10);

        if (nextLastHour < 10) {
          // Guards 2 + normal merge: day N+1 ended before 10:00 → full merge.
          // Week-off on day N+1 is fine — employee worked through it.
          consumed.add(nextIdx);
          const gap = diffMinutes(current.lastPunch, next.firstPunch);
          merged.push({
            ...current,
            lastPunch:    next.lastPunch,
            totalPunches: current.totalPunches + next.totalPunches,
            workingMinutes: current.workingMinutes + next.workingMinutes + gap,
          });
        } else {
          // Guard 4: day N+1 last punch >= 10:00 → shift changed, do not merge
          merged.push(current);
        }
      } else {
        // Day N+1 has no COSEC punches in this sync window.
        const rosterNext = map.get(`${userId}__${expectedNextDate}`);
        if (rosterNext?.isWeekOff) {
          // Guard 3: rostered week-off with no exit scan → missing_punch
          merged.push({ ...current, missingPunch: true } as PunchGroup & { missingPunch: boolean });
        } else {
          // Spill-over date outside sync range — next sync run will merge
          merged.push(current);
        }
      }
    }
  }
  return merged;
}

/**
 * Called after a COSEC sync completes. Queues + immediately drains
 * payroll recalculation for all employees whose attendance was written
 * for open (non-locked) payroll months.
 */
export async function triggerPostSyncPayrollRecalc(
  written: Map<string, Set<string>>, // YYYY-MM → Set<employeeId>
): Promise<void> {
  for (const [month, empIds] of written) {
    // Only act if an open salary_prep_run exists for this month
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run
        WHERE run_month = ?
          AND LOWER(status) NOT IN (${CLOSED_RUN_STATUSES_SQL})
        LIMIT 1`,
      [month],
    );
    if (!(runRows as any[]).length) continue;

    for (const employeeId of empIds) {
      await queuePayrollRecalculation({
        employeeId,
        payrollMonth: month,
        sourceEventType: "cosec_sync",
        reason: "COSEC attendance sync wrote new/updated rows",
        requestedBy: "system",
      });
    }

    try {
      await drainPayrollRecalcQueue(month);
    } catch (err) {
      logger.warn({ month, err }, "[CosecSync] post-sync recalc drain failed — sync result unaffected");
    }
  }
}

/**
 * Which of these days actually differ from what biometric_attendance_log already holds.
 *
 * Compares the values that would actually be WRITTEN, not the raw ones that were read. The log
 * stores the output of assessAggregatePunches() — a single punch is stored with no punch-out and a
 * count of 1, an odd punch count is treated differently in historical mode than in live — so
 * comparing `group.totalPunches` against the stored `total_punches` would report almost every day
 * as changed and skip nothing. The assessment is a pure function over values already in hand, so
 * running it here costs nothing and is the same call migratePunchGroup() makes, with the same mode.
 *
 * That also handles the live -> historical transition for free: when a day rolls out of the sync
 * window its mode changes, the assessment changes with it, and the day is reprocessed once more.
 *
 * Deliberately NOT a datetime watermark against the source. A watermark that is slightly wrong
 * drops punches silently; comparing what we stored is exact, still inspects every group the source
 * returns, and so picks up a back-dated correction the moment its aggregate differs.
 *
 * Groups flagged missingPunch are never skipped — they are written to attendance_exception by a
 * different path and have no biometric_attendance_log row to compare against, so a stale row under
 * the same key must not be read as "already done".
 *
 * Falls back to returning every group if the lookup fails: doing the work is the safe direction,
 * since the cost of that is only the load this exists to avoid, while the cost of wrongly skipping
 * is attendance that never lands.
 */
// Exported for test: the failure mode here is silent — a filter that is slightly too eager drops
// attendance without erroring — so it is exercised directly rather than only through sync().
export async function filterUnchangedGroups(groups: PunchGroup[], syncToDate: string): Promise<PunchGroup[]> {
  if (groups.length === 0) return groups;
  try {
    const known = new Map<string, { punches: number; first: string; last: string; minutes: number }>();
    const CHUNK = 500;
    for (let i = 0; i < groups.length; i += CHUNK) {
      const slice = groups.slice(i, i + CHUNK);
      const placeholders = slice.map(() => "(?, ?)").join(", ");
      const params = slice.flatMap((g) => [g.cosecUserId, g.punchDate]);
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT cosec_user_id,
                DATE_FORMAT(punch_date, '%Y-%m-%d')                   AS punch_date,
                total_punches,
                raw_minutes,
                DATE_FORMAT(first_punch_in,  '%Y-%m-%d %H:%i:%s')     AS first_punch_in,
                DATE_FORMAT(last_punch_out,  '%Y-%m-%d %H:%i:%s')     AS last_punch_out
           FROM biometric_attendance_log
          WHERE (cosec_user_id, punch_date) IN (${placeholders})`,
        params,
      );
      for (const row of rows) {
        known.set(`${row.cosec_user_id}|${row.punch_date}`, {
          punches: Number(row.total_punches ?? 0),
          minutes: Number(row.raw_minutes ?? 0),
          first: String(row.first_punch_in ?? ""),
          last: String(row.last_punch_out ?? ""),
        });
      }
    }

    return groups.filter((group) => {
      if ((group as any).missingPunch) return true;
      const seen = known.get(`${group.cosecUserId}|${group.punchDate}`);
      if (!seen) return true; // never stored — must process

      const assessed = assessAggregatePunches({
        firstPunch: group.firstPunch,
        lastPunch: group.lastPunch,
        totalPunches: group.totalPunches,
        workingMinutes: group.workingMinutes,
        mode: assessmentModeForPunchDate(group.punchDate, syncToDate),
      });
      return (
        seen.punches !== assessed.effectivePunchCount
        || seen.minutes !== Math.round(assessed.effectiveWorkingMinutes)
        || seen.first !== String(assessed.effectivePunchIn ?? group.firstPunch ?? "")
        || seen.last !== String(assessed.effectivePunchOut ?? "")
      );
    });
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "[COSEC Sync] could not read existing aggregates; processing every day this run",
    );
    return groups;
  }
}

/**
 * A calendar date whose punches were all the exit of the previous night's shift. Earlier syncs
 * stored those punches as a short day of their own (graded absent, LWP 1). Remove that mirror and
 * regrade the day from what is left. Unlocked rows only: a regularised or payroll-locked row is
 * never overwritten here (upsertDailyRecord and the UPDATE below both guard on is_locked).
 *
 * Returns the employee id when something was cleared, null when there was nothing stale.
 */
export async function clearConsumedTailDay(cosecUserId: string, punchDate: string): Promise<string | null> {
  const employee = await resolveEmployee(cosecUserId);
  if (!employee) return null;
  const [stale] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM biometric_attendance_log
      WHERE employee_id = ? AND punch_date = ? AND (first_punch_in IS NOT NULL OR COALESCE(total_punches,0) > 0)
      LIMIT 1`,
    [employee.employee_id, punchDate],
  );
  if (!(stale as RowDataPacket[]).length) return null;

  await db.execute(`DELETE FROM biometric_attendance_log WHERE employee_id = ? AND punch_date = ?`, [employee.employee_id, punchDate]);
  await db.execute(
    `DELETE FROM wfm_attendance_session WHERE employee_id = ? AND session_date = ? AND punch_source = 'BIOMETRIC'`,
    [employee.employee_id, punchDate],
  );
  await db.execute(
    `DELETE FROM integration_biometric_daily WHERE employee_code = ? AND activity_date = ? AND integration_key = 'cosec_sqlserver'`,
    [employee.employee_code, punchDate],
  );
  const attendance = await attendanceEngineService.processEmployee(employee.employee_id, punchDate);
  await attendanceEngineService.upsertDailyRecord(attendance, "cosec_sqlserver_sync");
  await db.execute(
    `UPDATE attendance_daily_record
        SET clock_in_time = NULL, clock_out_time = NULL,
            status_change_reason = 'COSEC night-shift exit punches attributed to previous shift start date'
      WHERE employee_id = ? AND record_date = ? AND is_locked = 0
        AND attendance_status IN ('missing_punch','absent')`,
    [employee.employee_id, punchDate],
  );
  return employee.employee_id;
}

export const cosecSyncService = {
  getLastSyncResult() {
    return lastSyncResult;
  },

  isRunning() {
    return runningSince !== null;
  },

  async sync(options: {
    from?: string;
    to?: string;
    /** Scoped backfill: only these COSEC user ids are written. */
    onlyUserIds?: string[];
    /** Scoped backfill: shifts starting before this date are left untouched. */
    minWriteDate?: string;
  } = {}): Promise<SyncResult> {
    const lock = decideCosecLock(runningSince, Date.now(), STALE_LOCK_MS);
    if (lock.action === "reject") {
      throw new Error(
        `COSEC sync is already running (started ${Math.round(lock.heldMs / 1000)}s ago)`,
      );
    }
    if (lock.action === "takeover") {
      // Past the threshold nobody is coming back. Say so loudly — a silent
      // takeover would hide the hang that caused it.
      logger.warn(
        { heldMs: lock.heldMs, staleAfterMs: STALE_LOCK_MS },
        "[COSEC Sync] previous run never released the lock; assuming it died and taking over",
      );
    }
    runningSince = Date.now();
    const from = normalizeDateInput(options.from, defaultFromDate());
    const to = normalizeDateInput(options.to, defaultToDate());
    const config = getConfig();
    const sourceTable = config.sourceMode === "mysql"
      ? "mas_hrms.integration_biometric_daily,wfm_external_punch_staging,stg_legacy_attendance"
      : config.table;

    const result: SyncResult = {
      success: true,
      from,
      to,
      sourceTable,
      pulledEvents: 0,
      groupedDays: 0,
      migratedDays: 0,
      skippedUnchanged: 0,
      ignoredExcludedUsers: 0,
      inactiveUsers: [],
      unmappedUsers: [],
      failed: [],
    };

    try {
      // SQL Server source: punches are already attributed to the shift's start date by
      // attributeNightShifts(), so the old aggregate-level rollover must not run on them.
      // MySQL fallback source only has per-date aggregates and keeps the old rollover.
      let consumedDates: Array<{ cosecUserId: string; punchDate: string }> = [];
      let groups: PunchGroup[];
      if (config.sourceMode === "mysql") {
        groups = await mergeNightShiftRollover(await pullMysqlAttendance(from, to));
      } else {
        const pulled = await pullCosecAttendance(from, to);
        groups = pulled.groups;
        consumedDates = pulled.consumedDates;
      }
      if (options.onlyUserIds) {
        const only = new Set(options.onlyUserIds);
        groups = groups.filter((g) => only.has(g.cosecUserId));
        consumedDates = consumedDates.filter((d) => only.has(d.cosecUserId));
      }
      if (options.minWriteDate) {
        const min = options.minWriteDate;
        groups = groups.filter((g) => g.punchDate >= min);
        consumedDates = consumedDates.filter((d) => d.punchDate >= min);
      }
      result.pulledEvents = groups.reduce((total, group) => total + group.totalPunches, 0);
      result.groupedDays = groups.length;
      const [excludedRows, employeeRows] = await Promise.all([
        db.query<RowDataPacket[]>(
          `SELECT cosec_user_id
             FROM attendance_reconciliation_cosec_exclusion
            WHERE active_status = 1`,
        ),
        db.query<RowDataPacket[]>(
          `SELECT e.id AS employee_id, e.employee_code, e.biometric_code, e.active_status, e.employment_status, ebe.cosec_user_id
             FROM employees e
             LEFT JOIN employee_biometric_enrollment ebe
               ON ebe.employee_id = e.id`,
        ),
      ]);
      const sourceMaps = buildSourceUserMaps(
        employeeRows[0] as any[],
        (excludedRows[0] as any[]).map((row) => String(row.cosec_user_id ?? "")),
      );

      /*
       * Skip the days that have not changed since the last run.
       *
       * The source query aggregates per (user, date) across a rolling two-day window, so every
       * run returned the same ~13,000 punches and re-did the full downstream write for each one:
       * biometric_attendance_log, integration_biometric_daily, wfm_attendance_session, plus the
       * per-employee resolution around them. Measured on production 2026-09-04, that saturated
       * the shared pool on a ten-minute cadence and tripped the database circuit breaker at the
       * exact second every run finished (11:54:55, 12:05:25, 12:15:54, 12:26:23, 12:36:48) —
       * taking report downloads, report email, the inbox and the waiting-room displays down with
       * it. Raising the pool from 25 to 50 did not help, because the work, not the pool, was the
       * problem.
       *
       * A day is reprocessed only when its punch count or its last punch has actually moved.
       * Deliberately NOT a datetime watermark against the source: last_punch_out is stored in IST
       * while the source column is in the source's own zone, and a watermark across that boundary
       * silently drops punches rather than failing loudly. Comparing what we already stored is
       * exact, and still sees every group the source returns, so a back-dated correction is
       * picked up the moment its aggregate differs.
       *
       * One extra SELECT replaces thousands of writes. The comparison keys on the same
       * (cosec_user_id, punch_date) pair the log's unique key uses.
       */
      const changedGroups = await filterUnchangedGroups(groups, to);
      const skipped = groups.length - changedGroups.length;
      result.skippedUnchanged = skipped;
      if (skipped > 0) {
        logger.info(
          { pulled: groups.length, unchanged: skipped, reprocessing: changedGroups.length },
          "[COSEC Sync] skipping days whose punch count and last punch are unchanged",
        );
      }

      const writtenByMonth = new Map<string, Set<string>>();
      for (const group of changedGroups) {
        const isMissingPunch = !!(group as any).missingPunch;
        try {
          const sourceUser = classifySourceUser(group.cosecUserId, sourceMaps);
          if (sourceUser.kind === "excluded") {
            result.ignoredExcludedUsers += 1;
            continue;
          }
          if (sourceUser.kind === "inactive") {
            result.inactiveUsers.push({ cosecUserId: group.cosecUserId, punchDate: group.punchDate, totalPunches: group.totalPunches });
            continue;
          }
          if (isMissingPunch) {
            // Guard 3: night-shift start with rostered week-off and no exit punch
            const employee = await resolveEmployee(group.cosecUserId);
            if (employee) {
              await writeMissingPunchRecord(
                employee.employee_id,
                group.punchDate,
                group.firstPunch,
                employee.branch_id ?? null,
                employee.process_id ?? null,
                `Night shift started ${group.firstPunch} but no exit punch found; day N+1 is week_off`,
              );
              result.migratedDays += 1;
              const month = group.punchDate.slice(0, 7);
              if (!writtenByMonth.has(month)) writtenByMonth.set(month, new Set());
              writtenByMonth.get(month)!.add(employee.employee_id);
            } else {
              result.unmappedUsers.push({ cosecUserId: group.cosecUserId, punchDate: group.punchDate, totalPunches: group.totalPunches });
            }
          } else {
            const status = await migratePunchGroup(group, assessmentModeForPunchDate(group.punchDate, to));
            if (status === "migrated") {
              result.migratedDays += 1;
              const month = group.punchDate.slice(0, 7);
              const employee = await resolveEmployee(group.cosecUserId);
              if (employee?.employee_id) {
                if (!writtenByMonth.has(month)) writtenByMonth.set(month, new Set());
                writtenByMonth.get(month)!.add(employee.employee_id);
              }
            } else {
              result.unmappedUsers.push({ cosecUserId: group.cosecUserId, punchDate: group.punchDate, totalPunches: group.totalPunches });
            }
          }
        } catch (error) {
          result.success = false;
          result.failed.push({
            cosecUserId: group.cosecUserId,
            punchDate: group.punchDate,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // Dates whose punches were all absorbed into the previous night's shift. Older runs wrote
      // those exit punches as a day of their own, so the stale rows have to be cleared and the
      // day regraded; otherwise the phantom absent / LWP row stays forever.
      const haveGroup = new Set(groups.map((g) => `${g.cosecUserId}|${g.punchDate}`));
      for (const d of consumedDates) {
        if (haveGroup.has(`${d.cosecUserId}|${d.punchDate}`)) continue;
        try {
          const cleared = await clearConsumedTailDay(d.cosecUserId, d.punchDate);
          if (cleared) {
            result.migratedDays += 1;
            const month = d.punchDate.slice(0, 7);
            if (!writtenByMonth.has(month)) writtenByMonth.set(month, new Set());
            writtenByMonth.get(month)!.add(cleared);
          }
        } catch (error) {
          result.success = false;
          result.failed.push({
            cosecUserId: d.cosecUserId,
            punchDate: d.punchDate,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // Fire-and-forget post-sync recalc — errors are caught inside, never mask sync result
      void triggerPostSyncPayrollRecalc(writtenByMonth).catch((err) => {
        logger.warn({ err }, "[CosecSync] triggerPostSyncPayrollRecalc threw unexpectedly");
      });

      if (result.unmappedUsers.length > 0) {
        logger.warn(
          { unmappedCount: result.unmappedUsers.length, from, to, users: result.unmappedUsers.slice(0, 20) },
          "[COSEC Sync] Unmapped COSEC user IDs — attendance data dropped for these employees. Ensure employee_code is linked in mas_hrms."
        );
        // Persist so ops team can query without reading log files.
        // Column names were records_pulled/records_migrated — verified live,
        // the real integration_sync_run columns are records_read/
        // records_written. This insert has been silently failing (swallowed
        // by the .catch below) on every run since it was written — the table
        // has zero rows for any status, for either key. Also: idx_isr_key_started
        // is a plain index, not unique, so ON DUPLICATE KEY UPDATE never
        // actually triggers here (harmless, just dead).
        await db.execute(
          `INSERT INTO integration_sync_run
             (integration_key, started_at, completed_at, status, records_read, records_written,
              records_failed, error_summary)
           VALUES ('cosec_unmapped', ?, NOW(), 'warning', ?, 0, ?, ?)
           ON DUPLICATE KEY UPDATE
             completed_at = NOW(),
             records_read = VALUES(records_read),
             records_failed = VALUES(records_failed),
             error_summary = VALUES(error_summary)`,
          [
            new Date(),
            result.unmappedUsers.length,
            result.unmappedUsers.length,
            `${result.unmappedUsers.length} unmapped COSEC user(s) for ${from}→${to}: ${result.unmappedUsers.slice(0, 5).map(u => u.cosecUserId).join(", ")}`,
          ]
        ).catch((err) => {
          logger.warn({ err }, "[COSEC Sync] failed to persist unmapped-user sync_run row (non-critical, does not affect sync result)");
        });
      }

      if (result.inactiveUsers.length > 0) {
        logger.warn(
          { inactiveCount: result.inactiveUsers.length, from, to, users: result.inactiveUsers.slice(0, 20) },
          "[COSEC Sync] Inactive or resigned COSEC users are still generating punches."
        );
      }

      // Record a status row under the key the monitoring reader actually
      // checks. getCosecMonitoring (peopleos.service.ts) queries
      // integration_sync_run WHERE integration_key = 'cosec' — but no code
      // path ever wrote that key. Only 'cosec_unmapped' was written, and only
      // when unmappedUsers was non-empty, so a fully clean sync (the common
      // case) left the reader with zero rows and a permanent
      // status: "unknown" / confidence 0, even while punches were flowing
      // correctly (confirmed via /api/wfm/biometric-summary/adherence-summary
      // showing real data for the same window). Write on every completed
      // run — success or failure — independent of 'cosec_unmapped'.
      // cosecStatus reflects only the sync job's own responsibility: did it
      // run (result.success), did any punch group fail to process/write
      // (result.failed), and is its mapping table incomplete (unmappedUsers —
      // a COSEC ID with no employee mapping at all, so punches are being
      // dropped/unattributed, which genuinely is the integration's problem).
      // Deliberately excludes inactiveUsers: a resigned/inactive employee
      // still generating COSEC punches is a roster/HR data-hygiene fact,
      // independent of whether the sync itself worked — folding it in here
      // previously meant a perfectly healthy sync could show "warning" purely
      // because someone's exit wasn't processed on the badge system. That
      // count is still fully visible below (informational, not status-
      // gating) and via the existing logger.warn a few lines up.
      const cosecStatus = !result.success ? "failed"
        : (result.failed.length > 0 || result.unmappedUsers.length > 0) ? "warning"
        : "success";
      const errorSummaryParts: string[] = [];
      if (result.failed.length > 0) {
        errorSummaryParts.push(`${result.failed.length} failed punch group(s): ${result.failed.slice(0, 5).map((f) => f.error).join("; ")}`);
      }
      if (result.inactiveUsers.length > 0) {
        errorSummaryParts.push(`(info, not a sync failure) ${result.inactiveUsers.length} inactive/resigned employee(s) still generating punches`);
      }
      await db.execute(
        `INSERT INTO integration_sync_run
           (integration_key, started_at, completed_at, status, records_read, records_written, records_failed, error_summary)
         VALUES ('cosec', ?, NOW(), ?, ?, ?, ?, ?)`,
        [
          new Date(runningSince),
          cosecStatus,
          result.pulledEvents,
          result.migratedDays,
          result.failed.length,
          errorSummaryParts.length > 0 ? errorSummaryParts.join(" | ") : null,
        ],
      ).catch((err) => {
        logger.warn({ err }, "[COSEC Sync] failed to persist 'cosec' sync_run status row (non-critical, does not affect sync result)");
      });

      lastSyncResult = result;
      return result;
    } finally {
      runningSince = null;
    }
  },

  async testConnection() {
    const cfg = getConfig();
    if (cfg.sourceMode === "mysql") {
      const tables = [
        "integration_biometric_daily",
        "wfm_external_punch_staging",
        "stg_legacy_attendance",
        "attendance_daily_record",
      ];
      const counts: Record<string, number> = {};
      for (const table of tables) {
        if (!(await tableExists(table))) {
          counts[table] = 0;
          continue;
        }
        const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM ??", [table]);
        counts[table] = Number(rows[0]?.total ?? 0);
      }
      return {
        ok: true,
        source: "mas_hrms",
        accessMode: "MYSQL_HRMS_OWNED_TABLES",
        tables: counts,
        latestUserId: null,
        latestEventAt: null,
      };
    }
    const table = quoteTable(cfg.table);
    const userColumn = quoteColumn(cfg.userColumn);
    const datetimeColumn = quoteColumn(cfg.datetimeColumn);
    const pool = await getNcosecPool();
    const result = await pool.request().query(`
        SELECT TOP (1)
          CAST(${userColumn} AS NVARCHAR(100)) AS user_id,
          ${datetimeColumn} AS event_datetime
        FROM ${table}
        WHERE ${userColumn} IS NOT NULL
          AND ${datetimeColumn} IS NOT NULL
        ORDER BY ${datetimeColumn} DESC
      `);
      const row = result.recordset[0];
      return {
        ok: true,
        source: `${cfg.database}.${cfg.table}`,
        accessMode: "SELECT_ONLY",
        latestUserId: row?.user_id ? String(row.user_id) : null,
        latestEventAt: row?.event_datetime ?? null,
      };
  },
};
