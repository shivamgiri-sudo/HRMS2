import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import * as dash from "./onfido-process-dashboard.service.js";
import { INTERNAL_STAGES, externalStageSelect, EXTERNAL_STAGES, internalStageSelect } from "./onfido-quality-stages.js";
import { listManpowerPlan } from "./onfido-wfm-inputs.service.js";
import { getUtilizationDays, utilizationTrend } from "./onfido-utilization.service.js";
import {
  DOC_TASK_GROUPS, PROCESS_QUEUES, QUEUE_LABELS, UNCLASSIFIED_AON_LABEL, aggregateStaffing, aonBucketForLiveDays,
  bucketBounds, buildAonRows, buildMatrix, classifyTaskType, computeManpower, groupTaskTypes, pct1, planAsOf,
  queuesMissingPlan, totalApprovedAsOf,
  type AonRow, type DocTaskGroup, type Granularity, type ManpowerFigures, type ManpowerPlanRow, type Matrix,
  type ProcessQueue, type StaffingBucket, type StaffingDay,
} from "./onfido-overview-report.pure.js";

/**
 * Overview format (23-Sep-26 "OVERVIEW PAGE NEED TO CHANGE.xlsx"): manpower, queue-wise,
 * AON, then the trend sections, all on one Daily / Weekly / Monthly axis.
 *
 * Nothing is invented. Trends reuse the dashboard's own aggregations (so the numbers agree
 * with the DOC Raw / POA / Quality / ETM / Task Skip tabs); manpower needs the WFM-entered
 * approved HC (onfido_manpower_plan) and is null until it exists. Each section loads inside
 * its own try/catch, so one failing query reports its error without blanking the page.
 */

export interface OverviewFilters { from?: string; to?: string; tlName?: string; amName?: string }

export interface Section<T> { data: T | null; error: string | null }

export interface QueueRow extends ManpowerFigures {
  queue: ProcessQueue;
  label: string;
  /** How Active HC was obtained: distinct analysts with completed tasks, or the WFM entry. */
  activeSource: "analysts_with_tasks" | "manual_entry" | null;
}

export interface ManpowerSection extends ManpowerFigures {
  /** Day the Active HC snapshot is taken on (last on-floor day in range). */
  asOf: string | null;
  planEffectiveFrom: string | null;
  /** Queues with no approved-HC entry on the as-on date; while any is missing the total stays blank. */
  approvedMissingFor: string[];
  queues: QueueRow[];
}

export interface AonSection {
  asOf: string | null;
  rows: AonRow[];
  unclassifiedHc: number;
  totalHc: number;
}

export interface OverviewReport {
  granularity: Granularity;
  from: string;
  to: string;
  manpower: Section<ManpowerSection>;
  aon: Section<AonSection>;
  bufferTrend: Section<Matrix>;
  attritionTrend: Section<Matrix>;
  shrinkageTrend: Section<Matrix>;
  docProcessingTrend: Section<Matrix>;
  taskVolumeContribution: Section<Matrix>;
  taskAht: Section<Matrix>;
  internalQuality: Section<Matrix>;
  externalQuality: Section<Matrix>;
  poaVolumeTime: Section<Matrix>;
  poaQuality: Section<Matrix>;
  etmTrend: Section<Matrix>;
  taskSkipTrend: Section<Matrix>;
  gdMcnTrend: Section<Matrix>;
  utilizationTrend: Section<Matrix>;
  creCrqTrend: Section<Matrix>;
}

const ONFLOOR = `LOWER(COALESCE(state,'onfloor')) = 'onfloor'`;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const label = (raw: unknown, g: Granularity): string => dash.bucketLabel(raw, g);

async function safe<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Could not load this section." };
  }
}

const series = (name: string, entries: Iterable<[string, number | null]>) => ({ label: name, points: new Map(entries) });

// ── Staffing (manpower, buffer, attrition, shrinkage) ────────────────────────

