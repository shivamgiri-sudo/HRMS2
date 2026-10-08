/**
 * Manual bulk voice calls: preview, queue and dispatch. Every row becomes a he_call_job with its own state, the
 * candidate goes into the lead pool, and the end-of-call report flows through the same capture path as engine calls
 * (he_call, signals, lead status), so a manual call is never a data dead-end.
 *
 * Safety: the uploader must attest the candidates agreed to be contacted (stored as consent with source 'bulk_upload');
 * opted-out leads are never called; calls only go out 09:00-20:00 IST; one retry 2h later for no-answer/failed (BRD);
 * the global kill switch and Vapi configuration are honoured; a dry run places nothing.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { istHour } from "./he-guardrails.js";
import { dateLabel, timeLabel, validateBulkCalls, type BulkCallRow, type RowResult } from "./he-bulk-call.js";
import { grantConsent, addEvent, upsertLead } from "./he-lead.service.js";
import { sendsPaused } from "./he-send.service.js";
import { nowIst } from "./he-slots.js";
import { startVapiCall } from "./he-voice.service.js";
import { displayFirstName } from "./he-name.js";

export const BULK_CONSENT_TEXT_VERSION = "bulk_attest_v1";

export interface PreviewRow extends RowResult { notes: string[] }

/** Validate and annotate: which rows are fine, which are rejected, and which are fine but will be skipped at call time. */
export async function previewBulkCalls(rawRows: Array<Record<string, unknown>>): Promise<{ missingColumns: string[]; tooMany: boolean; rows: PreviewRow[]; summary: { total: number; valid: number; rejected: number; willSkip: number } }> {
  const v = validateBulkCalls(rawRows, nowIst());
  const rows: PreviewRow[] = [];
  for (const r of v.results) {
    const notes: string[] = [];
    if (r.ok && r.row) {
      const [l] = await db.execute<RowDataPacket[]>("SELECT status FROM he_lead WHERE mobile10 = ? LIMIT 1", [r.row.mobile10]);
      if (l[0]?.status === "opted_out") notes.push("candidate opted out - this row will be skipped");
      const [c] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_call c JOIN he_lead l ON l.id = c.lead_id WHERE l.mobile10 = ? AND c.created_at >= CURDATE() AND c.outcome IS NOT NULL AND c.outcome NOT LIKE 'CALL_FAILED%' AND c.outcome <> 'NO_ANSWER' LIMIT 1", [r.row.mobile10]);
      if (c.length) notes.push("candidate was already reached today - this row will be skipped");
    }
    rows.push({ ...r, notes });
  }
  const valid = rows.filter((r) => r.ok).length;
  return { missingColumns: v.missingColumns, tooMany: v.tooMany, rows, summary: { total: rows.length, valid, rejected: rows.length - valid, willSkip: rows.filter((r) => r.ok && r.notes.length).length } };
}

