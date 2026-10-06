/**
 * Consented live location for a walk-in. The candidate opens a tokenised link, explicitly agrees, and the page
 * posts coordinates while it is open. Every ping needs ACTIVE location consent (recorded when they tap
 * "Share"), is distance/ETA-checked against the branch, and stops mattering once they arrive or revoke.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { addEvent, grantConsent, hasConsent, revokeConsent } from "./he-lead.service.js";
import { ARRIVAL_RADIUS_KM, etaMinutes, haversineKm, isValidCoord } from "./he-eta.js";
import { displayFirstName } from "./he-name.js";
import { recordInviteAnswer, type InviteAnswer } from "./he-ingest.service.js";

export const LOCATION_TEXT_VERSION = "location_v1";
const TOKEN_RE = /^[a-f0-9]{32}$/;

export interface LocationContext {
  matchId: string; leadId: string; firstName: string; branchName: string; address: string | null;
  branchLat: number | null; branchLng: number | null; slotAt: string | null; state: string;
  open: boolean; sharing: boolean;
  /** WhatsApp updates allowed (consent on file, not revoked). */
  waConsent: boolean;
  /** Opt-in is offered while the invitation is live: until 3h after the slot. */
  optInOpen: boolean;
  role: string | null;
  /** What the candidate needs on the day, shown on the invitation page (same values as the email). */
  reference: string; mapsUrl: string | null; docs: string[];
  /** Yes / No / another time can be answered until the slot starts. */
  rsvpOpen: boolean;
}

/** Link is usable from 6h before the slot until 3h after, while the candidate is still expected. */
export async function getContextByToken(token: string): Promise<LocationContext | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.state, m.slot_at, l.full_name, jr.branch_name, jr.designation_name,
            (m.state IN ('invited','confirmed','declined','slot_released') AND m.slot_at IS NOT NULL AND NOW() < m.slot_at) AS rsvp_open, bm.address, bm.latitude, bm.longitude,
            (m.state IN ('invited','confirmed') AND m.slot_at IS NOT NULL
              AND NOW() BETWEEN DATE_SUB(m.slot_at, INTERVAL 6 HOUR) AND DATE_ADD(m.slot_at, INTERVAL 3 HOUR)) AS is_open,
            (m.state IN ('suggested','invited','confirmed') AND (m.slot_at IS NULL OR NOW() < DATE_ADD(m.slot_at, INTERVAL 3 HOUR))) AS optin_open, l.status AS lead_status
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id JOIN job_requisition jr ON jr.id = m.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE m.token = ? LIMIT 1`, [token]);
  const r = rows[0];
  if (!r) return null;
  return {
    matchId: r.id as string, leadId: r.lead_id as string, firstName: displayFirstName(r.full_name),
    branchName: r.branch_name as string, address: (r.address as string | null) ?? null,
    branchLat: r.latitude == null ? null : Number(r.latitude), branchLng: r.longitude == null ? null : Number(r.longitude),
    slotAt: r.slot_at ? String(r.slot_at) : null, state: r.state as string, open: Number(r.is_open) === 1,
    sharing: await hasConsent(r.lead_id as string, "location"),
    waConsent: await hasConsent(r.lead_id as string, "whatsapp_contact"),
    optInOpen: Number(r.optin_open) === 1 && r.lead_status !== "opted_out",
    role: (r.designation_name as string | null) ?? null,
    reference: `HE-${String(r.id).replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    mapsUrl: r.latitude != null && r.longitude != null ? `https://maps.google.com/?q=${r.latitude},${r.longitude}` : r.address ? `https://maps.google.com/?q=${encodeURIComponent(String(r.address))}` : null,
    docs: String(process.env.HE_DOCS_LIST?.trim() || "Aadhaar, PAN, 12th marksheet").split(/\s*,\s*/).filter(Boolean),
    rsvpOpen: Number(r.rsvp_open) === 1 && r.lead_status !== "opted_out",
  };
}

