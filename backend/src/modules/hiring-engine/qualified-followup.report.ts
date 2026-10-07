/**
 * Follow-up pipeline, daily report (08:30 IST): what the previous 24 hours did per source, why candidates were skipped and which
 * WhatsApp errors Meta returned. Phone numbers appear masked only. Never throws; a failure resolves false so the worker can retry.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import type { FollowupSwitches, RowTag } from "./qualified-followup.policy.js";
import { maskMobile, metaErrorCode, type StopReason } from "./qualified-followup.rules.js";
import type { SourceType } from "./qualified-followup.types.js";

const C = "COLLATE utf8mb4_unicode_ci";
const IST_MS = 5.5 * 3600_000;
const EXAMPLE_CAP = 10;
const SOURCES: readonly SourceType[] = ["meta_live", "meta_old", "he"];

export type SkipReason = "missing_branch_address" | "missing_bmi_link" | "no_phone" | "opted_out";
const SKIP_REASONS: readonly SkipReason[] = ["missing_branch_address", "missing_bmi_link", "no_phone", "opted_out"];

export interface DailyReportData {
  date: string;
  mode: RowTag;
  perSource: Array<{
    sourceType: SourceType; enqueued: number; emailed: number; emailFailed: number; whatsapped: number; waFailed: number;
    callInFile: number; callQueued: number; called: number; stopped: Partial<Record<StopReason, number>>;
  }>;
  skipped: Array<{ reason: SkipReason; count: number; examples: Array<{ name: string; mobileMasked: string; requisition: string }> }>;
  waFailuresByCode: Array<{ code: string; count: number; sample: string }>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const istWall = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 19).replace("T", " ");

/** Removes e-mail addresses and phone-like digit runs from text that is logged or shown. */
export function scrub(text: unknown): string {
  return String(text ?? "").replace(/[^\s@]+@[^\s@]+/g, "[email]").replace(/\+?\d[\d\s-]{8,}\d/g, "[phone]");
}

