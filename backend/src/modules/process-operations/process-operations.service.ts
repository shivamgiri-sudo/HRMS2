import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { assertSafeIdentifier } from "../integration-hub/adapters/databaseAdapter.js";
import { dateExpression, buildProcessEmployeeBreakdownPlan, type SourceField, type DataSourceConfig } from "../kpi/kpi-studio.sources.js";
import { evaluateFormula } from "../kpi/kpi-formula.engine.js";
import { getCachedAllocationSummary } from "../process-pnl/canonical-pnl.service.js";

/**
 * Process Operations — every metric a process actually has, in one read.
 *
 * The Client Process KPI Dashboard answers a different question: it scores a
 * fixed registry of client-facing targets. Metrics wired through KPI Studio never
 * appear there, because the registry is a hand-maintained list and they are not
 * on it. That left 57 metric codes holding real values with no page that reads
 * them, which is what this serves.
 *
 * ── Three things this states rather than leaves to be inferred ───────────────
 *
 * A metric with no reading returns value null and reports no_data. It is never
 * folded into zero. Half of everything found while wiring these metrics was a
 * confident zero standing in for "nobody measured this".
 *
 * Every metric carries how stale it is. A feed can stop and say nothing: the
 * biometric sync stopped on 18 June and went 82 days unnoticed, and two client
 * feeds stopped in August the same way. A metric that has not moved in a week is
 * reporting history, and the page should be able to say so.
 *
 * Coverage leads its section. Conversation metrics are computed only over calls
 * the AI pass actually scored, and that pass skips whole days. A conversion rate
 * read without knowing what share of calls it covers is how a measurement change
 * gets mistaken for a business collapse.
 */

// Mutable on purpose: buildScopeWhereClause takes string[], and `as const` here
// makes the array readonly, which it will not accept.
const VIEWER_ROLES: string[] = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head", "hr", "team_leader",
];

/** How long a section's metrics may go without a reading before they read as history. */
const STALE_AFTER_DAYS = 3;

export interface MetricReading {
  metricKey: string;
  label: string;
  unit: string | null;
  direction: string | null;
  /** null means no reading — never rendered as zero. */
  value: number | null;
  /** Days since the most recent reading; null when there has never been one. */
  staleDays: number | null;
  latestDate: string | null;
  /**
   * The headline is today's, and today has not finished.
   *
   * A day in progress is not a smaller version of a finished one, it is a
   * different shape: attendance rows are written absent and become present as
   * punches arrive, so Bella-Vita's shrinkage reads 100% at breakfast and 0% by
   * evening. Both are the correct value for the data present at the time, and a
   * manager glancing at "shrinkage 100%" will act on it. The number stays — it is
   * real, and for a volume metric it is exactly what you want — but the page has
   * to be able to say it is still filling in.
   */
  provisional: boolean;
  /**
   * Mean of the readings BEFORE the most recent week, so a tile can show which
   * way the number is going. Null when there is not enough history to say —
   * a arrow drawn from one prior reading is noise wearing a direction.
   */
  priorValue: number | null;
  /**
   * The real configured SLA for this metric on this process, from the live KPI
   * Studio definition -- never a guessed band. Callmaster states its targets
   * this way ("Target >= 95%") and colours pass/fail from them; a metric with
   * no target configured gets neither, rather than a threshold invented here.
   */
  targetValue: number | null;
  /** Chronological daily points for a sparkline. Gaps are gaps, not zeroes. */
  trend: Array<{ date: string; value: number | null; numerator: number | null; denominator: number | null }>;
  /** Parts behind a ratio, when the compute stored them. */
  numerator: number | null;
  denominator: number | null;
  /**
   * Where the LATEST reading came from -- 'connector' (a real pipeline wrote
   * it, whether an external feed or HRMS's own attendance/roster compute) or
   * 'manual' (a person typed it in through the Add-a-reading drawer). Null
   * only when there is no reading at all. Surfaced so a "manual" badge on a
   * tile is an honest fact about that specific number, not a guess.
   */
  source: string | null;
  /**
   * When the latest reading was actually written (process_metric_actual.updated_at),
   * ISO datetime. Only meaningful alongside `provisional` -- a same-day connector
   * figure computed at 11pm captured a very different attendance picture than one
   * computed at 6am, and "today" alone does not say which. Null when there is no
   * reading, same as the other latest-reading fields.
   */
  computedAt: string | null;
}

export interface MetricSection {
  key: string;
  title: string;
  blurb: string | null;
  metrics: MetricReading[];
}

/**
 * Section order is the "Process Performance Card" reading order requested
 * 2026-09-10: headcount/operations first (the staffing and dialler reality
 * this month), then quality (what the AI/QA passes found over those same
 * calls), then hygiene last (data-quality housekeeping -- unresolved punches,
 * correction load, roster ack -- real, but the least urgent read on the
 * page). Quality itself keeps its prior internal order (coverage before the
 * rates it qualifies, outcomes before the behaviour that explains them).
 */
const SECTIONS: Array<{ key: string; title: string; blurb: string; members: string[] }> = [
  {
    key: "operations",
    title: "Headcount & operations",
    blurb: "Staffing and dialler reality for this process, this period -- what the rest of the page explains.",
    members: [
      "AHT", "INBOUND_SL_PCT", "INBOUND_AL_PCT", "BLA_INBOUND_AL_PCT",
      "OUTBOUND_CONNECT_PCT", "AGENT_OCCUPANCY_PCT", "AGENT_UTILISATION_PCT",
      "CHAT_TICKETS", "CHAT_RESOLVED_PCT", "CHAT_FRT_SLA_PCT",
      "SHRINKAGE_PCT", "SHIFT_MINUTES_AVG", "PROCESS_JOINERS", "PROCESS_EXITS",
      "PROC_ATTENDANCE_PCT",
    ],
  },
  {
    key: "conversion",
    title: "Conversation & conversion",
    blurb:
      "Scoring coverage first: every rate here is measured only over the calls the AI pass actually judged.",
    members: [
      "FUNNEL_SCORED_PCT", "FUNNEL_OPENING_PCT", "FUNNEL_OFFER_PCT",
      "FUNNEL_SALE_PCT", "FUNNEL_OFFER_TO_SALE_PCT", "SALES_COUNT",
    ],
  },
  {
    key: "risk",
    title: "Customer risk & sentiment",
    blurb: "Raised by an AI pass over each call. A zero here means the calls were examined and none carried the flag.",
    members: [
      "RISK_REFUND_PCT", "RISK_CANCELLATION_PCT", "RISK_SCAM_PCT",
      "RISK_SOCIAL_PCT", "RISK_LEGAL_PCT", "SENTIMENT_POSITIVE_PCT",
    ],
  },
  {
    key: "conduct",
    title: "What the agent did",
    blurb: "Behaviour on the call, as opposed to how the customer reacted to it.",
    members: [
      "UPSELL_ATTEMPT_PCT", "OFFER_URGENCY_PCT", "SENSITIVE_WORD_PCT",
      "AGENT_PROFANITY_PCT", "COMPETITOR_MENTION_PCT",
      "VOC_LOGISTICS_NEG_PCT", "VOC_PRODUCT_NEG_PCT",
    ],
  },
  {
    key: "quality",
    title: "Audited quality",
    blurb: "Scored parameters from the call-audit pass. Only processes whose people are audited have these.",
    members: [
      "QA_QUALITY_PCT", "QA_EMPATHY_PCT", "QA_CONCERN_PCT", "QA_ACCURACY_PCT",
      "QA_PROBING_PCT", "QA_CLOSURE_PCT", "QA_LISTENING_PCT",
      "QA_CONCERN_ACK_PCT", "QA_INFO_ACCURACY_PCT", "BLA_CALL_QUALITY_PCT",
      // kpi_metric_master's own category column confirms these five belong
      // here (category='quality'), not a guess: opening/offer compliance,
      // mis-selling and requirement-probing checks, and the AI-scored
      // opening/offer outcomes -- the same audit pass, not a duplicate of
      // the funnel section's calls-scored coverage numbers.
      "CALL_OPENING_PCT", "NO_MISSELLING_PCT", "PLAN_RECOMMENDATION_PCT",
      "REQUIREMENT_PROBING_PCT", "OFFER_SUCCESS_PCT", "OPENING_SUCCESS_PCT",
      // TNI (Training Need Identification) findings are the quality-audit
      // pass's own coaching output -- see tni-derivation.service.ts -- so
      // they belong with the rest of what that pass produces, not floating
      // in "Other metrics".
      "PROCESS_EXTREME_TNI_COUNT", "PROCESS_OPEN_TNI_COUNT",
    ],
  },
  {
    key: "hygiene",
    title: "Hygiene",
    blurb: "Data-quality housekeeping -- real gaps, but the least urgent read on this page.",
    members: [
      "UNRESOLVED_PUNCH_PCT", "CORRECTION_LOAD_PCT", "ROSTER_ACK_PCT",
      "ATTENDANCE_ISSUES_OPEN", "ATTENDANCE_NO_EVIDENCE",
    ],
  },
];

const SECTION_OF = new Map<string, { key: string; rank: number }>();
SECTIONS.forEach((s) => s.members.forEach((m, i) => SECTION_OF.set(m, { key: s.key, rank: i })));

