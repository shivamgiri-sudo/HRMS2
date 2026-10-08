/**
 * Insight thresholds from he_model_param rows under "insight.*" (the owner tunes them with an admin upsert; learnMatchWeights deletes only
 * "match.*" and setPlanRequisitions only "plan.req.*", so these survive). Missing table, rows or bad values fall back to the code defaults.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { INSIGHT_DEFAULTS, type InsightKey, type InsightThresholds } from "./he-drive-insights.js";

const DECIMAL = /^\d+(\.\d+)?$/;

export async function loadInsightThresholds(): Promise<InsightThresholds> {
  const t: InsightThresholds = { ...INSIGHT_DEFAULTS };
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'insight.%'");
    for (const r of rows ?? []) {
      const key = String(r.param_key);
      if (!Object.prototype.hasOwnProperty.call(INSIGHT_DEFAULTS, key) || r.value === null || r.value === undefined || r.value === "") continue;
      const raw = String(r.value).trim();
      if (!DECIMAL.test(raw)) continue; // Number() would accept "0x10", "1e2", "Infinity" and "" (as 0)
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 0 && v <= 1000) t[key as InsightKey] = v;
    }
  } catch (err) {
    logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-insight-params] read failed, using defaults");
    return { ...INSIGHT_DEFAULTS };
  }
  return t;
}
