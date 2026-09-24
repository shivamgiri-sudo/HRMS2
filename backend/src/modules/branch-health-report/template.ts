/**
 * Branch Health Report — mail-safe HTML email renderer.
 *
 * Layout: nested tables, inline styles, bgcolor attributes. No flexbox or CSS Grid.
 */
import type { BranchHealthReport } from "./metrics.js";

const C = {
  primary: "#1e3a5f",
  accent: "#2563eb",
  success: "#16a34a",
  warn: "#d97706",
  danger: "#dc2626",
  bg: "#f1f5f9",
  card: "#ffffff",
  muted: "#64748b",
  border: "#e2e8f0",
  headerText: "#ffffff",
};

const FONT = "font-family:Arial,Helvetica,sans-serif;";

export function esc(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

function statusBadge(status: string): string {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    submitted: { bg: "#dbeafe", text: "#1d4ed8", label: "Submitted" },
    branch_head_approved: { bg: "#fef9c3", text: "#854d0e", label: "Branch Approved" },
    accounts_head_approved: { bg: "#fef9c3", text: "#854d0e", label: "Accounts Approved" },
    approved: { bg: "#dcfce7", text: "#166534", label: "Approved" },
    finance_head_approved: { bg: "#dcfce7", text: "#166534", label: "Finance Approved" },
    pending_accounts_payment: { bg: "#ede9fe", text: "#5b21b6", label: "Pending Payment" },
    payment_scheduled: { bg: "#dbeafe", text: "#1d4ed8", label: "Scheduled" },
    partially_paid: { bg: "#dcfce7", text: "#166534", label: "Part Paid" },
    paid: { bg: "#d1fae5", text: "#064e3b", label: "Paid" },
    returned_to_raiser: { bg: "#fee2e2", text: "#991b1b", label: "Returned" },
    returned_to_branch_head: { bg: "#fee2e2", text: "#991b1b", label: "Returned" },
  };
  const s = map[status] ?? { bg: "#f1f5f9", text: "#475569", label: esc(status) };
  return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:${s.bg};color:${s.text};${FONT}font-size:11px;">${s.label}</span>`;
}

function overallBadge(status: BranchHealthReport["overallStatus"]): string {
  const map = {
    healthy: { bg: C.success, label: "HEALTHY" },
    watch: { bg: C.warn, label: "WATCH" },
    critical: { bg: C.danger, label: "CRITICAL" },
  };
  const s = map[status];
  return `<span style="display:inline-block;padding:3px 12px;border-radius:12px;background:${s.bg};color:#fff;${FONT}font-size:12px;font-weight:700;letter-spacing:1px;">${s.label}</span>`;
}

function section(title: string, body: string): string {
  return `
    <tr><td style="padding:16px 0 4px 0;">
      <p style="margin:0 0 8px 0;${FONT}font-size:11px;font-weight:700;letter-spacing:1px;color:${C.muted};text-transform:uppercase;">${esc(title)}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;background:${C.card};">
        <tr><td style="padding:14px;">${body}</td></tr>
      </table>
    </td></tr>`;
}

function kpiRow(items: { label: string; value: string; color?: string }[]): string {
  const cells = items.map((it) => `
    <td style="padding:8px 16px;text-align:center;border-right:1px solid ${C.border};">
      <div style="${FONT}font-size:22px;font-weight:700;color:${it.color ?? C.primary};">${esc(it.value)}</div>
      <div style="${FONT}font-size:11px;color:${C.muted};margin-top:2px;">${esc(it.label)}</div>
    </td>`).join("");
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
}

function dataTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return `<p style="${FONT}font-size:13px;color:${C.muted};margin:0;">None</p>`;
  const th = headers.map((h) =>
    `<th style="padding:8px 10px;background:${C.bg};${FONT}font-size:11px;font-weight:700;color:${C.muted};text-align:left;border-bottom:1px solid ${C.border};">${esc(h)}</th>`
  ).join("");
  const body = rows.map((row) =>
    `<tr>${row.map((cell, i) =>
      `<td style="padding:7px 10px;border-bottom:1px solid ${C.border};${FONT}font-size:12px;color:${C.primary};">${i === row.length - 1 && cell.startsWith("<span") ? cell : esc(cell)}</td>`
    ).join("")}</tr>`
  ).join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${th}${body}</table>`;
}

function processBadge(status: BranchHealthReport["overallStatus"]): string {
  const map = { healthy: `background:#dcfce7;color:#166534`, watch: `background:#fef9c3;color:#854d0e`, critical: `background:#fee2e2;color:#991b1b` };
  const labels = { healthy: "Healthy", watch: "Watch", critical: "Critical" };
  return `<span style="display:inline-block;padding:1px 7px;border-radius:4px;${FONT}font-size:11px;font-weight:600;${map[status]}">${labels[status]}</span>`;
}

export function renderEmail(report: BranchHealthReport, opts: { generatedAt: string; dashboardUrl?: string }): string {
  const { branch, reportDate, raw, criticalPoints, positiveAchievements, overallStatus } = report;

  // ── 1. Budget ──
  const budgetBody = kpiRow([
    { label: "Total Budget", value: raw.budget.periodCode ? inr(raw.budget.totalBudget) : "—" },
    { label: "Consumed", value: inr(raw.budget.consumed), color: raw.budget.utilizationPct >= 95 ? C.danger : raw.budget.utilizationPct >= 80 ? C.warn : C.success },
    { label: "Reserved", value: inr(raw.budget.reserved) },
    { label: "Available", value: inr(raw.budget.available), color: raw.budget.available === 0 ? C.danger : C.success },
    { label: "Utilization", value: `${raw.budget.utilizationPct}%`, color: raw.budget.utilizationPct >= 95 ? C.danger : raw.budget.utilizationPct >= 80 ? C.warn : C.primary },
  ]);

  // ── 2. GRN Stats ──
  const grnStatsBody = kpiRow([
    { label: "Raised (MTD)", value: String(raw.grnStats.raised) },
    { label: "Approved", value: String(raw.grnStats.approved), color: C.success },
    { label: "Pending", value: String(raw.grnStats.pending), color: raw.grnStats.pending >= 5 ? C.warn : C.primary },
    { label: "Total Value", value: inr(raw.grnStats.totalRaisedAmount) },
  ]);

  // ── 3. GRN Table ──
  const grnTableBody = dataTable(
    ["GRN #", "Vendor", "Head", "Amount", "Raised On", "Status"],
    raw.recentGrns.map((g) => [
      g.grnNumber ?? "—",
      g.vendorName ?? "—",
      g.head ?? "—",
      inr(g.amount),
      g.raisedOn,
      statusBadge(g.status),
    ]),
  );

  // ── 4. ATS ──
  const slaPct = raw.ats.slaTotal > 0
    ? `${Math.round((raw.ats.slaBreaches / raw.ats.slaTotal) * 100)}%`
    : "—";
  const atsBody = kpiRow([
    { label: "Walk-ins", value: String(raw.ats.walkins) },
    { label: "Tokens", value: String(raw.ats.tokens) },
    { label: "Tokens Closed", value: String(raw.ats.tokensClosed) },
    { label: "Selected", value: String(raw.ats.selected), color: C.success },
    { label: "Rejected", value: String(raw.ats.rejected), color: C.danger },
    { label: "No Show", value: String(raw.ats.noShow), color: C.muted },
    { label: "SLA Breach %", value: slaPct, color: raw.ats.slaBreaches > 0 ? C.warn : C.success },
  ]);

  // ── 5. Late comers ──
  const lateBody = `
    <p style="${FONT}font-size:14px;font-weight:700;color:${raw.lateStats.totalLate >= 15 ? C.danger : raw.lateStats.totalLate >= 5 ? C.warn : C.primary};margin:0 0 10px 0;">
      Total Late Arrivals: ${raw.lateStats.totalLate}
    </p>
    ${raw.lateStats.processWise.length
      ? dataTable(["Process", "Late Count"], raw.lateStats.processWise.map((p) => [p.process, String(p.count)]))
      : `<p style="${FONT}font-size:13px;color:${C.muted};margin:0;">No late arrivals today</p>`
    }`;

  // ── 6. Shrinkage ──
  const shrinkageColor = raw.shrinkage.shrinkagePct >= 20 ? C.danger : raw.shrinkage.shrinkagePct >= 10 ? C.warn : C.success;
  const shrinkageBody = kpiRow([
    { label: "Scheduled", value: String(raw.shrinkage.scheduled) },
    { label: "Absent", value: String(raw.shrinkage.absent), color: raw.shrinkage.absent > 0 ? C.warn : C.success },
    { label: "Shrinkage %", value: `${raw.shrinkage.shrinkagePct}%`, color: shrinkageColor },
  ]);

  // ── 7. Headcount ──
  const hcBody = kpiRow([
    { label: "Joined Today", value: String(raw.headcount.joinedToday), color: C.success },
    { label: "Left Today", value: String(raw.headcount.leftToday), color: raw.headcount.leftToday > 0 ? C.warn : C.primary },
  ]) + (raw.headcount.joinedNames.length
    ? `<p style="${FONT}font-size:12px;color:${C.muted};margin:8px 0 0 0;">Joiners: ${raw.headcount.joinedNames.slice(0, 5).map(esc).join(", ")}${raw.headcount.joinedNames.length > 5 ? ` +${raw.headcount.joinedNames.length - 5} more` : ""}</p>`
    : "") + (raw.headcount.leftNames.length
    ? `<p style="${FONT}font-size:12px;color:${C.muted};margin:4px 0 0 0;">Separated: ${raw.headcount.leftNames.slice(0, 5).map(esc).join(", ")}${raw.headcount.leftNames.length > 5 ? ` +${raw.headcount.leftNames.length - 5} more` : ""}</p>`
    : "");

  // ── 8. Process performance ──
  const perfBody = raw.processPerformance.length
    ? dataTable(
        ["Process", "Ops Score", "Quality Score", "Status"],
        raw.processPerformance.map((p) => [
          p.process,
          p.opsScore != null ? `${p.opsScore}%` : "—",
          p.qualityScore != null ? `${p.qualityScore}%` : "—",
          processBadge(p.status),
        ]),
      )
    : `<p style="${FONT}font-size:13px;color:${C.muted};margin:0;">No performance data available for this period</p>`;

  // ── 9. Pending actions ──
  const actionsBody = raw.pendingActions.length
    ? dataTable(["Action", "Count"],
        raw.pendingActions.map((a) => [a.label, String(a.count)]))
    : `<p style="${FONT}font-size:13px;color:${C.success};margin:0;">No pending actions</p>`;

  // ── 10. Critical + Positive ──
  const criticalHtml = criticalPoints.length
    ? criticalPoints.map((c) => `
        <tr bgcolor="${c.severity === "critical" ? "#fff1f2" : "#fffbeb"}">
          <td style="padding:8px 12px;border-left:4px solid ${c.severity === "critical" ? C.danger : C.warn};">
            <span style="${FONT}font-size:13px;font-weight:700;color:${c.severity === "critical" ? C.danger : C.warn};">${esc(c.label)}</span><br>
            <span style="${FONT}font-size:12px;color:${C.muted};">${esc(c.detail)}</span>
          </td>
        </tr>`).join("")
    : `<tr><td style="padding:10px 12px;"><span style="${FONT}font-size:13px;color:${C.success};">No critical points today</span></td></tr>`;

  const positiveHtml = positiveAchievements.length
    ? positiveAchievements.map((a) => `
        <tr bgcolor="#f0fdf4">
          <td style="padding:8px 12px;border-left:4px solid ${C.success};">
            <span style="${FONT}font-size:13px;font-weight:700;color:${C.success};">${esc(a.label)}</span><br>
            <span style="${FONT}font-size:12px;color:${C.muted};">${esc(a.detail)}</span>
          </td>
        </tr>`).join("")
    : `<tr><td style="padding:10px 12px;"><span style="${FONT}font-size:13px;color:${C.muted};">No highlights today</span></td></tr>`;

  const dateLabel = (() => {
    const d = new Date(`${reportDate}T00:00:00Z`);
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  })();

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.bg};${FONT}">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.bg}">
<tr><td align="center" style="padding:24px 16px;">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;">

  <!-- Header -->
  <tr><td bgcolor="${C.primary}" style="padding:24px 28px;border-radius:8px 8px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <p style="${FONT}font-size:20px;font-weight:700;color:${C.headerText};margin:0;">MAS Callnet PeopleOS</p>
          <p style="${FONT}font-size:14px;color:#94a3b8;margin:4px 0 0 0;">Branch Health Report — ${esc(branch)}</p>
          <p style="${FONT}font-size:12px;color:#64748b;margin:4px 0 0 0;">${esc(dateLabel)}</p>
        </td>
        <td align="right" valign="top">${overallBadge(overallStatus)}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td bgcolor="${C.card}" style="padding:20px 28px;border:1px solid ${C.border};">
    <table width="100%" cellpadding="0" cellspacing="0">

      ${section("Budget vs Consumption" + (raw.budget.periodCode ? ` — ${raw.budget.periodCode}` : ""), budgetBody)}
      ${section("GRN Summary (Month-to-Date)", grnStatsBody)}
      ${section("Recent GRNs (Latest 15)", grnTableBody)}
      ${section("ATS — Today's Recruitment Activity", atsBody)}
      ${section("Late Arrivals", lateBody)}
      ${section("Shrinkage — Today", shrinkageBody)}
      ${section("Headcount Movement — Today", hcBody)}
      ${section("Process-wise Performance (Last 7 Days)", perfBody)}
      ${section("Pending Actions", actionsBody)}

      <!-- Critical Points -->
      <tr><td style="padding:16px 0 4px 0;">
        <p style="margin:0 0 8px 0;${FONT}font-size:11px;font-weight:700;letter-spacing:1px;color:${C.muted};text-transform:uppercase;">Critical Intervention Points</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">
          ${criticalHtml}
        </table>
      </td></tr>

      <!-- Positive Achievements -->
      <tr><td style="padding:12px 0 4px 0;">
        <p style="margin:0 0 8px 0;${FONT}font-size:11px;font-weight:700;letter-spacing:1px;color:${C.muted};text-transform:uppercase;">Positive Achievements</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:6px;overflow:hidden;">
          ${positiveHtml}
        </table>
      </td></tr>

    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td bgcolor="${C.bg}" style="padding:14px 28px;border-radius:0 0 8px 8px;border:1px solid ${C.border};border-top:none;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td><p style="${FONT}font-size:11px;color:${C.muted};margin:0;">Generated ${esc(opts.generatedAt)} IST${opts.dashboardUrl ? ` · <a href="${esc(opts.dashboardUrl)}" style="color:${C.accent};">Open Dashboard</a>` : ""}</p></td>
        <td align="right"><p style="${FONT}font-size:11px;color:${C.muted};margin:0;">MAS Callnet PeopleOS</p></td>
      </tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export function subjectLine(report: BranchHealthReport): string {
  const statusEmoji = { healthy: "✅", watch: "⚠️", critical: "🔴" }[report.overallStatus];
  const d = new Date(`${report.reportDate}T00:00:00Z`);
  const label = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return `${statusEmoji} Branch Health Report — ${report.branch} — ${label}`;
}
