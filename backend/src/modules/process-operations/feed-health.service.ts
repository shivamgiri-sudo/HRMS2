import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { assertSafeIdentifier } from "../integration-hub/adapters/databaseAdapter.js";

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
  /**
   * Set when an active `upload_template_master` row already targets this exact
   * source table — i.e. a manual path to fill this gap exists today and needs
   * nobody to write code, only to use it. null means genuinely no path exists yet.
   * Found by checking, not assumed: process_delivery_actual has a writer
   * (bulk-upload/process-delivery-bulk.service.ts), a mounted route, and an
   * active template ("Process Delivery Actuals") — its zero rows are a usage
   * gap, not a missing pipeline, and this field is what makes that distinction
   * visible instead of another guess.
   */
  uploadTypeCode: string | null;
  uploadTypeName: string | null;
  /**
   * Rows the source table ALREADY holds for these specific processes, checked
   * live (not assumed) whenever an upload template exists. Distinguishes two
   * very different situations that both look like "never reported":
   *   0        the table really is empty for these processes — uploading
   *            through the template genuinely starts the feed.
   *   > 0      the raw data is already there in volume, and it is the
   *            METRIC COMPUTE that never ran, not a missing upload. Found
   *            checking Roster Ack % (30 processes): wfm_roster_assignment
   *            has 75,058 rows for Onfido alone, all employee_ack_status =
   *            'pending' — the acknowledgement workflow is real and unused,
   *            not a data gap a re-upload would fix.
   *   null     couldn't be checked (no matching upload template, or the
   *            source config didn't resolve safely) — say nothing rather
   *            than guess.
   */
  existingSourceRows: number | null;
}

/**
 * The blind spot this file's own doc comment names but does not close: a
 * (process, metric) pair with a real kpi_studio_definition and a real
 * data_source_id, that has NEVER written a single row to
 * process_metric_actual. getFeedHealth's query is `FROM process_metric_actual
 * ... GROUP BY`, which structurally cannot see a pair with zero rows — a feed
 * that never started is invisible to a monitor built to catch a feed that
 * stopped. Found by checking, not assumed: 163 such pairs exist right now,
 * 116 of them (PROCESS_DELIVERED_UNITS / PROCESS_DELIVERY_QUALITY, on nearly
 * every process) pointing at process_delivery_actual, which has zero rows at
 * all.
 *
 * That one is a usage gap, not a missing pipeline — checked past the first
 * guess: process_delivery_actual already has a writer
 * (bulk-upload/process-delivery-bulk.service.ts), a mounted import route, and
 * an active upload template ("Process Delivery Actuals (planned vs
 * delivered)", target_table = process_delivery_actual). Godfrey Philips' WFM
 * team just hasn't uploaded their "Order vs Delivery" sheet through it yet.
 * uploadTypeName below carries that distinction into the UI so a reader isn't
 * told to go build something that already exists.
 *
 * Grouped by (metric, source) rather than listed per process: the 116 above
 * are one root cause wearing 116 faces, and a reader needs to see that once,
 * not scroll past it 116 times.
 */
