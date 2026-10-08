/** Process Dashboard forecast -- loads rows/targets/holidays for a month and hands them to the pure assembler. Read-only, cached like the overview. */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { logger } from "../../../logger.js";
import { smallCache } from "../pd.cache.js";
import { loadTargets } from "../pd.config.service.js";
import { daysBetween, getFreshness, loadDataset, localIso, type Loaded } from "../pd.dataset.js";
import { PdError } from "../pd.source.js";
import { availableMetrics } from "../pd.metrics.js";
import { profileFor } from "../pd.fields.js";
import { effectiveRankMetric, filtersOf, type RangeQuery } from "../pd.service.js";
import { assembleForecast, forecastWindow, type ForecastPayload } from "./fc.assemble.js";
import { isMonth, monthBounds } from "./fc.calendar.js";

/**
 * Company-wide holidays only: active, for no branch or the process's branch, and mapped to no cost centre / designation. A holiday scoped to a
 * subset of staff cannot be attributed to a whole process, so it is left out (documented; the observed calendar still catches closures).
 */
export async function loadHolidays(processId: string, from: string, to: string): Promise<string[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT DATE_FORMAT(h.holiday_date, '%Y-%m-%d') AS d FROM leave_holiday_master h
        WHERE h.holiday_date BETWEEN ? AND ? AND h.active_status = 1
          AND (h.branch_id IS NULL OR h.branch_id = (SELECT p.branch_id FROM process_master p WHERE p.id = ?))
          AND NOT EXISTS (SELECT 1 FROM holiday_cost_centre_mapping m WHERE m.holiday_id = h.id)
          AND NOT EXISTS (SELECT 1 FROM holiday_designation_mapping m2 WHERE m2.holiday_id = h.id) LIMIT 400`, [from, to, processId]);
    return rows.map((r) => String(r.d));
  } catch (err) { logger.warn({ err, processId }, "[process-dashboard] holiday lookup failed; calendar inferred from data only"); return []; }
}

export interface ForecastQuery extends RangeQuery { month?: unknown }

export async function getForecast(l: Loaded, q: ForecastQuery, today: string = localIso()): Promise<ForecastPayload> {
  const f = filtersOf(q);
  const fresh = await getFreshness(l);
  const raw = typeof q.month === "string" ? q.month.trim() : "";
  if (raw && !isMonth(raw)) throw new PdError(400, "BAD_MONTH", "month must be YYYY-MM");
  const month = raw || (fresh.latestDate && fresh.latestDate < today ? fresh.latestDate.slice(0, 7) : today.slice(0, 7));
  if (month > today.slice(0, 7)) throw new PdError(400, "BAD_MONTH", "A month that has not started cannot be forecast");
  const mb = monthBounds(month);
  const key = `${l.cfg.processId}|fc|${l.cfg.updatedAt}|${month}|${today}|${fresh.latestDate ?? ""}|${f.tl ?? ""}|${f.lob ?? ""}`;
  return smallCache.wrap(key, async () => {
    const profile = profileFor(l.cfg.category);
    if (!profile) throw new PdError(409, "NOT_CONFIGURED", "No category profile");
    const rankMetric = effectiveRankMetric(profile, l.resolved.mapped);
    // Window: the 8 weeks before the cutoff, through today (today's partial rows are read only to be reported, never counted).
    const { loadFrom: from, loadTo: hi } = forecastWindow(month, today, fresh.latestDate);
    if (daysBetween(from, hi) > 800) throw new PdError(400, "RANGE_TOO_LARGE", "Window too large");
    const [ds, targets, holidays] = await Promise.all([loadDataset(l, from, hi), loadTargets(l.cfg.processId), loadHolidays(l.cfg.processId, from, mb.last)]);
    const out = assembleForecast({ month, today, latestDate: fresh.latestDate, rows: ds.rows, qa: ds.qa, holidays, kpiKeys: profile.kpis,
      available: availableMetrics(l.resolved.mapped), targets, rankMetric, filters: f });
    if (ds.truncated) out.warnings.push("Source rows exceeded the read limit; figures may be partial.");
    return out;
  });
}
