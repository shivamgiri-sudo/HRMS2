import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { excludeEmployeeShapedCandidatesSql, excludeOtherEntityCandidatesSql } from "../ats/ats-reporting-scope.js";
import { canonicalBranch, branchRegion, sourceLabel, recruiterKey, preferredRecruiterName, normalizeRecruiterName, suspectedDuplicateRecruiters } from "../ats/ats-vocabulary.js";

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
const OPEN_STATUSES = new Set(["waiting", "in progress", "hold", "client round - pending", "pending", "new"]);

/**
 * Stages a candidate can still be moving through, matched as substrings against the stage
 * vocabulary `walkin_end_stage` actually stores.
 *
 * The previous version was an exact-match Set of "HR Screening", "Assessment", "OP's Round",
 * "Ops Round", "Client Round". None of those strings appear in the column. A live census on
 * 2026-08-27 found "Round 1- HR Screening" (2,579 rows), "Round 2- Op's" (1,354),
 * "Interview - Skill Test" (359), "Selection Discussion" (365), "Round 3- Client" (249) — so
 * only the literal "Arrival" and the empty string ever matched, and the Live Queue showed 5
 * candidates while the Branch Summary on the same page totalled 216 and the database held 217.
 * Anyone mid-pipeline was invisible to the queue.
 *
 * Substrings rather than exact values because the same stage is written several ways across the
 * candidate web form, the recruiter app and the legacy import, and an exact list is exactly what
 * failed here. `OPEN_STATUSES` is lower-cased for the same reason.
 */
const OPEN_QUEUE_STAGE_PATTERNS = [
  "arrival", "arrived", "screening", "assessment", "skill test", "interview",
  "op's", "ops", "client", "selection discussion", "new",
];

function isOpenQueueRow(r: CandidateRow): boolean {
  if (r._selected || r._rejected || r._noShow || r._walkout || r._dormant) return false;
  const status = normalizeLower(r.status || r.current_stage || STATUS_WAITING);
  if (!OPEN_STATUSES.has(status)) return false;
  const stage = normalizeLower(r.walkin_end_stage || r.current_stage || "");
  return stage === "" || OPEN_QUEUE_STAGE_PATTERNS.some((p) => stage.includes(p));
}

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

/** Bucket an arrival hour into the reporting slot. One scheme, used for every row. */
function slotFromHour(hour: number): string {
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return "Unspecified";
  if (hour < 10) return "Before 10 AM";
  if (hour < 12) return "10 AM - 12 PM";
  if (hour < 14) return "12 PM - 2 PM";
  if (hour < 16) return "2 PM - 4 PM";
  if (hour < 18) return "4 PM - 6 PM";
  return "After 6 PM";
}

/**
 * The arrival slot, from whichever stored value is actually a time.
 *
 * This dimension used to carry two incompatible taxonomies at once. `walkin_slot` is written by
 * the SLA repair job and holds a BARE HOUR — "9" through "19", nothing else, on 3,569 rows —
 * while rows without it fell through to a function returning named ranges. So the Trends tab
 * listed "After 6 PM" beside "12" and "13", labels from different schemes that overlap in
 * meaning, and a reader had no way to know "12" meant noon rather than midnight. Both forms are
 * now bucketed the same way.
 *
 * `created_time` is deliberately consulted AFTER `created_at`. It defaults to exactly 09:00:00
 * on 1,891 rows — a stored default, not an observed arrival — and reading it first put all of
 * them in "Before 10 AM", which is why that bucket held 1,893 arrivals and looked like a genuine
 * morning peak. `created_at` carries the real insertion timestamp.
 */
function slotLabel(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return "Unspecified";
  const hhmm = text.match(/(\d{1,2}):(\d{2})/);
  if (hhmm) return slotFromHour(Number(hhmm[1]));
  if (/^\d{1,2}$/.test(text)) return slotFromHour(Number(text));
  return "Unspecified";
}

const DEFAULTED_CREATED_TIME = "09:00:00";

