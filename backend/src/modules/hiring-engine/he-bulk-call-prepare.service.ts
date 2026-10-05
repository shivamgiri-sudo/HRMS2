/**
 * "Prepare from Meta campaigns": builds the bulk-call sheet for the people who matter right now - qualified leads of
 * ACTIVE campaigns whose assigned interview is still in the future - instead of someone exporting and re-typing it.
 * The output is the exact seven-column row format of an uploaded file, so it flows through the same validation,
 * preview, consent confirmation and dispatch rules as a manual upload (nothing here dials anyone).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { BULK_CALL_MAX_ROWS } from "./he-bulk-call.js";

export interface PrepareOptions {
  campaignIds: string[];
  /** Include leads who already confirmed on WhatsApp. Default false: they do not need a confirmation call. */
  includeConfirmed?: boolean;
  /** Only leads whose invite was actually sent (BRD: the call follows the email/WhatsApp). Default true. */
  requireInviteSent?: boolean;
  /** Include candidates already put in a calling file in the last 18 hours. Default false, so the same person is not sent twice. */
  includeRecentlyExported?: boolean;
}

import { assignSlots } from "./he-slots.js";
import { normalizeMobile10 } from "./he-phone.js";

/** Heuristic the UI uses to pre-select the Ahmedabad (AHM) campaigns. */
export const isAhmedabad = (...parts: Array<string | null | undefined>): boolean => /ahmedabad|\bahm\b|\bahd\b|amdavad/i.test(parts.filter(Boolean).join(" "));

const FUTURE = "TIMESTAMP(ml.interview_date, ml.interview_time) > DATE_ADD(NOW(), INTERVAL 30 MINUTE)";
/** Candidates handed to the calling tool in the last 18h (event written when a file is downloaded). */
const RECENT_EXPORT = `EXISTS (SELECT 1 FROM he_lead_event ev JOIN he_lead hl ON hl.id = ev.lead_id
   WHERE ev.event_type = 'exported_for_calling' AND ev.created_at > DATE_SUB(NOW(), INTERVAL 18 HOUR)
     AND hl.mobile10 = RIGHT(REGEXP_REPLACE(ml.parsed_phone, '[^0-9]', ''), 10))`;
const OPEN_REQ = "jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.fulfilled_headcount < jr.requested_headcount";

/**
 * Campaigns HR can prepare a list from. HRMS status is not a reliable "is it live" signal (the live Ahmedabad campaign
 * sits in `draft`), so this lists active campaigns AND draft/paused ones that really have qualified candidates with a
 * future interview. Completed/archived campaigns and empty drafts stay hidden. The status is returned so it can be shown.
 */
