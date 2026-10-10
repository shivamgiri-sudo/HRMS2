/**
 * Follow-up pipeline, calling-file batch (every 2 hours by default, see CALL_FILE_SLOTS / callFileConfig): collects rows the call step left
 * 'in_file', keeps one line per person (qualified-followup.callfile-plan.ts) and emails CSV + XLSX: the seven upload columns HR already
 * uses first, then the detail columns. Each slot is claimed once per row tag (uq_qfcb_slot). Rows are stamped with the batch id BEFORE the
 * email and the batch is marked 'sending'; a failed send unstamps them, a batch stuck 'pending' over 30 minutes is released, and one stuck
 * 'sending' (the mail may have gone) becomes 'unknown' with its rows kept stamped, so no row can reach a second file.
 */
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import { BULK_CALL_COLUMNS, BULK_CALL_MAX_ROWS } from "./he-bulk-call.js";
import { attemptLabel, loadAttemptEvents, summariseAttempts, type PersonAttempts } from "./person-attempts.service.js";
import { loadOfferRows } from "./he-best-offer.service.js";
import type { OfferRow } from "./he-best-offer.js";
import { displayFirstName } from "./he-name.js";
import { sbDate, sbTime } from "./he-superbot.js";
import {
  callFileConfig, callFileDriveType, planCallFile, type CallFileCandidate, type CallFileConfig, type CallFilePlan, type CallFileSummary, type PlannedRow,
} from "./qualified-followup.callfile-plan.js";
import type { CallFileResult } from "./qualified-followup.context.js";
import type { FollowupSwitches, RowTag } from "./qualified-followup.policy.js";
import { followupRef, OUTCOME_UNKNOWN_ERROR } from "./qualified-followup.rules.js";
import type { SourceType } from "./qualified-followup.types.js";
import { existingRef, refsForMatches } from "./he-call-ref.service.js";
import { markExportedForCalling } from "./he-call-results.service.js";

const SELECT_CAP = 5000;
const STALE_MIN = 30;
const C = "COLLATE utf8mb4_unicode_ci";
const IST_MS = 5.5 * 3600_000;

export const CALL_FILE_DETAIL_COLUMNS = [
  "requisition_code", "other_requisitions", "branch", "drive_type", "campaign", "qualified_at",
  "email_status", "email_sent_at", "whatsapp_status", "whatsapp_sent_at", "attempt", "priority",
  "approach", "earlier_contacts", "earlier_connected",
] as const;
export const CALL_FILE_COLUMNS = [...BULK_CALL_COLUMNS, ...CALL_FILE_DETAIL_COLUMNS];

export interface CallFileRow {
  mobile10: string;
  name: string;
  role: string;
  interviewDate: string | null;
  interviewTime: string | null;
  branchAddress: string | null;
  referenceId: string;
  requisitionCode: string;
  otherRequisitions: string[];
  branch: string | null;
  driveType: string;
  campaign: string;
  qualifiedAt: string | null;
  emailStatus: string | null;
  emailSentAt: string | null;
  waStatus: string | null;
  waSentAt: string | null;
  attempt: number;
  priority: string;
  /** FRESH, or REPEAT #n | contacts, connected | the requisitions tried earlier (contacts/connected each); "" when unknown. */
  approach: string;
  earlierContacts: number;
  earlierConnected: number;
}
export interface CallFile { filename: string; content: Buffer; contentType: string }

