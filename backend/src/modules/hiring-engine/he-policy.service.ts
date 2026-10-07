/**
 * Outreach policy the owner can change without a deploy. Stored in he_model_param under "policy.*" (the nightly learning jobs only
 * rewrite "show.*" and "match.*", so these survive them).
 *   policy.cooling_off_days : days before someone rejected in a process can be lined up for it again. 90 by default; 0 switches
 *                             the cooling-off off (permanent blocks such as hard rejections, ex-employees, joined and opted-out stay).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { REJECT_COOLING_DAYS } from "./he-eligibility.js";

const KEY = "policy.cooling_off_days";

export async function getCoolingOffDays(): Promise<number> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = ? LIMIT 1", [KEY]);
  const v = r[0] ? Number(r[0].value) : REJECT_COOLING_DAYS;
  return Number.isFinite(v) && v >= 0 && v <= 365 ? Math.round(v) : REJECT_COOLING_DAYS;
}

export async function setCoolingOffDays(days: number): Promise<number> {
  if (!Number.isFinite(days) || days < 0 || days > 365) throw Object.assign(new Error("Cooling-off must be between 0 and 365 days."), { statusCode: 400 });
  const d = Math.round(days);
  await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?,?,0) ON DUPLICATE KEY UPDATE value = VALUES(value)", [KEY, d]);
  return d;
}