/** The arrival slot for a candidate row, preferring the real timestamp over the defaulted one. */
function rowSlot(row: CandidateRow): string {
  const stored = normalizeText(row.walkin_slot);
  if (stored) return slotLabel(stored);
  const createdAt = parseDate(row.created_at);
  if (createdAt) return slotFromHour(createdAt.getHours());
  const createdTime = normalizeText(row.created_time);
  if (createdTime && !createdTime.startsWith(DEFAULTED_CREATED_TIME)) return slotLabel(createdTime);
  return "Unspecified";
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

/**
 * The controlled rejection vocabulary, taken from a census of `ats_candidate.rejection_voc` on
 * production 2026-08-27. Ordered longest-first because REJECTION_SPLIT matches greedily.
 */
const REJECTION_VOCABULARY: readonly string[] = [
  "Undergraduate / Qualification Issue",
  "Salary / Shift / Location Issue",
  "Poor Sales / Customer Handling",
  "Communication Not Client Ready",
  "Poor Reading / Comprehension",
  "Process / Role Fitment Issue",
  "Behavioral / Attitude Issue",
  "Computer / System Skill Gap",
  "Stability / Joining Concern",
  "Vocabulary / Grammar Issue",
  "Undergraduate Qualification",
  "Poor Communication Skill",
  "Candidate Not Interested",
  "Location / Travel Issue",
  "Role / Process Mismatch",
  "Typing Accuracy Issue",
  "Shift / Timing Issue",
  "Documentation Issue",
  "Typing Speed Issue",
  "Stability Concern",
  "Client Rejected",
  "Salary Issue",
  "Age Barrier",
  "No Show",
];

/** Legacy free-text keywords (hard_reject_reason) mapped onto the controlled vocabulary. */
const LEGACY_REASON_TO_VOC: Readonly<Record<string, string>> = {
  communication: "Poor Communication Skill",
  "not interested": "Candidate Not Interested",
  "salary mismatch": "Salary Issue",
  "location issue": "Location / Travel Issue",
  "location not okay": "Location / Travel Issue",
  document: "Documentation Issue",
  documents: "Documentation Issue",
  behavior: "Behavioral / Attitude Issue",
  behaviour: "Behavioral / Attitude Issue",
  abscond: "Stability Concern",
  fake: "Documentation Issue",
  fraud: "Documentation Issue",
};

/**
 * Split a stored rejection value into the reasons it actually contains.
 *
 * Multi-select rejections are written to the column by string concatenation with no separator,
 * so the raw data holds values like `Salary IssuePoor Sales / Customer Handling`,
 * `No ShowNo Show` and `Vocabulary / Grammar IssueNo ShowNo Show`. Fourteen such values exist.
 * Grouping on the raw string turned each into its own "distinct reason", which is how a tab
 * headed "25 distinct reasons — after case and spacing normalisation" ended up listing
 * `Salary IssuePoor Sales / Customer Handling` as a reason in its own right.
 *
 * Greedy longest-first, because `Salary Issue` is a prefix of nothing but `Stability Concern`
 * and `Stability / Joining Concern` overlap — matching the longer one first keeps them apart.
 * Anything left unmatched is returned as-is rather than dropped, so a new vocabulary value
 * shows up in the chart instead of vanishing into "Unspecified".
 */
function splitRejectionValue(raw: string): string[] {
  const out: string[] = [];
  let rest = raw.trim();
  let guard = 0;
  while (rest && guard++ < 12) {
    const hit = REJECTION_VOCABULARY.find((v) => rest.toLowerCase().startsWith(v.toLowerCase()));
    if (!hit) break;
    out.push(hit);
    rest = rest.slice(hit.length).trim();
  }
  if (rest) out.push(rest);
  return out.length ? out : [raw.trim()];
}

/**
 * Every reason recorded against one rejected candidate.
 *
 * Ranks the controlled vocabulary first and the derived keyword only as a fallback — the
 * opposite of the old order, which took `_hardRejectReason` first. That mattered: the derived
 * value is a loose keyword scan across remarks, decision and stage, so 953 candidates matched
 * the bare word "communication" and were ranked under it, while `Poor Communication Skill` —
 * the controlled value on 476 rows and the single largest real rejection driver — never
 * appeared in the list at all.
 *
 * Returns an array because a candidate can carry more than one reason, so reason counts can
 * legitimately exceed the rejection count. The payload reports both figures rather than letting
 * the chart imply the bars sum to the total.
 */
function rejectionReasons(row: CandidateRow): string[] {
  const voc = normalizeText(row.rejection_voc);
  if (voc) return splitRejectionValue(voc);
  const legacy = normalizeLower(row._hardRejectReason);
  if (legacy) return [LEGACY_REASON_TO_VOC[legacy] ?? normalizeText(row._hardRejectReason)];
  return ["Unspecified"];
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

/**
 * Why a candidate is worth re-approaching — or an empty string if they are not.
 *
 * The last branch used to return "General pool candidate" for everyone who matched nothing else,
 * so every one of the 8,244 candidates carried a reusable reason and "the reusable pool" was
 * simply the whole table. The tile then displayed 100, which was the size of the `.slice(0, 100)`
 * the payload applied, and the panel read as "100 candidates worth re-approaching" when the real
 * answer was "everyone, which is the same as no one".
 *
 * A pool is only useful if it excludes people. It now holds candidates who got somewhere and
 * did not convert, and is empty for everyone else:
 *   - selected but not yet joined      — keep warm
 *   - on hold                          — the decision is genuinely open
 *   - no-show                          — worth one more confirmation call
 *   - rejected on a resolvable reason  — salary, shift, location, travel: circumstances change
 *   - passed two or more rounds        — proven, just not placed
 * Rejections on non-resolvable grounds (communication, comprehension, typing, qualification,
 * documentation, behaviour) are excluded rather than listed as "not reusable unless resolved",
 * which is what put explicitly-not-reusable candidates inside a panel headed "worth
 * re-approaching".
 */
const RESOLVABLE_REJECTIONS = ["salary", "shift", "timing", "location", "travel", "not interested"];

function reusableReason(row: CandidateRow): string {
  if (contains(row.final_decision || row.status, ["selected"])) return "Selected candidate - keep warm till joining";
  if (contains(row.final_decision || row.status, ["hold"])) return "Hold candidate - reusable after follow-up";
  if (contains(row.status || row.walkin_end_stage, ["no show"])) return "No show - reattempt confirmation call";
  if (contains(row.final_decision || row.status, ["rejected"])) {
    const reason = normalizeText(row.rejection_voc) || normalizeText(hardRejectReason(row));
    if (reason && RESOLVABLE_REJECTIONS.some((p) => reason.toLowerCase().includes(p))) {
      return `Rejected on a resolvable reason - recheck: ${reason}`;
    }
    return "";
  }
  if (roundSuccessCount(row) >= 2) return "Passed multiple rounds - reusable for similar process";
  return "";
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
  /**
   * No-show and client-round come off `status`, with `walkin_end_stage` only as a fallback.
   *
   * They used to be read from the end stage alone, and neither state is recorded there: on
   * production 2026-08-27 the status column holds 557 'No Show' and 58 'Client Round - Pending'
   * candidates while the end stage holds zero of either. Both counters therefore reported 0 on
   * every tile, every branch row and every source row — 615 candidates in states the dashboard
   * asserted did not exist. It also silenced two of this module's own recommendations, which
   * only fire above a threshold of 3 (see buildInsights).
   */
  const noShow = contains(status || endStage, ["no show", "noshow"]);
  const clientRoundPending = contains(status || endStage, ["client round"]) && !selected && !rejected;
  const walkout = contains(status || endStage, ["walkout", "dropout", "walk out", "drop out"]);
  /**
   * A dormant row is a candidate the pipeline has finished with but which carries no outcome:
   * status 'Inactive', no branch, no source, no process, no decision. There are 2,624 of them,
   * all from one import, and they are 32% of every arrival count on this page. They are flagged
   * rather than deleted so `summary.dormant` can state the number instead of burying it in
   * every denominator.
   */
  const dormant = contains(status, ["inactive"]) && !selected && !rejected && !waiting && !onHold;
  /**
   * 453 candidates carry a creation date in the future — the furthest is 2026-12-04, and 226 of
   * them are already marked rejected. Flagged rather than dropped: they are real rows and
   * belong in the counts, but they must not be allowed to occupy the top of a newest-first list
   * and push the actual latest activity out of view.
   */
  const futureDated = !!createdAt && createdAt.getTime() > now.getTime();
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
    /**
     * Elapsed time for anything still open, not only for status 'Waiting'.
     *
     * The old ternary zeroed every other status, and the live queue is built from open rows
     * rather than from waiting ones — so all five rows in it reported a 0m wait, including a
     * candidate who had been at 'Arrival' for 48 days. Median, mean and longest-wait all read
     * 0m off the back of it. The elapsed figure was never missing; it was in `_totalMinutes` on
     * the same record the whole time.
     */
    WaitingMinutes: waiting || onHold || clientRoundPending ? totalMinutes : 0,
    SLAFlag: row.sla_breached ? "Yes" : "No",
    Email: row.email,
    _createdAt: createdAt ? createdAt.toISOString() : null,
    _dateKey: createdAt ? formatDateKey(createdAt) : "",
    _monthKey: createdAt ? monthKey(createdAt) : "",
    _weekKey: createdAt ? formatDateKey(startOfWeek(createdAt)) : "",
    _role: row.role_applied || row.applied_for_process || "Unspecified",
    /**
     * Branch, process and source are resolved through the masters and the shared vocabulary
     * rather than grouped on whatever string the row happens to carry.
     *
     * `applied_for_process` holds a process UUID on some rows, so six raw
     * `04f20ddc-67ba-11f1-…` values were being offered to the user as process names in the
     * filter and ranked as processes in the table. `resolved_process_name` is the master's name
     * for exactly those rows (they resolve to Onfido, Exicom, DU Digital, IDAM Natural Wellness,
     * Guardian Healthcare and Eresolution), joined by id because two distinct processes share
     * the name BSS-OTHERS and a name join would merge them.
     *
     * `_branch` folds Jaldarshan into AHMEDABAD-JALDARSHAN; `_site` keeps Okaya Centre,
     * Trapezoid and Neelkanth, which are buildings inside Noida rather than branches, so the
     * distinction recruiters use is preserved instead of being renamed away.
     *
     * `_source` folds WALKIN/Walk-In/walk-in onto one channel. They were three separate rows
     * competing in the same ranking, which is what decided the "best converting channel" verdict.
     */
    _branch: canonicalBranch(row.branch_text || row.resolved_branch_name || row.applied_for_branch),
    _site: normalizeText(row.branch_text || row.applied_for_branch) || "Unspecified",
    // Region above branch, from branch_master.state. Without it Gujarat and Noida operations sit
    // side by side in one flat list with nothing saying they are different geographies.
    _region: branchRegion(row.branch_text || row.resolved_branch_name || row.applied_for_branch),
    _process: row.process_text || row.resolved_process_name || row.applied_for_process || "Unspecified",
    // Label and key derive from the SAME field, in the same order. Deriving the label from one
    // and the key from the other put two rows on the leaderboard both reading "KHUSHI MISHRA".
    _recruiter: normalizeRecruiterName(row.recruiter_assigned_name || row.recruiter_name) || "Unassigned",
    _recruiterKey: recruiterKey(row.recruiter_assigned_id, row.recruiter_assigned_name || row.recruiter_name),
    _sourcer: row.recruiter_selected || row.referred_by || "Unspecified",
    _source: sourceLabel(row.source_details || row.sourcing_channel),
    _slot: rowSlot(row),
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
    _clientRoundPending: clientRoundPending,
    _futureDated: futureDated,
    _walkout: walkout,
    _dormant: dormant,
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
  const clientRoundPending = rows.filter((r) => r._clientRoundPending).length;
  const dormant = rows.filter((r) => r._dormant).length;
  const slaBreach = rows.filter((r) => r._slaBreached).length;
  /**
   * Averaged over candidates who are actually waiting, not over every row ever loaded.
   *
   * The old mean divided total elapsed time by all rows, which folded in every closed candidate
   * plus the 2,624 dormant ones. Those have no end event, so their elapsed time is measured
   * against now() and grows by 1,440 minutes a day forever — the headline read 32,763 minutes
   * (22.8 days) and was rising daily. `avgWaitAllRows` keeps the old figure so nothing that
   * depended on it silently changes shape.
   */
  const openRows = rows.filter((r) => r._waiting || r._onHold || r._clientRoundPending);
  const avgWaitMinutes = openRows.length
    ? Math.round(openRows.reduce((a, r) => a + Number(r._totalMinutes || 0), 0) / openRows.length)
    : 0;
  const avgWaitAllRows = rows.length ? Math.round(rows.reduce((a, r) => a + Number(r._totalMinutes || 0), 0) / rows.length) : 0;
  /**
   * Median alongside the mean. A handful of candidates open for forty days drags the mean far
   * above anything a recruiter would recognise as "the usual wait", and a tile showing only the
   * mean reads as though every candidate waits that long.
   */
  const waits = openRows.map((r) => Number(r._totalMinutes || 0)).sort((a, b) => a - b);
  const medianWaitMinutes = waits.length
    ? (waits.length % 2 ? waits[(waits.length - 1) / 2] : Math.round((waits[waits.length / 2 - 1] + waits[waits.length / 2]) / 2))
    : 0;
  const futureDated = rows.filter((r) => r._futureDated).length;
  /**
   * How much of the funnel is attributed to nothing. Each of these was previously the largest
   * entry in its own ranked table, competing with real branches, processes and recruiters as
   * though it were one of them. Stated as a gap so it reads as a data problem to fix rather
   * than as a top performer.
   */
  const unattributed = {
    branch: rows.filter((r) => isPlaceholderDimension(r._branch)).length,
    process: rows.filter((r) => isPlaceholderDimension(r._process)).length,
    source: rows.filter((r) => isPlaceholderDimension(r._source)).length,
    recruiter: rows.filter((r) => isPlaceholderDimension(r._recruiter)).length,
  };
  /**
   * Candidates carrying no outcome at all. Selected + rejected + waiting + on-hold + no-show
   * accounted for 4,788 of 8,240 arrivals, and nothing on the page named the missing 3,452 — they
   * simply sat in every denominator. Stated explicitly so a reader can see the gap rather than
   * infer it by subtraction.
   */
  const unaccounted = rows.filter((r) =>
    !r._selected && !r._rejected && !r._waiting && !r._onHold &&
    !r._noShow && !r._clientRoundPending && !r._walkout && !r._dormant).length;
  /**
   * Rows counted in more than one bucket — a rejected no-show is both. Reported because the
   * buckets are not mutually exclusive, so selected+rejected+waiting+… can exceed arrivals and
   * a reader reconciling the tiles by addition would otherwise find 5 rows they cannot explain.
   */
  const multiBucket = rows.filter((r) =>
    [r._selected, r._rejected, r._waiting, r._onHold, r._noShow, r._clientRoundPending, r._walkout]
      .filter(Boolean).length > 1).length;
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
    dormant,
    unaccounted,
    multiBucket,
    pending: waiting + clientRoundPending,
    slaBreach,
    unattributed,
    avgWaitMinutes,
    medianWaitMinutes,
    avgWaitAllRows,
    futureDated,
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

/**
 * The placeholder buckets: rows the pipeline never attributed to anything.
 *
 * "Unassigned" recruiter (2,745 rows), "Unspecified" branch (2,735), "Unspecified" process
 * (2,750) and "Unspecified" source (2,735) are not a recruiter, a branch, a process or a
 * channel. They are the absence of one. Ranked alongside real entities they win — "Unassigned"
 * was the number-one recruiter on the leaderboard with 33.3% of all volume, a 0% selection rate
 * and a 95.6% SLA score, and "Unspecified" was the largest branch and the largest process.
 *
 * They are kept in the tables (removing them would break every total) but flagged and sorted
 * last, so the ranking ranks real things and the gap is reported as a gap.
 */
const PLACEHOLDER_DIMENSIONS = new Set(["unassigned", "unspecified", "", "unknown", "n/a", "none"]);

function isPlaceholderDimension(name: unknown): boolean {
  return PLACEHOLDER_DIMENSIONS.has(String(name ?? "").trim().toLowerCase());
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
    ClientRoundPending: items.filter((r) => r._clientRoundPending).length,
    NoShow: items.filter((r) => r._noShow).length,
    Dormant: items.filter((r) => r._dormant).length,
    SlaBreach: items.filter((r) => r._slaBreached).length,
    // Open rows only — see summarizeRows(). Over every row this reported 94,417 minutes (65
    // days) for the Unspecified branch and grew by a day every day.
    AvgWaitMinutes: (() => {
      const open = items.filter((r) => r._waiting || r._onHold || r._clientRoundPending);
      return open.length ? Math.round(open.reduce((a, r) => a + Number(r._totalMinutes || 0), 0) / open.length) : 0;
    })(),
    SelectionRate: items.length ? Math.round((items.filter((r) => r._selected).length / items.length) * 1000) / 10 : 0,
    PendingRate: items.length ? Math.round(((items.filter((r) => r._waiting).length) / items.length) * 1000) / 10 : 0,
    IsUnattributed: isPlaceholderDimension(name),
  })).sort((a, b) =>
    Number(a.IsUnattributed) - Number(b.IsUnattributed) ||
    Number(b.TotalArrival) - Number(a.TotalArrival));
}

