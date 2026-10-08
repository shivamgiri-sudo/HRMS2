/** DB facts for the follow-up guard chain (followup-guards.ts): shared WhatsApp budget, canary first contacts, requisition, skip audit. */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { endDateEnforcementAllowed } from "./requisition-criteria.js";
import type { GuardReason, GuardStep, RequisitionFacts } from "./followup-guards.js";

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;
const fmt = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");

/** [start, end) of the IST calendar day of `now`, as IST wall-clock strings (the session time zone is IST). */
export function istDayBounds(now: Date): [string, string] {
  const start = Math.floor((now.getTime() + IST_MS) / DAY_MS) * DAY_MS; // IST midnight expressed on the UTC clock
  return [fmt(start), fmt(start + DAY_MS)];
}

// Transactional answers (T2 confirmation, T5 new slot, T10 STOP acknowledgement) do not use the shared budget.
const TRANSACTIONAL_KEYS = ["he_walkin_confirmed", "he_reschedule_offer", "he_optout_ack"];

/** Unprompted outbound WhatsApp on the Pinbot number today, by any mechanism (engine, follow-up worker, alerts). */
export async function sharedWaSentToday(now: Date): Promise<number> {
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM he_message
      WHERE direction = 'out' AND channel = 'whatsapp' AND created_at >= ? AND created_at < ?
        AND ${TRANSACTIONAL_KEYS.map((k) => `template_key NOT LIKE '${k}:%'`).join(" AND ")}`, istDayBounds(now));
  return Number(r[0]?.n ?? 0);
}

/** Canary people whose first stage A send (email or WhatsApp) went out today at a branch whose name starts with the prefix. */
export async function branchFirstContactsToday(branchPrefix: string, now: Date): Promise<number> {
  const [start, end] = istDayBounds(now);
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM qualified_followup
      WHERE mode_at_enqueue = 'canary' AND branch_name LIKE ?
        AND LEAST(COALESCE(email_sent_at, wa_sent_at), COALESCE(wa_sent_at, email_sent_at)) >= ?
        AND LEAST(COALESCE(email_sent_at, wa_sent_at), COALESCE(wa_sent_at, email_sent_at)) < ?`, [`${branchPrefix}%`, start, end]);
  return Number(r[0]?.n ?? 0);
}

// A passed requisition end date skips stage A steps (D8) only with both WS3 E1 keys, the same rule as Notify and the engine's line-up
// invites: REQ_END_DATE_ENFORCEMENT=policy (env; off = no read) and policy.req_end_date_enforced = 1 (a missing row is off). Cached a minute.
let endDatePolicy: { at: number; on: boolean } | null = null;
export function resetEndDatePolicyCache(): void { endDatePolicy = null; }
export async function reqEndDateEnforced(now: Date = new Date()): Promise<boolean> {
  if (!endDateEnforcementAllowed()) return false;
  if (endDatePolicy && now.getTime() - endDatePolicy.at < 60_000) return endDatePolicy.on;
  const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = 'policy.req_end_date_enforced' LIMIT 1");
  endDatePolicy = { at: now.getTime(), on: Number(r[0]?.value ?? 0) === 1 };
  return endDatePolicy.on;
}

export async function loadRequisitionFacts(requisitionId: string): Promise<RequisitionFacts | null> {
  const [r] = await db.execute<RowDataPacket[]>(
    "SELECT approval_status, active_status, closed_at, requested_headcount, fulfilled_headcount, requisition_validity FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  const x = r[0];
  if (!x) return null;
  return {
    approvalStatus: x.approval_status == null ? null : String(x.approval_status), activeStatus: x.active_status == null ? null : Number(x.active_status),
    closedAt: x.closed_at ?? null, requestedHeadcount: x.requested_headcount == null ? null : Number(x.requested_headcount),
    fulfilledHeadcount: x.fulfilled_headcount == null ? null : Number(x.fulfilled_headcount), validityDate: x.requisition_validity ?? null,
  };
}

/** Audit of a guard skip: he_lead_event 'followup_skip', at most once per row + step + reason per IST day. Needs an he_lead. */
export async function recordGuardSkip(followupId: string, leadId: string | null, step: GuardStep, reason: GuardReason, now: Date = new Date()): Promise<boolean> {
  if (!leadId) return false;
  const detail = `${step}:${reason}`;
  const [seen] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS hit FROM he_lead_event WHERE lead_id = ? AND event_type = 'followup_skip' AND detail = ? AND created_at >= ?
        AND JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.followupId')) = ? LIMIT 1`, [leadId, detail, istDayBounds(now)[0], followupId]);
  if (seen.length) return false;
  await db.execute("INSERT INTO he_lead_event (lead_id, event_type, channel, detail, meta_json) VALUES (?,?,?,?,?)",
    [leadId, "followup_skip", step, detail, JSON.stringify({ followupId })]);
  return true;
}
