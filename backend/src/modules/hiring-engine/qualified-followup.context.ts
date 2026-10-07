import type { RowDataPacket } from "mysql2";
import type { SourceType } from "./qualified-followup.types.js";

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
