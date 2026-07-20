import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";

type CandidateRow = Record<string, unknown>;

type Period = "FTD" | "WTD" | "MTD" | "ALL";

interface ConfigSettingRow extends RowDataPacket {
  setting: string;
  value_text: string | null;
}

interface EmailTemplateRow extends RowDataPacket {
  subject: string;
  body: string;
}

interface CandidateLookupRow extends RowDataPacket {
  id: string;
  candidate_code?: string | null;
  full_name?: string | null;
  email?: string | null;
  address?: string | null;
  education?: string | null;
  experience?: string | null;
  gender?: string | null;
}

interface RecruiterRosterRow extends RowDataPacket {
  id: string;
  name: string;
  recruiter_code?: string | null;
  email?: string | null;
  branch?: string | null;
  employee_id?: string | null;
  assigned_today?: number;
  last_assigned_at?: string | null;
  daily_capacity?: number;
  role_coverage?: string | null;
}

interface RecruiterContactRow extends RowDataPacket {
  reporting_manager?: string | null;
  branch_head_email?: string | null;
}

interface CountRow extends RowDataPacket {
  cnt: number;
}

interface CandidateIdRow extends RowDataPacket {
  id: string;
}

const STATUS_WAITING = "Waiting";
const OPEN_STATUSES = new Set(["Waiting", "In Progress", "Hold", "Selected"]);
const OPEN_QUEUE_STAGES = new Set(["", "Arrival", "HR Screening", "Assessment", "OP's Round", "Ops Round", "Client Round", "New", "Screening"]);

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST || "",
  port: Number(env.SMTP_PORT || 587),
  secure: false,
  auth: { user: env.SMTP_USER || "", pass: env.SMTP_PASS || "" },
});

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function rowText(row: CandidateRow, key: string): string {
  return normalizeText(row[key]);
}

