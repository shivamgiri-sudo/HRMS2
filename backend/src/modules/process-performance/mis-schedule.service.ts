import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { emailService } from "../communication/email.service.js";
import { buildDashboardExcel, isKnownDashboard } from "./dashboard-export.service.js";
import { buildMisExcel, getMisCompanies } from "./mis-export.service.js";

/**
 * Scheduled MIS email: a schedule names a process dashboard, who it goes to (To / CC), a
 * free-text body written by the sender, and when to send. At the due time the worker builds
 * the dashboard's raw-data Excel for the schedule's period and mails it.
 *
 * Times are server-local (same clock as daily-brief.cron.ts and the other schedulers). Due
 * times are stored and compared as local "YYYY-MM-DD HH:mm:ss" text so no timezone conversion
 * happens in the database driver.
 *
 * Not in the attachment: the on-screen KPI slides are computed in the browser and cannot be
 * rebuilt on the server, so the scheduled file carries the raw-data sheets and their notes.
 *
 * A dashboard key of "mis:<company>" schedules that company's whole MIS report instead: the
 * attachment is built by buildMisExcel, the same workbook the MIS tab's "Download MIS Report"
 * button downloads (KPI summary sheets + raw data), with the schedule's report title as the
 * company label.
 */

export const FREQUENCIES = ["once", "daily", "weekly"] as const;
export const RANGE_MODES = ["mtd", "yesterday", "last_7_days", "fixed"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export type RangeMode = (typeof RANGE_MODES)[number];

export const MAX_RECIPIENTS = 25;
const MAX_SUBJECT = 200;
const MAX_BODY = 5000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const LEASE_MINUTES = 10;
const MIS_KEY_RE = /^mis:([a-z_]{1,40})$/;

/** The company key of an MIS-report schedule ("mis:bellavita" -> "bellavita"), else null. */
export function misCompanyOf(dashboardKey: string): string | null {
  return MIS_KEY_RE.exec(dashboardKey)?.[1] ?? null;
}

export interface ScheduleInput {
  dashboardKey: string;
  reportTitle: string;
  lob: string | null;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  rangeMode: RangeMode;
  rangeFrom: string | null;
  rangeTo: string | null;
  frequency: Frequency;
  sendTime: string;
  sendOnDate: string | null;
  weekday: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Splits "a@x.com, b@y.com; c@z.com" into a deduplicated, lower-cased list. */
export function parseRecipients(raw: unknown, label: string, required: boolean): Parsed<string[]> {
  const text = String(raw ?? "").trim();
  if (!text) return required ? { ok: false, error: `${label} needs at least one email address.` } : { ok: true, value: [] };
  const list: string[] = [];
  for (const piece of text.split(/[,;\s]+/).filter(Boolean)) {
    const email = piece.toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, error: `"${piece}" in ${label} is not a valid email address.` };
    if (!list.includes(email)) list.push(email);
  }
  return { ok: true, value: list };
}

export function parseScheduleInput(body: unknown): Parsed<ScheduleInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const dashboardKey = String(b.dashboardKey ?? "").slice(0, 60);
  if (!isKnownDashboard(dashboardKey) && !misCompanyOf(dashboardKey)) return { ok: false, error: `Unknown dashboard "${dashboardKey}".` };

  const to = parseRecipients(b.to, "To", true);
  if (!to.ok) return to;
  const cc = parseRecipients(b.cc, "CC", false);
  if (!cc.ok) return cc;
  const all = [...to.value, ...cc.value.filter((e) => !to.value.includes(e))];
  if (all.length > MAX_RECIPIENTS) return { ok: false, error: `At most ${MAX_RECIPIENTS} recipients per schedule.` };

  const subject = String(b.subject ?? "").trim().slice(0, MAX_SUBJECT);
  if (!subject) return { ok: false, error: "Subject is required." };
  const bodyText = String(b.bodyText ?? "").slice(0, MAX_BODY);
  if (!bodyText.trim()) return { ok: false, error: "Body is required." };

  const frequency = String(b.frequency ?? "") as Frequency;
  if (!FREQUENCIES.includes(frequency)) return { ok: false, error: "Frequency must be once, daily or weekly." };

  const rangeMode = String(b.rangeMode ?? "mtd") as RangeMode;
  if (!RANGE_MODES.includes(rangeMode)) return { ok: false, error: "Period must be month-to-date, yesterday, last 7 days or a fixed range." };
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;
  if (rangeMode === "fixed") {
    rangeFrom = String(b.rangeFrom ?? "");
    rangeTo = String(b.rangeTo ?? "");
    if (!DATE_RE.test(rangeFrom) || !DATE_RE.test(rangeTo)) return { ok: false, error: "A fixed period needs From and To dates." };
    if (rangeFrom > rangeTo) [rangeFrom, rangeTo] = [rangeTo, rangeFrom];
  }

  const sendTime = String(b.sendTime ?? "");
  if (!TIME_RE.test(sendTime)) return { ok: false, error: "Send time must be HH:mm." };

  let sendOnDate: string | null = null;
  let weekday: number | null = null;
  if (frequency === "once") {
    sendOnDate = String(b.sendOnDate ?? "");
    if (!DATE_RE.test(sendOnDate)) return { ok: false, error: "A one-time send needs a date." };
  }
  if (frequency === "weekly") {
    const w = Number(b.weekday);
    if (!Number.isInteger(w) || w < 0 || w > 6) return { ok: false, error: "A weekly send needs a weekday." };
    weekday = w;
  }

  const lob = b.lob ? String(b.lob).slice(0, 60) : null;
  const reportTitle = String(b.reportTitle ?? dashboardKey).slice(0, 160) || dashboardKey;

  return {
    ok: true,
    value: {
      dashboardKey, reportTitle, lob, to: to.value, cc: cc.value, subject, bodyText, rangeMode,
      rangeFrom, rangeTo, frequency, sendTime, sendOnDate, weekday,
    },
  };
}

