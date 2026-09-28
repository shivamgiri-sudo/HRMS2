import { db } from "../../db/mysql.js";

/**
 * The full "Inbound" MIS snapshot table (Call Offered .. Call Answered
 * (Agents), 29 rows) from the reference report, rebuilt from the real
 * uploaded db_masmis.cl_ib_cdr (Inbound CDR) and db_masmis.cl_apr (Agent
 * Productivity Report) tables per explicit user request, plus cl_feedback
 * (Feedback/CSAT rows) and cl_quality (Quality Score %, lob='Inbound').
 *
 * Every field mapping below was checked against cl_ib_cdr's real 1-Sep-26
 * values against the reference report's own 1-Sep column before being
 * used here (not guessed):
 *   - disposition='A'        -> Answered (265 vs reference 264)
 *   - abn='0'                -> Abandoned (7 vs reference 7, exact)
 *   - call_20_sec_sl='1'     -> Call Ans in Threshold (248 vs reference 242)
 *   - AVG(queue_duration)    -> Average Queue Time (4.9s vs reference 5s)
 *   - AVG(acw_duration)      -> Average ACW Time (50.7s vs reference 50s)
 *   - unique_repeat          -> Unique / Repeat Calls (877 repeat vs
 *                                reference Repeat%=22.9% of 3790 = close)
 *
 * IMPORTANT known gaps, surfaced to the frontend rather than hidden:
 *   1. cl_ib_cdr only has rows for 1-Sep-26 .. 9-Sep-26 -- the upload does
 *      not yet cover the rest of the month. MTD/W-2 here reflect only
 *      those uploaded days, not the full month.
 *   2. cl_ib_cdr's own distinct-agent count is far lower per day (11-13)
 *      than the reference report's "Call Answered (Agents)" row (44+),
 *      strongly suggesting this export is a partial/sampled extract, not
 *      the complete CDR. "Call Answered (Agents)" is therefore sourced
 *      from cl_apr's distinct mas_id count instead (13 for 1-Sep, still
 *      short of 44 but the closer of the two real sources), per the
 *      explicit instruction to also use APR for this row.
 *   3. "Tagging %" has no corresponding column in cl_ib_cdr, cl_apr or any
 *      other uploaded Clovia table -- omitted rather than fabricated.
 */

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parses the "D-Mon-YY" text every one of these tables' date columns use
 * into a real Date -- see clovia-channels-dashboard.service.ts's own doc
 * comment for why this is done in JS rather than trusted to a single
 * shared SQL date format across tables with different real conventions. */