async function loadStaffingDays(f: { from: string; to: string }, clause: string, params: string[]): Promise<StaffingDay[]> {
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(work_date, '%Y-%m-%d') AS d,
            COALESCE(SUM(CASE WHEN ${ONFLOOR} THEN hc ELSE 0 END), 0) AS hc,
            COALESCE(SUM(CASE WHEN ${ONFLOOR} THEN attrition_flag ELSE 0 END), 0) AS attrition,
            COALESCE(SUM(scheduled), 0) AS scheduled, COALESCE(SUM(unplanned_leave), 0) AS ul,
            COALESCE(SUM(actual_ul), 0) AS actual_ul
       FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause} GROUP BY d ORDER BY d`,
    [f.from, f.to, ...params],
  );
  return rows.map((r) => ({
    day: String(r.d), hc: num(r.hc), attrition: num(r.attrition), scheduled: num(r.scheduled),
    unplannedLeave: num(r.ul), actualUl: num(r.actual_ul),
  }));
}

/** Distinct analysts who completed a task in the queue during the period. */
async function countActiveAnalysts(table: string, dateCol: string, from: string, to: string, clause: string, params: string[]): Promise<number> {
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT LOWER(analyst_email)) AS n FROM ${table}
       WHERE ${dateCol} BETWEEN ? AND ? ${clause} AND analyst_email IS NOT NULL AND analyst_email <> ''`,
    [from, to, ...params],
  );
  return num(rows[0]?.n);
}

function buildQueueRows(plan: readonly ManpowerPlanRow[], asOf: string, extraction: number, poa: number): QueueRow[] {
  return PROCESS_QUEUES.map((queue): QueueRow => {
    const row = planAsOf(plan, queue, asOf);
    let active: number | null = null;
    let activeSource: QueueRow["activeSource"] = null;
    if (queue === "EXTRACTION") { active = extraction; activeSource = "analysts_with_tasks"; }
    else if (queue === "POA") { active = poa; activeSource = "analysts_with_tasks"; }
    else if (row?.activeHc !== null && row?.activeHc !== undefined) { active = row.activeHc; activeSource = "manual_entry"; }
    return { queue, label: QUEUE_LABELS[queue], ...computeManpower(row?.approvedHc ?? null, active), activeSource };
  });
}

async function loadManpower(
  f: { from: string; to: string }, g: Granularity, days: readonly StaffingDay[], plan: readonly ManpowerPlanRow[],
  clause: string, params: string[],
): Promise<ManpowerSection> {
  const last = days[days.length - 1];
  const asOf = last?.day ?? f.to;
  const bounds = bucketBounds(asOf, g);
  const periodFrom = bounds.start < f.from ? f.from : bounds.start;
  const periodTo = asOf;
  const [extraction, poa] = await Promise.all([
    countActiveAnalysts("onfido_doc_raw", "report_date", periodFrom, periodTo, clause, params),
    countActiveAnalysts("onfido_poa_raw", "report_completed_date", periodFrom, periodTo, clause, params),
  ]);
  const approved = totalApprovedAsOf(plan, asOf);
  const planDates = PROCESS_QUEUES.map((q) => planAsOf(plan, q, asOf)?.effectiveFrom).filter((d): d is string => !!d).sort();
  return {
    ...computeManpower(approved, last ? last.hc : null),
    asOf: last ? asOf : null,
    planEffectiveFrom: planDates.length > 0 ? planDates[planDates.length - 1] : null,
    approvedMissingFor: queuesMissingPlan(plan, asOf).map((q) => QUEUE_LABELS[q]),
    queues: buildQueueRows(plan, asOf, extraction, poa),
  };
}