export async function readableProcessIds(userId: string): Promise<Set<string>> {
  const scope = await buildScopeWhereClause(userId, VIEWER_ROLES, {
    processId: "p.id", branchId: "p.branch_id",
  }, { allowAdminBypass: true, allowCeoAllRead: true });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id FROM process_master p WHERE ${scope.sql}`, scope.params,
  );
  return new Set(rows.map((r) => String(r.id)));
}


/**
 * A ratio's parts, back in the units a person counts in.
 *
 * process_metric_actual stores rollup_numerator already scaled into the metric's
 * unit, so a percentage keeps sold * 100 — which is what makes numerator divided
 * by denominator reproduce the stored value directly. It also means showing the
 * pair raw prints "1000 of 51" for a 19.6% rate. Dividing the scale back out
 * gives "10 of 51", which is the thing that actually happened.
 *
 * Only percentages are scaled this way; every other unit is stored as counted.
 */
function unscaleNumerator(numerator: number | null, unit: string | null): number | null {
  if (numerator === null) return null;
  const u = (unit ?? '').toLowerCase();
  return u === 'percentage' || u === 'percent' ? numerator / 100 : numerator;
}

/** Local calendar date. Never toISOString: in IST that lands on the previous day. */
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

/** Processes the viewer may read that actually hold a metric, most-covered first. */
export async function listProcesses(userId: string, windowDays = 45) {
  const allowed = await readableProcessIds(userId);
  if (!allowed.size) return [];
  // Day-1 visibility: this used to INNER JOIN process_metric_actual, so a
  // brand-new process was invisible in this picker entirely until someone
  // hand-wired a KPI Studio data source for it -- hiding even the parts of
  // the page (Business Health, headcount vs. mandate, hiring pipeline) that
  // read generically by process_id and need zero per-process setup. Now
  // starts from process_master and LEFT JOINs the metrics, so every active,
  // readable process is selectable from the day it's created; a process
  // with nothing computed yet just shows metrics=0/latest=null here, and
  // the page itself already renders that honestly (confirmed: getProcessOperations
  // resolves the process from process_master directly, not from this table,
  // and already tolerates an empty metrics result set).
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id AS process_id, p.process_name, p.process_code,
            p.branch_id, bm.branch_name, bm.branch_code,
            COUNT(DISTINCT a.metric_key) metrics,
            MAX(a.score_date) latest,
            (SELECT COUNT(*) FROM employees e
              WHERE e.process_id = p.id AND e.active_status = 1) headcount
       FROM process_master p
       LEFT JOIN process_metric_actual a
         ON a.process_id = p.id AND a.actual_value IS NOT NULL
            AND a.score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       LEFT JOIN branch_master bm ON bm.id = p.branch_id
      WHERE p.active_status = 1
      GROUP BY p.id, p.process_name, p.process_code, p.branch_id, bm.branch_name, bm.branch_code
      ORDER BY metrics DESC, p.process_name`,
    [windowDays],
  );

  // Of those same metric_keys, how many have at least one reading a real
  // pipeline actually wrote (source='connector') versus every reading being
  // hand-typed (source='manual'). This is the table's own authoritative
  // signal for "automated" -- NOT whether a kpi_studio_definition exists:
  // that join was tried first and found EVERY active definition (832/832)
  // carries a data_source_id, including the workforce metrics computed from
  // attendance/roster tables, which are genuinely automated too. source is
  // what actually distinguishes a hand-entered figure from a computed one.
  const [autoRows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, COUNT(DISTINCT metric_key) automated
       FROM process_metric_actual
      WHERE actual_value IS NOT NULL
        AND score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND source = 'connector'
      GROUP BY process_id`,
    [windowDays],
  );
  const automatedByProcess = new Map<string, number>(
    (autoRows as any[]).map((r) => [String(r.process_id), Number(r.automated)]),
  );

  return (rows as any[])
    .filter((r) => allowed.has(String(r.process_id)))
    .map((r) => {
      const metrics = Number(r.metrics);
      const automatedMetrics = automatedByProcess.get(String(r.process_id)) ?? 0;
      return {
        processId: String(r.process_id),
        processName: String(r.process_name),
        processCode: r.process_code ? String(r.process_code) : null,
        // A process without a branch assignment (some corporate/shared
        // processes genuinely have none) reports honestly as unassigned
        // rather than being silently dropped from a branch filter.
        branchId: r.branch_id ? String(r.branch_id) : null,
        branchName: r.branch_name ? String(r.branch_name) : null,
        branchCode: r.branch_code ? String(r.branch_code) : null,
        metrics,
        // Never a negative: a metric can be BOTH automated (a source exists)
        // and manually corrected on some days, so "automated" is not a strict
        // subset by construction -- clamp rather than show a confusing -1.
        automatedMetrics,
        manualOnlyMetrics: Math.max(0, metrics - automatedMetrics),
        headcount: Number(r.headcount),
        latestDate: r.latest ? isoDate(r.latest) : null,
        staleDays: r.latest ? daysSince(isoDate(r.latest)) : null,
      };
    });
}

export type ReportPeriod = "trend" | "today" | "wtd" | "mtd";

export interface ProcessOperations {
  processId: string;
  processName: string;
  headcount: number;
  windowDays: number;
  staleAfterDays: number;
  /** Which period the headline value/numerator/denominator represent. */
  period: ReportPeriod;
  periodFrom: string | null;
  periodTo: string | null;
  sections: MetricSection[];
  /** Metric codes this process has that no section claims. Listed, never hidden. */
  ungrouped: MetricReading[];
}

/**
 * Calendar-aligned period boundaries, and the SAME range one period back for a
 * real week-over-week / month-over-week comparison -- not "today vs a rolling
 * average of the last week", which is what the plain trend view uses instead.
 *
 * Week starts Monday, matching the roster and shrinkage-config convention
 * already in use elsewhere in this codebase (day_of_week 0 = Monday there).
 */
function periodRange(period: ReportPeriod, today: Date):
  { from: string; to: string; priorFrom: string; priorTo: string } | null {
  const iso = (d: Date) => isoDate(d);
  const clone = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (period === "today") {
    const y = clone(today); y.setDate(y.getDate() - 1);
    return { from: iso(today), to: iso(today), priorFrom: iso(y), priorTo: iso(y) };
  }
  if (period === "wtd") {
    const dow = today.getDay(); // 0 = Sunday
    const sinceMonday = (dow + 6) % 7;
    const monday = clone(today); monday.setDate(monday.getDate() - sinceMonday);
    const priorMonday = clone(monday); priorMonday.setDate(priorMonday.getDate() - 7);
    const priorSameWeekday = clone(monday); priorSameWeekday.setDate(priorSameWeekday.getDate() - 7 + sinceMonday);
    return { from: iso(monday), to: iso(today), priorFrom: iso(priorMonday), priorTo: iso(priorSameWeekday) };
  }
  if (period === "mtd") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const dayOfMonth = today.getDate();
    const priorMonthFirst = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const priorMonthLastDay = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
    const priorMonthSameDay = new Date(
      today.getFullYear(), today.getMonth() - 1, Math.min(dayOfMonth, priorMonthLastDay));
    return { from: iso(first), to: iso(today), priorFrom: iso(priorMonthFirst), priorTo: iso(priorMonthSameDay) };
  }
  return null; // "trend" -- the existing rolling-window behaviour, unchanged.
}

/**
 * A metric's real value over a date range, computed the way process grain has
 * been computed all through this codebase: SUM(numerator)/SUM(denominator)
 * across the range, never the mean of each day's own ratio -- averaging seven
 * daily percentages is not the week's percentage whenever daily volume varies,
 * and it is exactly the error process grain exists to avoid at the day level.
 *
 * A day with no reading in the range is simply absent from the sums, the same
 * way a single day's no_data already behaves -- it does not zero out the
 * period, it is left out of it.
 */
function aggregateRange(
  trend: MetricReading["trend"], unit: string | null, from: string, to: string,
): { value: number | null; numerator: number | null; denominator: number | null; daysWithData: number } {
  const inRange = trend.filter((p) => p.date >= from && p.date <= to);
  const withValue = inRange.filter((p) => p.value !== null);
  if (!withValue.length) return { value: null, numerator: null, denominator: null, daysWithData: 0 };

  const withParts = withValue.filter((p) => p.numerator !== null && p.denominator !== null);
  const u = (unit ?? "").toLowerCase();
  const isRatio = u === "percentage" || u === "percent" || u === "ratio";

  if (isRatio && withParts.length) {
    const num = withParts.reduce((s, p) => s + (p.numerator as number), 0);
    const den = withParts.reduce((s, p) => s + (p.denominator as number), 0);
    return { value: den > 0 ? (num / den) * 100 : null, numerator: num, denominator: den, daysWithData: withValue.length };
  }
  const isVolume = ["count", "currency", "number", "volume"].includes(u);
  if (isVolume) {
    const total = withValue.reduce((s, p) => s + (p.value as number), 0);
    return { value: total, numerator: null, denominator: null, daysWithData: withValue.length };
  }
  // No parts and not a plain volume (e.g. an average-of-minutes metric with no
  // numerator/denominator behind it): the mean of the days that did read is the
  // closest honest answer available, the same caveat this codebase already
  // states wherever this fallback is used.
  const mean = withValue.reduce((s, p) => s + (p.value as number), 0) / withValue.length;
  return { value: mean, numerator: null, denominator: null, daysWithData: withValue.length };
}

export async function getProcessOperations(
  userId: string, processId: string, windowDays = 30, period: ReportPeriod = "trend",
): Promise<ProcessOperations | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id, p.process_name,
            (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id AND e.active_status = 1) headcount
       FROM process_master p WHERE p.id = ? LIMIT 1`, [processId],
  );
  const proc = (procRows as any[])[0];
  if (!proc) return null;

  const today = new Date();
  const range = periodRange(period, today);
  // A period view needs this period's days AND the prior equivalent period's,
  // to build a real WoW/MoM comparison rather than the trend view's rolling
  // average. MTD's prior period reaches back up to ~62 days (a 31-day month
  // compared against the one before it); fetch generously rather than let the
  // comparison silently go missing for a long month.
  const fetchDays = range ? 66 : windowDays;

  // Every reading in the window, with its parts. Ordered so the trend is already
  // chronological and the last row of each metric is its latest.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.metric_key, a.score_date, a.actual_value, a.rollup_numerator, a.rollup_denominator, a.source,
            a.updated_at, m.metric_name, m.unit, m.direction
       FROM process_metric_actual a
       LEFT JOIN kpi_metric_master m ON m.metric_code = a.metric_key
      WHERE a.process_id = ?
        AND a.score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY a.metric_key, a.score_date`,
    [processId, fetchDays],
  );

  // The real configured SLA per metric, where one exists -- not invented. Read
  // straight from the live definition rather than duplicated onto the reading,
  // so a target changed in KPI Studio is reflected immediately.
  const [targetRows] = await db.execute<RowDataPacket[]>(
    `SELECT m.metric_code, d.target_value FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
      WHERE d.process_id = ? AND d.active_status = 1 AND d.effective_to IS NULL
        AND d.target_value IS NOT NULL`,
    [processId],
  );
  const targets = new Map<string, number>(
    (targetRows as any[]).map((r) => [String(r.metric_code), Number(r.target_value)]));

  const byMetric = new Map<string, MetricReading>();
  for (const r of rows as any[]) {
    const key = String(r.metric_key);
    if (!byMetric.has(key)) {
      byMetric.set(key, {
        metricKey: key,
        label: r.metric_name ? String(r.metric_name) : key,
        unit: r.unit ? String(r.unit) : null,
        direction: r.direction ? String(r.direction) : null,
        value: null, staleDays: null, latestDate: null, provisional: false,
        priorValue: null, targetValue: targets.get(key) ?? null, trend: [],
        numerator: null, denominator: null, source: null, computedAt: null,
      });
    }
    const m = byMetric.get(key)!;
    const date = isoDate(r.score_date);
    const value = r.actual_value === null ? null : Number(r.actual_value);
    const dayNumerator = r.rollup_numerator === null ? null : unscaleNumerator(Number(r.rollup_numerator), m.unit);
    const dayDenominator = r.rollup_denominator === null ? null : Number(r.rollup_denominator);
    m.trend.push({ date, value, numerator: dayNumerator, denominator: dayDenominator });
    // The headline is the most recent day that actually produced a number. A
    // no_data day must not blank out a metric that was reading fine yesterday.
    // Overwritten below for a period view, which aggregates instead of reading
    // the single latest day.
    if (value !== null) {
      m.value = value;
      m.latestDate = date;
      m.numerator = dayNumerator;
      m.denominator = dayDenominator;
      m.source = r.source ? String(r.source) : null;
      m.computedAt = r.updated_at ? new Date(r.updated_at).toISOString() : null;
    }
  }
  const todayIso = isoDate(new Date());
  for (const m of byMetric.values()) {
    m.staleDays = m.latestDate ? daysSince(m.latestDate) : null;
    m.provisional = m.latestDate === todayIso;

    // The baseline is everything older than a week, averaged. Comparing today
    // against yesterday alone would call a normal day-to-day wobble a trend,
    // and these metrics wobble: a client's scoring coverage swings between 100%
    // and 0% depending on whether a pipeline ran that morning.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffIso = isoDate(cutoff);
    const earlier = m.trend.filter((p) => p.value !== null && p.date < cutoffIso);
    m.priorValue = earlier.length >= 3
      ? earlier.reduce((sum, p) => sum + (p.value as number), 0) / earlier.length
      : null;
  }

  if (range) {
    for (const m of byMetric.values()) {
      const current = aggregateRange(m.trend, m.unit, range.from, range.to);
      const prior = aggregateRange(m.trend, m.unit, range.priorFrom, range.priorTo);
      m.value = current.value;
      m.numerator = current.numerator;
      m.denominator = current.denominator;
      m.priorValue = prior.value;
      // staleDays/provisional still describe the single latest reading -- a
      // metric can be mid-week with a perfectly fresh MTD figure and still be
      // worth flagging if yesterday specifically never reported.
      m.trend = m.trend.filter((pt) => pt.date >= range.from && pt.date <= range.to);
    }
  }

  const sections: MetricSection[] = SECTIONS.map((s) => ({
    key: s.key, title: s.title, blurb: s.blurb,
    metrics: [...byMetric.values()]
      .filter((m) => SECTION_OF.get(m.metricKey)?.key === s.key)
      .sort((a, b) =>
        (SECTION_OF.get(a.metricKey)?.rank ?? 99) - (SECTION_OF.get(b.metricKey)?.rank ?? 99)),
  })).filter((s) => s.metrics.length > 0);

  const ungrouped = [...byMetric.values()]
    .filter((m) => !SECTION_OF.has(m.metricKey))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    processId,
    processName: String(proc.process_name),
    headcount: Number(proc.headcount),
    windowDays,
    staleAfterDays: STALE_AFTER_DAYS,
    period,
    periodFrom: range?.from ?? null,
    periodTo: range?.to ?? null,
    sections,
    ungrouped,
  };
}

/**
 * Everything behind one number, for the drill-down drawer.
 *
 * The Drill-Down Mandate asks every figure to be traceable to root cause. For a
 * computed metric that means more than showing the value bigger: it means the
 * arithmetic (which formula, over which parts), the provenance (which table,
 * filtered how), the history (every daily reading, gaps included), and the
 * governance (who defined it, from when).
 *
 * Most of the wrong numbers found while building these metrics would have been
 * obvious in this drawer and were invisible on a tile -- a rate of 100% that was
 * a count divided by itself, a 0% rate over 404 calls nobody had scored, a client
 * whose close rate tripled the day one column changed meaning. The parts are the
 * story; the value is only the headline.
 */
export interface MetricDrilldown {
  metricKey: string;
  metricName: string;
  unit: string | null;
  direction: string | null;
  processId: string;
  processName: string;
  /** Which period the readings below are trimmed to. "trend" carries a rolling window, not a calendar range. */
  period: ReportPeriod;
  periodFrom: string | null;
  periodTo: string | null;
  definition: {
    id: string | null;
    formula: string | null;
    grain: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    targetValue: number | null;
    createdBy: string | null;
    createdAt: string | null;
    notes: string | null;
  } | null;
  source: {
    sourceCode: string;
    sourceName: string | null;
    sourceType: string | null;
    sourceObject: string | null;
    dateColumn: string | null;
    processKeyKind: string | null;
    processKeyColumn: string | null;
    processKeyValue: string | null;
  } | null;
  /** The fields the formula draws on, with the filter each one applies. */
  fields: Array<{
    fieldName: string; displayName: string | null; sourceColumn: string | null;
    aggregateFn: string | null; filter: string | null;
  }>;
  /** Every reading in the window, newest first. A null value is a real no_data day. */
  readings: Array<{
    date: string; value: number | null;
    numerator: number | null; denominator: number | null; note: string | null;
    /** 'manual' or 'connector' for a real reading; null for a no_data day. */
    source: string | null;
  }>;
}

export async function getMetricDrilldown(
  userId: string, processId: string, metricKey: string, windowDays = 30,
  period: ReportPeriod = "trend",
): Promise<MetricDrilldown | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  // A period other than the plain trend fetches the wider window a
  // WTD/MTD range plus its comparison period needs, THEN trims the returned
  // readings to the exact range the card above is showing -- so opening a
  // drill-down while "MTD" is selected shows the same days MTD summed, not an
  // unrelated 30-day window that happens to overlap it.
  const range = periodRange(period, new Date());
  const effectiveWindowDays = range ? 66 : windowDays;

  const [procRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_name FROM process_master WHERE id = ? LIMIT 1`, [processId],
  );
  const proc = (procRows as any[])[0];
  if (!proc) return null;

  const [metricRows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_code, metric_name, unit, direction FROM kpi_metric_master
      WHERE metric_code = ? LIMIT 1`, [metricKey],
  );
  const metric = (metricRows as any[])[0];
  const unit = metric?.unit ?? null;

  // The definition in force for this process. Ordered so the live row wins when
  // an older closed one still exists for the same scope.
  const [defRows] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.formula_expression, d.grain, d.effective_from, d.effective_to,
            d.target_value, d.created_by, d.created_at, d.notes, d.data_source_id
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
      WHERE m.metric_code = ? AND d.process_id = ? AND d.active_status = 1
      ORDER BY (d.effective_to IS NULL) DESC, d.effective_from DESC
      LIMIT 1`, [metricKey, processId],
  );
  const def = (defRows as any[])[0] ?? null;

  let source: MetricDrilldown["source"] = null;
  let fields: MetricDrilldown["fields"] = [];
  if (def?.data_source_id) {
    const [srcRows] = await db.execute<RowDataPacket[]>(
      `SELECT source_code, source_name, source_type, source_object, date_column,
              process_key_kind, process_key_column, process_key_value
         FROM kpi_studio_data_source WHERE id = ? LIMIT 1`, [def.data_source_id],
    );
    const sr = (srcRows as any[])[0];
    if (sr) {
      source = {
        sourceCode: String(sr.source_code), sourceName: sr.source_name ?? null,
        sourceType: sr.source_type ?? null, sourceObject: sr.source_object ?? null,
        dateColumn: sr.date_column ?? null, processKeyKind: sr.process_key_kind ?? null,
        processKeyColumn: sr.process_key_column ?? null,
        processKeyValue: sr.process_key_value ?? null,
      };
    }
    const [fieldRows] = await db.execute<RowDataPacket[]>(
      `SELECT field_name, display_name, source_column, aggregate_fn, filter_json
         FROM kpi_studio_source_field
        WHERE data_source_id = ? AND active_status = 1
        ORDER BY field_name`, [def.data_source_id],
    );
    fields = (fieldRows as any[]).map((f) => ({
      fieldName: String(f.field_name),
      displayName: f.display_name ?? null,
      sourceColumn: f.source_column ?? null,
      aggregateFn: f.aggregate_fn ?? null,
      filter: f.filter_json == null ? null
        : (typeof f.filter_json === "string" ? f.filter_json : JSON.stringify(f.filter_json)),
    }));
  }

  const [readingRows] = await db.execute<RowDataPacket[]>(
    `SELECT score_date, actual_value, rollup_numerator, rollup_denominator, note, source
       FROM process_metric_actual
      WHERE process_id = ? AND metric_key = ?
        AND score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY score_date DESC`, [processId, metricKey, effectiveWindowDays],
  );

  // Nothing known about it and nothing ever recorded: this metric does not exist
  // for this process, and an empty shell returned as 200 would look like a metric
  // that simply has no data yet.
  if (!metric && !def && !(readingRows as any[]).length) return null;

  // Trim to the exact range the card above summed, once a period beyond plain
  // trend is asked for -- otherwise a drawer opened while "MTD" is selected
  // shows an unrelated 66-day fetch window instead of the days MTD actually
  // covers.
  const readingsInRange = range
    ? (readingRows as any[]).filter((r) => {
        const d = isoDate(r.score_date);
        return d >= range.from && d <= range.to;
      })
    : (readingRows as any[]);

  return {
    metricKey,
    metricName: metric?.metric_name ? String(metric.metric_name) : metricKey,
    unit,
    direction: metric?.direction ?? null,
    processId,
    processName: String(proc.process_name),
    period,
    periodFrom: range?.from ?? null,
    periodTo: range?.to ?? null,
    definition: def ? {
      id: String(def.id),
      formula: def.formula_expression ?? null,
      grain: def.grain ?? null,
      effectiveFrom: def.effective_from ? isoDate(def.effective_from) : null,
      effectiveTo: def.effective_to ? isoDate(def.effective_to) : null,
      targetValue: def.target_value === null ? null : Number(def.target_value),
      createdBy: def.created_by ?? null,
      createdAt: def.created_at ? String(def.created_at) : null,
      notes: def.notes ?? null,
    } : null,
    source,
    fields,
    readings: readingsInRange.map((r) => ({
      date: isoDate(r.score_date),
      value: r.actual_value === null ? null : Number(r.actual_value),
      numerator: unscaleNumerator(
        r.rollup_numerator === null ? null : Number(r.rollup_numerator), unit),
      denominator: r.rollup_denominator === null ? null : Number(r.rollup_denominator),
      note: r.note ?? null,
      source: r.actual_value === null ? null : (r.source ? String(r.source) : null),
    })),
  };
}

