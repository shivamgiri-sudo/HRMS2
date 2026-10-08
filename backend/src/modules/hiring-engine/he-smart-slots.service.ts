/** Preference reads for the smart slot chooser (HE_SMART_SLOTS). Never throw: any failure reads as "no preference". */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { etaMinutes } from "./he-eta.js";
import type { SlotPrefs } from "./he-smart-slots.js";

const NONE: SlotPrefs = { bestHourIst: null, etaMin: null, distanceKm: null };
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

async function bestHour(leadId: string): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT best_hour_ist FROM he_lead_insight WHERE lead_id = ? LIMIT 1", [leadId]);
  return num(rows?.[0]?.best_hour_ist);
}

export async function readMetaLeadPrefs(metaLeadId: string): Promise<SlotPrefs> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT lc.lead_id FROM he_lead_campaign lc WHERE lc.meta_lead_id = ? LIMIT 1", [metaLeadId]);
    const leadId = rows?.[0]?.lead_id;
    if (!leadId) return { ...NONE };
    return { ...NONE, bestHourIst: await bestHour(String(leadId)) };
  } catch {
    return { ...NONE };
  }
}

export async function readMatchPrefs(matchId: string): Promise<SlotPrefs> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT lead_id, distance_km FROM he_match WHERE id = ? LIMIT 1", [matchId]);
    const m = rows?.[0];
    if (!m) return { ...NONE };
    const distanceKm = num(m.distance_km);
    return { bestHourIst: await bestHour(String(m.lead_id)), etaMin: distanceKm == null ? null : etaMinutes(distanceKm), distanceKm };
  } catch {
    return { ...NONE };
  }
}