/** Spreadsheet formula injection guard: text starting with = + - @ tab or CR is shown literally (apostrophe prefix). */
/** A cell a spreadsheet would run as a formula (leading = + - @ TAB CR) is prefixed with an apostrophe. */
export const csvSafe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const safe = csvSafe;
const cell = (v: unknown) => { const s = String(v ?? "").replace(/\r?\n/g, " "); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const values = (r: CallFileRow, testPhone?: string | null): string[] => [
  testPhone || r.mobile10, safe(r.name), safe(r.role),
  r.interviewDate ? sbDate(r.interviewDate) : "", r.interviewTime ? sbTime(r.interviewTime) : "",
  safe((r.branchAddress ?? "").replace(/\r?\n/g, " ")), safe(r.referenceId),
  safe(r.requisitionCode), safe(r.otherRequisitions.join(" ")), safe(r.branch ?? ""), r.driveType, safe(r.campaign),
  r.qualifiedAt ?? "", safe(r.emailStatus ?? ""), r.emailSentAt ?? "", safe(r.waStatus ?? ""), r.waSentAt ?? "", String(r.attempt), r.priority,
  safe(r.approach), String(r.earlierContacts), String(r.earlierConnected),
];

/** BOM-prefixed so Excel reads UTF-8 (same as he-superbot-sheet.service.ts). */
export function callFileCsv(rows: CallFileRow[], testPhone?: string | null): string {
  const out = [CALL_FILE_COLUMNS.join(","), ...rows.map((r) => values(r, testPhone).map(cell).join(","))];
  return "﻿" + out.join("\r\n") + "\r\n";
}

export function chunkRows<T>(rows: T[], size = BULK_CALL_MAX_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function buildCallFiles(rows: CallFileRow[], o: { stamp: string; testPhone?: string | null }): Promise<CallFile[]> {
  const files: CallFile[] = [];
  for (const [i, part] of chunkRows(rows).entries()) {
    const base = `qualified-calls-${o.stamp}-part${i + 1}`;
    files.push({ filename: `${base}.csv`, content: Buffer.from(callFileCsv(part, o.testPhone), "utf8"), contentType: "text/csv; charset=utf-8" });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Calls");
    ws.addRow([...CALL_FILE_COLUMNS]);
    for (const r of part) ws.addRow(values(r, o.testPhone));
    files.push({
      filename: `${base}.xlsx`, content: Buffer.from(await wb.xlsx.writeBuffer()),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
  return files;
}

/** he_model_param rows (policy.callfile_*) over env over defaults. A read error falls back to env/defaults. */
export async function loadCallFileConfig(env: NodeJS.ProcessEnv = process.env): Promise<CallFileConfig> {
  const params = new Map<string, number>();
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT param_key, value FROM he_model_param WHERE param_key LIKE 'policy.callfile%'");
    for (const r of rows) params.set(String(r.param_key), Number(r.value));
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "[qualified-followup] calling-file settings read failed; using env/defaults");
  }
  return callFileConfig(env, params);
}

/**
 * Stale batches (over 30 minutes): 'pending' (crash before the email) release their rows and slot and are marked failed; 'sending' (crash
 * during or after the email) become 'unknown' and keep their rows stamped, because the file may have been delivered.
 */
export async function recoverStaleBatches(_now: Date): Promise<number> {
  const [stale] = await db.execute<RowDataPacket[]>(
    "SELECT id, status, TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS age_min FROM qualified_followup_call_batch WHERE status IN ('pending','sending')");
  let n = 0;
  for (const b of stale) {
    if (Number(b.age_min) <= STALE_MIN) continue;
    if (String(b.status ?? "pending") === "sending") {
      await db.execute("UPDATE qualified_followup_call_batch SET status = 'unknown', error = ? WHERE id = ? AND status = 'sending'", [OUTCOME_UNKNOWN_ERROR, b.id]);
    } else {
      await db.execute("UPDATE qualified_followup SET call_file_batch_id = NULL WHERE call_file_batch_id = ?", [b.id]);
      await db.execute("UPDATE qualified_followup_call_batch SET status = 'failed', error = 'stale', slot_claim = NULL WHERE id = ? AND status = 'pending'", [b.id]);
    }
    n++;
  }
  return n;
}

/** One retry; if both fail the batch becomes 'sent_unrecorded' (never 'pending', so stale recovery never unstamps a delivered file). */
async function recordSent(batchId: string, rowCount: number): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await db.execute("UPDATE qualified_followup_call_batch SET status = 'sent', row_count = ? WHERE id = ?", [rowCount, batchId]);
      logger.info({ batchId, rows: rowCount }, "[qualified-followup] calling file sent");
      return;
    } catch (err) {
      logger.error({ batchId, attempt, err: (err as Error).message }, "[qualified-followup] calling file sent but not recorded");
    }
  }
  try {
    await db.execute("UPDATE qualified_followup_call_batch SET status = 'sent_unrecorded' WHERE id = ?", [batchId]);
  } catch (err) {
    logger.error({ batchId, err: (err as Error).message }, "[qualified-followup] calling file batch left 'sending' after send; stale recovery marks it unknown");
  }
}