/** Queue the valid rows as a batch. Nothing is dialled until the batch is started. */
export async function createBulkCallBatch(rawRows: Array<Record<string, unknown>>, o: { label?: string; userId: string | null; attested: boolean }): Promise<{ batchId: string; queued: number; rejected: number }> {
  if (!o.attested) throw Object.assign(new Error("You must confirm the candidates have agreed to be contacted"), { statusCode: 400 });
  const v = validateBulkCalls(rawRows, nowIst());
  if (v.missingColumns.length) throw Object.assign(new Error(`Missing columns: ${v.missingColumns.join(", ")}`), { statusCode: 400 });
  if (v.tooMany) throw Object.assign(new Error("Too many rows in one upload"), { statusCode: 400 });
  const good = v.results.filter((r): r is RowResult & { row: BulkCallRow } => r.ok && Boolean(r.row));
  if (!good.length) throw Object.assign(new Error("No valid rows to queue"), { statusCode: 400 });

  const [idr] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
  const batchId = idr[0].id as string;
  await db.execute("INSERT INTO he_call_batch (id, label, created_by, consent_attested, status, total_rows, rejected_rows) VALUES (?,?,?,?, 'queued', ?, ?)",
    [batchId, o.label?.slice(0, 150) ?? null, o.userId, 1, good.length, v.results.length - good.length]);
  for (const g of good) {
    const lead = await upsertLead({ mobile: g.row.mobile10, fullName: g.row.name, source: "bulk_call" });
    if (lead) {
      await grantConsent(lead.id, "whatsapp_contact", BULK_CONSENT_TEXT_VERSION, "bulk_upload");
      await addEvent(lead.id, "bulk_call_queued", { channel: "voice", actor: o.userId, detail: `batch ${batchId} row ${g.row.rowNo}`, meta: { referenceId: g.row.referenceId } });
    }
    await db.execute(
      `INSERT INTO he_call_job (batch_id, row_no, mobile10, lead_id, candidate_name, role, interview_at, branch_address, reference_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [batchId, g.row.rowNo, g.row.mobile10, lead?.id ?? null, g.row.name, g.row.role, g.row.interviewAt, g.row.branchAddress, g.row.referenceId]);
  }
  return { batchId, queued: good.length, rejected: v.results.length - good.length };
}

export interface RunSummary { dryRun: boolean; considered: number; placed: number; skipped: Record<string, number>; blocked: Record<string, number>; failed: number; waiting: number }

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/**
 * Dispatch up to `max` due jobs. A job is due when queued and (never tried, or tried once and 2h have passed). Rules
 * that make a job permanently pointless mark it skipped; rules that are only about "not now" leave it queued.
 */
export async function runBulkCallJobs(o: { batchId?: string; dryRun?: boolean; max?: number } = {}): Promise<RunSummary> {
  const dryRun = o.dryRun !== false;
  const out: RunSummary = { dryRun, considered: 0, placed: 0, skipped: {}, blocked: {}, failed: 0, waiting: 0 };

  // A call that never produced an end-of-call report within 30 min counts as unanswered so the row can retry or finish.
  if (!dryRun) {
    await db.execute(
      `UPDATE he_call_job SET status = IF(attempts < 2, 'queued', 'completed'), outcome = IF(attempts < 2, outcome, 'NO_REPORT')
        WHERE status = 'placed' AND last_attempt_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)`);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT j.id, j.lead_id, j.mobile10, j.candidate_name, j.role, j.interview_at, j.branch_address, j.reference_id, j.attempts, j.last_attempt_at
       FROM he_call_job j JOIN he_call_batch b ON b.id = j.batch_id
      WHERE j.status = 'queued' AND b.status IN ('queued','active') ${o.batchId ? "AND j.batch_id = ?" : "AND b.status = 'active'"}
      ORDER BY j.interview_at LIMIT ?`, o.batchId ? [o.batchId, Math.min(o.max ?? 25, 200)] : [Math.min(o.max ?? 25, 200)]);

  const now = new Date();
  for (const j of rows) {
    out.considered++;
    // Permanent reasons first.
    if (String(j.interview_at) <= nowIst(new Date(now.getTime() + 15 * 60_000))) { if (!dryRun) await finish(j.id as string, "skipped", "interview_passed"); bump(out.skipped, "interview_passed"); continue; }
    const [lead] = await db.execute<RowDataPacket[]>("SELECT status FROM he_lead WHERE id = ? LIMIT 1", [j.lead_id]);
    if (lead[0]?.status === "opted_out") { if (!dryRun) await finish(j.id as string, "skipped", "opted_out"); bump(out.skipped, "opted_out"); continue; }
    const [reached] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_call WHERE lead_id = ? AND created_at >= CURDATE() AND outcome IS NOT NULL AND outcome NOT LIKE 'CALL_FAILED%' AND outcome <> 'NO_ANSWER' LIMIT 1", [j.lead_id]);
    if (reached.length) { if (!dryRun) await finish(j.id as string, "skipped", "already_reached_today"); bump(out.skipped, "already_reached_today"); continue; }
    // "Not now" reasons leave the job queued.
    if (sendsPaused()) { bump(out.blocked, "paused"); out.waiting++; continue; }
    if (istHour(now) < 9 || istHour(now) >= 20) { bump(out.blocked, "quiet_hours"); out.waiting++; continue; }
    if (Number(j.attempts) >= 1 && j.last_attempt_at && now.getTime() - new Date(String(j.last_attempt_at).replace(" ", "T") + "+05:30").getTime() < 120 * 60_000) { bump(out.blocked, "retry_too_soon"); out.waiting++; continue; }
    if (Number(j.attempts) >= 2) { if (!dryRun) await finish(j.id as string, "completed", null, "MAX_ATTEMPTS"); bump(out.skipped, "max_attempts"); continue; }
    if (dryRun) { out.placed++; continue; }

    const [claim] = await db.execute<ResultSetHeader>("UPDATE he_call_job SET status = 'placed', attempts = attempts + 1, last_attempt_at = NOW() WHERE id = ? AND status = 'queued'", [j.id]);
    if (claim.affectedRows === 0) continue; // another runner took it
    const ctx = {
      candidateName: displayFirstName(j.candidate_name), role: String(j.role),
      driveDate: dateLabel(String(j.interview_at).slice(0, 10)), slotTime: timeLabel(String(j.interview_at).slice(11, 19)),
      branchAddress: String(j.branch_address), contactName: process.env.HE_HR_CONTACT_NAME?.trim() || "our HR team", contactPhone: process.env.HE_HR_CONTACT_PHONE?.trim() || "",
      referenceId: String(j.reference_id),
    };
    const started = await startVapiCall({ ctx, mobile10: String(j.mobile10), metadata: { jobId: j.id, leadId: j.lead_id, attempt: Number(j.attempts) + 1, source: "bulk-upload" } });
    if (!started.ok) {
      // Give the attempt back: a configuration problem must not burn the candidate's two tries.
      await db.execute("UPDATE he_call_job SET status = 'queued', attempts = attempts - 1, last_attempt_at = NULL WHERE id = ?", [j.id]);
      if (started.reason === "voice_not_configured") { bump(out.blocked, "voice_not_configured"); out.waiting++; }
      else { out.failed++; if (j.lead_id) await addEvent(j.lead_id as string, "call_failed_to_place", { channel: "voice", detail: started.error.slice(0, 300) }); }
      continue;
    }
    await db.execute("UPDATE he_call_job SET provider_call_id = ? WHERE id = ?", [started.callId, j.id]);
    if (j.lead_id) await addEvent(j.lead_id as string, "call_placed", { channel: "voice", detail: started.callId, meta: { jobId: j.id, source: "bulk-upload" } });
    out.placed++;
  }
  if (!dryRun) await settleBatches();
  return out;
}

