/**
 * Branch Health Report — orchestrator.
 *
 * Builds one HTML email per active branch and sends via SMTP.
 * Off by default: BRANCH_HEALTH_REPORT_ENABLED=true in .env to activate.
 */
import nodemailer from "nodemailer";
import { env } from "../../config/env.js";
import { getCurrentDateIST, getGeneratedAtIST } from "../../shared/istDate.js";
import { fetchAllBranchHealthData } from "./query.js";
import { buildBranchHealthReport, type BranchHealthReport } from "./metrics.js";
import { renderEmail, subjectLine } from "./template.js";
import { resolveRecipients } from "./recipients.js";
import { ownCompanyBranchSql } from "../../shared/ownCompanyCostCentre.js";

/** Branches that do not get this report (owner instruction 2026-09-25). */
const BRANCHES_NOT_REPORTED = ["HEAD OFFICE", "Delhi Office"];

async function activeBranchNames(): Promise<string[]> {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    `SELECT DISTINCT branch_name FROM branch_master WHERE active_status = 1 AND ${ownCompanyBranchSql("")} ORDER BY branch_name`,
  );
  const skipped = new Set(BRANCHES_NOT_REPORTED.map((b) => b.toLowerCase()));
  return (rows as any[])
    .map((r) => String(r.branch_name))
    .filter((name) => name && !skipped.has(name.toLowerCase()));
}

export interface BranchHealthBuilt {
  branch: string;
  reportDate: string;
  subject: string;
  html: string;
  report: BranchHealthReport;
}

export async function buildBranchHealthReports(
  reportDate: string = getCurrentDateIST(),
): Promise<BranchHealthBuilt[]> {
  const branches = await activeBranchNames();
  const generatedAt = getGeneratedAtIST();
  const dashboardUrl =
    process.env.BRANCH_HEALTH_REPORT_DASHBOARD_URL || undefined;

  // One branch at a time: each branch already fans out ~20 queries, and the pool is shared with
  // every worker, so building all branches at once overflows its connection queue.
  const built: BranchHealthBuilt[] = [];
  for (const branch of branches) {
    const raw = await fetchAllBranchHealthData(branch, reportDate);
    const report = buildBranchHealthReport(branch, reportDate, raw);
    const html = renderEmail(report, { generatedAt, dashboardUrl });
    built.push({ branch, reportDate, subject: subjectLine(report), html, report });
  }

  return built;
}

export interface SendOptions {
  reportDate?: string;
  branches?: string[];
  dryRun?: boolean;
  redirectTo?: string[];
  shouldSend?: (branch: string, reportDate: string) => Promise<boolean>;
  onSent?: (branch: string, reportDate: string) => Promise<void>;
}

export interface BranchHealthSendResult {
  branch: string;
  subject: string;
  to: string[];
  cc: string[];
  toFellBackToHr: boolean;
  status: "sent" | "dry-run" | "skipped" | "failed";
  reason?: string;
  messageId?: string;
}

export async function sendBranchHealthReports(
  opts: SendOptions = {},
): Promise<BranchHealthSendResult[]> {
  const dryRun = opts.dryRun !== false;
  const wanted = opts.branches?.map((b) => b.toLowerCase());
  const built = (await buildBranchHealthReports(opts.reportDate)).filter(
    (r) => !wanted || wanted.includes(r.branch.toLowerCase()),
  );

  if (!dryRun && (!env.SMTP_USER || !env.SMTP_PASS)) {
    throw new Error("sendBranchHealthReports: SMTP is not configured");
  }

  const transporter = dryRun
    ? null
    : nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT),
        secure: false,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });

  const results: BranchHealthSendResult[] = [];

  for (const b of built) {
    const base = { branch: b.branch, subject: b.subject };
    try {
      const resolved = await resolveRecipients(b.branch);
      const redirected = !!opts.redirectTo?.length;
      const to = redirected ? opts.redirectTo! : resolved.to;
      const cc = redirected ? [] : resolved.cc;
      const subject = redirected
        ? `[TEST → ${resolved.to.join(", ") || "no branch head"}] ${b.subject}`
        : b.subject;

      if (!to.length) {
        results.push({
          ...base,
          to,
          cc,
          toFellBackToHr: resolved.toFellBackToHr,
          status: "skipped",
          reason: "no recipients resolved",
        });
        continue;
      }
      if (
        !dryRun &&
        opts.shouldSend &&
        !(await opts.shouldSend(b.branch, b.reportDate))
      ) {
        results.push({
          ...base,
          to,
          cc,
          toFellBackToHr: resolved.toFellBackToHr,
          status: "skipped",
          reason: "already sent for this date",
        });
        continue;
      }
      if (dryRun || !transporter) {
        results.push({
          ...base,
          subject,
          to,
          cc,
          toFellBackToHr: resolved.toFellBackToHr,
          status: "dry-run",
        });
        continue;
      }
      const info = await transporter.sendMail({
        from: `"MAS Callnet Branch Health" <${env.SMTP_FROM || env.SMTP_USER}>`,
        to,
        cc: cc.length ? cc : undefined,
        subject,
        html: b.html,
      });
      await opts.onSent?.(b.branch, b.reportDate);
      results.push({
        ...base,
        subject,
        to,
        cc,
        toFellBackToHr: resolved.toFellBackToHr,
        status: "sent",
        messageId: info.messageId,
      });
    } catch (e) {
      results.push({
        ...base,
        to: [],
        cc: [],
        toFellBackToHr: false,
        status: "failed",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}
