import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { assertSafeIdentifier } from "../integration-hub/adapters/databaseAdapter.js";
import { dateExpression, buildProcessEmployeeBreakdownPlan, type SourceField, type DataSourceConfig } from "../kpi/kpi-studio.sources.js";
import { evaluateFormula } from "../kpi/kpi-formula.engine.js";

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
}

export interface MetricSection {
  key: string;
  title: string;
  blurb: string | null;
  metrics: MetricReading[];
}

/**
 * Section order is an argument about how to read the page: coverage before the
 * rates it qualifies, outcomes before the behaviour that explains them, and the
 * workforce last because it is the reason the rest moves rather than a result.
 */
const SECTIONS: Array<{ key: string; title: string; blurb: string; members: string[] }> = [
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
    key: "telephony",
    title: "Telephony",
    blurb: "From the dialler feeds.",
    members: [
      "AHT", "INBOUND_SL_PCT", "INBOUND_AL_PCT", "BLA_INBOUND_AL_PCT",
      "OUTBOUND_CONNECT_PCT", "AGENT_OCCUPANCY_PCT", "AGENT_UTILISATION_PCT",
      "CHAT_TICKETS", "CHAT_RESOLVED_PCT", "CHAT_FRT_SLA_PCT",
    ],
  },
  {
    key: "workforce",
    title: "Workforce",
    blurb: "The same people, and usually the reason the numbers above moved.",
    members: [
      "SHRINKAGE_PCT", "UNRESOLVED_PUNCH_PCT", "CORRECTION_LOAD_PCT",
      "ROSTER_ACK_PCT", "ATTENDANCE_ISSUES_OPEN", "ATTENDANCE_NO_EVIDENCE",
      "SHIFT_MINUTES_AVG", "PROCESS_JOINERS", "PROCESS_EXITS",
      "PROC_ATTENDANCE_PCT",
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
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.process_id, p.process_name, p.process_code,
            p.branch_id, bm.branch_name, bm.branch_code,
            COUNT(DISTINCT a.metric_key) metrics,
            MAX(a.score_date) latest,
            (SELECT COUNT(*) FROM employees e
              WHERE e.process_id = p.id AND e.active_status = 1) headcount
       FROM process_metric_actual a
       JOIN process_master p ON p.id = a.process_id AND p.active_status = 1
       LEFT JOIN branch_master bm ON bm.id = p.branch_id
      WHERE a.actual_value IS NOT NULL
        AND a.score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY a.process_id, p.process_name, p.process_code, p.id, p.branch_id, bm.branch_name, bm.branch_code
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
            m.metric_name, m.unit, m.direction
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
        numerator: null, denominator: null, source: null,
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
    const latest = (latestRows as any[])[0]?.latest;
    if (!latest) return unavailable("No reading exists yet for this metric to break down.");
    const d = isoDate(latest);
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
  if (!(rows as any[]).length) return { ...base, analysts: [] };

  const scored = (rows as any[]).map((r) => {
    const inputs: Record<string, number | string | null> = {};
    for (const name of plan.fieldNames) inputs[name] = r[name] ?? null;
    const evaluated = evaluateFormula(def.formula_expression, inputs);
    return {
      employeeId: String(r.__employee_id),
      employeeCode: String(r.__employee_code ?? ""),
      name: `${r.__first_name ?? ""} ${r.__last_name ?? ""}`.trim() || String(r.__employee_code ?? "Unknown"),
      value: evaluated.value,
    };
  });
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
      value: s.value,
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