function parseShortDate(raw: unknown): Date | null {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const month = MONTH_ABBR[m[2].toLowerCase()];
  if (!month) return null;
  return new Date(2000 + Number(m[3]), month - 1, Number(m[1]));
}
function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function timeToSec(raw: unknown): number {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export interface SnapshotMetric {
  key: string;
  label: string;
  benchmark: string | null;
  values: Record<string, number | string>;
}
export interface SnapshotPeriod {
  key: string;
  label: string;
}
export interface CloviaInboundSnapshot {
  periods: SnapshotPeriod[];
  metrics: SnapshotMetric[];
  cdrCoverage: { minDate: string; maxDate: string };
  notes: string[];
}

interface CdrRow {
  call_date: unknown;
  agent_id: unknown;
  disposition: unknown;
  unique_repeat: unknown;
  abn: unknown;
  call_20_sec_sl: unknown;
  short_calls: unknown;
  queue_duration: unknown;
  acw_duration: unknown;
  hold_time: unknown;
  total_handled_time: unknown;
}
interface AprRow { report_date: unknown; mas_id: unknown; attendance: unknown }
interface FeedbackRow { report_date: unknown; language: unknown; csat_dsat: unknown }
interface QualityRow { audit_date: unknown; lob: unknown; cq_score: unknown }
interface RechurnRow { report_date: unknown }

function computeMetricsForRows(
  cdr: CdrRow[], apr: AprRow[], feedback: FeedbackRow[], quality: QualityRow[], rechurn: RechurnRow[],
): Record<string, number> {
  const offered = cdr.length;
  const answered = cdr.filter((r) => r.disposition === "A").length;
  const uniqueCalls = cdr.filter((r) => r.unique_repeat === "Unique").length;
  const repeatCalls = cdr.filter((r) => r.unique_repeat === "Repeat").length;
  const abnCalls = cdr.filter((r) => r.abn === "0").length;
  const inThreshold = cdr.filter((r) => r.call_20_sec_sl === "1").length;
  const shortCalls = cdr.filter((r) => r.short_calls === "1").length;
  const answeredRows = cdr.filter((r) => r.disposition === "A");
  const avgOf = (rows: CdrRow[], field: keyof CdrRow) => {
    const withVal = rows.filter((r) => r[field] !== null && r[field] !== undefined && String(r[field]).trim() !== "");
    if (withVal.length === 0) return 0;
    return withVal.reduce((s, r) => s + num(r[field]), 0) / withVal.length;
  };
  const achtSec = answeredRows.length > 0 ? answeredRows.reduce((s, r) => s + timeToSec(r.total_handled_time), 0) / answeredRows.length : 0;
  const avgQueueSec = avgOf(cdr, "queue_duration");
  const avgAcwSec = avgOf(answeredRows, "acw_duration");
  const avgHoldSec = avgOf(cdr, "hold_time");
  const distinctAgentsAnswered = new Set(answeredRows.map((r) => String(r.agent_id))).size;

  const aprAgents = new Set(apr.map((r) => String(r.mas_id))).size;
  const feedbackReceived = feedback.length;
  const feedbackHindi = feedback.filter((r) => String(r.language).trim().toLowerCase() === "hindi").length;
  const feedbackEnglish = feedback.filter((r) => String(r.language).trim().toLowerCase() === "english").length;
  const satisfied = feedback.filter((r) => String(r.csat_dsat).trim() === "1").length;
  const notSatisfied = feedback.filter((r) => String(r.csat_dsat).trim() === "0").length;

  const inboundQuality = quality.filter((r) => String(r.lob).trim().toLowerCase() === "inbound");
  const avgQualityScore = inboundQuality.length > 0 ? inboundQuality.reduce((s, r) => s + num(r.cq_score), 0) / inboundQuality.length : 0;

  return {
    call_offered: offered,
    call_answered: answered,
    unique_calls: uniqueCalls,
    repeat_calls: repeatCalls,
    repeat_pct: offered > 0 ? Math.round((repeatCalls / offered) * 10000) / 100 : 0,
    rechurn_calls: rechurn.length,
    al_pct: offered > 0 ? Math.round((answered / offered) * 10000) / 100 : 0,
    abn_calls: abnCalls,
    abn_pct: offered > 0 ? Math.round((abnCalls / offered) * 10000) / 100 : 0,
    call_ans_in_threshold: inThreshold,
    short_calls: shortCalls,
    short_call_pct: offered > 0 ? Math.round((shortCalls / offered) * 10000) / 100 : 0,
    sl_pct: answered > 0 ? Math.round((inThreshold / answered) * 10000) / 100 : 0,
    acht_sec: Math.round(achtSec),
    avg_queue_sec: Math.round(avgQueueSec),
    avg_acw_sec: Math.round(avgAcwSec),
    avg_hold_sec: Math.round(avgHoldSec),
    quality_score_pct: Math.round(avgQualityScore * 100) / 100,
    feedback_received: feedbackReceived,
    feedback_pct: answered > 0 ? Math.round((feedbackReceived / answered) * 10000) / 100 : 0,
    feedback_hindi: feedbackHindi,
    feedback_english: feedbackEnglish,
    satisfied,
    not_satisfied: notSatisfied,
    csat_pct: feedbackReceived > 0 ? Math.round((satisfied / feedbackReceived) * 10000) / 100 : 0,
    dsat_pct: feedbackReceived > 0 ? Math.round((notSatisfied / feedbackReceived) * 10000) / 100 : 0,
    call_answered_agents: aprAgents || distinctAgentsAnswered,
  };
}

function fmtSecs(s: number): string {
  const total = Math.round(s || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export async function getCloviaInboundSnapshot(): Promise<CloviaInboundSnapshot> {
  const [cdrRaw] = await db.execute<any[]>(
    `SELECT call_date, agent_id, disposition, unique_repeat, abn, call_20_sec_sl, short_calls, queue_duration, acw_duration, hold_time, total_handled_time FROM db_masmis.cl_ib_cdr`,
  );
  const [aprRaw] = await db.execute<any[]>(`SELECT report_date, mas_id, attendance FROM db_masmis.cl_apr`);
  const [feedbackRaw] = await db.execute<any[]>(`SELECT report_date, language, csat_dsat FROM db_masmis.cl_feedback`);
  const [qualityRaw] = await db.execute<any[]>(`SELECT audit_date, lob, cq_score FROM db_masmis.cl_quality`);
  const [rechurnRaw] = await db.execute<any[]>(`SELECT report_date FROM db_masmis.cl_rechurn_call`);

  const withDate = <T extends object>(rows: T[], field: string) =>
    rows
      .map((r) => ({ ...r, __date: parseShortDate((r as Record<string, unknown>)[field]) }))
      .filter((r): r is T & { __date: Date } => r.__date !== null);

  const cdr = withDate(cdrRaw as CdrRow[], "call_date");
  const apr = withDate(aprRaw as AprRow[], "report_date");
  const feedback = withDate(feedbackRaw as FeedbackRow[], "report_date");
  const quality = withDate(qualityRaw as QualityRow[], "audit_date");
  const rechurn = withDate(rechurnRaw as RechurnRow[], "report_date");

  const cdrDates = cdr.map((r) => r.__date.getTime()).sort((a, b) => a - b);
  const minDate = cdrDates.length ? isoDate(new Date(cdrDates[0])) : "";
  const maxDate = cdrDates.length ? isoDate(new Date(cdrDates[cdrDates.length - 1])) : "";

  const uniqueDays = [...new Set(cdr.map((r) => isoDate(r.__date)))].sort();

  function filterAll(pred: (d: Date) => boolean) {
    return {
      cdr: cdr.filter((r) => pred(r.__date)),
      apr: apr.filter((r) => pred(r.__date)),
      feedback: feedback.filter((r) => pred(r.__date)),
      quality: quality.filter((r) => pred(r.__date)),
      rechurn: rechurn.filter((r) => pred(r.__date)),
    };
  }

  const periods: SnapshotPeriod[] = [];
  const perPeriodValues: Record<string, Record<string, number>> = {};

  // MTD -- every uploaded cl_ib_cdr day, not the calendar month (see doc comment).
  periods.push({ key: "mtd", label: "Sept'26 (uploaded)" });
  const mtdSet = filterAll(() => true);
  perPeriodValues.mtd = computeMetricsForRows(mtdSet.cdr, mtdSet.apr, mtdSet.feedback, mtdSet.quality, mtdSet.rechurn);

  // W-1 / W-2 -- calendar day-of-month 1-7 / 8-14, same convention used
  // elsewhere in this app (e.g. Housing Owner's own week field).
  periods.push({ key: "w1", label: "W-1" });
  const w1Set = filterAll((d) => d.getDate() >= 1 && d.getDate() <= 7);
  perPeriodValues.w1 = computeMetricsForRows(w1Set.cdr, w1Set.apr, w1Set.feedback, w1Set.quality, w1Set.rechurn);

  periods.push({ key: "w2", label: "W-2" });
  const w2Set = filterAll((d) => d.getDate() >= 8 && d.getDate() <= 14);
  perPeriodValues.w2 = computeMetricsForRows(w2Set.cdr, w2Set.apr, w2Set.feedback, w2Set.quality, w2Set.rechurn);

  for (const day of uniqueDays) {
    periods.push({ key: day, label: day });
    const daySet = filterAll((d) => isoDate(d) === day);
    perPeriodValues[day] = computeMetricsForRows(daySet.cdr, daySet.apr, daySet.feedback, daySet.quality, daySet.rechurn);
  }

  const rowDefs: { key: string; label: string; benchmark: string | null; format?: "sec" | "pct" }[] = [
    { key: "call_offered", label: "Call Offered@500 Calls Per Day", benchmark: "7500" },
    { key: "call_answered", label: "Call Answered", benchmark: "7125" },
    { key: "unique_calls", label: "Unique Calls", benchmark: null },
    { key: "repeat_calls", label: "Repeat Calls", benchmark: null },
    { key: "repeat_pct", label: "Repeat%", benchmark: "10%", format: "pct" },
    { key: "rechurn_calls", label: "Rechurn Calls", benchmark: null },
    { key: "al_pct", label: "AL %", benchmark: "95%", format: "pct" },
    { key: "abn_calls", label: "Abn Calls", benchmark: null },
    { key: "abn_pct", label: "Abn %", benchmark: "5%", format: "pct" },
    { key: "call_ans_in_threshold", label: "Call Ans in Threshold", benchmark: null },
    { key: "short_calls", label: "Short Calls < 20 Sec", benchmark: null },
    { key: "short_call_pct", label: "Short Call %", benchmark: null, format: "pct" },
    { key: "sl_pct", label: "SL %", benchmark: "80%", format: "pct" },
    { key: "acht_sec", label: "ACHT", benchmark: "0:05:00", format: "sec" },
    { key: "avg_queue_sec", label: "Average Queue Time", benchmark: null, format: "sec" },
    { key: "avg_acw_sec", label: "Average ACW Time", benchmark: null, format: "sec" },
    { key: "avg_hold_sec", label: "Average Hold Time", benchmark: null, format: "sec" },
    { key: "quality_score_pct", label: "Quality Score %", benchmark: "90%", format: "pct" },
    { key: "feedback_received", label: "Feedback Received", benchmark: null },
    { key: "feedback_pct", label: "Feedback%", benchmark: null, format: "pct" },
    { key: "feedback_hindi", label: "Feedback_Hindi", benchmark: null },
    { key: "feedback_english", label: "Feedback_English", benchmark: null },
    { key: "satisfied", label: "Satisfied", benchmark: null },
    { key: "not_satisfied", label: "Not Satisfied", benchmark: null },
    { key: "csat_pct", label: "C-SAT%", benchmark: "95%", format: "pct" },
    { key: "dsat_pct", label: "D-SAT%", benchmark: "5%", format: "pct" },
    { key: "call_answered_agents", label: "Call Answered (Agents)", benchmark: "85" },
  ];

  const metrics: SnapshotMetric[] = rowDefs.map((def) => {
    const values: Record<string, number | string> = {};
    for (const p of periods) {
      const raw = perPeriodValues[p.key]?.[def.key] ?? 0;
      values[p.key] = def.format === "sec" ? fmtSecs(raw) : def.format === "pct" ? `${raw}%` : raw;
    }
    return { key: def.key, label: def.label, benchmark: def.benchmark, values };
  });

  return {
    periods,
    metrics,
    cdrCoverage: { minDate, maxDate },
    notes: [
      `Inbound CDR (cl_ib_cdr) has only been uploaded for ${minDate} through ${maxDate} — "Sept'26" and "W-2" above reflect only those uploaded days, not the full month.`,
      "cl_ib_cdr's own distinct-agent count per day (11-13) is far below the reference report's ~44-59 — this upload looks like a partial/sampled extract rather than the complete CDR. \"Call Answered (Agents)\" is sourced from cl_apr's roster instead, which is closer but may still undercount for the same reason.",
      "\"Tagging %\" has no corresponding column in any uploaded Clovia table and is omitted rather than invented.",
    ],
  };
}