/**
 * Recruiter leaderboard, grouped on recruiter identity rather than on the name string.
 *
 * Grouping on `_recruiter` split eleven people into twenty-two rows, because the legacy import
 * writes SOFIYA SULTAN and the current app writes Sofiya Sultan, and a JavaScript Map is
 * case-sensitive where MySQL's collation is not. Both halves then competed in the same ranking
 * with half the volume each: Sofiya Sultan showed at 519 and 512 instead of 1,031, and the
 * genuine number-two recruiter (686) appeared at rank six. `_recruiterKey` prefers the foreign
 * key and case-folds the name only where no key exists.
 */
function recruiterProductivity(rows: CandidateRow[]) {
  return Object.entries(groupBy(rows, "_recruiterKey")).map(([, items]) => {
    const recruiter = preferredRecruiterName(items.map((r) => normalizeText(r._recruiter)));
    const attended = items.filter((r) => !r._waiting || r._selected || r._rejected || r._onHold).length;
    const sourced = items.length;
    const selection = items.filter((r) => r._selected).length;
    const breach = items.filter((r) => r._slaBreached).length;
    /**
     * Averaged over rows still open, matching summarizeRows(). Over every row it folded in
     * closed candidates whose elapsed time keeps growing against now(), which pushed every
     * recruiter past the 120-minute threshold below and stamped all 32 of them "High Attention"
     * — a flag on everyone is a flag on no one.
     */
    const openItems = items.filter((r) => r._waiting || r._onHold || r._clientRoundPending);
    const avgWait = openItems.length
      ? Math.round(openItems.reduce((a, r) => a + Number(r._totalMinutes || 0), 0) / openItems.length)
      : 0;
    const selectionRate = sourced ? Math.round((selection / sourced) * 1000) / 10 : 0;
    const slaCompliancePercent = sourced ? Math.round(((sourced - breach) / sourced) * 1000) / 10 : 0;
    const handlingQualityScore = sourced ? Math.round(items.reduce((a, r) => a + Number(r._handlingQualityScore || 0), 0) / sourced) : 0;
    const qualityScore = sourced ? Math.round(items.reduce((a, r) => a + Number(r._candidateQualityScore || 0), 0) / sourced) : 0;
    /**
     * Breach RATE, not a raw breach count. `breach >= 3` made the flag a proxy for volume: any
     * recruiter who had ever handled a few dozen candidates tripped it, while someone with two
     * candidates and both breached did not.
     */
    const breachRate = sourced ? Math.round((breach / sourced) * 1000) / 10 : 0;
    let attentionFlag = "Stable";
    if (breachRate >= 25 || avgWait >= 120) attentionFlag = "High Attention";
    else if (slaCompliancePercent < 85 || selectionRate < 15) attentionFlag = "Needs Coaching";

    /**
     * The MTD_* figures are computed over the month-to-date subset. They previously carried the
     * all-time values verbatim — `MTD_SelectionRate` was assigned `selectionRate` and
     * `MTD_BreachRate` was `100 - SlaCompliancePercent` — so on every row of every load the
     * "this month" column equalled the "all time" column exactly, which is how a recruiter with
     * 27 candidates this month showed the same 76% rate as across all 50 they have ever handled.
     */
    const mtd = items.filter((r) => inPeriod(r, "MTD"));
    const mtdSelection = mtd.filter((r) => r._selected).length;
    const mtdBreach = mtd.filter((r) => r._slaBreached).length;
    const mtdOpen = mtd.filter((r) => r._waiting || r._onHold || r._clientRoundPending);

    return {
      Recruiter: recruiter,
      /**
       * Every branch this recruiter sourced into, not the first row's. A single branch cell was
       * how the split identities looked like different people working at different sites.
       */
      Branch: Array.from(new Set(items.map((r) => normalizeText(r._branch)).filter(Boolean))).sort().join(", ") || "Unspecified",
      Sites: Array.from(new Set(items.map((r) => normalizeText(r._site)).filter(Boolean))).sort(),
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
      MTD_Assigned: mtd.length,
      MTD_SelectionRate: mtd.length ? Math.round((mtdSelection / mtd.length) * 1000) / 10 : 0,
      MTD_BreachRate: mtd.length ? Math.round((mtdBreach / mtd.length) * 1000) / 10 : 0,
      MTD_HandlingScore: mtd.length ? Math.round(mtd.reduce((a, r) => a + Number(r._handlingQualityScore || 0), 0) / mtd.length) : 0,
      MTD_AvgWaitMinutes: mtdOpen.length ? Math.round(mtdOpen.reduce((a, r) => a + Number(r._totalMinutes || 0), 0) / mtdOpen.length) : 0,
      BreachRate: breachRate,
      // "Unassigned" is the absence of a recruiter, not a recruiter. Flagged so the leaderboard
      // can rank the people and report the unassigned volume separately instead of crowning it.
      IsUnattributed: isPlaceholderDimension(recruiter),
    };
  }).sort((a, b) =>
    Number(a.IsUnattributed) - Number(b.IsUnattributed) ||
    b.SourcedCount - a.SourcedCount);
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

/**
 * Row cap for the command-center aggregate load.
 *
 * Raised from the implicit 5,000 because the genuine-candidate population is 7,760 and every
 * figure on that dashboard is computed in JS over whatever this returns — so at 5,000 the
 * dashboard was silently reporting a subset as the total. The cap still exists (this loads
 * rows into memory), which is why webData now returns `truncated` rather than pretending
 * the number does not apply.
 */
const WEB_DATA_ROW_LIMIT = 25000;

/**
 * Rejected rows shipped to the Rejections tab. 50 was too few to be usable — the tab is the only
 * place a recruiter can review why candidates were turned away, and 50 of 2,875 with no paging
 * meant most of the queue was unreachable. 500 rows of six projected fields is ~60KB, against
 * the 44.7MB this endpoint used to send, so the cost is negligible and the tab becomes a tool
 * rather than a sample. The payload states the cap so a truncated list can say so.
 */
const REJECTION_ROW_LIMIT = 500;

/**
 * The columns the command-center analytics actually read.
 *
 * webData() selects `c.*` — all 165 columns of ats_candidate — and every figure on the
 * dashboard is then computed in JavaScript over those rows. Measured against production
 * 2026-08-26: 8,229 genuine candidates, `SELECT c.*` 13,538ms warm / 36.3MB, the same rows
 * projected to this list 4,319ms / 8.95MB. Same rows, same derived values, 3.1x faster.
 *
 * This list is NOT a guess at what looks useful. It is every column name read by
 * enrichCandidate() and the helpers it calls (parseCandidateDate, minutesBetween, slotLabel,
 * roundSuccessCount, hardRejectReason, candidateQualityScore, handlingQualityScore,
 * reusableReason) plus the few the tabs render directly. Miss one and the derived `_*` field
 * silently changes for every row — the exact failure this module has already been bitten by.
 * `analyticsProjectionCoverage.contract.test.ts` re-derives the required set from the source
 * of those helpers and fails if this list stops covering it, so adding a `row.foo` read to a
 * helper later breaks the test rather than the dashboard.
 *
 * Deliberately NOT applied to webData(): /submissions hands its rows to
 * UnifiedPerformanceCommandCenter, whose search box filters on Object.values(row), so
 * narrowing the columns there would silently narrow that search. webData() keeps `c.*`.
 */
export const CANDIDATE_ANALYTICS_COLUMNS = [
  "id", "candidate_code", "q_token", "full_name", "email",
  "created_date", "created_time", "created_at", "updated_at", "walk_in_date",
  "hr_form_submission_time",
  "status", "current_stage", "final_decision", "walkin_end_stage",
  "branch_text", "applied_for_branch", "process_text", "applied_for_process", "role_applied",
  "recruiter_assigned_name", "recruiter_name", "recruiter_email", "recruiter_mobile",
  "recruiter_selected", "referred_by", "recruiter_id",
  // recruiter_assigned_id is the identity the leaderboard groups on. Without it the grouping
  // falls back to the display name and splits one person across their spellings.
  "recruiter_assigned_id",
  "source_details", "sourcing_channel", "walkin_slot",
  "sla_breached", "aht_minutes",
  "round1_result", "skilltest_result", "round2_result", "round3_result",
  "round1_voc", "skilltest_voc", "round2_voc", "round3_voc",
  "remarks", "rejection_voc",
] as const;

/**
 * Same shape as candidateSelect(), but projecting only CANDIDATE_ANALYTICS_COLUMNS.
 *
 * Column names come from a frozen const list and never from caller input, so interpolating
 * them into the SQL text is safe; the WHERE clause keeps its bound parameters.
 */
async function candidateSelectAnalytics(where = "1=1", params: unknown[] = [], limit = 5000): Promise<CandidateRow[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const cols = CANDIDATE_ANALYTICS_COLUMNS.map((c) => `c.\`${c}\``).join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${cols},
            pm.process_name AS resolved_process_name,
            bm.branch_name  AS resolved_branch_name,
            COALESCE(c.candidate_code, c.id) AS candidate_id
       FROM ats_candidate c
       /**
        * applied_for_process and applied_for_branch are free text on most rows and a master UUID
        * on some — 21 candidates carry a process id, 19 a branch id. Grouped raw, those ids were
        * rendered to the user as process and branch names. Joined by id, not by name: two
        * distinct processes are both called BSS-OTHERS, so a name join would merge them.
        * LEFT JOIN, so the free-text majority is untouched and resolution is purely additive.
        */
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
       LEFT JOIN branch_master  bm ON bm.id = c.applied_for_branch
      WHERE ${where}
      ORDER BY COALESCE(c.created_date, c.created_at) DESC, c.created_at DESC
      LIMIT ${safeLimit}`,
    params
  );
  return rows.map(enrichCandidate);
}

async function candidateSelect(where = "1=1", params: unknown[] = [], limit = 5000): Promise<CandidateRow[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*,
            pm.process_name AS resolved_process_name,
            bm.branch_name  AS resolved_branch_name,
            COALESCE(c.candidate_code, c.id) AS candidate_id
       FROM ats_candidate c
       /**
        * applied_for_process and applied_for_branch are free text on most rows and a master UUID
        * on some — 21 candidates carry a process id, 19 a branch id. Grouped raw, those ids were
        * rendered to the user as process and branch names. Joined by id, not by name: two
        * distinct processes are both called BSS-OTHERS, so a name join would merge them.
        * LEFT JOIN, so the free-text majority is untouched and resolution is purely additive.
        */
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
       LEFT JOIN branch_master  bm ON bm.id = c.applied_for_branch
      WHERE ${where}
      ORDER BY COALESCE(c.created_date, c.created_at) DESC, c.created_at DESC
      LIMIT ${safeLimit}`,
    params
  );
  return rows.map(enrichCandidate);
}

