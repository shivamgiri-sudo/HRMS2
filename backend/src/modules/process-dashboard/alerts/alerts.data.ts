/**
 * Process Dashboard alerts -- derives rule inputs from the dashboard's OWN dataset + metric code path.
 * No formula is defined here: values come from pd.metrics (totalAcc/computeMetrics), anomalies from pd.anomalies (detectAnomalies), the
 * rows from pd.dataset (loadDataset/applyFilters/getFreshness) -- so an alert can never disagree with the tile it is about.
 */
import { detectAnomalies, type Anomaly } from "../pd.anomalies.js";
import { applyFilters, getFreshness, loadDataset, loadConfigOrThrow, localIso, type Dataset, type Filters, type Loaded } from "../pd.dataset.js";
import { METRIC_BY_KEY, profileFor } from "../pd.fields.js";
import { computeMetrics, metricAvailable, totalAcc, type NormRow, type QaBucket } from "../pd.metrics.js";
import { loadTargets } from "../pd.config.service.js";
import { ANOMALY_PREFIX, ANOMALY_TYPES, addDaysIso, anomalyTypeOf, isAnomalyKey, type DayValue } from "./alerts.evaluator.js";

export interface AlertContext { loaded: Loaded; asOf: string; ds: Dataset; from: string }

/** Days of history loaded around asOf: backtest span + widest rule window + anomaly baseline (BASELINE_DAYS = 14) + slack. */
export const CONTEXT_LOOKBACK_DAYS = 60;

/** Today is still being loaded (the pacing forecast never counts it either), so a rule is judged on the latest COMPLETE day: never later than yesterday. */
export const alertAsOf = (latestDate: string, today: string = localIso()): string => (latestDate >= today ? addDaysIso(today, -1) : latestDate);

/** Loads the dataset the dashboard would show for this process, ending on its latest data date. null when the process has no data yet. */
export async function loadAlertContext(processId: string, lookbackDays = CONTEXT_LOOKBACK_DAYS): Promise<AlertContext | null> {
  const loaded = await loadConfigOrThrow(processId, { requireEnabled: true });
  const fresh = await getFreshness(loaded);
  if (!fresh.latestDate) return null;
  const asOf = alertAsOf(fresh.latestDate);
  const from = addDaysIso(asOf, -lookbackDays);
  return { loaded, asOf, from, ds: await loadDataset(loaded, from, asOf) };
}

export interface MetricChoice { key: string; label: string; kind: "kpi" | "anomaly"; unit?: string; direction?: string; target?: number | null; available: boolean }

/** Every key a rule may use for this process: the category profile's KPIs + table columns, plus the anomaly types. */
export async function metricChoices(loaded: Loaded): Promise<MetricChoice[]> {
  const p = profileFor(loaded.cfg.category);
  const targets = await loadTargets(loaded.cfg.processId);
  const seen = new Set<string>(); const out: MetricChoice[] = [];
  for (const key of [...(p?.kpis ?? []), ...(p?.columns ?? [])]) {
    const d = METRIC_BY_KEY.get(key); if (!d || seen.has(key)) continue; seen.add(key);
    out.push({ key, label: d.label, kind: "kpi", unit: d.unit, direction: d.direction, target: targets[key] ?? null, available: metricAvailable(key, loaded.resolved.mapped) });
  }
  const labels: Record<string, string> = { login_drop: "Login drop (agents)", aht_spike: "AHT spike (agents)", qa_fatal: "Fatal QA audit (agents)", zero_calls_while_logged_in: "Zero calls while logged in (agents)" };
  for (const t of ANOMALY_TYPES) out.push({ key: `${ANOMALY_PREFIX}${t}`, label: labels[t], kind: "anomaly", available: true });
  out.push({ key: `${ANOMALY_PREFIX}any`, label: "Any agent anomaly", kind: "anomaly", available: true });
  return out;
}

const agentsOf = (rows: NormRow[]): Set<string> => new Set(rows.map((r) => r.agent_code));
const qaFor = (qa: QaBucket[], agents: Set<string>): QaBucket[] => qa.filter((q) => agents.has(q.agentCode));

/** Scope-filtered rows + their QA, exactly as the overview filters them. */
export function scopedData(ds: Dataset, f: Filters): { rows: NormRow[]; qa: QaBucket[] } {
  const rows = applyFilters(ds.rows, f);
  return { rows, qa: qaFor(ds.qa, agentsOf(rows)) };
}

/** Value of `metricKey` for each of `dates`, aggregated over the trailing `windowDays` ending that day; null where the window has no rows or the metric is not available. */
export function metricSeries(rows: NormRow[], qa: QaBucket[], mapped: ReadonlySet<string>, metricKey: string, windowDays: number, dates: readonly string[]): DayValue[] {
  if (!METRIC_BY_KEY.has(metricKey) || !metricAvailable(metricKey, mapped)) return dates.map((date) => ({ date, value: null }));
  const w = Math.max(1, Math.floor(windowDays));
  const rowsByDate = new Map<string, NormRow[]>(); const qaByDate = new Map<string, QaBucket[]>();
  for (const r of rows) { const a = rowsByDate.get(r.date); if (a) a.push(r); else rowsByDate.set(r.date, [r]); }
  for (const q of qa) { const a = qaByDate.get(q.date); if (a) a.push(q); else qaByDate.set(q.date, [q]); }
  return dates.map((date) => {
    const r: NormRow[] = []; const q: QaBucket[] = [];
    for (let i = 0; i < w; i++) { const d = addDaysIso(date, -i); const rr = rowsByDate.get(d); if (rr) r.push(...rr); const qq = qaByDate.get(d); if (qq) q.push(...qq); }
    if (!r.length) return { date, value: null };
    const v = computeMetrics(totalAcc(r, q))[metricKey];
    return { date, value: v === undefined || v === null || !Number.isFinite(v) ? null : v };
  });
}

/** Anomalies detected as of `asOf` (the same detector the overview panel uses), filtered to the rule's type. null when the day has no rows at all. */
export function anomaliesAt(rows: NormRow[], qa: QaBucket[], asOf: string, metricKey: string): { count: number | null; items: Anomaly[] } {
  if (!rows.some((r) => r.date === asOf)) return { count: null, items: [] };
  const type = anomalyTypeOf(metricKey);
  const items = detectAnomalies(rows, qa, asOf, 1000).filter((a) => a.date === asOf && (type === "any" || a.type === type));
  return { count: items.length, items };
}

/** Calendar days ending on `asOf`, oldest first. */
export const lastDates = (asOf: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDaysIso(asOf, -(n - 1 - i)));

export { isAnomalyKey };