const istStamp = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
// DATETIME columns arrive as IST wall-clock strings (pool has dateStrings).
const wall = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return istStamp(v).replace("T", " ");
  return String(v).replace("T", " ").slice(0, 16);
};
const str = (v: unknown) => (v == null ? null : String(v));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const errText = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 255);
const isDup = (e: unknown) => (e as { code?: string })?.code === "ER_DUP_ENTRY" || (e as { errno?: number })?.errno === 1062;

/** Candidate rows plus the per-person facts the dedupe needs: STOP, match state, he_call outcomes, earlier files of the same mobile and tag. */
function selectSql(paused: number): string {
  return `SELECT qf.id, qf.source_type, qf.mobile10, qf.full_name, qf.role_name, qf.requisition_id, qf.branch_name, qf.origin_label,
              qf.qualified_at, qf.email_status, qf.email_sent_at, qf.wa_status, qf.wa_sent_at,
              (SELECT jr.requisition_code FROM job_requisition jr WHERE jr.id = qf.requisition_id ${C} LIMIT 1) AS requisition_code,
              (SELECT mc.campaign_name FROM meta_campaign mc WHERE mc.id = qf.campaign_id ${C} LIMIT 1) AS campaign_name,
              (SELECT bm.address FROM branch_master bm WHERE bm.branch_name ${C} = qf.branch_name ${C} AND bm.active_status = 1 LIMIT 1) AS address,
              CASE WHEN hb.id IS NOT NULL THEN DATE_FORMAT(hb.slot_at, '%Y-%m-%d') WHEN qf.source_type = 'he' THEN DATE_FORMAT(hm.slot_at, '%Y-%m-%d') ELSE mr.interview_date END AS slot_date,
              CASE WHEN hb.id IS NOT NULL THEN DATE_FORMAT(hb.slot_at, '%H:%i') WHEN qf.source_type = 'he' THEN DATE_FORMAT(hm.slot_at, '%H:%i') ELSE mr.interview_time END AS slot_time,
              qf.match_id,
              EXISTS (SELECT 1 FROM he_lead_event ev WHERE ev.lead_id = hl.id AND ev.event_type = 'exported_for_calling' AND ev.created_at > DATE_SUB(NOW(), INTERVAL 18 HOUR) AND COALESCE(ev.detail, '') NOT LIKE 'follow-up batch%') AS exported_recently,
              mr.voice_call_outcome AS meta_outcome, hl.status AS lead_status,
              (EXISTS (SELECT 1 FROM he_consent k WHERE k.lead_id = hl.id AND k.consent_type = 'whatsapp_contact' AND k.revoked_at IS NOT NULL)
                 AND NOT EXISTS (SELECT 1 FROM he_consent k2 WHERE k2.lead_id = hl.id AND k2.consent_type = 'whatsapp_contact' AND k2.revoked_at IS NULL)) AS consent_revoked,
              (SELECT GROUP_CONCAT(DISTINCT m2.state) FROM he_match m2 WHERE m2.lead_id = hl.id AND m2.state IN ('confirmed','arrived','selected')) AS match_states,
              EXISTS (SELECT 1 FROM he_match m3 WHERE m3.lead_id = hl.id AND m3.requisition_id = qf.requisition_id ${C} AND m3.state = 'declined') AS row_declined,
              (SELECT COUNT(*) FROM he_call c WHERE c.lead_id = hl.id) AS calls_n,
              (SELECT COUNT(*) FROM he_call c WHERE c.lead_id = hl.id AND c.outcome IS NOT NULL AND c.outcome <> 'NO_ANSWER' AND c.outcome NOT LIKE 'CALL_FAILED%') AS calls_answered,
              (SELECT COUNT(*) FROM he_call c WHERE c.lead_id = hl.id AND (c.outcome = 'NO_ANSWER' OR c.outcome LIKE 'CALL_FAILED%')) AS calls_retryable,
              (SELECT MAX(c.created_at) FROM he_call c WHERE c.lead_id = hl.id) AS last_call_at,
              (SELECT COUNT(DISTINCT p.call_file_batch_id) FROM qualified_followup p
                WHERE p.mobile10 = qf.mobile10 AND p.mode_at_enqueue = qf.mode_at_enqueue AND p.call_file_batch_id IS NOT NULL) AS files_n,
              (SELECT MAX(b.created_at) FROM qualified_followup p JOIN qualified_followup_call_batch b ON b.id = p.call_file_batch_id
                WHERE p.mobile10 = qf.mobile10 AND p.mode_at_enqueue = qf.mode_at_enqueue AND p.call_file_batch_id IS NOT NULL) AS last_file_at
         FROM qualified_followup qf
         LEFT JOIN meta_lead_raw mr ON mr.id ${C} = qf.meta_lead_id ${C}
         LEFT JOIN he_match hm ON hm.lead_id ${C} = qf.he_lead_id ${C} AND hm.drive_id ${C} = qf.drive_id ${C}
         LEFT JOIN he_match hb ON hb.id = qf.match_id ${C}
         LEFT JOIN he_lead hl ON hl.mobile10 = qf.mobile10 ${C}
        WHERE qf.call_state = 'in_file' AND qf.call_file_batch_id IS NULL AND qf.stopped_reason IS NULL AND qf.mode_at_enqueue = ? AND qf.owner = 'pipeline'
          ${paused ? `AND qf.source_type NOT IN (${Array.from({ length: paused }, () => "?").join(",")})` : ""}
        ORDER BY qf.created_at, qf.id LIMIT ${SELECT_CAP}`;
}

