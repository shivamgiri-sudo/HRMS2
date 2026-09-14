/**
 * HTML email template for the daily ATS recruiter performance report.
 * Matches the format: interventions → WIWO snapshot → process summary → recruiter productivity.
 */

import type { BranchDailyReport } from "./ats-daily-report.service.js";
import { fmtWait } from "./ats-daily-report.service.js";

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "long" });
}

function attentionBadge(att: "Stable" | "At Risk" | "Critical"): string {
  const map: Record<string, string> = {
    Stable:   "background:#dcfce7;color:#166534;",
    "At Risk":"background:#fef9c3;color:#854d0e;",
    Critical: "background:#fee2e2;color:#991b1b;",
  };
  return `<span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;${map[att]}">${att}</span>`;
}

const TH = `style="padding:8px 10px;background:#f3f4f6;font-size:11px;font-weight:700;color:#374151;text-align:left;border:1px solid #e5e7eb;white-space:nowrap;"`;
const TD = `style="padding:7px 10px;font-size:12px;color:#111827;border:1px solid #e5e7eb;"`;
const TD_NUM = `style="padding:7px 10px;font-size:12px;color:#111827;border:1px solid #e5e7eb;text-align:center;"`;

function periodRow(label: string, m: BranchDailyReport["ftd"]): string {
  return `<tr>
    <td ${TD}><strong>${label}</strong></td>
    <td ${TD_NUM}>${m.walkin}</td>
    <td ${TD_NUM}>${m.selected}</td>
    <td ${TD_NUM}>${m.rejected}</td>
    <td ${TD_NUM}>${m.waiting}</td>
    <td ${TD_NUM}>${m.clientRoundPending}</td>
    <td ${TD_NUM}>${m.noShow}</td>
    <td ${TD_NUM}>${m.slaBreachCount}</td>
    <td ${TD_NUM}>${m.selectionPct}</td>
    <td ${TD_NUM}>${fmtWait(m.avgWaitMinutes)}</td>
  </tr>`;
}

