import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Feed health — which measurements have quietly stopped moving.
 *
 * Every metric on this platform is computed per day from an upstream feed, and a
 * feed that stops produces no rows, so no metric is computed, so nothing appears
 * anywhere. Silence is indistinguishable from a quiet day. That is not a
 * hypothetical:
 *
 *   COSEC biometric sync   last punch 18 June 2026, 07:27:42 — 82 days before
 *                          anyone noticed, while its integration row still read
 *                          active_status = 1 with credentials set. 17,926
 *                          missing_punch days accrued behind it, and
 *                          missing_punch pays zero.
 *   VST (client 489)       last call 20 August.
 *   Finnable (client 497)  last call 19 August.
 *
 * None of the three announced itself. A per-day metric structurally cannot: it
 * only speaks when it has a row to speak about.
 *
 * ── Why this reads process_metric_actual and not the upstream tables ─────────
 *
 * The obvious design is to query each source's own table for MAX(date). It is
 * also the fragile one: it means building dynamic SQL against a dozen tables
 * across four databases on every page load, with the date column, its format and
 * its collation all varying per source — and this session has already been
 * caught out by exactly those three things (a text date compared as a string, a
 * shift_date mistaken for punch_date, a join blocked by collation).
 *
 * What actually matters to a reader is narrower and cheaper to ask: has this
 * measurement produced a number lately? A stopped upstream and a stopped compute
 * both surface here, which is correct — both mean the number on the dashboard is
 * older than it looks, and both want a human to go and see why.
 */

/** Days without a reading before a feed is worth flagging. */
const WARN_AFTER_DAYS = 3;
const STOPPED_AFTER_DAYS = 10;

export type FeedState = "ok" | "slowing" | "stopped";

export interface FeedRow {
  metricKey: string;
  metricName: string;
  processId: string;
  processName: string;
  latestDate: string | null;
  staleDays: number | null;
  /** Readings in the 30 days before it went quiet — how established the feed was. */
  recentReadings: number;
  state: FeedState;
}

export interface FeedHealth {
  checkedAt: string;
  warnAfterDays: number;
  stoppedAfterDays: number;
  counts: { ok: number; slowing: number; stopped: number };
  /** Worst first: a reader should meet the dead feeds before the healthy ones. */
  feeds: FeedRow[];
  /** Configured, real data_source_id, but zero rows EVER — see getNeverReported. */
  neverReported: NeverReportedGroup[];
}

/**
 * Retries a read that lost a lock race.
 *
 * process_metric_actual is written continuously by the nightly compute and by
 * whoever is recomputing a process by hand, and this query groups over the whole
 * table — so losing a lock is an ordinary event here, not an error. Both codes
 * are matched deliberately: 1213 is the deadlock and 1205 the lock-wait timeout,
 * and helpers in this codebase have historically matched only the first, which
 * is why a 1205 surfaced as a hard failure rather than a retry.
 *
 * Reads only, so a retry is always safe.
 */