export interface MetricRawRows {
  date: string;
  /** false means there is nowhere to trace this day's number back to — never an empty result standing in for that. */
  available: boolean;
  reason: string | null;
  sourceCode: string | null;
  sourceObject: string | null;
  /** How many rows actually matched, even when more than `rows` were returned. Null when unknown. */
  totalRows: number | null;
  truncated: boolean;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

const RAW_ROWS_LIMIT = 200;

/**
 * The individual rows behind one day's number — the last level the Drill-Down
 * Mandate asks for. Not a new query invented for this view: the same source
 * (kpi_studio_data_source), the same date/process-key filtering
 * getMetricDrilldown already resolves and buildProcessQueryPlan in
 * kpi-studio.sources.ts already uses to COMPUTE the aggregate, just without the
 * GROUP BY and the aggregate functions — so what this returns is provably the
 * rows that were summed into the number on the tile, not a lookalike query.
 *
 * A metric with no configured source returns available:false with a real
 * reason — never a fabricated or silently empty row list standing in for
 * "nothing to show". In practice this is rare: verified that EVERY active
 * kpi_studio_definition (832/832) carries a data_source_id, including the
 * workforce metrics computed from HRMS's own attendance/roster tables
 * (SHRINKAGE_PCT traces to attendance_daily_record, ROSTER_ACK_PCT to
 * wfm_roster_assignment) — those are automated too, just internally sourced
 * rather than fed by an external client system. The processes genuinely
 * without a source are the ones with a manual-only entry and nothing else.
 */
export async function getMetricRawRows(
  userId: string, processId: string, metricKey: string, date: string,
): Promise<MetricRawRows | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const [defRows] = await db.execute<RowDataPacket[]>(
    `SELECT d.data_source_id
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
      WHERE m.metric_code = ? AND d.process_id = ? AND d.active_status = 1
      ORDER BY (d.effective_to IS NULL) DESC, d.effective_from DESC
      LIMIT 1`, [metricKey, processId],
  );
  const def = (defRows as any[])[0] ?? null;
  const noSource = (reason: string, sourceCode: string | null = null): MetricRawRows => ({
    date, available: false, reason, sourceCode, sourceObject: null,
    totalRows: null, truncated: false, columns: [], rows: [],
  });
  if (!def?.data_source_id) {
    return noSource("This metric has no configured data source to trace individual records back to.");
  }

  const [srcRows] = await db.execute<RowDataPacket[]>(
    `SELECT source_code, source_object, date_column, date_format,
            process_key_kind, process_key_column, process_key_value,
            employee_key_column, employee_key_kind
       FROM kpi_studio_data_source WHERE id = ? LIMIT 1`, [def.data_source_id],
  );
  const src = (srcRows as any[])[0] ?? null;
  if (!src?.source_object || !src?.date_column) {
    return noSource(
      "The data source behind this metric has no table or date column configured.",
      src?.source_code ?? null,
    );
  }

  const [fieldRows] = await db.execute<RowDataPacket[]>(
    `SELECT source_column, filter_json FROM kpi_studio_source_field
      WHERE data_source_id = ? AND active_status = 1 AND source_column IS NOT NULL
      ORDER BY field_name`, [def.data_source_id],
  );
  const columnSet = new Set<string>();
  for (const f of fieldRows as any[]) {
    if (f.source_column) columnSet.add(String(f.source_column));
    // A field's own displayed column is only half its logic -- "offered" is
    // call_date filtered by offer_success = 1, and without offer_success in the
    // row set a viewer can see the count but not WHY each row did or didn't
    // count. Every column a filter references is surfaced for the same reason
    // the field itself is: this is meant to be the full working, not a summary.
    try {
      const raw = f.filter_json;
      const parsed = raw == null ? [] : Array.isArray(raw) ? raw : JSON.parse(String(raw));
      for (const cond of Array.isArray(parsed) ? parsed : []) {
        if (cond && typeof cond.column === "string") columnSet.add(cond.column);
      }
    } catch { /* an unreadable filter just contributes no extra column */ }
  }
  const columns = [...columnSet];
  if (!columns.length) {
    return noSource(
      "This data source has no plain columns to show — every field here is a computed expression, not a stored one.",
      String(src.source_code),
    );
  }

  try {
    const table = assertSafeIdentifier(src.source_object, "source table");
    const dateColumn = assertSafeIdentifier(src.date_column, "date column");
    const kind = src.process_key_kind ?? "none";
    const joinsEmployees = kind === "employee";
    const q = joinsEmployees ? "s." : "";
    const dateExpr = dateExpression(dateColumn, src.date_format, q);
    const quotedTable = table.split(".").map((p) => `\`${p}\``).join(".");

    const where = [`${dateExpr} >= ?`, `${dateExpr} < DATE_ADD(?, INTERVAL 1 DAY)`];
    const params: unknown[] = [date, date];

    if (kind === "column") {
      if (!src.process_key_column) throw new Error("this source maps by column but names none");
      const keyColumn = assertSafeIdentifier(src.process_key_column, "process key column");
      where.push(`${q}\`${keyColumn}\` = ?`);
      params.push(src.process_key_value ?? "");
    }

    let join = "";
    if (joinsEmployees) {
      if (!src.employee_key_column) throw new Error("this source looks the process up from the employee but names no employee column");
      const employeeColumn = assertSafeIdentifier(src.employee_key_column, "employee key column");
      const employeeSide = src.employee_key_kind === "employee_id" ? "id" : "employee_code";
      join = `JOIN employees e ON e.\`${employeeSide}\` = s.\`${employeeColumn}\``;
      where.push("e.process_id = ?");
      params.push(processId);
    }

    const safeColumns = columns.map((c) => assertSafeIdentifier(c, "source column"));
    const selectCols = safeColumns.map((c) => `${q}\`${c}\` AS \`${c}\``).join(", ");
    const fromClause = `FROM ${quotedTable}${joinsEmployees ? " s" : ""} ${join}`;
    const whereClause = `WHERE ${where.join(" AND ")}`;

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n ${fromClause} ${whereClause}`, params,
    );
    const totalRows = Number((countRows as any[])[0]?.n ?? 0);

    const [dataRows] = await db.execute<RowDataPacket[]>(
      `SELECT ${selectCols} ${fromClause} ${whereClause} LIMIT ${RAW_ROWS_LIMIT}`, params,
    );

    return {
      date, available: true, reason: null,
      sourceCode: String(src.source_code), sourceObject: String(src.source_object),
      totalRows, truncated: totalRows > (dataRows as any[]).length,
      columns: safeColumns,
      rows: (dataRows as any[]).map((r) => ({ ...r })),
    };
  } catch (err) {
    return {
      date, available: false,
      reason: `Could not read individual records: ${(err as Error).message}`,
      sourceCode: String(src.source_code), sourceObject: String(src.source_object),
      totalRows: null, truncated: false, columns: [], rows: [],
    };
  }
}

/** Real designation names only. "TL"/"AM" below are picked out of these when
 *  one genuinely matches — never a label invented for a person whose real
 *  title is something else. Checked live: Bella-Vita Organic's own chain has
 *  no Team Leader or Assistant Manager at all, its 17 analysts report
 *  straight to a Sr. Manager — that gap is real, and pretending otherwise
 *  would be worse than showing the actual titles. */
const TL_PATTERN = /team\s*-?\s*lead|^\s*tl\s*$/i;
const AM_PATTERN = /assistant\s*-?\s*manager|^\s*am\s*$/i;

export interface AnalystScore {
  employeeId: string;
  employeeCode: string;
  name: string;
  designation: string | null;
  value: number | null;
  /** True when this score came from process_metric_employee_actual (hand-entered) rather than the metric's own automated per-employee source. */
  manual: boolean;
  /** The real reporting chain, closest manager first — whatever titles actually exist, not a fabricated TL/AM pair. */
  reportsTo: Array<{ employeeCode: string; name: string; designation: string | null; depth: number }>;
  /** Picked out of reportsTo when a real Team Leader / Assistant Manager exists in the chain. Null is honest when neither does. */
  teamLeader: { employeeCode: string; name: string } | null;
  assistantManager: { employeeCode: string; name: string } | null;
}

export interface MetricAnalystBreakdown {
  available: boolean;
  reason: string | null;
  metricName: string | null;
  unit: string | null;
  direction: string | null;
  targetValue: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Worst first: direction-aware, so a reader meets whoever is dragging the number down before the rest. */
  analysts: AnalystScore[];
}

/**
 * The metric's own formula, recomputed per employee instead of collapsed
 * across the whole process — the same SUM/SUM-across-the-range grain, the
 * same field definitions, the same formula string, just grouped by person.
 * Not a new source of truth: if this and the process tile ever disagreed,
 * it would mean this query drifted from buildProcessQueryPlan's, which is
 * exactly why buildProcessEmployeeBreakdownPlan shares its field-building
 * and safe-identifier code rather than re-deriving it.
 *
 * Only meaningful for a metric attributed to individual employees
 * ('employee' data sources) — a process-delivery-style metric that belongs
 * to a whole client has no analyst to break down by, and says so rather
 * than return an empty table that looks like zero analysts scored anything.
 */
export async function getMetricAnalystBreakdown(
  userId: string, processId: string, metricKey: string, period: ReportPeriod = "trend",
): Promise<MetricAnalystBreakdown | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): MetricAnalystBreakdown => ({
    available: false, reason, metricName: null, unit: null, direction: null,
    targetValue: null, periodFrom: null, periodTo: null, analysts: [],
  });

  const [metricRows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_name, unit, direction FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`,
    [metricKey],
  );
  const metric = (metricRows as any[])[0] ?? null;

  const [defRows] = await db.execute<RowDataPacket[]>(
    `SELECT d.formula_expression, d.target_value, d.data_source_id
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id
      WHERE m.metric_code = ? AND d.process_id = ? AND d.active_status = 1
      ORDER BY (d.effective_to IS NULL) DESC, d.effective_from DESC
      LIMIT 1`, [metricKey, processId],
  );
  const def = (defRows as any[])[0] ?? null;
  if (!def?.data_source_id) return unavailable("This metric has no configured data source to recompute per analyst.");
  if (!def?.formula_expression) return unavailable("This metric has no formula recorded — there is nothing to recompute per analyst.");

