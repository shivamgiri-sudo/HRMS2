/**
 * One person's trail through the hiring engine, found by e-mail. STRICTLY READ-ONLY. Prints the person's own records only
 * (lead, Meta form fill, address on file, follow-up rows, bookings, messages sent), so a wrongly routed invitation can be traced.
 *   PERSON_EMAIL=name@example.com npx tsx scripts/person-trace.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const email = String(process.env.PERSON_EMAIL ?? "").trim().toLowerCase();
const q = async (label: string, sql: string, params: unknown[] = []) => {
  try {
    const [r] = await db.execute<RowDataPacket[]>(sql, params as never[]);
    console.log(`\n== ${label} (${r.length})`);
    for (const row of r.slice(0, 25)) console.log(JSON.stringify(row));
  } catch (e) { console.log(`\n== ${label}: FAILED ${(e as Error).message.slice(0, 160)}`); }
};

(async () => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) { console.log("PERSON_EMAIL missing or invalid"); process.exit(1); }
  await q("he_lead", "SELECT id, mobile10, full_name, email, status, primary_source, locality, pincode, age, education_rank, lat, lng, ats_candidate_id, meta_lead_id, created_at FROM he_lead WHERE LOWER(email) = ?", [email]);
  await q("meta_lead_raw (form fills)", `SELECT id, campaign_id, created_at, parsed_name, parsed_phone, parsed_email, parsed_location, parsed_age, parsed_education, requisition_id, screening_result, JSON_EXTRACT(raw_payload,'$.created_time') ct FROM meta_lead_raw WHERE LOWER(parsed_email) = ? ORDER BY created_at DESC`, [email]);
  await q("ats_candidate", "SELECT id, full_name, mobile, email, current_address, permanent_address, city, state, applied_for_branch, requisition_id, current_stage, walk_in_date FROM ats_candidate WHERE LOWER(email) = ? LIMIT 5", [email]);
  await q("qualified_followup rows", `SELECT qf.id, qf.source_type, qf.origin_label, qf.mode_at_enqueue, qf.mobile10, qf.branch_name, qf.role_name, jr.requisition_code, jr.branch_name AS req_branch, qf.journey_state, qf.stopped_reason,
       qf.qualified_at, qf.email_sent_at, qf.wa_sent_at, qf.campaign_id FROM qualified_followup qf LEFT JOIN job_requisition jr ON jr.id = qf.requisition_id WHERE LOWER(qf.email) = ? ORDER BY qf.created_at DESC`, [email]);
  await q("he_match (bookings)", `SELECT m.id, m.state, m.slot_at, m.score, m.reasons_json, m.distance_km, d.branch_name AS drive_branch, d.drive_date, jr.requisition_code, jr.branch_name AS req_branch
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id LEFT JOIN he_drive d ON d.id = m.drive_id LEFT JOIN job_requisition jr ON jr.id = m.requisition_id WHERE LOWER(l.email) = ? ORDER BY m.created_at DESC`, [email]);
  await q("messages out (last 10)", `SELECT x.channel, x.template_key, x.delivery_status, x.created_at, x.requisition_id FROM he_message x JOIN he_lead l ON l.id = x.lead_id WHERE LOWER(l.email) = ? AND x.direction = 'out' ORDER BY x.created_at DESC LIMIT 10`, [email]);
  await q("lead events (last 15)", `SELECT e.event_type, e.channel, e.detail, e.created_at FROM he_lead_event e JOIN he_lead l ON l.id = e.lead_id WHERE LOWER(l.email) = ? ORDER BY e.created_at DESC LIMIT 15`, [email]);
  await db.end?.();
})();