// ---------- time helpers (server-local, pure) ----------

const pad = (n: number) => String(n).padStart(2, "0");
export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtLocal = (d: Date) => `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function atTime(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
  return d;
}

/** First due time for a new schedule, or null when a one-time send is already in the past. */
export function computeFirstRun(
  now: Date, frequency: Frequency, sendTime: string, sendOnDate: string | null, weekday: number | null,
): string | null {
  if (frequency === "once") {
    if (!sendOnDate) return null;
    const [y, mo, d] = sendOnDate.split("-").map(Number);
    const at = atTime(new Date(y, mo - 1, d), sendTime);
    return at.getTime() > now.getTime() ? fmtLocal(at) : null;
  }
  if (frequency === "daily") {
    let at = atTime(now, sendTime);
    if (at.getTime() <= now.getTime()) at = atTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), sendTime);
    return fmtLocal(at);
  }
  // weekly: the next matching weekday strictly after now
  let day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 8; i++) {
    const at = atTime(day, sendTime);
    if (day.getDay() === weekday && at.getTime() > now.getTime()) return fmtLocal(at);
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return null;
}

/** Next due time after a run that was due at `previous`. Null when the schedule is finished. */
export function advanceRun(previous: string, frequency: Frequency, sendTime: string): string | null {
  if (frequency === "once") return null;
  const [datePart] = previous.split(" ");
  const [y, mo, d] = datePart.split("-").map(Number);
  const step = frequency === "daily" ? 1 : 7;
  return fmtLocal(atTime(new Date(y, mo - 1, d + step), sendTime));
}

/** The period a run covers, resolved at send time. */
export function resolvePeriod(mode: RangeMode, now: Date, from: string | null, to: string | null): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (mode === "fixed" && from && to) return { from, to };
  if (mode === "yesterday") return { from: fmtDate(yesterday), to: fmtDate(yesterday) };
  if (mode === "last_7_days") return { from: fmtDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7)), to: fmtDate(yesterday) };
  return { from: fmtDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmtDate(today) };
}

export function bodyToHtml(text: string, scheduleId: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">${esc(text).replace(/\r?\n/g, "<br>")}`
    + `<p style="margin-top:24px;font-size:11px;color:#94a3b8">Sent automatically by MAS Callnet HRMS (schedule ${scheduleId}). The attached Excel holds the report for the period stated in the file.</p></div>`;
}

