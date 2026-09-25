import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import { DOC_AHT_AVG, readFilters, tlAmFilter } from "./onfido-process-dashboard.service.js";
import {
  EXTERNAL_STAGES, INTERNAL_STAGES, externalStageSelect, internalStageSelect, rateCell, type RateCell,
} from "./onfido-quality-stages.js";

/**
 * Analyst Performance format (23-Sep-26): one row per analyst with Doc AHT, POA AHT, CRE, CRQ,
 * ETM, Task Skip, UL and the Internal / External quality stage columns. Every figure is read
 * from the uploaded Onfido reports; an analyst with no rows for a column gets null, not 0.
 *
 * UL is Unplanned Leave (actual UL days from the Agent Wise attrition/shrinkage upload), the
 * only per-analyst "UL" any Onfido source carries. A per-analyst utilization % is not possible
 * because the forecast that utilization divides by is a team-level figure.
 */

const CRE_TABLE = "onfido_doc_escalation_cre_raw";
const CRQ_TABLE = "onfido_doc_escalation_crq_raw";

export type AnalystStageKey = "classification" | "extraction" | "ewys" | "ewysAddress" | "labelling";

export interface AnalystReportRow {
  analyst: string;
  tlName: string | null;
  amName: string | null;
  docTasks: number;
  docAht: number | null;
  poaTasks: number;
  poaAht: number | null;
  cre: number;
  crq: number;
  etm: number;
  taskSkip: number;
  /** Actual unplanned-leave days in the period; null when the analyst has no Agent Wise rows. */
  unplannedLeaveDays: number | null;
  scheduledDays: number | null;
  internal: Record<AnalystStageKey | "poa" | "overall", RateCell>;
  external: Record<"classification" | "extraction" | "ewys" | "ewysAddress" | "poa" | "overall", RateCell>;
}

interface Filters { from?: string; to?: string; tlName?: string; amName?: string }

const ANALYST_INTERNAL_KEYS: readonly AnalystStageKey[] = ["classification", "extraction", "ewys", "ewysAddress", "labelling"];
const emailOk = "analyst_email IS NOT NULL AND analyst_email <> ''";

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function emptyRow(analyst: string): AnalystReportRow {
  const empty = rateCell(0, 0);
  return {
    analyst, tlName: null, amName: null, docTasks: 0, docAht: null, poaTasks: 0, poaAht: null,
    cre: 0, crq: 0, etm: 0, taskSkip: 0, unplannedLeaveDays: null, scheduledDays: null,
    internal: { classification: empty, extraction: empty, ewys: empty, ewysAddress: empty, labelling: empty, poa: empty, overall: empty },
    external: { classification: empty, extraction: empty, ewys: empty, ewysAddress: empty, poa: empty, overall: empty },
  };
}

