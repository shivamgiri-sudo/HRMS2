/**
 * Follow-up pipeline, calling-file batch (10:00, 14:00, 18:00 IST): collects rows the call step left 'in_file' and emails them as
 * CSV + XLSX in the seven-column format HR already uses. A row is stamped with the batch id BEFORE the email goes out and unstamped
 * when the send fails, so it can never be in two sent files; a batch stuck 'pending' (crash mid-send) is cleared after 30 minutes.
 */
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import { BULK_CALL_COLUMNS, BULK_CALL_MAX_ROWS } from "./he-bulk-call.js";
import { displayFirstName } from "./he-name.js";
import { sbDate, sbTime } from "./he-superbot.js";
import type { CallFileResult } from "./qualified-followup.context.js";
import type { FollowupSwitches, RowTag } from "./qualified-followup.policy.js";
import { followupRef } from "./qualified-followup.rules.js";

const SELECT_CAP = 5000;
const STALE_MIN = 30;
const C = "COLLATE utf8mb4_unicode_ci";
const IST_MS = 5.5 * 3600_000;

export interface CallFileRow {
  mobile10: string;
  name: string;
  role: string;
  interviewDate: string | null;
  interviewTime: string | null;
  branchAddress: string | null;
  referenceId: string;
}
export interface CallFile { filename: string; content: Buffer; contentType: string }