// ---------- persistence ----------

export interface ScheduleRow extends RowDataPacket {
  id: string;
  dashboard_key: string;
  report_title: string;
  lob: string | null;
  to_addresses: string;
  cc_addresses: string | null;
  subject: string;
  body_text: string;
  range_mode: RangeMode;
  range_from: Date | string | null;
  range_to: Date | string | null;
  frequency: Frequency;
  send_time: string;
  send_on_date: Date | string | null;
  weekday: number | null;
  status: "active" | "paused" | "completed" | "cancelled";
  next_run_at: string | null;
  claimed_until: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_by: string;
  created_at: Date;
}

const SCHEDULE_COLUMNS = `id, dashboard_key, report_title, lob, to_addresses, cc_addresses, subject, body_text, range_mode,
  range_from, range_to, frequency, send_time, send_on_date, weekday, status, next_run_at, claimed_until,
  last_run_at, last_status, last_error, created_by, created_at`;

const dateOnly = (v: Date | string | null): string | null => {
  if (!v) return null;
  if (v instanceof Date) return fmtDate(v);
  return String(v).slice(0, 10);
};

export function toApi(r: ScheduleRow) {
  return {
    id: r.id,
    dashboardKey: r.dashboard_key,
    reportTitle: r.report_title,
    lob: r.lob,
    to: r.to_addresses.split(",").filter(Boolean),
    cc: (r.cc_addresses ?? "").split(",").filter(Boolean),
    subject: r.subject,
    bodyText: r.body_text,
    rangeMode: r.range_mode,
    rangeFrom: dateOnly(r.range_from),
    rangeTo: dateOnly(r.range_to),
    frequency: r.frequency,
    sendTime: r.send_time,
    sendOnDate: dateOnly(r.send_on_date),
    weekday: r.weekday,
    status: r.status,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? fmtLocal(r.created_at) : String(r.created_at),
  };
}

