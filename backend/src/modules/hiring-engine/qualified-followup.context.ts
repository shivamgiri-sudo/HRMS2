import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { bridgeOneMetaLead } from "./he-meta-bridge.service.js";
import { assignInterviewSlot } from "../meta-campaign/interview-slot.service.js";
import type { SourceType } from "./qualified-followup.types.js";

const C = "COLLATE utf8mb4_unicode_ci";

/** Per-step tallies; every step returns this shape so the worker can log them uniformly. */
export interface StepCounts { processed: number; sent: number; failed: number; blocked: number; held: number; dryRun: number }
/** Result of one calling-file batch run (Task 9); lives here so the worker and the batch module share it without a cycle. */
export type CallFileResult = { status: "empty" | "sent" | "failed" | "dry_run"; batchId?: string; rows: number; files: number; error?: string };
export const emptyCounts = (): StepCounts => ({ processed: 0, sent: 0, failed: 0, blocked: 0, held: 0, dryRun: 0 });

export interface FollowupRow {
  id: string;
  sourceType: SourceType;
  metaLeadId: string | null;
  heLeadId: string | null;
  atsCandidateId: string | null;
  requisitionId: string;
  driveId: string | null;
  mobile10: string;
  email: string | null;
  fullName: string | null;
  branchName: string | null;
  roleName: string | null;
  qualifiedAt: Date;
  emailDueAt: Date | null;
  emailStatus: string | null;
  emailAttempts: number;
  waDueAt: Date | null;
  waStatus: string | null;
  waAttempts: number;
  callDueAt: Date | null;
  callState: "pending" | "in_file" | "queued" | "called" | "skipped";
  callAttempts: number;
}

export const ROW_COLUMNS = `qf.id, qf.source_type, qf.meta_lead_id, qf.he_lead_id, qf.ats_candidate_id, qf.requisition_id, qf.drive_id,
  qf.mobile10, qf.email, qf.full_name, qf.branch_name, qf.role_name, qf.qualified_at,
  qf.email_due_at, qf.email_status, qf.email_attempts, qf.wa_due_at, qf.wa_status, qf.wa_attempts,
  qf.call_due_at, qf.call_state, qf.call_attempts`;

// DATETIME columns are IST wall-clock strings (pool has dateStrings), same reading as he-engine.service.ts.
function ist(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  return new Date(String(v).replace(" ", "T") + "+05:30");
}

export function toFollowupRow(r: RowDataPacket): FollowupRow {
  return {
    id: String(r.id),
    sourceType: r.source_type as SourceType,
    metaLeadId: r.meta_lead_id ?? null,
    heLeadId: r.he_lead_id ?? null,
    atsCandidateId: r.ats_candidate_id ?? null,
    requisitionId: String(r.requisition_id),
    driveId: r.drive_id ?? null,
    mobile10: String(r.mobile10),
    email: r.email ?? null,
    fullName: r.full_name ?? null,
    branchName: r.branch_name ?? null,
    roleName: r.role_name ?? null,
    qualifiedAt: ist(r.qualified_at) as Date,
    emailDueAt: ist(r.email_due_at),
    emailStatus: r.email_status ?? null,
    emailAttempts: Number(r.email_attempts ?? 0),
    waDueAt: ist(r.wa_due_at),
    waStatus: r.wa_status ?? null,
    waAttempts: Number(r.wa_attempts ?? 0),
    callDueAt: ist(r.call_due_at),
    callState: (r.call_state ?? "pending") as FollowupRow["callState"],
    callAttempts: Number(r.call_attempts ?? 0),
  };
}

export interface SendContext {
  heLeadId: string | null;
  matchId: string | null;
  /** he_match.token (answer buttons need it); null when there is no match. */
  matchToken: string | null;
  slot: { date: string; time: string } | null;
  branchAddress: string | null;
  bmiLink: string | null;
  mapsLink: string | null;
  leadStatus: string | null;
}

/** Meta rows are bridged into he_lead first (idempotent, never throws) and the link is stamped on the row; he rows already carry it. */
export async function ensureHeLead(row: FollowupRow): Promise<string | null> {
  if (row.sourceType === "he" || !row.metaLeadId) return row.heLeadId;
  if (row.heLeadId) return row.heLeadId;
  await bridgeOneMetaLead(row.metaLeadId);
  const [r] = await db.execute<RowDataPacket[]>(`SELECT id FROM he_lead WHERE mobile10 = ? ${C} LIMIT 1`, [row.mobile10]);
  const id = r[0]?.id ? String(r[0].id) : null;
  if (id) await db.execute("UPDATE qualified_followup SET he_lead_id = ? WHERE id = ? AND he_lead_id IS NULL", [id, row.id]);
  return id;
}

export async function loadSendContext(row: FollowupRow, o: { assignSlot: boolean }): Promise<SendContext> {
  const heLeadId = row.heLeadId;
  let leadStatus: string | null = null;
  if (heLeadId) {
    const [l] = await db.execute<RowDataPacket[]>("SELECT status FROM he_lead WHERE id = ? LIMIT 1", [heLeadId]);
    leadStatus = l[0]?.status ?? null;
  }
  let branchAddress: string | null = null;
  let mapsLink: string | null = null;
  if (row.branchName) {
    const [b] = await db.execute<RowDataPacket[]>(
      "SELECT address, latitude, longitude FROM branch_master WHERE branch_name = ? AND active_status = 1 LIMIT 1", [row.branchName]);
    const a = String(b[0]?.address ?? "").trim();
    branchAddress = a || null;
    if (b[0]) mapsLink = b[0].latitude != null && b[0].longitude != null ? `https://maps.google.com/?q=${b[0].latitude},${b[0].longitude}` : a ? `https://maps.google.com/?q=${encodeURIComponent(a)}` : null;
  }
  let bmiLink: string | null = null;
  const [jr] = await db.execute<RowDataPacket[]>("SELECT bmi_assessment_url FROM job_requisition WHERE id = ? LIMIT 1", [row.requisitionId]);
  bmiLink = String(jr[0]?.bmi_assessment_url ?? "").trim() || null;

  let slot: SendContext["slot"] = null;
  let matchId: string | null = null;
  let matchToken: string | null = null;
  if (row.sourceType === "he") {
    if (heLeadId && row.driveId) {
      const [m] = await db.execute<RowDataPacket[]>("SELECT id, slot_at, token FROM he_match WHERE lead_id = ? AND drive_id = ? LIMIT 1", [heLeadId, row.driveId]);
      if (m[0]) {
        matchId = String(m[0].id);
        matchToken = m[0].token ?? null;
        if (m[0].slot_at) { const s = String(m[0].slot_at); slot = { date: s.slice(0, 10), time: s.slice(11, 19) }; }
      }
    }
  } else if (row.metaLeadId) {
    const [r] = await db.execute<RowDataPacket[]>("SELECT interview_date, interview_time FROM meta_lead_raw WHERE id = ? LIMIT 1", [row.metaLeadId]);
    if (r[0]?.interview_date && r[0]?.interview_time) slot = { date: String(r[0].interview_date).slice(0, 10), time: String(r[0].interview_time).slice(0, 8) };
    else if (o.assignSlot && branchAddress && bmiLink && row.branchName) {
      const s = await assignInterviewSlot(row.metaLeadId, row.branchName);
      slot = { date: s.date, time: s.time };
    }
  }
  return { heLeadId, matchId, matchToken, slot, branchAddress, bmiLink, mapsLink, leadStatus };
}