async function retryOnLock<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { errno?: number })?.errno;
      if ((code !== 1213 && code !== 1205) || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

function isoDate(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysSince(dateStr: string): number {
  const then = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
}

export interface NeverReportedGroup {
  metricKey: string;
  metricName: string;
  sourceObject: string;
  /** How many of the caller's own readable processes are configured for this pair. */
  processCount: number;
  /** Up to 8 real names for a reader to recognise; not every process when there are many. */
  processNames: string[];
}

/**
 * The blind spot this file's own doc comment names but does not close: a
 * (process, metric) pair with a real kpi_studio_definition and a real
 * data_source_id, that has NEVER written a single row to
 * process_metric_actual. getFeedHealth's query is `FROM process_metric_actual
 * ... GROUP BY`, which structurally cannot see a pair with zero rows — a feed
 * that never started is invisible to a monitor built to catch a feed that
 * stopped. Found by checking, not assumed: 162 such pairs exist right now,
 * 116 of them (PROCESS_DELIVERED_UNITS / PROCESS_DELIVERY_QUALITY, on nearly
 * every process) pointing at process_delivery_actual, which has zero rows at
 * all — not a per-process gap, a table nothing has ever written to.
 *
 * Grouped by (metric, source) rather than listed per process: the 116 above
 * are one root cause wearing 116 faces, and a reader needs to see that once,
 * not scroll past it 116 times.
 */
export async function getNeverReported(allowedProcessIds: Set<string>): Promise<NeverReportedGroup[]> {
  if (!allowedProcessIds.size) return [];
  const [rows] = await retryOnLock(() => db.execute<RowDataPacket[]>(
    `SELECT d.process_id, p.process_name, m.metric_code, m.metric_name, ds.source_object
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
       JOIN process_master p ON p.id = d.process_id AND p.active_status = 1
       JOIN kpi_studio_data_source ds ON ds.id = d.data_source_id
      WHERE d.active_status = 1
        AND NOT EXISTS (
          SELECT 1 FROM process_metric_actual a
           WHERE a.process_id = d.process_id AND a.metric_key = m.metric_code
        )`,
  ));

  const groups = new Map<string, NeverReportedGroup>();
  for (const r of rows as any[]) {
    const processId = String(r.process_id);
    if (!allowedProcessIds.has(processId)) continue;
    const key = `${r.metric_code}|${r.source_object}`;
    const g = groups.get(key) ?? {
      metricKey: String(r.metric_code),
      metricName: r.metric_name ? String(r.metric_name) : String(r.metric_code),
      sourceObject: String(r.source_object),
      processCount: 0,
      processNames: [],
    };
    g.processCount++;
    if (g.processNames.length < 8) g.processNames.push(String(r.process_name));
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.processCount - a.processCount);
}

/**
 * @param allowedProcessIds the caller's own readable set — feed health is still
 *        process data, and a stopped feed names a client.
 */
export async function getFeedHealth(allowedProcessIds: Set<string>): Promise<FeedHealth> {
  if (!allowedProcessIds.size) {
    return {
      checkedAt: isoDate(new Date()), warnAfterDays: WARN_AFTER_DAYS,
      stoppedAfterDays: STOPPED_AFTER_DAYS,
      counts: { ok: 0, slowing: 0, stopped: 0 }, feeds: [], neverReported: [],
    };
  }

  // One pass over every (process, metric) pair that has ever produced a number,
  // with when it last did and how busy it was in the month before that. The
  // volume matters: a metric that produced twice in its life going quiet is not
  // the same event as one that produced daily for a month and then stopped.
  const [rows] = await retryOnLock(() => db.execute<RowDataPacket[]>(
    `SELECT a.process_id, p.process_name, a.metric_key,
            COALESCE(m.metric_name, a.metric_key) metric_name,
            MAX(a.score_date) latest,
            SUM(a.score_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) recent_readings
       FROM process_metric_actual a
       JOIN process_master p ON p.id = a.process_id AND p.active_status = 1
       LEFT JOIN kpi_metric_master m ON m.metric_code = a.metric_key
      WHERE a.actual_value IS NOT NULL
      GROUP BY a.process_id, p.process_name, a.metric_key, m.metric_name
      HAVING MAX(a.score_date) >= DATE_SUB(CURDATE(), INTERVAL 120 DAY)`,
  ));

  const feeds: FeedRow[] = [];
  for (const r of rows as any[]) {
    const processId = String(r.process_id);
    if (!allowedProcessIds.has(processId)) continue;
    const latestDate = r.latest ? isoDate(r.latest) : null;
    const staleDays = latestDate ? daysSince(latestDate) : null;
    const state: FeedState =
      staleDays === null ? "stopped"
        : staleDays >= STOPPED_AFTER_DAYS ? "stopped"
          : staleDays > WARN_AFTER_DAYS ? "slowing" : "ok";
    feeds.push({
      metricKey: String(r.metric_key),
      metricName: String(r.metric_name),
      processId,
      processName: String(r.process_name),
      latestDate, staleDays,
      recentReadings: Number(r.recent_readings) || 0,
      state,
    });
  }

  // Stopped first, then longest-quiet, then the busiest feed among equals — the
  // one whose silence costs most is the one to look at first.
  const rank: Record<FeedState, number> = { stopped: 0, slowing: 1, ok: 2 };
  feeds.sort((a, b) =>
    rank[a.state] - rank[b.state]
    || (b.staleDays ?? 0) - (a.staleDays ?? 0)
    || b.recentReadings - a.recentReadings);

  const neverReported = await getNeverReported(allowedProcessIds);

  return {
    checkedAt: isoDate(new Date()),
    warnAfterDays: WARN_AFTER_DAYS,
    stoppedAfterDays: STOPPED_AFTER_DAYS,
    counts: {
      ok: feeds.filter((f) => f.state === "ok").length,
      slowing: feeds.filter((f) => f.state === "slowing").length,
      stopped: feeds.filter((f) => f.state === "stopped").length,
    },
    feeds,
    neverReported,
  };
}