type CandidateFilters = { fromDate?: string; toDate?: string; branch?: string; process?: string; recruiter?: string; period?: Period; actorId?: string; bypassScope?: boolean };

/**
 * The WHERE clause shared by webData() and commandCenterData().
 *
 * Extracted rather than duplicated: these two paths must agree on scope, legacy exclusion and
 * date bounds exactly, or the command center and the daily report would answer the same
 * question with different numbers. One of them being wrong would be obvious; both being
 * subtly different would not.
 */
async function buildCandidateFilters(filters: CandidateFilters): Promise<{ where: string; params: unknown[] }> {
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
  // ats_candidate holds 29,926 legacy EMPLOYEE records (candidate_code matching a real
  // employees.employee_code) alongside 7,760 genuine candidates — measured 2026-08-11.
  // Without this every tile on the ATS Command Center counted them: "Applied" reads 34,923
  // against a true 5,056. The exclusion belongs here rather than inside candidateSelect(),
  // which is also used to fetch a single candidate by id and to run candidateJourney's
  // search — both of which must still find an ex-employee's record.
  conds.push(excludeEmployeeShapedCandidatesSql("c"));
  // IDC is a separate legal entity. Its 2,738 imported profiles carry no branch, process,
  // source or recruiter because they were never MAS recruitment — they were the whole of every
  // "Unspecified" and "Unassigned" bucket on this dashboard. See the helper for the census.
  conds.push(excludeOtherEntityCandidatesSql("c"));
  return { where: conds.join(" AND "), params };
}

