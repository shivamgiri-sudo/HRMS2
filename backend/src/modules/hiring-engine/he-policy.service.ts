/**
 * Outreach policy the owner can change without a deploy. Stored in he_model_param under "policy.*" (the nightly learning jobs only
 * rewrite "show.*" and "match.*", so these survive them).
 *   policy.whatsapp_requires_optin : 1 = only message people who ticked WhatsApp; 0 (the default, owner decision 2026-10-07) = message qualified
 *                             candidates about their own application without an opt-in. A STOP / revoked consent is ALWAYS honoured. Live location
 *                             always needs the candidate's own tap, whatever this is set to.
 *   policy.cooling_off_days : days before someone rejected in a process can be lined up for it again. 90 by default; 0 switches
 *                             the cooling-off off (permanent blocks such as hard rejections, ex-employees, joined and opted-out stay).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { REJECT_COOLING_DAYS } from "./he-eligibility.js";
import { DEFAULT_DAILY_PLAN, type DailyPlan } from "./he-slots.js";

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

const OPTIN_KEY = "policy.whatsapp_requires_optin";
export async function whatsappRequiresOptIn(): Promise<boolean> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = ? LIMIT 1", [OPTIN_KEY]);
  return r[0] ? Number(r[0].value) === 1 : false;
}
export async function setWhatsappRequiresOptIn(on: boolean): Promise<boolean> {
  await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?,?,0) ON DUPLICATE KEY UPDATE value = VALUES(value)", [OPTIN_KEY, on ? 1 : 0]);
  return on;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (v: string) => { const [h, m] = v.split(":").map(Number); return h * 60 + (m || 0); };

/** The daily outreach plan: walk-ins wanted, minimum people messaged, show-up rate and the day's slot hours. */
export async function getDailyPlan(): Promise<DailyPlan> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'policy.plan_%'");
  const m = new Map(r.map((x) => [String(x.param_key), Number(x.value)]));
  const d = DEFAULT_DAILY_PLAN;
  return {
    walkInsPerDay: m.get("policy.plan_walkins") ?? d.walkInsPerDay, minOutreachPerDay: m.get("policy.plan_min_outreach") ?? d.minOutreachPerDay,
    showRatePct: m.get("policy.plan_show_rate") ?? d.showRatePct, slotStart: m.has("policy.plan_slot_start") ? hhmm(m.get("policy.plan_slot_start")!) : d.slotStart,
    slotEnd: m.has("policy.plan_slot_end") ? hhmm(m.get("policy.plan_slot_end")!) : d.slotEnd, slotMinutes: m.get("policy.plan_slot_min") ?? d.slotMinutes,
  };
}

export async function setDailyPlan(p: Partial<DailyPlan>): Promise<DailyPlan> {
  const cur = await getDailyPlan(); const n = { ...cur, ...p };
  const bad = (m: string) => Object.assign(new Error(m), { statusCode: 400 });
  if (!(n.walkInsPerDay >= 1 && n.walkInsPerDay <= 1000)) throw bad("Walk-ins per day must be between 1 and 1000.");
  if (!(n.minOutreachPerDay >= 0 && n.minOutreachPerDay <= 5000)) throw bad("People messaged per day must be between 0 and 5000.");
  if (!(n.showRatePct >= 5 && n.showRatePct <= 100)) throw bad("Show-up rate must be between 5 and 100 percent.");
  if (!/^\d{2}:\d{2}$/.test(n.slotStart) || !/^\d{2}:\d{2}$/.test(n.slotEnd) || toMin(n.slotEnd) <= toMin(n.slotStart)) throw bad("The last slot must end after the first slot starts.");
  if (![15, 30, 60].includes(Number(n.slotMinutes))) throw bad("Slots can be 15, 30 or 60 minutes.");
  const rows: Array<[string, number]> = [["policy.plan_walkins", Math.round(n.walkInsPerDay)], ["policy.plan_min_outreach", Math.round(n.minOutreachPerDay)], ["policy.plan_show_rate", Math.round(n.showRatePct)],
    ["policy.plan_slot_start", toMin(n.slotStart)], ["policy.plan_slot_end", toMin(n.slotEnd)], ["policy.plan_slot_min", Number(n.slotMinutes)]];
  for (const [k, v] of rows) await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?,?,0) ON DUPLICATE KEY UPDATE value = VALUES(value)", [k, v]);
  return getDailyPlan();
}

/** Requisitions on the daily plan (one he_model_param row each: plan.req.<requisition id>). */
export async function getPlanRequisitions(): Promise<string[]> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT param_key FROM he_model_param WHERE param_key LIKE 'plan.req.%' AND value = 1");
  return r.map((x) => String(x.param_key).slice("plan.req.".length));
}
export async function setPlanRequisitions(ids: string[]): Promise<string[]> {
  const clean = [...new Set(ids.map(String).filter((x) => /^[A-Za-z0-9_-]{1,60}$/.test(x)))].slice(0, 200);
  await db.execute("DELETE FROM he_model_param WHERE param_key LIKE 'plan.req.%'");
  for (const id of clean) await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?,1,0)", [`plan.req.${id}`]);
  return clean;
}

const AUTO_KEY = "policy.engine_auto";
const TICK_KEY = "policy.engine_last_tick";
/** Automatic follow-ups: the screen switch (default OFF until the owner turns it on). The HE_ENGINE_ENABLED/LIVE environment flags still work. */
export async function engineAutoOn(): Promise<boolean> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = ? LIMIT 1", [AUTO_KEY]);
  return r[0] ? Number(r[0].value) === 1 : false;
}
export async function setEngineAuto(on: boolean): Promise<boolean> {
  await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?,?,0) ON DUPLICATE KEY UPDATE value = VALUES(value)", [AUTO_KEY, on ? 1 : 0]);
  return on;
}
/** Unix seconds of the last automatic run (kept in the integer `sample` column). */
export async function recordEngineTick(): Promise<void> {
  await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?,0,?) ON DUPLICATE KEY UPDATE sample = VALUES(sample)", [TICK_KEY, Math.floor(Date.now() / 1000)]);
}
export async function lastEngineTick(): Promise<string | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT sample FROM he_model_param WHERE param_key = ? LIMIT 1", [TICK_KEY]);
  return r[0] && Number(r[0].sample) > 0 ? new Date(Number(r[0].sample) * 1000).toISOString() : null;
}

/** What the scheduler does this run: nothing, a logged dry run, or the real thing. Pure so it is testable. */
export function engineMode(env: NodeJS.ProcessEnv, autoOn: boolean): "off" | "dry" | "live" {
  if (env.HE_ENGINE_ENABLED === "true") return env.HE_ENGINE_LIVE === "true" ? "live" : autoOn ? "live" : "dry";
  return autoOn ? "live" : "off";
}