export async function startSharing(token: string): Promise<boolean> {
  const c = await getContextByToken(token);
  if (!c || !c.open) return false;
  await grantConsent(c.leadId, "location", LOCATION_TEXT_VERSION, "wa_link");
  await addEvent(c.leadId, "location_consent_granted", { channel: "web" });
  return true;
}

export async function stopSharing(token: string): Promise<boolean> {
  const c = await getContextByToken(token);
  if (!c) return false;
  await revokeConsent(c.leadId, "location");
  await addEvent(c.leadId, "location_consent_revoked", { channel: "web" });
  return true;
}

export type PingResult = { ok: true; distanceKm: number | null; etaMin: number | null; arrived: boolean } | { ok: false; reason: "invalid_token" | "closed" | "no_consent" | "bad_coordinates" | "too_frequent" };

export async function recordPing(token: string, lat: unknown, lng: unknown, accuracyM?: unknown): Promise<PingResult> {
  const c = await getContextByToken(token);
  if (!c) return { ok: false, reason: "invalid_token" };
  if (!c.open) return { ok: false, reason: "closed" };
  if (!c.sharing) return { ok: false, reason: "no_consent" };
  if (!isValidCoord(lat, lng)) return { ok: false, reason: "bad_coordinates" };
  const [last] = await db.execute<RowDataPacket[]>("SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS age FROM he_location_ping WHERE match_id = ?", [c.matchId]);
  if (last[0].age != null && Number(last[0].age) < 15) return { ok: false, reason: "too_frequent" };

  const distanceKm = c.branchLat != null && c.branchLng != null ? Math.round(haversineKm(lat as number, lng as number, c.branchLat, c.branchLng) * 100) / 100 : null;
  const arrived = distanceKm != null && distanceKm <= ARRIVAL_RADIUS_KM;
  const eta = distanceKm == null ? null : arrived ? 0 : etaMinutes(distanceKm);
  const acc = typeof accuracyM === "number" && Number.isFinite(accuracyM) ? Math.min(100000, Math.round(accuracyM)) : null;
  await db.execute("INSERT INTO he_location_ping (match_id, lat, lng, accuracy_m, distance_km, eta_min) VALUES (?,?,?,?,?,?)", [c.matchId, lat, lng, acc, distanceKm, eta]);
  if (arrived) await addEvent(c.leadId, "arrived_geofence", { channel: "web", detail: `${distanceKm} km from branch` });
  return { ok: true, distanceKm, etaMin: eta, arrived };
}

export const WA_OPTIN_TEXT_VERSION = "link_optin_v1";

/** Candidate tapped "Get updates on WhatsApp" on their own invitation page. Records explicit, versioned consent. */
export async function optInWhatsApp(token: string): Promise<"granted" | "already" | "closed" | "invalid"> {
  const c = await getContextByToken(token);
  if (!c) return "invalid";
  if (c.waConsent) return "already";
  if (!c.optInOpen) return "closed";
  await grantConsent(c.leadId, "whatsapp_contact", WA_OPTIN_TEXT_VERSION, "web_link");
  await addEvent(c.leadId, "whatsapp_consent_granted", { channel: "web", detail: "invitation page" });
  return "granted";
}

/** Candidate answered the invitation (Yes / Cannot come / Another time) on their invitation page. */
export async function answerInvite(token: string, answer: unknown): Promise<{ ok: true; state: string } | { ok: false; reason: "invalid" | "closed" | "bad_answer" }> {
  if (answer !== "yes" && answer !== "no" && answer !== "later") return { ok: false, reason: "bad_answer" };
  const c = await getContextByToken(token);
  if (!c) return { ok: false, reason: "invalid" };
  if (!c.rsvpOpen) return { ok: false, reason: "closed" };
  const r = await recordInviteAnswer(c.matchId, answer as InviteAnswer);
  return r ? { ok: true, state: r.state } : { ok: false, reason: "invalid" };
}