async function loadAon(f: { from: string; to: string }, days: readonly StaffingDay[], clause: string, params: string[]): Promise<AonSection> {
  const last = days[days.length - 1];
  if (!last) return { asOf: null, rows: buildAonRows([]).rows, unclassifiedHc: 0, totalHc: 0 };
  const pool = await getOnfidoPool();
  // Live Days is only in the raw_data JSON; one day of on-floor rows is a few hundred rows.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."Live Days"')), '') AS SIGNED) AS live_days,
            COALESCE(SUM(hc), 0) AS hc
       FROM onfido_agent_daily_raw WHERE work_date = ? AND ${ONFLOOR} ${clause} GROUP BY live_days`,
    [last.day, ...params],
  );
  const built = buildAonRows(rows.map((r) => ({ liveDays: numOrNull(r.live_days), hc: num(r.hc) })));
  return { asOf: last.day, ...built };
}

function bufferMatrix(buckets: readonly StaffingBucket[], plan: readonly ManpowerPlanRow[]): Matrix {
  const approvedFor = (b: StaffingBucket) => totalApprovedAsOf(plan, b.lastDay);
  return buildMatrix([
    series("Buffer %", buckets.map((b): [string, number | null] => [b.bucket, computeManpower(approvedFor(b), b.activeHc).bufferPct])),
    series("Active HC", buckets.map((b): [string, number | null] => [b.bucket, b.activeHc])),
    series("Approved HC", buckets.map((b): [string, number | null] => [b.bucket, approvedFor(b)])),
  ]);
}

// ── Task-type sections ───────────────────────────────────────────────────────

function groupRows(perBucket: Map<string, Map<DocTaskGroup, number | null>>, extra: { label: string; points: Map<string, number | null> }[] = []): Matrix {
  const rows = DOC_TASK_GROUPS.map((g) => series(g, [...perBucket.entries()].map(([b, m]): [string, number | null] => [b, m.get(g) ?? null])));
  const kept = rows.filter((r) => r.label !== "Other" || [...r.points.values()].some((v) => v !== null && v > 0));
  return buildMatrix([...kept, ...extra]);
}

async function loadTaskTypeMatrices(f: OverviewFilters, g: Granularity): Promise<{ volume: Matrix; aht: Matrix }> {
  const points = await dash.getDocTaskTypeTrend(f, g);
  const volume = new Map<string, Map<DocTaskGroup, number | null>>();
  const aht = new Map<string, Map<DocTaskGroup, number | null>>();
  for (const p of points) {
    const grouped = groupTaskTypes(p.byTaskType);
    const total = [...grouped.values()].reduce((s, v) => s + v.taskCount, 0);
    volume.set(p.bucket, new Map([...grouped].map(([k, v]) => [k, pct1(v.taskCount, total)])));
    aht.set(p.bucket, new Map([...grouped].map(([k, v]) => [k, v.ahtCount > 0 ? Math.round(v.ahtWeighted / v.ahtCount) : null])));
  }
  return { volume: groupRows(volume), aht: groupRows(aht) };
}

async function loadInternalQuality(f: OverviewFilters, g: Granularity, clause: string, params: string[]): Promise<Matrix> {
  const range = dash.readFilters(f);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dash.bucketExpr("task_complete_date", g)} AS bucket, COALESCE(SUM(total_audits), 0) AS audits,
            COALESCE(SUM(total_error), 0) AS errors, ${internalStageSelect(INTERNAL_STAGES)}
       FROM onfido_doc_quality_raw WHERE task_complete_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [range.from, range.to, ...params],
  );
  return buildMatrix([
    ...INTERNAL_STAGES.map((s) => series(s.label, rows.map((r): [string, number | null] => {
      const err = num(r[`s_${s.key}_err`]);
      return [label(r.bucket, g), pct1(err, err + num(r[`s_${s.key}_ok`]))];
    }))),
    series("Overall", rows.map((r): [string, number | null] => [label(r.bucket, g), pct1(num(r.errors), num(r.audits))])),
  ]);
}

async function loadExternalQuality(f: OverviewFilters, g: Granularity, clause: string, params: string[]): Promise<Matrix> {
  const range = dash.readFilters(f);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dash.bucketExpr("report_date", g)} AS bucket, COUNT(*) AS audits, COALESCE(SUM(has_error), 0) AS errors,
            ${externalStageSelect()}
       FROM onfido_doc_external_audit_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket ORDER BY bucket`,
    [range.from, range.to, ...params],
  );
  return buildMatrix([
    ...EXTERNAL_STAGES.map((s) => series(s.label, rows.map((r): [string, number | null] =>
      [label(r.bucket, g), pct1(num(r[`x_${s.key}_err`]), num(r[`x_${s.key}_tot`]))]))),
    series("Overall", rows.map((r): [string, number | null] => [label(r.bucket, g), pct1(num(r.errors), num(r.audits))])),
  ]);
}

