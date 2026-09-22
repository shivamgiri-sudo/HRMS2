/**
 * Branch Recruitment Activity Report — orchestrator.
 *
 * Three consumers share the same facts/buildReport core: the daily email (scheduler.ts,
 * off by default until ATS_BRANCH_ACTIVITY_REPORT_ENABLED=true), the in-app read
 * (branch-activity-report.routes.ts → getBranchActivityReportData, for the ATS Command
 * Centre "Branch Activity" tab), and any manual/on-demand send.
 */
import nodemailer from "nodemailer";
import { env } from "../../../config/env.js";
import { getCurrentDateIST, getGeneratedAtIST } from "../../../shared/istDate.js";
import { canonicalBranch, recruiterKey } from "../ats-vocabulary.js";
import { fetchRawFacts } from "./query.js";
import { addDays, buildReport, monthStartOf, toFact, type ReportData, type TokenFact } from "./metrics.js";
import { renderEmail, subjectLine } from "./template.js";
import { resolveRecipients } from "./recipients.js";

/** Older tokens are fetched only so long-open ones can be escalated / flagged as stale. */
const OPEN_TOKEN_LOOKBACK_DAYS = 45;

export interface BranchActivityReport {
  branch: string;
  reportDate: string;
  subject: string;
  html: string;
  data: ReportData;
}

function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The same token facts every consumer (email, API read, scheduler) builds its report from. */
async function loadFacts(reportDate: string) {
  const from = [monthStartOf(reportDate), addDays(reportDate, -OPEN_TOKEN_LOOKBACK_DAYS)].sort()[0];
  const { rows } = await fetchRawFacts(from, reportDate);
  return rows.map((r) => toFact(r, canonicalBranch, recruiterKey));
}

/**
 * One combined report across every branch with activity, each branch broken out under
 * `data.branches`. Read-only — no email is built or sent. Backs the ATS Command Centre's
 * "Branch Activity" tab (branch-activity-report.routes.ts).
 */
export async function getBranchActivityReportData(reportDate: string = getCurrentDateIST()): Promise<ReportData> {
  const facts = await loadFacts(reportDate);
  return buildReport({ facts, reportDate });
}