/** Spreadsheet formula injection guard: text starting with = + - @ tab or CR is shown literally (apostrophe prefix). */
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const cell = (v: unknown) => { const s = String(v ?? "").replace(/\r?\n/g, " "); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const values = (r: CallFileRow, testPhone?: string | null): string[] => [
  testPhone || r.mobile10, safe(r.name), safe(r.role),
  r.interviewDate ? sbDate(r.interviewDate) : "", r.interviewTime ? sbTime(r.interviewTime) : "",
  safe((r.branchAddress ?? "").replace(/\r?\n/g, " ")), safe(r.referenceId),
];

/** BOM-prefixed so Excel reads UTF-8 (same as he-superbot-sheet.service.ts). */
export function callFileCsv(rows: CallFileRow[], testPhone?: string | null): string {
  const out = [BULK_CALL_COLUMNS.join(","), ...rows.map((r) => values(r, testPhone).map(cell).join(","))];
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
    ws.addRow([...BULK_CALL_COLUMNS]);
    for (const r of part) ws.addRow(values(r, o.testPhone));
    files.push({
      filename: `${base}.xlsx`, content: Buffer.from(await wb.xlsx.writeBuffer()),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
  return files;
}

/** Batches left 'pending' over 30 minutes (crash between stamp and send) release their rows and are marked failed. */
export async function recoverStaleBatches(_now: Date): Promise<number> {
  const [pending] = await db.execute<RowDataPacket[]>(
    "SELECT id, TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS age_min FROM qualified_followup_call_batch WHERE status = 'pending'");
  let n = 0;
  for (const b of pending) {
    if (Number(b.age_min) <= STALE_MIN) continue;
    await db.execute("UPDATE qualified_followup SET call_file_batch_id = NULL WHERE call_file_batch_id = ?", [b.id]);
    await db.execute("UPDATE qualified_followup_call_batch SET status = 'failed', error = 'stale' WHERE id = ? AND status = 'pending'", [b.id]);
    n++;
  }
  return n;
}

/** One retry; if both fail the batch becomes 'sent_unrecorded' (not 'pending', so stale recovery never unstamps a delivered file). */
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
    logger.error({ batchId, err: (err as Error).message }, "[qualified-followup] calling file batch left pending after send; needs manual check");
  }
}

const istStamp = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

export async function runCallFileBatch(s: FollowupSwitches, tag: RowTag, now: Date): Promise<CallFileResult> {
  if (tag === "test" && !s.testPhone) return { status: "failed", rows: 0, files: 0, error: "no test phone" };
  // Same kill switches as the other steps: nothing leaves while sends are paused (dry_run only logs).
  if (tag !== "dry_run" && s.sendsPaused) return { status: "empty", rows: 0, files: 0 };
  const to = tag === "test" ? s.testEmail : s.callFileTo;
  const paused = [...s.pausedSources];
  let found: RowDataPacket[];
  try {
    await recoverStaleBatches(now);
    [found] = await db.execute<RowDataPacket[]>(
      `SELECT qf.id, qf.source_type, qf.mobile10, qf.full_name, qf.role_name,
              (SELECT bm.address FROM branch_master bm WHERE bm.branch_name ${C} = qf.branch_name ${C} AND bm.active_status = 1 LIMIT 1) AS address,
              CASE WHEN qf.source_type = 'he' THEN DATE_FORMAT(hm.slot_at, '%Y-%m-%d') ELSE mr.interview_date END AS slot_date,
              CASE WHEN qf.source_type = 'he' THEN DATE_FORMAT(hm.slot_at, '%H:%i') ELSE mr.interview_time END AS slot_time
         FROM qualified_followup qf
         LEFT JOIN meta_lead_raw mr ON mr.id ${C} = qf.meta_lead_id ${C}
         LEFT JOIN he_match hm ON hm.lead_id ${C} = qf.he_lead_id ${C} AND hm.drive_id ${C} = qf.drive_id ${C}
        WHERE qf.call_state = 'in_file' AND qf.call_file_batch_id IS NULL AND qf.stopped_reason IS NULL AND qf.mode_at_enqueue = ?
          ${paused.length ? `AND qf.source_type NOT IN (${paused.map(() => "?").join(",")})` : ""}
        ORDER BY qf.created_at, qf.id LIMIT ${SELECT_CAP}`, [tag, ...paused]);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 255);
    logger.error({ err: msg }, "[qualified-followup] calling file selection failed");
    return { status: "failed", rows: 0, files: 0, error: msg };
  }
  if (found.length === 0) return { status: "empty", rows: 0, files: 0 };
  if (tag !== "dry_run" && !to) return { status: "failed", rows: 0, files: 0, error: "no recipient" };

  const batchId = randomUUID();
  try {
    await db.execute("INSERT INTO qualified_followup_call_batch (id, row_count, sent_to, status) VALUES (?, ?, ?, 'pending')",
      [batchId, found.length, tag === "dry_run" ? null : to]);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 255);
    logger.error({ err: msg }, "[qualified-followup] calling file batch insert failed");
    return { status: "failed", rows: 0, files: 0, error: msg };
  }
  const unstamp = () => db.execute("UPDATE qualified_followup SET call_file_batch_id = NULL WHERE call_file_batch_id = ?", [batchId]);

  try {
    // Stamp first; only rows this batch really owns go into the file (a stop or another writer may win a row).
    const ids = found.map((r) => String(r.id));
    const [st] = await db.execute<any>(
      `UPDATE qualified_followup SET call_file_batch_id = ? WHERE id IN (${ids.map(() => "?").join(",")})
         AND call_file_batch_id IS NULL AND call_state = 'in_file' AND stopped_reason IS NULL`, [batchId, ...ids]);
    let owned = found;
    if (Number(st?.affectedRows ?? ids.length) !== ids.length) {
      const [mine] = await db.execute<RowDataPacket[]>("SELECT id FROM qualified_followup WHERE call_file_batch_id = ?", [batchId]);
      const own = new Set(mine.map((r) => String(r.id)));
      owned = found.filter((r) => own.has(String(r.id)));
    }
    if (owned.length === 0) {
      await db.execute("UPDATE qualified_followup_call_batch SET status = 'failed', error = 'no rows stamped', row_count = 0 WHERE id = ?", [batchId]);
      return { status: "empty", batchId, rows: 0, files: 0 };
    }
    const today = istStamp(now).slice(0, 10);
    const rows: CallFileRow[] = owned.map((r) => ({
      mobile10: String(r.mobile10), name: displayFirstName(r.full_name), role: String(r.role_name ?? ""),
      interviewDate: r.slot_date && String(r.slot_date).slice(0, 10) >= today ? String(r.slot_date).slice(0, 10) : null,
      interviewTime: r.slot_date && String(r.slot_date).slice(0, 10) >= today && r.slot_time ? String(r.slot_time).slice(0, 5) : null,
      branchAddress: r.address ? String(r.address) : null, referenceId: followupRef(String(r.id)),
    }));
    const when = istStamp(now);
    const files = await buildCallFiles(rows, { stamp: when.replace(/[-:]/g, "").replace("T", "-"), testPhone: tag === "test" ? s.testPhone : null });

    if (tag === "dry_run") {
      await db.execute("UPDATE qualified_followup_call_batch SET status = 'dry_run', row_count = ? WHERE id = ?", [rows.length, batchId]);
      logger.info({ batchId, rows: rows.length, files: files.length }, "[qualified-followup] calling file (dry run, nothing sent)");
      return { status: "dry_run", batchId, rows: rows.length, files: files.length };
    }

    const bySource = new Map<string, number>();
    for (const r of owned) bySource.set(String(r.source_type), (bySource.get(String(r.source_type)) ?? 0) + 1);
    const lines = [...bySource].map(([k, n]) => `<li>${k}: ${n}</li>`).join("");
    await emailService.send({
      to: to as string,
      subject: `[HRMS] Calling file: ${rows.length} candidates (${when.replace("T", " ")} IST)`,
      html: `<p>${rows.length} qualified candidates need a confirmation call.</p><ul>${lines}</ul><p>${files.length} attachment(s), up to ${BULK_CALL_MAX_ROWS} rows each.${tag === "test" ? " TEST MODE: every phone number is the test number." : ""}</p>`,
      attachments: files.map((f) => ({ filename: f.filename, content: f.content, contentType: f.contentType })),
    });
    // The mail is out: from here the rows must stay stamped whatever happens to the bookkeeping.
    await recordSent(batchId, rows.length);
    return { status: "sent", batchId, rows: rows.length, files: files.length };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 255);
    try {
      await unstamp();
      await db.execute("UPDATE qualified_followup_call_batch SET status = 'failed', error = ? WHERE id = ?", [msg, batchId]);
    } catch (e2) {
      logger.error({ batchId, err: (e2 as Error).message }, "[qualified-followup] calling file cleanup failed; stale recovery will clear it");
    }
    logger.warn({ batchId, err: msg }, "[qualified-followup] calling file failed");
    return { status: "failed", batchId, rows: 0, files: 0, error: msg };
  }
}