export async function getAnalystReport(rawFilters: Filters): Promise<{ from: string; to: string; rows: AnalystReportRow[] }> {
  const f = readFilters(rawFilters);
  const { clause, params } = tlAmFilter(rawFilters.tlName, rawFilters.amName);
  const pool = await getOnfidoPool();
  const args = [f.from, f.to, ...params];
  const q = async (sql: string): Promise<RowDataPacket[]> => (await pool.query<RowDataPacket[]>(sql, args))[0];
  const countBy = (table: string, dateCol: string, emailCol = "analyst_email") =>
    q(`SELECT LOWER(${emailCol}) AS a, COUNT(*) AS n FROM ${table}
         WHERE ${dateCol} BETWEEN ? AND ? ${clause} AND ${emailCol} IS NOT NULL AND ${emailCol} <> '' GROUP BY a`);

  const [doc, poa, cre, crq, etmDoc, etmPoa, skip, ul, intQ, extQ, poaInt, poaExt] = await Promise.all([
    q(`SELECT LOWER(analyst_email) AS a, MAX(tl_name) AS tl, MAX(am_name) AS am, COUNT(*) AS n, ${DOC_AHT_AVG} AS aht
         FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? ${clause} AND ${emailOk} GROUP BY a`),
    q(`SELECT LOWER(analyst_email) AS a, MAX(tl_name) AS tl, MAX(am_name) AS am, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
         FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} AND ${emailOk} GROUP BY a`),
    countBy(CRE_TABLE, "qc_updated_date"),
    countBy(CRQ_TABLE, "qc_updated_date"),
    countBy("onfido_doc_etm_raw", "report_date"),
    countBy("onfido_poa_etm_raw", "report_date"),
    countBy("onfido_task_skip_raw", "skip_date", "unassigned_from_email"),
    q(`SELECT LOWER(analyst_email) AS a, COALESCE(SUM(actual_ul), 0) AS ul, COALESCE(SUM(scheduled), 0) AS sched
         FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause} AND ${emailOk} GROUP BY a`),
    q(`SELECT LOWER(analyst_email) AS a, COALESCE(SUM(total_audits), 0) AS audits, COALESCE(SUM(total_error), 0) AS errors,
              ${internalStageSelect(INTERNAL_STAGES.filter((s) => (ANALYST_INTERNAL_KEYS as readonly string[]).includes(s.key)))}
         FROM onfido_doc_quality_raw WHERE task_complete_date BETWEEN ? AND ? ${clause} AND ${emailOk} GROUP BY a`),
    q(`SELECT LOWER(analyst_email) AS a, COUNT(*) AS audits, COALESCE(SUM(has_error), 0) AS errors, ${externalStageSelect()}
         FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ? ${clause} AND ${emailOk} GROUP BY a`),
    q(`SELECT LOWER(analyst_email) AS a, COALESCE(SUM(error_count), 0) AS errors, COALESCE(SUM(no_error_count), 0) AS clean
         FROM onfido_poa_quality_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} AND ${emailOk} GROUP BY a`),
    q(`SELECT LOWER(analyst_email) AS a, COUNT(*) AS audits, COALESCE(SUM(error_flag), 0) AS errors
         FROM onfido_poa_external_raw WHERE report_completed_date BETWEEN ? AND ? ${clause} AND ${emailOk} GROUP BY a`),
  ]);

  const rows = new Map<string, AnalystReportRow>();
  const row = (a: unknown): AnalystReportRow => {
    const key = String(a);
    const existing = rows.get(key);
    if (existing) return existing;
    const created = emptyRow(key);
    rows.set(key, created);
    return created;
  };

  // The roster is every analyst who completed a DOC or POA task in the period.
  for (const r of doc) Object.assign(row(r.a), { docTasks: num(r.n), docAht: r.aht === null ? null : Math.round(Number(r.aht)), tlName: r.tl || null, amName: r.am || null });
  for (const r of poa) {
    const target = row(r.a);
    target.poaTasks = num(r.n);
    target.poaAht = r.aht === null ? null : Math.round(Number(r.aht));
    target.tlName ??= r.tl || null;
    target.amName ??= r.am || null;
  }
  const active = new Set(rows.keys());
  const only = (list: RowDataPacket[]): RowDataPacket[] => list.filter((r) => active.has(String(r.a)));

  for (const r of only(cre)) row(r.a).cre = num(r.n);
  for (const r of only(crq)) row(r.a).crq = num(r.n);
  for (const r of only(etmDoc)) row(r.a).etm += num(r.n);
  for (const r of only(etmPoa)) row(r.a).etm += num(r.n);
  for (const r of only(skip)) row(r.a).taskSkip = num(r.n);
  for (const r of only(ul)) {
    const target = row(r.a);
    target.unplannedLeaveDays = numOrNull(r.ul);
    target.scheduledDays = numOrNull(r.sched);
  }
  for (const r of only(intQ)) {
    const target = row(r.a);
    for (const key of ANALYST_INTERNAL_KEYS) {
      const err = num(r[`s_${key}_err`]);
      target.internal[key] = rateCell(err, err + num(r[`s_${key}_ok`]));
    }
    target.internal.overall = rateCell(num(r.errors), num(r.audits));
  }
  for (const r of only(extQ)) {
    const target = row(r.a);
    for (const s of EXTERNAL_STAGES) target.external[s.key as "classification"] = rateCell(num(r[`x_${s.key}_err`]), num(r[`x_${s.key}_tot`]));
    target.external.overall = rateCell(num(r.errors), num(r.audits));
  }
  for (const r of only(poaInt)) row(r.a).internal.poa = rateCell(num(r.errors), num(r.errors) + num(r.clean));
  for (const r of only(poaExt)) row(r.a).external.poa = rateCell(num(r.errors), num(r.audits));

  return { from: f.from, to: f.to, rows: [...rows.values()].sort((a, b) => a.analyst.localeCompare(b.analyst)) };
}

// ── Week-wise view for one analyst ───────────────────────────────────────────

export const ANALYST_WEEKLY_MAX_WEEKS = 8;

export interface AnalystWeekRow {
  weekStart: string;
  weekEnd: string;
  label: string;
  docTasks: number;
  docAht: number | null;
  poaTasks: number;
  poaAht: number | null;
  cre: number;
  crq: number;
  etm: number;
  taskSkip: number;
  errors: number;
  audits: number;
  overallErrorPct: number | null;
}