async function finish(jobId: string, status: "completed" | "skipped" | "failed", skipReason: string | null, outcome?: string): Promise<void> {
  await db.execute("UPDATE he_call_job SET status = ?, skip_reason = ?, outcome = COALESCE(?, outcome) WHERE id = ?", [status, skipReason, outcome ?? null, jobId]);
}

/** Called from the Vapi end-of-call webhook. Unanswered/failed calls go back in the queue for the one allowed retry. */
export async function completeBulkJob(jobId: string, outcome: string): Promise<void> {
  const retryable = outcome === "NO_ANSWER" || outcome.startsWith("CALL_FAILED");
  const [j] = await db.execute<RowDataPacket[]>("SELECT attempts FROM he_call_job WHERE id = ? LIMIT 1", [jobId]);
  if (!j[0]) return;
  const again = retryable && Number(j[0].attempts) < 2;
  await db.execute("UPDATE he_call_job SET status = ?, outcome = ? WHERE id = ?", [again ? "queued" : "completed", outcome.slice(0, 60), jobId]);
  await settleBatches();
}

/** Batch is done once nothing is queued or in flight. */
async function settleBatches(): Promise<void> {
  await db.execute(
    `UPDATE he_call_batch b SET status = 'done'
      WHERE b.status = 'active' AND NOT EXISTS (SELECT 1 FROM he_call_job j WHERE j.batch_id = b.id AND j.status IN ('queued','placed'))`);
}

export async function startBulkBatch(batchId: string): Promise<boolean> {
  const [r] = await db.execute<ResultSetHeader>("UPDATE he_call_batch SET status = 'active' WHERE id = ? AND status IN ('queued','active')", [batchId]);
  return r.affectedRows > 0;
}

export async function cancelBulkBatch(batchId: string): Promise<{ cancelled: number }> {
  await db.execute("UPDATE he_call_batch SET status = 'cancelled' WHERE id = ? AND status IN ('queued','active')", [batchId]);
  const [r] = await db.execute<ResultSetHeader>("UPDATE he_call_job SET status = 'cancelled' WHERE batch_id = ? AND status = 'queued'", [batchId]);
  return { cancelled: r.affectedRows };
}

export async function listBulkBatches(): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.id, b.label, b.status, b.total_rows, b.rejected_rows, b.created_at,
            SUM(j.status = 'queued') AS queued, SUM(j.status = 'placed') AS in_progress, SUM(j.status = 'completed') AS completed,
            SUM(j.status = 'skipped') AS skipped, SUM(j.status = 'cancelled') AS cancelled,
            SUM(j.outcome = 'WALKIN_CONFIRMED_YES') AS confirmed, SUM(j.outcome = 'WALKIN_RESCHEDULED') AS rescheduled,
            SUM(j.outcome = 'WALKIN_DECLINED_NEEDS_FOLLOWUP') AS declined, SUM(j.outcome = 'NO_ANSWER') AS no_answer
       FROM he_call_batch b LEFT JOIN he_call_job j ON j.batch_id = b.id
      GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`);
  return rows;
}

export async function getBulkBatchJobs(batchId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, row_no, mobile10, candidate_name, role, interview_at, reference_id, status, skip_reason, attempts, last_attempt_at, outcome
       FROM he_call_job WHERE batch_id = ? ORDER BY row_no`, [batchId]);
  return rows;
}