  const [srcRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, source_code, source_name, source_type, source_object, date_column, date_format,
            process_key_kind, process_key_column, process_key_value,
            employee_key_column, employee_key_kind
       FROM kpi_studio_data_source WHERE id = ? LIMIT 1`, [def.data_source_id],
  );
  const src = (srcRows as any[])[0] as (DataSourceConfig & { date_format?: string | null }) | undefined;
  if (!src) return unavailable("This metric's data source no longer exists.");
  if ((src.process_key_kind ?? "none") !== "employee") {
    return unavailable("This metric is measured at the whole-process level, not attributed to individual employees — there is no analyst to break it down by.");
  }

  const [fieldRows] = await db.execute<RowDataPacket[]>(
    `SELECT field_name, source_column, aggregate_fn, source_expression, filter_json
       FROM kpi_studio_source_field
      WHERE data_source_id = ? AND active_status = 1
      ORDER BY field_name`, [def.data_source_id],
  );
  const fields: SourceField[] = (fieldRows as any[]).map((f) => ({
    field_name: String(f.field_name),
    source_column: f.source_column ?? null,
    aggregate_fn: f.aggregate_fn ?? null,
    source_expression: f.source_expression ?? null,
    filter_json: f.filter_json ?? null,
  }));
  if (!fields.length) return unavailable("This data source has no fields configured yet.");

  // "trend" has no fixed calendar window (the card above shows the latest
  // reading, not a range), so the breakdown uses the single most recent date
  // this metric actually has a process-level reading for -- the exact day
  // the tile is currently headlining, not an arbitrary trailing window.
  let from: string;
  let to: string;
  const range = periodRange(period, new Date());
  if (range) {
    from = range.from; to = range.to;
  } else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(score_date) latest FROM process_metric_actual
        WHERE process_id = ? AND metric_key = ? AND actual_value IS NOT NULL`,
      [processId, metricKey],
    );
    let latest = (latestRows as any[])[0]?.latest;
    // A metric with an 'employee'-kind source can have no PROCESS-level
    // reading at all (nobody rolls the per-employee numbers up into one
    // figure) and still have real per-analyst data -- either automated or,
    // for the small set of genuinely gap metrics, hand-entered into
    // process_metric_employee_actual. Check that before giving up, or the
    // deepest-level breakdown would be unreachable exactly for the metrics
    // it exists to serve.
    if (!latest) {
      const [empLatestRows] = await db.execute<RowDataPacket[]>(
        `SELECT MAX(score_date) latest FROM process_metric_employee_actual
          WHERE process_id = ? AND metric_key = ? AND actual_value IS NOT NULL`,
        [processId, metricKey],
      );
      latest = (empLatestRows as any[])[0]?.latest;
    }
    // Genuinely nothing has ever been recorded for this metric, at either
    // grain -- not an error state for an 'employee'-kind metric (confirmed
    // real and correctly configured above), just the honest "nobody has
    // entered anything yet" state. Anchoring on today rather than returning
    // unavailable is what lets the per-analyst upload UI actually appear for
    // exactly the metrics it exists to serve; a fresh upload almost always
    // targets today anyway, and the manual-fallback query below re-reads
    // whatever date range is passed in, so this default costs nothing once
    // a real entry exists.
    const d = latest ? isoDate(latest) : isoDate(new Date());
    from = d; to = d;
  }

  let plan: ReturnType<typeof buildProcessEmployeeBreakdownPlan>;
  try {
    plan = buildProcessEmployeeBreakdownPlan(src, fields, from, to, processId);
  } catch (err) {
    return unavailable((err as Error).message);
  }

  const direction = metric?.direction ?? null;
  const targetValue = def.target_value === null ? null : Number(def.target_value);

  let rows: RowDataPacket[];
  try {
    [rows] = await db.execute<RowDataPacket[]>(plan.sql, plan.params);
  } catch (err) {
    return unavailable(`Could not compute per-analyst scores: ${(err as Error).message}`);
  }
  const base = {
    available: true as const, reason: null,
    metricName: metric?.metric_name ? String(metric.metric_name) : metricKey,
    unit: metric?.unit ?? null, direction, targetValue, periodFrom: from, periodTo: to,
  };
  let scored: Array<{ employeeId: string; employeeCode: string; name: string; value: number | null; manual: boolean }>;

  if ((rows as any[]).length) {
    scored = (rows as any[]).map((r) => {
      const inputs: Record<string, number | string | null> = {};
      for (const name of plan.fieldNames) inputs[name] = r[name] ?? null;
      const evaluated = evaluateFormula(def.formula_expression, inputs);
      return {
        employeeId: String(r.__employee_id),
        employeeCode: String(r.__employee_code ?? ""),
        name: `${r.__first_name ?? ""} ${r.__last_name ?? ""}`.trim() || String(r.__employee_code ?? "Unknown"),
        value: evaluated.value,
        manual: false,
      };
    });
  } else {
    // No automated reading exists for this metric on this process at all --
    // fall back to hand-entered per-analyst scores (process_metric_employee_actual),
    // the deepest-level manual path for the small set of 'employee'-kind metrics
    // verified to have no automated feed (see 1706_process_metric_employee_actual.sql).
    // Latest entry per employee within the period, same "most recent wins"
    // convention the process-level trend fallback above already uses. The moment
    // an automated feed starts reporting rows for this (process, metric), the
    // branch above takes over and this table is never consulted again for it.
    const [manualRows] = await db.execute<RowDataPacket[]>(
      `SELECT m.employee_id, e.employee_code, e.first_name, e.last_name, m.actual_value
         FROM process_metric_employee_actual m
         JOIN employees e ON e.id = m.employee_id
         JOIN (
           SELECT employee_id, MAX(score_date) AS max_date
             FROM process_metric_employee_actual
            WHERE process_id = ? AND metric_key = ? AND score_date >= ? AND score_date <= ?
              AND actual_value IS NOT NULL
            GROUP BY employee_id
         ) latest ON latest.employee_id = m.employee_id AND latest.max_date = m.score_date
        WHERE m.process_id = ? AND m.metric_key = ?`,
      [processId, metricKey, from, to, processId, metricKey],
    );
    scored = (manualRows as any[]).map((r) => ({
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code ?? ""),
      name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || String(r.employee_code ?? "Unknown"),
      value: r.actual_value === null ? null : Number(r.actual_value),
      manual: true,
    }));
  }

  if (!scored.length) return { ...base, analysts: [] };
  const employeeIds = scored.map((s) => s.employeeId);

  const [desigRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, d.designation_name
       FROM employees e LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.id IN (${employeeIds.map(() => "?").join(",")})`,
    employeeIds,
  );
  const designationById = new Map<string, string | null>(
    (desigRows as any[]).map((r) => [String(r.id), r.designation_name ? String(r.designation_name) : null]),
  );

  // The real reporting chain, capped at 6 levels and guarded against a cycle
  // -- one genuinely exists in this data (two managers who report to each
  // other), which a plain WITH RECURSIVE would otherwise spin on until MySQL's
  // recursion limit killed the query.
  const [chainRows] = await db.execute<RowDataPacket[]>(
    `WITH RECURSIVE chain AS (
       SELECT e.id AS start_id, e.id AS node_id, e.reporting_manager_id, 0 AS depth,
              CAST(e.id AS CHAR(4000)) AS visited
         FROM employees e
        WHERE e.id IN (${employeeIds.map(() => "?").join(",")})
        UNION ALL
       SELECT c.start_id, m.id, m.reporting_manager_id, c.depth + 1,
              CONCAT(c.visited, ',', m.id)
         FROM employees m
         JOIN chain c ON m.id = c.reporting_manager_id
        WHERE c.depth < 6 AND FIND_IN_SET(m.id, c.visited) = 0
     )
     SELECT c.start_id, c.depth, e.employee_code, e.first_name, e.last_name, d.designation_name
       FROM chain c
       JOIN employees e ON e.id = c.node_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE c.depth > 0
      ORDER BY c.start_id, c.depth`,
    employeeIds,
  );
  const chainByAnalyst = new Map<string, AnalystScore["reportsTo"]>();
  for (const r of chainRows as any[]) {
    const key = String(r.start_id);
    const arr = chainByAnalyst.get(key) ?? [];
    arr.push({
      employeeCode: String(r.employee_code ?? ""),
      name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
      designation: r.designation_name ? String(r.designation_name) : null,
      depth: Number(r.depth),
    });
    chainByAnalyst.set(key, arr);
  }

  const analysts: AnalystScore[] = scored.map((s) => {
    const chain = chainByAnalyst.get(s.employeeId) ?? [];
    const tl = chain.find((c) => c.designation && TL_PATTERN.test(c.designation));
    const am = chain.find((c) => c.designation && AM_PATTERN.test(c.designation));
    return {
      employeeId: s.employeeId, employeeCode: s.employeeCode, name: s.name,
      designation: designationById.get(s.employeeId) ?? null,
      value: s.value, manual: s.manual,
      reportsTo: chain,
      teamLeader: tl ? { employeeCode: tl.employeeCode, name: tl.name } : null,
      assistantManager: am ? { employeeCode: am.employeeCode, name: am.name } : null,
    };
  });

  // Worst first, direction-aware: the reader meets whoever is dragging the
  // number down before the rest, the same convention this page's other
  // "which one first" lists (StoppedFeeds, NeverReportedBanner) already use.
  // A null score (no rows this period) sorts last -- absent, not zero.
  analysts.sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return direction === "lower_is_better" ? b.value - a.value : a.value - b.value;
  });

  return { ...base, analysts };
}

/**
 * Voice of the Customer — real root-cause classification and verbatim quotes
 * for a process's audited calls, reusing the CLAP taxonomy (Customer / Logistic
 * / Agent / Product) already built and proven live in the sibling Mydashboards
 * project (github.com/tausifansari-mcn/Mydashboards, inbound-quality module).
 * The CASE expression below is copied verbatim from that project's
 * CLAP_CASE_INBOUND, not reinvented — it classifies each audited call by its
 * real recorded scenario/scenario1 fields, the same fields the call-quality
 * auditor actually filled in, not a guess layered on afterward.
 *
 * Same read-only upstream-source pattern QA_QUALITY_PCT already uses: joins
 * db_audit.call_quality_assessment.User (employee_code) to employees.process_id
 * — never writes back, never duplicates Mydashboards' own tables, just reads
 * the same real audit data through the same join this codebase already trusts.
 *
 * customer_voc_*_positive/negative are real AI-extracted verbatim quotes,
 * populated only from 2026-07-17 onward and still sparse for Logistic/Product
 * specifically (confirmed live) — an empty quote list for those categories is
 * reported honestly, never backfilled with an Agent-category quote instead.
 */
const CLAP_CASE = `
  CASE
    WHEN q.scenario IN ('Query','General Query','General Queries','Feedback','Unclear','Short Call/Blank Call','Customer Profile','Brand','Marketing','Content','Collaboration Request') THEN 'Customer'
    WHEN q.scenario IN ('Return/Exchange','Return Request','Return & Exchange','Wrong product','Product Issue','Pricing','Refund Status','Refund issue','Refund Request','Tech issue','Policies and FAQs','Sale Done') THEN 'Product'
    WHEN q.scenario IN ('Delivery Issue','Post Order','Order Status','Reverse Pickup Issue','Pending payment','Payment issues','Wallet issue') THEN 'Logistic'
    WHEN q.scenario IN ('Needs Improvement','Hold Procedure','Transfer','') THEN 'Agent'
    WHEN q.scenario IN ('Complaint','Repeat') THEN
      CASE
        WHEN q.scenario1 IS NULL OR q.scenario1 = '' THEN 'Product'
        WHEN q.scenario1 LIKE '%Dispatch%' OR q.scenario1 LIKE '%Delivery%' OR q.scenario1 LIKE '%RTO%' OR q.scenario1 = 'Delivery Fail'
          OR q.scenario1 LIKE '%Late dispatch%' OR q.scenario1 LIKE '%No communication%' OR q.scenario1 LIKE '%Fake remark%'
          OR q.scenario1 LIKE '%Extra Charge%' OR q.scenario1 LIKE '%Misbehave%' OR q.scenario1 LIKE '%Delivery Boy%'
          OR q.scenario1 LIKE '%Delivery Delay%' OR q.scenario1 LIKE '%POD%' OR q.scenario1 LIKE '%Courier%' THEN 'Logistic'
        WHEN q.scenario1 LIKE '%Fraud%' THEN 'Agent'
        ELSE 'Product'
      END
    ELSE 'Agent'
  END`;

export interface VocQuote { employeeCode: string; employeeName: string; callDate: string; quote: string }
export interface ClapVoiceOfCustomer {
  available: boolean;
  reason: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  totalAuditedCalls: number;
  /** Real root-cause split — who/what the customer's issue is actually about, not agent quality alone. */
  clapBreakdown: Array<{ clap: "Customer" | "Logistic" | "Agent" | "Product"; count: number; pct: number }>;
  quotes: {
    agent: { positive: VocQuote[]; negative: VocQuote[] };
    logistic: { positive: VocQuote[]; negative: VocQuote[] };
    product: { positive: VocQuote[]; negative: VocQuote[] };
  };
}

export async function getProcessVoiceOfCustomer(
  userId: string, processId: string, period: ReportPeriod = "trend",
): Promise<ClapVoiceOfCustomer | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): ClapVoiceOfCustomer => ({
    available: false, reason, periodFrom: null, periodTo: null, totalAuditedCalls: 0,
    clapBreakdown: [], quotes: {
      agent: { positive: [], negative: [] }, logistic: { positive: [], negative: [] }, product: { positive: [], negative: [] },
    },
  });

  // Resolved ONCE, then used as an IN-list everywhere below, rather than
  // joining db_audit.call_quality_assessment (460k+ row external table, live-
  // verified) to employees per query. That join looked fine on a narrow
  // single-day range (confirmed 345ms) but genuinely hangs on anything wider
  // (confirmed directly: a 90-day-bounded join-based MAX did not return in
  // 15s) -- MySQL can't push a cross-schema equi-join filter into an index
  // range scan the way it can push a plain IN-list. A handful of employee
  // codes against User's own index is fast at any window width (~3s worst
  // case measured, vs. an outright hang).
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code, CONCAT(first_name, ' ', COALESCE(last_name,'')) AS name
       FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const nameByCode = new Map<string, string>((empRows as any[]).map((r) => [String(r.employee_code), String(r.name).trim()]));
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    // Bounded to the last 90 days, the same "recent enough to matter" window
    // feed-health checks already use elsewhere on this page -- an honest
    // "nothing recent" beats a scan of years-old rows nobody is looking at.
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  const [breakdownRows] = await db.execute<RowDataPacket[]>(
    `SELECT ${CLAP_CASE.replace(/q\./g, "")} AS clap, COUNT(*) AS n
       FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
        AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY clap`,
    [...employeeCodes, from, to],
  );
  const total = (breakdownRows as any[]).reduce((s, r) => s + Number(r.n), 0);
  if (!total) {
    return { ...unavailable(
      "This process has no call-quality audit configured, or none this period — Voice of the Customer only exists where calls are actually audited.",
    ), available: true, periodFrom: from, periodTo: to };
  }
  const clapBreakdown = (breakdownRows as any[]).map((r) => ({
    clap: String(r.clap) as ClapVoiceOfCustomer["clapBreakdown"][number]["clap"],
    count: Number(r.n),
    pct: Math.round((Number(r.n) / total) * 1000) / 10,
  })).sort((a, b) => b.count - a.count);

  const quoteQuery = async (col: string): Promise<VocQuote[]> => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT User AS employee_code, DATE_FORMAT(CallDate, '%Y-%m-%d') AS call_date, \`${col}\` AS quote
         FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
          AND \`${col}\` IS NOT NULL AND TRIM(\`${col}\`) != ''
        ORDER BY CallDate DESC LIMIT 5`,
      [...employeeCodes, from, to],
    );
    return (rows as any[]).map((r) => ({
      employeeCode: String(r.employee_code),
      employeeName: nameByCode.get(String(r.employee_code)) || String(r.employee_code),
      callDate: String(r.call_date), quote: String(r.quote),
    }));
  };

  const [agentPos, agentNeg, logPos, logNeg, prodPos, prodNeg] = await Promise.all([
    quoteQuery("customer_voc_agent_positive"), quoteQuery("customer_voc_agent_negative"),
    quoteQuery("customer_voc_logistic_positive"), quoteQuery("customer_voc_logistic_negative"),
    quoteQuery("customer_voc_product_positive"), quoteQuery("customer_voc_product_negative"),
  ]);

  return {
    available: true, reason: null, periodFrom: from, periodTo: to, totalAuditedCalls: total,
    clapBreakdown,
    quotes: {
      agent: { positive: agentPos, negative: agentNeg },
      logistic: { positive: logPos, negative: logNeg },
      product: { positive: prodPos, negative: prodNeg },
    },
  };
}

export interface ClapDailyHeatmap {
  available: boolean; reason: string | null;
  days: Array<{
    date: string; total: number;
    counts: { Customer: number; Logistic: number; Agent: number; Product: number };
  }>;
}

/**
 * Day x CLAP-category matrix (Mydashboards' heat-cell pivot idiom) -- which
 * days actually carried a spike of Agent-attributed (or Logistic/Product/
 * Customer) calls, not just the period-aggregated share the breakdown bar
 * already shows. Deliberately NOT tied to the page's period selector
 * (trend/today/wtd/mtd) -- a heatmap's whole point is showing a pattern
 * across days, so a single-day "trend" window would be meaningless here;
 * this always looks at the real last 14 days, same CLAP_CASE classification
 * already proven correct in the breakdown/scenario work above.
 */
export async function getClapDailyHeatmap(
  userId: string, processId: string,
): Promise<ClapDailyHeatmap | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): ClapDailyHeatmap => ({ available: false, reason, days: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const inList = employeeCodes.map(() => "?").join(",");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(q.CallDate, '%Y-%m-%d') AS d, (${CLAP_CASE}) AS clap, COUNT(*) AS n
       FROM db_audit.call_quality_assessment q
      WHERE q.User IN (${inList}) AND q.quality_percentage IS NOT NULL
        AND q.CallDate >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      GROUP BY d, clap
      ORDER BY d ASC`,
    employeeCodes,
  );
  if (!(rows as any[]).length) return { ...unavailable("No audited calls in the last 14 days for this process."), available: true };

  const byDay = new Map<string, { Customer: number; Logistic: number; Agent: number; Product: number }>();
  for (const r of rows as any[]) {
    const d = String(r.d);
    const bucket = byDay.get(d) ?? { Customer: 0, Logistic: 0, Agent: 0, Product: 0 };
    bucket[String(r.clap) as "Customer" | "Logistic" | "Agent" | "Product"] = Number(r.n);
    byDay.set(d, bucket);
  }
  const days = [...byDay.entries()]
    .map(([date, counts]) => ({ date, counts, total: counts.Customer + counts.Logistic + counts.Agent + counts.Product }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { available: true, reason: null, days };
}

export interface ClapScenarioBreakdown {
  available: boolean;
  reason: string | null;
  clap: "Customer" | "Logistic" | "Agent" | "Product";
  total: number;
  scenarios: Array<{ scenario: string; count: number; pct: number }>;
}

/**
 * Phase B of the Mydashboards port (2026-09-10 plan) -- the sub-scenario
 * drill for one CLAP bucket: clicking "Agent: 34%" on the breakdown bar
 * shouldn't just filter quotes, it should say WHICH real scenarios make up
 * that 34%. Groups by the exact same q.scenario/q.scenario1 fields
 * CLAP_CASE itself classifies on, over the exact same employee/date window
 * getProcessVoiceOfCustomer already resolves -- this is a second read of
 * the same rows, one level more granular, not a new data source.
 */
export async function getClapScenarioBreakdown(
  userId: string, processId: string, period: ReportPeriod, clap: "Customer" | "Logistic" | "Agent" | "Product",
): Promise<ClapScenarioBreakdown | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): ClapScenarioBreakdown => ({
    available: false, reason, clap, total: 0, scenarios: [],
  });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  // Caught live verifying this: for rows that reach CLAP_CASE's
  // Complaint/Repeat branch, q.scenario is ALWAYS literally 'Complaint' or
  // 'Repeat' -- that's the branch condition, not a sub-scenario -- and the
  // real differentiator CLAP_CASE actually classified on for those rows is
  // q.scenario1 (Dispatch/Delivery/RTO/Fraud/etc., see that CASE branch).
  // For every other row, q.scenario itself is what CLAP_CASE keyed on, so
  // this reports whichever field actually drove that row's classification,
  // never both (that would double-count the same call under two labels).
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT x.scenario, COUNT(*) AS n
       FROM (
         SELECT
             CASE WHEN q.scenario IN ('Complaint','Repeat')
                  THEN COALESCE(NULLIF(TRIM(q.scenario1), ''), q.scenario)
                  ELSE q.scenario END AS scenario
           FROM db_audit.call_quality_assessment q
          WHERE q.User IN (${inList}) AND q.quality_percentage IS NOT NULL
            AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
            AND (${CLAP_CASE}) = ?
       ) x
      GROUP BY x.scenario
      ORDER BY n DESC`,
    [...employeeCodes, from, to, clap],
  );
  const total = (rows as any[]).reduce((s, r) => s + Number(r.n), 0);
  if (!total) return { ...unavailable(`No ${clap}-classified calls in this period.`), available: true };

  const scenarios = (rows as any[]).map((r) => ({
    scenario: String(r.scenario ?? "").trim() || "(blank)",
    count: Number(r.n),
    pct: Math.round((Number(r.n) / total) * 1000) / 10,
  }));

  return { available: true, reason: null, clap, total, scenarios };
}

export interface ClapScenarioCall {
  available: boolean;
  reason: string | null;
  calls: Array<{
    employeeCode: string; employeeName: string; callDate: string;
    qualityPercentage: number | null; hasTranscript: boolean; hasRecording: boolean;
  }>;
}

/**
 * Row-level companion to getClapScenarioBreakdown -- same window/CLAP
 * resolution, same Complaint/Repeat scenario1 fix, but returns the actual
 * calls (capped, newest first) instead of counts, so a reader can click one
 * of the real scenarios one level further into an individual call. Not a
 * data dump -- RawRowsPanel/CSV already covers that; this is a list to
 * click into getCallDetail from.
 */
