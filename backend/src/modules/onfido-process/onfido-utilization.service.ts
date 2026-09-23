import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import { DOC_AHT_AVG } from "./onfido-process-dashboard.service.js";
import { listUtilizationInputs, type UtilizationInputRecord } from "./onfido-wfm-inputs.service.js";
import {
  averageKnown, bucketKeyForDay, computeUtilization, sumInputs, weekCommencing,
  type Granularity, type UtilizationDerived, type UtilizationInputs,
} from "./onfido-overview-report.pure.js";

/**
 * Utilization report (Utilization Format.xlsx). Columns, order and formulas follow the sheet.
 *
 * Real from the uploaded Onfido reports: Actual Task (DOC tasks), POA Live (POA tasks), AHT,
 * POA AHT, GD%, MCN%, SLA, APS and Escalated Task (DOC tasks flagged escalated).
 * Entered by WFM (onfido_utilization_daily_input): Forecasted Task, Forecasted Task POA,
 * Manual FAR Case, Adhoc Time, Analyst QC, Facial checks, Cross training task POA and
 * POA Live Audits / POA PQ Audits. A formula that needs an input nobody has entered is null.
 */

const MAX_DAYS = 366;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface UtilizationDay {
  date: string;
  /** "Jul-26", the sheet's TEXT(A,"mmm-yy"). */
  month: string;
  /** Week commencing (Monday). */
  wc: string;
  inputs: UtilizationInputs;
  derived: UtilizationDerived;
  aht: number | null;
  poaAht: number | null;
  /** GD / MCN / SLA / APS as the source's own ratio (0.9 = 90%). */
  gdRatio: number | null;
  mcnRatio: number | null;
  slaRatio: number | null;
  apsRatio: number | null;
  /** True when a WFM input row exists for the day. */
  hasManualInputs: boolean;
  remarks: string | null;
  inputsUpdatedBy: string | null;
  inputsUpdatedAt: string | null;
}

export interface UtilizationReport {
  from: string;
  to: string;
  days: UtilizationDay[];
  /** Last day with real task data; MTD covers from..this day. */
  throughDate: string | null;
  mtd: UtilizationMtd;
}

export interface UtilizationMtd {
  inputs: UtilizationInputs;
  derived: UtilizationDerived;
  aht: number | null;
  poaAht: number | null;
  gdRatio: number | null;
  mcnRatio: number | null;
  slaRatio: number | null;
  apsRatio: number | null;
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function monthLabel(day: string): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]}-${day.slice(2, 4)}`;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && out.length < MAX_DAYS) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const emptyInputs = (): UtilizationInputs => ({
  forecastTask: null, forecastTaskPoa: null, actualTask: null, manualFarCases: null, poaLive: null, adhocTime: null,
  analystQc: null, facialChecks: null, crossTrainingTaskPoa: null, poaLiveAuditsPq: null, escalatedTask: null,
});

/** Assembles one day. Pure: the SQL results and the manual row are passed in. */
export function buildUtilizationDay(
  date: string,
  doc: { n: number; aht: number | null; esc: number } | undefined,
  poa: { n: number; aht: number | null } | undefined,
  gd: { gd: number | null; mcn: number | null; sla: number | null; aps: number | null } | undefined,
  manual: UtilizationInputRecord | undefined,
): UtilizationDay {
  const inputs: UtilizationInputs = {
    ...emptyInputs(),
    actualTask: doc ? doc.n : null,
    poaLive: poa ? poa.n : null,
    escalatedTask: doc ? doc.esc : null,
    forecastTask: manual?.forecastTask ?? null,
    forecastTaskPoa: manual?.forecastTaskPoa ?? null,
    manualFarCases: manual?.manualFarCases ?? null,
    adhocTime: manual?.adhocTime ?? null,
    analystQc: manual?.analystQc ?? null,
    facialChecks: manual?.facialChecks ?? null,
    crossTrainingTaskPoa: manual?.crossTrainingTaskPoa ?? null,
    poaLiveAuditsPq: manual?.poaLiveAuditsPq ?? null,
  };
  return {
    date, month: monthLabel(date), wc: weekCommencing(date), inputs, derived: computeUtilization(inputs),
    aht: doc?.aht ?? null, poaAht: poa?.aht ?? null,
    gdRatio: gd?.gd ?? null, mcnRatio: gd?.mcn ?? null, slaRatio: gd?.sla ?? null, apsRatio: gd?.aps ?? null,
    hasManualInputs: manual !== undefined,
    remarks: manual?.remarks ?? null,
    inputsUpdatedBy: manual ? (manual.updatedBy ?? manual.createdBy) : null,
    inputsUpdatedAt: manual ? (manual.updatedAt ?? manual.createdAt) : null,
  };
}

async function loadDailyActuals(from: string, to: string) {
  const pool = await getOnfidoPool();
  const range = [from, to];
  const [[docRows], [poaRows], [gdRows]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, COUNT(*) AS n, ${DOC_AHT_AVG} AS aht,
              COALESCE(SUM(is_escalated), 0) AS esc
         FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ? GROUP BY d`, range),
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_completed_date, '%Y-%m-%d') AS d, COUNT(*) AS n, AVG(manual_processing_time_secs) AS aht
         FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ? GROUP BY d`, range),
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(slot_date, '%Y-%m-%d') AS d, AVG(gd_pct) AS gd, AVG(mcn_pct) AS mcn,
              AVG(sla_pct) AS sla, AVG(aps_pct) AS aps
         FROM onfido_gd_mcn_sla_raw WHERE slot_date BETWEEN ? AND ? AND gmt_slot = 'Total' GROUP BY d`, range),
  ]);
  return {
    doc: new Map(docRows.map((r) => [String(r.d), { n: Number(r.n), aht: numOrNull(r.aht), esc: Number(r.esc) }])),
    poa: new Map(poaRows.map((r) => [String(r.d), { n: Number(r.n), aht: numOrNull(r.aht) }])),
    gd: new Map(gdRows.map((r) => [String(r.d), { gd: numOrNull(r.gd), mcn: numOrNull(r.mcn), sla: numOrNull(r.sla), aps: numOrNull(r.aps) }])),
  };
}