export function buildDailyReportEmail(report: BranchDailyReport, dashboardUrl: string): { subject: string; html: string } {
  const today = new Date();
  const dateStr = fmtDate(today);
  const branch = report.branchName;

  const interventionHtml = report.interventions.length
    ? `<div style="background:#fff7ed;border-left:4px solid #ea580c;padding:14px 16px;border-radius:6px;margin-bottom:20px;">
        <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.5px;">
          ⚠ Top Management Intervention Points
        </p>
        <ul style="margin:0;padding-left:18px;">
          ${report.interventions.map((i) => `<li style="font-size:13px;color:#7c2d12;line-height:1.7;">${i.message}</li>`).join("")}
        </ul>
      </div>`
    : `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 16px;border-radius:6px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;color:#166534;">✓ No critical intervention points today. Good work!</p>
      </div>`;

  const wiwoTable = `
    <p style="margin:16px 0 6px 0;font-size:14px;font-weight:700;color:#dc2626;font-style:italic;">WIWO Journey snapshot for the month</p>
    <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
      <thead><tr>
        <th ${TH}>Period</th><th ${TH}>Walk-in</th><th ${TH}>Selected</th><th ${TH}>Rejected</th>
        <th ${TH}>Waiting</th><th ${TH}>Client Rnd Pending</th><th ${TH}>No Show</th>
        <th ${TH}>SLA Breach</th><th ${TH}>Selection %</th><th ${TH}>Avg Wait</th>
      </tr></thead>
      <tbody>
        ${periodRow("FTD", report.ftd)}
        ${periodRow("WTD", report.wtd)}
        ${periodRow("MTD", report.mtd)}
      </tbody>
    </table>`;

  const processRows = report.processFtd.length
    ? report.processFtd.map((p) => `<tr>
        <td ${TD}>${p.branch}</td>
        <td ${TD}>${p.process}</td>
        <td ${TD_NUM}>${p.walkin}</td>
        <td ${TD_NUM}>${p.selected}</td>
        <td ${TD_NUM}>${p.rejected}</td>
        <td ${TD_NUM}>${p.waiting}</td>
        <td ${TD_NUM}>${p.clientRoundPending}</td>
        <td ${TD_NUM}>${p.noShow}</td>
        <td ${TD_NUM}>${p.pending}</td>
        <td ${TD_NUM}>${p.selectionPct}</td>
        <td ${TD_NUM}>${fmtWait(p.avgWaitMinutes)}</td>
      </tr>`).join("")
    : `<tr><td colspan="11" style="padding:12px;text-align:center;color:#9ca3af;font-size:12px;border:1px solid #e5e7eb;">No walk-ins recorded today</td></tr>`;

  const processTable = `
    <p style="margin:20px 0 6px 0;font-size:14px;font-weight:700;color:#dc2626;font-style:italic;">Process-wise Summary by Branch: FTD</p>
    <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
      <thead><tr>
        <th ${TH}>Branch</th><th ${TH}>Process</th><th ${TH}>Walk-in</th><th ${TH}>Selected</th>
        <th ${TH}>Rejected</th><th ${TH}>Waiting</th><th ${TH}>Client Rnd Pending</th>
        <th ${TH}>No Show</th><th ${TH}>Pending</th><th ${TH}>Selection %</th><th ${TH}>Avg Wait</th>
      </tr></thead>
      <tbody>${processRows}</tbody>
    </table>`;

  const recruiterRows = report.recruiterFtd.length
    ? report.recruiterFtd.map((r) => `<tr>
        <td ${TD}><strong>${r.recruiter}</strong></td>
        <td ${TD}>${r.branch}</td>
        <td ${TD_NUM}>${r.sourced}</td>
        <td ${TD_NUM}>${r.attended}</td>
        <td ${TD_NUM}>${r.slaPct}</td>
        <td ${TD_NUM}>${r.selectionPct}</td>
        <td ${TD_NUM}>${fmtWait(r.avgWaitMinutes)}</td>
        <td ${TD_NUM}>${r.pendingCount > 0 ? `<span style="color:#dc2626;font-weight:700;">${r.pendingCount}</span>` : "0"}</td>
        <td style="padding:7px 10px;border:1px solid #e5e7eb;">${attentionBadge(r.attention)}</td>
      </tr>`).join("")
    : `<tr><td colspan="9" style="padding:12px;text-align:center;color:#9ca3af;font-size:12px;border:1px solid #e5e7eb;">No recruiter activity today</td></tr>`;

  const recruiterTable = `
    <p style="margin:20px 0 6px 0;font-size:14px;font-weight:700;color:#111827;">Recruiter Productivity: FTD</p>
    <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
      <thead><tr>
        <th ${TH}>Recruiter</th><th ${TH}>Branch</th><th ${TH}>Sourced</th><th ${TH}>Attended</th>
        <th ${TH}>SLA %</th><th ${TH}>Selection %</th><th ${TH}>Avg Wait</th>
        <th ${TH}>Pending</th><th ${TH}>Attention</th>
      </tr></thead>
      <tbody>${recruiterRows}</tbody>
    </table>`;

  const pendingSummary = report.recruiterFtd
    .filter((r) => r.pendingCount > 0)
    .map((r) => `<li style="font-size:13px;color:#374151;line-height:1.8;">${r.recruiter} — <strong style="color:#dc2626;">${r.pendingCount} pending</strong></li>`)
    .join("");

  const pendingSection = pendingSummary
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:14px 16px;margin-top:20px;">
        <p style="margin:0 0 8px 0;font-size:13px;font-weight:700;color:#991b1b;">📋 Pending Form Submissions (Action Required)</p>
        <ul style="margin:0;padding-left:18px;">${pendingSummary}</ul>
      </div>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<div style="max-width:700px;margin:0 auto;background:#ffffff;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#6d28d9 0%,#8b5cf6 100%);padding:28px 24px;">
    <p style="margin:0;font-size:22px;font-weight:900;color:#fff;">MAS Callnet PeopleOS</p>
    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Daily Hiring Report · ${branch} · ${dateStr}</p>
  </div>

  <!-- Body -->
  <div style="padding:24px;">
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">Dear HR Team,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#374151;">
      Please find below the branch hiring performance snapshot and management intervention points for immediate action.
    </p>

    ${interventionHtml}
    ${wiwoTable}
    ${processTable}
    ${recruiterTable}
    ${pendingSection}

    <!-- Dashboard CTA -->
    <div style="margin-top:24px;padding:14px 16px;background:#f9fafb;border-radius:6px;text-align:center;border:1px solid #e5e7eb;">
      <span style="font-size:13px;color:#374151;">ATS Dashboard Link: </span>
      <a href="${dashboardUrl}" style="color:#6d28d9;font-weight:700;font-size:13px;text-decoration:none;">Click Here to Open Dashboard →</a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">This is an automated daily report from MAS Callnet PeopleOS. Report time: 8:00 PM IST.</p>
  </div>

</div>
</body>
</html>`;

  const subject = `[${branch}] Daily Hiring Report – ${today.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} | FTD: ${report.ftd.walkin} Walk-ins · ${report.ftd.selected} Selected · ${report.ftd.pending} Pending`;

  return { subject, html };
}