const MS_PER_DAY = 86_400_000;
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday-start weeks covering [from, to], each clipped to the range. Pure - unit tested. */
export function splitIntoWeeks(from: string, to: string): { start: string; end: string; label: string; monday: string }[] {
  const first = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  const weeks: { start: string; end: string; label: string; monday: string }[] = [];
  let weekMonday = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * MS_PER_DAY);
  while (weekMonday <= last && weeks.length < ANALYST_WEEKLY_MAX_WEEKS) {
    const weekSunday = new Date(weekMonday.getTime() + 6 * MS_PER_DAY);
    const start = weekMonday < first ? first : weekMonday;
    const end = weekSunday > last ? last : weekSunday;
    weeks.push({
      start: isoDay(start),
      end: isoDay(end),
      label: `WC ${String(weekMonday.getUTCDate()).padStart(2, "0")} ${MONTH_ABBR[weekMonday.getUTCMonth()]}`,
      monday: isoDay(weekMonday),
    });
    weekMonday = new Date(weekMonday.getTime() + 7 * MS_PER_DAY);
  }
  return weeks;
}

/**
 * One analyst, week by week (Week-commencing rows). One grouped query per source over the whole
 * range (not one full analyst report per week), so the cost is one pass over each table. The
 * error % combines internal + external audits, the same definition as the main table's "Overall".
 */
export async function getAnalystWeekly(
  analystEmail: string, rawFilters: Filters
): Promise<{ from: string; to: string; weeks: AnalystWeekRow[] }> {
  const f = readFilters(rawFilters);
  const pool = await getOnfidoPool();
  const weeks = splitIntoWeeks(f.from, f.to);
  const email = analystEmail.trim();
  const args = [email, f.from, f.to];
  const bucket = (col: string) => `DATE_FORMAT(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY), '%Y-%m-%d')`;
  const run = async (sql: string): Promise<RowDataPacket[]> => (await pool.query<RowDataPacket[]>(sql, args))[0];
  const count = (table: string, dateCol: string, emailCol = "analyst_email") =>
    run(`SELECT ${bucket(dateCol)} AS w, COUNT(*) AS n FROM ${table}
          WHERE ${emailCol} = ? AND ${dateCol} BETWEEN ? AND ? GROUP BY w`);

  const [doc, poa, cre, crq, etmDoc, etmPoa, skip, internal, external] = await Promise.all([
    run(`SELECT ${bucket("report_date")} AS w, COUNT(*) AS n, ${DOC_AHT_AVG} AS aht FROM onfido_doc_raw
          WHERE analyst_email = ? AND report_date BETWEEN ? AND ? GROUP BY w`),
    run(`SELECT ${bucket("report_completed_date")} AS w, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht FROM onfido_poa_raw
          WHERE analyst_email = ? AND report_completed_date BETWEEN ? AND ? GROUP BY w`),
    count(CRE_TABLE, "qc_updated_date"),
    count(CRQ_TABLE, "qc_updated_date"),
    count("onfido_doc_etm_raw", "report_date"),
    count("onfido_poa_etm_raw", "report_date"),
    count("onfido_task_skip_raw", "skip_date", "unassigned_from_email"),
    run(`SELECT ${bucket("task_complete_date")} AS w, COALESCE(SUM(total_audits), 0) AS audits, COALESCE(SUM(total_error), 0) AS errors
          FROM onfido_doc_quality_raw WHERE analyst_email = ? AND task_complete_date BETWEEN ? AND ? GROUP BY w`),
    run(`SELECT ${bucket("report_date")} AS w, COUNT(*) AS audits, COALESCE(SUM(has_error), 0) AS errors
          FROM onfido_doc_external_audit_raw WHERE analyst_email = ? AND report_date BETWEEN ? AND ? GROUP BY w`),
  ]);

  const byWeek = (rows: RowDataPacket[]): Map<string, RowDataPacket> => new Map(rows.map((r) => [String(r.w), r]));
  const [docBy, poaBy, creBy, crqBy, etmDocBy, etmPoaBy, skipBy, intBy, extBy] =
    [doc, poa, cre, crq, etmDoc, etmPoa, skip, internal, external].map(byWeek);

  const rows = weeks.map((w): AnalystWeekRow => {
    const monday = w.monday;
    const d = docBy.get(monday);
    const p = poaBy.get(monday);
    const errors = num(intBy.get(monday)?.errors) + num(extBy.get(monday)?.errors);
    const audits = num(intBy.get(monday)?.audits) + num(extBy.get(monday)?.audits);
    return {
      weekStart: w.start, weekEnd: w.end, label: w.label,
      docTasks: num(d?.n), docAht: d?.aht === null || d?.aht === undefined ? null : Math.round(Number(d.aht)),
      poaTasks: num(p?.n), poaAht: p?.aht === null || p?.aht === undefined ? null : Math.round(Number(p.aht)),
      cre: num(creBy.get(monday)?.n), crq: num(crqBy.get(monday)?.n),
      etm: num(etmDocBy.get(monday)?.n) + num(etmPoaBy.get(monday)?.n),
      taskSkip: num(skipBy.get(monday)?.n),
      errors, audits, overallErrorPct: audits > 0 ? Math.round((errors / audits) * 1000) / 10 : null,
    };
  });
  return { from: f.from, to: f.to, weeks: rows };
}