function rowDate(value: unknown): Date | null {
  return typeof value === "string" || typeof value === "number" || value instanceof Date ? parseDate(value) : null;
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function yes(value: unknown): boolean {
  return ["yes", "true", "y", "1"].includes(normalizeLower(value));
}

function contains(value: unknown, patterns: string[]): boolean {
  const text = normalizeLower(value);
  return patterns.some((p) => text.includes(p));
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function parseCandidateDate(row: CandidateRow): Date | null {
  if (row.created_date) {
    const datePart = String(row.created_date).slice(0, 10);
    const timePart = row.created_time ? String(row.created_time).slice(0, 8) : "00:00:00";
    const d = new Date(`${datePart}T${timePart}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return parseDate(row.walk_in_date) || parseDate(row.created_at);
}

function minutesBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function formatDuration(min: number): string {
  if (!min) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function slotLabel(value: unknown): string {
  const text = normalizeText(value);
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return "Unspecified";
  const hour = Number(match[1]);
  if (hour < 10) return "Before 10 AM";
  if (hour < 12) return "10 AM - 12 PM";
  if (hour < 14) return "12 PM - 2 PM";
  if (hour < 16) return "2 PM - 4 PM";
  if (hour < 18) return "4 PM - 6 PM";
  return "After 6 PM";
}

function roundSuccessCount(row: CandidateRow): number {
  let count = 0;
  if (contains(row.round1_result, ["selected"])) count++;
  if (contains(row.skilltest_result, ["selected"])) count++;
  if (contains(row.round2_result, ["selected"])) count++;
  if (contains(row.round3_result, ["selected"])) count++;
  return count;
}

function hardRejectReason(row: CandidateRow): string {
  const text = [
    row.round1_voc, row.skilltest_voc, row.round2_voc, row.round3_voc,
    row.final_remarks, row.remarks, row.final_decision, row.status, row.walkin_end_stage,
  ].join(" ").toLowerCase();
  const patterns = ["not interested", "salary mismatch", "document", "documents", "communication", "behavior", "behaviour", "location issue", "location not okay", "abscond", "fake", "fraud"];
  return patterns.find((p) => text.includes(p)) || "";
}

function qualityLabel(score: number): string {
  if (score >= 80) return "High";
  if (score >= 60) return "Medium";
  return "Low";
}

function handlingLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs Focus";
  return "Critical";
}

function candidateQualityScore(row: CandidateRow): number {
  let score = 50;
  score += Math.min(20, roundSuccessCount(row) * 5);
  if (contains(row.final_decision || row.status, ["selected"])) score += 20;
  if (contains(row.final_decision || row.status, ["hold"])) score += 5;
  if (contains(row.final_decision || row.status, ["rejected"])) score -= 5;
  if (contains(row.walkin_end_stage, ["no show", "noshow"])) score -= 28;
  if (contains(row.walkin_end_stage, ["walkout", "dropout", "walk out", "drop out"])) score -= 18;
  if (hardRejectReason(row)) score -= 12;
  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

function handlingQualityScore(row: CandidateRow): number {
  const min = Number(row._totalMinutes ?? row.aht_minutes ?? 0);
  let score = 100;
  if (row._slaBreached || row.sla_breached) score -= 30;
  if (min > 120) score -= 20;
  else if (min > 90) score -= 10;
  if (!normalizeText(row.recruiter_assigned_name)) score -= 25;
  if (contains(row.walkin_end_stage, ["no show", "walkout", "dropout"])) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

function reusableReason(row: CandidateRow): string {
  if (contains(row.final_decision || row.status, ["selected"])) return "Selected candidate - keep warm till joining";
  if (contains(row.final_decision || row.status, ["hold"])) return "Hold candidate - reusable after follow-up";
  if (contains(row.walkin_end_stage, ["no show"])) return "No show - reattempt confirmation call";
  const hard = hardRejectReason(row);
  if (hard) return `Not reusable unless resolved: ${hard}`;
  if (roundSuccessCount(row) >= 2) return "Passed multiple rounds - reusable for similar process";
  return "General pool candidate";
}

function enrichCandidate(row: CandidateRow): CandidateRow {
  const createdAt = parseCandidateDate(row);
  const now = new Date();
  const status = normalizeText(row.status || row.current_stage || "");
  const finalDecision = normalizeText(row.final_decision || row.current_stage || "");
  const endStage = normalizeText(row.walkin_end_stage || row.current_stage || "");
  const totalMinutes = row.aht_minutes != null ? Number(row.aht_minutes) : minutesBetween(createdAt, parseDate(row.hr_form_submission_time || row.updated_at) || now);
  const selected = contains(finalDecision || status, ["selected"]);
  const rejected = contains(finalDecision || status, ["rejected"]);
  const onHold = contains(finalDecision || status, ["hold"]);
  const waiting = contains(status, ["waiting", "new", "screening"]);
  const noShow = contains(endStage, ["no show", "noshow"]);
  const walkout = contains(endStage, ["walkout", "dropout", "walk out", "drop out"]);
  const qScore = candidateQualityScore(row);
  const hScore = handlingQualityScore({ ...row, _totalMinutes: totalMinutes });
  return {
    ...row,
    CandidateID: row.candidate_code || row.candidate_id || row.id,
    QToken: row.q_token,
    FullName: row.full_name,
    Branch: row.branch_text || row.applied_for_branch,
    RoleApplied: row.role_applied || row.applied_for_process,
    Process: row.process_text || row.applied_for_process,
    RecruiterAssignedName: row.recruiter_assigned_name || row.recruiter_name,
    RecruiterEmail: row.recruiter_email,
    RecruiterMobile: row.recruiter_mobile,
    CurrentStage: row.walkin_end_stage || row.current_stage,
    Status: status || "Waiting",
    WaitingMinutes: waiting ? totalMinutes : 0,
    SLAFlag: row.sla_breached ? "Yes" : "No",
    Email: row.email,
    _createdAt: createdAt ? createdAt.toISOString() : null,
    _dateKey: createdAt ? formatDateKey(createdAt) : "",
    _monthKey: createdAt ? monthKey(createdAt) : "",
    _weekKey: createdAt ? formatDateKey(startOfWeek(createdAt)) : "",
    _role: row.role_applied || row.applied_for_process || "Unspecified",
    _branch: row.branch_text || row.applied_for_branch || "Unspecified",
    _process: row.process_text || row.applied_for_process || "Unspecified",
    _recruiter: row.recruiter_assigned_name || row.recruiter_name || "Unassigned",
    _sourcer: row.recruiter_selected || row.referred_by || "Unspecified",
    _source: row.source_details || row.sourcing_channel || row.recruiter_selected || row.referred_by || "Unspecified",
    _slot: row.walkin_slot || slotLabel(row.created_time || row.created_at),
    _status: status,
    _finalDecision: finalDecision,
    _endStage: endStage,
    _totalMinutes: totalMinutes,
    _slaBreached: !!row.sla_breached,
    _selected: selected,
    _rejected: rejected,
    _onHold: onHold,
    _waiting: waiting,
    _noShow: noShow,
    _walkout: walkout,
    _roundSuccessCount: roundSuccessCount(row),
    _hardRejectReason: hardRejectReason(row),
    _candidateQualityScore: qScore,
    _candidateQualityLabel: qualityLabel(qScore),
    _handlingQualityScore: hScore,
    _handlingQualityLabel: handlingLabel(hScore),
    _reusableReason: reusableReason(row),
  };
}

function inPeriod(row: CandidateRow, period: Period, now = new Date()): boolean {
  if (period === "ALL") return true;
  const d = rowDate(row._createdAt) ?? parseCandidateDate(row);
  if (!d) return false;
  if (period === "FTD") return formatDateKey(d) === formatDateKey(now);
  if (period === "WTD") return d >= startOfWeek(now) && d <= now;
  if (period === "MTD") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  return true;
}

function summarizeRows(rows: CandidateRow[]) {
  const totalArrival = rows.length;
  const totalSelection = rows.filter((r) => r._selected).length;
  const totalRejection = rows.filter((r) => r._rejected).length;
  const onHold = rows.filter((r) => r._onHold).length;
  const waiting = rows.filter((r) => r._waiting).length;
  const noShow = rows.filter((r) => r._noShow).length;
  const walkout = rows.filter((r) => r._walkout).length;
  const clientRoundPending = rows.filter((r) => contains(r._endStage || r.CurrentStage, ["client round"] ) && !r._selected && !r._rejected).length;
  const slaBreach = rows.filter((r) => r._slaBreached).length;
  const avgWaitMinutes = rows.length ? Math.round(rows.reduce((a, r) => a + Number(r._totalMinutes || 0), 0) / rows.length) : 0;
  return {
    totalArrival,
    totalSelection,
    totalRejection,
    selection: totalSelection,
    rejection: totalRejection,
    onHold,
    waiting,
    noShow,
    walkout,
    clientRoundPending,
    pending: waiting + clientRoundPending,
    slaBreach,
    avgWaitMinutes,
    selectionRate: totalArrival ? Math.round((totalSelection / totalArrival) * 1000) / 10 : 0,
    rejectionRate: totalArrival ? Math.round((totalRejection / totalArrival) * 1000) / 10 : 0,
    slaBreachRate: totalArrival ? Math.round((slaBreach / totalArrival) * 1000) / 10 : 0,
  };
}

function groupBy<T extends Record<string, unknown>>(rows: T[], key: string): Record<string, T[]> {
  return rows.reduce((acc, row) => {
    const k = normalizeText(row[key]) || "Unspecified";
    (acc[k] ||= []).push(row);
    return acc;
  }, {} as Record<string, T[]>);
}

function dimensionTable(rows: CandidateRow[], key: string, nameKey = "Name") {
  return Object.entries(groupBy(rows, key)).map(([name, items]) => ({
    [nameKey]: name,
    Dimension: name,
    TotalArrival: items.length,
    Selection: items.filter((r) => r._selected).length,
    Rejection: items.filter((r) => r._rejected).length,
    Waiting: items.filter((r) => r._waiting).length,
    OnHold: items.filter((r) => r._onHold).length,
    ClientRoundPending: items.filter((r) => contains(r._endStage || r.CurrentStage, ["client round"]) && !r._selected && !r._rejected).length,
    NoShow: items.filter((r) => r._noShow).length,
    SlaBreach: items.filter((r) => r._slaBreached).length,
    AvgWaitMinutes: items.length ? Math.round(items.reduce((a, r) => a + Number(r._totalMinutes || 0), 0) / items.length) : 0,
    SelectionRate: items.length ? Math.round((items.filter((r) => r._selected).length / items.length) * 1000) / 10 : 0,
    PendingRate: items.length ? Math.round(((items.filter((r) => r._waiting).length) / items.length) * 1000) / 10 : 0,
  })).sort((a, b) => Number(b.TotalArrival) - Number(a.TotalArrival));
}

function recruiterProductivity(rows: CandidateRow[]) {
  return Object.entries(groupBy(rows, "_recruiter")).map(([recruiter, items]) => {
    const attended = items.filter((r) => !r._waiting || r._selected || r._rejected || r._onHold).length;
    const sourced = items.length;
    const selection = items.filter((r) => r._selected).length;
    const breach = items.filter((r) => r._slaBreached).length;
    const avgWait = sourced ? Math.round(items.reduce((a, r) => a + Number(r._totalMinutes || 0), 0) / sourced) : 0;
    const selectionRate = sourced ? Math.round((selection / sourced) * 1000) / 10 : 0;
    const slaCompliancePercent = sourced ? Math.round(((sourced - breach) / sourced) * 1000) / 10 : 0;
    const handlingQualityScore = sourced ? Math.round(items.reduce((a, r) => a + Number(r._handlingQualityScore || 0), 0) / sourced) : 0;
    const qualityScore = sourced ? Math.round(items.reduce((a, r) => a + Number(r._candidateQualityScore || 0), 0) / sourced) : 0;
    let attentionFlag = "Stable";
    if (breach >= 3 || avgWait >= 120) attentionFlag = "High Attention";
    else if (slaCompliancePercent < 70 || selectionRate < 15) attentionFlag = "Needs Coaching";
    return {
      Recruiter: recruiter,
      Branch: normalizeText(items[0]?._branch) || "Unspecified",
      SourcedCount: sourced,
      AttendedCount: attended,
      SlaCompliancePercent: slaCompliancePercent,
      SelectionRate: selectionRate,
      AvgWaitMinutes: avgWait,
      AttentionFlag: attentionFlag,
      QualityScore: qualityScore,
      HandlingScore: handlingQualityScore,
      FTD_Assigned: items.filter((r) => inPeriod(r, "FTD")).length,
      WTD_Assigned: items.filter((r) => inPeriod(r, "WTD")).length,
      MTD_Assigned: items.filter((r) => inPeriod(r, "MTD")).length,
      MTD_SelectionRate: selectionRate,
      MTD_BreachRate: sourced ? Math.round((breach / sourced) * 1000) / 10 : 0,
      MTD_HandlingScore: handlingQualityScore,
    };
  }).sort((a, b) => b.SourcedCount - a.SourcedCount);
}

function buildOptions(candidates: CandidateRow[], queue: CandidateRow[]) {
  const uniq = (key: string) => Array.from(new Set(candidates.concat(queue).map((r) => normalizeText(r[key])).filter(Boolean))).sort();
  return {
    branches: uniq("_branch"),
    processes: uniq("_process"),
    roles: uniq("_role"),
    recruiters: uniq("_recruiter"),
    sources: uniq("_source"),
    statuses: uniq("_status"),
    months: uniq("_monthKey"),
    slots: uniq("_slot"),
  };
}

async function audit(action: string, candidateId?: string | null, details?: string, actor = "SYSTEM") {
  await db.execute(
    `INSERT INTO ats_command_audit_log (id, actor, action, candidate_id, details) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), actor, action, candidateId ?? null, details ?? null]
  );
}

async function getConfigMap(): Promise<Record<string, string>> {
  const [rows] = await db.execute<ConfigSettingRow[]>(`SELECT setting, value_text FROM ats_command_config`);
  return Object.fromEntries(rows.map((r) => [r.setting, String(r.value_text ?? "")]));
}

function template(text: string, replacements: Record<string, unknown>): string {
  return Object.entries(replacements).reduce((out, [k, v]) => out.replace(new RegExp(`{{${k}}}`, "g"), String(v ?? "")), text);
}

async function logEmail(candidateId: string | null, emailType: string, to: string, cc: string, subject: string, status: "pending" | "sent" | "failed" | "skipped", notes?: string) {
  await db.execute(
    `INSERT INTO ats_command_email_log (id, candidate_id, email_type, sent_to, cc, subject, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE sent_to=VALUES(sent_to), cc=VALUES(cc), subject=VALUES(subject), status=VALUES(status), notes=VALUES(notes), created_at=NOW()`,
    [randomUUID(), candidateId, emailType, to, cc || null, subject, status, notes ?? null]
  );
}

async function sendTemplateEmail(code: string, candidateId: string | null, to: string, cc: string, replacements: Record<string, unknown>) {
  const [rows] = await db.execute<EmailTemplateRow[]>(`SELECT * FROM ats_email_template WHERE template_code = ? AND active_status = 1 LIMIT 1`, [code]);
  const tpl = rows[0];
  if (!tpl) {
    await logEmail(candidateId, code, to, cc, code, "skipped", "Missing template");
    return { ok: true, skipped: true };
  }
  const subject = template(String(tpl.subject), replacements);
  const html = template(String(tpl.body), replacements).replace(/\n/g, "<br>");
  if (!to) {
    await logEmail(candidateId, code, to, cc, subject, "skipped", "Missing TO email");
    return { ok: true, skipped: true };
  }
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    await logEmail(candidateId, code, to, cc, subject, "skipped", "SMTP not configured");
    return { ok: true, skipped: true };
  }
  try {
    await transporter.sendMail({ from: `"MAS Callnet" <${env.SMTP_FROM || env.SMTP_USER}>`, to, cc: cc || undefined, subject, html });
    await logEmail(candidateId, code, to, cc, subject, "sent");
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logEmail(candidateId, code, to, cc, subject, "failed", message);
    return { ok: false, error: message };
  }
}