/**
 * How many rows the entity scope held out.
 *
 * Lives here rather than inside commandCenterData() so the exclusion predicates stay in one
 * place — webDataLegacyExclusion.contract.test.ts asserts the service methods never build their
 * own copy of a scope rule, which is exactly how four rival funnel implementations already
 * drifted apart in this module family.
 *
 * Reported, not silently dropped: a dashboard that quietly loses 2,738 rows misleads as surely
 * as one that quietly counts them.
 */
async function countOtherEntityCandidates(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM ats_candidate c
      WHERE c.active_status = 1
        AND ${excludeEmployeeShapedCandidatesSql("c")}
        AND NOT (${excludeOtherEntityCandidatesSql("c")})`,
  );
  return Number(rows[0]?.cnt ?? 0);
}

export const atsFullParityService = {
  async webData(filters: { fromDate?: string; toDate?: string; branch?: string; process?: string; recruiter?: string; period?: Period; actorId?: string; bypassScope?: boolean } = {}) {
    const { where, params } = await buildCandidateFilters(filters);

    const allRows = await candidateSelect(where, params, WEB_DATA_ROW_LIMIT);
    // candidateSelect caps rows and every figure below is computed in JS over what came back,
    // so a cap that is hit silently understates every total. Report it instead: genuine
    // candidates are already 7,760 and rising, so this is reached in normal operation, not
    // only in some pathological case.
    const truncated = allRows.length >= WEB_DATA_ROW_LIMIT;
    const period = filters.period || "ALL";
    const candidateRows = allRows.filter((r) => inPeriod(r, period));
    const queueRows = allRows
      .filter(isOpenQueueRow)
      .sort((a, b) => Number(b.WaitingMinutes || 0) - Number(a.WaitingMinutes || 0));
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
        // "op" as a substring matched anything containing those two letters — Offer, Dropout,
        // Operations — so this column counted stages that are not the Ops round. The live stage
        // string is "Round 2- Op's"; "assessment" appears on no row at all, the skill test is
        // recorded as "Interview - Skill Test".
        "HR Screening": rows.filter((r) => contains(r._endStage, ["hr screening"])).length,
        Assessment: rows.filter((r) => contains(r._endStage, ["assessment", "skill test"])).length,
        "OP's Round": rows.filter((r) => contains(r._endStage, ["op's", "ops round", "round 2"])).length,
        "Client Round": rows.filter((r) => contains(r._endStage, ["client"])).length,
      };
    });
    const cfg = await getConfigMap();
    return {
      ok: true,
      // Consumed by the command-center tabs so a capped dataset can say so rather than
      // presenting a short count as the whole picture.
      truncated,
      rowLimit: WEB_DATA_ROW_LIMIT,
      rowsLoaded: allRows.length,
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
      regionTable: dimensionTable(candidateRows, "_region"),
      processTable: dimensionTable(candidateRows, "_process"),
      roleTable: dimensionTable(candidateRows, "_role"),
      sourceTable: dimensionTable(candidateRows, "_source"),
      recruiterTable: recruiterProductivity(candidateRows),
      slotTable: dimensionTable(candidateRows, "_slot"),
      reusablePool: candidateRows.filter((r) => r._reusableReason).slice(0, 100),
    };
  },

  /**
   * The ATS Command Center's payload.
   *
   * webData() exists for /queue, /submissions and the daily branch report, which need whole
   * candidate rows. The dashboard does not: measured 2026-08-26, it was shipping 8,229 rows x
   * 206 fields = 44.7MB of JSON so the browser could render a 210-row queue, 50 rejection rows
   * and a set of counts. Against a 30s client timeout (hrmsApi's default, which this page does
   * not override) that is what "the Command Center times out" means.
   *
   * So: identical aggregates, computed by the identical helpers over the identical rows, but
   * only the rows the tabs actually render leave the server, projected to the fields they
   * render. Everything dropped below was verified unread by the page first.
   */
  async commandCenterData(filters: CandidateFilters = {}) {
    const { where, params } = await buildCandidateFilters(filters);
    const allRows = await candidateSelectAnalytics(where, params, WEB_DATA_ROW_LIMIT);
    const truncated = allRows.length >= WEB_DATA_ROW_LIMIT;
    const excludedOtherEntity = await countOtherEntityCandidates();
    const period = filters.period || "ALL";
    const candidateRows = allRows.filter((r) => inPeriod(r, period));
    const queueRows = allRows
      .filter(isOpenQueueRow)
      .sort((a, b) => Number(b.WaitingMinutes || 0) - Number(a.WaitingMinutes || 0));
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
        // "op" as a substring matched anything containing those two letters — Offer, Dropout,
        // Operations — so this column counted stages that are not the Ops round. The live stage
        // string is "Round 2- Op's"; "assessment" appears on no row at all, the skill test is
        // recorded as "Interview - Skill Test".
        "HR Screening": rows.filter((r) => contains(r._endStage, ["hr screening"])).length,
        Assessment: rows.filter((r) => contains(r._endStage, ["assessment", "skill test"])).length,
        "OP's Round": rows.filter((r) => contains(r._endStage, ["op's", "ops round", "round 2"])).length,
        "Client Round": rows.filter((r) => contains(r._endStage, ["client"])).length,
      };
    });

    /**
     * Rejection reasons, grouped here instead of in the browser.
     *
     * RejectionsTab did this over all 8,229 candidate rows to render one chart and the first
     * 50 records. The grouping key and its normalisation are copied from that component
     * exactly — _hardRejectReason, then rejection_voc, then "Unspecified", lowercased and
     * trimmed — so the bars do not move.
     */
    /**
     * Rejected means rejected. The filter used to be `_rejected || _hardRejectReason`, which
     * swept in 23 candidates who carry a stored reason without having been rejected — so this
     * tab reported 2,875 while the Cover and Sourcing tiles, built from `_rejected` alone,
     * reported 2,852 for the same scope on the same page.
     */
    const rejected = candidateRows.filter((r) => r._rejected);
    const reasonMap = new Map<string, { label: string; count: number }>();
    for (const r of rejected) {
      for (const label of rejectionReasons(r)) {
        const key = label.toLowerCase();
        const current = reasonMap.get(key) ?? { label, count: 0 };
        current.count += 1;
        reasonMap.set(key, current);
      }
    }

    const queueCard = (r: CandidateRow) => ({
      CandidateID: r.CandidateID, FullName: r.FullName, Branch: r.Branch, RoleApplied: r.RoleApplied,
      CurrentStage: r.CurrentStage, QToken: r.QToken, RecruiterAssignedName: r.RecruiterAssignedName,
      SLAFlag: r.SLAFlag, WaitingMinutes: r.WaitingMinutes,
    });

    return {
      ok: true,
      truncated,
      rowLimit: WEB_DATA_ROW_LIMIT,
      rowsLoaded: allRows.length,
      /** IDC rows held out of scope — reported so the totals can be reconciled. */
      excludedOtherEntity,
      refreshTime: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      options: buildOptions(allRows, queueRows),
      summary: summarizeRows(candidateRows),
      dashboardRows,
      /**
       * Capped because this is the only unbounded row list left. The live open queue is 5 rows
       * (measured 2026-08-26 through this exact predicate — OPEN_STATUSES intersected with
       * OPEN_QUEUE_STAGES, minus selected and rejected), so the cap is nowhere near reached
       * today. queueTotal carries the real figure regardless, so a capped list can say so
       * rather than reading as the whole queue.
       */
      queueRows: queueRows.slice(0, 500).map(queueCard),
      queueTotal: queueRows.length,
      branchTable: dimensionTable(candidateRows, "_branch"),
      regionTable: dimensionTable(candidateRows, "_region"),
      processTable: dimensionTable(candidateRows, "_process"),
      sourceTable: dimensionTable(candidateRows, "_source"),
      recruiterTable: recruiterProductivity(candidateRows),
      /**
       * Name pairs that look like one person under two conventions. Case-duplicates are merged
       * outright by recruiterKey(); these are the ones only a human can confirm, so the tab can
       * show "these two rows may be the same recruiter" instead of quietly ranking them apart.
       */
      recruiterDuplicateSuspects: suspectedDuplicateRecruiters(recruiterProductivity(candidateRows).map((r) => r.Recruiter)),
      slotTable: dimensionTable(candidateRows, "_slot"),
      rejections: {
        total: rejected.length,
        // Reason mentions, which exceed `total` where a candidate carries more than one reason.
        // Reported separately so the chart can say which number its bars add up to.
        reasonTotal: [...reasonMap.values()].reduce((a, r) => a + r.count, 0),
        distinctReasons: reasonMap.size,
        reasons: [...reasonMap.values()].sort((a, b) => b.count - a.count),
        /**
         * Newest first, then capped — the cap used to be applied to whatever order the rows
         * arrived in. `candidateRows` is ordered by created date descending, but the rejection
         * subset was re-sliced without re-sorting, so "First 50 of 2,875" landed on a block
         * spanning 12 May to 12 June and stopped: none of the current month's 465 rejections
         * were reachable, and the row ids ran out of sequence between loads. Sorting on the
         * rejection's own date makes the first page the most recent one.
         */
        rows: [...rejected]
          // Future-dated rows sort last. 226 rejections carry a creation date after today —
          // newest-first alone would fill the whole first page with them and hide the rejections
          // that actually happened this week.
          .sort((a, b) =>
            Number(!!a._futureDated) - Number(!!b._futureDated) ||
            String(b._createdAt ?? "").localeCompare(String(a._createdAt ?? "")))
          .slice(0, REJECTION_ROW_LIMIT)
          .map((r) => ({
            CandidateID: r.CandidateID, FullName: r.FullName, Branch: r.Branch,
            _createdAt: r._createdAt, _dateKey: r._dateKey,
            _endStage: r._endStage, _hardRejectReason: r._hardRejectReason,
            rejection_voc: r.rejection_voc, _reasons: rejectionReasons(r),
          })),
        rowLimit: REJECTION_ROW_LIMIT,
      },
      /**
       * `reusableTotal` is the size of the pool; `reusablePool` is the page of it that ships.
       * The tile read "100 · Prior candidates worth re-approaching" off the length of a
       * `.slice(0, 100)`, presenting the cap as the measurement.
       */
      reusableTotal: candidateRows.filter((r) => r._reusableReason).length,
      reusablePool: candidateRows.filter((r) => r._reusableReason).slice(0, 100).map((r) => ({
        CandidateID: r.CandidateID, FullName: r.FullName, Branch: r.Branch,
        _candidateQualityLabel: r._candidateQualityLabel, _reusableReason: r._reusableReason,
      })),
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
    // Match on mobile only when it's a plausible real number. A single-digit placeholder
    // value is shared by 539 ats_candidate rows and 1,284 employees rows (confirmed
    // live) — matching on it would UPDATE an unrelated existing candidate's record in
    // place instead of creating a new one, the highest-risk failure mode of this check.
    const isRealMobile = /^[6-9]\d{9}$/.test(mobile);
    const [existing] = isRealMobile
      ? await db.execute<CandidateLookupRow[]>(
          `SELECT id, candidate_code, employee_code, full_name, mobile, email, address,
                  education, experience, gender, role_applied, branch_text, applied_for_branch,
                  applied_for_process, recruiter_selected, recruiter_id, recruiter_assigned_name,
                  recruiter_email, recruiter_mobile, q_token, status, source,
                  aadhar_number_masked, pan_number_masked, bank_account_no_masked,
                  aadhar_number_hash, pan_number_hash, bank_account_no_hash,
                  active_status, created_at, updated_at
           FROM ats_candidate WHERE mobile = ? AND active_status = 1 ORDER BY created_at DESC LIMIT 1`,
          [mobile]
        )
      : [[] as CandidateLookupRow[]];
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
        [randomUUID(), rowText(row, "candidate_code") || rowText(row, "id"), rowText(row, "q_token") || null, diff, threshold, (await this.resolveSlaRecipient(row)) || null, await this.resolveSlaCc(row)]
      );
      const candidateKey = rowText(row, "candidate_code") || rowText(row, "id");
      const already = await this.hasEmailBeenSent(candidateKey, "SLA_BREACH");
      if (!already) {
        const cc = await this.resolveSlaCc(row);
        const to = await this.resolveSlaRecipient(row);
        await sendTemplateEmail("SLA_BREACH", candidateKey, to, cc, {
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

  /**
   * The address an SLA breach alert should go to.
   *
   * This used to be `row.recruiter_email` and nothing else. That column is populated on 2 of the
   * 1,407 candidates the SLA scan covers, so every alert resolved to an empty TO and was logged
   * `skipped / "Missing TO email"`. Production carries 1,454 such rows and ZERO sent ones: the
   * breach alerting has run since the feature shipped and has never once reached a human.
   *
   * The address was always available. `ats_recruiter_roster` holds an email for all 26 active
   * recruiters; the candidate row just does not carry it. So: try the candidate's own column,
   * then the roster by recruiter id, then by name — through the same alias map the leaderboard
   * uses, because the roster stores MEHAR while the candidate says Mehar Sheikh — and finally
   * the branch's configured HR mailbox.
   *
   * Returns "" only when there is genuinely no recipient anywhere, which the caller logs with a
   * reason that distinguishes it from a broken lookup.
   */
  async resolveSlaRecipient(row: CandidateRow): Promise<string> {
    const direct = normalizeText(row.recruiter_email);
    if (direct.includes("@")) return direct;

    const byId = normalizeText(row.recruiter_assigned_id);
    const rawName = normalizeText(row.recruiter_assigned_name || row.recruiter_name);
    const canonical = normalizeRecruiterName(rawName);
    if (byId || rawName) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT email, name FROM ats_recruiter_roster
          WHERE active_status = 1 AND email IS NOT NULL AND email <> ''
            AND (id = ? OR recruiter_code = ? OR LOWER(TRIM(name)) = ? OR LOWER(TRIM(name)) = ?)
          LIMIT 1`,
        [byId || "", byId || "", rawName.toLowerCase(), canonical.toLowerCase()],
      );
      const hit = normalizeText(rows[0]?.email);
      if (hit.includes("@")) return hit;
    }

    // Branch mailbox, same config the CC list already reads.
    const cfg = await getConfigMap();
    const branch = normalizeText(row.branch_text || row.applied_for_branch);
    for (const map of [cfg.HR_Emails_By_Branch, cfg.Ops_Emails_By_Branch]) {
      if (!map) continue;
      for (const part of String(map).split(";")) {
        const [k, ...rest] = part.split("=");
        const val = rest.join("=").trim();
        if (normalizeText(k) === branch && val.includes("@")) return val.split(/[;,]/)[0].trim();
      }
    }
    return "";
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
    const checks: Array<{ type: string; name: string; ok: boolean; count?: number; detail?: string }> = [];
    // Schema probes keep their own category so they stop masquerading as health. They answer
    // "is this deployed", which is worth knowing and is not the same question.
    const tableNames = ["ats_candidate", "ats_recruiter_roster", "ats_command_config", "ats_email_template", "ats_command_email_log", "ats_command_audit_log", "ats_voc_lookup", "ats_forms_catalog", "ats_form_field_mapping", "ats_candidate_confirmation", "ats_bgv_response", "ats_doc_upload_response", "ats_recruiter_device", "ats_notification_log"];
    for (const table of tableNames) {
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
      checks.push({ type: "schema", name: table, ok: Number(rows[0]?.cnt ?? 0) > 0 });
    }
    const requiredCandidateCols = ["q_token", "status", "walkin_end_stage", "sla_breached", "candidate_confirm_link", "bgv_form_link", "day1_doc_form_link", "candidate_quality_score", "handling_quality_score"];
    for (const col of requiredCandidateCols) {
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = ?`, [col]);
      checks.push({ type: "schema", name: `ats_candidate.${col}`, ok: Number(rows[0]?.cnt ?? 0) > 0 });
    }
    const [missingRecruiterEmails] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ats_recruiter_roster WHERE active_status = 1 AND available_today = 'Y' AND (email IS NULL OR email = '')`);
    checks.push({ type: "integration", name: "available_recruiters_missing_email", ok: Number(missingRecruiterEmails[0]?.cnt ?? 0) === 0, count: Number(missingRecruiterEmails[0]?.cnt ?? 0) });
    const [templates] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ats_email_template WHERE active_status = 1`);
    checks.push({ type: "integration", name: "email_templates_configured", ok: Number(templates[0]?.cnt ?? 0) >= 3, count: Number(templates[0]?.cnt ?? 0) });

    /**
     * The checks the banner has always claimed to run.
     *
     * Everything above this point asks "does this table exist" and "does this column exist".
     * That is a deployment check, not a health check, and it answered "25 of 25 passing across
     * data integrity, SLA, notifications and integrations" on a page that was simultaneously
     * reporting a queue of 5 against a real 217, a rejection count that disagreed with its own
     * tiles, and 615 candidates in states it rendered as zero. None of those categories had a
     * single check in it — every check fell into the tab's "category is not one of the four
     * known types" fallback bucket, which is a defensive branch that had quietly become the
     * whole tab.
     *
     * These run against the data. They are allowed to fail; a health tab that cannot go amber
     * is decoration.
     */
    // Scoped to MAS. Without the entity filter these probes report IDC's 2,735 unattributed
    // rows as MAS data-quality failures in perpetuity — a permanent red that no MAS action can
    // ever clear, which is how a health tab teaches people to ignore it.
    const scoped = `active_status = 1 AND record_type = 'candidate' AND candidate_code NOT LIKE 'IDC%'`;
    const countOf = async (label: string, type: string, sql: string, isOk: (n: number) => boolean, detail: string) => {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(sql);
        const n = Number(rows[0]?.cnt ?? 0);
        checks.push({ type, name: label, ok: isOk(n), count: n, detail });
      } catch (err) {
        // A probe that cannot run is a failed probe, never a silent pass.
        checks.push({ type, name: label, ok: false, detail: `probe failed: ${(err as Error).message}` });
      }
    };

    await countOf("candidates_without_branch", "data_integrity",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped} AND (applied_for_branch IS NULL OR applied_for_branch = '')`,
      (n) => n === 0, "Arrivals with no branch cannot be attributed to a site and dilute every branch rate.");

    await countOf("candidates_without_source", "data_integrity",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped} AND (sourcing_channel IS NULL OR sourcing_channel = '')`,
      (n) => n === 0, "Arrivals with no sourcing channel make channel effectiveness unmeasurable.");

    await countOf("unresolved_process_ids", "data_integrity",
      `SELECT COUNT(*) AS cnt FROM ats_candidate c LEFT JOIN process_master pm ON pm.id = c.applied_for_process
        WHERE ${scoped.replace(/active_status/g, "c.active_status").replace(/record_type/g, "c.record_type").replace(/candidate_code/g, "c.candidate_code")}
          AND c.applied_for_process REGEXP '^[0-9a-f]{8}-' AND pm.id IS NULL`,
      (n) => n === 0, "A process id with no master row renders to the user as a raw UUID.");

    await countOf("future_dated_candidates", "data_integrity",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped} AND COALESCE(created_date, DATE(created_at)) > CURDATE()`,
      (n) => n === 0, "A candidate created in the future sorts above real activity in every newest-first list.");

    await countOf("rejections_without_reason", "data_integrity",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped} AND status = 'Rejected' AND (rejection_voc IS NULL OR rejection_voc = '')`,
      (n) => n === 0, "A rejection with no reason cannot be learned from.");

    await countOf("concatenated_rejection_values", "data_integrity",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped} AND rejection_voc REGEXP 'Issue[A-Z]|Skill[A-Z]|Show[A-Z]|Concern[A-Z]|Comprehension[A-Z]|Interested[A-Z]'`,
      (n) => n === 0, "Multi-select reasons written without a separator become fake distinct reasons.");

    await countOf("recruiter_name_spelling_variants", "data_integrity",
      `SELECT COUNT(*) AS cnt FROM (
         SELECT LOWER(TRIM(COALESCE(recruiter_assigned_name, recruiter_name))) nm
           FROM ats_candidate WHERE ${scoped} AND COALESCE(recruiter_assigned_name, recruiter_name) IS NOT NULL
          GROUP BY nm HAVING COUNT(DISTINCT BINARY TRIM(COALESCE(recruiter_assigned_name, recruiter_name))) > 1) t`,
      (n) => n === 0, "One recruiter stored under several spellings splits their leaderboard row.");

    await countOf("open_queue_beyond_7_days", "sla",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped}
         AND LOWER(status) IN ('waiting','hold','client round - pending')
         AND COALESCE(created_date, DATE(created_at)) < DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
      (n) => n === 0, "Candidates still open a week after arriving.");

    await countOf("open_queue_beyond_30_days", "sla",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped}
         AND LOWER(status) IN ('waiting','hold','client round - pending')
         AND COALESCE(created_date, DATE(created_at)) < DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      (n) => n === 0, "Candidates open for a month or more — almost certainly abandoned, not waiting.");

    await countOf("breach_flag_never_computed", "sla",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped} AND sla_breached IS NULL`,
      (n) => n === 0, "A null breach flag is counted as compliant by every SLA figure on this page.");

    /**
     * Points at the log the ATS actually writes.
     *
     * The first version of this check read `ats_notification_log`, which has never held a single
     * row — its only writer is one branch of the payroll-HR salary-validation flow that has
     * never fired. A check against it can only ever be red, and a permanently red check is one
     * people learn to ignore. `ats_command_email_log` is the live path: 1,454 rows.
     */
    await countOf("candidate_emails_actually_sent", "notification",
      `SELECT COUNT(*) AS cnt FROM ats_command_email_log WHERE status = 'sent'`,
      (n) => n > 0, "Every email this module has ever attempted was skipped, not delivered.");

    await countOf("emails_skipped_no_recipient", "notification",
      `SELECT COUNT(*) AS cnt FROM ats_command_email_log WHERE status = 'skipped' AND notes LIKE '%Missing TO%'`,
      (n) => n === 0, "Alerts raised but dropped because no recipient address could be resolved.");

    await countOf("waiting_candidates_without_recruiter_email", "notification",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped}
         AND LOWER(COALESCE(status, current_stage, 'waiting')) = 'waiting'
         AND (recruiter_email IS NULL OR recruiter_email = '')`,
      (n) => n === 0, "The SLA alert falls back to the roster for these; if that misses too, nobody is told.");

    await countOf("overdue_followups", "notification",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped} AND followup_required = 1 AND followup_date < CURDATE()`,
      (n) => n === 0, "Follow-ups flagged and past their date, with nothing surfacing them.");

    await countOf("impossible_followup_dates", "notification",
      `SELECT COUNT(*) AS cnt FROM ats_candidate WHERE ${scoped} AND followup_required = 1 AND followup_date < '2020-01-01'`,
      (n) => n === 0, "A follow-up dated before the product existed is corrupt, not overdue.");

    await countOf("sourcing_channels_absent_from_master", "integration",
      `SELECT COUNT(DISTINCT c.sourcing_channel) AS cnt FROM ats_candidate c
        WHERE c.active_status = 1 AND c.record_type = 'candidate' AND c.candidate_code NOT LIKE 'IDC%'
          AND c.sourcing_channel IS NOT NULL AND c.sourcing_channel <> ''
          AND NOT EXISTS (SELECT 1 FROM ats_sourcing_channel s WHERE s.channel_code = c.sourcing_channel)`,
      (n) => n === 0, "Channels candidates are recorded under that the channel master does not define.");

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