export async function createSchedule(input: ScheduleInput, createdBy: string): Promise<{ id: string; nextRunAt: string | null }> {
  const company = misCompanyOf(input.dashboardKey);
  if (company) {
    const companies = await getMisCompanies();
    if (!companies[company]?.length) throw new Error(`No MIS report is configured for "${company}".`);
  }
  const now = new Date();
  const nextRunAt = computeFirstRun(now, input.frequency, input.sendTime, input.sendOnDate, input.weekday);
  if (!nextRunAt) throw new Error("That send time is already in the past. Pick a later time or date.");
  const id = randomUUID();
  await db.execute(
    `INSERT INTO mis_email_schedule
       (id, dashboard_key, report_title, lob, to_addresses, cc_addresses, subject, body_text, range_mode, range_from, range_to,
        frequency, send_time, send_on_date, weekday, status, next_run_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      id, input.dashboardKey, input.reportTitle, input.lob, input.to.join(","), input.cc.join(",") || null,
      input.subject, input.bodyText, input.rangeMode, input.rangeFrom, input.rangeTo, input.frequency,
      input.sendTime, input.sendOnDate, input.weekday, nextRunAt, createdBy,
    ],
  );
  return { id, nextRunAt };
}

export async function listSchedules(dashboardKey?: string): Promise<ReturnType<typeof toApi>[]> {
  const [rows] = await db.execute<ScheduleRow[]>(
    `SELECT ${SCHEDULE_COLUMNS} FROM mis_email_schedule
      WHERE (? IS NULL OR dashboard_key = ?)
      ORDER BY created_at DESC LIMIT 200`,
    [dashboardKey ?? null, dashboardKey ?? null],
  );
  return rows.map(toApi);
}

export async function getScheduleDetail(id: string) {
  const [rows] = await db.execute<ScheduleRow[]>(`SELECT ${SCHEDULE_COLUMNS} FROM mis_email_schedule WHERE id = ?`, [id]);
  if (!rows[0]) return null;
  const [runs] = await db.execute<RowDataPacket[]>(
    `SELECT id, trigger_type, started_at, finished_at, status, period_from, period_to, to_addresses, cc_addresses,
            attachment_rows, message_id, error
       FROM mis_email_schedule_run WHERE schedule_id = ? ORDER BY started_at DESC LIMIT 20`,
    [id],
  );
  return {
    schedule: toApi(rows[0]),
    runs: runs.map((r) => ({
      id: r.id, trigger: r.trigger_type, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status,
      periodFrom: dateOnly(r.period_from), periodTo: dateOnly(r.period_to),
      to: String(r.to_addresses).split(",").filter(Boolean), cc: String(r.cc_addresses ?? "").split(",").filter(Boolean),
      attachmentRows: r.attachment_rows, messageId: r.message_id, error: r.error,
    })),
  };
}

export async function setScheduleStatus(id: string, status: "active" | "paused" | "cancelled"): Promise<boolean> {
  const [res] = await db.executeRun(
    `UPDATE mis_email_schedule
        SET status = ?,
            next_run_at = CASE WHEN ? = 'active' THEN next_run_at ELSE NULL END
      WHERE id = ? AND status IN ('active','paused')`,
    [status, status, id],
  );
  return (res as unknown as { affectedRows: number }).affectedRows === 1;
}

/** Resume a paused schedule: next run is recalculated from now, never the stale pre-pause time. */
export async function resumeSchedule(id: string): Promise<"resumed" | "not_paused" | "not_found" | "past"> {
  const [rows] = await db.execute<ScheduleRow[]>(`SELECT ${SCHEDULE_COLUMNS} FROM mis_email_schedule WHERE id = ?`, [id]);
  const row = rows[0];
  if (!row) return "not_found";
  if (row.status !== "paused") return "not_paused";
  const next = computeFirstRun(new Date(), row.frequency, row.send_time, dateOnly(row.send_on_date), row.weekday);
  if (!next) return "past";
  await db.execute(`UPDATE mis_email_schedule SET status = 'active', next_run_at = ? WHERE id = ? AND status = 'paused'`, [next, id]);
  return "resumed";
}

/** Sends one schedule now. Used by the worker (trigger "scheduled") and by Run now (trigger "manual"). */
export async function sendSchedule(
  row: ScheduleRow, trigger: "scheduled" | "manual", now: Date,
): Promise<{ status: "sent" | "failed"; error?: string; attachmentBytes?: number }> {
  const runId = randomUUID();
  const startedAt = fmtLocal(now);
  const period = resolvePeriod(row.range_mode, now, dateOnly(row.range_from), dateOnly(row.range_to));
  const toList = row.to_addresses;
  const ccList = row.cc_addresses ?? null;
  const tmpPath = path.join(os.tmpdir(), `mis-schedule-${runId}.xlsx`);
  let status: "sent" | "failed" = "sent";
  let error: string | undefined;
  let messageId: string | undefined;
  let attachmentRows: number | null = null;
  let attachmentBytes: number | undefined;

  try {
    if (!emailService.isConfigured()) throw new Error("SMTP is not configured on this server.");
    const company = misCompanyOf(row.dashboard_key);
    const { raw } = company
      ? await buildMisExcel(company, row.report_title, period.from, period.to, tmpPath)
      : await buildDashboardExcel({
        dashboard: row.dashboard_key, reportTitle: row.report_title, slides: [], lob: row.lob ?? undefined,
        from: period.from, to: period.to,
      }, tmpPath);
    attachmentRows = raw.reduce((s, r) => s + (r.rowsExported ?? 0), 0);
    const attachment = fs.readFileSync(tmpPath);
    attachmentBytes = attachment.length;
    const sent = await emailService.send({
      to: toList,
      cc: ccList ?? undefined,
      subject: row.subject,
      html: bodyToHtml(row.body_text, row.id),
      text: `${row.body_text}\n\n(Schedule ${row.id})`,
      attachments: [{
        // MIS reports keep the MIS tab's download name ("<company>_MIS_<to>.xlsx").
        filename: company ? `${company}_MIS_${period.to}.xlsx` : `${row.dashboard_key}_${period.from}_to_${period.to}.xlsx`,
        content: attachment,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }],
    });
    messageId = sent.messageId;
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  } finally {
    fs.promises.unlink(tmpPath).catch(() => undefined);
  }

  await db.execute(
    `INSERT INTO mis_email_schedule_run
       (id, schedule_id, trigger_type, started_at, finished_at, status, period_from, period_to, to_addresses, cc_addresses,
        attachment_rows, message_id, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, row.id, trigger, startedAt, fmtLocal(new Date()), status, period.from, period.to, toList, ccList,
      attachmentRows, messageId ?? null, error ?? null],
  );
  return { status, error, attachmentBytes };
}