function escapeCsv(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function outcomeLabel(o: string): string {
  const map: Record<string, string> = {
    selected: "Selected",
    rejected: "Rejected",
    no_show: "No Show",
    walkout: "Walk Out",
    hold: "On Hold",
    client_round: "Client Round",
    other_closed: "Other/Closed",
    open: "Open/Pending",
  };
  return map[o] || o;
}

export interface ExportRow {
  branch: string;
  tokenNumber: string;
  candidateName: string;
  process: string;
  recruiter: string;
  arrivalDate: string;
  arrivalTime: string;
  formDate: string;
  status: string;
  waitMinutes: string;
  handleMinutes: string;
}

export async function getBranchActivityExportData(
  reportDate: string = getCurrentDateIST(),
  branchFilter?: string
): Promise<{ rows: ExportRow[]; csv: string }> {
  const facts = await loadFacts(reportDate);
  const filtered = branchFilter
    ? facts.filter((f) => f.branch.toLowerCase() === branchFilter.toLowerCase())
    : facts;

  const exportRows: ExportRow[] = filtered.map((f) => ({
    branch: f.branch,
    tokenNumber: f.tokenNumber,
    candidateName: f.candidateName,
    process: f.process,
    recruiter: f.recruiter,
    arrivalDate: f.arrivalDate,
    arrivalTime: f.arrivalHhmm,
    formDate: f.formDate || "",
    status: outcomeLabel(f.outcome),
    waitMinutes: f.waitMin != null ? String(f.waitMin) : "",
    handleMinutes: f.handleMin != null ? String(f.handleMin) : "",
  }));

  const headers = [
    "Branch", "Token Number", "Candidate Name", "Process", "Recruiter",
    "Arrival Date", "Arrival Time", "Form Date", "Status", "Wait (min)", "Handle (min)",
  ];
  const csvLines = [
    headers.join(","),
    ...exportRows.map((r) =>
      [
        r.branch, r.tokenNumber, r.candidateName, r.process, r.recruiter,
        r.arrivalDate, r.arrivalTime, r.formDate, r.status, r.waitMinutes, r.handleMinutes,
      ].map(escapeCsv).join(",")
    ),
  ];
  return { rows: exportRows, csv: csvLines.join("\r\n") };
}

/** One report per branch, each computed from that branch's tokens only. */
export async function buildBranchActivityReports(reportDate: string = getCurrentDateIST(), dashboardUrl?: string): Promise<BranchActivityReport[]> {
  const facts = await loadFacts(reportDate);
  const generatedAt = getGeneratedAtIST();
  const branches = [...new Set(facts.map((f) => f.branch))].sort();

  return branches.map((branch) => {
    const data = buildReport({
      facts: facts.filter((f) => f.branch === branch),
      reportDate,
    });
    const html = renderEmail(data, { generatedAt, dashboardUrl, dateLabel: dateLabel(reportDate), branchLabel: branch });
    return { branch, reportDate, subject: subjectLine(data, branch), html, data };
  });
}

export interface SendOptions {
  reportDate?: string;
  dashboardUrl?: string;
  /** Limit to these canonical branch names. Default: every branch with activity. */
  branches?: string[];
  /** Default true: build reports and resolve recipients, but send nothing. */
  dryRun?: boolean;
  /** Testing: deliver every branch's email to these addresses instead (no branch head / HR / COO mailed). */
  redirectTo?: string[];
  /** Idempotency hooks: skip a branch already sent for this date (restart / double-registration safe). */
  shouldSend?: (branch: string, reportDate: string) => Promise<boolean>;
  onSent?: (branch: string, reportDate: string) => Promise<void>;
}

export interface BranchSendResult {
  branch: string;
  subject: string;
  to: string[];
  cc: string[];
  toFellBackToHr: boolean;
  status: "sent" | "dry-run" | "skipped" | "failed";
  reason?: string;
  messageId?: string;
}

/** Branch names that are not a real branch (no head to mail). */
const UNMAILABLE_BRANCH = "Unspecified";

export async function sendBranchActivityReports(opts: SendOptions = {}): Promise<BranchSendResult[]> {
  const dryRun = opts.dryRun !== false;
  const wanted = opts.branches?.map((b) => b.toLowerCase());
  const reports = (await buildBranchActivityReports(opts.reportDate, opts.dashboardUrl))
    .filter((r) => !wanted || wanted.includes(r.branch.toLowerCase()));
  if (!dryRun && (!env.SMTP_USER || !env.SMTP_PASS)) throw new Error("sendBranchActivityReports: SMTP is not configured");

  const transporter = dryRun ? null : nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT), secure: false,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  const results: BranchSendResult[] = [];
  for (const r of reports) {
    const base = { branch: r.branch, subject: r.subject };
    try {
      if (r.branch === UNMAILABLE_BRANCH) {
        results.push({ ...base, to: [], cc: [], toFellBackToHr: false, status: "skipped", reason: "activity with no branch recorded" });
        continue;
      }
      const resolved = await resolveRecipients(r.branch);
      const redirected = !!opts.redirectTo?.length;
      const to = redirected ? opts.redirectTo! : resolved.to;
      const cc = redirected ? [] : resolved.cc;
      const subject = redirected ? `[TEST → ${resolved.to.join(", ") || "no branch head"}] ${r.subject}` : r.subject;
      if (!to.length) {
        results.push({ ...base, to, cc, toFellBackToHr: resolved.toFellBackToHr, status: "skipped", reason: "no recipients resolved" });
        continue;
      }
      if (!dryRun && opts.shouldSend && !(await opts.shouldSend(r.branch, r.reportDate))) {
        results.push({ ...base, to, cc, toFellBackToHr: resolved.toFellBackToHr, status: "skipped", reason: "already sent for this date" });
        continue;
      }
      if (dryRun || !transporter) {
        results.push({ ...base, subject, to, cc, toFellBackToHr: resolved.toFellBackToHr, status: "dry-run" });
        continue;
      }
      const info = await transporter.sendMail({
        from: `"MAS HRMS Recruitment Report" <${env.SMTP_FROM || env.SMTP_USER}>`,
        to, cc: cc.length ? cc : undefined, subject, html: r.html,
      });
      await opts.onSent?.(r.branch, r.reportDate);
      results.push({ ...base, subject, to, cc, toFellBackToHr: resolved.toFellBackToHr, status: "sent", messageId: info.messageId });
    } catch (e) {
      results.push({ ...base, to: [], cc: [], toFellBackToHr: false, status: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