function toCandidate(r: RowDataPacket): CallFileCandidate {
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    id: String(r.id), sourceType: r.source_type as SourceType, mobile10: String(r.mobile10), fullName: str(r.full_name), roleName: str(r.role_name),
    requisitionId: String(r.requisition_id ?? ""), requisitionCode: String(r.requisition_code ?? ""), branchName: str(r.branch_name),
    branchAddress: r.address ? String(r.address) : null, campaign: String(r.campaign_name ?? r.origin_label ?? ""),
    qualifiedAt: String(wall(r.qualified_at) ?? ""), emailStatus: str(r.email_status), emailSentAt: wall(r.email_sent_at),
    waStatus: str(r.wa_status), waSentAt: wall(r.wa_sent_at), slotDate: str(r.slot_date), slotTime: str(r.slot_time),
    leadStatus: str(r.lead_status), consentRevoked: n(r.consent_revoked) === 1,
    matchStates: String(r.match_states ?? "").split(",").filter(Boolean), rowDeclined: n(r.row_declined) === 1,
    callsN: n(r.calls_n), callsAnswered: n(r.calls_answered), callsRetryable: n(r.calls_retryable), lastCallAt: str(r.last_call_at),
    metaOutcome: r.meta_outcome ? String(r.meta_outcome).trim() || null : null, filesN: n(r.files_n), lastFileAt: str(r.last_file_at),
    exportedRecently: n(r.exported_recently) === 1, matchId: str(r.match_id),
  };
}

/** Offer data for the best-requisition pick; a read error only loses the ranking (earliest qualified wins), never blocks the file. */
async function offerRowsFor(mobiles: string[], tag: RowTag): Promise<Map<string, OfferRow[]>> {
  const out = new Map<string, OfferRow[]>();
  try {
    const list = [...new Set(mobiles)];
    for (let i = 0; i < list.length; i += 500) for (const [k, v] of await loadOfferRows(list.slice(i, i + 500), tag)) out.set(k, v);
  } catch (err) {
    logger.warn({ code: (err as { code?: string })?.code ?? "unknown" }, "[qualified-followup] calling file offer read failed; earliest requisition wins");
  }
  return out;
}