/** Every calendar day from..to, real task data + WFM inputs + the sheet's formulas. */
export async function getUtilizationDays(from: string, to: string): Promise<UtilizationDay[]> {
  const [actuals, manualRows] = await Promise.all([loadDailyActuals(from, to), listUtilizationInputs(from, to)]);
  const manual = new Map(manualRows.map((m) => [m.inputDate, m]));
  return eachDay(from, to).map((d) => buildUtilizationDay(d, actuals.doc.get(d), actuals.poa.get(d), actuals.gd.get(d), manual.get(d)));
}

/** MTD row: complete column sums, sheet formulas on the sums, AVERAGE for GD/MCN/SLA/APS. */
export function buildMtd(days: readonly UtilizationDay[], aht: number | null, poaAht: number | null): { throughDate: string | null; mtd: UtilizationMtd } {
  const withData = days.filter((d) => d.inputs.actualTask !== null);
  const through = withData.length > 0 ? withData[withData.length - 1].date : null;
  const covered = through === null ? [] : days.filter((d) => d.date <= through);
  const inputs = covered.length > 0 ? sumInputs(covered.map((d) => d.inputs)) : emptyInputs();
  return {
    throughDate: through,
    mtd: {
      inputs, derived: computeUtilization(inputs), aht, poaAht,
      gdRatio: averageKnown(covered.map((d) => d.gdRatio)),
      mcnRatio: averageKnown(covered.map((d) => d.mcnRatio)),
      slaRatio: averageKnown(covered.map((d) => d.slaRatio)),
      apsRatio: averageKnown(covered.map((d) => d.apsRatio)),
    },
  };
}

export async function getUtilizationReport(from: string, to: string): Promise<UtilizationReport> {
  const days = await getUtilizationDays(from, to);
  const through = days.filter((d) => d.inputs.actualTask !== null).pop()?.date ?? null;
  let aht: number | null = null;
  let poaAht: number | null = null;
  if (through !== null) {
    const pool = await getOnfidoPool();
    const [[docRow], [poaRow]] = await Promise.all([
      pool.query<RowDataPacket[]>(`SELECT ${DOC_AHT_AVG} AS aht FROM onfido_doc_raw WHERE report_date BETWEEN ? AND ?`, [from, through]),
      pool.query<RowDataPacket[]>(`SELECT AVG(manual_processing_time_secs) AS aht FROM onfido_poa_raw WHERE report_completed_date BETWEEN ? AND ?`, [from, through]),
    ]);
    aht = numOrNull(docRow[0]?.aht);
    poaAht = numOrNull(poaRow[0]?.aht);
  }
  const { throughDate, mtd } = buildMtd(days, aht, poaAht);
  return { from, to, days, throughDate, mtd };
}

export interface UtilizationTrendPoint {
  bucket: string;
  utilizationWithAdhocPct: number | null;
  utilizationWithoutAdhocPct: number | null;
}

/** Utilization % per bucket for the Overview chart; a bucket is null unless every input it needs is present. */
export function utilizationTrend(days: readonly UtilizationDay[], granularity: Granularity): UtilizationTrendPoint[] {
  const groups = new Map<string, UtilizationDay[]>();
  for (const d of days) {
    if (d.inputs.actualTask === null) continue;
    const key = bucketKeyForDay(d.date, granularity);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()].map(([bucket, group]) => {
    const derived = computeUtilization(sumInputs(group.map((d) => d.inputs)));
    return {
      bucket,
      utilizationWithAdhocPct: derived.utilizationWithAdhocPct === null ? null : Math.round(derived.utilizationWithAdhocPct * 10) / 10,
      utilizationWithoutAdhocPct: derived.utilizationWithoutAdhocPct === null ? null : Math.round(derived.utilizationWithoutAdhocPct * 10) / 10,
    };
  });
}
