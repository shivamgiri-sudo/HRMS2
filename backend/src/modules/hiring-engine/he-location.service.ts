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
import { recordInviteAnswer, recordInviteStop, type InviteAnswer } from "./he-ingest.service.js";
import { DEMO_TOKEN as SHARED_DEMO_TOKEN, TOKEN_RE as SHARED_TOKEN_RE } from "./he-email-parts.js";
import { requisitionClosedReason } from "../meta-campaign/lead-screener.service.js";
import { resolveAnswerToken } from "./walkin-invite.service.js";
import { answerInviteToken } from "./walkin-invite-answer.service.js";

export const LOCATION_TEXT_VERSION = "location_v1";
const TOKEN_RE = SHARED_TOKEN_RE;

/**
 * Sample-email links point at this fixed token. It serves a fake candidate ("Rahul") so HR can click through the real candidate
 * page from the test emails; every action on it is accepted and thrown away (no lead, no match, nothing written).
 */
export const DEMO_TOKEN = SHARED_DEMO_TOKEN;
export function demoContext(): LocationContext {
  const d = new Date(Date.now() + 86_400_000 + 5.5 * 3600_000);
  return {
    matchId: "demo", leadId: "demo", firstName: "Rahul", branchName: "Noida Sector 62", address: "Trapezoid IT Park, 1st Floor, C-27, Sector 62, Noida - 201309",
    branchLat: 28.627, branchLng: 77.3649, slotAt: `${d.toISOString().slice(0, 10)} 11:00:00`, state: "invited", open: true, sharing: false, waConsent: false, optInOpen: true,
    role: "Customer Success Executive", reference: "HE-SAMPLE", mapsUrl: "https://maps.google.com/?q=28.627,77.3649", docs: String(process.env.HE_DOCS_LIST?.trim() || "Aadhaar, PAN, 12th marksheet").split(/\s*,\s*/).filter(Boolean), rsvpOpen: true,
  };
}

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
  if (token === DEMO_TOKEN) return demoContext();
  const byToken = await matchContext("m.token", token);
  if (byToken) return byToken;
  // An invite token whose Yes / another time booked a match keeps working as that match (location sharing on the day, change answer).
  const t = await resolveAnswerToken(token);
  return t.kind === "match" ? matchContext("m.id", t.matchId) : null;
}

