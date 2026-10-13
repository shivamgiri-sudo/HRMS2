/**
 * The Live Meta cutoff (he-source-attribution.ts). Default: ROLLING, 00:00 IST of the IST day (today - 7 days), so it moves with the date
 * on its own. Overrides in he_model_param (value is DECIMAL(8,4), so a day lives in the key, the plan.req.<id> pattern):
 *   - meta.live_days = N: N days instead of 7 (a whole number 0..365; anything else means 7);
 *   - meta.live_mode = 1: 'fixed' mode, the latest 'meta.live_from.YYYY-MM-DD' row with value 1 is the cutoff (no such row: rolling).
 *     Without meta.live_mode = 1 the meta.live_from.* rows are ignored.
 * The param rows are cached 60 s; the day is computed from the clock on EVERY call, so the cutoff moves at midnight IST even inside a
 * cache period. A missing table, no row or an invalid value means the rolling 7 days. Never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { LIVE_DAYS_PARAM, LIVE_FROM_PARAM, LIVE_MODE_PARAM, resolveLiveWindow, type LiveWindow } from "./he-source-attribution.js";

const CACHE_MS = 60_000;
interface LiveParams { liveDays?: unknown; liveMode?: unknown; fixedDays: string[] }
let cached: { at: number; params: LiveParams } | null = null;

export function clearLiveFromCache(): void { cached = null; }

async function readParams(): Promise<LiveParams> {
  const out: LiveParams = { fixedDays: [] };
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key IN (?, ?) OR param_key LIKE ?",
      [LIVE_DAYS_PARAM, LIVE_MODE_PARAM, `${LIVE_FROM_PARAM}.%`]);
    for (const r of rows ?? []) {
      const key = String(r.param_key ?? "");
      if (key === LIVE_DAYS_PARAM) out.liveDays = r.value;
      else if (key === LIVE_MODE_PARAM) out.liveMode = r.value;
      else if (key.startsWith(`${LIVE_FROM_PARAM}.`) && Number(r.value) === 1) out.fixedDays.push(key.slice(LIVE_FROM_PARAM.length + 1));
    }
  } catch (err) {
    logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-source-attribution] cutoff read failed, using the rolling default");
  }
  return out;
}

/** The cutoff at `now` with how it was set (rolling N days, or a fixed day). */
export async function loadLiveWindow(now: Date = new Date()): Promise<LiveWindow> {
  const t = now.getTime();
  if (!cached || t < cached.at || t - cached.at >= CACHE_MS) cached = { at: t, params: await readParams() };
  return resolveLiveWindow(cached.params, now);
}

/** The cutoff day 'YYYY-MM-DD' at `now`. */
export async function loadLiveFrom(now: Date = new Date()): Promise<string> {
  return (await loadLiveWindow(now)).liveFrom;
}