/**
 * Worker tick: claims every due schedule (lease in the row, so two backends cannot send the
 * same run), sends it, then moves it to its next run or completes it. A failed send is recorded
 * and the schedule still advances, so a broken SMTP setting cannot cause a send storm.
 */
export async function processDueSchedules(now: Date = new Date()): Promise<number> {
  const nowText = fmtLocal(now);
  const [due] = await db.execute<ScheduleRow[]>(
    `SELECT ${SCHEDULE_COLUMNS} FROM mis_email_schedule
      WHERE status = 'active' AND next_run_at <= ? AND (claimed_until IS NULL OR claimed_until < ?)
      ORDER BY next_run_at LIMIT 20`,
    [nowText, nowText],
  );
  let sent = 0;
  for (const row of due) {
    const lease = fmtLocal(new Date(now.getTime() + LEASE_MINUTES * 60_000));
    const [claim] = await db.executeRun(
      `UPDATE mis_email_schedule SET claimed_until = ?
        WHERE id = ? AND status = 'active' AND next_run_at = ? AND (claimed_until IS NULL OR claimed_until < ?)`,
      [lease, row.id, row.next_run_at, nowText],
    );
    if ((claim as unknown as { affectedRows: number }).affectedRows !== 1) continue;

    const result = await sendSchedule(row, "scheduled", new Date());
    const next = row.frequency === "once" ? null : advanceRun(row.next_run_at as string, row.frequency, row.send_time);
    await db.execute(
      `UPDATE mis_email_schedule
          SET next_run_at = ?, claimed_until = NULL,
              status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END,
              last_run_at = ?, last_status = ?, last_error = ?
        WHERE id = ?`,
      [next, next, fmtLocal(new Date()), result.status, result.error ?? null, row.id],
    );
    if (result.status === "sent") sent += 1;
  }
  return sent;
}

/** Run now: sends immediately without moving the scheduled time. Only for schedules still active or paused. */
export async function runScheduleNow(id: string): Promise<{ status: "sent" | "failed"; error?: string; attachmentBytes?: number } | null> {
  const [rows] = await db.execute<ScheduleRow[]>(`SELECT ${SCHEDULE_COLUMNS} FROM mis_email_schedule WHERE id = ?`, [id]);
  const row = rows[0];
  if (!row) return null;
  if (row.status === "cancelled" || row.status === "completed") return { status: "failed", error: `Schedule is ${row.status}.` };
  return sendSchedule(row, "manual", new Date());
}