export async function getClapScenarioCalls(
  userId: string, processId: string, period: ReportPeriod,
  clap: "Customer" | "Logistic" | "Agent" | "Product", scenario: string,
): Promise<ClapScenarioCall | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): ClapScenarioCall => ({ available: false, reason, calls: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code, CONCAT(first_name, ' ', COALESCE(last_name,'')) AS name
       FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const nameByCode = new Map<string, string>((empRows as any[]).map((r) => [String(r.employee_code), String(r.name).trim()]));
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  // Same resolved-scenario expression as getClapScenarioBreakdown, filtered
  // down to the one scenario label the reader actually clicked -- matched
  // in an outer WHERE against the inner computed column, same reason that
  // breakdown query needed a subquery: only_full_group_by rejects a bare
  // CASE expression as a filter target inline.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT x.User AS employee_code, DATE_FORMAT(x.CallDate, '%Y-%m-%d %H:%i:%s') AS call_date,
            x.quality_percentage, x.has_transcript, x.has_recording
       FROM (
         SELECT q.User, q.CallDate, q.quality_percentage,
             (q.Transcribe_Text IS NOT NULL AND TRIM(q.Transcribe_Text) != '') AS has_transcript,
             (q.call_recording IS NOT NULL AND TRIM(q.call_recording) != '') AS has_recording,
             CASE WHEN q.scenario IN ('Complaint','Repeat')
                  THEN COALESCE(NULLIF(TRIM(q.scenario1), ''), q.scenario)
                  ELSE q.scenario END AS resolved_scenario
           FROM db_audit.call_quality_assessment q
          WHERE q.User IN (${inList}) AND q.quality_percentage IS NOT NULL
            AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
            AND (${CLAP_CASE}) = ?
       ) x
      WHERE x.resolved_scenario = ?
      ORDER BY x.CallDate DESC
      LIMIT 50`,
    [...employeeCodes, from, to, clap, scenario],
  );

  const calls = (rows as any[]).map((r) => ({
    employeeCode: String(r.employee_code),
    employeeName: nameByCode.get(String(r.employee_code)) || String(r.employee_code),
    callDate: String(r.call_date),
    qualityPercentage: r.quality_percentage === null ? null : Number(r.quality_percentage),
    hasTranscript: Boolean(r.has_transcript),
    hasRecording: Boolean(r.has_recording),
  }));

  if (!calls.length) return { ...unavailable(`No calls found for "${scenario}" in this period.`), available: true };
  return { available: true, reason: null, calls };
}

export interface FatalCallsResult {
  available: boolean; reason: null | string;
  calls: Array<{
    employeeCode: string; employeeName: string; callDate: string;
    scenario: string | null; hasTranscript: boolean; hasRecording: boolean;
  }>;
}

/**
 * Fatal calls -- Mydashboards' own dedicated red-gradient section, missing
 * from this page until now. A call is fatal when ALL SIX of
 * FATAL_PARAM_COLS score 0 (verbatim from this session's own
 * fix-quality-score.mjs CQ formula port, not re-derived) -- the domain rule
 * that a genuinely severe miss on any of these zeroes the whole call's
 * score, regardless of how the other 13+ parameters scored. Each row opens
 * the exact same CallDetailDrawer the CLAP scenario drill already uses
 * (getCallDetail, keyed the same way) -- the second real consumer that
 * makes generalizing that drawer into shared infrastructure a fair call
 * later, not speculative infrastructure built ahead of a real second use.
 */
const FATAL_PARAM_COLS = [
  "address_recorded_completely", "correct_and_complete_information", "case_escalated_correctly",
  "customer_concern_acknowledged", "proper_hold_procedure", "proper_transfer_and_language",
];

export async function getFatalCalls(
  userId: string, processId: string, period: ReportPeriod,
): Promise<FatalCallsResult | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): FatalCallsResult => ({ available: false, reason, calls: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code, CONCAT(first_name, ' ', COALESCE(last_name,'')) AS name
       FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const nameByCode = new Map<string, string>((empRows as any[]).map((r) => [String(r.employee_code), String(r.name).trim()]));
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  const fatalSql = FATAL_PARAM_COLS.map((c) => `q.\`${c}\` = 0`).join(" AND ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT q.User AS employee_code, DATE_FORMAT(q.CallDate, '%Y-%m-%d %H:%i:%s') AS call_date, q.scenario,
            (q.Transcribe_Text IS NOT NULL AND TRIM(q.Transcribe_Text) != '') AS has_transcript,
            (q.call_recording IS NOT NULL AND TRIM(q.call_recording) != '') AS has_recording
       FROM db_audit.call_quality_assessment q
      WHERE q.User IN (${inList})
        AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND (${fatalSql})
      ORDER BY q.CallDate DESC
      LIMIT 50`,
    [...employeeCodes, from, to],
  );

  const calls = (rows as any[]).map((r) => ({
    employeeCode: String(r.employee_code),
    employeeName: nameByCode.get(String(r.employee_code)) || String(r.employee_code),
    callDate: String(r.call_date),
    scenario: r.scenario ?? null,
    hasTranscript: Boolean(r.has_transcript),
    hasRecording: Boolean(r.has_recording),
  }));

  if (!calls.length) return { ...unavailable("No fatal calls in this period — a genuine, good result."), available: true };
  return { available: true, reason: null, calls };
}

export interface AgentAuditSummaryRow {
  employeeCode: string; employeeName: string;
  auditCount: number; cqScore: number | null;
  fatalCount: number; fatalPct: number;
  tqCount: number; mqCount: number; bqCount: number;
  /** The agent's own dominant band by call count -- TQ/MQ/BQ, same three
   *  bands as the totals below, just picked per row for a scannable badge. */
  band: "TQ" | "MQ" | "BQ";
}
export interface AgentAuditSummary {
  available: boolean; reason: string | null;
  totals: { tq: number; mq: number; bq: number };
  rows: AgentAuditSummaryRow[];
}

/**
 * Per-agent audit rollup with TQ/MQ/BQ stack-ranking -- the same banding
 * convention verified live in Mydashboards' source (inbound-quality.service.ts,
 * getAgentAuditBandSummary): TQ = quality_percentage >= 80, MQ = 60-79.99,
 * BQ = 0-59.99, counted per CALL within each agent, not a single cutoff
 * applied to the agent's own average. cqScore is the average over NON-fatal
 * calls only, matching the source exactly -- a fatal call already failed
 * outright and would otherwise drag the "quality" average down by a measure
 * that isn't about grading quality at all.
 */
export async function getAgentAuditSummary(
  userId: string, processId: string, period: ReportPeriod,
): Promise<AgentAuditSummary | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): AgentAuditSummary =>
    ({ available: false, reason, totals: { tq: 0, mq: 0, bq: 0 }, rows: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code, CONCAT(first_name, ' ', COALESCE(last_name,'')) AS name
       FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const nameByCode = new Map<string, string>((empRows as any[]).map((r) => [String(r.employee_code), String(r.name).trim()]));
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  const fatalSql = FATAL_PARAM_COLS.map((c) => `q.\`${c}\` = 0`).join(" AND ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        q.User AS employee_code,
        COUNT(*) AS audit_count,
        ROUND(AVG(CASE WHEN NOT (${fatalSql}) THEN q.quality_percentage END), 1) AS cq_score,
        SUM(CASE WHEN (${fatalSql}) THEN 1 ELSE 0 END) AS fatal_count,
        SUM(CASE WHEN q.quality_percentage >= 80 THEN 1 ELSE 0 END) AS tq_count,
        SUM(CASE WHEN q.quality_percentage >= 60 AND q.quality_percentage < 80 THEN 1 ELSE 0 END) AS mq_count,
        SUM(CASE WHEN q.quality_percentage > 0 AND q.quality_percentage < 60 THEN 1 ELSE 0 END) AS bq_count
       FROM db_audit.call_quality_assessment q
      WHERE q.User IN (${inList})
        AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND q.quality_percentage IS NOT NULL
      GROUP BY q.User
      ORDER BY cq_score DESC`,
    [...employeeCodes, from, to],
  );

  const parsed = (rows as any[]).map((r) => {
    const auditCount = Number(r.audit_count) || 0;
    const tqCount = Number(r.tq_count) || 0;
    const mqCount = Number(r.mq_count) || 0;
    const bqCount = Number(r.bq_count) || 0;
    const fatalCount = Number(r.fatal_count) || 0;
    const band: "TQ" | "MQ" | "BQ" =
      tqCount >= mqCount && tqCount >= bqCount ? "TQ" : mqCount >= bqCount ? "MQ" : "BQ";
    return {
      employeeCode: String(r.employee_code),
      employeeName: nameByCode.get(String(r.employee_code)) || String(r.employee_code),
      auditCount,
      cqScore: r.cq_score !== null ? Number(r.cq_score) : null,
      fatalCount,
      fatalPct: auditCount > 0 ? Math.round((fatalCount / auditCount) * 1000) / 10 : 0,
      tqCount, mqCount, bqCount, band,
    };
  });

  if (!parsed.length) return { ...unavailable("No audited calls in this period for this process."), available: true };

  const totals = parsed.reduce(
    (acc, r) => ({ tq: acc.tq + r.tqCount, mq: acc.mq + r.mqCount, bq: acc.bq + r.bqCount }),
    { tq: 0, mq: 0, bq: 0 },
  );
  return { available: true, reason: null, totals, rows: parsed };
}

export interface ScenarioDistributionChild { scenario1: string; count: number; pct: number; }
export interface ScenarioDistributionItem {
  scenario: string; count: number; pct: number;
  children: ScenarioDistributionChild[];
}
export interface ScenarioDistribution {
  available: boolean; reason: string | null;
  items: ScenarioDistributionItem[];
}

/**
 * scenario x scenario1 distribution, ported from Mydashboards' getScenarios
 * (verified against source): every audited call grouped by its top-level
 * scenario (Complaint/Query/Request/Sale Done/...), each with its own
 * scenario1 sub-type breakdown as drill-down children. Source has a
 * client-specific quirk (Bellavita, ClientId 375: Repeat calls are audited
 * as a Complaint sub-type and folded in) -- NOT replicated here, because
 * this file scopes every query by process_id -> employee_code, never by the
 * upstream dialer ClientId the quirk is keyed on, and guessing a process ->
 * ClientId mapping risks silently misclassifying a different client's real
 * "Repeat" scenario as "Complaint". Left as real scenario1 data instead of
 * an unverified merge.
 */
export async function getScenarioDistribution(
  userId: string, processId: string, period: ReportPeriod,
): Promise<ScenarioDistribution | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): ScenarioDistribution => ({ available: false, reason, items: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        CASE WHEN TRIM(q.scenario)  = '' OR q.scenario  IS NULL THEN 'Unknown' ELSE TRIM(q.scenario)  END AS scenario,
        CASE WHEN TRIM(q.scenario1) = '' OR q.scenario1 IS NULL THEN 'Unknown' ELSE TRIM(q.scenario1) END AS scenario1,
        COUNT(*) AS cnt
       FROM db_audit.call_quality_assessment q
      WHERE q.User IN (${inList})
        AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND q.quality_percentage IS NOT NULL
      GROUP BY scenario, scenario1
      ORDER BY scenario, cnt DESC`,
    [...employeeCodes, from, to],
  );

  const total = (rows as any[]).reduce((s, r) => s + Number(r.cnt), 0);
  if (!total) return { ...unavailable("No audited calls in this period for this process."), available: true };

  const scenMap = new Map<string, { children: ScenarioDistributionChild[]; total: number }>();
  for (const r of rows as any[]) {
    const scen = String(r.scenario);
    const cnt = Number(r.cnt);
    const entry = scenMap.get(scen) ?? { children: [], total: 0 };
    entry.total += cnt;
    entry.children.push({ scenario1: String(r.scenario1), count: cnt, pct: 0 });
    scenMap.set(scen, entry);
  }

  const items: ScenarioDistributionItem[] = Array.from(scenMap.entries())
    .map(([scenario, { children, total: scenTotal }]) => ({
      scenario,
      count: scenTotal,
      pct: Math.round((scenTotal / total) * 1000) / 10,
      children: children
        .map((c) => ({ ...c, pct: scenTotal > 0 ? Math.round((c.count / scenTotal) * 1000) / 10 : 0 }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);

  return { available: true, reason: null, items };
}

/**
 * The five Score Components groupings, ported verbatim from Mydashboards'
 * source (the SQL block feeding its opening_skill/soft_skill/hold_procedure/
 * resolution/closing columns) -- not re-derived, since the grouping itself
 * (which of the 20 CQ parameters belongs to which "skill") is a domain
 * judgement call already made and verified there, not something to guess.
 */
const SCORE_COMPONENT_GROUPS: Array<{ key: string; label: string; cols: string[] }> = [
  { key: "opening_skill", label: "Opening skill", cols: ["call_answered_within_5_seconds"] },
  {
    key: "soft_skill", label: "Soft skill", cols: [
      "professionalism_maintained", "assurance_or_appreciation_provided", "pronunciation_and_clarity",
      "enthusiasm_and_no_fumbling", "active_listening", "politeness_and_no_sarcasm",
      "proper_grammar", "accurate_issue_probing", "customer_concern_acknowledged",
    ],
  },
  { key: "hold_procedure", label: "Hold procedure", cols: ["proper_hold_procedure", "proper_transfer_and_language", "dead_air_under_10_seconds"] },
  {
    key: "resolution", label: "Resolution", cols: [
      "case_escalated_correctly", "address_recorded_completely",
      "correct_and_complete_information", "upselling_or_offers_suggested",
    ],
  },
  { key: "closing", label: "Closing", cols: ["further_assistance_offered", "proper_call_closure"] },
];
/** Scenario1 values where the call structurally can't be graded on any of
 *  the five skill groups (dropped/blank) -- counted as a full pass for every
 *  group rather than penalising a call nobody could actually score. Same
 *  exception Mydashboards' source applies to every Score Components bucket. */
const UNGRADABLE_SCENARIO1 = ["Call Drop in between", "Short Call/Blank Call"];

export interface ScoreComponent { key: string; label: string; scorePct: number | null; }
export interface ScoreComponents {
  available: boolean; reason: string | null;
  components: ScoreComponent[];
}

/**
 * The five Score Components gauges (Opening/Soft Skill/Hold/Resolution/
 * Closing), each a per-call average of excludeBlankRatio(group cols) --
 * a blank parameter is excluded from both numerator and denominator (a call
 * never graded on a column neither helps nor hurts its score on it, matching
 * how the Quality Parameters-style per-parameter scores already work
 * elsewhere on this page), with UNGRADABLE_SCENARIO1 calls scored as a full
 * pass for every group since there was nothing to grade.
 */
export async function getScoreComponents(
  userId: string, processId: string, period: ReportPeriod,
): Promise<ScoreComponents | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): ScoreComponents => ({ available: false, reason, components: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  const ungradableSql = `q.scenario1 IN (${UNGRADABLE_SCENARIO1.map(() => "?").join(",")})`;
  const groupSelects = SCORE_COMPONENT_GROUPS.map((g) => {
    const num = g.cols.map((c) => `(CASE WHEN q.\`${c}\` IS NOT NULL THEN IF(q.\`${c}\` = 1, 1, 0) ELSE 0 END)`).join(" + ");
    const den = g.cols.map((c) => `(CASE WHEN q.\`${c}\` IS NOT NULL THEN 1 ELSE 0 END)`).join(" + ");
    return `ROUND(AVG(CASE WHEN ${ungradableSql} THEN 1 ELSE (${num}) / NULLIF(${den}, 0) END) * 100, 1) AS ${g.key}`;
  }).join(",\n        ");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${groupSelects}
       FROM db_audit.call_quality_assessment q
      WHERE q.User IN (${inList})
        AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND q.quality_percentage IS NOT NULL`,
    [
      ...SCORE_COMPONENT_GROUPS.map(() => UNGRADABLE_SCENARIO1).flat(),
      ...employeeCodes, from, to,
    ],
  );

  const row = (rows as any[])[0];
  if (!row) return { ...unavailable("No audited calls in this period for this process."), available: true };

  const components: ScoreComponent[] = SCORE_COMPONENT_GROUPS.map((g) => ({
    key: g.key, label: g.label,
    scorePct: row[g.key] !== null ? Number(row[g.key]) : null,
  }));
  return { available: true, reason: null, components };
}

const ACHT_CATEGORIES = [
  { key: "short", label: "Short (<1 min)", test: "< 60" },
  { key: "average", label: "Average (1-5 min)", test: ">= 60 AND CAST(q.length_in_sec AS UNSIGNED) < 301" },
  { key: "long", label: "Long (5-10 min)", test: ">= 301 AND CAST(q.length_in_sec AS UNSIGNED) < 600" },
  { key: "extreme", label: "Extremely long (>10 min)", test: ">= 600" },
] as const;

export interface AchtRow {
  key: string; label: string;
  auditCount: number; scorePct: number | null;
  fatalCount: number; fatalPct: number;
}
export interface AchtCategorization {
  available: boolean; reason: string | null;
  rows: AchtRow[];
}

/**
 * ACHT (call-length) categorization, ported from Mydashboards' source: every
 * audited call bucketed by db_audit.call_quality_assessment.length_in_sec
 * (a real column, confirmed live with 17,666 non-null rows in the last 30
 * days for this DB) into Short/Average/Long/Extremely-long, each with its
 * own audit count, quality score, and fatal rate -- the same breakdown that
 * makes a "long calls score worse" or "short calls hide more fatals"
 * pattern visible, which the single process-wide CQ score can't show.
 * All four categories are always returned, zero-filled, so the UI never
 * has to guess whether a missing bucket means "empty" or "not computed".
 */
export async function getAchtCategorization(
  userId: string, processId: string, period: ReportPeriod,
): Promise<AchtCategorization | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): AchtCategorization => ({ available: false, reason, rows: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  const fatalSql = FATAL_PARAM_COLS.map((c) => `q.\`${c}\` = 0`).join(" AND ");
  const categoryCase = `CASE
      WHEN CAST(q.length_in_sec AS UNSIGNED) < 60 THEN 'short'
      WHEN CAST(q.length_in_sec AS UNSIGNED) < 301 THEN 'average'
      WHEN CAST(q.length_in_sec AS UNSIGNED) < 600 THEN 'long'
      ELSE 'extreme'
    END`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT category, COUNT(*) audit_count,
            ROUND(AVG(quality_percentage), 1) score_pct,
            SUM(CASE WHEN (${fatalSql}) THEN 1 ELSE 0 END) fatal_count
       FROM (
         SELECT q.*, ${categoryCase} AS category
           FROM db_audit.call_quality_assessment q
          WHERE q.User IN (${inList})
            AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
            AND q.quality_percentage IS NOT NULL
            AND q.length_in_sec IS NOT NULL AND TRIM(q.length_in_sec) != ''
       ) q
      GROUP BY category`,
    [...employeeCodes, from, to],
  );

  const byKey = new Map<string, any>((rows as any[]).map((r) => [String(r.category), r]));
  if (byKey.size === 0) return { ...unavailable("No audited calls with call-length data in this period."), available: true };

  const result: AchtRow[] = ACHT_CATEGORIES.map((cat) => {
    const r = byKey.get(cat.key);
    const auditCount = r ? Number(r.audit_count) : 0;
    const fatalCount = r ? Number(r.fatal_count) : 0;
    return {
      key: cat.key, label: cat.label,
      auditCount,
      scorePct: r?.score_pct !== undefined && r?.score_pct !== null ? Number(r.score_pct) : null,
      fatalCount,
      fatalPct: auditCount > 0 ? Math.round((fatalCount / auditCount) * 1000) / 10 : 0,
    };
  });
  return { available: true, reason: null, rows: result };
}

/**
 * Critical Signals categorization -- ported VERBATIM from Mydashboards'
 * NEG_CAT (inbound-quality.service.ts): ~135 exact-string matches against
 * real historical `top_negative_words` values, followed by ~55 LOWER()/LIKE
 * keyword-fallback rules, in the same priority order (exact matches first,
 * first WHEN wins). Copied rather than re-derived -- these are literal
 * business classifications of real observed text, not a formula to
 * recompute, and guessing new rules risks silently misclassifying signals
 * this list already got right.
 *
 * NOT ported: Mydashboards' admin-editable `db_audit.neg_category_keywords`
 * table (hourly-refreshed dynamic extension, its own management endpoint).
 * That is real, separate scope -- a keyword-administration feature, not a
 * categorization formula -- left as a genuine follow-up rather than
 * silently invented here.
 */
const CRITICAL_SIGNALS_CASE = `CASE
  WHEN q.top_negative_words = 'discontinuing, pathetic, negative feedback' THEN 'Frustration'
  WHEN q.top_negative_words = 'fraud, pressure, complaint' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrated, delayed, lack of communication' THEN 'Frustration'
  WHEN q.top_negative_words = 'delay, disappointed, bad experience, very bad impression' THEN 'Threat'
  WHEN q.top_negative_words = 'cancel, problem, wait, frustration, delay' THEN 'Frustration'
  WHEN q.top_negative_words = 'time pass, naalaayak' THEN 'Slang'
  WHEN q.top_negative_words = 'inconvenience, problem, face, short, video' THEN 'Threat'
  WHEN q.top_negative_words = 'Frustrated, Spilled, Damage, Inconvenience' THEN 'Frustration'
  WHEN q.top_negative_words = 'pathetic, harassment, stupid' THEN 'Abuse'
  WHEN q.top_negative_words = 'damage, used, less quantity' THEN 'Frustration'
  WHEN q.top_negative_words = 'bakvaas, third class, bakvaas experience' THEN 'Threat'
  WHEN q.top_negative_words = 'harass' THEN 'Abuse'
  WHEN q.top_negative_words = 'embarrassment' THEN 'Frustration'
  WHEN q.top_negative_words = 'frustration' THEN 'Frustration'
  WHEN q.top_negative_words = 'cheat, fraud, complaint' THEN 'Threat'
  WHEN q.top_negative_words = 'frustration, threatened legal action' THEN 'Threat'
  WHEN q.top_negative_words = 'scam' THEN 'Threat'
  WHEN q.top_negative_words = 'missing, frustrated, requesting, refund' THEN 'Frustration'
  WHEN q.top_negative_words = 'spam calls, lottery scam' THEN 'Threat'
  WHEN q.top_negative_words = 'inconvenience, costly, smell' THEN 'Sarcasm'
  WHEN q.top_negative_words = 'gutka paan' THEN 'Slang'
  WHEN q.top_negative_words = 'bigad gaya, bura impression, fake remarks, maafi chaahoongi' THEN 'Frustration'
  WHEN q.top_negative_words = 'inconvenience, not satisfying' THEN 'Threat'
  WHEN q.top_negative_words = 'damage, inconvenience' THEN 'Threat'
  WHEN q.top_negative_words = 'missing, incomplete, inconvenience' THEN 'Threat'
  WHEN q.top_negative_words = 'faulty, issue' THEN 'Threat'
  WHEN q.top_negative_words = 'fake website' THEN 'Threat'
  WHEN q.top_negative_words = 'Scam, Spam, Loot' THEN 'Threat'
  WHEN q.top_negative_words = 'harass, mental harassment, fake, warning, court case' THEN 'Threat'
  WHEN q.top_negative_words = 'inconvenience, missing, disappointing, unexpected' THEN 'Threat'
  WHEN q.top_negative_words = 'damage, leaked, inconvenience' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrated, delay, expiration, unavailable' THEN 'Frustration'
  WHEN q.top_negative_words = 'bullshit, irritating, ridiculous' THEN 'Slang'
  WHEN q.top_negative_words = 'frustrated, inconvenience' THEN 'Frustration'
  WHEN q.top_negative_words = 'Inconvenience, Delay' THEN 'Frustration'
  WHEN q.top_negative_words = 'fraud' THEN 'Threat'
  WHEN q.top_negative_words = 'security concerns' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrated, dissatisfied, threatens, negative feedback' THEN 'Frustration'
  WHEN q.top_negative_words = 'gatia, locha, gatiya' THEN 'Slang'
  WHEN q.top_negative_words = 'fraud, jooth, reject, cheat' THEN 'Threat'
  WHEN q.top_negative_words = 'tampered, missing, used' THEN 'Frustration'
  WHEN q.top_negative_words = 'fraud, scam, fraudulent, fraudster' THEN 'Threat'
  WHEN q.top_negative_words = 'contradicting, frustration, delay, confusion' THEN 'Frustration'
  WHEN q.top_negative_words = 'bad, very bad, demand, frustration, dissatisfied' THEN 'Frustration'
  WHEN q.top_negative_words = 'fraud, spam, data leak' THEN 'Threat'
  WHEN q.top_negative_words = 'upset, don''t trust, mad' THEN 'Frustration'
  WHEN q.top_negative_words = 'irritating, spamming, annoying' THEN 'Threat'
  WHEN q.top_negative_words = 'compromise, scammers, fishing site' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrating, poor, panicking, frustrating' THEN 'Frustration'
  WHEN q.top_negative_words = 'zero star, rare' THEN 'Threat'
  WHEN q.top_negative_words = 'fake call, fraud call, avoid' THEN 'Threat'
  WHEN q.top_negative_words = 'low quality, illegal business, misleading' THEN 'Threat'
  WHEN q.top_negative_words = 'fraudulent, fake, scam' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrated, dissatisfaction' THEN 'Frustration'
  WHEN q.top_negative_words = 'Bakvaas' THEN 'Slang'
  WHEN q.top_negative_words = 'dissatisfied, frustration, negative review' THEN 'Frustration'
  WHEN q.top_negative_words = 'delay, issue, complaint' THEN 'Frustration'
  WHEN q.top_negative_words = 'leak, damage' THEN 'Threat'
  WHEN q.top_negative_words = 'inconvenience, frustrated, delay' THEN 'Frustration'
  WHEN q.top_negative_words = 'misguide' THEN 'Threat'
  WHEN q.top_negative_words = 'shocked, leak' THEN 'Threat'
  WHEN q.top_negative_words = 'fraud call' THEN 'Threat'
  WHEN q.top_negative_words = 'damaged, broken, cannot, forgot' THEN 'Threat'
  WHEN q.top_negative_words = 'damaged' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrated, delay, missing' THEN 'Threat'
  WHEN q.top_negative_words = 'smell' THEN 'Sarcasm'
  WHEN q.top_negative_words = 'heavy, issue, problem, allergy' THEN 'Threat'
  WHEN q.top_negative_words = 'complicated, fed up, private, reluctance' THEN 'Threat'
  WHEN q.top_negative_words = 'discontinued, unavailable, disappointing, not available, out of stock' THEN 'Frustration'
  WHEN q.top_negative_words = 'dissatisfaction, fraudulent, loss' THEN 'Threat'
  WHEN q.top_negative_words = 'confuse, force, chutiya' THEN 'Abuse'
  WHEN q.top_negative_words = 'Misbehave by Delivery boy' THEN 'Abuse'
  WHEN q.top_negative_words = 'Mat lagao idhar idhar, sokira' THEN 'Sarcasm'
  WHEN q.top_negative_words = 'Inconvenience, Wrong, Return, Not received' THEN 'Frustration'
  WHEN q.top_negative_words = 'reviews, fraud, problem' THEN 'Threat'
  WHEN q.top_negative_words = 'Frustration, Wrong with service, Frustration' THEN 'Frustration'
  WHEN q.top_negative_words = 'lost, delay, inconvenience, issue, complaint' THEN 'Threat'
  WHEN q.top_negative_words = 'missing, missing item' THEN 'Threat'
  WHEN q.top_negative_words = 'Badtamizi' THEN 'Slang'
  WHEN q.top_negative_words = 'missing, wrong, dissatisfaction, inconvenience' THEN 'Frustration'
  WHEN q.top_negative_words = 'fake rewards, unavailable, frustration, dissatisfaction' THEN 'Threat'
  WHEN q.top_negative_words = 'half, fraud, incorrect, concerns, frustration' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrated, lack of resolution, delivery issues' THEN 'Frustration'
  WHEN q.top_negative_words = 'delay, complaint, frustrated, escalate' THEN 'Frustration'
  WHEN q.top_negative_words = 'Chor, Thag, Kutton' THEN 'Threat'
  WHEN q.top_negative_words = 'frustration, disconnecting' THEN 'Frustration'
  WHEN q.top_negative_words = 'frustrated, loss, harassment' THEN 'Frustration'
  WHEN q.top_negative_words = 'frustrated, reluctant, uncooperative' THEN 'Frustration'
  WHEN q.top_negative_words = 'scam, waste of time, ghatiya, shame, shit' THEN 'Threat'
  WHEN q.top_negative_words = 'pathetic' THEN 'Frustration'
  WHEN q.top_negative_words = 'fraud, water instead of perfume' THEN 'Threat'
  WHEN q.top_negative_words = 'trouble, inconvenience, frustration' THEN 'Frustration'
  WHEN q.top_negative_words = 'ladai, phaahi, karvai, misbehave' THEN 'Abuse'
  WHEN q.top_negative_words = 'daadoo, ukhaadoo' THEN 'Slang'
  WHEN q.top_negative_words = 'wait, check, concern, delay' THEN 'Frustration'
  WHEN q.top_negative_words = 'inconvenience, mistake, refund, initiated, incorrect' THEN 'Frustration'
  WHEN q.top_negative_words = 'inconvenience' THEN 'Frustration'
  WHEN q.top_negative_words = 'none' THEN 'No'
  WHEN q.top_negative_words = 'samajh nahin pa rahi hai' THEN 'Frustration'
  WHEN q.top_negative_words = 'fake, market, fake, market' THEN 'Threat'
  WHEN q.top_negative_words = 'slow, frustration, nonsense' THEN 'Frustration'
  WHEN q.top_negative_words = 'refund, wait, complaint' THEN 'Frustration'
  WHEN q.top_negative_words = 'Fake, Review, Ganda' THEN 'Abuse'
  WHEN q.top_negative_words = 'received different, wrong one, apologize, inconvenience' THEN 'Frustration'
  WHEN q.top_negative_words = 'inconvenience, missing, leakage, not working' THEN 'Threat'
  WHEN q.top_negative_words = 'concern, inconvenience' THEN 'Threat'
  WHEN q.top_negative_words = 'Unreachable, Blood boils' THEN 'Slang'
  WHEN q.top_negative_words = 'defected, old, leakage' THEN 'Threat'
  WHEN q.top_negative_words = 'inconvenience, damaged, disappointed' THEN 'Threat'
  WHEN q.top_negative_words = 'rude behavior, inconvenience' THEN 'Abuse'
  WHEN q.top_negative_words = 'irritate, frustrated' THEN 'Frustration'
  WHEN q.top_negative_words = 'loss one customer, dissatisfaction' THEN 'Threat'
  WHEN q.top_negative_words = 'Unavailable, Restricted, Unavailable, Unreachable, Issue' THEN 'Frustration'
  WHEN q.top_negative_words = 'ridiculous, inconvenience, too long' THEN 'Frustration'
  WHEN q.top_negative_words = 'complaint, dissatisfied, frustration, delay, missing' THEN 'Frustration'
  WHEN q.top_negative_words = 'I don''t like this product.' THEN 'Sarcasm'
  WHEN q.top_negative_words = 'fraud, missing, inconvenience' THEN 'Threat'
  WHEN q.top_negative_words = 'complaint, dissatisfied, wrong product, replacement, limitations' THEN 'Frustration'
  WHEN q.top_negative_words = 'fraud, police' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrated, delays, lack of response' THEN 'Frustration'
  WHEN q.top_negative_words = 'ridiculous' THEN 'Slang'
  WHEN q.top_negative_words = 'broken, dissatisfied, complaining, demanding' THEN 'Frustration'
  WHEN q.top_negative_words = 'half order, wrong, missing, dissatisfied' THEN 'Frustration'
  WHEN q.top_negative_words = 'penalty, CIBIL, frustration' THEN 'Threat'
  WHEN q.top_negative_words = 'frustrating, annoying, disappointing' THEN 'Frustration'
  WHEN q.top_negative_words = 'Ghatiya' THEN 'Frustration'
  WHEN q.top_negative_words = 'irritated, fucking, thak gaya' THEN 'Frustration'
  WHEN q.top_negative_words = 'irritated, least interested, struggled' THEN 'Frustration'
  WHEN q.top_negative_words = 'dubaara, kuchh nahin aaya, solah, koi faayda hi nahin, cash on delivery order, koi free gift receive nahin hota' THEN 'Frustration'
  WHEN q.top_negative_words = 'frustration, delay, inconvenience, not responding' THEN 'Frustration'
  WHEN q.top_negative_words = 'psycho' THEN 'Frustration'
  WHEN q.top_negative_words = 'refund, dissatisfaction, confusion' THEN 'Frustration'
  WHEN q.top_negative_words = 'fraud, poor' THEN 'Threat'
  WHEN q.top_negative_words = 'wasted, fake, bad, complaint, unsatisfied' THEN 'Frustration'
  WHEN q.top_negative_words = 'mislead, crime, unfair practices, consumer court' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%frustration%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%frustrated%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%fir%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%gatia%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%fraud%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%bakvaas%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%scam%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%pathetic%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%dissatisfaction%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%inconvenience%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%fake%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%disappointed%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%pareshaan%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%misbehave%' THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%frustrating%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%unpleasant%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%angry%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%mahanga%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%band kar do%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%disappointing%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%dissatisfied%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%loot%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%irritating%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%farzi%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%unsatisfied%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%barbaad%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%unsatisfactory%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%ghatiya%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%cheating%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%paagal%' THEN 'Slang'
  WHEN LOWER(q.top_negative_words) LIKE '%badboo%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%shut up%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%randipana%' THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%bullshit%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%unhappy%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%terrible%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%horrible%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%awful%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%very bad%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%bad experience%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%worst%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%not satisfied%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%not happy%' THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%rude%' THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%abusive%' THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%insult%' THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%offensive%' THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%consumer court%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%social media%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%lawyer%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%blackmail%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%police complaint%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%legal action%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%consumer forum%' THEN 'Threat'
  ELSE 'No'
END`;

const CRITICAL_SIGNAL_KEYS = ["Frustration", "Threat", "Abuse", "Slang", "Sarcasm"] as const;
const CRITICAL_SIGNAL_META: Record<string, { label: string; emoji: string }> = {
  Frustration: { label: "Frustration", emoji: "😤" },
  Threat: { label: "Threat", emoji: "⚠️" },
  Abuse: { label: "Abuse", emoji: "🚫" },
  Slang: { label: "Slang", emoji: "💬" },
  Sarcasm: { label: "Sarcasm", emoji: "🙃" },
};

export interface CriticalSignal { key: string; label: string; emoji: string; count: number; pct: number; }
export interface CriticalSignals {
  available: boolean; reason: string | null;
  totalExamined: number;
  signals: CriticalSignal[];
}

/**
 * Critical Signals -- share of examined calls carrying each of five
 * negative-language categories (Frustration/Threat/Abuse/Slang/Sarcasm),
 * classified from top_negative_words via CRITICAL_SIGNALS_CASE above.
 * "Examined" means quality_percentage IS NOT NULL, the same audited-call
 * gate every sibling function here uses -- a call this text is 'No' for
 * genuinely was examined and found clean, distinct from never being
 * examined at all.
 */
export async function getCriticalSignals(
  userId: string, processId: string, period: ReportPeriod,
): Promise<CriticalSignals | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): CriticalSignals => ({ available: false, reason, totalExamined: 0, signals: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employeeCodes = (empRows as any[]).map((r) => String(r.employee_code));
  if (!employeeCodes.length) return unavailable("This process has no employees to attribute audited calls to.");
  const inList = employeeCodes.map(() => "?").join(",");

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      employeeCodes,
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls in the last 90 days for this process.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT category, COUNT(*) cnt FROM (
        SELECT ${CRITICAL_SIGNALS_CASE} AS category
          FROM db_audit.call_quality_assessment q
         WHERE q.User IN (${inList})
           AND q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY)
           AND q.quality_percentage IS NOT NULL
     ) x
     GROUP BY category`,
    [...employeeCodes, from, to],
  );

  const total = (rows as any[]).reduce((s, r) => s + Number(r.cnt), 0);
  if (!total) return { ...unavailable("No audited calls in this period for this process."), available: true };

  const byCategory = new Map<string, number>((rows as any[]).map((r) => [String(r.category), Number(r.cnt)]));
  const signals: CriticalSignal[] = CRITICAL_SIGNAL_KEYS.map((key) => {
    const count = byCategory.get(key) ?? 0;
    return {
      key, label: CRITICAL_SIGNAL_META[key]!.label, emoji: CRITICAL_SIGNAL_META[key]!.emoji,
      count, pct: Math.round((count / total) * 1000) / 10,
    };
  });
  return { available: true, reason: null, totalExamined: total, signals };
}

export interface EmployeeRecentCalls {
  available: boolean; reason: string | null;
  calls: Array<{
    callDate: string; qualityPercentage: number | null; scenario: string | null;
    hasTranscript: boolean; hasRecording: boolean;
  }>;
}

/**
 * Third real consumer of CallDetailDrawer: AnalystBreakdownPanel is generic
 * over ANY metric (workforce, hygiene, quality -- whatever metricKey the
 * caller is drilled into), so this does NOT assume the employee has quality-
 * audit data just because a metric score exists for them -- an employee
 * genuinely not in db_audit.call_quality_assessment (e.g. this metric came
 * from a manual upload, not the audit pass) gets an honest "not audited"
 * reason, not an empty list indistinguishable from "audited, zero calls".
 */
export async function getEmployeeRecentCalls(
  userId: string, processId: string, employeeCode: string, period: ReportPeriod,
): Promise<EmployeeRecentCalls | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): EmployeeRecentCalls => ({ available: false, reason, calls: [] });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM employees WHERE process_id = ? AND employee_code = ? LIMIT 1`,
    [processId, employeeCode],
  );
  if (!(empRows as any[]).length) return null;

  const range = periodRange(period, new Date());
  let from: string; let to: string;
  if (range) { from = range.from; to = range.to; }
  else {
    const [latestRows] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(CallDate) latest FROM db_audit.call_quality_assessment
        WHERE User = ? AND quality_percentage IS NOT NULL
          AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
      [employeeCode],
    );
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No audited calls for this analyst in the last 90 days — this metric may come from a different source than the quality-audit pass.");
    const d = isoDate(latest);
    from = d; to = d;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d %H:%i:%s') AS call_date, quality_percentage, scenario,
            (Transcribe_Text IS NOT NULL AND TRIM(Transcribe_Text) != '') AS has_transcript,
            (call_recording IS NOT NULL AND TRIM(call_recording) != '') AS has_recording
       FROM db_audit.call_quality_assessment
      WHERE User = ? AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY CallDate DESC
      LIMIT 20`,
    [employeeCode, from, to],
  );

  const calls = (rows as any[]).map((r) => ({
    callDate: String(r.call_date),
    qualityPercentage: r.quality_percentage === null ? null : Number(r.quality_percentage),
    scenario: r.scenario ?? null,
    hasTranscript: Boolean(r.has_transcript),
    hasRecording: Boolean(r.has_recording),
  }));

  if (!calls.length) return { ...unavailable("No audited calls for this analyst in this period."), available: true };
  return { available: true, reason: null, calls };
}

