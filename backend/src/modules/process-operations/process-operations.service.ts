import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";

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
  /** Chronological daily points for a sparkline. Gaps are gaps, not zeroes. */
  trend: Array<{ date: string; value: number | null }>;
  /** Parts behind a ratio, when the compute stored them. */
  numerator: number | null;
  denominator: number | null;
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
      "FUNNEL_SALE_PCT", "FUNNEL_OFFER_TO_SALE_PCT",
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
    `SELECT a.process_id, p.process_name,
            COUNT(DISTINCT a.metric_key) metrics,
            MAX(a.score_date) latest,
            (SELECT COUNT(*) FROM employees e
              WHERE e.process_id = p.id AND e.active_status = 1) headcount
       FROM process_metric_actual a
       JOIN process_master p ON p.id = a.process_id AND p.active_status = 1
      WHERE a.actual_value IS NOT NULL
        AND a.score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY a.process_id, p.process_name, p.id
      ORDER BY metrics DESC, p.process_name`,
    [windowDays],
  );
  return (rows as any[])
    .filter((r) => allowed.has(String(r.process_id)))
    .map((r) => ({
      processId: String(r.process_id),
      processName: String(r.process_name),
      metrics: Number(r.metrics),
      headcount: Number(r.headcount),
      latestDate: r.latest ? isoDate(r.latest) : null,
      staleDays: r.latest ? daysSince(isoDate(r.latest)) : null,
    }));
}

export interface ProcessOperations {
  processId: string;
  processName: string;
  headcount: number;
  windowDays: number;
  staleAfterDays: number;
  sections: MetricSection[];
  /** Metric codes this process has that no section claims. Listed, never hidden. */
  ungrouped: MetricReading[];
}

export async function getProcessOperations(
  userId: string, processId: string, windowDays = 30,
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

  // Every reading in the window, with its parts. Ordered so the trend is already
  // chronological and the last row of each metric is its latest.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.metric_key, a.score_date, a.actual_value, a.rollup_numerator, a.rollup_denominator,
            m.metric_name, m.unit, m.direction
       FROM process_metric_actual a
       LEFT JOIN kpi_metric_master m ON m.metric_code = a.metric_key
      WHERE a.process_id = ?
        AND a.score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY a.metric_key, a.score_date`,
    [processId, windowDays],
  );

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
        priorValue: null, trend: [],
        numerator: null, denominator: null,
      });
    }
    const m = byMetric.get(key)!;
    const date = isoDate(r.score_date);
    const value = r.actual_value === null ? null : Number(r.actual_value);
    m.trend.push({ date, value });
    // The headline is the most recent day that actually produced a number. A
    // no_data day must not blank out a metric that was reading fine yesterday.
    if (value !== null) {
      m.value = value;
      m.latestDate = date;
      m.numerator = unscaleNumerator(
        r.rollup_numerator === null ? null : Number(r.rollup_numerator),
        m.unit,
      );
      m.denominator = r.rollup_denominator === null ? null : Number(r.rollup_denominator);
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
  }>;
}

export async function getMetricDrilldown(
  userId: string, processId: string, metricKey: string, windowDays = 30,
): Promise<MetricDrilldown | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;

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
    `SELECT score_date, actual_value, rollup_numerator, rollup_denominator, note
       FROM process_metric_actual
      WHERE process_id = ? AND metric_key = ?
        AND score_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY score_date DESC`, [processId, metricKey, windowDays],
  );

  // Nothing known about it and nothing ever recorded: this metric does not exist
  // for this process, and an empty shell returned as 200 would look like a metric
  // that simply has no data yet.
  if (!metric && !def && !(readingRows as any[]).length) return null;

  return {
    metricKey,
    metricName: metric?.metric_name ? String(metric.metric_name) : metricKey,
    unit,
    direction: metric?.direction ?? null,
    processId,
    processName: String(proc.process_name),
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
    readings: (readingRows as any[]).map((r) => ({
      date: isoDate(r.score_date),
      value: r.actual_value === null ? null : Number(r.actual_value),
      numerator: unscaleNumerator(
        r.rollup_numerator === null ? null : Number(r.rollup_numerator), unit),
      denominator: r.rollup_denominator === null ? null : Number(r.rollup_denominator),
      note: r.note ?? null,
    })),
  };
}
