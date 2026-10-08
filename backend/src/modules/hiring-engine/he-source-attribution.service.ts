/**
 * The Live Meta cutoff day from he_model_param, so the owner can move it without a deploy. he_model_param.value is DECIMAL(8,4) and cannot
 * hold a date, so the day is in the key (the plan.req.<id> pattern): a row 'meta.live_from.YYYY-MM-DD' with value 1 sets it; with several
 * such rows the latest day wins. Cached 60 s; a missing table, no row or an invalid day means LIVE_FROM_DEFAULT. Never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { LIVE_FROM_DEFAULT, LIVE_FROM_PARAM, validDay } from "./he-source-attribution.js";

const CACHE_MS = 60_000;
let cached: { at: number; value: string } | null = null;

export function clearLiveFromCache(): void { cached = null; }

export async function loadLiveFrom(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value = LIVE_FROM_DEFAULT;
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT param_key FROM he_model_param WHERE param_key LIKE ? AND value = 1", [`${LIVE_FROM_PARAM}.%`]);
    const days = (rows ?? []).map((r) => validDay(String(r.param_key ?? "").slice(LIVE_FROM_PARAM.length + 1))).filter((d): d is string => !!d).sort();
    if (days.length) value = days[days.length - 1];
  } catch (err) {
    logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-source-attribution] cutoff read failed, using the default");
  }
  cached = { at: Date.now(), value };
  return value;
}