export function groupWaFailures(errors: Array<string | null | undefined>): DailyReportData["waFailuresByCode"] {
  const by = new Map<string, { count: number; sample: string }>();
  for (const e of errors) {
    const code = metaErrorCode(e);
    const g = by.get(code);
    if (g) g.count++; else by.set(code, { count: 1, sample: scrub(e).slice(0, 120) });
  }
  return [...by].map(([code, g]) => ({ code, ...g })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export async function collectDailyReport(from: Date, to: Date, tag: RowTag): Promise<DailyReportData> {
  const f = istWall(from);
  const t = istWall(to);
  const inWin = (col: string) => `${col} >= ? AND ${col} < ?`;
  const win = [f, t];

  const [agg] = await db.execute<RowDataPacket[]>(
    `SELECT qf.source_type,
            SUM(${inWin("qf.created_at")}) AS enqueued,
            SUM(${inWin("qf.email_sent_at")}) AS emailed,
            SUM(qf.email_status = 'failed' AND ${inWin("qf.updated_at")}) AS email_failed,
            SUM(${inWin("qf.wa_sent_at")}) AS whatsapped,
            SUM(qf.wa_status = 'failed' AND ${inWin("qf.updated_at")}) AS wa_failed,
            SUM(qf.call_state = 'in_file' AND ${inWin("qf.updated_at")}) AS call_in_file,
            SUM(qf.call_state = 'queued' AND ${inWin("qf.updated_at")}) AS call_queued,
            SUM(${inWin("qf.called_at")}) AS called
       FROM qualified_followup qf
      WHERE qf.mode_at_enqueue = ? AND qf.updated_at >= ?
      GROUP BY qf.source_type`, [...win, ...win, ...win, ...win, ...win, ...win, ...win, ...win, tag, f]);
  const [stops] = await db.execute<RowDataPacket[]>(
    `SELECT qf.source_type, qf.stopped_reason, COUNT(*) AS n FROM qualified_followup qf
      WHERE qf.mode_at_enqueue = ? AND qf.stopped_reason IS NOT NULL AND ${inWin("qf.stopped_at")}
      GROUP BY qf.source_type, qf.stopped_reason`, [tag, ...win]);
  const perSource: DailyReportData["perSource"] = SOURCES.map((sourceType) => {
    const a = agg.find((r) => r.source_type === sourceType);
    const n = (k: string) => Number(a?.[k] ?? 0);
    const stopped: Partial<Record<StopReason, number>> = {};
    for (const r of stops) if (r.source_type === sourceType) stopped[r.stopped_reason as StopReason] = Number(r.n);
    return {
      sourceType, enqueued: n("enqueued"), emailed: n("emailed"), emailFailed: n("email_failed"), whatsapped: n("whatsapped"),
      waFailed: n("wa_failed"), callInFile: n("call_in_file"), callQueued: n("call_queued"), called: n("called"), stopped,
    };
  });

  const [fails] = await db.execute<RowDataPacket[]>(
    `SELECT qf.wa_error FROM qualified_followup qf WHERE qf.mode_at_enqueue = ? AND qf.wa_status = 'failed' AND ${inWin("qf.updated_at")} ORDER BY qf.updated_at`, [tag, ...win]);

  const skipped: DailyReportData["skipped"] = [];
  for (const reason of SKIP_REASONS) {
    let where: string;
    let params: unknown[];
    let from_: string;
    if (reason === "no_phone") {
      from_ = `meta_lead_raw r
         LEFT JOIN meta_campaign c ON c.id ${C} = r.campaign_id ${C}
         LEFT JOIN job_requisition jr ON jr.id ${C} = COALESCE(r.requisition_id, c.requisition_id) ${C}`;
      where = `r.screening_result = 'qualified' AND ${inWin("r.created_at")}
         AND NOT (RIGHT(REGEXP_REPLACE(COALESCE(r.parsed_phone, ''), '[^0-9]', ''), 10) REGEXP '^[6-9][0-9]{9}$')`;
      params = win;
    } else {
      from_ = `qualified_followup qf LEFT JOIN job_requisition jr ON jr.id ${C} = qf.requisition_id ${C}`;
      if (reason === "opted_out") {
        where = `qf.mode_at_enqueue = ? AND qf.stopped_reason = 'opted_out' AND ${inWin("qf.stopped_at")}`;
        params = [tag, ...win];
      } else {
        where = `qf.mode_at_enqueue = ? AND FIND_IN_SET(?, qf.missing_details) > 0 AND ${inWin("qf.updated_at")}`;
        params = [tag, reason === "missing_bmi_link" ? "bmi_link" : "branch_address", ...win];
      }
    }
    const [[cnt]] = (await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${from_} WHERE ${where}`, params)) as unknown as [RowDataPacket[]];
    const count = Number(cnt?.n ?? 0);
    let examples: DailyReportData["skipped"][number]["examples"] = [];
    if (count > 0) {
      const cols = reason === "no_phone"
        ? "r.parsed_name AS name, r.parsed_phone AS phone, jr.requisition_code AS req"
        : "qf.full_name AS name, qf.mobile10 AS phone, jr.requisition_code AS req";
      const [ex] = await db.execute<RowDataPacket[]>(`SELECT ${cols} FROM ${from_} WHERE ${where} LIMIT ${EXAMPLE_CAP}`, params);
      examples = ex.map((e) => ({ name: String(e.name ?? ""), mobileMasked: maskMobile(e.phone), requisition: String(e.req ?? "") }));
    }
    skipped.push({ reason, count, examples });
  }

  return { date: new Date(to.getTime() + IST_MS).toISOString().slice(0, 10), mode: tag, perSource, skipped, waFailuresByCode: groupWaFailures(fails.map((r) => r.wa_error)) };
}

const stoppedText = (m: Partial<Record<StopReason, number>>) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ") || "-";

export function buildDailyReport(d: DailyReportData): { subject: string; html: string; text: string } {
  const subject = `[HRMS] Qualified follow-up daily report ${d.date} (${d.mode})`;
  const head = ["Source", "Enqueued", "Emailed", "Email failed", "WhatsApp sent", "WhatsApp failed", "Call in file", "Call queued", "Called", "Stopped"];
  const cells = (p: DailyReportData["perSource"][number]) => [p.sourceType, p.enqueued, p.emailed, p.emailFailed, p.whatsapped, p.waFailed, p.callInFile, p.callQueued, p.called, stoppedText(p.stopped)];
  const table = `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse"><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${
    d.perSource.map((p) => `<tr>${cells(p).map((c) => `<td>${esc(String(c))}</td>`).join("")}</tr>`).join("")}</table>`;
  const skipHtml = d.skipped.map((s) => `<h4>${esc(s.reason)}: ${s.count}</h4>${s.examples.length
    ? `<ul>${s.examples.map((e) => `<li>${esc(e.name)}, ${esc(e.mobileMasked)}, ${esc(e.requisition)}</li>`).join("")}</ul>` : ""}`).join("");
  const failHtml = d.waFailuresByCode.length
    ? `<ul>${d.waFailuresByCode.map((f) => `<li><b>${esc(f.code)}</b> x${f.count}: ${esc(f.sample)}</li>`).join("")}</ul>` : "<p>None.</p>";
  const html = `<h3>Qualified follow-up, last 24 hours to ${esc(d.date)} 08:30 IST (${esc(d.mode)})</h3>${table}<h3>Skipped</h3>${skipHtml}<h3>WhatsApp failures by Meta code</h3>${failHtml}`;
  const text = [
    `Qualified follow-up, last 24 hours to ${d.date} 08:30 IST (${d.mode})`, "",
    ...d.perSource.map((p) => cells(p).map((c, i) => `${head[i]} ${c}`).join(" | ").replace(/^Source /, "")),
    "", "Skipped",
    ...d.skipped.flatMap((s) => [`${s.reason}: ${s.count}`, ...s.examples.map((e) => `  ${e.name}, ${e.mobileMasked}, ${e.requisition}`)]),
    "", "WhatsApp failures by Meta code",
    ...(d.waFailuresByCode.length ? d.waFailuresByCode.map((f) => `${f.code} x${f.count}: ${f.sample}`) : ["None."]),
  ].join("\n");
  return { subject, html, text };
}

/** Window = the 24 hours before `now`. true = sent (or dry-run handled); false = failed, nothing lost, the worker may retry. */
export async function runDailyReport(s: FollowupSwitches, tag: RowTag, now: Date): Promise<boolean> {
  const to = tag === "test" ? s.testEmail : s.callFileTo;
  if (tag !== "dry_run" && !to) {
    logger.error("[qualified-followup] daily report has no recipient");
    return false;
  }
  let report: ReturnType<typeof buildDailyReport>;
  try {
    report = buildDailyReport(await collectDailyReport(new Date(now.getTime() - 24 * 3600_000), now, tag));
  } catch (err) {
    logger.error({ err: scrub((err as Error)?.message).slice(0, 255) }, "[qualified-followup] daily report selection failed");
    return false;
  }
  if (tag === "dry_run") {
    logger.info({ subject: report.subject }, "[qualified-followup] daily report (dry run, nothing sent)");
    return true;
  }
  try {
    await emailService.send({ to: to as string, subject: report.subject, html: report.html, text: report.text });
  } catch (err) {
    logger.warn({ err: scrub((err as Error)?.message).slice(0, 255) }, "[qualified-followup] daily report email failed");
    return false;
  }
  logger.info({ subject: report.subject }, "[qualified-followup] daily report sent");
  return true;
}