async function loadEtm(f: OverviewFilters, g: Granularity, clause: string, params: string[]): Promise<Matrix> {
  const range = dash.readFilters(f);
  const pool = await getOnfidoPool();
  const [docRows, poaCounts] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT ${dash.bucketExpr("report_date", g)} AS bucket,
              COALESCE(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."Task Information Task Type Old"'))), ''), '') AS task_type,
              COUNT(*) AS n
         FROM onfido_doc_etm_raw WHERE report_date BETWEEN ? AND ? ${clause} GROUP BY bucket, task_type ORDER BY bucket`,
      [range.from, range.to, ...params],
    ).then(([r]) => r),
    dash.getEtmTrend(f, g),
  ]);
  const perBucket = new Map<string, Map<DocTaskGroup, number | null>>();
  for (const r of docRows) {
    const b = label(r.bucket, g);
    const m = perBucket.get(b) ?? new Map<DocTaskGroup, number | null>();
    const group = classifyTaskType(String(r.task_type));
    m.set(group, (m.get(group) ?? 0) + num(r.n));
    perBucket.set(b, m);
  }
  return groupRows(perBucket, [series("POA", poaCounts.map((p): [string, number | null] => [p.bucket, p.poa]))]);
}

async function loadTaskSkip(f: OverviewFilters, g: Granularity, clause: string, params: string[]): Promise<Matrix> {
  const range = dash.readFilters(f);
  const pool = await getOnfidoPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dash.bucketExpr("skip_date", g)} AS bucket, COALESCE(task_type, '') AS task_type, COUNT(*) AS n
       FROM onfido_task_skip_raw WHERE skip_date BETWEEN ? AND ? ${clause} GROUP BY bucket, task_type ORDER BY bucket`,
    [range.from, range.to, ...params],
  );
  const perBucket = new Map<string, Map<DocTaskGroup, number | null>>();
  for (const r of rows) {
    const b = label(r.bucket, g);
    const m = perBucket.get(b) ?? new Map<DocTaskGroup, number | null>();
    const group = classifyTaskType(String(r.task_type));
    m.set(group, (m.get(group) ?? 0) + num(r.n));
    perBucket.set(b, m);
  }
  // The Task Skip upload is DOC only: a POA row would be a made-up zero, so it is left out.
  return groupRows(perBucket);
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export async function getOverviewReport(filters: OverviewFilters, g: Granularity): Promise<OverviewReport> {
  const f = dash.readFilters(filters);
  const { clause, params } = dash.tlAmFilter(filters.tlName, filters.amName);
  const range = { from: f.from, to: f.to };
  const withRange = { ...filters, ...range };

  const staffing = await safe(async () => {
    const [days, plan] = await Promise.all([loadStaffingDays(range, clause, params), listManpowerPlan()]);
    return { days, plan };
  });
  const days = staffing.data?.days ?? [];
  const plan = staffing.data?.plan ?? [];
  const staffingBuckets = aggregateStaffing(days, g);
  const failStaffing = <T,>(): Section<T> => ({ data: null, error: staffing.error });
  const fromStaffing = <T,>(build: () => T): Section<T> => (staffing.error ? failStaffing<T>() : { data: build(), error: null });

  const [manpower, aon, docTrend, taskType, internalQ, externalQ, poaTrend, poaInt, poaExt, etm, skip, gd, esc, util] = await Promise.all([
    staffing.error ? Promise.resolve(failStaffing<ManpowerSection>()) : safe(() => loadManpower(range, g, days, plan, clause, params)),
    staffing.error ? Promise.resolve(failStaffing<AonSection>()) : safe(() => loadAon(range, days, clause, params)),
    safe(() => dash.getDocRawTrend(withRange, g)),
    safe(() => loadTaskTypeMatrices(withRange, g)),
    safe(() => loadInternalQuality(withRange, g, clause, params)),
    safe(() => loadExternalQuality(withRange, g, clause, params)),
    safe(() => dash.getPoaCombinedTrend(withRange, g)),
    safe(() => dash.getPoaQualityTrend(withRange, g)),
    safe(() => dash.getPoaExternalTrend(withRange, g)),
    safe(() => loadEtm(withRange, g, clause, params)),
    safe(() => loadTaskSkip(withRange, g, clause, params)),
    safe(() => dash.getGdMcnSlaTrend(range, g)),
    safe(() => dash.getEscalationTrend(withRange, g)),
    safe(async () => utilizationTrend(await getUtilizationDays(f.from, f.to), g)),
  ]);

  const map = <T, U>(s: Section<T>, build: (d: T) => U): Section<U> =>
    s.data === null ? { data: null, error: s.error } : { data: build(s.data), error: null };

  return {
    granularity: g, from: f.from, to: f.to, manpower, aon,
    bufferTrend: fromStaffing(() => bufferMatrix(staffingBuckets, plan)),
    attritionTrend: fromStaffing(() => buildMatrix([
      series("Attrition %", staffingBuckets.map((b): [string, number | null] => [b.bucket, b.attritionPct])),
      series("Exits", staffingBuckets.map((b): [string, number | null] => [b.bucket, b.attrition])),
    ])),
    shrinkageTrend: fromStaffing(() => buildMatrix([
      series("Shrinkage %", staffingBuckets.map((b): [string, number | null] => [b.bucket, b.shrinkagePct])),
      series("UL Shrinkage %", staffingBuckets.map((b): [string, number | null] => [b.bucket, b.ulShrinkagePct])),
    ])),
    docProcessingTrend: map(docTrend, (d) => buildMatrix([
      series("AHT (sec)", d.map((p): [string, number | null] => [p.bucket, p.avgAht])),
      series("Volume", d.map((p): [string, number | null] => [p.bucket, p.taskCount])),
    ])),
    taskVolumeContribution: map(taskType, (t) => t.volume),
    taskAht: map(taskType, (t) => t.aht),
    internalQuality: internalQ,
    externalQuality: externalQ,
    poaVolumeTime: map(poaTrend, (d) => buildMatrix([
      series("AHT (sec)", d.map((p): [string, number | null] => [p.bucket, p.avgAht])),
      series("Volume", d.map((p): [string, number | null] => [p.bucket, p.taskCount])),
    ])),
    poaQuality: (() => {
      if (poaInt.data === null) return { data: null, error: poaInt.error } as Section<Matrix>;
      if (poaExt.data === null) return { data: null, error: poaExt.error } as Section<Matrix>;
      return {
        data: buildMatrix([
          series("POA Internal Quality (error %)", poaInt.data.map((p): [string, number | null] => [p.bucket, p.errorRate])),
          series("POA External Quality (error %)", poaExt.data.map((p): [string, number | null] => [p.bucket, pct1(p.errorCount, p.taskCount)])),
        ]),
        error: null,
      };
    })(),
    etmTrend: etm,
    taskSkipTrend: skip,
    gdMcnTrend: map(gd, (d) => buildMatrix([
      series("GD %", d.map((p): [string, number | null] => [p.bucket, p.gdPct])),
      series("MCN %", d.map((p): [string, number | null] => [p.bucket, p.mcnPct])),
    ])),
    utilizationTrend: map(util, (d) => buildMatrix([
      series("Utilization with Adhoc %", d.map((p): [string, number | null] => [p.bucket, p.utilizationWithAdhocPct])),
      series("Utilization without Adhoc %", d.map((p): [string, number | null] => [p.bucket, p.utilizationWithoutAdhocPct])),
    ])),
    creCrqTrend: map(esc, (d) => buildMatrix([
      series("CRE", d.map((p): [string, number | null] => [p.bucket, p.creCount])),
      series("CRQ", d.map((p): [string, number | null] => [p.bucket, p.crqCount])),
    ])),
  };
}

/** Analysts counted in one AON bucket on the snapshot day (drill-down for the AON table). */
export interface AonAnalystRow { empId: string | null; empName: string | null; analyst: string | null; tlName: string | null; amName: string | null; location: string | null; liveDays: number | null }

export async function getAonBucketAnalysts(filters: OverviewFilters, bucketLabel: string): Promise<{ asOf: string | null; rows: AonAnalystRow[] }> {
  const f = dash.readFilters(filters);
  const { clause, params } = dash.tlAmFilter(filters.tlName, filters.amName);
  const pool = await getOnfidoPool();
  const [lastRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(work_date), '%Y-%m-%d') AS d FROM onfido_agent_daily_raw WHERE work_date BETWEEN ? AND ? ${clause}`,
    [f.from, f.to, ...params],
  );
  const last = lastRows[0]?.d ? { day: String(lastRows[0].d) } : null;
  if (!last) return { asOf: null, rows: [] };
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT emp_id, emp_name, analyst_email, tl_name, am_name, location,
            CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."Live Days"')), '') AS SIGNED) AS live_days
       FROM onfido_agent_daily_raw WHERE work_date = ? AND ${ONFLOOR} AND hc > 0 ${clause}
       ORDER BY emp_name LIMIT 2000`,
    [last.day, ...params],
  );
  const wanted = rows
    .map((r): AonAnalystRow => ({
      empId: r.emp_id ?? null, empName: r.emp_name ?? null, analyst: r.analyst_email ?? null,
      tlName: r.tl_name ?? null, amName: r.am_name ?? null, location: r.location ?? null, liveDays: numOrNull(r.live_days),
    }))
    .filter((r) => (aonBucketForLiveDays(r.liveDays) ?? UNCLASSIFIED_AON_LABEL) === bucketLabel);
  return { asOf: last.day, rows: wanted };
}