/**
 * The exact 19 parameters Mydashboards' validated CQ formula scores per call
 * (backend/scripts/fix-quality-score.mjs's own CQ_PARAM_COLS, not re-typed
 * from scratch), with a human-readable label per column for the call-detail
 * drawer. Clovia (client_id 468) scores a 20th, express_empathy -- handled
 * by simply including it whenever the column is present on the row, not by
 * a second hardcoded list.
 */
const CQ_PARAM_LABELS: Record<string, string> = {
  call_answered_within_5_seconds: "Answered within 5 seconds",
  customer_concern_acknowledged: "Customer concern acknowledged",
  professionalism_maintained: "Professionalism maintained",
  assurance_or_appreciation_provided: "Assurance or appreciation provided",
  pronunciation_and_clarity: "Pronunciation and clarity",
  enthusiasm_and_no_fumbling: "Enthusiasm, no fumbling",
  active_listening: "Active listening",
  politeness_and_no_sarcasm: "Politeness, no sarcasm",
  proper_grammar: "Proper grammar",
  accurate_issue_probing: "Accurate issue probing",
  proper_hold_procedure: "Proper hold procedure",
  proper_transfer_and_language: "Proper transfer and language",
  dead_air_under_10_seconds: "Dead air under 10 seconds",
  case_escalated_correctly: "Case escalated correctly",
  address_recorded_completely: "Address recorded completely",
  correct_and_complete_information: "Correct and complete information",
  upselling_or_offers_suggested: "Upselling or offers suggested",
  further_assistance_offered: "Further assistance offered",
  proper_call_closure: "Proper call closure",
  express_empathy: "Express empathy",
};
const CQ_PARAM_COLS = [
  "call_answered_within_5_seconds", "customer_concern_acknowledged", "professionalism_maintained",
  "assurance_or_appreciation_provided", "pronunciation_and_clarity", "enthusiasm_and_no_fumbling",
  "active_listening", "politeness_and_no_sarcasm", "proper_grammar", "accurate_issue_probing",
  "proper_hold_procedure", "proper_transfer_and_language", "dead_air_under_10_seconds",
  "case_escalated_correctly", "address_recorded_completely", "correct_and_complete_information",
  "upselling_or_offers_suggested", "further_assistance_offered", "proper_call_closure",
  "express_empathy",
];