/** Fresh/repeat history per person for the file; a read error leaves the column empty, never blocks the file. */
async function attemptHistoryFor(plan: CallFilePlan): Promise<Map<string, PersonAttempts>> {
  const out = new Map<string, PersonAttempts>();
  const events = await loadAttemptEvents(plan.rows.map((p) => p.best.mobile10));
  for (const p of plan.rows) out.set(p.best.mobile10, summariseAttempts(p.best.mobile10, events.get(p.best.mobile10) ?? [], { journeyId: p.best.id }));
  return out;
}

/** The reference a booked journey's call carries is its match's HRMS reference (so file results and Superbot resolve the booking). */
async function referencesFor(plan: CallFilePlan, write: boolean): Promise<Map<string, string>> {
  const ids = plan.rows.map((r) => r.best.matchId).filter((x): x is string => !!x);
  if (!ids.length) return new Map();
  if (write) return refsForMatches(ids);
  const out = new Map<string, string>();
  for (const id of ids) { const r = await existingRef(id); if (r) out.set(id, r); }
  return out;
}

function toFileRow(p: PlannedRow, refs: ReadonlyMap<string, string>, history: ReadonlyMap<string, PersonAttempts> = new Map()): CallFileRow {
  const b = p.best;
  const h = history.get(b.mobile10);
  return {
    mobile10: b.mobile10, name: displayFirstName(b.fullName), role: String(b.roleName ?? ""), interviewDate: p.interviewDate, interviewTime: p.interviewTime,
    branchAddress: b.branchAddress, referenceId: (b.matchId ? refs.get(b.matchId) : undefined) ?? followupRef(b.id), requisitionCode: b.requisitionCode, otherRequisitions: p.otherRequisitionCodes,
    branch: b.branchName, driveType: callFileDriveType(b), campaign: b.campaign, qualifiedAt: b.qualifiedAt || null,
    emailStatus: b.emailStatus, emailSentAt: b.emailSentAt, waStatus: b.waStatus, waSentAt: b.waSentAt, attempt: p.attempt, priority: p.priority,
    approach: attemptLabel(h), earlierContacts: h?.priorContacts ?? 0, earlierConnected: h?.timesConnected ?? 0,
  };
}

export function summarise(plan: CallFilePlan, files: number): CallFileSummary {
  const byDriveType: Record<string, number> = {};
  const byBranch: Record<string, number> = {};
  for (const r of plan.rows) {
    const d = callFileDriveType(r.best);
    byDriveType[d] = (byDriveType[d] ?? 0) + 1;
    const br = r.best.branchName || "(no branch)";
    byBranch[br] = (byBranch[br] ?? 0) + 1;
  }
  return { rows: plan.rows.length, files, byDriveType, byBranch, skipped: { ...plan.skippedByReason }, merged: plan.merged, deferred: plan.deferred.length };
}