async function candidateSelect(where = "1=1", params: unknown[] = [], limit = 5000): Promise<CandidateRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*,
            COALESCE(c.candidate_code, c.id) AS candidate_id
       FROM ats_candidate c
      WHERE ${where}
      ORDER BY COALESCE(c.created_date, c.created_at) DESC, c.created_at DESC
      LIMIT ?`,
    [...params, limit]
  );
  return rows.map(enrichCandidate);
}

export const atsFullParityService = {
  async webData(filters: { fromDate?: string; toDate?: string; branch?: string; process?: string; recruiter?: string; period?: Period; actorId?: string; bypassScope?: boolean } = {}) {
    const conds = ["c.active_status = 1"];
    const params: unknown[] = [];
    if (filters.fromDate) { conds.push("COALESCE(c.created_date, DATE(c.created_at)) >= ?"); params.push(filters.fromDate); }
    if (filters.toDate) { conds.push("COALESCE(c.created_date, DATE(c.created_at)) <= ?"); params.push(filters.toDate); }
    // Push date bounds into SQL when no explicit date range provided
    // This prevents full-table scans for bounded periods (FTD/WTD/MTD)
    if (!filters.fromDate && !filters.toDate) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const period = filters.period || "ALL";
      if (period === "FTD") {
        conds.push("(c.created_date = ? OR (c.created_date IS NULL AND DATE(c.created_at) = ?))");
        params.push(todayStr, todayStr);
      } else if (period === "WTD") {
        const dow = new Date(now);
        dow.setDate(now.getDate() - now.getDay());
        const weekStart = dow.toISOString().slice(0, 10);
        conds.push("(c.created_date >= ? OR (c.created_date IS NULL AND DATE(c.created_at) >= ?))");
        params.push(weekStart, weekStart);
      } else if (period === "MTD") {
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        conds.push("(c.created_date >= ? OR (c.created_date IS NULL AND DATE(c.created_at) >= ?))");
        params.push(monthStart, monthStart);
      }
      // period === "ALL": no date filter added — 5000-row cap in candidateSelect still applies
    }
    if (filters.branch) { conds.push("COALESCE(c.branch_text, c.applied_for_branch) = ?"); params.push(filters.branch); }
    if (filters.process) { conds.push("COALESCE(c.process_text, c.applied_for_process) = ?"); params.push(filters.process); }
    if (filters.recruiter) {
      // Support both FK (recommended) and legacy string match for backward compatibility
      conds.push("(c.recruiter_id = ? OR COALESCE(c.recruiter_assigned_name, c.recruiter_name) = ?)");
      params.push(filters.recruiter, filters.recruiter);
    }
    if (filters.actorId && !filters.bypassScope) {
      const scope = await buildScopeWhereClause(
        filters.actorId,
        ["branch_head", "process_manager", "recruiter", "manager", "hr"],
        { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
        { allowAdminBypass: true, allowCeoAllRead: true },
      );
      conds.push(scope.sql);
      params.push(...scope.params);
    }
    const allRows = await candidateSelect(conds.join(" AND "), params);
    const period = filters.period || "ALL";
    const candidateRows = allRows.filter((r) => inPeriod(r, period));
    const queueRows = allRows.filter((r) => {
      const status = normalizeText(r.status || r.current_stage || "Waiting");
      const stage = normalizeText(r.walkin_end_stage || r.current_stage || "");
      return OPEN_STATUSES.has(status) && OPEN_QUEUE_STAGES.has(stage) && !r._selected && !r._rejected;
    }).sort((a, b) => Number(b.WaitingMinutes || 0) - Number(a.WaitingMinutes || 0));
    const dashboardRows = ["FTD", "WTD", "MTD"].map((p) => {
      const rows = allRows.filter((r) => inPeriod(r, p as Period));
      const s = summarizeRows(rows);
      return {
        Date: p,
        _dateKey: p,
        "Total Arrival": s.totalArrival,
        Selection: s.totalSelection,
        Rejection: s.totalRejection,
        "On Hold": s.onHold,
        Pending: s.pending,
        "Un-attended": s.waiting,
        "SLA Breach": s.slaBreach,
        "Avg Time": s.avgWaitMinutes,
        "HR Screening": rows.filter((r) => contains(r._endStage, ["hr screening", "screening"])).length,
        Assessment: rows.filter((r) => contains(r._endStage, ["assessment"])).length,
        "OP's Round": rows.filter((r) => contains(r._endStage, ["op", "ops"])).length,
        "Client Round": rows.filter((r) => contains(r._endStage, ["client"])).length,
      };
    });
    const cfg = await getConfigMap();
    return {
      ok: true,
      orgName: cfg.Org_Name || cfg.orgName || "ATS Command Center",
      refreshTime: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      todayISO: formatDateKey(new Date()),
      options: buildOptions(allRows, queueRows),
      summary: summarizeRows(candidateRows),
      trends: {
        today: summarizeRows(allRows.filter((r) => inPeriod(r, "FTD"))),
        wtd: summarizeRows(allRows.filter((r) => inPeriod(r, "WTD"))),
        mtd: summarizeRows(allRows.filter((r) => inPeriod(r, "MTD"))),
      },
      queueRows,
      dashboardRows,
      candidateRows,
      branchTable: dimensionTable(candidateRows, "_branch"),
      processTable: dimensionTable(candidateRows, "_process"),
      roleTable: dimensionTable(candidateRows, "_role"),
      sourceTable: dimensionTable(candidateRows, "_source"),
      recruiterTable: recruiterProductivity(candidateRows),
      slotTable: dimensionTable(candidateRows, "_slot"),
      reusablePool: candidateRows.filter((r) => r._reusableReason).slice(0, 100),
    };
  },

  async candidateJourney(query: string) {
    const q = `%${query.trim()}%`;
    const rows = await candidateSelect(
      `(c.id = ? OR c.candidate_code = ? OR c.q_token = ? OR c.mobile LIKE ? OR c.email LIKE ? OR c.full_name LIKE ?) AND c.active_status = 1`,
      [query, query, query, q, q, q]
    );
    const candidate = rows[0];
    if (!candidate) return null;
    const [stageLogs] = await db.execute<RowDataPacket[]>(`SELECT * FROM ats_candidate_stage_log WHERE candidate_id = ? ORDER BY stage_date ASC, created_at ASC`, [candidate.id]);
    const [confirmations] = await db.execute<RowDataPacket[]>(`SELECT * FROM ats_candidate_confirmation WHERE candidate_id IN (?, ?) ORDER BY created_at DESC`, [candidate.id, candidate.candidate_code]);
    const [emails] = await db.execute<RowDataPacket[]>(`SELECT * FROM ats_command_email_log WHERE candidate_id IN (?, ?) ORDER BY created_at DESC`, [candidate.id, candidate.candidate_code]);
    const [notifications] = await db.execute<RowDataPacket[]>(`SELECT * FROM ats_notification_log WHERE candidate_id IN (?, ?) ORDER BY created_at DESC`, [candidate.id, candidate.candidate_code]);
    return { candidate, stageLogs, confirmations, emails, notifications };
  },

  async createIntake(input: Record<string, unknown>, actor = "PUBLIC") {
    const mobile = normalizeText(input.mobile || input.Mobile || input["Mobile Number"]);
    if (!mobile) throw Object.assign(new Error("Mobile number required"), { statusCode: 400 });
    const [existing] = await db.execute<CandidateLookupRow[]>(
      `SELECT id, candidate_code, employee_code, full_name, mobile, email, address,
              education, experience, gender, role_applied, branch_text, applied_for_branch,
              applied_for_process, recruiter_selected, recruiter_id, recruiter_assigned_name,
              recruiter_email, recruiter_mobile, q_token, status, source,
              aadhar_number_masked, pan_number_masked, bank_account_no_masked,
              aadhar_number_hash, pan_number_hash, bank_account_no_hash,
              active_status, created_at, updated_at
       FROM ats_candidate WHERE mobile = ? AND active_status = 1 ORDER BY created_at DESC LIMIT 1`,
      [mobile]
    );
    const now = new Date();
    const fullName = normalizeText(input.fullName || input.FullName || input.Name);
    const branch = normalizeText(input.branch || input.Branch || input.appliedForBranch);
    const role = normalizeText(input.roleApplied || input.RoleApplied || input["Role Applied"] || input.appliedForProcess);
    const recruiter = await this.pickRecruiter(branch, role, normalizeText(input.recruiterName || input.RecruiterSelected || input["Recruiter Name"]));
    const qToken = await this.nextQueueToken(branch);
    if (existing.length) {
      const rec = existing[0];
      await db.execute(
        `UPDATE ats_candidate SET full_name=?, email=?, address=?, education=?, experience=?, gender=?, role_applied=?, branch_text=?, applied_for_branch=?, applied_for_process=?, recruiter_selected=?, recruiter_id=?, recruiter_assigned_name=?, recruiter_email=?, recruiter_mobile=?, q_token=COALESCE(q_token, ?), status=COALESCE(status, 'Waiting'), updated_at=NOW() WHERE id=?`,
        [fullName || rec.full_name, input.email || input.Email || rec.email, input.address || input.Address || rec.address, input.education || input.Education || rec.education, input.experience || input.Experience || rec.experience, input.gender || input.Gender || rec.gender, role, branch, branch, role, input.recruiterSelected || input.RecruiterSelected || null, recruiter?.id ?? null, recruiter?.name ?? null, recruiter?.email ?? null, recruiter?.mobile ?? null, qToken, rec.id]
      );
      await audit("INTAKE_DUPLICATE_UPDATED", rec.candidate_code || rec.id, `Existing active candidate updated by ${actor}`);
      return (await candidateSelect("c.id = ?", [rec.id]))[0];
    }
    const id = randomUUID();
    const code = `CND-${Date.now().toString(36).toUpperCase()}`;
    await db.execute(
      `INSERT INTO ats_candidate
        (id, candidate_code, full_name, mobile, email, address, education, experience, gender, applied_for_branch, applied_for_process, branch_text, role_applied, recruiter_selected, q_token, created_date, created_time, sourcing_channel, recruiter_id, recruiter_assigned_name, recruiter_email, recruiter_mobile, status, current_stage, profile_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), CURTIME(), 'Walk-In', ?, ?, ?, ?, 'Waiting', 'New', 'registered', NULL)`,
      [id, code, fullName, mobile, input.email || input.Email || null, input.address || input.Address || null, input.education || input.Education || null, input.experience || input.Experience || null, input.gender || input.Gender || null, branch, role, branch, role, input.recruiterSelected || input.RecruiterSelected || null, qToken, recruiter?.id ?? null, recruiter?.name ?? null, recruiter?.email ?? null, recruiter?.mobile ?? null]
    );
    if (recruiter?.id) {
      // Optimistic locking: only increment if under capacity
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE ats_recruiter_roster
         SET assigned_today = assigned_today + 1,
             last_assigned_at = NOW(),
             capacity_lock_version = capacity_lock_version + 1
         WHERE id = ? AND assigned_today < daily_capacity`,
        [recruiter.id]
      );

      // If 0 rows affected, capacity was exceeded (race condition)
      if (Number(result.affectedRows ?? 0) === 0) {
        console.warn(`[Capacity] Recruiter ${recruiter.id} exceeded capacity during concurrent assignment`);
        // Log to audit for monitoring
        await audit("CAPACITY_EXCEEDED", code, `Recruiter ${recruiter.name} (${recruiter.id}) capacity exceeded - candidate ${code} assigned but counter not incremented`);
      }
    }
    await audit("INTAKE_CREATED", code, `Recruiter=${recruiter?.name || "Unassigned"}; Branch=${branch}; Role=${role}`);
    return (await candidateSelect("c.id = ?", [id]))[0];
  },

  async pickRecruiter(branch: string, role: string, preferred?: string) {
    const params: unknown[] = [branch];
    let pref = "";
    if (preferred) { pref = " AND (name = ? OR recruiter_code = ? OR email = ?)"; params.push(preferred, preferred, preferred); }
    const [prefRows] = await db.execute<RecruiterRosterRow[]>(
      `SELECT * FROM ats_recruiter_roster WHERE active_status = 1 AND available_today = 'Y' AND branch = ? ${pref} ORDER BY assigned_today ASC, last_assigned_at ASC LIMIT 1`, params
    );
    if (prefRows[0]) return prefRows[0];
    const like = `%${role}%`;
    const [rows] = await db.execute<RecruiterRosterRow[]>(
      `SELECT * FROM ats_recruiter_roster
        WHERE active_status = 1 AND available_today = 'Y' AND branch = ?
          AND assigned_today < daily_capacity
          AND (role_coverage IS NULL OR role_coverage = '' OR role_coverage LIKE ?)
        ORDER BY assigned_today ASC, COALESCE(last_assigned_at, '1970-01-01') ASC LIMIT 1`,
      [branch, like]
    );
    return rows[0] || null;
  },

  async nextQueueToken(branch: string) {
    const prefix = normalizeText(branch).split(/\s|-/).filter(Boolean).map((p) => p[0]).join("").slice(0, 3).toUpperCase() || "Q";
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ats_candidate WHERE created_date = CURDATE() AND COALESCE(branch_text, applied_for_branch) = ?`, [branch]);
    return `${prefix}-${String(Number(rows[0]?.cnt ?? 0) + 1).padStart(3, "0")}`;
  },

  /** @deprecated Not wired to any route. Use recruiterInterview.service.ts submitInterviewUpdate instead. */
  async submitRecruiterUpdate(input: Record<string, unknown>, actorUserId?: string) {
    const candidateId = normalizeText(input.candidateId || input.CandidateID || input["Candidate ID"]);
    const qToken = normalizeText(input.qToken || input.QToken || input["Q Token"]);
    if (!candidateId && !qToken) throw Object.assign(new Error("CandidateID or QToken required"), { statusCode: 400 });
    const rows = await candidateSelect(candidateId ? `(c.id = ? OR c.candidate_code = ?)` : `c.q_token = ?`, candidateId ? [candidateId, candidateId] : [qToken]);
    const c = rows[0];
    if (!c) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
    const finalDecision = normalizeText(input.finalDecision || input.FinalDecision || input["Final Decision"]);
    const endStage = normalizeText(input.walkinEndStage || input["Walk-in End Stage"] || input.walkin_end_stage);
    const newStatus = finalDecision || (endStage ? (contains(endStage, ["no show"]) ? "No Show" : endStage) : c.status);
    await db.execute(
      `UPDATE ats_candidate SET
        walkin_end_stage=?, round1_result=?, round1_voc=?, round1_remarks=?, skilltest_typing=?, skilltest_ai=?, skilltest_result=?, skilltest_voc=?, skilltest_remarks=?, round2_result=?, round2_voc=?, round2_remarks=?, round3_result=?, round3_voc=?, round3_remarks=?, final_decision=?, offer_salary=?, offer_doj=?, reporting_shift=?, process_text=?, status=?, current_stage=?, hr_form_submission_time=NOW(), updated_at=NOW()
       WHERE id=?`,
      [endStage || null, input.round1Result || input.Round1_Result || input["Round1 Result"] || null, input.round1Voc || input.Round1_VOC || input["Round1 VOC"] || null, input.round1Remarks || input["Round1 Remarks"] || null, input.skillTestTyping || input["SkillTest Typing Score (WPM/Accuracy%)"] || null, input.skillTestAI || input["SkillTest AI Score"] || null, input.skillTestResult || input["SkillTest Result"] || null, input.skillTestVoc || input["SkillTest VOC"] || null, input.skillTestRemarks || input["SkillTest Remarks"] || null, input.round2Result || input["Round2 Result"] || null, input.round2Voc || input["Round2 VOC"] || null, input.round2Remarks || input["Round2 Remarks"] || null, input.round3Result || input["Round3 Result"] || null, input.round3Voc || input["Round3 VOC"] || null, input.round3Remarks || input["Round3 Remarks"] || null, finalDecision || null, toNumber(input.offerSalary || input["Offer Salary"], 0), input.offerDoj || input["Date of Joining"] || null, input.reportingTiming || input["Reporting Timing"] || null, input.interviewedForProcess || input["Interviewed for Process"] || null, newStatus || null, newStatus || c.current_stage, c.id]
    );
    await db.execute(`INSERT INTO ats_candidate_stage_log (id, candidate_id, from_stage, to_stage, remarks, updated_by) VALUES (?, ?, ?, ?, ?, ?)`, [randomUUID(), c.id, c.current_stage || c.status, newStatus, input.remarks || input.Final_Remarks || null, actorUserId ?? null]);
    await this.recomputeDerivedFields(rowText(c, "id"));
    await audit("RECRUITER_UPDATE", rowText(c, "candidate_code") || rowText(c, "id"), `Stage=${newStatus}`);
    return (await candidateSelect("c.id = ?", [c.id]))[0];
  },

  async submitConfirmation(input: Record<string, unknown>) {
    const candidateId = normalizeText(input.candidateId || input.CandidateID || input["Candidate ID"]);
    await db.execute(
      `INSERT INTO ats_candidate_confirmation (id, candidate_id, will_join, hr_query, candidate_name, recruiter_name, recruiter_email, process_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), candidateId, input.willJoin || input["Will you join?"] || null, input.hrQuery || input["Any query for HR?"] || null, input.candidateName || input["Candidate Name"] || null, input.recruiterName || input["Recruiter Name"] || null, input.recruiterEmail || input["Recruiter Email ID"] || null, input.processName || input["Process Name"] || null]
    );
    await db.execute(`UPDATE ats_candidate SET joining_confirmation = ?, updated_at = NOW() WHERE id = ? OR candidate_code = ?`, [input.willJoin || input["Will you join?"] || null, candidateId, candidateId]);
    await audit("CANDIDATE_CONFIRMATION", candidateId, `WillJoin=${input.willJoin || input["Will you join?"] || ""}`);
    return { success: true };
  },

  async submitBgv(input: Record<string, unknown>) {
    const candidateId = normalizeText(input.candidateId || input.CandidateID || input["CandidateID"]);
    await db.execute(
      `INSERT INTO ats_bgv_response (id, candidate_id, email_address, batch_no, process_name, full_name, contact_no, emergency_contact_no, dob, aadhaar_number, father_name, husband_name, permanent_same_as_current, permanent_address, permanent_city, permanent_state, permanent_pincode, permanent_landmark, current_address, current_city, current_state, current_pincode, current_landmark, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [randomUUID(), candidateId || null, input["Email Address"] || input.emailAddress || null, input["BATCH NO"] || input.batchNo || null, input["PROCESS NAME"] || input.processName || null, input["Your Full Name"] || input.fullName || null, input["Contact No."] || input.contactNo || null, input["Emergency Contact No."] || input.emergencyContactNo || null, input.DOB || input.dob || null, input["AADHAR NUMBER"] || input.aadhaarNumber || null, input["Fathers Name"] || input.fatherName || null, input["Husband name ( If Married ) only for Female Employee"] || input.husbandName || null, input["Is your Permanent address and current location address is same ?"] || null, input["Permanent Address ( Mandatory to fill- House No,Building No, Street Name/Number., Landmark)"] || null, input["Permanent Address -CITY"] || null, input["Permanent Address - State"] || null, input["Permanent Location - Pincode"] || null, input["Permanent Address - Landmark"] || null, input["Current Address  ( Mandatory to fill- House No,Building No, Street Name/Number., Landmark)"] || null, input["Current Address -CITY"] || null, input["Current Address - State"] || null, input["Current Location - Pincode"] || null, input["Current Address - Landmark"] || null, JSON.stringify(input)]
    );
    if (candidateId) await db.execute(`UPDATE ats_candidate SET bgv_form_link = COALESCE(bgv_form_link, 'BGV submitted'), updated_at = NOW() WHERE id = ? OR candidate_code = ?`, [candidateId, candidateId]);
    await audit("BGV_SUBMITTED", candidateId || null, "BGV response captured");
    return { success: true };
  },

  async submitDocUpload(input: Record<string, unknown>) {
    const candidateId = normalizeText(input.candidateId || input.CandidateID || input["CandidateID"]);
    const link = normalizeText(input.uploadedDocumentsLink || input["Uploaded documents link"]);
    await db.execute(`INSERT INTO ats_doc_upload_response (id, candidate_id, uploaded_documents_link, raw_payload) VALUES (?, ?, ?, CAST(? AS JSON))`, [randomUUID(), candidateId, link || null, JSON.stringify(input)]);
    if (candidateId && link) await db.execute(`UPDATE ats_candidate SET day1_doc_form_link = ?, updated_at = NOW() WHERE id = ? OR candidate_code = ?`, [link, candidateId, candidateId]);
    await audit("DOC_UPLOAD_SUBMITTED", candidateId, "Document upload response captured");
    return { success: true };
  },

  async registerDevice(input: Record<string, unknown>) {
    await db.execute(
      `INSERT INTO ats_recruiter_device (id, recruiter_code, device_token, platform, device_name, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE recruiter_code=VALUES(recruiter_code), platform=VALUES(platform), device_name=VALUES(device_name), is_active=1, last_updated=NOW()`,
      [randomUUID(), input.recruiterCode, input.deviceToken, input.platform ?? null, input.deviceName ?? null]
    );
    return { success: true };
  },

  async recomputeDerivedFields(candidateId: string) {
    const rows = await candidateSelect("c.id = ? OR c.candidate_code = ?", [candidateId, candidateId]);
    const row = rows[0];
    if (!row) return null;
    const start = rowDate(row._createdAt) ?? parseCandidateDate(row);
    const end = rowDate(row.hr_form_submission_time) || rowDate(row.updated_at) || new Date();
    const min = minutesBetween(start, end);
    const cfg = await getConfigMap();
    const sla = Number(cfg.SLA_Minutes || cfg.slaMinutes || 120);
    const breach = min > sla && (row._waiting || normalizeText(row.status) === STATUS_WAITING);
    const qScore = candidateQualityScore(row);
    const hScore = handlingQualityScore({ ...row, _totalMinutes: min, sla_breached: breach });
    await db.execute(
      `UPDATE ats_candidate SET total_time_consumed=?, time_taken=?, aht_minutes=?, sla_breached=?, walkin_slot=?, rejection_voc=?, candidate_quality_score=?, candidate_quality_label=?, handling_quality_score=?, handling_quality_label=?, hard_reject_reason=?, reusable_reason=?, updated_at=NOW() WHERE id=?`,
      [formatDuration(min), formatDuration(min), min, breach ? 1 : 0, row._slot || slotLabel(row.created_time || row.created_at), hardRejectReason(row) || row.rejection_voc || null, qScore, qualityLabel(qScore), hScore, handlingLabel(hScore), hardRejectReason(row) || null, reusableReason(row), row.id]
    );
    return (await candidateSelect("c.id = ?", [row.id]))[0];
  },

  async checkSlaBreaches() {
    const cfg = await getConfigMap();
    const threshold = Number(cfg.SLA_Minutes || cfg.slaMinutes || 120);
    const rows = await candidateSelect(`c.active_status = 1 AND COALESCE(c.status, c.current_stage, 'Waiting') = 'Waiting'`, []);
    let breached = 0;
    for (const row of rows) {
      const start = rowDate(row._createdAt) ?? parseCandidateDate(row);
      const diff = minutesBetween(start, new Date());
      if (!start || diff <= threshold) continue;
      await db.execute(`UPDATE ats_candidate SET sla_breached = 1, updated_at = NOW() WHERE id = ?`, [rowText(row, "id")]);
      await db.execute(
        `INSERT INTO ats_command_sla_event (id, candidate_id, q_token, breach_minutes, threshold_minutes, recruiter_email, cc_emails)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE breach_minutes=VALUES(breach_minutes), recruiter_email=VALUES(recruiter_email), cc_emails=VALUES(cc_emails), event_status=IF(event_status='closed','closed',event_status)`,
        [randomUUID(), rowText(row, "candidate_code") || rowText(row, "id"), rowText(row, "q_token") || null, diff, threshold, rowText(row, "recruiter_email") || null, await this.resolveSlaCc(row)]
      );
      const candidateKey = rowText(row, "candidate_code") || rowText(row, "id");
      const already = await this.hasEmailBeenSent(candidateKey, "SLA_BREACH");
      if (!already) {
        const cc = await this.resolveSlaCc(row);
        await sendTemplateEmail("SLA_BREACH", candidateKey, rowText(row, "recruiter_email"), cc, {
          Org_Name: cfg.Org_Name || "ATS Command Center",
          CandidateName: row.full_name,
          CandidateID: row.candidate_code || row.id,
          QToken: row.q_token || "",
          SLAMinutes: String(threshold),
          RecruiterName: row.recruiter_assigned_name || row.recruiter_name || "",
          Branch: row.branch_text || row.applied_for_branch || "",
          RoleApplied: row.role_applied || row.applied_for_process || "",
          UpdateFormLink: row.update_form_link || "",
        });
        await db.execute(`UPDATE ats_command_sla_event SET event_status='email_sent' WHERE candidate_id=?`, [row.candidate_code || row.id]);
      }
      breached++;
    }
    await audit("SLA_CHECK", null, `Breached=${breached}`);
    return { checked: rows.length, breached };
  },

  async hasEmailBeenSent(candidateId: string, emailType: string) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT id FROM ats_command_email_log WHERE candidate_id = ? AND email_type = ? AND status IN ('sent','skipped') LIMIT 1`, [candidateId, emailType]);
    return rows.length > 0;
  },

  async resolveSlaCc(row: CandidateRow) {
    const emails: string[] = [];
    const [recRows] = await db.execute<RecruiterContactRow[]>(`SELECT reporting_manager, branch_head_email FROM ats_recruiter_roster WHERE (email = ? OR name = ? OR recruiter_code = ?) LIMIT 1`, [row.recruiter_email || "", row.recruiter_assigned_name || "", row.recruiter_assigned_id || ""]);
    const rec = recRows[0];
    if (rec?.reporting_manager && String(rec.reporting_manager).includes("@")) emails.push(String(rec.reporting_manager));
    if (rec?.branch_head_email) emails.push(String(rec.branch_head_email));
    const cfg = await getConfigMap();
    const branch = normalizeText(row.branch_text || row.applied_for_branch);
    const maps = [cfg.HR_Emails_By_Branch, cfg.Ops_Emails_By_Branch];
    for (const map of maps) {
      if (!map) continue;
      for (const part of String(map).split(";")) {
        const [k, ...rest] = part.split("=");
        if (normalizeText(k) === branch && rest.join("=").trim()) emails.push(rest.join("=").trim());
      }
    }
    return Array.from(new Set(emails.flatMap((e) => e.split(/[;,]/)).map((e) => e.trim()).filter(Boolean))).join(",");
  },

  async resetRecruiterDailyLoad() {
    const [result] = await db.execute(`UPDATE ats_recruiter_roster SET assigned_today = 0, last_assigned_at = NULL WHERE active_status = 1`);
    await audit("RECRUITER_DAILY_RESET", null, `Reset completed`);
    return { success: true, result };
  },

  async dailyReportSnapshot(mode: "preview" | "send" = "preview", actorId?: string) {
    const web = await this.webData({ period: "FTD", actorId });
    const cfg = await getConfigMap();
    const branches = dimensionTable(web.candidateRows, "_branch");
    const out: Array<Record<string, unknown>> = [];
    for (const b of branches) {
      const rows = web.candidateRows.filter((r) => r._branch === b.Name);
      const snapshot = {
        reportDate: new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
        branch: b.Name,
        summary: summarizeRows(rows),
        processTable: dimensionTable(rows, "_process"),
        roleTable: dimensionTable(rows, "_role"),
        recruiterTable: recruiterProductivity(rows),
        criticalItems: this.branchCriticalInsights(rows),
        recommendations: this.branchRecommendations(rows),
      };
      const to = await this.branchRecruiterEmails(String(b.Name));
      const cc = await this.branchHeadEmails(String(b.Name));
      const subjectPrefix = snapshot.summary.pending >= Number(cfg.Daily_Dashboard_Pending_Threshold || 10) || snapshot.summary.slaBreach >= Number(cfg.Daily_Dashboard_SLA_Threshold || 5) ? "[ACTION REQUIRED] " : "";
      const subject = `${subjectPrefix}ATS Daily Branch Hiring Report - ${b.Name} - ${snapshot.reportDate}`;
      await db.execute(
        `INSERT INTO ats_daily_branch_report_log (id, report_date, branch_key, branch_name, to_emails, cc_emails, subject, snapshot_json, status, notes) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
        [randomUUID(), String(b.Name).toUpperCase(), b.Name, to, cc, subject, JSON.stringify(snapshot), mode === "send" ? "sent" : "preview", mode]
      );
      if (mode === "send") await sendTemplateEmail("DAILY_BRANCH_REPORT", null, to, cc, { Branch: b.Name, ReportDate: snapshot.reportDate });
      out.push({ branch: b.Name, to, cc, subject, snapshot });
    }
    return out;
  },

  branchCriticalInsights(rows: CandidateRow[]) {
    const s = summarizeRows(rows);
    const insights: string[] = [];
    if (s.pending >= 5) insights.push(`${s.pending} pending candidates need same-day queue action.`);
    if (s.slaBreach >= 3) insights.push(`${s.slaBreach} SLA breaches require recruiter follow-up discipline review.`);
    if (s.clientRoundPending >= 3) insights.push(`${s.clientRoundPending} client round pending cases need ops/client SPOC follow-up.`);
    if (s.noShow >= 3) insights.push(`${s.noShow} no-show cases recorded. Reconfirmation calling needs strengthening.`);
    if (!insights.length) insights.push("No critical issue observed for this branch today. Continue same queue discipline.");
    return insights.slice(0, 8);
  },

  branchRecommendations(rows: CandidateRow[]) {
    const s = summarizeRows(rows);
    const recs: string[] = [];
    if (s.waiting >= 5) recs.push("Queue redistribution or immediate recruiter intervention is required.");
    if (s.clientRoundPending >= 3) recs.push("Client round pending cases need same-day follow-up with ops/client SPOC.");
    if (s.noShow >= 3) recs.push("No show recovery calls should be initiated to improve same-day conversion.");
    if (s.slaBreach >= 3) recs.push("Review recruiter handling discipline and same-day attendance movement for SLA recovery.");
    const weakProcess = dimensionTable(rows, "_process").find((p) => p.TotalArrival >= 3 && p.SelectionRate < 20);
    if (weakProcess) recs.push(`Review screening calibration for process ${weakProcess.Name} due to weak conversion.`);
    const weakRecruiter = recruiterProductivity(rows).find((r) => r.SourcedCount >= 3 && r.SlaCompliancePercent < 70);
    if (weakRecruiter) recs.push(`Coach recruiter ${weakRecruiter.Recruiter} for faster handling and follow-up closure.`);
    if (!recs.length) recs.push("Branch is stable today. Continue same queue discipline and recruiter allocation.");
    return recs;
  },

  async branchRecruiterEmails(branch: string) {
    const [rows] = await db.execute<RecruiterContactRow[]>(`SELECT email FROM ats_recruiter_roster WHERE branch = ? AND active_status = 1 AND email IS NOT NULL`, [branch]);
    return Array.from(new Set(rows.map((r) => String(r.email ?? "").trim()).filter(Boolean))).join(",");
  },

  async branchHeadEmails(branch: string) {
    const [rows] = await db.execute<RecruiterContactRow[]>(`SELECT branch_head_email FROM ats_recruiter_roster WHERE branch = ? AND active_status = 1 AND branch_head_email IS NOT NULL`, [branch]);
    return Array.from(new Set(rows.map((r) => String(r.branch_head_email ?? "").trim()).filter(Boolean))).join(",");
  },

  async healthCheck() {
    const checks: Array<{ type: string; name: string; ok: boolean; count?: number }> = [];
    const tableNames = ["ats_candidate", "ats_recruiter_roster", "ats_command_config", "ats_email_template", "ats_command_email_log", "ats_command_audit_log", "ats_voc_lookup", "ats_forms_catalog", "ats_form_field_mapping", "ats_candidate_confirmation", "ats_bgv_response", "ats_doc_upload_response", "ats_recruiter_device", "ats_notification_log"];
    for (const table of tableNames) {
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
      checks.push({ type: "table", name: table, ok: Number(rows[0]?.cnt ?? 0) > 0 });
    }
    const requiredCandidateCols = ["q_token", "status", "walkin_end_stage", "sla_breached", "candidate_confirm_link", "bgv_form_link", "day1_doc_form_link", "candidate_quality_score", "handling_quality_score"];
    for (const col of requiredCandidateCols) {
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = ?`, [col]);
      checks.push({ type: "column", name: `ats_candidate.${col}`, ok: Number(rows[0]?.cnt ?? 0) > 0 });
    }
    const [missingRecruiterEmails] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ats_recruiter_roster WHERE active_status = 1 AND available_today = 'Y' AND (email IS NULL OR email = '')`);
    checks.push({ type: "data", name: "available_recruiters_missing_email", ok: Number(missingRecruiterEmails[0]?.cnt ?? 0) === 0, count: Number(missingRecruiterEmails[0]?.cnt ?? 0) });
    const [templates] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ats_email_template WHERE active_status = 1`);
    checks.push({ type: "data", name: "email_templates_configured", ok: Number(templates[0]?.cnt ?? 0) >= 3, count: Number(templates[0]?.cnt ?? 0) });
    return { ok: checks.every((c) => c.ok), checks };
  },

  async repairBatch(limit = 200) {
    const [rows] = await db.execute<CandidateIdRow[]>(`SELECT id FROM ats_candidate WHERE active_status = 1 ORDER BY updated_at DESC LIMIT ?`, [limit]);
    let repaired = 0;
    for (const r of rows) {
      await this.recomputeDerivedFields(r.id);
      repaired++;
    }
    await audit("INCREMENTAL_REPAIR", null, `Repaired=${repaired}`);
    return { repaired };
  },
};
