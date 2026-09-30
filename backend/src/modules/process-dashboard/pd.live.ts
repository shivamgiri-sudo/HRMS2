/** Process Dashboard -- live "today so far vs same-weekday baseline", change detection (etag) and CSV export. */
import { createHash } from "node:crypto";
import type { Response } from "express";
import { addDays } from "./pd.anomalies.js";
import { METRIC_BY_KEY, METRICS } from "./pd.fields.js";
import { addRow, computeMetrics, emptyAcc, kpiStatus, pctDelta, totalAcc, type Metrics, type NormRow } from "./pd.metrics.js";
import { smallCache } from "./pd.cache.js";
import { loadTargets } from "./pd.config.service.js";
import { PdError, readDayFingerprint } from "./pd.source.js";
import { applyFilters, getFreshness, inRange, loadDataset, localIso, resolveRange, cfgStamp, type Loaded } from "./pd.dataset.js";
import { byDate, categoryProfileOut, filtersOf, getAgents, type RangeQuery } from "./pd.service.js";

export const BASELINE_WEEKS = 4;
const ADDITIVE = new Set(["count", "hours", "currency"]);

export async function liveEtag(l: Loaded, date = localIso()): Promise<string> {
  const fp = await smallCache.wrap(`${l.cfg.processId}|fp|${cfgStamp(l.cfg)}|${date}`, () => readDayFingerprint(l.resolved, date));
  return createHash("sha1").update(`${fp}|${cfgStamp(l.cfg)}|${l.cfg.category}|${date}`).digest("hex").slice(0, 16);
}

/** Mean of per-day values for additive metrics (volumes), pooled value for ratios. */
function baselineMetrics(rows: NormRow[], dates: string[]): Metrics {
  const perDay = dates.map((d) => computeMetrics(totalAcc(rows.filter((r) => r.date === d), [])));
  const pooled = computeMetrics(totalAcc(rows, []));
  const out: Metrics = {};
  for (const m of METRICS) {
    if (ADDITIVE.has(m.unit)) {
      const vals = perDay.map((p) => p[m.key]).filter((v): v is number => v !== null);
      out[m.key] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    } else out[m.key] = pooled[m.key] ?? null;
  }
  out.agents = perDay.length ? Math.round((perDay.reduce((a, p) => a + (p.agents ?? 0), 0) / perDay.length) * 10) / 10 : null;
  return out;
}

export async function getLive(l: Loaded, q: RangeQuery & { since?: unknown }, now = new Date()) {
  const today = localIso(now);
  const etag = await liveEtag(l, today);
  if (typeof q.since === "string" && q.since === etag) return { changed: false, etag };
  const f = filtersOf(q);
  const from = addDays(today, -7 * BASELINE_WEEKS);
  const [ds, targets, fresh] = await Promise.all([loadDataset(l, from, today), loadTargets(l.cfg.processId), getFreshness(l)]);
  const hasHour = l.resolved.mapped.has("hour");
  const nowHour = now.getHours();
  const rows = applyFilters(inRange(ds.rows, from, today), f);
  const todayRows = rows.filter((r) => r.date === today);
  const baseDates = Array.from({ length: BASELINE_WEEKS }, (_, i) => addDays(today, -7 * (i + 1))).filter((d) => rows.some((r) => r.date === d));
  const basis = hasHour ? "same_hour" : "full_day";
  const baseRows = rows.filter((r) => baseDates.includes(r.date) && (!hasHour || (r.hour !== null && r.hour <= nowHour)));
  const todayM = computeMetrics(totalAcc(todayRows, ds.qa.filter((x) => x.date === today)));
  const baseM = baselineMetrics(baseRows, baseDates);
  const profile = categoryProfileOut(l, targets);
  const kpis = profile.kpis.map((k) => {
    const v = todayM[k.key] ?? null; const b = baseM[k.key] ?? null;
    // Without an hour column today-so-far is a PART day; comparing a volume with a FULL baseline day would always look like a collapse.
    const comparable = !(basis === "full_day" && ADDITIVE.has(k.unit));
    const { status, basis: sb } = kpiStatus(v, k.target, comparable ? b : null, METRIC_BY_KEY.get(k.key)!.direction);
    return { key: k.key, label: k.label, unit: k.unit, direction: k.direction, available: k.available, value: v, baseline: b, comparable, deltaPct: comparable ? pctDelta(v, b) : null, target: k.target, status, statusBasis: sb };
  });
  let hourly: Array<Record<string, number | null>> | null = null;
  if (hasHour) {
    const h = new Map<number, ReturnType<typeof emptyAcc>>();
    for (const r of todayRows) if (r.hour !== null) { let a = h.get(r.hour); if (!a) { a = emptyAcc(); h.set(r.hour, a); } addRow(a, r); }
    hourly = [...h.entries()].sort(([a], [b]) => a - b).map(([hour, acc]) => ({ hour, ...computeMetrics(acc) }));
  }
  return {
    changed: true, etag, date: today, asOf: now.toISOString(), refreshSeconds: l.cfg.refreshSeconds,
    hasDataToday: todayRows.length > 0, freshness: { lastDataAt: fresh.lastDataAt, latestDate: fresh.latestDate, rows: todayRows.length },
    today: { metrics: todayM }, baseline: { basis, weeks: BASELINE_WEEKS, dates: baseDates, metrics: baseM },
    deltasPct: Object.fromEntries(METRICS.map((m) => [m.key, basis === "full_day" && ADDITIVE.has(m.unit) ? null : pctDelta(todayM[m.key] ?? null, baseM[m.key] ?? null)])),
    kpis, hourly, categoryProfile: profile,
  };
}

/* ---------- CSV ---------- */

/** Spreadsheet-injection guard for text cells; numbers pass through untouched. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function streamCsv(l: Loaded, res: Response, view: string, q: RangeQuery): Promise<void> {
  if (view !== "agents" && view !== "daily") throw new PdError(400, "BAD_VIEW", "view must be agents or daily");
  const f = filtersOf(q);
  const fresh = await getFreshness(l); const { from, to } = resolveRange(q, fresh);
  let header: string[]; let lines: Array<Array<unknown>>;
  if (view === "agents") {
    const rows = (await getAgents(l, { ...q, limit: 100000, sort: "rank" }, 100000)).rows;
    header = ["rank", "agent_code", "name", "tl", "lob", "days", ...METRICS.map((m) => m.key), "audits", "fatal"];
    lines = rows.map((r) => [r.rank, r.agentCode, r.name, r.tl, r.lob, r.days, ...METRICS.map((m) => (r as Record<string, unknown>)[m.key]), r.audits, r.fatal]);
  } else {
    const ds = await loadDataset(l, from, to);
    const rows = applyFilters(inRange(ds.rows, from, to), f);
    const days = byDate(rows, inRange(ds.qa, from, to));
    header = ["date", "agents", ...METRICS.map((x) => x.key)];
    lines = days.map((c) => [c.date, c.agents, ...METRICS.map((x) => c[x.key])]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="process-dashboard-${view}-${from}_${to}.csv"`);
  res.write(`${header.join(",")}\n`);
  for (let i = 0; i < lines.length; i += 200) res.write(`${lines.slice(i, i + 200).map((r) => r.map(csvCell).join(",")).join("\n")}\n`);
  res.end();
}