async function matchContext(col: "m.token" | "m.id", value: string): Promise<LocationContext | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.state, m.slot_at, l.full_name, jr.branch_name, jr.designation_name,
            ((m.state IN ('invited','confirmed','declined','slot_released') AND m.slot_at IS NOT NULL AND NOW() < m.slot_at) OR (m.state = 'no_show' AND m.slot_at > DATE_SUB(NOW(), INTERVAL 7 DAY))) AS rsvp_open, bm.address, bm.latitude, bm.longitude,
            (m.state IN ('invited','confirmed') AND m.slot_at IS NOT NULL
              AND NOW() BETWEEN DATE_SUB(m.slot_at, INTERVAL 6 HOUR) AND DATE_ADD(m.slot_at, INTERVAL 3 HOUR)) AS is_open,
            (m.state IN ('suggested','invited','confirmed') AND (m.slot_at IS NULL OR NOW() < DATE_ADD(m.slot_at, INTERVAL 3 HOUR))) AS optin_open, l.status AS lead_status
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id JOIN job_requisition jr ON jr.id = m.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE ${col} = ? LIMIT 1`, [value]);
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
  if (token === DEMO_TOKEN) return true;
  const c = await getContextByToken(token);
  if (!c || !c.open) return false;
  await grantConsent(c.leadId, "location", LOCATION_TEXT_VERSION, "wa_link");
  await addEvent(c.leadId, "location_consent_granted", { channel: "web" });
  return true;
}

export async function stopSharing(token: string): Promise<boolean> {
  if (token === DEMO_TOKEN) return true;
  const c = await getContextByToken(token);
  if (!c) return false;
  await revokeConsent(c.leadId, "location");
  await addEvent(c.leadId, "location_consent_revoked", { channel: "web" });
  return true;
}

export type PingResult = { ok: true; distanceKm: number | null; etaMin: number | null; arrived: boolean } | { ok: false; reason: "invalid_token" | "closed" | "no_consent" | "bad_coordinates" | "too_frequent" };

export async function recordPing(token: string, lat: unknown, lng: unknown, accuracyM?: unknown): Promise<PingResult> {
  if (token === DEMO_TOKEN) return { ok: true, distanceKm: 3.2, etaMin: 12, arrived: false };
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
  if (token === DEMO_TOKEN) return "granted";
  const c = await getContextByToken(token);
  if (!c) return "invalid";
  if (c.waConsent) return "already";
  if (!c.optInOpen) return "closed";
  await grantConsent(c.leadId, "whatsapp_contact", WA_OPTIN_TEXT_VERSION, "web_link");
  await addEvent(c.leadId, "whatsapp_consent_granted", { channel: "web", detail: "invitation page" });
  return "granted";
}

export interface InviteContext {
  kind: "invite"; firstName: string; role: string | null; branchName: string; address: string | null; mapsUrl: string | null; slotAt: string | null;
  reference: string; docs: string[]; state: string; rsvpOpen: boolean; closedReason: string | null;
  /** No live location or WhatsApp opt-in before a match exists (both need a booked slot). */
  open: false; sharing: false; optInOpen: false; waConsent: false;
}
const INVITE_STATE: Record<string, string> = { sent: "invited", answered_yes: "invited", answered_later: "slot_released", declined: "declined", stopped: "stopped", superseded: "invited" };

/** The page for a person invited without an he_match: first name, role, branch and slot only (never the mobile or email). */
export async function getInviteContext(token: string): Promise<InviteContext | null> {
  if (!TOKEN_RE.test(token) || token === DEMO_TOKEN) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.id, wi.state, wi.slot_at, wi.branch_name, (wi.slot_at IS NULL OR NOW() < wi.slot_at) AS before_slot,
            jr.designation_name, jr.branch_name AS jr_branch, jr.approval_status, jr.active_status, jr.closed_at, jr.requested_headcount, jr.fulfilled_headcount,
            bm.address, bm.latitude, bm.longitude, COALESCE(l.full_name, r.parsed_name) AS full_name, l.status AS lead_status
       FROM walkin_invite wi
       LEFT JOIN job_requisition jr ON jr.id = wi.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = COALESCE(wi.branch_name, jr.branch_name) AND bm.active_status = 1
       LEFT JOIN he_lead l ON l.mobile10 = wi.mobile10
       LEFT JOIN meta_lead_raw r ON r.id = wi.meta_lead_id COLLATE utf8mb4_unicode_ci
      WHERE wi.token = ? LIMIT 1`, [token]);
  const r = rows[0];
  if (!r) return null;
  const closed = r.jr_branch == null ? "requisition not found" : requisitionClosedReason({
    approvalStatus: r.approval_status ?? null, activeStatus: r.active_status ?? null, closedAt: r.closed_at ?? null,
    requestedHeadcount: r.requested_headcount != null ? Number(r.requested_headcount) : null, fulfilledHeadcount: r.fulfilled_headcount != null ? Number(r.fulfilled_headcount) : null,
  }) ?? (String(r.approval_status ?? "").toLowerCase() === "approved" ? null : "not approved");
  const state = INVITE_STATE[String(r.state)] ?? "invited";
  return {
    kind: "invite", firstName: displayFirstName(r.full_name), role: (r.designation_name as string | null) ?? null, branchName: String(r.branch_name ?? r.jr_branch ?? ""),
    address: (r.address as string | null) ?? null,
    mapsUrl: r.latitude != null && r.longitude != null ? `https://maps.google.com/?q=${r.latitude},${r.longitude}` : r.address ? `https://maps.google.com/?q=${encodeURIComponent(String(r.address))}` : null,
    slotAt: r.slot_at ? String(r.slot_at) : null, reference: `HE-${String(r.id).replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    docs: String(process.env.HE_DOCS_LIST?.trim() || "Aadhaar, PAN, 12th marksheet").split(/\s*,\s*/).filter(Boolean), state,
    rsvpOpen: !closed && Number(r.before_slot) === 1 && (r.state === "sent" || r.state === "answered_later" || r.state === "answered_yes") && r.lead_status !== "opted_out",
    closedReason: closed ? "This opening is closed" : null,
    open: false, sharing: false, optInOpen: false, waConsent: false,
  };
}

export type PublicAnswer = InviteAnswer | "stop";
export type AnswerResult = { ok: true; state: string; matchToken?: string } | { ok: false; reason: "invalid" | "closed" | "bad_answer" };

/**
 * Candidate answered the invitation (Yes / Cannot come / Another time / Stop messages) on their invitation page. Match tokens keep
 * today's path; invite tokens book through answerInviteToken and return the new match token. Stop is accepted after the slot too.
 */
export async function answerInvite(token: string, answer: unknown): Promise<AnswerResult> {
  if (answer !== "yes" && answer !== "no" && answer !== "later" && answer !== "stop") return { ok: false, reason: "bad_answer" };
  if (token === DEMO_TOKEN) return { ok: true, state: answer === "yes" ? "confirmed" : answer === "no" ? "declined" : answer === "stop" ? "stopped" : "slot_released" };
  const c = await getContextByToken(token);
  if (c) {
    if (answer === "stop") return { ok: true, state: (await recordInviteStop(c.matchId))?.state ?? "stopped" };
    if (!c.rsvpOpen) return { ok: false, reason: "closed" };
    const r = await recordInviteAnswer(c.matchId, answer as InviteAnswer);
    return r ? { ok: true, state: r.state } : { ok: false, reason: "invalid" };
  }
  const t = await resolveAnswerToken(token);
  if (t.kind !== "invite") return { ok: false, reason: "invalid" };
  const ic = await getInviteContext(token);
  if (!ic) return { ok: false, reason: "invalid" };
  if (answer !== "stop" && !ic.rsvpOpen) return { ok: false, reason: "closed" };
  const r = await answerInviteToken(t.invite, answer, { now: new Date(), channel: "web" });
  return r.matchToken ? { ok: true, state: r.state, matchToken: r.matchToken } : { ok: true, state: r.state };
}