export interface CallDetail {
  available: boolean;
  reason: string | null;
  employeeCode: string; employeeName: string; callDate: string;
  qualityPercentage: number | null;
  scenario: string | null; scenario1: string | null;
  transcript: string | null; recordingUrl: string | null;
  parameters: Array<{ column: string; label: string; value: boolean | null }>;
}

/**
 * One call's full audit detail -- the transcript-left/scored-parameters-
 * right view. Keyed by (employeeCode, callDate) since that's the same
 * natural pair every sibling function in this file already joins/filters
 * this upstream table on; no better single primary key surfaced when this
 * table's columns were inspected for this phase.
 */
export async function getCallDetail(
  userId: string, processId: string, employeeCode: string, callDate: string,
): Promise<CallDetail | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  // Scoping check: this employee code must actually belong to a readable
  // process, not just any code the caller happens to pass -- the same
  // employee/process ownership check every sibling function here relies on,
  // just done explicitly for a single code instead of an IN-list.
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT CONCAT(first_name, ' ', COALESCE(last_name,'')) AS name
       FROM employees WHERE process_id = ? AND employee_code = ? LIMIT 1`,
    [processId, employeeCode],
  );
  const emp = (empRows as any[])[0];
  if (!emp) return null;

  const paramCols = CQ_PARAM_COLS.map((c) => `\`${c}\``).join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT quality_percentage, scenario, scenario1, Transcribe_Text, call_recording, ${paramCols}
       FROM db_audit.call_quality_assessment
      WHERE User = ? AND CallDate = ?
      LIMIT 1`,
    [employeeCode, callDate],
  );
  const row = (rows as any[])[0];
  if (!row) {
    return {
      available: false, reason: "No audit record found for this call.",
      employeeCode, employeeName: String(emp.name).trim(), callDate,
      qualityPercentage: null, scenario: null, scenario1: null, transcript: null, recordingUrl: null, parameters: [],
    };
  }

  const parameters = CQ_PARAM_COLS
    .filter((c) => row[c] !== undefined) // express_empathy is absent from most clients' rows entirely
    .map((c) => ({
      column: c, label: CQ_PARAM_LABELS[c] ?? c,
      value: row[c] === null ? null : Number(row[c]) === 1,
    }));

  return {
    available: true, reason: null,
    employeeCode, employeeName: String(emp.name).trim(), callDate,
    qualityPercentage: row.quality_percentage === null ? null : Number(row.quality_percentage),
    scenario: row.scenario ?? null, scenario1: row.scenario1 ?? null,
    transcript: row.Transcribe_Text ?? null, recordingUrl: row.call_recording ?? null,
    parameters,
  };
}

/**
 * Root Cause vs. Workforce — the question the CLAP panel above cannot answer on
 * its own: is a spike in Agent-attributed complaints a coaching problem, or is
 * it what understaffing or a green floor looks like from the customer's side?
 *
 * Mydashboards has the call-quality half of this; it has no workforce data.
 * HRMS has both. Nothing here computes a correlation coefficient — with a
 * handful of noisy weekly counts per process that would be false precision
 * dressed up as rigor. Instead this returns the same-day series side by side
 * so a human can see whether the lines actually move together, and says so
 * honestly when a series has too little real data to plot (the roster table
 * in particular carries a large synthetic batch that must be excluded, and
 * even after that guard most processes have only a couple of weeks of real
 * roster rows — see the provenance guard below).
 */
export interface WorkforceCorrelationPoint {
  date: string;
  agentClapPct: number | null;
  auditedCalls: number;
  activeHeadcount: number;
  rampCohortPct: number | null;
  presentHeadcount: number | null;
  plannedHeadcount: number | null;
}
export interface WorkforceCorrelation {
  available: boolean;
  reason: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  daily: WorkforceCorrelationPoint[];
  weeklyAttrition: Array<{ weekStart: string; exits: number }>;
  rosterCoverageDays: number;
}

// A roster row with every provenance column null is part of the known
// 412,032-row synthetic batch from 2026-06-11, not a real assignment.
// See backend/src/modules/wfm/roster-analytics.routes.ts for the same guard.
const REAL_ROSTER_GUARD =
  "NOT (ra.import_batch_id IS NULL AND ra.cycle_id IS NULL AND ra.assignment_type IS NULL AND ra.shift_template_id IS NULL)";

export async function getWorkforceCorrelation(
  userId: string, processId: string, period: ReportPeriod = "trend",
): Promise<WorkforceCorrelation | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const unavailable = (reason: string): WorkforceCorrelation => ({
    available: false, reason, periodFrom: null, periodTo: null,
    daily: [], weeklyAttrition: [], rosterCoverageDays: 0,
  });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code, date_of_joining, date_of_exit
       FROM employees WHERE process_id = ? AND employee_code IS NOT NULL AND employee_code != ''`,
    [processId],
  );
  const employees = (empRows as any[]).map((r) => ({
    code: String(r.employee_code),
    joined: r.date_of_joining ? isoDate(r.date_of_joining) : null,
    exited: r.date_of_exit ? isoDate(r.date_of_exit) : null,
  })).filter((e) => e.joined);
  if (!employees.length) return unavailable("This process has no employees with a recorded joining date.");

  const range = periodRange(period, new Date()) ?? (() => {
    // "trend" has no calendar-aligned range of its own -- default the daily
    // series to a bounded 30-day trailing window rather than an open scan.
    const to = new Date();
    const from = new Date(to); from.setDate(from.getDate() - 30);
    return { from: isoDate(from), to: isoDate(to), priorFrom: isoDate(from), priorTo: isoDate(to) };
  })();
  const { from, to } = range;

  const employeeCodes = employees.map((e) => e.code);
  const inList = employeeCodes.map(() => "?").join(",");

  // Agent-attributed CLAP share per day -- reuses the exact taxonomy the VOC
  // panel above already computes, just grouped by day instead of totalled.
  const [clapDailyRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d') AS d,
            SUM(CASE WHEN (${CLAP_CASE.replace(/q\./g, "")}) = 'Agent' THEN 1 ELSE 0 END) AS agent_n,
            COUNT(*) AS total_n
       FROM db_audit.call_quality_assessment
      WHERE User IN (${inList}) AND quality_percentage IS NOT NULL
        AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY d`,
    [...employeeCodes, from, to],
  );
  const clapByDay = new Map<string, { agent: number; total: number }>(
    (clapDailyRows as any[]).map((r) => [String(r.d), { agent: Number(r.agent_n), total: Number(r.total_n) }]),
  );

  // Present headcount per day -- attendance_daily_record carries process_id
  // directly, no employees join needed.
  const [presentRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(record_date, '%Y-%m-%d') AS d,
            COUNT(DISTINCT CASE WHEN attendance_status IN ('present','half_day') THEN employee_id END) AS present_n
       FROM attendance_daily_record
      WHERE process_id = ? AND record_date BETWEEN ? AND ?
      GROUP BY d`,
    [processId, from, to],
  );
  const presentByDay = new Map<string, number>((presentRows as any[]).map((r) => [String(r.d), Number(r.present_n)]));

  // Planned headcount per day from the live roster table, real rows only.
  const [rosterRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS d, COUNT(DISTINCT ra.employee_id) AS planned_n
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id
      WHERE e.process_id = ? AND ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER_GUARD}
      GROUP BY d`,
    [processId, from, to],
  );
  const plannedByDay = new Map<string, number>((rosterRows as any[]).map((r) => [String(r.d), Number(r.planned_n)]));
  const rosterCoverageDays = plannedByDay.size;

  // Daily active headcount / ramp-cohort share computed in JS from the small
  // per-process employee list fetched once above -- cheaper and honester than
  // a per-day query, and avoids the active_status trap: that flag is a live
  // "as of now" state, not point-in-time, so a past day's active count has to
  // come from date_of_joining/date_of_exit directly.
  const daily: WorkforceCorrelationPoint[] = [];
  const cursor = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (cursor <= end) {
    const d = isoDate(cursor);
    let active = 0; let ramp = 0;
    const rampCutoff = new Date(cursor); rampCutoff.setDate(rampCutoff.getDate() - 30);
    for (const e of employees) {
      if (e.joined! > d) continue;
      if (e.exited && e.exited <= d) continue;
      active += 1;
      if (e.joined! >= isoDate(rampCutoff)) ramp += 1;
    }
    const clap = clapByDay.get(d);
    daily.push({
      date: d,
      agentClapPct: clap && clap.total > 0 ? Math.round((clap.agent / clap.total) * 1000) / 10 : null,
      auditedCalls: clap?.total ?? 0,
      activeHeadcount: active,
      rampCohortPct: active > 0 ? Math.round((ramp / active) * 1000) / 10 : null,
      presentHeadcount: presentByDay.has(d) ? presentByDay.get(d)! : null,
      plannedHeadcount: plannedByDay.has(d) ? plannedByDay.get(d)! : null,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Attrition, bucketed by ISO week (Monday start), computed in JS from the
  // same employee list -- no second query needed.
  const weekStartOf = (iso: string): string => {
    const dt = new Date(iso + "T00:00:00");
    const dow = dt.getDay();
    const sinceMonday = (dow + 6) % 7;
    dt.setDate(dt.getDate() - sinceMonday);
    return isoDate(dt);
  };
  const attritionByWeek = new Map<string, number>();
  for (const e of employees) {
    if (!e.exited || e.exited < from || e.exited > to) continue;
    const wk = weekStartOf(e.exited);
    attritionByWeek.set(wk, (attritionByWeek.get(wk) ?? 0) + 1);
  }
  const weeklyAttrition = [...attritionByWeek.entries()]
    .map(([weekStart, exits]) => ({ weekStart, exits }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    available: true, reason: null, periodFrom: from, periodTo: to,
    daily, weeklyAttrition, rosterCoverageDays,
  };
}

/**
 * Process Business Health — revenue/GRN/expenses/Op%, headcount vs. sanctioned
 * mandate, and hiring pipeline, in one honest read.
 *
 * Every one of these already exists as real, working code elsewhere in this
 * repo (process-pnl, workforce-mandate, job-requisition) — nothing here is a
 * new calculation. What's new is reading all three together for one process
 * and being explicit about the real, per-process gaps each already has: most
 * processes have no `workforce_mandate` row, revenue can be genuinely
 * `missing_rule` for a given month, and most processes currently have zero
 * open requisitions. None of that is hidden or defaulted to zero.
 *
 * Shrinkage is deliberately NOT included: the dedicated shrinkage snapshot
 * table has never been populated at process grain for any process (the
 * nightly cron only writes branch/org-level — see rta-nightly.cron.ts), so
 * there is nothing real to show here yet.
 */
export interface ProcessBusinessHealth {
  available: boolean;
  reason: string | null;
  periodCode: string;
  finance: {
    available: boolean;
    reason: string | null;
    revenue: number | null;
    revenueStatus: string | null;
    grn: number | null;
    agentSalary: number | null;
    /** True only when a real salary_prep_run exists for this process/month --
     *  see the long comment where this is set for why that check exists at all. */
    agentSalaryIsRealThisMonth: boolean;
    ebit: number | null;
    operatingProfitPct: number | null;
  };
  headcount: {
    available: boolean;
    reason: string | null;
    activeHc: number;
    mandatedHc: number | null;
    gap: number | null;
    /** activeHc, uncapped by mandate -- how many people are staffed on this
     *  process right now, full stop. Previously computed as max(mandate -
     *  activeHc, 0), an exact duplicate of `shortfall` below that always read
     *  0 whenever a process was fully or over-staffed (flagged live 2026-09-10
     *  against Onfido: 222 staffed vs. 181 mandate showed "Available count: 0"
     *  on a process with no shortage at all). User's call: this field means
     *  the raw available headcount, not a mandate-relative figure. */
    availableCount: number;
    /** max(activeHc - mandate, 0) -- staffed beyond the sanctioned mandate. */
    buffer: number | null;
    /** max(mandate - activeHc, 0) -- staffed below the sanctioned mandate. */
    shortfall: number | null;
  };
  hiring: {
    available: boolean;
    reason: string | null;
    openRequisitions: number;
    openPositions: number;
    candidatesInPipeline: number;
    /** SUM(fulfilled_headcount) across every requisition ever raised for this
     *  process -- how many seats have actually been filled through the
     *  requisition pipeline, not a proxy for total joiners (someone could
     *  join outside a requisition, e.g. a transfer). */
    hiredCount: number;
    /** Alias of `openPositions`, exposed under the label the dashboard uses
     *  for this figure -- requested minus already-fulfilled headcount, summed
     *  across every still-open requisition. */
    pendingHiringCount: number;
  };
}

export async function getProcessBusinessHealth(
  userId: string, processId: string,
): Promise<ProcessBusinessHealth | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

  const [processRows] = await db.execute<RowDataPacket[]>(
    `SELECT process_name FROM process_master WHERE id = ?`, [processId],
  );
  const processName = (processRows as any[])[0]?.process_name ?? null;

  const today = new Date();
  const periodCode = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  // ── Finance: revenue/GRN/expenses/Op% -- reuses the real P&L engine as-is,
  // never a second copy of its formulas. MUST go through the org-wide
  // getCachedAllocationSummary (60s TTL, shared with the P&L pages), never
  // bpoPnlAllocationOverlayService.getProcessDetail directly -- that one
  // recomputes the full org-wide allocation from scratch, uncached, on every
  // single call. Found the hard way: it hung well past 90s under this
  // machine's real concurrent load and stalled every other DB-backed route
  // behind it (shared connection pool). This reads one process's row out of
  // the SAME cached summary every P&L page already warms.
  let finance: ProcessBusinessHealth["finance"];
  try {
    // Bounded wait, not a bare await: the underlying P&L computation has been
    // observed to hang well past 90s under this machine's real concurrent
    // load (see comment above) rather than throw -- a bare await here means
    // this whole panel spins on "Pulling P&L..." forever with no fallback,
    // exactly what live verification caught on 2026-09-10 (Bella-Vita Organic,
    // request pending 60s+, no response at all). A hang is not a crash the
    // existing try/catch below can degrade from, so race it against a timeout
    // and degrade the same honest way the catch block already does for a
    // real error -- this endpoint must always answer, even if finance can't.
    const summary: any = await Promise.race([
      getCachedAllocationSummary({ period: periodCode }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("P&L allocation summary timed out after 8s")), 8000)),
    ]);
    const row = (summary?.rows as any[] | undefined)?.find((r) => r.processId === processId) ?? null;
    if (!row) {
      finance = {
        available: false, reason: "No P&L allocation row for this process this month.",
        revenue: null, revenueStatus: null, grn: null, agentSalary: null, agentSalaryIsRealThisMonth: false,
        ebit: null, operatingProfitPct: null,
      };
    } else {
      finance = {
        available: true, reason: null,
        revenue: row.recognizedRevenue ?? null,
        revenueStatus: row.revenueDataStatus ?? null,
        grn: row.grnVendorActual ?? null,
        agentSalary: row.agentSalary ?? null,
        agentSalaryIsRealThisMonth: true, // corrected below
        ebit: row.ebit ?? row.operatingProfit ?? null,
        operatingProfitPct: row.operatingProfitPct ?? null,
      };

      /*
       * Verified independently against the source table, not trusted from the P&L
       * engine's own fallback chain.
       *
       * Traced live: for a month with no real salary_prep_run yet,
       * bpo-pnl.service.ts's agentSalary still resolves to a non-zero, plausible-
       * looking figure through a chain of "??" fallbacks (getActualPeopleCost ->
       * getPeopleCosts -> base.directPeopleCost) that all independently confirmed
       * empty when traced by hand against this exact process/period -- yet the
       * live cached row kept returning a real number anyway. The fallback chain
       * itself is real, deliberate, well-commented production code (see its own
       * comments in bpo-pnl.service.ts), just not something this page should
       * blindly trust as "this month's actual" without checking the one thing
       * that actually proves it: a real payroll run for THIS process, THIS month.
       *
       * So: read salary_prep_run directly. If none exists for this process this
       * month, the agentSalary/EBIT/Op% the P&L engine returned are NOT this
       * month's real numbers -- withhold them here rather than present a
       * plausible-looking figure this page cannot verify as real.
       */
      // salary_prep_run itself carries process_id=NULL on every real row seen in
      // production (it's a company-wide run) -- scoping only works through which
      // employees actually appear in salary_prep_line for that run, same as the
      // P&L engine's own getPayrollPeople() does it.
      const [runRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) n
           FROM salary_prep_line spl
           JOIN salary_prep_run spr ON spr.id = spl.run_id
           JOIN employees e ON e.id = spl.employee_id
          WHERE spr.run_month = ? AND e.process_id = ?`,
        [periodCode, processId],
      ).catch(() => [[{ n: 0 }]] as any);
      const hasRealRun = Number((runRows as any[])[0]?.n ?? 0) > 0;
      if (!hasRealRun) {
        finance.agentSalaryIsRealThisMonth = false;
        finance.agentSalary = null;
        finance.ebit = null;
        finance.operatingProfitPct = null;
        finance.reason =
          `No payroll run has been processed for ${periodCode} yet -- agent salary, EBIT and Op% ` +
          "withheld rather than shown from an unverifiable fallback. Revenue and GRN above are still real.";
      }
    }
  } catch (err) {
    finance = {
      available: false, reason: `P&L engine error: ${err instanceof Error ? err.message : "unknown"}`,
      revenue: null, revenueStatus: null, grn: null, agentSalary: null, agentSalaryIsRealThisMonth: false,
      ebit: null, operatingProfitPct: null,
    };
  }

  // ── Headcount vs. mandate -- active headcount is always real. "Mandate" turns
  // out to have TWO independent, disagreeing sources in this system, not one:
  //
  //   workforce_mandate.mandated_hc        -- the formal HC-planning mandate,
  //     configured for only 21 of 58 processes.
  //   process_revenue_rule.mandated_seats  -- the seat count the CLIENT is
  //     billed against, configured for more processes (33 of 58) including
  //     several with no workforce_mandate row at all.
  //
  // Checked live across all 58 processes: 14 processes have BOTH, and 14 of
  // those disagree -- some by a lot (one process: 10 revenue-rule seats vs.
  // 31 HC-mandate seats). Silently preferring one over the other means
  // picking a winner between two real, both-configured numbers with no basis
  // to say which is right. So: show whichever exists; show BOTH, clearly
  // labelled, when both exist -- never quietly resolve a disagreement.
  const [hcRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS active_hc FROM employees WHERE process_id = ? AND active_status = 1`, [processId],
  );
  const activeHc = Number((hcRows as any[])[0]?.active_hc ?? 0);
  const [mandateRows] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(mandated_hc) AS total_mandated_hc
       FROM workforce_mandate
      WHERE process_id = ? AND active_status = 1
        AND effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())`,
    [processId],
  );
  const mandatedHcRaw = (mandateRows as any[])[0]?.total_mandated_hc;
  const hcMandate = mandatedHcRaw !== null && mandatedHcRaw !== undefined ? Number(mandatedHcRaw) : null;

  const [seatRows] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(mandated_seats) AS total_seats
       FROM process_revenue_rule
      WHERE process_id = ? AND status = 'approved' AND mandated_seats IS NOT NULL
        AND effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())`,
    [processId],
  );
  const seatRaw = (seatRows as any[])[0]?.total_seats;
  const revenueRuleSeats = seatRaw !== null && seatRaw !== undefined ? Number(seatRaw) : null;

  // Buffer/shortfall are derived from the mandate gap, so null when no mandate
  // exists -- factored out so all three headcount branches below stay in sync
  // rather than repeating the max(...,0) pair three times. availableCount is
  // NOT part of that gap: it's activeHc itself, always real regardless of
  // whether a mandate is configured.
  const staffingSplit = (mandate: number | null): { availableCount: number; buffer: number | null; shortfall: number | null } =>
    mandate === null
      ? { availableCount: activeHc, buffer: null, shortfall: null }
      : { availableCount: activeHc, buffer: Math.max(activeHc - mandate, 0), shortfall: Math.max(mandate - activeHc, 0) };

  let headcount: ProcessBusinessHealth["headcount"];
  if (hcMandate === null && revenueRuleSeats === null) {
    headcount = {
      available: false, reason: "No sanctioned headcount mandate or contracted seat count configured for this process.",
      activeHc, mandatedHc: null, gap: null, ...staffingSplit(null),
    };
  } else if (hcMandate !== null && revenueRuleSeats !== null && hcMandate !== revenueRuleSeats) {
    headcount = {
      available: true,
      reason: `Two disagreeing sources: HC mandate says ${hcMandate}, the revenue rule's contracted seats say ${revenueRuleSeats}. Shown separately rather than picking one.`,
      activeHc, mandatedHc: hcMandate, gap: activeHc - hcMandate, ...staffingSplit(hcMandate),
    };
  } else {
    const resolved = hcMandate ?? revenueRuleSeats!;
    headcount = {
      available: true,
      reason: hcMandate === null ? "From the revenue rule's contracted seats — no formal HC mandate configured." : null,
      activeHc, mandatedHc: resolved, gap: activeHc - resolved, ...staffingSplit(resolved),
    };
  }

  // ── Hiring pipeline -- job_requisition carries a real process_id link;
  // ats_candidate only matches by process NAME (no FK), which is weaker and
  // stated as such rather than presented with equal confidence.
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS open_reqs, COALESCE(SUM(GREATEST(requested_headcount - fulfilled_headcount, 0)), 0) AS open_positions
       FROM job_requisition
      WHERE process_id = ? AND approval_status NOT IN ('closed', 'cancelled', 'rejected')`,
    [processId],
  );
  const openRequisitions = Number((reqRows as any[])[0]?.open_reqs ?? 0);
  const openPositions = Number((reqRows as any[])[0]?.open_positions ?? 0);

  // "Hired Count" -- fulfilled_headcount summed across every requisition this
  // process has ever raised (open or closed), not scoped to a period: this is
  // a running total of seats actually filled through the requisition
  // pipeline, the same denominator hiring managers already track it against.
  const [hiredRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(fulfilled_headcount), 0) AS hired FROM job_requisition WHERE process_id = ?`,
    [processId],
  );
  const hiredCount = Number((hiredRows as any[])[0]?.hired ?? 0);

  let candidatesInPipeline = 0;
  if (processName) {
    const [candRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM ats_candidate WHERE applied_for_process = ?`, [processName],
    );
    candidatesInPipeline = Number((candRows as any[])[0]?.n ?? 0);
  }
  const hiring: ProcessBusinessHealth["hiring"] = {
    available: true, reason: null, openRequisitions, openPositions, candidatesInPipeline,
    hiredCount, pendingHiringCount: openPositions,
  };

  return { available: true, reason: null, periodCode, finance, headcount, hiring };
}