export async function getNeverReported(allowedProcessIds: Set<string>): Promise<NeverReportedGroup[]> {
  if (!allowedProcessIds.size) return [];
  const [rows] = await retryOnLock(() => db.execute<RowDataPacket[]>(
    `SELECT d.process_id, p.process_name, m.metric_code, m.metric_name, ds.source_object,
            ds.process_key_kind, ds.process_key_column, ds.process_key_value,
            ds.employee_key_column, ds.employee_key_kind,
            t.upload_type_code, t.upload_type_name
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
       JOIN process_master p ON p.id = d.process_id AND p.active_status = 1
       JOIN kpi_studio_data_source ds ON ds.id = d.data_source_id
       LEFT JOIN upload_template_master t
              ON t.target_table = ds.source_object AND t.active_status = 1
      WHERE d.active_status = 1
        AND NOT EXISTS (
          SELECT 1 FROM process_metric_actual a
           WHERE a.process_id = d.process_id AND a.metric_key = m.metric_code
        )`,
  ));

  interface Accum extends NeverReportedGroup {
    /** Working state for the existence check below — stripped before return. */
    _sourceObject: string;
    _kind: string | null;
    _keyColumn: string | null;
    _keyValues: Set<string>;
    _employeeKeyColumn: string | null;
    _employeeKeyKind: string | null;
    _processIds: Set<string>;
  }

  const groups = new Map<string, Accum>();
  for (const r of rows as any[]) {
    const processId = String(r.process_id);
    if (!allowedProcessIds.has(processId)) continue;
    const key = `${r.metric_code}|${r.source_object}`;
    const g: Accum = groups.get(key) ?? {
      metricKey: String(r.metric_code),
      metricName: r.metric_name ? String(r.metric_name) : String(r.metric_code),
      sourceObject: String(r.source_object),
      processCount: 0,
      processNames: [],
      uploadTypeCode: r.upload_type_code ? String(r.upload_type_code) : null,
      uploadTypeName: r.upload_type_name ? String(r.upload_type_name) : null,
      existingSourceRows: null,
      _sourceObject: String(r.source_object),
      _kind: r.process_key_kind ? String(r.process_key_kind) : null,
      _keyColumn: r.process_key_column ? String(r.process_key_column) : null,
      _keyValues: new Set<string>(),
      _employeeKeyColumn: r.employee_key_column ? String(r.employee_key_column) : null,
      _employeeKeyKind: r.employee_key_kind ? String(r.employee_key_kind) : null,
      _processIds: new Set<string>(),
    };
    g.processCount++;
    if (g.processNames.length < 8) g.processNames.push(String(r.process_name));
    g._processIds.add(processId);
    if (r.process_key_value != null) g._keyValues.add(String(r.process_key_value));
    groups.set(key, g);
  }

  // Existence check: only for groups where an upload template exists, since
  // it's the one place the answer changes what a reader is told to do. Each
  // check is its own try/catch — a source whose config doesn't resolve
  // safely just reports "unknown" rather than blocking the whole banner.
  for (const g of groups.values()) {
    if (!g.uploadTypeName) continue;
    try {
      const table = assertSafeIdentifier(g._sourceObject, "source table");
      const quotedTable = table.split(".").map((p) => `\`${p}\``).join(".");
      if (g._kind === "employee" && g._employeeKeyColumn && g._processIds.size) {
        const employeeCol = assertSafeIdentifier(g._employeeKeyColumn, "employee key column");
        const employeeSide = g._employeeKeyKind === "employee_id" ? "id" : "employee_code";
        const ids = [...g._processIds];
        const [cnt] = await retryOnLock(() => db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM ${quotedTable} s
             JOIN employees e ON e.\`${employeeSide}\` = s.\`${employeeCol}\`
            WHERE e.process_id IN (${ids.map(() => "?").join(",")})`,
          ids,
        ));
        g.existingSourceRows = Number((cnt as any[])[0]?.n ?? 0);
      } else if (g._kind === "column" && g._keyColumn && g._keyValues.size) {
        const keyCol = assertSafeIdentifier(g._keyColumn, "process key column");
        const values = [...g._keyValues];
        const [cnt] = await retryOnLock(() => db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM ${quotedTable} WHERE \`${keyCol}\` IN (${values.map(() => "?").join(",")})`,
          values,
        ));
        g.existingSourceRows = Number((cnt as any[])[0]?.n ?? 0);
      } else if (g._kind === "constant") {
        // The whole table already belongs to one process — no extra filter needed.
        const [cnt] = await retryOnLock(() => db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM ${quotedTable}`,
        ));
        g.existingSourceRows = Number((cnt as any[])[0]?.n ?? 0);
      }
    } catch {
      // Leave existingSourceRows null — an unresolved config says "unknown", not "empty".
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.processCount - a.processCount)
    .map(({ _sourceObject, _kind, _keyColumn, _keyValues, _employeeKeyColumn, _employeeKeyKind, _processIds, ...g }) => g);
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