export async function listPrepareCampaigns(): Promise<Array<{ id: string; status: string; campaignName: string; requisitionCode: string | null; role: string | null; branchName: string | null; city: string | null; isAhmedabad: boolean; qualifiedFuture: number; invitedFuture: number; interviewPassed: number }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.campaign_status, c.campaign_name, jr.requisition_code, jr.designation_name, jr.branch_name, bm.city,
            SUM(ml.screening_result = 'qualified' AND ml.interview_date IS NOT NULL AND ml.interview_time IS NOT NULL AND ${FUTURE}
                AND ml.walkin_declined = 0 AND ${OPEN_REQ.replace(/jr\./g, "jr.")}) AS qualified_future,
            SUM(ml.screening_result = 'qualified' AND ml.interview_date IS NOT NULL AND ml.interview_time IS NOT NULL AND ${FUTURE}
                AND ml.walkin_declined = 0 AND ml.walkin_confirmed = 0 AND ml.notification_sent_at IS NOT NULL AND ${OPEN_REQ}) AS invited_future,
            SUM(ml.screening_result = 'qualified' AND ml.interview_date IS NOT NULL AND ml.interview_time IS NOT NULL AND NOT (${FUTURE})
                AND ml.walkin_declined = 0) AS interview_passed
       FROM meta_campaign c
       LEFT JOIN job_requisition jr ON jr.id = c.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
       LEFT JOIN meta_lead_raw ml ON ml.campaign_id = c.id
      WHERE c.campaign_status IN ('active','draft','paused')
      GROUP BY c.id, c.campaign_status, c.campaign_name, jr.requisition_code, jr.designation_name, jr.branch_name, bm.city
      HAVING c.campaign_status = 'active' OR qualified_future > 0 OR interview_passed > 0
      ORDER BY c.campaign_name`);
  return rows.map((r) => ({
    id: r.id as string, status: r.campaign_status as string, campaignName: r.campaign_name as string, requisitionCode: (r.requisition_code as string | null) ?? null,
    role: (r.designation_name as string | null) ?? null, branchName: (r.branch_name as string | null) ?? null, city: (r.city as string | null) ?? null,
    isAhmedabad: isAhmedabad(r.campaign_name as string, r.branch_name as string, r.city as string),
    qualifiedFuture: Number(r.qualified_future ?? 0), invitedFuture: Number(r.invited_future ?? 0), interviewPassed: Number(r.interview_passed ?? 0),
  }));
}

export interface PreparedRow { phone: string; name: string; role: string; interview_date: string; interview_time: string; branch_address: string; reference_id: string }

export async function prepareRowsFromCampaigns(o: PrepareOptions): Promise<{ rows: PreparedRow[]; truncated: boolean; excluded: Record<string, number> }> {
  const ids = Array.from(new Set(o.campaignIds.filter((x) => typeof x === "string" && x.length > 0))).slice(0, 50);
  if (!ids.length) return { rows: [], truncated: false, excluded: {} };
  const ph = ids.map(() => "?").join(",");
  const requireInvite = o.requireInviteSent !== false;

  // Why qualified leads of these campaigns are NOT in the list, so HR is never left wondering where someone went.
  const [ex] = await db.execute<RowDataPacket[]>(
    `SELECT CASE
              WHEN ml.interview_date IS NULL OR ml.interview_time IS NULL THEN 'no_interview_assigned'
              WHEN NOT (${FUTURE}) THEN 'interview_date_passed'
              WHEN ml.walkin_declined = 1 THEN 'declined'
              WHEN NOT (${OPEN_REQ}) THEN 'requisition_closed_or_filled'
              WHEN ml.walkin_confirmed = 1 AND ${o.includeConfirmed ? "0" : "1"} THEN 'already_confirmed'
              WHEN ml.notification_sent_at IS NULL AND ${requireInvite ? "1" : "0"} THEN 'invite_not_sent_yet'
              WHEN ${o.includeRecentlyExported ? "0" : RECENT_EXPORT} THEN 'already_sent_to_calling_tool'
              ELSE 'included' END AS reason, COUNT(*) AS n
       FROM meta_lead_raw ml JOIN job_requisition jr ON jr.id = ml.requisition_id
      WHERE ml.campaign_id IN (${ph}) AND ml.screening_result = 'qualified'
      GROUP BY reason`, ids);
  const excluded: Record<string, number> = {};
  for (const r of ex) if (r.reason !== "included") excluded[r.reason as string] = Number(r.n);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ml.parsed_name, ml.parsed_phone, ml.meta_lead_id, DATE_FORMAT(ml.interview_date, '%Y-%m-%d') AS d, TIME_FORMAT(ml.interview_time, '%H:%i') AS t,
            jr.designation_name, bm.address
       FROM meta_lead_raw ml
       JOIN job_requisition jr ON jr.id = ml.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE ml.campaign_id IN (${ph}) AND ml.screening_result = 'qualified'
        AND ml.interview_date IS NOT NULL AND ml.interview_time IS NOT NULL AND ${FUTURE}
        AND ml.walkin_declined = 0 ${o.includeConfirmed ? "" : "AND ml.walkin_confirmed = 0"}
        ${requireInvite ? "AND ml.notification_sent_at IS NOT NULL" : ""}
        ${o.includeRecentlyExported ? "" : `AND NOT ${RECENT_EXPORT}`}
        AND ${OPEN_REQ}
      ORDER BY ml.interview_date, ml.interview_time, ml.id
      LIMIT ${BULK_CALL_MAX_ROWS + 1}`, ids);
  const truncated = rows.length > BULK_CALL_MAX_ROWS;
  return {
    truncated, excluded,
    rows: rows.slice(0, BULK_CALL_MAX_ROWS).map((r) => ({
      phone: String(r.parsed_phone ?? "").replace(/^p:/i, ""), name: String(r.parsed_name ?? "").trim(), role: String(r.designation_name ?? ""),
      interview_date: String(r.d), interview_time: String(r.t), branch_address: String(r.address ?? "").replace(/\s*\n\s*/g, ", ").trim(),
      reference_id: String(r.meta_lead_id ?? "").replace(/^l:/i, "").slice(0, 40),
    })),
  };
}