const counts = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${esc(k)}: ${v}`).join(", ") || "none";

export function summaryHtml(s: CallFileSummary, when: string, testMode: boolean): string {
  return `<p><b>${s.rows} people to call</b> (one line per person), ${when} IST. ${s.files} attachment(s), up to ${BULK_CALL_MAX_ROWS} rows each.</p>`
    + `<p>By drive type: ${counts(s.byDriveType)}</p><p>By branch: ${counts(s.byBranch)}</p>`
    + `<p>Not in this file (duplicates and stops): ${counts(s.skipped as Record<string, number>)}. Same person, other requisition folded into one line: ${s.merged}. `
    + `Waiting for the 2-hour retry gap: ${s.deferred}.</p>${testMode ? "<p>TEST MODE: every phone number is the test number.</p>" : ""}`;
}

export async function runCallFileBatch(
  s: FollowupSwitches, tag: RowTag, now: Date, o: { slotKey?: string; config?: CallFileConfig } = {},
): Promise<CallFileResult> {
  if (tag === "test" && !s.testPhone) return { status: "failed", rows: 0, files: 0, error: "no test phone" };
  // Same kill switches as the other steps: nothing leaves while sends are paused (dry_run only logs).
  if (tag !== "dry_run" && s.sendsPaused) return { status: "empty", rows: 0, files: 0 };
  const to = tag === "test" ? s.testEmail : s.callFileTo;
  const paused = [...s.pausedSources];
  const when = istStamp(now).replace("T", " ");
  const batch: { id: string | null } = { id: null };
  const fail = async (msg: string) => {
    const batchId = batch.id;
    if (batchId) {
      try {
        await db.execute("UPDATE qualified_followup_call_batch SET status = 'failed', error = ?, slot_claim = NULL WHERE id = ?", [msg, batchId]);
      } catch (e2) {
        logger.error({ batchId, err: (e2 as Error).message }, "[qualified-followup] calling file batch cleanup failed; stale recovery will clear it");
      }
    }
    return { status: "failed" as const, ...(batchId ? { batchId } : {}), rows: 0, files: 0, error: msg };
  };
  const insertBatch = async () => {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO qualified_followup_call_batch (id, row_count, sent_to, status, mode_tag, slot_key, slot_claim) VALUES (?, 0, ?, 'pending', ?, ?, ?)",
      [id, tag === "dry_run" ? null : to, tag, o.slotKey ?? null, o.slotKey ?? null]);
    batch.id = id;
    return id;
  };

  let found: RowDataPacket[];
  let cfg: CallFileConfig;
  try {
    cfg = o.config ?? (await loadCallFileConfig());
    await recoverStaleBatches(now);
    // Claim the slot first: a second process or a restart inside the grace window finds it taken and sends nothing.
    if (o.slotKey) {
      try {
        await insertBatch();
      } catch (err) {
        if (isDup(err)) return { status: "already_done", rows: 0, files: 0 };
        throw err;
      }
    }
    [found] = await db.execute<RowDataPacket[]>(selectSql(paused.length), [tag, ...paused]);
  } catch (err) {
    const msg = errText(err);
    logger.error({ err: msg }, "[qualified-followup] calling file selection failed");
    return fail(msg);
  }

  try {
    const cands = found.map(toCandidate);
    const offers = cands.length ? await offerRowsFor(cands.map((c) => c.mobile10), tag) : new Map<string, OfferRow[]>();
    let plan = planCallFile(cands, { now, coolDays: cfg.coolDays, offerRows: offers });
    if (cands.length && tag !== "dry_run" && !to) return await fail("no recipient");
    if (cands.length && !batch.id) await insertBatch();
    const batchId = batch.id;

    // Duplicates and stops leave the queue now, whatever happens to the email (they do not depend on it).
    const byReason = new Map<string, string[]>();
    for (const k of plan.skipped) { const l = byReason.get(k.reason); if (l) l.push(k.id); else byReason.set(k.reason, [k.id]); }
    for (const [reason, ids] of byReason) {
      await db.execute(
        `UPDATE qualified_followup SET call_state = 'skipped', call_error = ? WHERE id IN (${ids.map(() => "?").join(",")})
           AND call_state = 'in_file' AND call_file_batch_id IS NULL AND stopped_reason IS NULL`, [`callfile:${reason}`, ...ids]);
    }

    const ids = plan.rows.flatMap((r) => [r.best.id, ...r.siblings.map((x) => x.id)]);
    if (ids.length) {
      // Stamp first; only rows this batch really owns go into the file (a stop or another writer may win a row).
      const [st] = await db.execute<ResultSetHeader>(
        `UPDATE qualified_followup SET call_file_batch_id = ? WHERE id IN (${ids.map(() => "?").join(",")})
           AND call_file_batch_id IS NULL AND call_state = 'in_file' AND stopped_reason IS NULL`, [batchId, ...ids]);
      if (Number(st?.affectedRows ?? ids.length) !== ids.length) {
        const [mine] = await db.execute<RowDataPacket[]>("SELECT id FROM qualified_followup WHERE call_file_batch_id = ?", [batchId]);
        const own = new Set(mine.map((r) => String(r.id)));
        const kept = planCallFile(cands.filter((c) => own.has(c.id)), { now, coolDays: cfg.coolDays, offerRows: offers });
        plan = { ...plan, rows: kept.rows, merged: kept.merged };
      }
    }

    if (plan.rows.length === 0) {
      const summary = summarise(plan, 0);
      if (batchId) await db.execute("UPDATE qualified_followup_call_batch SET status = 'empty', row_count = 0, summary = ? WHERE id = ?", [JSON.stringify(summary), batchId]);
      if (cfg.emptyNote && tag !== "dry_run" && to) {
        await emailService.send({ to, subject: `[HRMS] Calling file: no new rows (${when} IST)`, html: `<p>No new people to call since the last batch.</p>${summaryHtml(summary, when, tag === "test")}` });
      }
      return { status: "empty", ...(batchId ? { batchId } : {}), rows: 0, files: 0, summary };
    }

    const refs = await referencesFor(plan, tag !== "dry_run");
    const history = await attemptHistoryFor(plan);
    const rows = plan.rows.map((p) => toFileRow(p, refs, history));
    const files = await buildCallFiles(rows, { stamp: when.replace(/[-:]/g, "").replace(" ", "-"), testPhone: tag === "test" ? s.testPhone : null });
    const summary = summarise(plan, files.length);

    if (tag === "dry_run") {
      await db.execute("UPDATE qualified_followup_call_batch SET status = 'dry_run', row_count = ?, summary = ? WHERE id = ?", [rows.length, JSON.stringify(summary), batchId]);
      logger.info({ batchId, ...summary }, "[qualified-followup] calling file (dry run, nothing sent)");
      return { status: "dry_run", batchId: batchId as string, rows: rows.length, files: files.length, summary };
    }

    // From 'sending' on, stale recovery never releases these rows: the mail may already be out.
    await db.execute("UPDATE qualified_followup_call_batch SET status = 'sending', row_count = ?, summary = ? WHERE id = ?", [rows.length, JSON.stringify(summary), batchId]);
    await emailService.send({
      to: to as string,
      subject: `[HRMS] Calling file: ${rows.length} candidates (${when} IST)`,
      html: summaryHtml(summary, when, tag === "test"),
      attachments: files.map((f) => ({ filename: f.filename, content: f.content, contentType: f.contentType })),
    });
    // The mail is out: from here the rows must stay stamped whatever happens to the bookkeeping.
    await recordSent(batchId as string, rows.length);
    // The same export record HR's manual Prepare writes and reads (18 h), so the two never put one person in two files. Test files went
    // to the owner's number: nothing is recorded about the people.
    if (tag !== "test") {
      const slots: Record<string, string> = {};
      for (const r of rows) if (r.interviewDate && r.interviewTime) slots[r.mobile10] = `${r.interviewDate} ${r.interviewTime}:00`;
      await markExportedForCalling(rows.map((r) => r.mobile10), { userId: null, label: `follow-up batch ${o.slotKey ?? when}`, slots })
        .catch((err: unknown) => logger.warn({ batchId, err: errText(err) }, "[qualified-followup] calling file sent; export record failed"));
    }
    return { status: "sent", batchId: batchId as string, rows: rows.length, files: files.length, summary };
  } catch (err) {
    const msg = errText(err);
    const batchId = batch.id;
    if (batchId) {
      try {
        await db.execute("UPDATE qualified_followup SET call_file_batch_id = NULL WHERE call_file_batch_id = ?", [batchId]);
      } catch (e2) {
        logger.error({ batchId, err: (e2 as Error).message }, "[qualified-followup] calling file unstamp failed; stale recovery will clear it");
      }
    }
    logger.warn({ batchId, err: msg }, "[qualified-followup] calling file failed");
    return fail(msg);
  }
}