export interface MissedOptions {
  campaignIds: string[];
  /** New interview date, YYYY-MM-DD (IST). */
  newDate: string;
  slotStart?: string; // HH:MM, default 10:00
  slotEnd?: string; // default 17:30
  slotMinutes?: number; // default 30
  perSlot?: number; // default 6
  includeRecentlyExported?: boolean;
}

/**
 * "Did not walk in": candidates who were given an interview that has now passed and who never registered at the branch.
 * Walk-in evidence is checked three ways - the linked ATS candidate, any ATS candidate with the same phone, and a queue
 * token - because a Meta lead is not always linked to the ATS record the branch created. Anyone with evidence is never
 * re-invited. The rest get a new slot on `newDate`, spread across the day, in the same seven-column row format.
 */
export async function prepareMissedWalkins(o: MissedOptions): Promise<{ rows: PreparedRow[]; truncated: boolean; excluded: Record<string, number>; plan: { candidates: number; capacity: number; newDate: string } }> {
  const ids = Array.from(new Set(o.campaignIds.filter((x) => typeof x === "string" && x.length > 0))).slice(0, 50);
  const excluded: Record<string, number> = {};
  const bump = (k: string) => { excluded[k] = (excluded[k] ?? 0) + 1; };
  const empty = { rows: [] as PreparedRow[], truncated: false, excluded, plan: { candidates: 0, capacity: 0, newDate: o.newDate } };
  if (!ids.length) return empty;
  const ph = ids.map(() => "?").join(",");

  const [leads] = await db.execute<RowDataPacket[]>(
    `SELECT ml.id, ml.parsed_name, ml.parsed_phone, ml.meta_lead_id, ml.ats_candidate_id, ml.walkin_declined,
            (jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.fulfilled_headcount < jr.requested_headcount) AS req_open,
            jr.designation_name, bm.address,
            ${o.includeRecentlyExported ? "0" : RECENT_EXPORT} AS recent_export
       FROM meta_lead_raw ml
       JOIN job_requisition jr ON jr.id = ml.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE ml.campaign_id IN (${ph}) AND ml.screening_result = 'qualified'
        AND ml.interview_date IS NOT NULL AND ml.interview_time IS NOT NULL
        AND TIMESTAMP(ml.interview_date, ml.interview_time) < DATE_SUB(NOW(), INTERVAL 2 HOUR)
      ORDER BY ml.interview_date DESC, ml.interview_time DESC, ml.id
      LIMIT 2000`, ids);

  const mob = (l: RowDataPacket) => normalizeMobile10(String(l.parsed_phone ?? "").replace(/^p:/i, ""));
  const phones = Array.from(new Set(leads.map(mob).filter((x): x is string => Boolean(x))));
  const atsIds = Array.from(new Set(leads.map((l) => l.ats_candidate_id as string | null).filter((x): x is string => Boolean(x))));

  // Walk-in evidence by linked id OR by phone, then queue tokens for those candidates.
  const walkedPhones = new Set<string>(); const walkedIds = new Set<string>();
  if (phones.length || atsIds.length) {
    const phPh = phones.map(() => "?").join(","), idPh = atsIds.map(() => "?").join(",");
    const [cands] = await db.execute<RowDataPacket[]>(
      `SELECT c.id, RIGHT(REGEXP_REPLACE(c.mobile, '[^0-9]', ''), 10) AS m, (c.walk_in_date IS NOT NULL OR c.q_token IS NOT NULL) AS came
         FROM ats_candidate c
        WHERE ${[atsIds.length ? `c.id IN (${idPh})` : "", phones.length ? `RIGHT(REGEXP_REPLACE(c.mobile, '[^0-9]', ''), 10) IN (${phPh})` : ""].filter(Boolean).join(" OR ")}`,
      [...atsIds, ...phones]);
    const candIds = cands.map((c) => c.id as string);
    const tokenned = new Set<string>();
    if (candIds.length) {
      const [qt] = await db.execute<RowDataPacket[]>(`SELECT DISTINCT candidate_id FROM ats_queue_token WHERE candidate_id IN (${candIds.map(() => "?").join(",")})`, candIds);
      for (const t of qt) tokenned.add(t.candidate_id as string);
    }
    for (const c of cands) if (Number(c.came) === 1 || tokenned.has(c.id as string)) { walkedIds.add(c.id as string); if (c.m) walkedPhones.add(c.m as string); }
  }

  const optedOut = new Set<string>();
  if (phones.length) {
    const [oo] = await db.execute<RowDataPacket[]>(`SELECT mobile10 FROM he_lead WHERE status = 'opted_out' AND mobile10 IN (${phones.map(() => "?").join(",")})`, phones);
    for (const r of oo) optedOut.add(r.mobile10 as string);
  }

  const kept: RowDataPacket[] = [];
  const seen = new Set<string>();
  for (const l of leads) {
    const m = mob(l);
    if (!m) { kept.push(l); continue; } // surfaces as a rejected row in the preview so HR can fix the number
    if (seen.has(m)) { bump("duplicate_phone"); continue; }
    if (Number(l.walkin_declined) === 1) { bump("declined"); continue; }
    if (!Number(l.req_open)) { bump("requisition_closed_or_filled"); continue; }
    if (walkedPhones.has(m) || (l.ats_candidate_id && walkedIds.has(l.ats_candidate_id as string))) { bump("already_walked_in"); continue; }
    if (optedOut.has(m)) { bump("opted_out"); continue; }
    if (Number(l.recent_export) === 1) { bump("already_sent_to_calling_tool"); continue; }
    seen.add(m); kept.push(l);
  }

  const plan = assignSlots(kept.length, { start: o.slotStart ?? "10:00", end: o.slotEnd ?? "17:30", minutes: o.slotMinutes ?? 30, perSlot: o.perSlot ?? 6 });
  if (plan.overflow > 0) excluded.no_slot_capacity = plan.overflow;
  const rows = kept.slice(0, plan.times.length).map((l, i): PreparedRow => ({
    phone: String(l.parsed_phone ?? "").replace(/^p:/i, ""), name: String(l.parsed_name ?? "").trim(), role: String(l.designation_name ?? ""),
    interview_date: o.newDate, interview_time: plan.times[i].slice(0, 5), branch_address: String(l.address ?? "").replace(/\s*\n\s*/g, ", ").trim(),
    reference_id: String(l.meta_lead_id ?? "").replace(/^l:/i, "").slice(0, 40),
  }));
  return { rows, truncated: false, excluded, plan: { candidates: kept.length, capacity: plan.capacity, newDate: o.newDate } };
}
